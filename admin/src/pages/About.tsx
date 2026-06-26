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
  { title: 'Payment tags via ENS', detail: 'Human-readable payment tags are ENS subdomains, hashed on-chain for privacy.' },
  { title: 'Value model: one rand balance, protocol keeps the yield', detail: 'Consumers hold a single fungible balance as Vault-ledger shares (an ERC-4626 claim) — never the treasury token directly. Behind it the protocol holds a reserve (Phase 1: 100% TTZA bank cash; later also tradeable ZAR). The spend balance is flat 1:1 and earns no yield — any vault yield accrues to the protocol. Full detail in Docs → Concepts.' },
  { title: 'User-signed P2P, self-custody', detail: 'Wallet-to-wallet sends are the user’s own passkey-signed Vault.transfer (on-chain KYC gate: both parties verified, cross-border allowed). Gasless to the consumer — the backend relays the Safe transaction and pays gas. New Safes are ERC-4337-ready, so submission can move to a Pimlico paymaster later without re-onboarding.' },
  { title: 'Cross-border spend vouchers under CASP', detail: 'Cross-border value moves as an on-chain crypto-asset transfer (CASP licence), dual-KYC, settled to the merchant in fiat. Postgres is an index of on-chain events for reporting, not a second ledger. See Docs → Events & Reporting.' },
  { title: 'Sessions: 48h JWT, no silent refresh', detail: 'Logins last 48 hours; on expiry the user re-authenticates with their passkey. No refresh tokens.' },
  { title: 'Networks', detail: 'Pilot contracts run on Sepolia; mainnet is used for ENS and for DEX liquidity/pricing of listed assets.' },
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
          <Feature name="Payment Tags">Human-readable ENS subdomains (e.g. <code>name.imali.eth</code>) for peer-to-peer transfers, hashed on-chain for privacy.</Feature>
          <Feature name="Decentralised Identity">KYC credentials issued and stored via idOS, with biometric wallet recovery (FaceSign) on the roadmap.</Feature>
          <Feature name="Merchant Integration">Merchant onboarding, product catalogue, and point-of-sale settlement.</Feature>
          <Feature name="Transaction History">On-chain tracking of purchases, top-ups, and remittances.</Feature>
          <Feature name="Reporting">On-chain events are indexed in a RDB for all reporting purposes.</Feature>
        </ul>
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
              <Feature name="Ethereum">Sepolia testnet for the pilot; mainnet ENS for payment tags.</Feature>
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
              <Feature name="ENS">Subdomain payment tags, hashed on-chain.</Feature>
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
          <Feature name="ENS Subdomains">Payment tags are hashed on-chain — the plaintext stays off-chain.</Feature>
          <Feature name="Wallet-signed writes">Admin and merchant changes require a connected, signed wallet; reads are open.</Feature>
          <Feature name="No PII on-chain">Personal data lives in idOS and the operator database, never on-chain.</Feature>
        </ul>
      </Section>
    </Card>
  );
}
