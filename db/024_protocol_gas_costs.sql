-- Protocol gas costs — ETH spent by the backend relayer / signer wallet.
CREATE TABLE IF NOT EXISTS protocol_gas_costs (
  id              SERIAL PRIMARY KEY,
  tx_hash         VARCHAR(66)  NOT NULL UNIQUE,
  source          VARCHAR(40)  NOT NULL,
  gas_used        BIGINT       NOT NULL,
  gas_price_wei   NUMERIC(78,0) NOT NULL,
  cost_wei        NUMERIC(78,0) NOT NULL,
  block_number    BIGINT,
  recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protocol_gas_costs_source ON protocol_gas_costs(source);

COMMENT ON TABLE protocol_gas_costs IS
  'Gas paid by the platform backend signer (relay, treasury ops, registration, etc.).';
