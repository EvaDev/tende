-- Event indexer: on-chain logs projected into Postgres for reporting. The chain is
-- the source of truth; this is a rebuildable index (see project_value_model). The
-- indexer reads Vault / TreasuryToken / Consumer logs and upserts them here.

CREATE TABLE IF NOT EXISTS chain_events (
    id            BIGSERIAL    PRIMARY KEY,
    chain_id      INTEGER      NOT NULL,
    block_number  BIGINT       NOT NULL,
    block_hash    VARCHAR(66),
    tx_hash       VARCHAR(66)  NOT NULL,
    log_index     INTEGER      NOT NULL,
    address       VARCHAR(42)  NOT NULL,    -- emitting contract
    contract      VARCHAR(20),              -- 'Vault' | 'TreasuryToken' | 'Consumer'
    event_name    VARCHAR(60)  NOT NULL,    -- decoded event name
    args          JSONB        NOT NULL,    -- decoded args (uint256 → string)
    block_time    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tx_hash, log_index)             -- idempotent re-indexing
);
CREATE INDEX IF NOT EXISTS idx_chain_events_block   ON chain_events(block_number);
CREATE INDEX IF NOT EXISTS idx_chain_events_name    ON chain_events(event_name);
CREATE INDEX IF NOT EXISTS idx_chain_events_address ON chain_events(address);

-- Single-row cursor: the last fully-processed (confirmed) block.
CREATE TABLE IF NOT EXISTS indexer_cursor (
    id          INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_block  BIGINT       NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
