import { Section, Table, Code } from '@/components/docs/_shared';

const Pub = () => <span className="text-xs font-medium text-gray-500">Public</span>;
const Mem = () => <span className="text-xs font-medium text-brand-accent">Member JWT</span>;
const Org = () => <span className="text-xs font-semibold text-brand-accent">Org admin</span>;

import { getAppName } from '@/lib/brand';

export default function About() {
  const appName = getAppName();
  return (
    <div className="max-w-3xl space-y-8 bg-brand-card rounded-xl p-6 shadow-sm">
      <div>
        <h1 className="text-2xl font-bold text-brand-accent">About this app</h1>
        <p className="text-sm text-gray-600 mt-1">How the {appName} Merchant app fits into the platform.</p>
      </div>

      <Section title="A separate app, not a separate service">
        <p className="text-sm text-gray-700 leading-relaxed">
          <Code>/merchant</Code> is its own React/Vite app (port <Code>5175</Code>, alongside consumer
          <Code>5173</Code> and the admin console <Code>5174</Code>) — but it talks to the <strong>same
          Express backend on port 3001</strong>. There is no separate merchant service or database; it's
          three route files mounted onto the existing server (<Code>memberAuth.routes.ts</Code>,
          <Code>settlement.routes.ts</Code>, <Code>merchantSelf.routes.ts</Code>). Run all four with the
          root <Code>npm run dev</Code> (or <Code>npm run dev:merchant</Code> for just server+merchant).
        </p>
      </Section>

      <Section title="Why a separate app">
        <p className="text-sm text-gray-700 leading-relaxed">
          A merchant is a business with staff turnover and shared tills — a different trust context from
          an individual consumer. Day-to-day operators sign in with a <strong>passkey</strong> (no wallet).
          The one exception is <strong>first-time owner registration</strong>: connect the business wallet,
          prove ownership with a signature, then create an org_admin passkey. After that, custody stays on
          the corporate wallet while operators use passkeys and roles.
        </p>
      </Section>

      <Section title="Org / member model">
        <p className="text-sm text-gray-700 leading-relaxed">
          A merchant (<Code>merchants</Code> row, unchanged) can have many <strong>operators</strong>
          (<Code>merchant_members</Code>), each scoped to that one merchant with a role:
        </p>
        <Table head={['Role', 'Can do']} rows={[
          ['cashier', 'Ring up Point of Sale, view Sales and Products (read-only)'],
          ['store_manager', 'Same as cashier (no extra grants yet — reserved for future store-scoped limits)'],
          ['org_admin (head office)', 'Everything above, plus: invite/manage the Team, edit My Business (name/logo/icon/settlement), manage the Products catalog, approve settlement requests above the threshold'],
        ]} />
        <p className="text-sm text-gray-700 leading-relaxed">
          Operators sign in with a <strong>passkey</strong> (WebAuthn) — the exact same mechanism as
          consumer login, but this passkey does <em>not</em> back a Safe wallet; it's purely a login
          credential bound to a <Code>merchant_members</Code> row. New businesses use
          <strong> Register as a merchant</strong> (wallet connect → business form → passkey). Staff join
          via invite: an org_admin invites by email/role (<Code>POST /api/member-auth/invite</Code>), the
          invitee claims with Invite ID + email and creates a passkey.
        </p>
      </Section>

      <Section title="Custody — why no new wallet was needed">
        <p className="text-sm text-gray-700 leading-relaxed">
          Two on-chain facts made this simple (<Code>Vault.sol</Code>): receiving needs no signature at
          all (a <Code>trustedCounterparty</Code> push), and <Code>withdrawToExternal</Code> — the only
          function that moves funds <em>out</em> — is already <Code>onlyRole(ADMIN_EXECUTOR_ROLE)</Code>, a
          backend-signed call with no merchant private key involved. So the merchant's existing wallet
          keeps receiving unchanged, and the "head-office approval" gate for settlement is an
          <strong> off-chain</strong> business rule the backend enforces before it calls that function — not
          a new on-chain signer, Safe, or multisig.
        </p>
      </Section>

      <Section title="Settlement threshold & approval">
        <p className="text-sm text-gray-700 leading-relaxed">
          Any operator can request a payout. At/below the org's configured threshold it executes
          immediately; above it, the request sits <Code>pending</Code> until a <strong>different</strong>
          org_admin than the requester approves it (self-approval is blocked server-side). Approval or a
          fresh request both call <Code>withdrawToExternal</Code>, resolving the fiat settlement currency
          to its pegged on-chain token via <Code>currencies.base_currency_code</Code> (e.g. ZAR → TTZA) and
          reading that token's on-chain <Code>decimals()</Code> rather than trusting the DB.
        </p>
      </Section>

      <Section title="Origin note for WebAuthn">
        <p className="text-sm text-gray-700 leading-relaxed">
          WebAuthn strictly checks the calling page's origin. <Code>config.webauthn.origins</Code>
          (<Code>WEBAUTHN_ORIGIN</Code> in <Code>.env</Code>) is a comma-separated list so both the
          consumer app (5173) and this merchant app (5175) can complete passkey ceremonies against the same
          backend — add any future app's origin to that list.
        </p>
      </Section>

      <Section title="API — member auth (no wallet)">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>POST /api/member-auth/invite</Code>, <Org />, 'Invite an operator by email/role → returns a memberId (share out-of-band)'],
          [<Code>POST /api/member-auth/claim-options</Code>, <Pub />, 'WebAuthn registration challenge for first login'],
          [<Code>POST /api/member-auth/claim</Code>, <Pub />, 'Claim an invited seat: verify passkey ceremony, set email, activate'],
          [<Code>POST /api/member-auth/login-options</Code>, <Pub />, 'WebAuthn login challenge (usernameless)'],
          [<Code>POST /api/member-auth/login</Code>, <Pub />, 'Verify assertion → member JWT'],
          [<Code>GET /api/member-auth/me</Code>, <Mem />, 'Current operator + org profile'],
          [<Code>GET /api/member-auth/members</Code>, <Org />, 'Full team roster for this org'],
        ]} />
      </Section>

      <Section title="API — settlement">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET·POST /api/settlement/config</Code>, <><Mem /> / <Org /></>, 'Read (any member) / set (org_admin) the payout threshold'],
          [<Code>GET·POST /api/settlement/requests</Code>, <Mem />, 'List requests / request a payout (auto-executes at/below threshold)'],
          [<Code>POST /api/settlement/requests/:id/approve</Code>, <Org />, 'Approve a pending request (must be a different org_admin than the requester) → executes'],
          [<Code>POST /api/settlement/requests/:id/reject</Code>, <Org />, 'Reject a pending request'],
        ]} />
      </Section>

      <Section title="Change vouchers (digital change at till)">
        <p className="text-sm text-gray-700 leading-relaxed">
          When a customer pays in store and would normally receive coins as change, a cashier can issue a
          <strong> change voucher</strong> instead — a credit to their {appName} wallet. Add a product with
          delivery type <strong>Voucher</strong> (e.g. &quot;Change Voucher&quot;) to set min/max amounts.
        </p>
        <Table head={['Step', 'Who', 'What happens']} rows={[
          ['1', 'Cashier (POS)', 'Tap Issue change voucher → enter amount → Show QR or Send to @tag'],
          ['2a', 'Customer (QR)', 'Consumer app → Receive → scan change voucher QR → Receive to wallet'],
          ['2b', 'Customer (link)', 'Cashier shares WhatsApp/deep link; customer opens Receive and confirms'],
          ['2c', 'Customer (@tag)', 'Cashier sends directly to @tag — instant credit, no scan'],
          ['3', 'On-chain', 'Backend debits merchant Vault claim, credits consumer claim (15 min QR expiry)'],
        ]} />
        <p className="text-xs text-gray-500 leading-relaxed mt-2">
          Requires the merchant to hold enough in-app balance (from prior in-app sales). History shows
          <Code>Change voucher</Code> as a transaction type on the consumer side.
        </p>
      </Section>

      <Section title="API — change vouchers">
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>POST /api/merchant/me/change-voucher/prepare</Code>, <Mem />, 'Create pending change voucher + QR payload (15 min)'],
          [<Code>POST /api/merchant/me/change-voucher/send</Code>, <Mem />, 'Send change immediately to a consumer @tag'],
          [<Code>GET /api/change-voucher/:secret</Code>, <Pub />, 'Public summary for Receive landing / deep link'],
          [<Code>POST /api/change-voucher/:secret/redeem</Code>, <span className="text-xs text-gray-600">Consumer JWT</span>, 'Claim QR/link change voucher into wallet'],
        ]} />
      </Section>

      <Section title="API — merchant self-service (member-resolved)">
        <p className="text-sm text-gray-700 leading-relaxed">
          Mounted at <Code>/api/merchant</Code> — resolves the merchant from the member JWT's
          <Code>merchantId</Code>, no wallet lookup. Powers Point of Sale, Sales, Products, and My Business.
        </p>
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/merchant/me</Code>, <Mem />, 'Own merchant profile'],
          [<Code>PATCH /api/merchant/me</Code>, <Org />, 'Edit name / contact / address / settlement type / icon'],
          [<Code>GET /api/merchant/me/logo</Code>, <Mem />, 'Own logo image'],
          [<Code>PUT /api/merchant/me/logo</Code>, <Org />, 'Upload / replace own logo'],
          [<Code>GET /api/merchant/me/products</Code>, <Mem />, 'Own POS catalog (all products)'],
          [<Code>GET /api/merchant/me/products/corridors</Code>, <Org />, 'Country + currency options from stores'],
          [<Code>POST /api/merchant/me/products</Code>, <Org />, 'Add a product (currencyCode from store corridors)'],
          [<Code>PATCH /api/merchant/me/products/:id</Code>, <Org />, 'Edit or deactivate a product'],
          [<Code>GET /api/merchant/me/stores</Code>, <Mem />, 'List active stores (scoped for cashiers)'],
          [<Code>POST /api/merchant/me/stores</Code>, <Org />, 'Add store (country → fiat)'],
          [<Code>PATCH /api/merchant/me/stores/:id</Code>, <Org />, 'Rename / change country / deactivate store'],
          [<Code>GET /api/merchant/me/sales</Code>, <Mem />, 'POS sales ledger + per store/till rollup'],
          [<Code>POST /api/merchant/me/change-voucher/prepare</Code>, <Mem />, 'Issue change voucher QR'],
          [<Code>POST /api/merchant/me/change-voucher/send</Code>, <Mem />, 'Send change voucher to @tag'],
        ]} />
      </Section>

      <Section title="Not yet built">
        <p className="text-sm text-gray-700 leading-relaxed">
          An invite-link/email-token flow (today the Invite ID is shared manually); a bank off-ramp for
          settlement (<Code>destination</Code> must currently be an on-chain address); per-store product
          catalogs (products are filtered by currency at POS today).
        </p>
      </Section>
    </div>
  );
}
