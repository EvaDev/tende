import { Section, Table, Code } from './_shared';

export default function Payments() {
  return (
    <>
      <Section title="Two ways to send money">
        <p className="text-sm text-gray-700 leading-relaxed">
          Consumers send from the <strong>Vault unified balance</strong> they hold (a ZAR claim).
          There are two paths, both gasless to the consumer:
        </p>
        <Table
          head={['', 'Account-to-account', 'Via WhatsApp (escrow)']}
          rows={[
            ['Recipient', 'Has an account (@tag or 0x wallet)', 'A phone number — may have no account yet'],
            ['Mechanism', 'User-signed Vault.transfer, relayed', 'Vault.transfer to escrow + claim link'],
            ['Custody', 'Moves wallet → wallet directly', 'Held at custodial escrow until claimed'],
            ['Gate', 'On-chain: both parties KYC’d', 'Sender KYC’d; recipient KYC’s on claim'],
          ]}
        />
      </Section>

      <Section title="Account-to-account (user-signed, self-custody)">
        <p className="text-sm text-gray-700 leading-relaxed">
          The consumer’s <strong>passkey signs a Safe transaction</strong> for <Code>Vault.transfer</Code>
          (recipient, amount, currency, nonce). The backend relays it via <Code>execTransaction</Code> and
          pays the gas — it can relay or stall, but cannot forge or alter the transfer. The Vault’s on-chain
          gate requires each party to be a KYC’d consumer (or a trusted merchant/treasury), so the rule is
          enforced by the contract, not the server. See <strong>Gas fees</strong> for how sponsorship works.
        </p>
      </Section>

      <Section title="Send via WhatsApp (escrow for an unonboarded recipient)">
        <p className="text-sm text-gray-700 leading-relaxed">
          To send to someone who doesn’t have an account yet, the value is held in <strong>escrow</strong>
          and released when they onboard and claim it. The chain holds the value; Postgres holds only the
          off-chain claim facts (secret hash, beneficiary phone, expiry) — not a second ledger.
        </p>
        <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Send.</span> Sender enters a phone number + amount; their passkey signs a <Code>Vault.transfer</Code> to the <strong>custodial escrow address</strong> (a trusted counterparty, so the on-chain gate passes).</li>
          <li><span className="font-semibold text-gray-900">Link.</span> The backend mints a one-time <strong>claim secret</strong> and returns a <Code>wa.me</Code> deep-link the sender taps to message the recipient. The link carries the secret; the secret’s hash is stored, never the secret itself.</li>
          <li><span className="font-semibold text-gray-900">Claim.</span> The recipient opens the link → a claim page shows the amount → they <strong>create an account</strong> (passkey) and confirm their phone number (must match what the sender entered — Phase-1 beneficiary binding).</li>
          <li><span className="font-semibold text-gray-900">Release.</span> The backend releases the escrow to the recipient’s new wallet (custodial: debit escrow, credit recipient).</li>
          <li><span className="font-semibold text-gray-900">Reclaim.</span> If unclaimed after <strong>7 days</strong>, a sweep returns the value to the sender.</li>
        </ol>
        <Table
          head={['Claim state', 'Meaning']}
          rows={[
            [<Code>pending</Code>, 'In escrow, awaiting claim (until expiry)'],
            [<Code>claimed</Code>, 'Released to the recipient’s wallet'],
            [<Code>reclaimed</Code>, 'Expired → returned to the sender'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Compliance.</span> The cross-border value moves
          <em> on-chain</em> (the CASP-licensed leg), and the beneficiary is captured at claim (phone +
          KYC on onboarding) for the Travel Rule. Recipients can be in any country; for now they receive
          the ZAR claim (local-currency FX at claim is a later addition).
        </p>
      </Section>

      <Section title="Phase-1 limitations (by design)">
        <ul className="space-y-2 list-disc pl-5 text-sm text-gray-700">
          <li><span className="font-semibold text-gray-900">Phone binding is a match, not a verified OTP.</span> True one-time-code verification needs a messaging provider (WhatsApp Business API / SMS); the claim check is the drop-in point.</li>
          <li><span className="font-semibold text-gray-900">WhatsApp delivery is a manual share.</span> The sender taps the <Code>wa.me</Code> link and picks the contact — no automated messaging integration yet.</li>
          <li><span className="font-semibold text-gray-900">Release is two non-atomic steps</span> (debit escrow, credit recipient). A future atomic <Code>Vault.adminTransfer</Code> replaces this.</li>
          <li><span className="font-semibold text-gray-900">Escrow currently shares the platform owner address.</span> A dedicated escrow wallet (marked a trusted counterparty) is recommended before launch.</li>
        </ul>
      </Section>
    </>
  );
}
