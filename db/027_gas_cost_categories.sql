-- Classify protocol gas: onboarding (CAC), consumer transactions, platform ops.
ALTER TABLE protocol_gas_costs
  ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'operations';

CREATE INDEX IF NOT EXISTS idx_protocol_gas_costs_category ON protocol_gas_costs(category);

-- Relay = consumer payment sponsorship.
UPDATE protocol_gas_costs SET category = 'transaction', source = 'relay'
 WHERE source = 'relay';

-- Consumer wallet deploy txs.
UPDATE protocol_gas_costs g
   SET category = 'onboarding', source = 'register_deploy'
  FROM registration_attempts r
 WHERE r.tx_hash IS NOT NULL AND LOWER(g.tx_hash) = LOWER(r.tx_hash);

-- Payment relays (if indexed as backfill).
UPDATE protocol_gas_costs g
   SET category = 'transaction', source = 'relay'
  FROM merchant_sales s
 WHERE s.tx_hash IS NOT NULL AND LOWER(g.tx_hash) = LOWER(s.tx_hash);

-- Settlements.
UPDATE protocol_gas_costs g
   SET category = 'operations', source = 'settlement'
  FROM settlement_requests sr
 WHERE sr.executed_tx_hash IS NOT NULL AND LOWER(g.tx_hash) = LOWER(sr.executed_tx_hash);

-- Remaining backfill rows → platform operations.
UPDATE protocol_gas_costs SET category = 'operations', source = 'operations'
 WHERE source = 'backfill';
