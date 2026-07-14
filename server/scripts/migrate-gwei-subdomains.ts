#!/usr/bin/env npx tsx
/**
 * Attach pilot payment tags as free subdomains under imali.gwei (GNS).
 *
 * Registers se1 / es1 / mw1 on the chain selected by CHAIN_ID (use Sepolia for pilot),
 * pointing each at the known consumer Safe address.
 *
 * Requires ENS_CONTROLLER_* to be the owner of imali.gwei (deployer admin wallet).
 *
 * Usage (from repo root, with server/.env loaded by the script):
 *   cd server && npx tsx scripts/migrate-gwei-subdomains.ts
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
loadEnv({ path: resolve(here, '../.env') });
loadEnv({ path: resolve(here, '../../.env') }); // deployer key may live at repo root

const { ensService } = await import('../src/ensService.js');
import config from '../src/config.js';

const PILOTS = [
  { tag: 'se1', addr: '0xB9CED87DEF0a312B9BD04270F3E081309821c315', country: 'ZA' },
  { tag: 'es1', addr: '0x94B5dec1E6cf1a7251a242EC0b9B9082f0Ab9b53', country: 'ZA' },
  { tag: 'mw1', addr: '0x466254B09A645a028e1E7547987719Bd92204B0e', country: 'MW' },
] as const;

async function main() {
  console.log(`Chain ${config.chain.chainId}  parent=${ensService.parentDomain}  gns=${config.ens.gnsContract}`);
  console.log(`Controller ${config.ens.controllerAddress}`);

  for (const p of PILOTS) {
    const full = ensService.fullName(p.tag);
    const before = await ensService.resolveSubdomain(p.tag);
    console.log(`\n${full} (${p.country})`);
    console.log(`  current → ${before ?? '(unregistered)'}`);
    console.log(`  target  → ${p.addr}`);

    if (before && before.toLowerCase() === p.addr.toLowerCase()) {
      console.log('  already correct — skip');
      continue;
    }

    const result = await ensService.registerSubdomain({
      subdomain: p.tag,
      walletAddress: p.addr,
    });
    if ('skipped' in result && result.skipped) {
      console.log('  skipped:', result.reason);
      continue;
    }

    const after = await ensService.resolveSubdomain(p.tag);
    console.log(`  resolved → ${after}`);
    if (!after || after.toLowerCase() !== p.addr.toLowerCase()) {
      throw new Error(`Resolve mismatch for ${full}: got ${after}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
