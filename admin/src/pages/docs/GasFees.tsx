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

      <Section title="Relay gas breakdown — where the cost actually goes">
        <p className="text-sm text-gray-700 leading-relaxed">
          Every consumer payment today is a <strong>relay transaction</strong>: the backend calls{' '}
          <Code>Safe.execTransaction</Code> on the consumer’s Safe, which in turn calls{' '}
          <Code>Vault.transfer</Code>. The platform pays the ETH gas. Measured on a live Sepolia
          relay (<Code>0x1307…5ee1</Code>, R50 merchant payment, 332,362 gas total):
        </p>
        <Table
          head={['Stage', 'Contract / call', 'Gas', 'Share']}
          rows={[
            ['Signature verification', 'SafeWebAuthnSigner → FCLP256Verifier (secp256r1)', '~204,000', '~61%'],
            ['WebAuthn wrapper', 'SafeWebAuthnSigner.isValidSignature (hashing, parsing)', '~10,000', '~3%'],
            ['Safe scaffolding', 'getTransactionHash, nonce++, checkSignatures, events', '~45,000', '~14%'],
            ['Vault.transfer', 'Balance check, isRegistered, share ledger, event', '~44,000', '~13%'],
            ['Calldata', 'Large WebAuthn signature bytes in the outer tx', '~15,000', '~5%'],
            ['Other', 'Proxy delegatecall overhead', '~14,000', '~4%'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">The problem is not Vault.transfer.</span> A direct{' '}
          <Code>Vault.transfer</Code> call costs ~40–55k gas in forge tests. The dominant cost is{' '}
          <strong>on-chain P-256 (secp256r1) signature verification</strong> via the FCL verifier fallback
          at <Code>0x445a0683…</Code> — because Sepolia has no native P-256 precompile and every payment
          re-runs the full WebAuthn verification path.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">The core decision:</span> today, every micropayment
          requires the passkey to sign a unique <Code>SafeTx</Code> hash and the chain to verify that
          WebAuthn assertion. At ~330k gas per payment, platform-sponsored relays can exceed the payment
          value itself (average VAS ticket ~R27). Gas <em>units</em> are fixed per payment regardless of
          amount — only gas <em>price</em> (network congestion) varies. One relay in our pilot spiked to
          13.5 gwei and cost 0.0048 ETH alone (~70% of all relay spend).
        </p>
      </Section>

      <Section title="Cheaper per-tx auth — session keys (design)">
        <p className="text-sm text-gray-700 leading-relaxed">
          Session keys avoid re-running WebAuthn/P256 on every payment. The passkey signs <em>once</em> to
          authorise a short-lived secp256k1 key; subsequent payments in that session use cheap EOA{' '}
          <Code>ecrecover</Code> (~3k gas) instead of contract-signature WebAuthn (~214k gas).
        </p>
        <h4 className="text-sm font-semibold text-gray-900 mt-2">Proposed flow</h4>
        <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-700">
          <li>Consumer opens app → client generates an ephemeral secp256k1 key pair, stored in IndexedDB.</li>
          <li>Passkey signs a <Code>SafeTx</Code> that enables a scoped <strong>SessionTransferModule</strong> (or adds the session EOA as a constrained module owner) with limits: expiry, max per-tx amount, daily cap, allowed target types (Vault.transfer only).</li>
          <li>Backend relays that one-time setup tx (still ~330k gas, but amortised over many payments).</li>
          <li>Each payment: session EOA signs the <Code>SafeTx</Code> hash with normal ECDSA → relay submits with a 65-byte EOA signature → Safe uses <Code>ecrecover</Code> instead of ERC-1271 WebAuthn.</li>
          <li>Session ends: passkey signs module disable / owner removal, or module auto-expires on-chain.</li>
        </ol>
        <h4 className="text-sm font-semibold text-gray-900 mt-3">Estimated gas per payment after session start</h4>
        <Table
          head={['Path', 'Gas units (approx)', 'Notes']}
          rows={[
            ['Today — WebAuthn every tx', '~330,000', 'FCL P-256 verify on every payment'],
            ['Session key — EOA sig', '~90,000', 'ecrecover + Safe + Vault.transfer'],
            ['Precompile only (no session)', '~130,000', 'P-256 precompile + Safe + Vault'],
            ['Session key + precompile', '~90,000', 'Best case; ecrecover already cheap'],
          ]}
        />
        <h4 className="text-sm font-semibold text-gray-900 mt-3">Changes required</h4>
        <Table
          head={['Layer', 'Work']}
          rows={[
            ['Solidity', 'Deploy SessionTransferModule: validates session EOA sig, enforces expiry/amount caps, only calls Vault.transfer. Optionally enable at Safe setup in Consumer.sol.'],
            ['Server — safeRelayService.ts', 'Accept either WebAuthn contract-signature (setup/recovery) or 65-byte EOA signature (session payments). Branch on Content-Type or sig length.'],
            ['Server — session.routes.ts', 'POST /session/start (return SafeTx to enable module), POST /session/revoke. Store session pubkey, expiry, caps in DB.'],
            ['Server — consumer.routes.ts', 'Transfer prepare: if active session, return SafeTx for session EOA to sign (no WebAuthn challenge). Submit: verify session sig server-side before relay.'],
            ['Consumer app', 'Generate session key in browser (crypto.subtle or ethers.Wallet.createRandom). Store in IndexedDB. Sign SafeTx hash with session key for payments. Prompt passkey only at session start.'],
            ['DB', 'New session_keys table: wallet_address, session_pubkey, expires_at, max_amount, daily_spent, revoked_at.'],
            ['Admin / ops', 'Dashboard metric for session vs passkey relay ratio. Revoke-all-sessions admin action for compromised keys.'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Security trade-off:</span> while a session is active,
          whoever holds the session private key can sign payments within the module’s limits — same model as
          MetaMask session keys, Coinbase Smart Wallet, etc. Mitigate with short TTL (e.g. 24h), per-tx caps
          aligned to KYC tier, device binding, and immediate revoke on logout.
        </p>
      </Section>

      <Section title="P-256 precompile (RIP-7212 / EIP-7951)">
        <p className="text-sm text-gray-700 leading-relaxed">
          The FCL verifier is a <em>software fallback</em> for chains without a native secp256r1 precompile.
          When the precompile is available at address <Code>0x…0100</Code>, P-256 verify drops from ~204k gas
          to ~3,450–6,900 gas (fixed precompile cost, plus ~30k for WebAuthn hashing/parsing around it).
        </p>
        <Table
          head={['Network', 'P-256 precompile', 'Verifier used today', 'Relay gas (approx)']}
          rows={[
            ['Sepolia (pilot)', 'Not available', 'FCLP256Verifier at 0x445a0683…', '~330,000'],
            ['Ethereum mainnet', 'EIP-7951 at 0x100 (Fusaka, Dec 2025)', 'Can use precompile — update verifiers config', '~130,000'],
            ['Base, OP, Polygon, etc.', 'RIP-7212 at 0x100', 'Can use precompile — update verifiers config', '~120,000–140,000'],
          ]}
        />
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Does mainnet make this less of a problem?</span>{' '}
          Partially. On mainnet and major L2s the precompile <em>is</em> live, so relay gas drops by roughly
          half (~130k vs ~330k) — but that is still ~R15–25 per payment at typical L1 gas prices, which
          exceeds a R27 VAS ticket. The precompile fixes the verifier bottleneck; it does <em>not</em> remove
          the per-payment WebAuthn ceremony or Safe overhead. For micropayments you still need session keys
          (or off-chain batching) even on precompile-enabled chains.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">What we can do now:</span> the Safe WebAuthn signer
          factory already supports a <Code>verifiers</Code> flag —{' '}
          <Code>uint176 = (precompileAddress &lt;&lt; 160) | fallbackVerifier</Code>. On Sepolia we set
          precompile = 0 (FCL only). For mainnet/L2 deployment, set precompile = <Code>0x100</Code> in{' '}
          <Code>SAFE_WEBAUTHN_VERIFIERS</Code> / deploy config so signers prefer the native precompile with
          FCL as fallback. No contract redeploy needed for existing signers — only new signers created after
          the config change pick up the precompile path. Existing consumers keep their deployed signer
          contract (immutable verifiers); they would need a new signer deployed with the updated verifiers
          flag to benefit.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          <span className="font-semibold text-gray-900">Avoiding relay spikes:</span> gas price spikes (like
          the 13.5 gwei outlier) are separate from gas units. Mitigate operationally: cap{' '}
          <Code>maxFeePerGas</Code> on the relayer, use a dedicated ETH-only relayer key, and monitor{' '}
          <Code>protocol_gas_costs</Code> effective gwei. Cheaper auth (session keys / precompile) reduces
          the <em>base</em> cost so spikes hurt less in absolute terms.
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
