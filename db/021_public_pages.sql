-- Public (no-login) read-only pages. A CSV of admin page keys that are visible to
-- anyone who opens the console without connecting a wallet — configured by an admin
-- in Settings → "Public pages". Empty = nothing exposed (the safe default). Write
-- endpoints always stay behind requireAdmin, so exposure is strictly read-only.
-- Page keys match the route path (e.g. reports, treasury, registration, assets,
-- contracts) and are enforced server-side by the allowPublicPage() middleware.
INSERT INTO app_config (key, value, description) VALUES
  ('app.public_pages', '', 'CSV of admin page keys visible read-only without a connected wallet (e.g. reports,contracts). Empty = none.')
ON CONFLICT (key) DO NOTHING;
