-- WebAuthn passkey credentials for consumer login.
-- Each credential is a discoverable (resident) passkey bound to a Safe wallet.
-- Public key coords are stored as decimal strings of the P-256 uint256 values
-- (used both for the Safe signer factory and to verify login assertions).

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id   TEXT          PRIMARY KEY,            -- base64url credential id
  wallet_address  VARCHAR(66)   NOT NULL,               -- the consumer's Safe wallet
  pub_key_x       NUMERIC(80,0) NOT NULL,               -- P-256 X coordinate (uint256)
  pub_key_y       NUMERIC(80,0) NOT NULL,               -- P-256 Y coordinate (uint256)
  signer_address  VARCHAR(66),                          -- resolved Safe WebAuthn signer
  sign_count      BIGINT        NOT NULL DEFAULT 0,
  rp_id           TEXT          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_wallet ON webauthn_credentials(wallet_address);
