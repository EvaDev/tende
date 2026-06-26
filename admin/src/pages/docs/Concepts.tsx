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
              <>Holds <Code>DEFAULT_ADMIN_ROLE</Code> on all three contracts; authorises upgrades, pauses, grants roles. Is the <strong>platform treasury</strong> (trusted counterparty) and <strong>receives the protocol’s vault yield</strong>.</>,
            ],
            [
              <><Code>BACKEND_SIGNER_ADDRESS</Code><br/><span className="text-xs text-gray-500">operational / hot key</span></>,
              'The wallet the server signs day-to-day transactions with.',
              <>Holds the operational roles (<Code>MINTER</Code>, <Code>ADMIN_EXECUTOR</Code>, <Code>COMPLIANCE</Code>, <Code>REGISTRAR</Code>, <Code>KYC_UPDATER</Code>, <Code>RECORDER</Code>). Mints, settles, updates KYC, harvests, whitelists merchants. Pays gas and <strong>tops up the Pimlico paymaster</strong>.</>,
            ],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Revenue:</span> the platform markup on asset
          swaps, plus the protocol’s share of vault yield. <span className="font-semibold text-gray-900">Gas:</span> consumers
          never pay — a Pimlico paymaster sponsors them, funded by the owner; if it runs dry, sponsorship stops.
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
          (P-256 / WebAuthn); a <strong>Pimlico</strong> bundler + paymaster sponsors gas. The owner’s
          two wallets are ordinary EOAs, not smart accounts.
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
