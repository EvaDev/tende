import { Section, Table, Code } from './_shared';

export default function Functions() {
  return (
    <>
      <Section title="TreasuryToken">
        <p className="text-sm text-gray-700 leading-relaxed">Permissioned ERC-20 (e.g. TTZA), 2 decimals. Compliance runs in the <Code>_update</Code> hook.</p>
        <Table
          head={['Function', 'Purpose', 'Caller']}
          rows={[
            [<Code>initialize(name, symbol, admin, supply)</Code>, 'One-time proxy init; mints initial supply to admin', 'deploy'],
            [<Code>mint(to, amt)</Code>, 'Credit on fiat deposit / voucher redeem', 'MINTER_ROLE'],
            [<Code>burn(from, amt)</Code>, 'Burn on settlement (fiat out)', 'MINTER_ROLE'],
            [<Code>burnOwn(amt)</Code>, 'Holder burns own balance', 'any holder'],
            [<Code>transfer / transferFrom / approve</Code>, 'Standard ERC-20, subject to the compliance/freeze hook', 'token holder'],
            [<Code>pause / unpause</Code>, 'Halt / resume all transfers', 'PAUSER_ROLE'],
            [<Code>addToBlacklist / removeFromBlacklist</Code>, 'Block / unblock a wallet', 'DEFAULT_ADMIN_ROLE'],
            [<Code>addToWhitelist / removeFromWhitelist</Code>, 'Manage trusted allow-list (platform, merchants)', 'COMPLIANCE_ROLE'],
            [<Code>setWhitelistEnabled(bool)</Code>, 'Toggle hard allow-list mode', 'DEFAULT_ADMIN_ROLE'],
            [<Code>setConsumerContract / setComplianceEnabled</Code>, 'Wire Consumer registry / toggle the KYC-jurisdiction gate', 'DEFAULT_ADMIN_ROLE'],
            [<Code>freezePartialTokens / unfreezePartialTokens</Code>, 'Lock / release part of a balance', 'COMPLIANCE_ROLE'],
            [<Code>forcedTransfer(from, to, amt)</Code>, 'Clawback / wallet recovery — bypasses gates, logged', 'COMPLIANCE_ROLE'],
            [<Code>balanceOf, frozenTokens, whitelisted, blacklisted, complianceEnabled, VERSION</Code>, 'Reads', 'anyone'],
          ]}
        />
      </Section>

      <Section title="Vault">
        <p className="text-sm text-gray-700 leading-relaxed">Unified balance ledger (ERC-4626 shares). Holds backing tokens; settles remittances and USD swaps.</p>
        <Table
          head={['Function', 'Purpose', 'Caller']}
          rows={[
            [<Code>initialize(admin, swapRouter, usdc)</Code>, 'One-time proxy init', 'deploy'],
            [<Code>addToken(token, cc) / setCurrencyTreasuryToken(cc, tt)</Code>, 'Register a backing token / the TreasuryToken for a currency', 'DEFAULT_ADMIN_ROLE'],
            [<Code>setConsumerContract(addr)</Code>, 'Wire the KYC/identity registry', 'DEFAULT_ADMIN_ROLE'],
            [<Code>setTrustedCounterparty(addr, bool)</Code>, 'Mark a merchant / platform wallet trusted (KYC-exempt)', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>addAllowedDestination / removeAllowedDestination(cc)</Code>, 'Manage permitted remittance payout countries', 'DEFAULT_ADMIN_ROLE'],
            [<Code>adminCredit / adminDebit(user, amt, cc)</Code>, 'Backend-driven ledger credit / debit', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>credit(user, amt, cc)</Code>, 'Reserved settlement credit', 'SETTLEMENT_ROLE'],
            [<Code>transfer(to, amt, cc)</Code>, 'P2P over the ledger — KYC’d consumer or trusted counterparty', 'smart account (sender)'],
            [<Code>startRemittance(user) / payRemittance(from, amt, cc, dest)</Code>, 'Lock then settle a remittance (burns the TreasuryToken)', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>depositFromExternal(...)</Code>, 'Pull ERC-20 in, credit shares (on-ramp)', 'anyone (whenNotPaused)'],
            [<Code>withdrawToExternal(...)</Code>, 'Push ERC-20 out to a wallet (off-ramp)', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>purchaseUsd(buyer, amt, localCcy, fee, minOut)</Code>, 'Swap local currency → USDC via Uniswap V3', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>harvest(cc, treasury, bps)</Code>, 'Sweep yield to the protocol treasury (cash currency: 100% to protocol)', 'ADMIN_EXECUTOR_ROLE'],
            [<Code>reconcileTotalAssets(cc, total)</Code>, 'Emergency drift repair', 'DEFAULT_ADMIN_ROLE'],
            [<Code>pause / unpause</Code>, 'Halt / resume user operations', 'DEFAULT_ADMIN_ROLE'],
            [<Code>unifiedBalance, sharesOf, convertToShares/Assets, pricePerShare, harvestableYield, trustedCounterparty</Code>, 'Reads', 'anyone'],
          ]}
        />
      </Section>

      <Section title="Consumer">
        <p className="text-sm text-gray-700 leading-relaxed">Smart-wallet factory + identity registry + compliance log. Source of KYC level and country code.</p>
        <Table
          head={['Function', 'Purpose', 'Caller']}
          rows={[
            [<Code>initialize(admin, safeSingleton, proxyFactory, fallbackHandler)</Code>, 'One-time proxy init', 'deploy'],
            [<Code>setMaxConsumers(n)</Code>, 'Cap total registrations', 'DEFAULT_ADMIN_ROLE'],
            [<Code>registerConsumer(...)</Code>, 'Create a Safe wallet + identity row', 'REGISTRAR_ROLE'],
            [<Code>recoverWallet(old, ensHash, newOwner)</Code>, 'Migrate identity to a new passkey wallet', 'REGISTRAR_ROLE'],
            [<Code>setSaveWallet / setUsdWallet(...)</Code>, 'Link a consumer’s secondary wallets', 'REGISTRAR_ROLE'],
            [<Code>updateKycLevel(wallet, level)</Code>, 'Set KYC tier after verification', 'KYC_UPDATER_ROLE'],
            [<Code>recordRemittance(record)</Code>, 'Append to the on-chain compliance log', 'RECORDER_ROLE'],
            [<Code>checkKycLimit(sender, amt)</Code>, 'Is a send within the sender’s KYC-tier limits?', 'anyone (view)'],
            [<Code>getConsumer / getConsumerByEns / getConsumerByGlobalId</Code>, 'Identity lookups', 'anyone (view)'],
            [<Code>isRegistered / isConsumer / getCountryCode / getKycLevel</Code>, 'Gating reads used by Vault & TreasuryToken', 'anyone (view)'],
            [<Code>getSentToday / getSentThisMonth / remittanceLogLength</Code>, 'Spend counters / log size', 'anyone (view)'],
          ]}
        />
      </Section>
    </>
  );
}
