import { Section, Table, Code } from './_shared';

export default function Contracts() {
  return (
    <>
      <Section title="The three contracts">
        <Table
          head={['Contract', 'Purpose']}
          rows={[
            [<Code>Consumer</Code>, 'Smart-wallet factory + identity registry + append-only compliance log. Source of KYC level & country code that Vault/TreasuryToken read.'],
            [<Code>Vault</Code>, 'Unified balance ledger (ERC-4626 shares) for all currencies. Holds backing tokens; moves value; settles remittances and USD swaps; harvests yield.'],
            [<Code>TreasuryToken</Code>, 'Permissioned ERC-20 (e.g. TTZA) — the protocol’s closed-loop bank-cash token. Minted on fiat-in, burned on fiat-out. Compliance runs in its _update hook.'],
          ]}
        />
        <p className="text-xs text-gray-500">All three are UUPS upgradeable proxies; addresses are stable, implementations swap on upgrade (see the <strong>Contracts</strong> admin page for live versions).</p>
      </Section>

      <Section title="Contract roles (on-chain)">
        <p className="text-sm text-gray-700 leading-relaxed">
          A role is just a list of granted addresses. <Code>initialize()</Code> grants the <strong>owner
          wallet</strong> (<Code>DEPLOYER_ADMIN_ADDRESS</Code>) <Code>DEFAULT_ADMIN_ROLE</Code> + functional
          roles; the deploy script then <Code>grantRole</Code>s the operational roles to the <strong>backend
          wallet</strong> (<Code>BACKEND_SIGNER_ADDRESS</Code>) and <Code>MINTER_ROLE</Code> to the Vault.
          “Held by” = which of those was granted the role.
        </p>
        <Table
          head={['Contract', 'Role', 'Can do', 'Held by']}
          rows={[
            ['TreasuryToken', <Code>MINTER_ROLE</Code>, 'Mint / burn (fiat deposit, settlement)', 'Owner, Vault, Backend'],
            ['TreasuryToken', <Code>PAUSER_ROLE</Code>, 'Pause / unpause all transfers', 'Owner'],
            ['TreasuryToken', <Code>COMPLIANCE_ROLE</Code>, 'Freeze/unfreeze, forced transfer (clawback/recovery), manage trusted whitelist', 'Owner, Backend'],
            ['Vault', <Code>ADMIN_EXECUTOR_ROLE</Code>, 'adminCredit/Debit, payRemittance, purchaseUsd, withdraw, harvest, setTrustedCounterparty', 'Owner, Backend'],
            ['Vault', <Code>SETTLEMENT_ROLE</Code>, 'credit() — reserved for a future Settlement contract', 'Owner'],
            ['Consumer', <Code>REGISTRAR_ROLE</Code>, 'Register wallets / create Safe accounts; recover wallets', 'Backend'],
            ['Consumer', <Code>KYC_UPDATER_ROLE</Code>, 'Update a consumer’s KYC level', 'Backend'],
            ['Consumer', <Code>RECORDER_ROLE</Code>, 'Append to the on-chain remittance compliance log', 'Backend'],
          ]}
        />
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong>Naming note:</strong> <Code>COMPLIANCE_ROLE</Code> is the contract <em>operator</em>
          role (formerly <Code>AGENT_ROLE</Code>) — unrelated to a <em>cash-out agent</em> (a payout
          merchant, not a role-holder).
        </p>
      </Section>

      <Section title="UI / app roles (backend + database)">
        <Table
          head={['Role', 'Who', 'Access']}
          rows={[
            [<Code>admin</Code>, 'Platform operators', 'Full console incl. Assets & Contracts pages and all writes'],
            [<Code>merchant</Code>, 'Onboarded businesses (incl. cash-out agents)', 'Their own products and settlement'],
            [<Code>consumer</Code>, 'End users', 'The consumer app — hold, pay, remit'],
            [<Code>none</Code>, 'Unknown connected wallet', 'Shown the merchant self-service signup'],
          ]}
        />
      </Section>

      <Section title="Per-address flags (not roles)">
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Trusted counterparty</span> (Vault) &amp; <span className="font-semibold text-gray-900">whitelist</span> (TreasuryToken): platform + merchants — KYB-verified, exempt from consumer-KYC so a consumer can pay them.</li>
          <li><span className="font-semibold text-gray-900">Blacklist</span> (TreasuryToken): blocks send/receive entirely.</li>
          <li><span className="font-semibold text-gray-900">Frozen tokens</span> (TreasuryToken): locks part/all of a balance pending investigation.</li>
          <li><span className="font-semibold text-gray-900">Allowed destinations</span> (Vault): permitted remittance payout countries.</li>
        </ul>
      </Section>

      <Section title="Transfer &amp; compliance policy">
        <p className="text-sm text-gray-700 leading-relaxed">
          KYC applies to <strong>consumers</strong>; merchants/platform are verified via <strong>KYB</strong>
          and marked trusted. (Cross-border spend vouchers — moving a ZAR claim to a KYC’d recipient
          abroad — are a Phase-2 extension of the Vault path; see the value model in <strong>Concepts</strong>.)
        </p>
        <Table
          head={['What moves', 'Cross-border?', 'Who may transact']}
          rows={[
            [
              <><span className="font-semibold">Treasury token</span> (local currency, e.g. TTZA)</>,
              <><span className="font-semibold text-brand-accent">No</span> — country-specific, domestic only</>,
              'Two same-country consumers (no KYC needed), or any leg involving a trusted address',
            ],
            [
              <><span className="font-semibold">Vault balance</span> (USD / tradeable / unified)</>,
              <><span className="font-semibold text-brand-accent">Yes</span> — allowed</>,
              'Each side a KYC’d consumer (≥1) OR a trusted counterparty; consumer↔consumer needs both KYC’d',
            ],
          ]}
        />
      </Section>
    </>
  );
}
