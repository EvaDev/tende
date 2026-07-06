import { unifiedBalanceOf, isRegisteredConsumer } from '../src/safeRelayService.js';

const wallets = [
  { tag: 'se1', addr: '0xB9CED87DEF0a312B9BD04270F3E081309821c315', country: 'ZA' },
  { tag: 'es1', addr: '0x94B5dec1E6cf1a7251a242EC0b9B9082f0Ab9b53', country: 'ZA' },
  { tag: 'mw1', addr: '0x466254B09A645a028e1E7547987719Bd92204B0e', country: 'MW' },
];

for (const w of wallets) {
  const [zar, mwk, usdc, reg] = await Promise.all([
    unifiedBalanceOf(w.addr, 'ZAR').catch(() => 0n),
    unifiedBalanceOf(w.addr, 'MWK').catch(() => 0n),
    unifiedBalanceOf(w.addr, 'USDC').catch(() => 0n),
    isRegisteredConsumer(w.addr).catch(() => false),
  ]);
  console.log(`${w.tag} (${w.country}) registered=${reg}`);
  console.log(`  ZAR=${Number(zar) / 100}  MWK=${Number(mwk) / 100}  USDC=${Number(usdc) / 1e6}`);
}
