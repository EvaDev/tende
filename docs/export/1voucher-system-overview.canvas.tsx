import {
  Button,
  Callout,
  Card,
  CardBody,
  Code,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Spacer,
  Stack,
  Table,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type Slide = {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  body: any;
};

function FlowStep({ n, title, detail }: { n: number; title: string; detail: string }) {
  const theme = useHostTheme();
  return (
    <Row gap={12} align="start" style={{ marginBottom: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          background: theme.fill.secondary,
          color: theme.accent.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <Stack gap={2}>
        <Text weight="semibold">{title}</Text>
        <Text style={{ color: theme.text.secondary }}>{detail}</Text>
      </Stack>
    </Row>
  );
}

function LayerBox({ label, items }: { label: string; items: string[] }) {
  const theme = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.stroke.secondary}`,
        borderRadius: 8,
        padding: 12,
        background: theme.bg.elevated,
      }}
    >
      <Text weight="semibold" style={{ marginBottom: 8 }}>{label}</Text>
      <Stack gap={4}>
        {items.map(item => (
          <Text style={{ color: theme.text.secondary }}>{item}</Text>
        ))}
      </Stack>
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    id: "title",
    section: "Overview",
    title: "1Voucher — How the system works",
    subtitle: "From onboarding to value movement",
    body: (
      <Stack gap={16}>
        <Text>
          A Web2-first fintech with an onchain compliance and settlement layer.
          Consumers see a simple balance; the protocol holds claims in a Vault
          backed by treasury tokens (e.g. TTZA, TTMW).
        </Text>
        <Grid columns={3} gap={12}>
          <LayerBox label="Consumer app" items={["Passkey wallet", "Spend / save balances", "Pay, remit, redeem vouchers"]} />
          <LayerBox label="Admin console" items={["Countries & currencies", "Treasury ops", "Merchants & compliance"]} />
          <LayerBox label="Merchant console" items={["POS & products", "Accept payments", "Settle to fiat"]} />
        </Grid>
        <Callout tone="info">
          Phase 1 pilot: ZA corridor live; additional corridors (e.g. MWK / TTMW) follow the same pattern.
        </Callout>
      </Stack>
    ),
  },
  {
    id: "actors",
    section: "Overview",
    title: "Three setup paths before money moves",
    body: (
      <Table
        headers={["Actor", "What they configure", "What it unlocks"]}
        rows={[
          ["Admin", "Countries, fiat currencies, treasury tokens, corridors, KYC tiers", "Which markets exist and which onchain tokens back them"],
          ["Merchant", "Business profile, wallet, settlement preference (fiat or onchain)", "Ability to receive consumer payments"],
          ["Consumer", "Passkey, country, display name, optional GNS tag", "Personal Safe wallet + Vault balance claim"],
        ]}
      />
    ),
  },
  {
    id: "admin-setup",
    section: "Admin setup",
    title: "Admin: countries, currencies & treasury tokens",
    body: (
      <Stack gap={12}>
        <FlowStep
          n={1}
          title="Add country"
          detail="Countries table links ISO code → fiat currency (e.g. ZA → ZAR, MW → MWK). Controls KYC tiers and product availability."
        />
        <FlowStep
          n={2}
          title="Add treasury currency row"
          detail="Currencies page: type TREASURY, code TTZA/TTMW, fiat anchor (ZAR/MWK). Saves to DB only — no chain tx yet."
        />
        <FlowStep
          n={3}
          title="Deploy corridor token (explicit action)"
          detail="Deploy button creates ERC-1967 proxy + initialize(name, symbol) against shared TreasuryToken logic; registers stablecoins row; wires Vault.setCurrencyTreasuryToken(fiat, proxy)."
        />
        <FlowStep
          n={4}
          title="Configure corridors & partners"
          detail="Remittance corridors, payout partners, FX overrides — off-chain routing for cross-border exits."
        />
        <Callout tone="warning">
          Saving a currency never auto-deploys onchain. Deploy requires admin confirmation and deployer wallet gas.
        </Callout>
      </Stack>
    ),
  },
  {
    id: "consumer-reg",
    section: "Consumer onboarding",
    title: "Consumer registration → live wallet",
    body: (
      <Stack gap={12}>
        <FlowStep n={1} title="Passkey created on device" detail="WebAuthn P-256 key — no seed phrase." />
        <FlowStep n={2} title="Backend resolves Safe signer" detail="SafeWebAuthnSignerFactory → deterministic signer address from pubKeyX/Y." />
        <FlowStep n={3} title="Consumer.registerConsumer onchain" detail="Deploys Safe proxy (threshold 1); stores country hash, name hash, KYC level 0 in Consumer contract." />
        <FlowStep n={4} title="Off-chain profile (best-effort)" detail="idOS credential, GNS subdomain (.gwei), Pimlico paymaster whitelist — wallet + DB row are the critical path." />
        <FlowStep n={5} title="consumers row in Postgres" detail="Links wallet, country, KYC, registration step for retries." />
        <Text style={{ marginTop: 4 }}>
          Result: consumer has a gasless-capable Safe address registered onchain. Balance is still zero until cash-in.
        </Text>
      </Stack>
    ),
  },
  {
    id: "merchant-reg",
    section: "Merchant onboarding",
    title: "Merchant registration → can receive payments",
    body: (
      <Stack gap={12}>
        <FlowStep n={1} title="Wallet signs nonce" detail="POST /api/merchants/register — proves wallet ownership (SIWE-style)." />
        <FlowStep n={2} title="merchants row" detail="Name, country, settlement type (FIAT or ONCHAIN), verification PENDING." />
        <FlowStep n={3} title="Onchain whitelist (best-effort)" detail="TreasuryToken.addToWhitelist(wallet) for local TT; Vault.setTrustedCounterparty(wallet) for ledger payments." />
        <FlowStep n={4} title="Admin verification" detail="Admin approves KYB → merchant goes live; can add products and use POS." />
        <Callout tone="info">
          Trusted merchants bypass consumer-to-consumer country matching — consumers can pay them without P2P restrictions.
        </Callout>
      </Stack>
    ),
  },
  {
    id: "value-model",
    section: "Value model",
    title: "What consumers actually hold",
    body: (
      <Stack gap={16}>
        <Text>
          Consumers see one fungible balance (e.g. R500). They never hold TTZA/TTMW ERC-20 in their wallet.
        </Text>
        <Grid columns={2} gap={12}>
          <LayerBox
            label="Spend balance (ZAR claim)"
            items={[
              "Vault ledger entry — ERC-4626-style shares pinned 1:1",
              "Backed by TTZA (or corridor TT) sitting in the Vault",
              "Flat 1:1 — no yield to consumer",
            ]}
          />
          <LayerBox
            label="Treasury token (TTZA, TTMW…)"
            items={[
              "Protocol bank-cash token — permissioned ERC-20",
              "Mint on fiat-in; swept (not auto-burned) on merchant settlement",
              "Closed-loop, domestic-only transfers",
            ]}
          />
        </Grid>
        <Text style={{ color: "inherit" }}>
          Accounting: TT in vault ≈ sum of all ZAR claims + unallocated pool. USD save balance is separate (USDC reserve).
        </Text>
      </Stack>
    ),
  },
  {
    id: "cash-in",
    section: "Value flows",
    title: "Cash-in: how value enters the system",
    body: (
      <Stack gap={12}>
        <Text>After registration, a consumer needs a funded Vault claim before they can pay anyone.</Text>
        <FlowStep n={1} title="Off-chain fiat or voucher" detail="Bank deposit reference or voucher number — unique in deposit_references." />
        <FlowStep n={2} title="Mint treasury token → Vault" detail="Backend (MINTER_ROLE) mints TTZA/TTMW to Vault contract address." />
        <FlowStep n={3} title="Credit consumer claim" detail="Vault.adminCredit(wallet, amount, ZAR) — consumer sees balance in app." />
        <FlowStep n={4} title="Audit trail" detail="deposit_references stores mint_tx + credit_tx; indexer picks up chain events." />
        <Callout tone="info">
          POC: Admin Treasury → dev-credit simulates this on Sepolia. Production gates mint on reconciled bank deposit.
        </Callout>
      </Stack>
    ),
  },
  {
    id: "spend-flows",
    section: "Value flows",
    title: "After cash-in: how value moves",
    body: (
      <Table
        headers={["Flow", "Mechanism", "Onchain effect"]}
        rows={[
          ["Pay merchant", "Consumer signs Vault.transfer → backend relays", "Ledger debit/credit; merchant accumulates ZAR claim"],
          ["P2P transfer", "Passkey-signed Vault.transfer (same country)", "Claim moves wallet → wallet; TT stays in Vault"],
          ["WhatsApp escrow", "Transfer to custodial escrow + claim link", "Held until recipient onboarded; release or 7-day reclaim"],
          ["ZAR ↔ USD convert", "adminDebit + adminCredit at FX − spread", "Reallocates claims; may mint TT if unallocated pool short"],
          ["Remittance (Phase 1)", "Lock → partner payout → settle", "Burn/sweep TT, debit claim, compliance log"],
          ["Merchant settlement", "Admin approves → debit merchant claim", "TT swept to platform treasury; operator pays bank off-chain"],
        ]}
      />
    ),
  },
  {
    id: "onchain",
    section: "Technology",
    title: "Onchain architecture",
    body: (
      <Stack gap={16}>
        <Grid columns={3} gap={12}>
          <LayerBox label="Consumer.sol" items={["Safe wallet factory", "Identity + KYC registry", "Compliance event log"]} />
          <LayerBox label="Vault.sol" items={["Unified balance ledger", "Remittance + FX paths", "ERC-4626 reserve semantics"]} />
          <LayerBox label="TreasuryToken.sol" items={["Shared logic (one impl)", "Compliance in _update hook", "Mint/burn/freeze/whitelist"]} />
        </Grid>
        <Text>
          Each corridor (TTZA, TTMW…) is a separate <strong>ERC-1967 proxy instance</strong> — same logic, different
          initialize(name, symbol). Registered in <Code>stablecoins</Code>, not contract_deployments.
        </Text>
        <Table
          headers={["Pattern", "Detail"]}
          rows={[
            ["Upgrade model", "UUPS proxies — stable addresses, swappable implementations"],
            ["Consumer wallets", "Safe v1.4.1 + WebAuthn signer; ERC-4337 paymaster planned"],
            ["Two platform wallets", "Deployer (cold admin + treasury) vs Backend (hot ops + gas)"],
          ]}
        />
      </Stack>
    ),
  },
  {
    id: "database",
    section: "Technology",
    title: "Database (PostgreSQL)",
    body: (
      <Grid columns={2} gap={12}>
        <LayerBox
          label="System config"
          items={["countries, currencies, stablecoins", "kyc_levels, corridors, payout_partners", "contract_deployments (3 core contracts)"]}
        />
        <LayerBox
          label="Identity & commerce"
          items={["consumers, webauthn_credentials", "merchants, products, merchant_sales", "merchant_settlement_config, settlement_requests"]}
        />
        <LayerBox
          label="Money movement audit"
          items={["deposit_references (cash-in backing)", "consumer_conversions (FX history)", "spend_vouchers, pending_claims (escrow)"]}
        />
        <LayerBox
          label="Chain mirror"
          items={["chain_events + indexer_cursor", "protocol_gas_costs", "app_config (branding, public pages)"]}
        />
      </Grid>
    ),
  },
  {
    id: "api",
    section: "Technology",
    title: "API layer (Node.js REST)",
    body: (
      <Stack gap={16}>
        <Grid columns={2} gap={12}>
          <LayerBox
            label="/api — public & authenticated"
            items={[
              "/register, /auth/passkey/* — onboarding",
              "/consumer/* — balance, convert, transfer",
              "/merchants/* — signup, POS, products",
              "/countries, /currencies, /fx/rate",
            ]}
          />
          <LayerBox
            label="/api/admin — operator"
            items={[
              "Treasury dev-credit, harvest, stats",
              "CRUD countries, currencies, merchants",
              "Reports: revenue, events, settlements",
              "contract-deployments, treasury-instances",
            ]}
          />
        </Grid>
        <Text>
          Backend orchestrates multi-step flows; contracts enforce compliance gates. JWT roles (admin / merchant / consumer)
          control UI access — separate from onchain AccessControl roles.
        </Text>
      </Stack>
    ),
  },
  {
    id: "end-to-end",
    section: "Summary",
    title: "End-to-end: setup → funded → payment",
    body: (
      <Stack gap={12}>
        <FlowStep n={1} title="Admin enables ZA + TTZA" detail="Country, currency, deploy proxy, wire Vault." />
        <FlowStep n={2} title="Merchant registers + admin verifies" detail="Whitelisted on TT + Vault trusted." />
        <FlowStep n={3} title="Consumer registers" detail="Safe deployed, KYC level 0, zero balance." />
        <FlowStep n={4} title="Cash-in" detail="Fiat/voucher → mint TT to Vault → credit ZAR claim." />
        <FlowStep n={5} title="Consumer pays merchant" detail="Signed Vault.transfer; merchant ZAR claim increases." />
        <FlowStep n={6} title="Merchant settles (optional)" detail="Claim debited, TT swept to platform; bank payout off-chain." />
        <Callout tone="success">
          Smart contracts = compliance ledger + settlement. Backend = orchestration, KYC, partners, and UX.
        </Callout>
      </Stack>
    ),
  },
];

export default function OneVoucherSystemOverview() {
  const theme = useHostTheme();
  const [index, setIndex] = useCanvasState("slide-index", 0);
  const slide = SLIDES[index];
  const total = SLIDES.length;

  return (
    <Stack gap={16} style={{ minHeight: "100%", padding: 4 }}>
      <Row align="center" gap={8}>
        <Pill tone="info">{slide.section}</Pill>
        <Spacer />
        <Text style={{ color: theme.text.tertiary }}>
          Slide {index + 1} / {total}
        </Text>
      </Row>

      <Card>
        <CardBody>
          <Stack gap={12}>
            <H1>{slide.title}</H1>
            {slide.subtitle ? <Text style={{ color: theme.text.secondary }}>{slide.subtitle}</Text> : null}
            <Divider />
            {slide.body}
          </Stack>
        </CardBody>
      </Card>

      <Divider />

      <Row gap={8} align="center" wrap>
        <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))}>
          Previous
        </Button>
        <Button variant="secondary" disabled={index >= total - 1} onClick={() => setIndex(i => Math.min(total - 1, i + 1))}>
          Next
        </Button>
        <Spacer />
        <Row gap={6} wrap>
          {SLIDES.map((s, i) => (
            <Button
              variant={i === index ? "primary" : "ghost"}
              onClick={() => setIndex(i)}
              style={{ minWidth: 32, padding: "4px 8px" }}
            >
              {i + 1}
            </Button>
          ))}
        </Row>
      </Row>

      <Text style={{ color: theme.text.quaternary, fontSize: 12 }}>
        Source: 1Voucher codebase & admin docs · Sepolia pilot · July 2026
      </Text>
    </Stack>
  );
}
