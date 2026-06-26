import { Section, Table, Code } from './_shared';

export default function GasFees() {
  return (
    <>
      <Section title="Gas fees — who pays, and how">
        <p className="text-sm text-gray-700 leading-relaxed">
          Consumers never pay or see gas. The <strong>platform sponsors every transaction</strong>.
          Today that sponsorship works through a <strong>relay</strong> — the backend submits the
          user’s signed transaction and pays the gas directly. This is deliberately simpler than full
          ERC-4337: there is no bundler or paymaster in the path yet. At scale it should move to a
          bundler + paymaster (Pimlico); the reasons are below.
        </p>
      </Section>

      <Section title="How it works today — relayed Safe transactions (not quite ERC-4337)">
        <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-700">
          <li>The consumer’s passkey signs the exact <strong>SafeTx</strong> (recipient, amount, currency, nonce) for <Code>Vault.transfer</Code> — a biometric prompt, no gas.</li>
          <li>The backend submits an <strong>ordinary Ethereum transaction</strong> calling <Code>Safe.execTransaction(…)</Code>, carrying that signature in the <Code>signatures</Code> argument.</li>
          <li>Because it’s an ordinary tx, <strong>the sender pays the gas in ETH</strong>. The SafeTx uses <Code>gasPrice = 0</Code>, so the Safe does <em>not</em> reimburse the sender — the backend simply absorbs the cost.</li>
        </ol>
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">The relay</span> is the platform’s backend hot
          wallet (<Code>BACKEND_SIGNER</Code>). It can relay or stall a transfer but <strong>cannot
          forge or alter it</strong> — the passkey already signed the exact parameters, so the backend
          is a transport, not a custodian. Self-custody is preserved.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Why “not quite ERC-4337”:</span> there is no
          EntryPoint, no bundler, no paymaster and no <Code>UserOperation</Code>. The wallet is a Safe
          1.4.1 smart account (threshold 1, passkey owner) driven by its normal <Code>execTransaction</Code>
          path. Newly-registered Safes <em>are</em> 4337-capable (the Safe4337Module is enabled at
          setup), but submission still goes through the relay — so the door to a paymaster is open
          without re-onboarding anyone.
        </p>
        <Table
          head={['Action', 'Who submits', 'Who pays gas', 'Consumer pays?']}
          rows={[
            ['P2P transfer (Vault.transfer)', 'Backend relay', 'Backend hot wallet (ETH)', 'No'],
            ['Registration, KYC update, harvest, merchant whitelist', 'Backend', 'Backend hot wallet (ETH)', 'No'],
            ['Contract upgrades', 'Owner / governance wallet', 'Owner wallet (ETH)', '—'],
            ['Pimlico paymaster', '—', 'Nothing yet — no user-ops are sent', '—'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Funding:</span> keep the backend relayer topped
          up with ETH — that single balance covers all sponsored transactions. This relayed-meta-tx
          pattern is mainstream (Gelato Relay, OpenZeppelin Defender, Safe’s own relay service) and is
          the right fit while the platform sponsors 100% of gas at pilot volume.
        </p>
      </Section>

      <Section title="At scale — upgrade to a bundler + paymaster (ERC-4337)">
        <p className="text-sm text-gray-700 leading-relaxed">
          The relay is sufficient now, but three limits make a bundler + paymaster (e.g. Pimlico) the
          right move as volume grows. The migration is non-disruptive: because new Safes are already
          4337-capable, submission can flip to user-ops without re-onboarding, and the relay keeps
          working in parallel (it validates the Safe owner’s signature, not the fallback handler).
        </p>
        <ul className="space-y-3 list-disc pl-5 text-sm text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Nonce serialisation (throughput).</span> The
            relay is a single EOA, and Ethereum processes one account’s transactions in strict nonce
            order. Under concurrent load every transfer funnels through one nonce sequence, so a single
            stuck (underpriced) tx blocks everything behind it — head-of-line blocking. Stop-gaps: a
            nonce manager or a pool of relay keys. A bundler removes the bottleneck by batching user-ops
            from many accounts and managing submission itself.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Key hygiene.</span> Relaying needs <em>no</em>
            contract role — anyone may submit a Safe transaction that carries a valid owner signature.
            Today the relay uses <Code>BACKEND_SIGNER</Code>, which also holds <Code>MINTER</Code>,
            <Code> ADMIN_EXECUTOR</Code>, <Code>COMPLIANCE</Code> and more. That puts an always-online,
            auto-spending key on the same wallet as minting/compliance authority. Near-term fix: relay
            from a <strong>dedicated, role-less, ETH-only relayer key</strong> (blast radius = “some gas”).
            A paymaster removes the always-hot signing key from the user-transaction path entirely.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Abuse / DoS.</span> Because transactions are
            gasless, a flood of requests drains the relayer’s ETH — the platform pays for spam. Mitigate
            now with API/auth rate limits and per-user caps (transfers are already JWT- and KYC-gated). A
            paymaster <strong>sponsorship policy</strong> (e.g. <Code>sp_nosy_dust</Code>) enforces those
            caps and rate limits centrally at the gas layer.
          </li>
        </ul>
        <Table
          head={['', 'Today — relay', 'At scale — bundler + paymaster']}
          rows={[
            ['Submitter', 'Platform backend (own EOA)', 'Pimlico bundler → EntryPoint'],
            ['Pays gas', 'Backend hot wallet, directly in ETH', 'Paymaster deposit (prepaid, platform-funded)'],
            ['Funding', 'Top up one backend address', 'Top up the Pimlico paymaster balance'],
            ['Concurrency', 'Single-nonce ceiling', 'Bundler batches across accounts'],
            ['Hot-key exposure', 'Relayer key online & funded', 'No platform signer in the user-tx path'],
            ['Abuse controls', 'In your API / auth layer', 'Sponsorship policy + your API layer'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          In both models the <strong>platform bears the cost and the consumer pays nothing</strong> — the
          difference is plumbing, concurrency headroom, and where the controls live.
        </p>
      </Section>
    </>
  );
}
