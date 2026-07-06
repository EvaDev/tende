// src/indexerService.ts
// Event indexer: polls Vault / TreasuryToken / Consumer logs and projects each into
// the chain_events table for reporting. The chain is the source of truth; this table
// is a rebuildable, idempotent index (UNIQUE(tx_hash, log_index)). Reorg-safe by only
// processing blocks below (head − confirmations). Chunked to <=10 blocks because the
// Alchemy free tier caps eth_getLogs at a 10-block range.

import { ethers } from 'ethers';
import { config } from './config.js';
import db from './db.js';

// Human-readable event ABIs (kept self-contained — no dependency on Foundry artifacts).
const VAULT_EVENTS = [
  'event Credited(address indexed user, bytes32 indexed currencyCode, uint256 amount, address indexed creditor)',
  'event Debited(address indexed user, bytes32 indexed currencyCode, uint256 amount)',
  'event Transferred(address indexed from, address indexed to, uint256 amount, bytes32 indexed currencyCode)',
  'event RemittanceStarted(address indexed user)',
  'event RemittanceSettled(address indexed from, uint256 amount, bytes32 indexed currencyCode, bytes32 destinationCountryCode)',
  'event Deposited(address indexed depositor, address indexed beneficiary, address token, uint256 amount)',
  'event Withdrawn(address indexed from, address indexed to, address token, uint256 amount)',
  'event UsdPurchased(address indexed buyer, uint256 localAmount, bytes32 indexed localCurrency, uint256 usdcReceived)',
  'event TokenRegistered(address indexed token, bytes32 indexed currencyCode)',
  'event TreasuryTokenSet(bytes32 indexed currencyCode, address indexed treasuryToken)',
  'event DestinationAdded(bytes32 indexed countryCode)',
  'event DestinationRemoved(bytes32 indexed countryCode)',
  'event YieldHarvested(bytes32 indexed currencyCode, uint256 yieldDelta, uint256 platformCut, uint256 userYield, address indexed treasury)',
  'event TotalAssetsReconciled(bytes32 indexed currencyCode, uint256 oldValue, uint256 newValue)',
  'event TrustedCounterpartySet(address indexed account, bool trusted)',
];

const TREASURY_EVENTS = [
  'event AddedToBlacklist(address indexed account)',
  'event RemovedFromBlacklist(address indexed account)',
  'event AddedToWhitelist(address indexed account)',
  'event RemovedFromWhitelist(address indexed account)',
  'event WhitelistToggled(bool enabled)',
  'event Minted(address indexed to, uint256 amount)',
  'event Burned(address indexed from, uint256 amount)',
  'event ConsumerContractSet(address indexed consumer)',
  'event ComplianceToggled(bool enabled)',
  'event TokensFrozen(address indexed account, uint256 amount)',
  'event TokensUnfrozen(address indexed account, uint256 amount)',
  'event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const CONSUMER_EVENTS = [
  'event ConsumerRegistered(address indexed wallet, uint256 indexed globalId, bytes32 countryCode, uint8 kycLevel)',
  'event KycLevelUpdated(address indexed wallet, uint8 oldLevel, uint8 newLevel)',
  'event SaveWalletCreated(address indexed spendWallet, address indexed saveWallet)',
  'event UsdWalletCreated(address indexed spendWallet, address indexed usdWallet)',
  'event WalletRecovered(address indexed oldWallet, address indexed newWallet, uint256 indexed globalConsumerId)',
  'event RemittanceRecorded(address indexed sender, bytes32 indexed destinationCountryCode, uint256 amount, bytes32 partnerId, uint256 logIndex)',
  'event MaxConsumersUpdated(uint256 newMax)',
];

interface Target { address: string; label: string; iface: ethers.Interface }

async function buildTargets(): Promise<Target[]> {
  const t: Target[] = [];
  const treasuryIface = new ethers.Interface(TREASURY_EVENTS);
  if (config.contracts.vault)    t.push({ address: config.contracts.vault.toLowerCase(),    label: 'Vault',    iface: new ethers.Interface(VAULT_EVENTS) });
  if (config.contracts.consumer) t.push({ address: config.contracts.consumer.toLowerCase(), label: 'Consumer', iface: new ethers.Interface(CONSUMER_EVENTS) });

  try {
    const r = await db.query<{ contract_address: string }>(
      `SELECT contract_address FROM stablecoins
        WHERE is_treasury_token = TRUE AND is_deployed = TRUE AND contract_address IS NOT NULL`,
    );
    for (const row of r.rows) {
      t.push({ address: row.contract_address.toLowerCase(), label: 'TreasuryToken', iface: treasuryIface });
    }
  } catch { /* stablecoins absent */ }

  if (t.filter(x => x.label === 'TreasuryToken').length === 0) {
    if (config.contracts.treasuryTokenZA) t.push({ address: config.contracts.treasuryTokenZA.toLowerCase(), label: 'TreasuryToken', iface: treasuryIface });
    if (config.contracts.treasuryTokenZW) t.push({ address: config.contracts.treasuryTokenZW.toLowerCase(), label: 'TreasuryToken', iface: treasuryIface });
  }
  return t;
}

