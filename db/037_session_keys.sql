-- Session keys for cheaper per-tx auth (SessionTransferModule).
-- Toggle via app_config feature.session_keys (Admin → Settings).

INSERT INTO app_config (key, value, description) VALUES
  ('feature.session_keys', 'false',
   'When true, consumer payments use a short-lived session key (secp256k1) instead of passkey/WebAuthn on every transfer. Requires SESSION_TRANSFER_MODULE_ADDRESS on the API.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS session_keys (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address   TEXT NOT NULL,
    session_address  TEXT NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    max_per_tx       BIGINT NOT NULL,
    daily_cap        BIGINT NOT NULL,
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_address, session_address)
);

CREATE INDEX IF NOT EXISTS session_keys_wallet_active_idx
    ON session_keys (wallet_address)
    WHERE revoked_at IS NULL;

-- API connects as imali_app; migrations may run as a different DB role locally.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imali_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON session_keys TO imali_app;
  END IF;
END $$;
