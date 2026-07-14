import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppName } from '@/hooks/useAppConfig';
import { useDetectedCountry, flagEmoji } from '@/hooks/useDetectedCountry';

const KEY_DECISIONS: { title: string; detail: string }[] = [
  { title: 'Non-custodial DEX model', detail: 'Consumers buy/sell from a curated list of liquid assets by swapping their own funds on Uniswap. The platform never holds assets or takes price/hedging risk — it is not a broker or dealer.' },
  { title: 'USDC is the settlement currency', detail: 'All asset swaps are quoted and settled in USDC.' },
  { title: 'Live Uniswap pricing + platform markup', detail: 'Asset prices come live from the Uniswap V3 Quoter (per-asset fee tier), plus a per-asset platform markup in basis points. No Chainlink oracle for now — added only if/when on-chain validation is needed.' },
  { title: 'Safe smart wallets + passkeys', detail: 'Consumer wallets are ERC-4337 Safe accounts whose signer is a device passkey (WebAuthn / Face ID / Touch ID). No seed phrases, no MetaMask. Gas is sponsored by Pimlico.' },
  { title: 'Decentralised identity (idOS)', detail: 'KYC credentials are issued and stored via idOS; biometric wallet recovery (FaceSign) is on the roadmap.' },
  { title: 'Payment tags via GNS', detail: 'Human-readable payment tags are free subdomains under imali.gwei on the Gwei Name Service (https://gwei.domains), hashed on-chain for privacy.' },
  { title: 'Value model: one rand balance, protocol keeps the yield', detail: 'Consumers hold a single fungible balance as Vault-ledger shares (an ERC-4626 claim) — never the treasury token directly. Behind it the protocol holds a reserve (Phase 1: 100% TTZA bank cash; later also tradeable ZAR). The spend balance is flat 1:1 and earns no yield — any vault yield accrues to the protocol. Full detail in Docs → Concepts.' },
  { title: 'User-signed P2P, self-custody', detail: 'Wallet-to-wallet sends are the user’s own passkey-signed Vault.transfer (on-chain KYC gate: both parties verified, cross-border allowed). Gasless to the consumer — the backend relays the Safe transaction and pays gas. New Safes are ERC-4337-ready, so submission can move to a Pimlico paymaster later without re-onboarding.' },
  { title: 'Cross-border spend vouchers under CASP', detail: 'Cross-border value moves as an on-chain crypto-asset transfer (CASP licence), dual-KYC, settled to the merchant in fiat. Postgres is an index of on-chain events for reporting, not a second ledger. See Docs → Events & Reporting.' },
  { title: 'Sessions: 48h JWT, no silent refresh', detail: 'Logins last 48 hours; on expiry the user re-authenticates with their passkey. No refresh tokens.' },
  { title: 'Networks', detail: 'Pilot contracts and .gwei payment tags run on Sepolia; mainnet holds the production imali.gwei name and DEX liquidity/pricing.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-brand-accent">{title}</h3>
      {children}
    </section>
  );
}

function Feature({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="text-sm text-gray-700 leading-relaxed">
      <span className="font-semibold text-gray-900">{name}:</span> {children}
    </li>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-brand-accent underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  );
}

