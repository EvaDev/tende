-- Sign-up funnel / audit table. One row per consumer registration attempt, written
-- BEFORE any on-chain work begins (unlike `consumers`, which only gets a row once a
-- registration completes end-to-end). This lets us count sign-ups that fail or are
-- abandoned mid-flow and infer WHERE they broke:
--
--   status: started → completed | failed
--   current_step:  furthest pipeline stage reached (signer→deploy→idos→ens→pimlico→db→done)
--   failed_step:   the stage that threw (set only when status='failed')
--
-- The on-chain deploy (step 2) emits ConsumerRegistered regardless of whether the
-- later off-chain steps succeed, so on-chain ConsumerRegistered events can outnumber
-- consumers rows. This table reconciles that gap: attempts that reached 'deploy' but
-- failed before 'db' are the difference.
--
-- Tracking writes are best-effort in the app (a tracking failure never aborts a real
-- registration), so a 'started' row that never advances = the process crashed or the
-- request is still in flight.
CREATE TABLE IF NOT EXISTS registration_attempts (
    attempt_id     UUID          PRIMARY KEY,           -- = idOS userId generated at start
    status         VARCHAR(12)   NOT NULL DEFAULT 'started',
    current_step   VARCHAR(16),                          -- signer|deploy|idos|ens|pimlico|db|done
    failed_step    VARCHAR(16),                          -- set when status='failed'
    country_code   VARCHAR(3),
    ens_subdomain  VARCHAR(100),                         -- the @tag the user chose
    display_name   VARCHAR(120),
    mobile_number  VARCHAR(32),                          -- contact handle for failed sign-up follow-up
    signer_address VARCHAR(66),
    wallet_address VARCHAR(66),                          -- known once step 2 (deploy) succeeds
    tx_hash        VARCHAR(66),
    error          TEXT,                                 -- failure message
    steps          JSONB,                                -- full per-step detail incl. best-effort errors
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT registration_attempts_status_check
        CHECK (status IN ('started', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_reg_attempts_status  ON registration_attempts(status);
CREATE INDEX IF NOT EXISTS idx_reg_attempts_created ON registration_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_attempts_wallet  ON registration_attempts(LOWER(wallet_address));
