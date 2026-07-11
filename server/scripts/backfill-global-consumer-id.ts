// Backfill consumers.global_consumer_id from Consumer.sol getConsumer(wallet).
//
//   cd server && npx tsx scripts/backfill-global-consumer-id.ts

import { ethers } from 'ethers';
import config from '../src/config.js';
import db from '../src/db.js';

const ABI = [
  'function getConsumer(address wallet) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))',
];

async function main() {
  if (!config.contracts.consumer) throw new Error('CONSUMER_CONTRACT_ADDRESS not set');

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const consumer = new ethers.Contract(config.contracts.consumer, ABI, provider);

  const { rows } = await db.query<{
    consumer_id: string;
    wallet_address: string;
    ens_subdomain: string | null;
    global_consumer_id: string | null;
  }>(
    `SELECT consumer_id, wallet_address, ens_subdomain, global_consumer_id
     FROM consumers
     WHERE wallet_address IS NOT NULL
     ORDER BY created_at`,
  );

  console.log(`[backfill] ${rows.length} consumers with wallets`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = row.ens_subdomain ? `@${row.ens_subdomain}` : row.wallet_address.slice(0, 10);

    if (row.global_consumer_id != null) {
      console.log(`  skip ${label} — already ${row.global_consumer_id}`);
      skipped++;
      continue;
    }

    try {
      const data = await consumer.getConsumer(row.wallet_address);
      const id = Number(data.globalConsumerId);

      if (!Number.isFinite(id) || id <= 0) {
        console.warn(`  skip ${label} — on-chain id invalid: ${data.globalConsumerId}`);
        failed++;
        continue;
      }

      await db.query(
        `UPDATE consumers SET global_consumer_id = $1, updated_at = NOW()
         WHERE consumer_id = $2 AND global_consumer_id IS NULL`,
        [id, row.consumer_id],
      );
      console.log(`  ok   ${label} → ${id}`);
      updated++;
    } catch (e) {
      console.warn(`  fail ${label}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`[backfill] done — updated=${updated} skipped=${skipped} failed=${failed}`);
  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