const THIRD_PARTY: { name: string; href: string; role: string }[] = [
  { name: 'Ethereum', href: 'https://ethereumpage.com/', role: 'Settlement network for contracts, Vault balances, and remittances (Sepolia pilot; mainnet for production naming and DEX liquidity).' },
  { name: 'Safe', href: 'https://safe.global/', role: 'Smart-account wallet infrastructure — every consumer spend wallet is a Safe.' },
  { name: 'OpenZeppelin', href: 'https://www.openzeppelin.com/', role: 'Battle-tested Solidity libraries (access control, UUPS upgrades, cryptography) used by our contracts.' },
  { name: 'Gwei Name Service (GNS)', href: 'https://gwei.domains/', role: 'Human-readable payment tags as free subdomains of imali.gwei (e.g. se1.imali.gwei).' },
  { name: 'Alchemy', href: 'https://www.alchemy.com/', role: 'Ethereum RPC / node access for reading chain state and submitting relayed transactions.' },
  { name: 'RainbowKit', href: 'https://rainbowkit.com/', role: 'Wallet connection UI for admin and merchant operators (MetaMask and other injected wallets).' },
  { name: 'wagmi', href: 'https://wagmi.sh/', role: 'React hooks for Ethereum wallet state and contract reads/writes in the admin console.' },
  { name: 'ethers.js', href: 'https://ethers.org/', role: 'Signing, ABI encoding, and contract calls from the API and consumer session flows.' },
  { name: 'Pimlico', href: 'https://www.pimlico.io/', role: 'ERC-4337 bundler / paymaster path for gasless consumer transactions (when AA submission is enabled).' },
  { name: 'idOS', href: 'https://idos.network/', role: 'Decentralised identity and KYC credential storage.' },
  { name: 'Foundry', href: 'https://getfoundry.sh/', role: 'Solidity development, testing, and deployment toolchain.' },
  { name: 'Uniswap', href: 'https://uniswap.org/', role: 'On-chain DEX quotes and swaps for listed assets (USDC settlement).' },
];

