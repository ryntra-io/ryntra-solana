import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { bindReferrer, ensureRewardAccount } from "../rewards/ledger.ts";
import { accruePoints } from "./accrue.ts";
import {
  groupByWallet,
  listAllPointsEntries,
  listPointsDay,
  listPointsEntries,
  pointsSummary,
  rankPoints,
  recordPointsEntries,
} from "./ledger.ts";
import { pointsEntryKey } from "./model.ts";
import { USD_MICROS } from "./policy.ts";
import { recordOperationPoints } from "./record.server.ts";
import { pointsView } from "./view.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OWNER = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const NOW = "2026-09-11T12:00:00.000Z";
const LATER = "2026-09-12T09:00:00.000Z";

let counter = 0;
function signature() {
  counter += 1;
  return `${counter}`.padStart(2, "1") + "VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZk";
}

function swap(wallet, dollars, overrides = {}) {
  const sig = signature();
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet,
    actionId: sig,
    lane: "SWAP",
    outcome: "DONE",
    out: { mint: USDC, amountRaw: (BigInt(dollars) * USD_MICROS).toString(), decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "1000", decimals: null, symbol: null },
    destination: null,
    signature: sig,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    startedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const pure = (action, extra = {}) =>
  accruePoints({
    action,
    statedUsd: null,
    internal: false,
    dayEntries: [],
    priorActiveDays: 0,
    referrerL1: null,
    referrerAlreadyQualified: false,
    settledAt: NOW,
    now: NOW,
    ...extra,
  });

test("a row is inserted once under its key, and a second read of the same settlement writes nothing", async () => {
  const store = createMemoryGuardStore();
  const accrual = pure(swap(A, 250));
  const first = await recordPointsEntries(store, accrual.entries);
  assert.equal(first.created.length, 2);
  assert.equal(first.existing, 0);
  const second = await recordPointsEntries(store, accrual.entries);
  assert.equal(second.created.length, 0);
  assert.equal(second.existing, 2);
  const rows = await listPointsEntries(store, A);
  assert.equal(rows.length, 2);
  const stored = await store.collection("pointsEntries").get(pointsEntryKey({ wallet: A, day: "2026-09-11", reason: "TRADE_VOLUME", ref: accrual.entries[0].source.actionId }));
  assert.equal(stored.points, "250");
  assert.deepEqual(await listPointsDay(store, A, "2026-09-12"), []);
  assert.equal((await listPointsDay(store, A, "2026-09-11")).length, 2);
});

test("the summary is a sum over rows: points, level, volume, trades, distinct days", () => {
  const day1 = pure(swap(A, 900));
  const day1b = pure(swap(A, 200), { dayEntries: day1.entries });
  const day2 = pure(swap(A, 50, { updatedAt: LATER }), { settledAt: LATER, now: LATER });
  const unvalued = pure(swap(A, 1, { out: { mint: SOL, amountRaw: "5", decimals: null, symbol: null }, in: { mint: BONK, amountRaw: "7", decimals: null, symbol: null }, updatedAt: LATER }), { settledAt: LATER, now: LATER });
  const rows = [...day1.entries, ...day1b.entries, ...day2.entries, ...unvalued.entries];
  const summary = pointsSummary(rows);
  assert.equal(summary.points, 900n + 10n + 150n + 50n + 10n + 0n);
  assert.equal(summary.level, 2);
  assert.equal(summary.nextLevelAt, 5_000n);
  assert.equal(summary.volumeUsdMicros, 1_150n * USD_MICROS);
  assert.equal(summary.trades, 4, "an unvalued trade is still a trade");
  assert.equal(summary.activeDays, 2);
  assert.equal(summary.byReason.ACTIVE_DAY, 20n);
  assert.equal(summary.firstEarnedAt, NOW);
  assert.equal(summary.lastActiveAt, LATER);
  assert.deepEqual(pointsSummary([]).points, 0n);
  assert.equal(pointsSummary([]).firstEarnedAt, null);
});

test("rank is among external wallets only, points first, the earlier first row breaking ties", () => {
  const a = pure(swap(A, 500));
  const b = pure(swap(B, 500, { updatedAt: LATER }), { settledAt: LATER, now: LATER });
  const c = pure(swap(C, 20));
  const owner = pure(swap(OWNER, 100_000));
  const all = [...a.entries, ...b.entries, ...c.entries, ...owner.entries];
  const ranking = rankPoints(all, new Set([OWNER]));
  assert.deepEqual(ranking.order, [A, B, C], "the owner's wallet is not in the order at all");
  assert.equal(ranking.rankOf(A), 1);
  assert.equal(ranking.rankOf(B), 2, "equal points, later first row");
  assert.equal(ranking.rankOf(C), 3);
  assert.equal(ranking.rankOf(OWNER), null);
  assert.equal(ranking.rankOf("nobody"), null);
  assert.equal(groupByWallet(all).size, 4);

  const view = pointsView({ entries: a.entries, wallet: A, ranking });
  assert.deepEqual(view, {
    points: "510",
    level: 1,
    levelFrom: "0",
    nextLevelAt: "1 000",
    rank: 1,
    ranked: 3,
    volume: "$500.00",
    trades: 1,
    activeDays: 1,
    policyVersion: "1.0.0",
  });
  const ownerView = pointsView({ entries: owner.entries, wallet: OWNER, ranking });
  assert.equal(ownerView.rank, null, "an internal wallet sees its points and no rank");
  assert.equal(ownerView.points, "10 010");
});

test("recordOperationPoints reads the day, the inviter and the internal list, and never throws", async () => {
  const store = createMemoryGuardStore();
  const env = { RYNTRA_INTERNAL_WALLETS: OWNER };

  /* B is invited by A, through the rewards ledger's own graph. */
  const inviter = await ensureRewardAccount(store, A, NOW);
  assert.equal((await bindReferrer(store, { wallet: B, code: inviter.code, now: NOW })).ok, true);

  const first = await recordOperationPoints(store, { action: swap(B, 300), settledAt: NOW, now: NOW, env });
  assert.equal(first.state, "RECORDED");
  assert.equal(first.created, 3, "trade, active day, and the inviter's bonus");
  assert.equal(first.points, "410", "300 for the trade, 10 for the day, 100 to the inviter");
  const inviterRows = await listPointsEntries(store, A);
  assert.deepEqual(inviterRows.map((row) => [row.reason, row.points, row.source.trader]), [["QUALIFIED_REFERRAL", "100", B]]);

  /* The same settlement read again writes nothing new. */
  const again = await recordOperationPoints(store, { action: swap(B, 300, { actionId: (await listPointsEntries(store, B)).find((r) => r.reason === "TRADE_VOLUME").source.actionId }), settledAt: NOW, now: NOW, env });
  assert.equal(again.state, "RECORDED");
  assert.equal(again.created, 0);
  assert.equal(again.existing, 3, "the original atomic award is returned without recalculating any of its bonuses");

  /* A second trade the same day continues the tier and earns no second active day or bonus. */
  const second = await recordOperationPoints(store, { action: swap(B, 800), settledAt: NOW, now: NOW, env });
  assert.equal(second.state, "RECORDED");
  assert.equal(second.created, 1);
  assert.equal(second.points, "750", "$700 at 1.0 then $100 at 0.5");
  assert.equal((await listPointsEntries(store, A)).length, 1, "the inviter's bonus stays one row");

  /* B's next active day earns the day bonus and no referral bonus. */
  const nextDay = await recordOperationPoints(store, { action: swap(B, 40, { updatedAt: LATER }), settledAt: LATER, now: LATER, env });
  assert.equal(nextDay.created, 2);
  assert.equal((await listPointsEntries(store, A)).length, 1);

  /* The owner's wallet earns nothing at the source. */
  const internal = await recordOperationPoints(store, { action: swap(OWNER, 5_000), settledAt: NOW, now: NOW, env });
  assert.equal(internal.state, "SKIPPED");
  assert.match(internal.reason, /internal/);
  assert.deepEqual(await listPointsEntries(store, OWNER), []);

  /* An unsettled or non-trade row is refused before any read. */
  assert.equal((await recordOperationPoints(store, { action: swap(C, 5, { outcome: "IN_FLIGHT" }), settledAt: NOW, env })).state, "SKIPPED");
  assert.equal((await recordOperationPoints(store, { action: swap(C, 5, { lane: "SEND" }), settledAt: NOW, env })).state, "SKIPPED");

  /* A store that fails is a skipped write, never a thrown one. */
  const broken = {
    collection: () => ({
      get: async () => undefined,
      insertIfAbsent: async () => { throw new Error("store down"); },
      valuesWithPrefix: async () => { throw new Error("store down"); },
    }),
    versioned: () => ({
      get: async () => { throw new Error("store down"); },
      insertIfAbsent: async () => { throw new Error("store down"); },
      valuesWithPrefix: async () => { throw new Error("store down"); },
      compareAndSet: async () => { throw new Error("store down"); },
    }),
    compareAndSetMany: async () => false,
  };
  const failed = await recordOperationPoints(broken, { action: swap(C, 5), settledAt: NOW, env });
  assert.equal(failed.state, "SKIPPED");
  assert.match(failed.reason, /store down|could not/);

  const everything = await listAllPointsEntries(store);
  assert.equal(everything.length, 3 + 1 + 2);
});
