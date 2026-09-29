import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { closePositionWatch, listPositionWatches, readPositionWatch, setPositionWatch, watchFigures } from "./position-watch.ts";
import { composePositions, POSITION_DUST_USD, valueOf } from "./positions.ts";
import { heldFromAccounts, readPositions, rowFactsOf } from "./positions.server.ts";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 1 — Нагляд over the wallet's positions:
 * every company the chain says the wallet holds, with its exit and its state;
 * «Ryntra попередить» turned on for a position; a position that could not be
 * read never called unprotected.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FRESH = "2026-09-28T11:59:00.000Z";

const facts = (over = {}) => ({
  mint: AAPLX,
  symbol: "AAPLx",
  name: "Apple",
  icon: null,
  unitBasis: "share",
  decimals: 8,
  multiplier: 1,
  price: 340,
  observedAt: FRESH,
  deviationPct: 0.1,
  exchangeClosed: false,
  halted: false,
  ...over,
});

const watchRecord = (over = {}) => ({
  version: 0,
  owner: OWNER,
  mint: NVDAX,
  symbol: "NVDAx",
  preset: "careful",
  stopPct: 5,
  targetPct: 10,
  basisPerUnit: 180,
  basisObservedAt: FRESH,
  limitPerUnit: 171,
  targetPerUnit: 198,
  locale: "uk",
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
  closedAt: null,
  ...over,
});

test("every company held is a position: no exit reads the amber line, a plan's or a watch's exit is judged", () => {
  const positions = composePositions({
    held: new Map([[AAPLX, 700_000n], [NVDAX, 5_000_000n], ["So11111111111111111111111111111111111111112", 1_000n]]),
    rows: new Map([[AAPLX, facts()], [NVDAX, facts({ mint: NVDAX, symbol: "NVDAx", name: "NVIDIA", price: 185 })]]),
    planExits: new Map([[AAPLX, { planId: "plan_00000000000000000000000000000001", limit: 306, target: 408, writtenAt: "2026-09-27T09:00:00.000Z" }]]),
    watches: [watchRecord()],
    eventOpen: () => false,
    channel: true,
    nowMs: NOW,
  });
  assert.equal(positions.length, 2, "a token the universe does not know is not a company position");
  const apple = positions.find((row) => row.mint === AAPLX);
  assert.equal(apple.state, "on-plan");
  assert.deepEqual(apple.exit, { source: "plan", limit: 306, target: 408, preset: null, planId: "plan_00000000000000000000000000000001" });
  const nvidia = positions.find((row) => row.mint === NVDAX);
  assert.equal(nvidia.exit.source, "watch");
  assert.equal(nvidia.exit.preset, "careful");
  assert.equal(nvidia.state, "on-plan");
  assert.ok(Math.abs(nvidia.valueUsd - 0.05 * 185) < 1e-9);

  const bare = composePositions({ held: new Map([[AAPLX, 700_000n]]), rows: new Map([[AAPLX, facts()]]), planExits: new Map(), watches: [], eventOpen: () => false, channel: false, nowMs: NOW });
  assert.deepEqual([bare[0].state, bare[0].reason, bare[0].action], ["exit-not-set", "no-exit", "connect-telegram"]);
});

test("the exit written last wins; a closed watch is no exit", () => {
  const plan = { planId: "plan_00000000000000000000000000000002", limit: 300, target: 400, writtenAt: "2026-09-28T09:00:00.000Z" };
  const later = composePositions({ held: new Map([[AAPLX, 700_000n]]), rows: new Map([[AAPLX, facts()]]), planExits: new Map([[AAPLX, plan]]), watches: [watchRecord({ mint: AAPLX, updatedAt: "2026-09-28T10:00:00.000Z", limitPerUnit: 323, targetPerUnit: 374 })], eventOpen: () => false, channel: true, nowMs: NOW });
  assert.equal(later[0].exit.source, "watch");
  const earlier = composePositions({ held: new Map([[AAPLX, 700_000n]]), rows: new Map([[AAPLX, facts()]]), planExits: new Map([[AAPLX, plan]]), watches: [watchRecord({ mint: AAPLX, updatedAt: "2026-09-27T10:00:00.000Z" })], eventOpen: () => false, channel: true, nowMs: NOW });
  assert.equal(earlier[0].exit.source, "plan");
  const closed = composePositions({ held: new Map([[AAPLX, 700_000n]]), rows: new Map([[AAPLX, facts()]]), planExits: new Map(), watches: [watchRecord({ mint: AAPLX, closedAt: "2026-09-28T08:00:00.000Z" })], eventOpen: () => false, channel: true, nowMs: NOW });
  assert.equal(closed[0].state, "exit-not-set");
});

