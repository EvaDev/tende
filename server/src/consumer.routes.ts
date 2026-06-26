// src/consumer.routes.ts
// Consumer-facing API routes. All routes require a valid JWT (requireAuth).
//
// GET  /api/consumer/me           — profile: wallet, KYC level, ENS, feature gates
// GET  /api/consumer/balance      — live on-chain token balances
// GET  /api/consumer/transactions — transaction history from onchain_events
// GET  /api/consumer/kyc          — KYC level + all spending limits

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import config from './config.js';
import db     from './db.js';
import { requireAuth } from './auth.middleware.js';
import type { KycLevelRow, OnchainEventRow } from './types.js';

const router = express.Router();
router.use(requireAuth);

const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

// ── GET /api/consumer/me ──────────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await db.query(
      `SELECT
         c.consumer_id, c.wallet_address, c.country_code, c.ens_subdomain,
         c.source_system, c.kyc_level_id,
         k.level_name, k.allows_usd_savings, k.allows_remittance, k.allows_merchant_spend
       FROM consumers c
       LEFT JOIN kyc_levels k ON k.level_id = c.kyc_level_id
       WHERE c.consumer_id = $1`,
      [req.consumer!.consumerId],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'Consumer not found' });
      return;
    }

    const c = result.rows[0];
    res.json({
      consumerId:    c.consumer_id,
      walletAddress: c.wallet_address,
      countryCode:   c.country_code,
      ensSubdomain:  c.ens_subdomain,
      sourceSystem:  c.source_system,
      kyc: {
        levelId:             c.kyc_level_id,
        levelName:           c.level_name,
        allowsUsdSavings:    c.allows_usd_savings,
        allowsRemittance:    c.allows_remittance,
        allowsMerchantSpend: c.allows_merchant_spend,
      },
    });
  } catch (err) {
    console.error('[GET /api/consumer/me]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/balance ─────────────────────────────────────────────────

router.get('/balance', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.consumer!;

    const coinsResult = await db.query<{
      internal_code: string;
      contract_address: string | null;
      decimals: number;
      currency_symbol: string | null;
      base_currency: string | null;
      is_treasury: boolean;
    }>(
      `SELECT s.internal_code, s.contract_address, cu.decimals, cu.currency_symbol,
              COALESCE(cu.base_currency_code, cu.currency_code) AS base_currency,
              s.is_treasury_token AS is_treasury
       FROM stablecoins s
       JOIN currencies cu ON cu.currency_code = s.internal_code
       WHERE s.is_active = TRUE AND s.is_deployed = TRUE`,
    );

    const provider = getProvider();

    const balances = await Promise.all(
      coinsResult.rows
        .filter(row => row.contract_address)
        .map(async (coin) => {
          try {
            const contract  = new ethers.Contract(coin.contract_address!, ERC20_BALANCE_ABI, provider);
            const raw       = await contract.balanceOf(walletAddress) as bigint;
            const formatted = ethers.formatUnits(raw, coin.decimals);
            return {
              token:           coin.internal_code,
              symbol:          coin.currency_symbol,
              decimals:        coin.decimals,
              baseCurrency:    coin.base_currency,
              isTreasury:      coin.is_treasury,
              raw:             raw.toString(),
              formatted,
              contractAddress: coin.contract_address,
            };
          } catch {
            return {
              token:        coin.internal_code,
              symbol:       coin.currency_symbol,
              baseCurrency: coin.base_currency,
              isTreasury:   coin.is_treasury,
              raw:          '0',
              formatted:    '0',
              error:        'balance_read_failed',
            };
          }
        }),
    );

    res.json({ walletAddress, balances });
  } catch (err) {
    console.error('[GET /api/consumer/balance]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/transactions ───────────────────────────────────────────

router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit  = Math.min(parseInt((req.query.limit  as string) ?? '20'), 100);
    const offset = parseInt((req.query.offset as string) ?? '0');
    const { walletAddress } = req.consumer!;

    const result = await db.query<OnchainEventRow>(
      `SELECT event_id, event_type, from_address, to_address,
              amount, currency_code, block_timestamp, tx_hash, status
       FROM onchain_events
       WHERE from_address = $1 OR to_address = $1
       ORDER BY block_timestamp DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [walletAddress.toLowerCase(), limit, offset],
    );

    res.json({ transactions: result.rows, limit, offset, count: result.rows.length });
  } catch (err) {
    console.error('[GET /api/consumer/transactions]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/kyc ─────────────────────────────────────────────────────

router.get('/kyc', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await db.query<KycLevelRow>(
      `SELECT k.* FROM consumers c
       JOIN kyc_levels k ON k.level_id = c.kyc_level_id
       WHERE c.consumer_id = $1`,
      [req.consumer!.consumerId],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'KYC level not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /api/consumer/kyc]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── P2P transfer (user-signed, backend-relayed) ───────────────────────────────
// Self-custody send over the Vault unified ledger. The consumer's passkey signs
// the SafeTx for Vault.transfer; the backend relays execTransaction and pays gas
// (Option A). The on-chain KYC gate ("each party a KYC'd consumer or a trusted
// counterparty") is enforced by the Vault, not here — these checks are pre-flight
// UX so the user isn't asked to sign a transaction that would revert.

import {
  buildVaultTransferSafeTx, relaySafeTx, unifiedBalanceOf,
  kycLevelOf, isTrustedCounterparty, type SafeTx,
} from './safeRelayService.js';
import { b64urlToBuf } from './webauthnService.js';

// Decimal places per currency for amount parsing (pilot: ZAR cash = 2, USDC = 6).
const CURRENCY_DECIMALS: Record<string, number> = { ZAR: 2, USDC: 6 };
function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

// Pending SafeTx store: the server holds the exact tx it built so the client
// cannot tamper between prepare and submit. Keyed by safeTxHash. Short TTL.
const PENDING_TTL_MS = 5 * 60 * 1000;
interface PendingTransfer {
  safeTx: SafeTx; senderWallet: string; toAddress: string;
  amount: bigint; currency: string; expiry: number;
}
const pendingTransfers = new Map<string, PendingTransfer>();
function sweepPending() {
  const now = Date.now();
  for (const [h, p] of pendingTransfers) if (p.expiry < now) pendingTransfers.delete(h);
}

/// Resolve a recipient — either a 0x address or an @tag (ENS subdomain registered
/// on the Consumer contract). Returns the recipient's spend-wallet address.
async function resolveRecipient(toRaw: string): Promise<string> {
  const v = toRaw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return ethers.getAddress(v);

  const tag = v.replace(/^@/, '').toLowerCase().split('.')[0];
  if (!/^[a-z0-9-]{3,32}$/.test(tag)) throw new Error('Invalid recipient — use a 0x address or @tag');
  if (!config.contracts.consumer) throw new Error('Consumer contract not configured');

  const consumer = new ethers.Contract(
    config.contracts.consumer,
    ['function getConsumerByEns(bytes32 ensHash) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))'],
    getProvider(),
  );
  try {
    const d = await consumer.getConsumerByEns(ethers.keccak256(ethers.toUtf8Bytes(tag)));
    return d.spendWallet as string;
  } catch {
    throw new Error(`No account found for @${tag}`);
  }
}

// ── POST /api/consumer/transfer/prepare ───────────────────────────────────────
// Body: { to: "0x…" | "@tag", amount: "100.00", currency: "ZAR" }
// Returns the SafeTx hash to sign (as a base64url WebAuthn challenge) + a summary.
router.post('/transfer/prepare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, amount, currency } = req.body as { to?: string; amount?: string; currency?: string };
    if (!to || !amount || !currency) { res.status(400).json({ error: 'Missing to, amount, or currency' }); return; }

    const senderWallet = req.consumer!.walletAddress;
    let amountUnits: bigint;
    try { amountUnits = ethers.parseUnits(String(amount), decimalsFor(currency)); }
    catch { res.status(400).json({ error: 'Invalid amount' }); return; }
    if (amountUnits <= 0n) { res.status(400).json({ error: 'Amount must be positive' }); return; }

    const toAddress = await resolveRecipient(to);
    if (toAddress.toLowerCase() === senderWallet.toLowerCase()) {
      res.status(400).json({ error: 'Cannot send to yourself' }); return;
    }

    // Pre-flight compliance mirror of the on-chain gate (better errors before signing).
    const [senderKyc, recipientKyc, recipientTrusted, balance] = await Promise.all([
      kycLevelOf(senderWallet), kycLevelOf(toAddress),
      isTrustedCounterparty(toAddress), unifiedBalanceOf(senderWallet, currency),
    ]);
    if (senderKyc < 1) { res.status(403).json({ error: 'Your account is not yet verified (KYC level 1 required to send)', code: 'SENDER_KYC' }); return; }
    if (recipientKyc < 1 && !recipientTrusted) {
      res.status(409).json({ error: 'Recipient is not verified yet. Send to escrow until they onboard.', code: 'RECIPIENT_UNVERIFIED' }); return;
    }
    if (balance < amountUnits) {
      res.status(409).json({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' }); return;
    }

    const { safeTx, safeTxHash } = await buildVaultTransferSafeTx({
      safeAddress: senderWallet, toAddress, amount: amountUnits, currency,
    });

    sweepPending();
    pendingTransfers.set(safeTxHash, {
      safeTx, senderWallet, toAddress, amount: amountUnits, currency, expiry: Date.now() + PENDING_TTL_MS,
    });

    res.json({
      safeTxHash,
      // The WebAuthn challenge is the raw 32-byte SafeTx hash, base64url-encoded.
      challenge: Buffer.from(safeTxHash.slice(2), 'hex').toString('base64url'),
      rpId: config.webauthn.rpId,
      to: toAddress, amount: String(amount), currency: currency.toUpperCase(),
      nonce: safeTx.nonce,
    });
  } catch (err) {
    console.error('[POST /api/consumer/transfer/prepare]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/consumer/transfer/submit ────────────────────────────────────────
// Body: { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature }
//   (the last three base64url, exactly as returned by the passkey get() assertion)
router.post('/transfer/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature } =
      req.body as Record<string, string>;
    if (!safeTxHash || !credentialId || !authenticatorData || !clientDataJSON || !signature) {
      res.status(400).json({ error: 'Missing signature fields' }); return;
    }

    const pending = pendingTransfers.get(safeTxHash);
    if (!pending || pending.expiry < Date.now()) {
      res.status(410).json({ error: 'Transfer expired — please start again', code: 'EXPIRED' }); return;
    }
    if (pending.senderWallet.toLowerCase() !== req.consumer!.walletAddress.toLowerCase()) {
      res.status(403).json({ error: 'Transfer does not belong to this account' }); return;
    }

    // Defence-in-depth: the signed challenge must equal this SafeTx hash.
    const clientData = JSON.parse(b64urlToBuf(clientDataJSON).toString('utf8')) as { challenge?: string };
    const signedHash = '0x' + b64urlToBuf(clientData.challenge ?? '').toString('hex');
    if (signedHash.toLowerCase() !== safeTxHash.toLowerCase()) {
      res.status(400).json({ error: 'Signed challenge does not match the prepared transfer' }); return;
    }

    // Resolve the Safe owner (the passkey signer) for this credential, and confirm
    // it belongs to the authenticated wallet.
    const cred = await db.query<{ wallet_address: string; signer_address: string | null }>(
      `SELECT wallet_address, signer_address FROM webauthn_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    const row = cred.rows[0];
    if (!row || !row.signer_address) { res.status(404).json({ error: 'Unknown passkey credential' }); return; }
    if (row.wallet_address.toLowerCase() !== pending.senderWallet.toLowerCase()) {
      res.status(403).json({ error: 'Credential does not match the sending wallet' }); return;
    }

    const txHash = await relaySafeTx({
      safeAddress: pending.senderWallet,
      ownerSignerAddress: row.signer_address,
      safeTx: pending.safeTx,
      assertion: {
        authenticatorData: b64urlToBuf(authenticatorData),
        clientDataJSON: b64urlToBuf(clientDataJSON),
        derSignature: b64urlToBuf(signature),
      },
    });

    pendingTransfers.delete(safeTxHash);
    res.json({ success: true, txHash, to: pending.toAddress, amount: pending.amount.toString(), currency: pending.currency });
  } catch (err) {
    console.error('[POST /api/consumer/transfer/submit]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Investments (non-custodial) ───────────────────────────────────────────────
// The broker ledger (platform-held positions, buy/sell endpoints) was removed:
// under the non-custodial DEX model the asset lives in the consumer's own Safe
// wallet. Holdings are therefore the on-chain token balance (read via /balance),
// and a "buy" is a Pimlico-sponsored Uniswap swap UserOp from the Safe — added
// in step 2 (execution). Live pricing is served by the public /api/assets route.

export default router;
