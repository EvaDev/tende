// src/cashInService.ts
// A "cash-in" simulates a fiat deposit: it mints TTZA backing into the Vault and
// credits the recipient's spendable Vault ZAR claim, and records the off-chain
// reference (a bank-deposit ref for admin, a voucher number for consumers) that
// backs it. The `reference` is unique so a voucher/deposit can't be used twice.
// POC ONLY — on mainnet the mint would be gated on a real, reconciled deposit.

import db from './db.js';
import config from './config.js';
import { mintTreasuryZA, vaultAdminCredit } from './treasuryService.js';

export interface CashInInput {
  wallet: string;
  amountUnits: bigint;       // raw units (ZAR = 2dp)
  currency: string;          // 'ZAR'
  reference: string;         // voucher number | bank-deposit ref (unique)
  kind: 'voucher' | 'bank_deposit';
  source: 'consumer' | 'admin';
}

export interface CashInResult { mintTx: string; creditTx: string; amountUnits: string; }

export async function cashIn(p: CashInInput): Promise<CashInResult> {
  const vault = config.contracts.vault;
  if (!vault) throw new Error('No vault address configured');

  // 1. Reserve the reference first (uniqueness gate) so we never mint twice for the
  //    same voucher/deposit, even under a double-submit.
  let id: string;
  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO deposit_references (reference, kind, source, wallet, amount, currency)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.reference, p.kind, p.source, p.wallet.toLowerCase(), p.amountUnits.toString(), p.currency.toUpperCase()],
    );
    id = r.rows[0].id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw Object.assign(new Error('That voucher/reference has already been used'), { status: 409 });
    }
    throw e;
  }

  // 2. Mint TTZA backing into the Vault reserve, then credit the wallet's claim.
  const mintTx   = await mintTreasuryZA(vault, p.amountUnits);
  const creditTx = await vaultAdminCredit(p.wallet, p.amountUnits, p.currency);

  // 3. Record the on-chain tx hashes against the reference (audit link).
  await db.query(
    `UPDATE deposit_references SET mint_tx = $1, credit_tx = $2 WHERE id = $3`,
    [mintTx, creditTx, id],
  );

  return { mintTx, creditTx, amountUnits: p.amountUnits.toString() };
}