test("dust under a cent is not a position; a value that cannot be counted is not called dust", () => {
  const tiny = 2_000n; /* 0.00002 AAPLx ≈ $0.0068 */
  assert.ok(valueOf(tiny, facts()) < POSITION_DUST_USD);
  assert.equal(composePositions({ held: new Map([[AAPLX, tiny]]), rows: new Map([[AAPLX, facts()]]), planExits: new Map(), watches: [], eventOpen: () => false, channel: true, nowMs: NOW }).length, 0);
  const unpriced = composePositions({ held: new Map([[AAPLX, tiny]]), rows: new Map([[AAPLX, facts({ price: null })]]), planExits: new Map(), watches: [], eventOpen: () => false, channel: true, nowMs: NOW });
  assert.equal(unpriced.length, 1);
  assert.equal(unpriced[0].valueUsd, null);
  /* A scaled token is worth its multiplier: 0.084535 SPACEX × 5 at $116.99 ≈ $49.45. */
  assert.ok(Math.abs(valueOf(84_535_000n, facts({ decimals: 9, multiplier: 5, price: 116.99 })) - 0.084535 * 5 * 116.99) < 1e-6);
});

test("the one that needs the person comes first, then by what it is worth", () => {
  const positions = composePositions({
    held: new Map([[AAPLX, 70_000_000n], [NVDAX, 1_000_000n], [SPACEX, 84_535_000n]]),
    rows: new Map([[AAPLX, facts()], [NVDAX, facts({ mint: NVDAX, symbol: "NVDAx", price: 185 })], [SPACEX, facts({ mint: SPACEX, symbol: "SPACEX", decimals: 9, multiplier: 5, price: 116.99, unitBasis: "token", deviationPct: null })]]),
    planExits: new Map([[AAPLX, { planId: "plan_00000000000000000000000000000003", limit: 300, target: 400, writtenAt: "2026-09-27T09:00:00.000Z" }]]),
    watches: [watchRecord({ price: 185, limitPerUnit: 190, targetPerUnit: 220 })],
    eventOpen: () => false,
    channel: true,
    nowMs: NOW,
  });
  assert.deepEqual(positions.map((row) => [row.symbol, row.state]), [["NVDAx", "action"], ["SPACEX", "exit-not-set"], ["AAPLx", "on-plan"]]);
});

test("the chain's token accounts add up per mint; a frozen account is the issuer's pause", () => {
  const parsed = heldFromAccounts([
    { account: { data: { parsed: { info: { mint: AAPLX, state: "initialized", tokenAmount: { amount: "100" } } } } } },
    { account: { data: { parsed: { info: { mint: AAPLX, state: "frozen", tokenAmount: { amount: "50" } } } } } },
    { account: { data: { parsed: { info: { mint: NVDAX, state: "frozen", tokenAmount: { amount: "0" } } } } } },
  ]);
  assert.equal(parsed.held.get(AAPLX), 150n);
  assert.deepEqual([...parsed.frozen], [AAPLX], "an empty frozen account stops nothing");
  assert.equal(heldFromAccounts({ value: [] }), null);
  assert.equal(heldFromAccounts([{ account: { data: { parsed: { info: { mint: AAPLX, tokenAmount: { amount: "-1" } } } } } }]), null);
});

test("the universe's row as Нагляд reads it: the company's name, a current reference only, a closed exchange, a pause from the chain or the issuer", () => {
  const row = {
    representation: { mint: AAPLX, symbol: "AAPLx", name: "Apple xStock", underlying: { symbol: "AAPL", name: "Apple Inc.", isin: null, listingCountry: null }, instrument: { class: "listed-equity", unitBasis: "share", rights: "economic" }, decimals: 8, tradingHalted: false },
    market: { priceUsd: 339.7, observedAt: FRESH, icon: "https://example.test/aapl.png" },
    multiplier: { current: 1.0021, pending: null, effectiveAt: null },
    reference: { state: "current" },
    deviationPct: -0.08,
    session: { period: "closed" },
    lifecycle: { state: "active" },
  };
  const read = rowFactsOf(row);
  assert.equal(read.name, "Apple");
  assert.equal(read.multiplier, 1.0021);
  assert.equal(read.deviationPct, -0.08);
  assert.equal(read.exchangeClosed, true);
  assert.equal(read.halted, false);
  assert.equal(rowFactsOf({ ...row, reference: { state: "last-available" } }).deviationPct, null, "a last close is not the exchange now");
  assert.equal(rowFactsOf({ ...row, lifecycle: { state: "paused" } }).halted, true);
  assert.equal(rowFactsOf({ ...row, representation: { ...row.representation, tradingHalted: true } }).halted, true);
});

const universe = (rows) => ({ ok: true, universe: { rows } });
const stockRow = (mint, symbol, price) => ({
  representation: { mint, symbol, name: `${symbol} token`, underlying: { symbol, name: symbol, isin: null, listingCountry: null }, instrument: { class: "listed-equity", unitBasis: "share", rights: "economic" }, decimals: 8, tradingHalted: false },
  market: { priceUsd: price, observedAt: FRESH, icon: null },
  multiplier: null,
  reference: { state: "current" },
  deviationPct: 0.1,
  session: { period: "market" },
  lifecycle: { state: "active" },
});

