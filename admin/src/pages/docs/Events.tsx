import { Section, Table, Code } from './_shared';

export default function Events() {
  return (
    <>
      <Section title="Events are the reporting backbone">
        <p className="text-sm text-gray-700 leading-relaxed">
          Every value-affecting action emits an on-chain <strong>event</strong>. The chain is the
          source of truth; an <strong>indexer</strong> captures these events and projects them into
          Postgres so we can query, reconcile and report against them — automated reporting straight
          off the chain. Postgres is <em>not</em> a second ledger: it’s a rebuildable index plus the
          off-chain-only facts that legally can’t live on-chain (see below).
        </p>
      </Section>

      <Section title="Key events (Vault)">
        <Table
          head={['Event', 'Emitted when', 'Why it matters for reporting']}
          rows={[
            [<Code>Transferred(from, to, amount, currencyCode)</Code>, 'P2P ledger transfer (incl. cross-border vouchers)', 'Core value movement; the Travel-Rule line item (joined to identities off-chain)'],
            [<Code>Deposited(depositor, beneficiary, token, amount)</Code>, 'On-ramp — ERC-20 pulled in', 'Funds entering the system'],
            [<Code>Withdrawn(from, to, token, amount)</Code>, 'Off-ramp — ERC-20 pushed out', 'Funds leaving / merchant settlement'],
            [<Code>UsdPurchased(buyer, localAmount, localCurrency, usdcReceived)</Code>, 'Local → USDC swap (Uniswap)', 'FX/treasury reconciliation'],
            [<Code>RemittanceSettled(from, amount, currencyCode, destination)</Code>, 'Remittance paid out + TreasuryToken burned', 'Cross-border settlement record'],
            [<Code>YieldHarvested(currencyCode, yieldDelta, platformCut, userYield, treasury)</Code>, 'Yield swept (Phase 1: 100% to protocol)', 'Protocol revenue'],
            [<Code>TrustedCounterpartySet(account, trusted)</Code>, 'Merchant/platform marked trusted', 'Compliance allow-list audit'],
            [<Code>Credited / Debited(user, currencyCode, amount)</Code>, 'Backend ledger adjustments', 'Balance audit trail'],
          ]}
        />
      </Section>

      <Section title="Key events (TreasuryToken &amp; Consumer)">
        <Table
          head={['Event', 'Emitted when', 'Why it matters']}
          rows={[
            [<Code>Minted(to, amount)</Code> /* TT */, 'Fiat deposit confirmed', 'Cash entering the closed loop (bank reserve up)'],
            [<Code>Burned(from, amount)</Code> /* TT */, 'Fiat settlement / off-ramp', 'Cash leaving (bank reserve down)'],
            [<Code>ForcedTransfer(from, to, amount, agent)</Code> /* TT */, 'Clawback / lost-wallet recovery', 'High-sensitivity compliance action — always reviewed'],
            [<Code>TokensFrozen / TokensUnfrozen(account, amount)</Code> /* TT */, 'Balance frozen/released', 'AML hold audit'],
            [<Code>ConsumerRegistered(...) / KycLevelUpdated(wallet, old, new)</Code> /* Consumer */, 'Onboarding / KYC change', 'Identity & KYC history (Travel-Rule support)'],
            [<Code>RemittanceRecorded(...)</Code> /* Consumer */, 'Remittance written to the on-chain log', 'Regulator-facing compliance log'],
            [<Code>WalletRecovered(old, new, globalConsumerId)</Code> /* Consumer */, 'Passkey-loss recovery', 'Wallet-continuity audit'],
          ]}
        />
      </Section>

      <Section title="How events become reports">
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Indexer:</span> subscribes to Vault + TreasuryToken (+ Consumer) logs and upserts each into Postgres keyed by <Code>(tx_hash, log_index)</Code> — idempotent, with reorg handling (confirm after N blocks).</li>
          <li><span className="font-semibold text-gray-900">Correlation:</span> the backend submits/sponsors these transactions, so it records the resulting tx hash against business records (e.g. a voucher) — no on-chain IDs needed.</li>
          <li><span className="font-semibold text-gray-900">Off-chain-only facts</span> (joined for human-readable reports): identity/KYC (Travel-Rule originator/beneficiary), FX rate snapshots at redemption, fiat-settlement references (e.g. Flash), merchant config. The chain holds addresses and amounts; Postgres holds the <em>who</em>, the <em>rate</em>, and the <em>fiat leg</em>.</li>
          <li><span className="font-semibold text-gray-900">Result:</span> auditor-ready reports (Travel Rule, settlement reconciliation, FX audit, protocol revenue) that are provably consistent with on-chain state because they’re derived from it.</li>
        </ul>
        <p className="text-xs text-gray-500 leading-relaxed">
          Regulatory note: because cross-border value moves as an on-chain crypto-asset transfer
          (CASP), these events <em>are</em> the regulated record. Postgres is the reporting projection
          over them, never the value rail.
        </p>
      </Section>
    </>
  );
}
