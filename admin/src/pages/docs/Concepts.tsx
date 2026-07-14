import { useAppName } from '@/hooks/useAppConfig';
import { Section, Table, Code } from './_shared';

export default function Concepts() {
  const appName = useAppName();
  return (
    <>
      <Section title="The value model — “a rand is a rand”">
        <p className="text-sm text-gray-700 leading-relaxed">
          Consumers see <strong>one fungible currency balance</strong> (e.g. a ZAR balance) and never
          encounter blockchain concepts. Under the hood that balance is a <em>claim</em> on a reserve
          the protocol holds — the same shares/reserve idea as ERC-4626 (below). The reserve can be
          made of more than one backing asset, but the consumer never sees that — they hold the balance
          as Vault-ledger shares, never the token itself.
        </p>
        <Table
          head={['', 'Spend token (e.g. TTZA)', 'Tradeable ZAR (ZARP, ZARU…)']}
          rows={[
            ['Represents', 'Protocol bank cash — fully ZAR-fiat-reserved', 'Third-party market stablecoins'],
            ['Nature', 'Closed-loop, non-tradeable (our own e-money)', 'Open, composable ERC-20 (Aave, Uniswap)'],
            ['Crossing in/out', 'Mint = fiat in; burn = fiat out (settlement)', 'Acquired by converting cash → tradeable ("cash leaves the ecosystem")'],
            ['Yield', 'None on-chain', 'Yield-bearing — the only source of harvest yield'],
          ]}
        />
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Consumer spend balance is flat 1:1 and earns no yield.</span> Any vault yield accrues to the <strong>protocol</strong>, not the consumer — so the spend balance never appreciates and stays a true rand.</li>
          <li><span className="font-semibold text-gray-900">Backing is a protocol property, not per-consumer.</span> Which asset funds a given fiat settlement or DeFi swap is a treasury decision made at the edges (on-ramp / settlement / conversion) — never on a transfer.</li>
          <li><span className="font-semibold text-gray-900">Phase 1 is TTZA-only.</span> The reserve is 100% bank cash (fully reserved, no peg/market risk). Multi-backing, DeFi and consumer-facing tradeable ZAR are designed but not yet enabled.</li>
        </ul>
      </Section>

      <Section title="FX conversion (ZAR ↔ USD)">
        <p className="text-sm text-gray-700 leading-relaxed">
          Consumers can move value between their <strong>Spend (ZAR)</strong> and <strong>Save (USD)</strong> balances
          on the home screen. These are not ERC-20 transfers to the user’s wallet — they are
          <strong> vault ledger</strong> moves: the backend calls <Code>adminDebit</Code> on one currency claim and
          <Code>adminCredit</Code> on the other. The consumer never receives TTZA or USDC tokens directly; they hold
          unified balance shares inside the Vault.
        </p>
        <Table
          head={['Direction', 'What happens on-chain', 'TTZA / USDC']}
          rows={[
            [
              'ZAR → USD',
              <>Debits the consumer’s ZAR claim; credits a USD (USDC-denominated) claim at live FX minus the platform spread. Gated on the vault’s <strong>USDC reserve</strong> (platform-funded).</>,
              <>No TTZA mint or burn. The debited ZAR amount becomes <strong>unallocated TTZA</strong> in the vault — TTZA that is no longer backing any user’s ZAR claim. The spread is retained as platform revenue (fee recorded in ZAR).</>,
            ],
            [
              'USD → ZAR',
              <>Debits the consumer’s USD claim; credits a ZAR claim at live FX minus the spread.</>,
              <>ZAR is credited from the vault’s <strong>unallocated TTZA pool</strong> first (TTZA already sitting in the vault from prior debits, top-ups, or platform float). TTZA is minted into the vault only if that pool is too small. The debited USDC becomes unallocated platform reserve — no ERC-20 moves off-chain.</>,
            ],
          ]}
        />
        <div className="rounded-xl border-2 border-amber-400/80 bg-amber-50 px-5 py-4 space-y-2">
          <p className="text-sm font-semibold text-amber-950">
            TTZA minting must always be funded
          </p>
          <p className="text-sm text-amber-950/90 leading-relaxed">
            Whenever the protocol mints <strong>new TTZA</strong> — most often when a consumer converts
            <strong> USD → ZAR</strong> and the vault’s unallocated TTZA pool is too small — that mint increases
            total TTZA supply. New supply is only legitimate if it is backed by real value entering the
            ecosystem. In practice that means one of two treasury actions must fund the mint:
          </p>
          <ul className="space-y-1.5 list-disc pl-5 text-sm text-amber-950/90">
            <li>
              <span className="font-semibold text-amber-950">Sale of $ (USD → ZAR conversion).</span>{' '}
              The consumer’s USDC claim is debited; that USDC becomes platform reserve in the vault.
              The ZAR credit is backed first from unallocated TTZA already in the vault; any shortfall
              is covered by a fresh TTZA mint — economically funded by the USD the consumer gave up.
            </li>
            <li>
              <span className="font-semibold text-amber-950">New fiat deposit (cash-in).</span>{' '}
              An operator records a bank deposit or voucher top-up (Treasury → dev credit / consumer
              voucher). Fiat arrives off-chain; TTZA is minted into the vault with a deposit reference
              and the user’s ZAR claim is credited. This is how net-new ZAR enters the system without
              a prior USD conversion.
            </li>
          </ul>
          <p className="text-sm text-amber-950/90 leading-relaxed">
            <span className="font-semibold text-amber-950">Do not mint TTZA without one of these legs.</span>{' '}
            ZAR → USD conversion does <em>not</em> mint TTZA (it frees existing TTZA into the unallocated pool).
            Merchant settlement sweeps TTZA to the platform wallet but does not mint. If unallocated TTZA
            runs dry and consumers are converting USD → ZAR faster than fiat is coming in, the operator must
            either pre-fund via a bank deposit or ensure the USDC reserve from conversions is sufficient
            to honour the 1:1 ZAR backing rule.
          </p>
        </div>
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Settlement is different.</span> When a merchant settles to fiat, the backend debits their ZAR claim and <strong>transfers TTZA to the platform wallet</strong> — it is swept, not burned. Consumer FX conversion does not sweep TTZA to the platform; it reallocates ledger claims inside the vault.</li>
          <li><span className="font-semibold text-gray-900">Accounting identity.</span> TTZA in the vault should equal the sum of all on-chain ZAR claims (consumers + merchants) plus unallocated TTZA. USD claims are backed by USDC in the vault reserve, separate from TTZA.</li>
          <li><span className="font-semibold text-gray-900">Phase 1 limitation.</span> Debit and credit are two separate admin transactions (not yet an atomic <Code>adminTransfer</Code>). Each conversion gets a unique off-chain reference (<Code>FX-…</Code>) stored in <Code>consumer_conversions</Code> for history and fee reporting.</li>
          <li><span className="font-semibold text-gray-900">Merchant settlement burn.</span> When a merchant settles to fiat, the platform operator executes the approved request from <strong>Treasury → Merchant settlements</strong> (or Reports → Settlements). That debits the merchant’s ZAR claim and sweeps TTZA to the platform treasury wallet — shown as <strong>Platform R…</strong> on the dashboard. The TTZA is <em>not</em> burned automatically: after you pay the merchant’s bank, you burn the swept TTZA manually (on-chain <Code>burn</Code> — a dedicated admin burn action is planned; today it is operator-initiated outside the app if needed).</li>
        </ul>
      </Section>

      <Section title="The platform owner">
        <p className="text-sm text-gray-700 leading-relaxed">
          The <strong>platform owner</strong> is the single business that operates {appName}, through
          <strong> two Ethereum accounts</strong> (plain EOAs, set in <Code>.env</Code>). Keeping them
          separate is deliberate: one is a rarely-used governance key, the other an always-on
          operational key, so a hot-wallet compromise can’t hand over ownership.
        </p>
        <Table
          head={['Wallet (.env)', 'What it is', 'Holds / does']}
          rows={[
            [
              <><Code>DEPLOYER_ADMIN_ADDRESS</Code><br/><span className="text-xs text-gray-500">owner / governance key</span></>,
              'Deploys and owns the contracts. Cold, used rarely.',
              <>Holds <Code>DEFAULT_ADMIN_ROLE</Code> on all three contracts; authorises upgrades, pauses, grants roles. Is the <strong>platform treasury</strong> (trusted counterparty) and <strong>receives all on-chain protocol revenue</strong> — harvested vault yield, settlement sweeps, and the token leg of realized fees.</>,
            ],
            [
              <><Code>BACKEND_SIGNER_ADDRESS</Code><br/><span className="text-xs text-gray-500">operational / hot key</span></>,
              'The wallet the server signs day-to-day transactions with.',
              <>Holds the operational roles (<Code>MINTER</Code>, <Code>ADMIN_EXECUTOR</Code>, <Code>COMPLIANCE</Code>, <Code>REGISTRAR</Code>, <Code>KYC_UPDATER</Code>, <Code>RECORDER</Code>). Mints, settles, updates KYC, harvests, whitelists merchants. Pays gas and <strong>tops up the Pimlico paymaster</strong>.</>,
            ],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Revenue:</span> all protocol revenue accrues to
          the platform business and is received on-chain at{' '}
          <Code>DEPLOYER_ADMIN_ADDRESS</Code> (or <Code>PLATFORM_TREASURY_ADDRESS</Code> if overridden) —
          the same wallet as the platform treasury. That includes harvested vault yield (swept as real
          tokens on <Code>harvest()</Code>), FX conversion spread (retained in the vault until realized),
          and merchant settlement fees / swept TTZA, and consumer external-withdrawal fees retained as
          USDC claims. The backend signer never receives revenue; it only
          pays gas. <span className="font-semibold text-gray-900">Gas:</span> in Phase 1 the backend
          signer relays transactions and pays ETH gas; Pimlico AA sponsorship is not live yet.
        </p>
      </Section>

      <Section title="Two kinds of roles (don’t confuse them)">
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Contract roles</span> live on-chain (OpenZeppelin AccessControl) — which wallet may call privileged functions. Held by the owner’s two wallets. See the <strong>Contracts</strong> tab.</li>
          <li><span className="font-semibold text-gray-900">UI / app roles</span> (<Code>admin</Code>/<Code>merchant</Code>/<Code>consumer</Code>) live in the backend (JWT + DB) — what a person sees and can do. They grant no on-chain power by themselves.</li>
        </ul>
        <p className="text-sm text-gray-700 leading-relaxed">
          A person with the <Code>admin</Code> UI role cannot mint tokens — only the wallet holding
          <Code>MINTER_ROLE</Code> can.
        </p>
      </Section>

      <Section title="Standards &amp; libraries (ERCs / EIPs)">
        <h4 className="font-semibold text-gray-900">OpenZeppelin (Upgradeable)</h4>
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">AccessControlUpgradeable</span> — the role engine; every contract role is guarded with <Code>onlyRole(...)</Code>, and <Code>DEFAULT_ADMIN_ROLE</Code> grants/revokes all others.</li>
          <li><span className="font-semibold text-gray-900">UUPSUpgradeable</span> — proxy upgrades, authorised by <Code>_authorizeUpgrade</Code> (gated to <Code>DEFAULT_ADMIN_ROLE</Code>); storage is append-only.</li>
          <li><span className="font-semibold text-gray-900">Initializable</span> — proxy init via <Code>initialize(...)</Code> (no constructors). <span className="font-semibold text-gray-900">PausableUpgradeable</span> — global stop switch (Vault &amp; TreasuryToken). <span className="font-semibold text-gray-900">ERC20Upgradeable</span> — TreasuryToken base (compliance in <Code>_update</Code>). <span className="font-semibold text-gray-900">ReentrancyGuardTransient</span> (EIP-1153) &amp; <span className="font-semibold text-gray-900">SafeERC20</span>.</li>
        </ul>

        <h4 className="font-semibold text-gray-900">ERC-4626 — Tokenised vault (shares / reserve)</h4>
        <p className="text-sm text-gray-700 leading-relaxed">
          The Vault’s unified balance uses ERC-4626 semantics: a consumer holds <em>shares</em>
          (a claim), and the contract tracks <Code>totalAssets</Code> (the reserve). Yield would
          normally lift every holder’s share price — but for the <strong>spend-cash</strong> currency
          we deliberately pin price-per-share to 1.0 and route all yield to the protocol, so the
          consumer balance stays a flat 1:1 rand. The yield-bearing share behaviour is reserved for a
          savings layer, for example a USD balance.
        </p>

        <h4 className="font-semibold text-gray-900">ERC-4337 — Account Abstraction</h4>
        <p className="text-sm text-gray-700 leading-relaxed">
          Consumer wallets are <strong>Safe smart accounts</strong> signed by a device passkey
          (P-256 / WebAuthn); a <strong>Pimlico</strong> bundler + paymaster sponsors gas. The platform owner’s
          two wallets are ordinary EOAs, not smart accounts.
        </p>

        <h4 className="font-semibold text-gray-900">GNS — Gwei Name Service</h4>
        <p className="text-sm text-gray-700 leading-relaxed">
          Payment tags are free subdomains under <Code>imali.gwei</Code> on{' '}
          <a href="https://gwei.domains/" target="_blank" rel="noopener noreferrer" className="text-brand-accent underline">gwei.domains</a>
          {' '}(e.g. <Code>se1.imali.gwei</Code>). The on-chain consumer registry stores a hash of the tag for privacy; plaintext resolution is off-chain via GNS. Payment tags use <Code>.gwei</Code> (GNS), not classic <Code>.eth</Code> names.
        </p>

        <h4 className="font-semibold text-gray-900">EIP-4361 — Sign-In with Ethereum</h4>
        <p className="text-sm text-gray-700 leading-relaxed">
          We follow the <em>spirit</em> of SIWE — server issues a one-time nonce, wallet signs
          (<Code>personal_sign</Code>), server recovers the address and issues a 48-hour JWT
          (single-use nonce, 5-min TTL). We don’t emit the full SIWE fields (domain/URI/chain-id) yet.
        </p>

        <h4 className="font-semibold text-gray-900">ERC-3643 (T-REX) — borrowed, not adopted wholesale</h4>
        <p className="text-sm text-gray-700 leading-relaxed">
          We took its core idea — compliance enforced in the transfer hook — without the heavy
          on-chain ONCHAINID/registry stack (identity stays off-chain). See the <strong>Contracts</strong>
          tab for how whitelist/KYC, freeze, forced-transfer and recovery map onto our contracts.
        </p>
      </Section>
    </>
  );
}
