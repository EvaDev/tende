-- Operational record of deployed contracts. The proxy address is stable; the
-- implementation address changes on each UUPS upgrade. Live impl + on-chain
-- VERSION are read from chain at request time; this table is the source of truth
-- for "what we intended to deploy" and the audit trail (deploy tx, timestamp).

CREATE TABLE IF NOT EXISTS contract_deployments (
  contract_name  VARCHAR(40)  PRIMARY KEY,         -- 'Consumer','Vault','TreasuryTokenZA'
  proxy_address  VARCHAR(66)  NOT NULL,            -- stable ERC-1967 proxy
  impl_address   VARCHAR(66),                      -- last known implementation (refreshed from chain)
  version        VARCHAR(20),                      -- version tag recorded at deploy/upgrade
  chain_id       INTEGER      NOT NULL,
  deploy_tx      VARCHAR(66),
  deployed_at    TIMESTAMPTZ,
  notes          VARCHAR(200),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO contract_deployments (contract_name, proxy_address, version, chain_id, notes) VALUES
  ('Consumer',       '0x7BD328cb14c59a316d9D14Aab802b352F8ed13B9', '1.0.0', 11155111, 'UUPS; AccessControl; not pausable'),
  ('Vault',          '0xe9e3DB0be17a4D6D4c794FF2600Fd9D7BC30C3dA', '1.0.0', 11155111, 'UUPS; AccessControl; pausable'),
  ('TreasuryTokenZA','0xb62701Caa1611917B8e999230B296Fc95276ADe4', '1.0.0', 11155111, 'UUPS; ERC20; pausable')
ON CONFLICT (contract_name) DO NOTHING;
