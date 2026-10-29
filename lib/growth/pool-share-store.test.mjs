import assert from "node:assert/strict";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { appendPoolShareRows, journalPoolShares, readPoolShareRows, readPoolShareTotals, recordStream1 } from "./pool-share-store.ts";

const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const DEMO = "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const DEMO_POOL = "9qyVyLMRoCwGxDRscUJ6Ae8QV1vUKoQRy8NZch3XvRaX";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRADER = "TraderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVITER = "InviterBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NOW = "2026-10-13T17:00:00.000Z";
const registry = ATTRIBUTION_REGISTRY;

const claimRow = (over = {}) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: INVITER, source: "curve", claimer: SAFE,
  claim: { tx: "sigA", index: "1.0", block: 1, at: "2026-10-13T16:00:00.000Z", finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: "47824", receivedRaw: "47824", tokenRaw: "0", rule: "ALL", usdMicros: "47824",
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: NOW, ...over,
});

test("a repeated claim writes nothing the second time; a different one under the same key is a conflict, the first stands", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await appendPoolShareRows(store, [claimRow()]), { created: 1, existing: 0, refused: [], conflicts: [] });
  assert.deepEqual(await appendPoolShareRows(store, [claimRow({ recordedAt: "2026-10-13T18:00:00.000Z" })]), { created: 0, existing: 1, refused: [], conflicts: [] });
  const conflict = await appendPoolShareRows(store, [claimRow({ claimedRaw: "1", receivedRaw: "1", usdMicros: "1" })]);
  assert.equal(conflict.created, 0);
  assert.deepEqual(conflict.conflicts, [{ key: `solana:${POOL}:claim:sigA:1.0` }]);
  const rows = await readPoolShareRows(store, { network: "solana", pool: POOL });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].claimedRaw, "47824");
  assert.equal(rows[0].recordedAt, NOW);
});

test("the same claim read back with its keys in another order or a later price is not a conflict", async () => {
  const store = createMemoryGuardStore();
  await appendPoolShareRows(store, [claimRow()]);
  const { kind, schema, ...rest } = claimRow();
  const reordered = { ...rest, kind, schema, usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } };
  assert.deepEqual(await appendPoolShareRows(store, [reordered]), { created: 0, existing: 1, refused: [], conflicts: [] });
  assert.equal((await appendPoolShareRows(store, [claimRow({ receivedRaw: "47825" })])).refused.length, 1, "more received than claimed is refused");
});

test("a claim that is not finalized is refused, never written", async () => {
  const store = createMemoryGuardStore();
  const outcome = await appendPoolShareRows(store, [claimRow({ claim: { ...claimRow().claim, finality: "confirmed" } })]);
  assert.equal(outcome.created, 0);
  assert.equal(outcome.refused.length, 1);
  assert.deepEqual(await readPoolShareRows(store), []);
});

