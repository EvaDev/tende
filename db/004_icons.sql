-- Shared icon registry — usable by merchants, products, or any future entity.

CREATE TABLE icons (
    icon_id     SERIAL       PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,  -- human label e.g. 'Flash', 'MTN'
    slug        VARCHAR(100) NOT NULL UNIQUE,  -- url-safe key e.g. 'flash', 'mtn'
    mime_type   VARCHAR(30)  NOT NULL DEFAULT 'image/png',
    data_base64 TEXT         NOT NULL,
    arweave_id  VARCHAR(100),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Allow merchants and products to reference an icon
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS icon_id INTEGER REFERENCES icons(icon_id);
ALTER TABLE products  ADD COLUMN IF NOT EXISTS icon_id INTEGER REFERENCES icons(icon_id);
