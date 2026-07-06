-- Contract deployment gas — separate from onboarding (consumer Safe deploy) and ops.

-- Vault v1.3.0 upgrade (Sepolia, 2026-07-04).
UPDATE contract_deployments
   SET impl_address = '0x0d2378ECC638557F820379b7200477450DB4B2a4',
       version = '1.3.0',
       deploy_tx = COALESCE(deploy_tx, '0x85cfc887ac63d0359ca6e9308aff3089c82a1ec60744e78582d2d98164f013de'),
       deployed_at = COALESCE(deployed_at, NOW()),
       notes = 'UUPS v1.3.0 — platformReserveAssets excludes admin mint from harvestable yield',
       updated_at = NOW()
 WHERE contract_name = 'Vault';

-- Track upgrade + impl deploy txs for gas backfill (deployer wallet, not backend relayer).
CREATE TABLE IF NOT EXISTS contract_deployment_txs (
  tx_hash        VARCHAR(66)  PRIMARY KEY,
  contract_name  VARCHAR(40)  NOT NULL,
  tx_kind        VARCHAR(20)  NOT NULL DEFAULT 'deploy',  -- deploy | upgrade | impl
  chain_id       INTEGER      NOT NULL DEFAULT 11155111,
  recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO contract_deployment_txs (tx_hash, contract_name, tx_kind) VALUES
  ('0x39a2d60225f56ef5fac8ab205ce54812322ebd77365dc03d94e0a519857f454a', 'Vault', 'impl'),
  ('0x85cfc887ac63d0359ca6e9308aff3089c82a1ec60744e78582d2d98164f013de', 'Vault', 'upgrade')
ON CONFLICT (tx_hash) DO NOTHING;

-- Reclassify any mis-tagged rows (none expected yet).
UPDATE protocol_gas_costs SET category = 'deployment', source = 'contract_deploy'
 WHERE source IN ('contract_deploy', 'deploy', 'upgrade');