test("a split claim is read back for each pool it credits", async () => {
  const store = createMemoryGuardStore();
  const A = `0x${"a".repeat(64)}`;
  const B = `0x${"b".repeat(64)}`;
  await appendPoolShareRows(store, [claimRow({
    network: "arc", chain: "eip155:5042", pool: null, source: "hook", rule: "OLDEST_CREDIT", tokenRaw: null, claimedRaw: "250", receivedRaw: "250", usdMicros: "250",
    asset: { mint: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    allocation: [{ pool: A, creator: null, receivedRaw: "100", usdMicros: "100" }, { pool: B, creator: null, receivedRaw: "150", usdMicros: "150" }],
  })]);
  assert.equal((await readPoolShareRows(store, { network: "arc", pool: A })).length, 1);
  assert.equal((await readPoolShareRows(store, { network: "arc", pool: B })).length, 1);
  assert.equal((await readPoolShareRows(store, { network: "arc", pool: `0x${"c".repeat(64)}` })).length, 0);
});

const entry = (type, recipient, usdMicros, sig = "trade1") => ({
  version: 0, type, recipient, rateBps: type === "CASHBACK" ? 5_000 : 1_000, shareRaw: "10", usdMicros,
  valuation: usdMicros === null ? { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } : { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null },
  source: { mechanism: "METEORA_LAUNCH", operationRef: sig, trader: TRADER, grossRaw: "20", asset: USDC, symbol: "USDC", decimals: 6, settledAt: "2026-10-13T15:00:00.000Z" },
  createdAt: "2026-10-13T15:00:01.000Z", claimId: null, signature: null,
});

async function seedTrade(store, sig, entries, { trade = "mainnet", config = PROTECTED, curve = POOL } = {}) {
  await store.versioned("rewardAccruals").compareAndSet(`METEORA_LAUNCH:${sig}`, null, { version: 0, trader: TRADER, entries });
  if (trade) await store.collection("launchTradeRecords").set(`${trade}:${sig}`, { cluster: trade, signature: sig, wallet: TRADER, venue: "curve", curve, config, state: "DONE", settledAt: "2026-10-13T15:00:00.000Z" });
}

test("stream 1 beside the claims: one row per launch-fee accrual of a counted pool, written once; the demo market and devnet give nothing", async () => {
  const store = createMemoryGuardStore();
  await seedTrade(store, "trade1", [entry("CASHBACK", TRADER, "5000"), entry("REFERRAL_L1", INVITER, "1000")]);
  await seedTrade(store, "demo1", [entry("CASHBACK", TRADER, "777", "demo1")], { config: DEMO, curve: DEMO_POOL });
  await seedTrade(store, "dev1", [entry("CASHBACK", TRADER, "5", "dev1")], { trade: "devnet" });
  /* A Jupiter accrual is not stream 1 of any launch pool. */
  await store.versioned("rewardAccruals").compareAndSet("JUPITER_REFERRAL:swap1", null, { version: 0, trader: TRADER, entries: [{ ...entry("CASHBACK", TRADER, "9", "swap1"), source: { ...entry("CASHBACK", TRADER, "9").source, mechanism: "JUPITER_REFERRAL", operationRef: "swap1" } }] });
  const first = await recordStream1(store, { registry, now: NOW });
  assert.deepEqual(first, { created: 1, existing: 0, pending: [], excluded: 2, refused: 0, conflicts: 0 });
  const again = await recordStream1(store, { registry, now: NOW });
  assert.equal(again.created, 0);
  assert.equal(again.existing, 1);
  const rows = await readPoolShareRows(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "STREAM1");
  assert.equal(rows[0].pool, POOL);
  assert.equal(rows[0].usdMicros, "6000");
  assert.equal(rows[0].entries, 2);
});

test("an unvalued reward keeps its trade pending — the pool's stream 1 is no data meanwhile, then the core's valuation is read", async () => {
  const store = createMemoryGuardStore();
  await appendPoolShareRows(store, [claimRow()]);
  await seedTrade(store, "trade2", [entry("CASHBACK", TRADER, null, "trade2")]);
  const pending = await recordStream1(store, { registry, now: NOW });
  assert.equal(pending.created, 0);
  assert.deepEqual(pending.pending.map((item) => [item.operationRef, item.pool]), [["trade2", POOL]]);
  const [open] = await readPoolShareTotals(store, { registry });
  assert.equal(open.stream1UsdMicros, null);
  assert.equal(open.stream1Pending, 1);
  await store.collection("rewardEntries").set(`${TRADER}:ADJUSTMENT:valuation:METEORA_LAUNCH:trade2:CASHBACK`, entry("ADJUSTMENT", TRADER, "4200", "trade2"));
  const [ready] = await readPoolShareTotals(store, { registry });
  assert.equal(ready.stream1UsdMicros, null, "ready but not written yet is still open, not a smaller sum");
  assert.equal(ready.stream1Pending, 1);
  assert.equal((await recordStream1(store, { registry, now: NOW })).created, 1);
  const [closed] = await readPoolShareTotals(store, { registry });
  assert.equal(closed.stream1UsdMicros, "4200");
  assert.equal(closed.stream1Pending, 0);
});

test("a trade not yet traced to any pool leaves every pool's stream 1 open", async () => {
  const store = createMemoryGuardStore();
  await appendPoolShareRows(store, [claimRow()]);
  await seedTrade(store, "lost1", [entry("CASHBACK", TRADER, "7", "lost1")], { trade: null });
  const [total] = await readPoolShareTotals(store, { registry });
  assert.equal(total.stream1UsdMicros, null);
});

test("a read that failed is no data — nothing written, not a network with zero claims", async () => {
  const store = createMemoryGuardStore();
  const report = await journalPoolShares(store, {
    solana: { state: "NO_DATA", reason: "Solana: HTTP 429" },
    arc: { state: "OK", rows: [], chain: [], skipped: [], pending: [] },
  }, { registry, now: NOW });
  assert.deepEqual(report.networks.solana, { state: "NO_DATA", reason: "Solana: HTTP 429" });
  assert.equal(report.networks.arc.state, "OK");
  assert.deepEqual(await readPoolShareTotals(store, { registry }), []);
});

test("both sums per pool, side by side", async () => {
  const store = createMemoryGuardStore();
  await seedTrade(store, "trade1", [entry("CASHBACK", TRADER, "5000"), entry("REFERRAL_L1", INVITER, "1000")]);
  await journalPoolShares(store, { solana: { state: "OK", rows: [claimRow()], chain: [], skipped: [], pending: [] } }, { registry, now: NOW });
  assert.deepEqual(await readPoolShareTotals(store, { registry }), [
    { network: "solana", pool: POOL, claims: 1, receivedUsdMicros: "47824", valuedUsdMicros: "47824", unvaluedClaims: 0, stream1UsdMicros: "6000", stream1Operations: 1, stream1Pending: 0 },
  ]);
});
