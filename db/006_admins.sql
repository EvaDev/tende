-- Admin wallets — any address here gets role:'admin' on login.
-- The deployer/contract-owner MetaMask wallet is the bootstrap admin.
-- Never store private keys here — only the public address.

CREATE TABLE IF NOT EXISTS admins (
  wallet_address  VARCHAR(66)   PRIMARY KEY,
  name            VARCHAR(100),
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Deployer admin: MetaMask EOA that owns all contracts (address from DEPLOYER_ADMIN_ADDRESS)
INSERT INTO admins (wallet_address, name)
VALUES ('0x532ad518c8b71904da74beb44fb664016b6f2d42', 'Deployer Admin')
ON CONFLICT DO NOTHING;