test("readPositions composes the wallet's positions and says what answered; a failed read lists nothing and calls nothing unprotected", async () => {
  const store = createMemoryGuardStore();
  const deps = (held, extra = {}) => ({
    readHeld: async () => held,
    readUniverse: async () => universe([stockRow(AAPLX, "AAPLx", 340), stockRow(NVDAX, "NVDAx", 185)]),
    readTelegram: async () => true,
    readRows: async () => [],
    ...extra,
  });
  const read = await readPositions(store, OWNER, NOW, deps({ held: new Map([[AAPLX, 700_000n]]), frozen: new Set(), complete: true }));
  assert.equal(read.holdings, "complete");
  assert.equal(read.market, "ok");
  assert.equal(read.telegram, true);
  assert.deepEqual(read.positions.map((row) => [row.symbol, row.state, row.action]), [["AAPLx", "exit-not-set", "warn"]]);

  const failed = await readPositions(store, OWNER, NOW, deps(null));
  assert.equal(failed.holdings, "failed");
  assert.deepEqual(failed.positions, []);
  const noMarket = await readPositions(store, OWNER, NOW, deps({ held: new Map([[AAPLX, 700_000n]]), frozen: new Set(), complete: true }, { readUniverse: async () => ({ ok: false, code: "UNAVAILABLE", reason: "down" }) }));
  assert.equal(noMarket.market, "failed");
  assert.deepEqual(noMarket.positions, []);

  const frozen = await readPositions(store, OWNER, NOW, deps({ held: new Map([[AAPLX, 700_000n]]), frozen: new Set([AAPLX]), complete: true }));
  assert.equal(frozen.positions[0].state, "issuer-paused");
  const noChannel = await readPositions(store, OWNER, NOW, deps({ held: new Map([[AAPLX, 700_000n]]), frozen: new Set(), complete: true }, { readTelegram: async () => null }));
  assert.equal(noChannel.positions[0].action, "connect-telegram", "a channel that could not be read is not a connected one");
});

test("a watch closes only on a complete read that finds none of its token; a partial read closes nothing", async () => {
  const store = createMemoryGuardStore();
  await setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "careful", basisPerUnit: 185, basisObservedAt: FRESH, locale: "uk" }, NOW - 60_000);
  const deps = (held) => ({ readHeld: async () => held, readUniverse: async () => universe([stockRow(NVDAX, "NVDAx", 185)]), readTelegram: async () => true, readRows: async () => [] });
  await readPositions(store, OWNER, NOW, deps({ held: new Map(), frozen: new Set(), complete: false }));
  assert.equal((await readPositionWatch(store, OWNER, NVDAX)).closedAt, null, "one program silent: the token may be in it");
  const held = await readPositions(store, OWNER, NOW, deps({ held: new Map([[NVDAX, 5_000_000n]]), frozen: new Set(), complete: true }));
  assert.equal(held.positions[0].exit.source, "watch");
  assert.equal(held.positions[0].state, "on-plan");
  await readPositions(store, OWNER, NOW, deps({ held: new Map(), frozen: new Set(), complete: true }));
  assert.equal((await readPositionWatch(store, OWNER, NVDAX)).closedAt, new Date(NOW).toISOString());
});

test("«Ryntra попередить» counts its figures from the price it is given, afresh on every call, and reopens a closed watch as new", async () => {
  const store = createMemoryGuardStore();
  const first = await setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "careful", basisPerUnit: 180, basisObservedAt: FRESH, locale: "uk" }, NOW);
  assert.deepEqual([first.limitPerUnit, first.targetPerUnit, first.stopPct, first.targetPct], [171, 198, 5, 10]);
  assert.equal(first.version, 0);
  const again = await setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "balanced", basisPerUnit: 200, basisObservedAt: FRESH, locale: "en" }, NOW + 1_000);
  assert.deepEqual([again.limitPerUnit, again.targetPerUnit, again.version, again.createdAt, again.locale], [180, 240, 1, first.createdAt, "en"]);
  assert.equal(await closePositionWatch(store, OWNER, NVDAX, NOW + 2_000), true);
  assert.equal(await closePositionWatch(store, OWNER, NVDAX, NOW + 3_000), false, "closed once");
  const reopened = await setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "careful", basisPerUnit: 150, basisObservedAt: FRESH, locale: "uk" }, NOW + 4_000);
  assert.equal(reopened.closedAt, null);
  assert.equal(reopened.createdAt, new Date(NOW + 4_000).toISOString(), "a new position is a new watch");
  assert.equal((await listPositionWatches(store, OWNER)).length, 1);
  await assert.rejects(setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "careful", basisPerUnit: 0, basisObservedAt: FRESH, locale: "uk" }, NOW));
  /* Another wallet reads nothing of it. */
  assert.equal(await readPositionWatch(store, "Ex4mp1eWa11etAddre55Ex4mp1eWa11etAddre55Ex4", NVDAX), null);
  assert.deepEqual(watchFigures("balanced", 0.012345), { limitPerUnit: 0.0111105, targetPerUnit: 0.014814, stopPct: 10, targetPct: 20 });
});
