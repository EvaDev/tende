import { Section, Table, Code } from './_shared';

const Pub = () => <span className="text-xs font-medium text-gray-500">Public</span>;
const Mem = () => <span className="text-xs font-medium text-brand-accent">Member JWT</span>;
const Org = () => <span className="text-xs font-semibold text-brand-accent">Org admin</span>;

export default function Merchant() {
  return (
    <>
      <Section title="A separate app, not a separate service">
        <p className="text-sm text-gray-700 leading-relaxed">
          <Code>/merchant</Code> is its own React/Vite app (port <Code>5175</Code>, alongside consumer
          <Code>5173</Code> and this admin console <Code>5174</Code>) — but it talks to the <strong>same
          Express backend on port 3001</strong>. There is no separate merchant service or database; it's
          three new route files mounted onto the existing server (<Code>memberAuth.routes.ts</Code>,
          <Code>settlement.routes.ts</Code>, <Code>merchantSelf.routes.ts</Code>). Run all four with the
          root <Code>npm run dev</Code> (or <Code>npm run dev:merchant</Code> for just server+merchant).
        </p>
      </Section>

      <Section title="Why a separate app">
        <p className="text-sm text-gray-700 leading-relaxed">
          A merchant is a business with staff turnover and shared tills — a different trust context from
          an individual consumer. Wallet-connect (RainbowKit/MetaMask) doesn't fit day-to-day operators, so
          the merchant app has <strong>no wallet, no wagmi, no RainbowKit</strong> at all. Instead: custody
          (one corporate account, unchanged from before) is split from access (many operators, each with
          their own passkey login and a role) and from execution authority (only settlement above a
          threshold needs a second approval). See <strong>Concepts</strong> for the platform-wide value
          model this sits alongside.
        </p>
      </Section>

      <Section title="Org / member model">
        <p className="text-sm text-gray-700 leading-relaxed">
          A merchant (<Code>merchants</Code> row, unchanged) can have many <strong>operators</strong>
          (<Code>merchant_members</Code>), each scoped to that one merchant with a role:
        </p>
        <Table head={['Role', 'Can do']} rows={[
          ['cashier', 'Ring up Point of Sale, view Sales'],
          ['store_manager', 'Same as cashier (no extra grants yet — reserved for future store-scoped limits)'],
          ['org_admin (head office)', 'Everything above, plus: invite/manage the Team, edit My Business (name/logo/icon/settlement), approve settlement requests above the threshold'],
        ]} />
        <p className="text-sm text-gray-700 leading-relaxed">
          Operators sign in with a <strong>passkey</strong> (WebAuthn) — the exact same mechanism as
          consumer login, but this passkey does <em>not</em> back a Safe wallet; it's purely a login
          credential bound to a <Code>merchant_members</Code> row. First login is a "claim" ceremony: an
          org_admin invites by email/role (<Code>POST /api/member-auth/invite</Code>, returns a numeric
          Invite ID shared out-of-band — there's no invite-token/email-link system yet), the invitee opens
          the merchant app, enters that ID + their email, and creates a passkey.
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

      <Section title="Origin note for WebAuthn"><p className="text-sm text-gray-700 leading-relaxed">
          WebAuthn strictly checks the calling page's origin. <Code>config.webauthn.origins</Code>
          (<Code>WEBAUTHN_ORIGIN</Code> in <Code>.env</Code>) is now a comma-separated list so both the
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

      <Section title="API — merchant self-service (member-resolved)">
        <p className="text-sm text-gray-700 leading-relaxed">
          Mounted at <Code>/api/merchant</Code> — mirrors the older wallet-resolved
          <Code>/api/merchants/me/*</Code> (still used if a merchant wallet-connects into this admin
          console) but resolves the merchant straight from the member JWT's <Code>merchantId</Code>, no
          wallet lookup. Powers the merchant app's Point of Sale, Sales, and My Business pages.
        </p>
        <Table head={['Method · Path', 'Auth', 'Purpose']} rows={[
          [<Code>GET /api/merchant/me</Code>, <Mem />, 'Own merchant profile'],
          [<Code>PATCH /api/merchant/me</Code>, <Org />, 'Edit name / contact / address / settlement type / icon'],
          [<Code>GET /api/merchant/me/logo</Code>, <Mem />, 'Own logo image'],
          [<Code>PUT /api/merchant/me/logo</Code>, <Org />, 'Upload / replace own logo'],
          [<Code>GET /api/merchant/me/products</Code>, <Mem />, 'Own POS catalog'],
          [<Code>POST /api/merchant/me/products</Code>, <Mem />, 'Add a product (any operator — cashiers ring up new items)'],
          [<Code>GET /api/merchant/me/sales</Code>, <Mem />, 'POS sales ledger + per store/till rollup'],
        ]} />
      </Section>

      <Section title="Not yet built">
        <p className="text-sm text-gray-700 leading-relaxed">
          An invite-link/email-token flow (today the Invite ID is shared manually); a bank off-ramp for
          settlement (<Code>destination</Code> must currently be an on-chain address); store-scoped
          permission limits for <Code>store_manager</Code>/<Code>cashier</Code> (the <Code>store_scope</Code>
          column exists but isn't enforced yet).
        </p>
      </Section>
    </>
  );
}
