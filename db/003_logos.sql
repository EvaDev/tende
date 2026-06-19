-- Logo storage (DB phase — swap data_base64 for arweave_id when ready)

CREATE TABLE merchant_logos (
    merchant_id   VARCHAR(36) PRIMARY KEY REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    mime_type     VARCHAR(30)  NOT NULL DEFAULT 'image/png',
    data_base64   TEXT         NOT NULL,   -- base64-encoded image; replace with arweave_id later
    arweave_id    VARCHAR(100),            -- populated once uploaded to Arweave
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- App logo lives in app_config (key = 'app.logo', value = base64 data URI)
INSERT INTO app_config (key, value, description)
VALUES ('app.logo', '', 'App logo as base64 data URI (data:image/...;base64,...)')
ON CONFLICT (key) DO NOTHING;
