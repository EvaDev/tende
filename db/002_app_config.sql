-- =============================================================================
-- Migration 002: App config table
-- Stores runtime-editable settings: app name, brand colors, feature flags.
-- =============================================================================

CREATE TABLE app_config (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT         NOT NULL,
    description VARCHAR(300),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value, description) VALUES
    ('app.name',              'Tende',    'Application display name'),
    ('brand.color.bg',        'A8C8E8',   'Main background color (hex, no #)'),
    ('brand.color.accent',    '5C2D1E',   'Accent / button color (hex, no #)'),
    ('brand.color.text',      'FFFFFF',   'Primary text color on accent backgrounds (hex, no #)'),
    ('pilot.max_consumers',   '500',      'Maximum consumers allowed in pilot'),
    ('pilot.destination',     'ZW',       'Allowed remittance destination country code');
