-- TreasuryToken registry cleanup:
--   * One shared TreasuryToken logic row (not ZA-specific)
--   * Corridor instances (TTZA, TTMW, …) live in stablecoins only
--   * Drop TreasuryTokenFactory and legacy per-corridor deployment rows

INSERT INTO contract_deployments (contract_name, proxy_address, impl_address, version, chain_id, deploy_tx, notes)
SELECT
  'TreasuryToken',
  impl_address,
  impl_address,
  COALESCE(version, '1.1.0'),
  chain_id,
  deploy_tx,
  'Shared TreasuryToken logic — corridor tokens are ERC-1967 proxy instances (see stablecoins)'
FROM contract_deployments
WHERE contract_name = 'TreasuryTokenZA'
ON CONFLICT (contract_name) DO UPDATE SET
  proxy_address = EXCLUDED.proxy_address,
  impl_address  = EXCLUDED.impl_address,
  version       = EXCLUDED.version,
  notes         = EXCLUDED.notes,
  updated_at    = NOW();

DELETE FROM contract_deployments
WHERE contract_name IN ('TreasuryTokenZA', 'TreasuryTokenFactory')
   OR (contract_name LIKE 'TreasuryToken%' AND contract_name <> 'TreasuryToken');
