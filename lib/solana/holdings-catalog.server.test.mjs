import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && context.parentURL) {
      const p = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of ['.ts', '.js', '/index.ts']) if (existsSync(p + ext)) return nextResolve(pathToFileURL(p + ext).href, context);
    }
    throw error;
  }
} });

import assert from 'node:assert/strict';
import test from 'node:test';

const { readHoldingsCatalog, resetHoldingsCatalogMemory, PRICE_STALE_MS } = await import('./holdings-catalog.server.ts');

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ODD = '6GmAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaUNgx';
const source = { ref: 'test', label: 'test' };
const entry = (mint, symbol, usdPrice) => ({ mint, symbol, name: symbol, isVerified: true, isSuspicious: false, usdPrice, source });
const market = (mint, symbol, price) => ({ mint, symbol, name: symbol, icon: `https://icons/${symbol}`, price, change24hPct: 1.5, category: 'crypto', verified: true, audit: { suspicious: false } });
const okCatalog = (rows) => async () => ({ ok: true, byMint: Object.fromEntries(rows.map((row) => [row.mint, row])), missing: [], observedAt: new Date().toISOString() });
const refused = async () => ({ ok: false, code: 'RATE_LIMITED', reason: 'Jupiter rate-limited the token catalog.' });
const wideOf = (rows) => async () => ({ ok: true, byMint: new Map(rows.map((row) => [row.mint, row])), observedAt: new Date().toISOString() });
const wideRefused = async () => ({ ok: false, code: 'RATE_LIMITED', reason: 'no' });
const noMarkets = () => new Map();

test('a live read names and prices every held coin, the icon from the search', async () => {
  resetHoldingsCatalogMemory();
  const read = await readHoldingsCatalog([USDC], [USDC, ODD], undefined, {
    fetchCatalog: okCatalog([entry(SOL, 'SOL', '95'), entry(USDC, 'USDC', '1')]),
    readWide: wideOf([market(USDC, 'USDC', 1), market(ODD, 'ODD', 0.5)]),
    cachedMarkets: noMarkets,
  });
  assert.equal(read.byMint[USDC].symbol, 'USDC');
  assert.equal(read.byMint[USDC].usdPrice, '1');
  assert.equal(read.byMint[USDC].icon, 'https://icons/USDC');
  assert.equal(read.byMint[ODD].usdPrice, '0.5');
  assert.equal(read.byMint[SOL].usdPrice, '95');
  assert.equal(read.fromMemory, 0);
});

test('Jupiter refusing on both hosts: the last good read still names and prices the coins', async () => {
  resetHoldingsCatalogMemory();
  let t = 1_000_000;
  const now = () => t;
  await readHoldingsCatalog([USDC], [USDC], undefined, { now, fetchCatalog: okCatalog([entry(SOL, 'SOL', '95'), entry(USDC, 'USDC', '1')]), readWide: wideOf([]), cachedMarkets: noMarkets });
  t += 5 * 60_000;
  const tiers = [];
  const read = await readHoldingsCatalog([USDC], [USDC], undefined, {
    now,
    fetchCatalog: async (mints, timeout, signal, tier) => { tiers.push(tier ?? 'configured'); return refused(); },
    readWide: wideRefused,
    cachedMarkets: noMarkets,
  });
  assert.deepEqual(tiers, ['configured', 'lite'], 'a 429 on the keyed host is asked once more on the keyless one');
  assert.equal(read.catalog.ok, false);
  assert.equal(read.byMint[USDC].symbol, 'USDC');
  assert.equal(read.byMint[USDC].usdPrice, '1');
  assert.equal(read.byMint[SOL].usdPrice, '95');
  assert.ok(read.fromMemory >= 2);
});

test('the keyless host answers when the keyed one is spent', async () => {
  resetHoldingsCatalogMemory();
  const read = await readHoldingsCatalog([USDC], [USDC], undefined, {
    fetchCatalog: async (mints, timeout, signal, tier) => (tier === 'lite' ? okCatalog([entry(USDC, 'USDC', '0.9998')])() : refused()),
    readWide: wideRefused,
    cachedMarkets: noMarkets,
  });
  assert.equal(read.catalog.ok, true);
  assert.equal(read.byMint[USDC].usdPrice, '0.9998');
});

test('a price older than the stale bound is dropped, the name is kept', async () => {
  resetHoldingsCatalogMemory();
  let t = 5_000_000;
  const now = () => t;
  await readHoldingsCatalog([ODD], [ODD], undefined, { now, fetchCatalog: okCatalog([entry(ODD, 'ODD', '2')]), readWide: wideOf([]), cachedMarkets: noMarkets });
  t += PRICE_STALE_MS + 1;
  const read = await readHoldingsCatalog([ODD], [ODD], undefined, { now, fetchCatalog: refused, readWide: wideRefused, cachedMarkets: noMarkets });
  assert.equal(read.byMint[ODD].symbol, 'ODD');
  assert.equal(read.byMint[ODD].usdPrice, null);
});

test('a cold instance with no memory still names USDC and SOL from the known mints — never with an invented price', async () => {
  resetHoldingsCatalogMemory();
  const read = await readHoldingsCatalog([USDC], [USDC, ODD], undefined, { fetchCatalog: refused, readWide: wideRefused, cachedMarkets: noMarkets });
  assert.equal(read.byMint[USDC].symbol, 'USDC');
  assert.equal(read.byMint[USDC].isVerified, true);
  assert.equal(read.byMint[USDC].usdPrice, null);
  assert.equal(read.byMint[SOL].symbol, 'SOL');
  assert.equal(read.byMint[ODD], undefined, 'an unknown coin stays unnamed rather than guessed');
});

test('the Spot lists this instance already holds price a coin the live read could not', async () => {
  resetHoldingsCatalogMemory();
  const read = await readHoldingsCatalog([USDC], [USDC, ODD], undefined, {
    fetchCatalog: refused,
    readWide: wideRefused,
    cachedMarkets: (mints) => new Map(mints.filter((mint) => mint !== SOL).map((mint) => [mint, { market: market(mint, mint === USDC ? 'USDC' : 'ODD', mint === USDC ? 1 : 0.25), readAt: Date.now() - 30_000 }])),
  });
  assert.equal(read.byMint[USDC].usdPrice, '1');
  assert.equal(read.byMint[ODD].symbol, 'ODD');
  assert.equal(read.byMint[ODD].usdPrice, '0.25');
});

test('a catalogue slower than the budget does not hold the answer, and warms the next one', async () => {
  resetHoldingsCatalogMemory();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = Date.now();
  const read = await readHoldingsCatalog([USDC], [USDC], undefined, {
    budgetMs: 50,
    fetchCatalog: async () => { await gate; return okCatalog([entry(USDC, 'USDC', '1')])(); },
    readWide: wideOf([]),
    cachedMarkets: noMarkets,
  });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(read.byMint[USDC].symbol, 'USDC');
  assert.equal(read.byMint[USDC].usdPrice, null);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const next = await readHoldingsCatalog([USDC], [USDC], undefined, { fetchCatalog: refused, readWide: wideRefused, cachedMarkets: noMarkets });
  assert.equal(next.byMint[USDC].usdPrice, '1');
});
