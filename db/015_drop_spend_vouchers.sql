-- Retire the DB-backed spend-voucher lifecycle tables created in migration 013.
--
-- Decision (supersedes 013's voucher tables): a "voucher" is an ON-CHAIN concept —
-- value moves as Vault ZAR-balance transfers (P2P + merchant redeem), with an
-- on-chain escrow for not-yet-onboarded recipients. ALL lifecycle and reporting are
-- derived from indexed on-chain events (chain_events, migration 014). No parallel
-- Postgres voucher ledger.
--
-- KEPT from 013: merchant_accepted_currencies (which currencies a merchant accepts)
-- — still required and unrelated to the voucher-record detour.

DROP TABLE IF EXISTS voucher_events      CASCADE;
DROP TABLE IF EXISTS voucher_redemptions CASCADE;
DROP TABLE IF EXISTS voucher_settlements CASCADE;
DROP TABLE IF EXISTS spend_vouchers      CASCADE;
