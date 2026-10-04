import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { accruePoints } from "../points/accrue.ts";
import { recordPointsEntries } from "../points/ledger.ts";
import { USD_MICROS } from "../points/policy.ts";
import { isPointsSort, projectPointsLedger, projectPointsTable } from "./points.ts";
import { readPointsLedger, readPointsTable } from "./points.server.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OWNER = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const NOW = "2026-09-11T12:00:00.000Z";
const OLD = "2026-07-01T12:00:00.000Z";

let counter = 0;
function swap(wallet, dollars, at = NOW) {
  counter += 1;
  const sig = `${counter}`.padStart(2, "1") + "VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZk";
  return {
    schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet",
    wallet, actionId: sig, lane: "SWAP", outcome: "DONE",
    out: { mint: USDC, amountRaw: (BigInt(dollars) * USD_MICROS).toString(), decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "1000", decimals: null, symbol: null },
    destination: null, signature: sig, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null,
    startedAt: at, updatedAt: at,
  };
}
const accrue = (action, at = NOW, extra = {}) =>
  accruePoints({ action, statedUsd: null, internal: false, dayEntries: [], priorActiveDays: 0, referrerL1: null, referrerAlreadyQualified: false, settledAt: at, now: at, ...extra }).entries;

const entries = [
  ...accrue(swap(A, 2_000, OLD), OLD),
  ...accrue(swap(A, 300)),
  ...accrue(swap(B, 500), NOW, { referrerL1: A }),
  ...accrue(swap(C, 50)),
  ...accrue(swap(OWNER, 50_000)),
];
const presence = [{ wallet: A, firstSeenAt: "2026-06-30T00:00:00.000Z", lastSeenAt: NOW, sessions: 3, firstVerifiedAt: null, lastVerifiedAt: null, verifications: 0 }];
const edges = [{ referrer: A, wallet: B, level: 1, at: NOW }, { referrer: A, wallet: C, level: 2, at: NOW }];
const base = { now: NOW, scope: "external", sort: "points", entries, presence, edges, internalWallets: new Set([OWNER]) };

test("the table carries the required columns, external wallets only, in rank order", () => {
  const model = projectPointsTable(base);
  assert.equal(model.policyVersion, "1.0.0");
  assert.equal(model.ranked, 3);
  assert.equal(model.internalWallets, 1);
  assert.deepEqual(model.rows.map((row) => [row.rank, row.walletFull, row.points, row.level]), [
    [1, A, "1920", 2],
    [2, B, "510", 1],
    [3, C, "60", 1],
  ]);
  const a = model.rows[0];
  assert.equal(a.wallet, "6dNV…XbLp");
  assert.equal(a.internal, false);
  assert.equal(a.lifetimeVolumeUsd, 2_300);
  assert.equal(a.volume30dUsd, 300, "the July trade is outside thirty days");
  assert.equal(a.trades, 2);
  assert.equal(a.activeDays, 2);
  assert.equal(a.referrals, 1, "level-1 edges only");
  assert.equal(a.firstSeenAt, "2026-06-30T00:00:00.000Z", "presence wins where it exists");
  assert.equal(a.lastActiveAt, NOW);
  assert.equal(model.rows[1].firstSeenAt, NOW, "else the first points row");
  assert.deepEqual(model.totals, { points: "2490", lifetimeVolumeUsd: 2_850, trades: 4 });
});

test("the four sorts order as named; the internal wallet joins only under all activity, tagged and unranked", () => {
  const byVolume = projectPointsTable({ ...base, sort: "volume" }).rows.map((row) => row.walletFull);
  assert.deepEqual(byVolume, [A, B, C]);
  const byActive = projectPointsTable({ ...base, sort: "active" }).rows.map((row) => row.walletFull);
  assert.equal(byActive[0], A, "two active days first");
  const byNewest = projectPointsTable({ ...base, sort: "newest" }).rows.map((row) => row.walletFull);
  assert.equal(byNewest[byNewest.length - 1], A, "the July starter is the oldest");
  const all = projectPointsTable({ ...base, scope: "all" });
  const owner = all.rows.find((row) => row.walletFull === OWNER);
  assert.ok(owner);
  assert.equal(owner.internal, true);
  assert.equal(owner.rank, null);
  assert.equal(all.rows[0].walletFull, OWNER, "sorted by points it is first, and still unranked");
  assert.deepEqual(all.totals, { points: "2490", lifetimeVolumeUsd: 2_850, trades: 4 }, "the totals never count an internal wallet");
  assert.equal(isPointsSort("points"), true);
  assert.equal(isPointsSort("balance"), false);
});

test("the ledger projection keeps every audit field a row carries", () => {
  const ledger = projectPointsLedger(entries.filter((entry) => entry.wallet === A));
  assert.equal(ledger.length, 5, "two trades, two active days, one referral bonus");
  assert.equal(ledger[0].createdAt, NOW, "newest first");
  const referral = ledger.find((row) => row.reason === "QUALIFIED_REFERRAL");
  assert.equal(referral.trader, B);
  assert.equal(referral.points, "100");
  const trade = ledger.find((row) => row.reason === "TRADE_VOLUME" && row.day === "2026-07-01");
  assert.equal(trade.volumeUsd, 2_000);
  assert.equal(trade.valuation, "STABLECOIN_PAR");
  assert.equal(trade.dayVolumeBeforeUsd, 0);
  assert.equal(trade.surface, "SWAP");
  assert.equal(trade.lane, "SWAP");
  assert.equal(trade.policyVersion, "1.0.0");
  assert.match(trade.eventId, /^TRADE_VOLUME:/);
  assert.equal(trade.operationRef, trade.actionId);
});

test("the server read scans the store and reports its sources", async () => {
  const store = createMemoryGuardStore();
  await recordPointsEntries(store, entries);
  const read = await readPointsTable(store, { now: NOW, scope: "external", sort: "points", env: { RYNTRA_INTERNAL_WALLETS: OWNER } });
  assert.deepEqual(read.sources, { points: "measured", presence: "measured", referrals: "measured" });
  assert.equal(read.model.rows.length, 3);
  assert.equal(read.model.rows[0].walletFull, A);
  assert.equal(read.model.rows[0].referrals, 0, "no edges were written to this store");
  const ledger = await readPointsLedger(store, C);
  assert.equal(ledger.length, 2);
});
