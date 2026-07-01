-- Allow admin-controlled trading statuses on merchants.verification_status.
-- The column previously only permitted KYB levels (PENDING / LEVEL_1..3 / REJECTED).
-- Admins set a merchant's trading state to ACTIVE (trading) or INACTIVE; the older
-- values are kept for backward compatibility.
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_verification_status_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_verification_status_check
  CHECK (verification_status IN ('PENDING', 'ACTIVE', 'INACTIVE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'REJECTED'));
