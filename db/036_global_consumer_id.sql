-- On-chain account number from Consumer.sol (globalConsumerId / nextGlobalId).
-- Assigned at registerConsumer(); starts at 1000. Distinct from PG consumer_id (UUID).

ALTER TABLE consumers
  ADD COLUMN IF NOT EXISTS global_consumer_id BIGINT UNIQUE;

COMMENT ON COLUMN consumers.global_consumer_id IS
  'Consumer.sol globalConsumerId — sequential on-chain account number (starts at 1000). '
  'Lookup via getConsumerByGlobalId. Survives wallet recovery.';
