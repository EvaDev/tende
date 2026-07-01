import { Section, Table, Code } from './_shared';

// Auth badges
const Pub = () => <span className="text-xs font-medium text-gray-500">Public</span>;
const Jwt = () => <span className="text-xs font-medium text-brand-accent">Consumer JWT</span>;
const Adm = () => <span className="text-xs font-semibold text-brand-accent">Admin</span>;
const Sig = () => <span className="text-xs font-medium text-gray-600">Signed nonce</span>;
const Op  = () => <span className="text-xs font-medium text-brand-danger">Open · UI-gated</span>;

export default function Api() {
  return (
    <>
      <Section title="API overview">
        <p className="text-sm text-gray-700 leading-relaxed">
          A REST/JSON API served by the Node backend. Base path <Code>/api</Code> (the apps proxy to it
          in dev). Auth tiers: <Pub /> no auth · <Jwt /> consumer bearer token (passkey/SIWE login) ·
          <Adm /> admin bearer token (<Code>requireAdmin</Code>) · <Sig /> one-time signed nonce ·
          <Op /> no backend auth yet, gated only in the UI (see hardening note).
        </p>
      </Section>

      <Section title="Auth & registration">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/auth/role?wallet</Code>, <Pub />, 'Role probe → admin | merchant | none (no signature)'],
          [<Code>GET /api/auth/nonce?wallet</Code>, <Pub />, 'Issue a one-time SIWE nonce'],
          [<Code>POST /api/auth/login</Code>, <Pub />, 'Verify signed nonce → 48h JWT'],
          [<Code>GET /api/auth/passkey/register-options</Code>, <Pub />, 'WebAuthn registration challenge'],
          [<Code>POST /api/auth/passkey/login-options</Code>, <Pub />, 'WebAuthn login challenge (usernameless)'],
          [<Code>POST /api/auth/passkey/login</Code>, <Pub />, 'Verify assertion → consumer JWT'],
          [<Code>POST /api/register</Code>, <Pub />, 'New consumer: deploy Safe, idOS profile+credential, ENS, Pimlico'],
          [<Code>POST /api/register/check-ens</Code>, <Pub />, 'ENS subdomain availability'],
          [<Code>POST /api/register/recover</Code>, <Pub />, 'Recover wallet after lost passkey (idOS-verified)'],
        ]} />
      </Section>

      <Section title="Consumer (wallet holder)">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/consumer/me</Code>, <Jwt />, 'Profile, KYC level, feature gates'],
          [<Code>GET /api/consumer/balance</Code>, <Jwt />, 'Live on-chain token balances'],
          [<Code>GET /api/consumer/transactions</Code>, <Jwt />, 'Indexed + enriched history (top-up source, conversion rate/fee)'],
          [<Code>GET /api/consumer/kyc</Code>, <Jwt />, 'KYC level + spending limits'],
          [<Code>POST /api/consumer/convert</Code>, <Jwt />, 'ZAR → USD on-ramp at live FX − platform spread (custodial ledger move; records fee)'],
          [<Code>POST /api/consumer/redeem-voucher</Code>, <Jwt />, 'Redeem a spend voucher against the holder’s claim'],
          [<Code>POST /api/consumer/transfer/prepare</Code>, <Jwt />, 'Build a user-signed Vault.transfer (returns hash to sign)'],
          [<Code>POST /api/consumer/transfer/submit</Code>, <Jwt />, 'Relay the signed transfer (gasless)'],
          [<Code>POST /api/consumer/transfer/escrow/prepare</Code>, <Jwt />, 'Build a send-to-escrow (WhatsApp) transfer'],
          [<Code>POST /api/consumer/transfer/escrow/submit</Code>, <Jwt />, 'Relay + mint claim → returns wa.me link'],
        ]} />
      </Section>

      <Section title="Escrow claims">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/claim/:secret</Code>, <Pub />, 'Claim summary for the recipient landing page'],
          [<Code>POST /api/claim/:secret/redeem</Code>, <Jwt />, 'Release escrow → recipient (phone-bound)'],
          [<Code>POST /api/admin/claims/reclaim-expired</Code>, <Adm />, 'Sweep expired claims back to senders (cron target)'],
        ]} />
      </Section>

      <Section title="Merchants & products">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>POST /api/merchants/register</Code>, <Sig />, 'Self-service merchant signup (signed nonce)'],
          [<Code>GET /api/merchants, /:id</Code>, <Pub />, 'List / fetch merchants'],
          [<Code>POST /api/merchants</Code>, <Adm />, 'Admin-create a merchant'],
          [<Code>POST /api/merchants/:id/whitelist</Code>, <Adm />, 'On-chain whitelist (TreasuryToken + Vault trusted)'],
          [<Code>POST·DELETE /api/merchants/:id/accepted-currencies</Code>, <Adm />, 'Manage accepted currencies'],
          [<Code>PATCH /api/merchants/:id, /:id/verification</Code>, <Adm />, 'Update / verify merchant'],
          [<Code>POST·PATCH /api/merchants/:id/offramp</Code>, <Adm />, 'Settlement (off-ramp) config'],
          [<Code>GET /api/products, /:id</Code>, <Pub />, 'List / fetch products'],
          [<Code>POST·PATCH /api/products, /:id/skus</Code>, <Adm />, 'Create / update products & SKUs'],
        ]} />
      </Section>

      <Section title="Merchant self-service (own account)">
        <p className="text-sm text-gray-700 leading-relaxed">
          Routes a connected merchant uses to manage their <strong>own</strong> business — the JWT (issued
          to the merchant’s wallet at sign-in) scopes every call to that wallet’s merchant record, so no
          merchant can read or edit another. Powers the admin console’s <Code>My Business</Code>,
          <Code>My Products</Code> and <Code>Point of Sale</Code> pages.
        </p>
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/merchants/me</Code>, <Jwt />, 'Own merchant profile (name, contact, status, currency)'],
          [<Code>PATCH /api/merchants/me</Code>, <Jwt />, 'Edit own name / contact / details (not status — admin-only)'],
          [<Code>GET /api/merchants/me/logo</Code>, <Jwt />, 'Own logo image'],
          [<Code>PUT /api/merchants/me/logo</Code>, <Jwt />, 'Upload / replace own logo'],
          [<Code>GET /api/merchants/me/products</Code>, <Jwt />, 'Own catalog (all, incl. inactive) — POS filters active'],
          [<Code>POST /api/merchants/me/products</Code>, <Jwt />, 'Add a product: name + unit price (Rand → stored in cents)'],
          [<Code>PATCH /api/merchants/me/products/:id</Code>, <Jwt />, 'Edit own product: name / unit price / active (ownership-scoped)'],
        ]} />
      </Section>

      <Section title="Reference & config (public reads)">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/countries, /currencies, /currency-types</Code>, <Pub />, 'Reference data'],
          [<Code>GET /api/corridors, /:receive/partners</Code>, <Pub />, 'Corridors & payout partners'],
          [<Code>GET /api/kyc-options, /assets</Code>, <Pub />, 'KYC option lists; DEX-priced asset list'],
          [<Code>GET /api/fx/rate?from&to</Code>, <Pub />, 'Live FX rate (external provider)'],
          [<Code>GET /api/config, /config/all, /config/registration-fields</Code>, <Pub />, 'Brand / app config'],
          [<Code>PATCH /api/config/:key</Code>, <Adm />, 'Update a config value'],
        ]} />
      </Section>

      <Section title="Admin & reporting">
        <p className="text-sm text-gray-700 leading-relaxed">Mounted at <Code>/api/admin</Code>.</p>
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/admin/harvestable, POST /harvest</Code>, <Adm />, 'Vault yield harvesting'],
          [<Code>GET /api/admin/contract-deployments</Code>, <Adm />, 'Deployed impls + on-chain versions'],
          [<Code>GET·POST·PATCH /api/admin/assets, /asset-metadata</Code>, <Adm />, 'Tradeable-asset registry'],
          [<Code>POST /api/admin/treasury/dev-credit</Code>, <Adm />, 'POC cash-in (disabled in production)'],
          [<Code>POST /api/admin/treasury/buy-usdc</Code>, <Adm />, 'Simulate a USDC reserve purchase — mints mock USDC into the Vault (USD layer)'],
          [<Code>GET /api/admin/treasury, /paymaster</Code>, <Adm />, 'Vault supply / paymaster balance (admin-only pages)'],
          [<Code>PATCH /api/admin/merchants/:id/status</Code>, <Adm />, 'Set a merchant’s verification status only (admins cannot edit name/logo)'],
          [<Code>GET /api/admin/escrow</Code>, <Adm />, 'All outstanding WhatsApp-escrow holds (platform-wallet exposure)'],
          [<Code>GET /api/admin/stats</Code>, <Pub />, 'Dashboard counts (feeds the public dashboard)'],
          [<Code>GET (Public) · POST·PATCH (Admin) /api/admin/countries, /currencies, /kyc-levels, /merchants, /products, /consumers</Code>, <Adm />, 'CRUD mirrors — reads public, writes admin (duplicate of system/merchants)'],
          [<Code>GET (Public) · writes (Admin) /api/admin/icons, /logos; /registration-fields (Admin)</Code>, <Adm />, 'Icon/logo/registration-field config'],
          [<Code>GET /api/admin/reports/summary, /events, /transfers, /revenue</Code>, <Adm />, 'Indexed-event reporting'],
          [<Code>GET /api/admin/reports/conversion-fees</Code>, <Adm />, 'FX-spread revenue from ZAR→USD conversions (by currency)'],
          [<Code>GET /api/admin/reports/treasury</Code>, <Adm />, 'Treasury / reserve position report'],
        ]} />
      </Section>

      <Section title="System & operator config">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/system/countries, /currencies, /stablecoins</Code>, <Pub />, 'Operator reference reads'],
          [<Code>POST·PATCH /api/system/countries, /currencies, /stablecoins</Code>, <Adm />, 'Operator config writes'],
          [<Code>GET /api/system/kyc-levels/:countryCode</Code>, <Pub />, 'KYC tiers for a country'],
          [<Code>POST·PATCH /api/system/kyc-levels</Code>, <Adm />, 'Manage KYC tiers'],
        ]} />
      </Section>

      <Section title="Platform & health">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /health</Code>, <Pub />, 'DB connectivity + environment'],
          [<Code>GET /idos</Code>, <Pub />, 'idOS issuer discovery — read BY idOS (inbound external)'],
          [<Code>GET /api/admin/logs, /logs/history</Code>, <Op />, 'Live SSE log feed + buffer'],
          [<Code>POST /api/client-log</Code>, <Pub />, 'Client error ingest from the apps'],
        ]} />
      </Section>

      <Section title="External integrations">
        <p className="text-sm text-gray-700 leading-relaxed">
          Services the backend talks to (outbound unless noted). The chain is reached via Alchemy RPC.
        </p>
        <Table head={['Service', 'Used for', 'Notes']} rows={[
          ['Alchemy RPC (Sepolia + mainnet)', 'All on-chain reads/writes & the event indexer', 'Sepolia = pilot; mainnet = ENS + DEX pricing'],
          ['idOS', 'KYC profile + W3C credential issue/verify (register, recover)', <>Plus <Code>GET /idos</Code> which idOS reads <strong>inbound</strong>; pending issuer approval</>],
          ['ENS (Ethereum mainnet)', 'Payment-tag subdomain registration & checks', 'MAINNET writes — real ETH'],
          ['Pimlico (bundler + paymaster)', 'Gas sponsorship (registration whitelist)', 'Configured but dormant — relay model used today'],
          ['FX provider (ZimRate / open.er-api)', 'Live rates for /api/fx/rate', 'Cached; admin overrides fall back'],
          ['Uniswap V3 QuoterV2 (mainnet)', 'Asset pricing for /api/assets', 'Read-only eth_call, no transaction'],
          ['WhatsApp (wa.me)', 'Escrow claim link delivery', 'Client-side deep-link — no server API (manual share)'],
        ]} />
      </Section>

      <Section title="Auth model — admin router">
        <p className="text-sm text-gray-700 leading-relaxed">
          The <Code>/api/admin</Code> router applies <Code>requireAdmin</Code> to <strong>everything by
          default</strong>, with a small allowlist of read-only endpoints that feed pages visible to
          everyone — the public dashboard counts (<Code>/stats</Code>) and reference/list reads
          (<Code>/merchants</Code>, <Code>/products</Code>, <Code>/consumers</Code>, <Code>/countries</Code>,
          <Code>/currencies</Code>, <Code>/kyc-levels</Code>, <Code>/icons</Code>, logos). All writes and
          the admin-only reads (treasury, paymaster, registration-fields) require the admin JWT. The live
          SSE log feed (<Code>/api/admin/logs</Code>, defined on the app) remains an open <Op /> stream.
        </p>
      </Section>
    </>
  );
}