export default function About() {
  const appName = useAppName();
  const { country, allowedCurrencies } = useDetectedCountry();
  const [showDecisions, setShowDecisions] = useState(false);

  return (
    <Card className="max-w-3xl space-y-8">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-bold text-brand-accent">About {appName}</h2>
          <Button size="sm" variant="outline" onClick={() => setShowDecisions(v => !v)}>
            {showDecisions ? 'Hide' : 'Key Decisions'}
          </Button>
        </div>
        <p className="text-gray-600 mt-2">
          <strong>{appName}</strong> is a cross-border remittance and payments platform. This console
          is where operators configure countries, currencies, merchants, KYC tiers and the gas
          paymaster that powers the consumer wallet.
        </p>
      </div>

      {showDecisions && (
        <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/5 p-5 space-y-3">
          <h3 className="text-lg font-semibold text-brand-accent">Key Decisions</h3>
          <ul className="space-y-2 list-disc pl-5">
            {KEY_DECISIONS.map(d => (
              <li key={d.title} className="text-sm text-gray-700 leading-relaxed">
                <span className="font-semibold text-gray-900">{d.title}:</span> {d.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title={`What is ${appName}?`}>
        <p className="text-sm text-gray-700 leading-relaxed">
          {appName} lets people hold and move money without ever touching a seed phrase, gas fee, or
          blockchain concept. Each consumer gets a smart-contract wallet secured by their device
          biometrics. Value is held as a single in-app currency balance — a claim on the protocol's
          reserve, recorded as Vault-ledger shares — plus optional USD, and remittances settle
          on-chain while the experience stays as simple as a banking app.
        </p>
      </Section>

      <Section title="Key Features">
        <ul className="space-y-2 list-disc pl-5">
          <Feature name="Account Abstraction">ERC-4337 Safe smart accounts with gasless, paymaster-sponsored transactions — users never pay or see gas.</Feature>
          <Feature name="Passkey Authentication">Passwordless, biometric login (Face ID / Touch ID / Windows Hello) via WebAuthn. The passkey is the wallet signer — no seed phrases.</Feature>
          <Feature name="Multi-Currency Balances">By default consumers get a fungible spendable local-currency balance plus a USD balance — backed by whitelisted token holdings. Other optional 'investment' tokens eg Gold follow the same whitelisting pattern; Total holding converted to local currency via live FX conversion for display purposes..</Feature>
          <Feature name="Payment Tags">Human-readable GNS subdomains (e.g. <code>se1.imali.gwei</code>) for peer-to-peer transfers, hashed on-chain for privacy.</Feature>
          <Feature name="Decentralised Identity">KYC credentials issued and stored via idOS, with biometric wallet recovery (FaceSign) on the roadmap.</Feature>
          <Feature name="Merchant Integration">Merchant onboarding, product catalogue, and point-of-sale settlement.</Feature>
          <Feature name="Transaction History">On-chain tracking of purchases, top-ups, and remittances.</Feature>
          <Feature name="Reporting">On-chain events are indexed in a RDB for all reporting purposes.</Feature>
        </ul>
      </Section>

      <Section title="Safe smart accounts">
        <p className="text-sm text-gray-700 leading-relaxed">
          <ExtLink href="https://safe.global/">Safe</ExtLink> (formerly Gnosis Safe) is the leading
          open-source smart-account infrastructure on Ethereum. Instead of a single private key
          controlling an EOA, a Safe is a smart contract wallet: owners (EOAs, passkeys, or other
          contracts) authorise transactions according to a threshold and optional modules. Assets
          sit in the Safe; logic for who can spend — and how — lives in the contract.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          In {appName}, every consumer spend wallet is a <strong>Safe</strong>. At registration we
          deploy a Safe whose owner is the user’s device passkey (WebAuthn / P-256), so there is no
          seed phrase. Day-to-day payments are either:
        </p>
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Passkey-signed Safe transactions</span> —
            the user approves with biometrics; the platform relays <code className="font-mono text-[0.85em] bg-gray-100 px-1 rounded">execTransaction</code> and pays gas.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Session-key modules</span> —
            after a one-time passkey approval, a short-lived device key can authorise Vault transfers
            through <code className="font-mono text-[0.85em] bg-gray-100 px-1 rounded">SessionTransferModule</code>, cutting per-payment gas.
          </li>
        </ul>
        <p className="text-sm text-gray-700 leading-relaxed">
          Safes are also ERC-4337-ready, so the same wallets can later submit via a Pimlico paymaster
          without re-onboarding. Learn more at{' '}
          <ExtLink href="https://safe.global/">safe.global</ExtLink>
          {' '}and the{' '}
          <ExtLink href="https://docs.safe.global/">Safe documentation</ExtLink>.
        </p>
      </Section>

      <Section title="Transfer Restrictions &amp; Compliance">
        <p className="text-sm text-gray-700 leading-relaxed">
          Compliance is enforced directly in the contracts. Consumers hold and send a balance on the
          <strong> Vault</strong> ledger (a claim — backed by treasury cash, never the token itself).
          The country-specific <strong>treasury token</strong> is internal backing and merchant
          settlement; it moves only between the Vault, platform treasury and merchants.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-brand-accent/5 text-gray-900">
              <tr>
                <th className="text-left font-semibold p-3">What moves</th>
                <th className="text-left font-semibold p-3">Cross-border?</th>
                <th className="text-left font-semibold p-3">KYC required?</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              <tr className="border-t border-gray-200">
                <td className="p-3"><span className="font-semibold">Treasury token</span> (backing / settlement)</td>
                <td className="p-3"><span className="font-semibold text-brand-accent">No</span> — country-specific, domestic only</td>
                <td className="p-3">No — moves only between the Vault, treasury &amp; merchants</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="p-3"><span className="font-semibold">Vault balance</span> (what consumers hold &amp; send)</td>
                <td className="p-3"><span className="font-semibold text-brand-accent">Yes</span> — allowed</td>
                <td className="p-3">Yes — both parties KYC'd, local <em>and</em> foreign</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="space-y-2 list-disc pl-5">
          <Feature name="Who holds a treasury token">It's held as backing in the protocol reserve, by the platform treasury, and by merchants who accept it as settlement — all on the token's trusted allow-list. Consumers don't hold the token directly; they hold a Vault-ledger claim and are verified via the Consumer registry.</Feature>
          <Feature name="Trusted settlement addresses">Platform and merchant wallets are whitelisted (by a compliance agent at onboarding) and are exempt from the same-country consumer rule, so a consumer can always pay a merchant.</Feature>
          <Feature name="Agent controls">A compliance agent can freeze a balance, and force-transfer tokens for AML clawback or to recover a lost passkey wallet. These bypass the normal gates and are logged on-chain.</Feature>
        </ul>
      </Section>

      <Section title="Technologies">
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Blockchain &amp; Contracts</h4>
            <ul className="space-y-1.5 list-disc pl-5">
              <Feature name="Ethereum">Sepolia testnet for the pilot (contracts + .gwei tags); mainnet for production naming and DEX liquidity.</Feature>
              <Feature name="Solidity">Consumer, Vault, and TreasuryToken contracts.</Feature>
              <Feature name="ERC-4337">Account abstraction via Safe smart accounts.</Feature>
              <Feature name="Pimlico">Paymaster sponsoring all consumer gas.</Feature>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Identity &amp; Auth</h4>
            <ul className="space-y-1.5 list-disc pl-5">
              <Feature name="WebAuthn">P-256 passkeys, resolved to a Safe signer on-chain.</Feature>
              <Feature name="idOS">Decentralised identity and credential issuance.</Feature>
              <Feature name="GNS">Payment tags under imali.gwei (https://gwei.domains).</Feature>
              <Feature name="JWT">Session tokens (48h, no silent refresh).</Feature>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Frontend</h4>
            <ul className="space-y-1.5 list-disc pl-5">
              <Feature name="React + Vite">Consumer app and this admin console.</Feature>
              <Feature name="wagmi / RainbowKit">Wallet connection for admin write actions.</Feature>
              <Feature name="ethers.js">Contract interaction and signing.</Feature>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Backend</h4>
            <ul className="space-y-1.5 list-disc pl-5">
              <Feature name="Node.js + Express">API orchestrating the multi-step flows.</Feature>
              <Feature name="PostgreSQL">Operator config, KYC tiers, and reference data.</Feature>
              <Feature name="Reference data">Currencies, corridors, payout partners and FX, all DB-driven.</Feature>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Third-party software">
        <p className="text-sm text-gray-700 leading-relaxed">
          {appName} is built on open infrastructure and commercial services. These are the main
          dependencies — each name links to the project’s site.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-brand-accent/5 text-gray-900">
              <tr>
                <th className="text-left font-semibold p-3 w-36">Dependency</th>
                <th className="text-left font-semibold p-3">Role in {appName}</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {THIRD_PARTY.map(d => (
                <tr key={d.name} className="border-t border-gray-200 align-top">
                  <td className="p-3 whitespace-nowrap">
                    <ExtLink href={d.href}>{d.name}</ExtLink>
                  </td>
                  <td className="p-3">{d.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Operating Region">
        <p className="text-sm text-gray-700 leading-relaxed">
          This console auto-detects its operating country from your browser locale.
          {country ? (
            <> You are operating as <span className="font-semibold">{flagEmoji(country.code)} {country.name}</span>.</>
          ) : ' Detecting…'}
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          Currency rule: a country may transact in its own currency
          {country && <> (<span className="font-mono">{country.currency_code}</span>)</>}, plus
          <span className="font-mono"> USD</span>, which is available in every country.
          {country && <> Allowed here: <span className="font-mono">{allowedCurrencies.join(', ')}</span>.</>}
        </p>
      </Section>

      <Section title="Security &amp; Privacy">
        <ul className="space-y-2 list-disc pl-5">
          <Feature name="Passkeys">Biometric authentication; private keys never leave the device secure enclave.</Feature>
          <Feature name="GNS Subdomains">Payment tags under imali.gwei are hashed on-chain — the plaintext stays off-chain.</Feature>
          <Feature name="Wallet-signed writes">Admin and merchant changes require a connected, signed wallet; reads are open.</Feature>
          <Feature name="No PII on-chain">Personal data lives in idOS and the operator database, never on-chain.</Feature>
        </ul>
      </Section>
    </Card>
  );
}
