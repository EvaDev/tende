-- =============================================================================
-- Migration 005: Registration config + KYC field requirements
-- =============================================================================

-- Add personal-detail requirements to KYC tiers
ALTER TABLE kyc_levels
  ADD COLUMN IF NOT EXISTS requires_full_name BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS requires_mobile    BOOLEAN NOT NULL DEFAULT TRUE;

-- All existing tiers require full name + mobile
UPDATE kyc_levels SET requires_full_name = TRUE, requires_mobile = TRUE;

-- ---------------------------------------------------------------------------
-- registration_fields: controls which steps appear in the consumer sign-up flow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_fields (
    field_key           VARCHAR(50)  PRIMARY KEY,  -- e.g. 'mobile', 'full_name', 'address'
    label               VARCHAR(100) NOT NULL,
    included            BOOLEAN      NOT NULL DEFAULT TRUE,
    required            BOOLEAN      NOT NULL DEFAULT TRUE,
    verification_method VARCHAR(30)  NOT NULL DEFAULT 'none',
    -- 'none' | 'otp_sms' | 'manual_review' | 'idos'
    sort_order          SMALLINT     NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO registration_fields (field_key, label, included, required, verification_method, sort_order) VALUES
    ('mobile',        'Mobile Number',        TRUE,  TRUE,  'none',          1),
    ('full_name',     'Full Name',            TRUE,  TRUE,  'none',          2),
    ('dob',           'Date of Birth',        FALSE, FALSE, 'none',          3),
    ('address',       'Residential Address',  FALSE, FALSE, 'none',          4),
    ('email',         'Email Address',        FALSE, FALSE, 'none',          5),
    ('id_number',     'ID / Passport Number', FALSE, FALSE, 'manual_review', 6),
    ('occupation',    'Occupation',           FALSE, FALSE, 'none',          7),
    ('income_source', 'Source of Income',     FALSE, FALSE, 'none',          8),
    ('account_tag',   'Account Tag (ENS)',    TRUE,  TRUE,  'none',          9)
ON CONFLICT (field_key) DO NOTHING;