// Recursively make decoded args JSON-safe (bigint → string).
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  return value;
}

function argsToObject(parsed: ethers.LogDescription): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  parsed.fragment.inputs.forEach((inp, i) => { out[inp.name || `arg${i}`] = jsonSafe(parsed.args[i]); });
  return out;
}

async function getCursor(provider: ethers.JsonRpcProvider): Promise<number> {
  const r = await db.query<{ last_block: string }>('SELECT last_block FROM indexer_cursor WHERE id = 1');
  if (r.rows.length) return Number(r.rows[0].last_block);
  const start = config.indexer.startBlock ?? await provider.getBlockNumber();
  await db.query('INSERT INTO indexer_cursor (id, last_block) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [start]);
  console.log(`[indexer] initialised cursor at block ${start}`);
  return start;
}

let running = false;

async function tick(provider: ethers.JsonRpcProvider, targets: Target[]): Promise<void> {
  const latest = await provider.getBlockNumber();
  const safe = latest - config.indexer.confirmations;
  let cursor = await getCursor(provider);
  if (safe <= cursor) return; // nothing new + confirmed

  const addresses = targets.map(t => t.address);
  const byAddr = new Map(targets.map(t => [t.address, t]));
  const blockTimes = new Map<number, string | null>();
  const tickStart = cursor;
  const maxPerTick = config.indexer.chunkBlocks * 25; // bound work per tick; resume next poll

  while (cursor < safe && (cursor - tickStart) < maxPerTick) {
    const from = cursor + 1;
    const to = Math.min(from + config.indexer.chunkBlocks - 1, safe);
    const logs = await provider.getLogs({ address: addresses, fromBlock: from, toBlock: to });

    for (const log of logs) {
      const target = byAddr.get(log.address.toLowerCase());
      if (!target) continue;
      let parsed: ethers.LogDescription | null;
      try { parsed = target.iface.parseLog({ topics: [...log.topics], data: log.data }); } catch { continue; }
      if (!parsed) continue;

      if (!blockTimes.has(log.blockNumber)) {
        let bt: string | null = null;
        try { const b = await provider.getBlock(log.blockNumber); bt = b ? new Date(b.timestamp * 1000).toISOString() : null; } catch { /* leave null */ }
        blockTimes.set(log.blockNumber, bt);
      }

      await db.query(
        `INSERT INTO chain_events
           (chain_id, block_number, block_hash, tx_hash, log_index, address, contract, event_name, args, block_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [
          config.chain.chainId, log.blockNumber, log.blockHash, log.transactionHash, log.index,
          log.address.toLowerCase(), target.label, parsed.name,
          JSON.stringify(argsToObject(parsed)), blockTimes.get(log.blockNumber) ?? null,
        ],
      );
    }

    cursor = to;
    await db.query('UPDATE indexer_cursor SET last_block = $1, updated_at = NOW() WHERE id = 1', [cursor]);
  }
}

/// Start the background indexer loop. Returns the timer (or undefined if disabled).
export function startIndexer(): NodeJS.Timeout | undefined {
  if (!config.indexer.enabled)  { console.log('[indexer] disabled (INDEXER_ENABLED=false)'); return; }
  if (!config.contracts.vault)  { console.log('[indexer] no contracts configured — not starting'); return; }

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  let targets: Target[] = [];

  const loop = async () => {
    if (running) return;
    running = true;
    try {
      if (!targets.length) targets = await buildTargets();
      await tick(provider, targets);
    } catch (e) { console.error('[indexer] tick error:', (e as Error).message); }
    finally { running = false; }
  };

  void buildTargets().then(t => {
    targets = t;
    console.log(`[indexer] started — ${targets.map(x => x.label).join(', ')}; poll ${config.indexer.pollMs}ms, chunk ${config.indexer.chunkBlocks}, confirmations ${config.indexer.confirmations}`);
  });
  void loop();
  return setInterval(() => void loop(), config.indexer.pollMs);
}
