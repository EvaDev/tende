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
    }>(
      `SELECT s.internal_code, s.contract_address, cu.decimals, cu.currency_symbol
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
              raw:             raw.toString(),
              formatted,
              contractAddress: coin.contract_address,
            };
          } catch {
            return {
              token:     coin.internal_code,
              symbol:    coin.currency_symbol,
              raw:       '0',
              formatted: '0',
              error:     'balance_read_failed',
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

export default router;
