/* CITY-204 — the money autopilot: the split, the care, the book and the agent's pass, on fixtures. No network, no key. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../guard/store.ts";
import { entryKey, writeEntry } from "../mandate/book.server.ts";
import { BUDGET_PRESETS } from "../mandate/presets.ts";
import { CARE, DEFAULT_RULES, PILOT_PARTS, RESERVE_MIN_LAMPORTS, legsOf, planData, planFromData, rulesOf, splitOf, targetsOf, tradeLamports, tradePresetFor } from "./plan.ts";
import { careOf, earnedOf, fallOf, weekOf, withMark, withSnap, WEEK_MS } from "./care.ts";
import { JOIN_FRESH_MS, joinPilot, readPilot } from "./book.server.ts";
import { CARE_EVERY_MS, legWorth, runPilotPass, setHold } from "./pass.server.ts";

const SOL = 1_000_000_000n;
const USDC = 1_000_000n;
const HOUR = 3_600_000;
const sum = (shares) => PILOT_PARTS.reduce((a, p) => a + shares[p], 0);
const OWNER = "7vXy2kQ3G1YfR8wN5mLp4sTz9cHjD6bA2eKuF3gWqPxV";
const POLICY = "9pQr5tUvW2xYz3aBcD4eFgH5iJkL6mNo7pQrS8tUvWxY";
const SIG = "5".repeat(88);

/* ---------------------------------------------------------------- the split */

test("2 SOL and 100 USDC, nothing named: the reserve, a capped trade of the city's one mainnet budget, the pier and the savings", () => {
  const split = splitOf({ solRaw: 2n * SOL, usdcRaw: 100n * USDC, named: {} }, "mainnet", 150);
  assert.ok(split);
  assert.equal(split.preset, "small");
  assert.equal(split.legs.trade.solRaw, tradeLamports("small"));
  assert.equal(split.capped, true, "15 % of the budget is more than 0.1 SOL a day");
  assert.equal(split.legs.save.usdcRaw, 100n * USDC, "USDC goes to the savings first");
  assert.ok(split.legs.save.solRaw > 0n);
  assert.ok(split.legs.pool.solRaw > 0n);
  assert.ok(split.legs.reserve.solRaw >= RESERVE_MIN_LAMPORTS);
  const total = split.legs.trade.solRaw + split.legs.save.solRaw + split.legs.pool.solRaw + split.legs.reserve.solRaw;
  assert.equal(total, 2n * SOL, "every lamport is in one part");
  assert.equal(split.legs.save.usdcRaw + split.legs.reserve.usdcRaw, 100n * USDC);
  assert.equal(sum(split.shares), 10_000);
  assert.deepEqual(split.dropped, []);
});

test("shares said are kept; a part named without one takes what is left", () => {
  assert.deepEqual(targetsOf({ save: 4_000, pool: 3_000, trade: true }), { trade: 3_000, save: 4_000, pool: 3_000 });
  assert.deepEqual(targetsOf({}), { trade: 1_500, save: 5_500, pool: 3_000 });
  assert.deepEqual(targetsOf({ save: true }), { trade: 0, save: 10_000, pool: 0 });
  /* More than the whole, read as weights of it. */
  assert.deepEqual(targetsOf({ save: 8_000, pool: 8_000 }), { trade: 0, save: 5_000, pool: 5_000 });
});

test("a small budget: the reserve first; a part that cannot take its minimum stays in the wallet", () => {
  const split = splitOf({ solRaw: SOL / 10n, usdcRaw: 0n, named: {} }, "mainnet", 150);
  assert.ok(split);
  assert.equal(split.preset, null);
  assert.ok(split.dropped.includes("trade"));
  assert.ok(split.dropped.includes("pool"));
  assert.ok(split.legs.save.solRaw > 0n, "the savings take SOL above $1");
  assert.equal(split.legs.reserve.solRaw + split.legs.save.solRaw, SOL / 10n);
});

test("the trade's budget is the network's: mainnet only 0.1 SOL a day, devnet the largest under the share", () => {
  assert.equal(tradePresetFor("mainnet", 10n * SOL), "small");
  assert.equal(tradePresetFor("devnet", 10n * SOL), "large");
  assert.equal(tradePresetFor("devnet", BUDGET_PRESETS.medium.budget + BUDGET_PRESETS.medium.agentFee), "medium");
  assert.equal(tradePresetFor("mainnet", SOL / 20n), null);
  const devnet = splitOf({ solRaw: 2n * SOL, usdcRaw: 0n, named: { trade: true } }, "devnet", 150);
  assert.equal(devnet.preset, "large", "devnet: the whole SOL past the reserve may trade");
});

test("a trade named by name gets the smallest budget even under its share", () => {
  const split = splitOf({ solRaw: SOL / 2n, usdcRaw: 0n, named: { trade: 500, save: true } }, "mainnet", 150);
  assert.equal(split.preset, "small");
  assert.equal(split.capped, false);
});

test("SOL's price not read: one asset weighs in its own units, two cannot be weighed", () => {
  assert.equal(splitOf({ solRaw: SOL, usdcRaw: 10n * USDC, named: {} }, "mainnet", null), null);
  const usdc = splitOf({ solRaw: 0n, usdcRaw: 50n * USDC, named: { save: true } }, "mainnet", null);
  assert.equal(usdc.legs.save.usdcRaw, 50n * USDC);
  assert.equal(splitOf({ solRaw: 0n, usdcRaw: 0n, named: {} }, "mainnet", 150), null);
});

test("the plan as data: round trip, and anything the city does not write is refused", () => {
  const split = splitOf({ solRaw: 2n * SOL, usdcRaw: 100n * USDC, named: {} }, "mainnet", 150);
  const data = planData(split);
  const back = planFromData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(back, data);
  assert.deepEqual(legsOf(back), split.legs);
  assert.equal(planFromData({ ...data, legs: { ...data.legs, trade: { solRaw: "5000000000" } } }), null, "a trade part that is not a budget of the city's");
  assert.equal(planFromData({ ...data, shares: { ...data.shares, reserve: data.shares.reserve + 1 } }), null);
  assert.equal(planFromData({ ...data, preset: "huge" }), null);
  assert.equal(planFromData({ ...data, legs: { ...data.legs, save: { solRaw: "-1", usdcRaw: "0" } } }), null);
  assert.deepEqual(rulesOf({ bandBps: 50, crashBps: 99_999 }), { bandBps: CARE.bandBps.min, crashBps: CARE.crashBps.max });
  assert.deepEqual(rulesOf(null), DEFAULT_RULES);
});

/* ---------------------------------------------------------------- the care */

const T0 = Date.UTC(2026, 10, 5, 12);
const targets = { trade: 1_500, save: 5_000, pool: 3_000, reserve: 500 };
const even = { trade: 15, save: 50, pool: 30, reserve: 5 };
const marksFalling = (fromPrice, toPrice) => [
  { at: T0 - 20 * HOUR, price: fromPrice },
  { at: T0 - 10 * HOUR, price: (fromPrice + toPrice) / 2 },
  { at: T0 - 10 * 60_000, price: toPrice },
];
const working = { status: "working", pausedBy: null, since: T0 - HOUR };

test("a sharp fall holds the trade; a figure not read moves nothing", () => {
  const fall = careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 170), trade: working, values: even });
  assert.equal(fall.fallBps, 1_500);
  assert.deepEqual(fall.trade, { do: "hold", why: "market" });
  const calm = careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 196), trade: working, values: even });
  assert.deepEqual(calm.trade, { do: "leave" });
  /* The newest price is old: not the price now. */
  const stale = careOf({ rules: DEFAULT_RULES, targets, now: T0 + 2 * HOUR, marks: marksFalling(200, 170), trade: working, values: even });
  assert.equal(stale.fallBps, null);
  assert.deepEqual(stale.trade, { do: "leave" });
});

test("held for the market: it goes on once calm, and not before six hours", () => {
  const held = { status: "paused", pausedBy: "market", since: T0 - 2 * HOUR };
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 197), trade: held, values: even }).trade, { do: "leave" }, "calm, but too soon");
  const later = { ...held, since: T0 - 7 * HOUR };
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 197), trade: later, values: even }).trade, { do: "go" });
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 188), trade: later, values: even }).trade, { do: "leave" }, "6 % down: not calm yet");
  /* Calm again, but the trade's part is over its share: the hold changes its reason. */
  const heavy = { trade: 40, save: 35, pool: 20, reserve: 5 };
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 199), trade: later, values: heavy }).trade, { do: "hold", why: "balance" });
});

test("a part grown past its share: the trade's buys hold, and go on within half the band", () => {
  const heavy = { trade: 30, save: 40, pool: 25, reserve: 5 };
  const care = careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 199), trade: working, values: heavy });
  assert.deepEqual(care.trade, { do: "hold", why: "balance" });
  assert.deepEqual(care.drift, ["trade"]);
  const held = { status: "paused", pausedBy: "balance", since: T0 - HOUR };
  const lighter = { trade: 19, save: 48, pool: 28, reserve: 5 };
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: [], trade: held, values: lighter }).trade, { do: "go" });
  const still = { trade: 26, save: 41, pool: 28, reserve: 5 };
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: [], trade: held, values: still }).trade, { do: "leave" });
});

test("the person's own exit, a loss, a trade no longer working: never touched by the care", () => {
  for (const pausedBy of ["take", "stop", "loss", "losses", "failing", "unread"]) {
    const trade = { status: "paused", pausedBy, since: T0 - 30 * HOUR };
    assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 150), trade, values: even }).trade, { do: "leave" }, pausedBy);
  }
  for (const status of ["stopped", "ended", "spent"]) assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: marksFalling(200, 150), trade: { status, pausedBy: null, since: T0 }, values: even }).trade, { do: "leave" });
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: [], trade: null, values: even }).trade, { do: "leave" });
  /* A value not read: no shares, no balance hold, no drift. */
  const unread = careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: [], trade: working, values: { ...even, pool: null } });
  assert.equal(unread.shares, null);
  assert.deepEqual(unread.trade, { do: "leave" });
  assert.deepEqual(unread.drift, []);
});

test("SOL's marks: at most every quarter hour, two days kept; the fall from the day's high", () => {
  let marks = [];
  marks = withMark(marks, T0, 200);
  marks = withMark(marks, T0 + 60_000, 100);
  assert.equal(marks.length, 1);
  marks = withMark(marks, T0 + CARE.markEveryMs, 180);
  assert.equal(fallOf(marks, T0 + CARE.markEveryMs), 1_000);
  marks = withMark(marks, T0 + 3 * 86_400_000, 190);
  assert.equal(marks.length, 1);
  assert.equal(withMark(marks, T0 + 4 * 86_400_000, Number.NaN), marks);
});

test("the week: from the start for a young plan, the difference after; a minus is a minus", () => {
  let snaps = withSnap([], T0, 0);
  snaps = withSnap(snaps, T0 + HOUR, 5);
  assert.equal(snaps.length, 1, "a few snaps a day");
  assert.equal(weekOf(snaps, T0 + 2 * 86_400_000, 3.5), 3.5);
  snaps = withSnap(snaps, T0 + 7 * HOUR, 2);
  snaps = withSnap(snaps, T0 + 2 * 86_400_000, 4);
  assert.equal(weekOf(snaps, T0 + WEEK_MS + 8 * HOUR, 1), -1, "a week after the 2 USD snap: 1 − 2");
  assert.equal(weekOf(snaps, T0, null), null);
  assert.equal(earnedOf({ tradeUsd: -1.25, saveUsd: 0.5, poolUsd: null }, { trade: true, save: true, pool: false }), -0.75);
  assert.equal(earnedOf({ tradeUsd: -1.25, saveUsd: 0.5, poolUsd: null }, { trade: true, save: true, pool: true }), null, "a part not read leaves the whole unread");
});

test("a leg's part of a Lend position: grown by its rate, never more than it holds", () => {
  assert.equal(legWorth(100n, { underlyingRaw: 220n, depositedRaw: 200n }), 110n);
  assert.equal(legWorth(300n, { underlyingRaw: 220n, depositedRaw: 200n }), 220n);
  assert.equal(legWorth(100n, { underlyingRaw: null, depositedRaw: 200n }), null);
  assert.equal(legWorth(0n, null), 0n);
});

/* ---------------------------------------------------------------- the book */

const NOW = T0;
const plan = () => planData(splitOf({ solRaw: 2n * SOL, usdcRaw: 100n * USDC, named: {} }, "mainnet", 150));
const deps = (store, extra = {}) => ({
  store,
  cluster: "mainnet",
  mandate: async (policy) => (policy === POLICY ? { owner: OWNER, preset: "small", createdAt: NOW - 60_000, status: "working" } : null),
  landed: async () => ({ at: NOW - 30_000 }),
  solUsd: async () => 150,
  now: () => NOW,
  ...extra,
});
const legs = { saveUsdc: { signature: SIG }, saveSol: { signature: SIG }, pool: { signature: SIG, position: POLICY, pool: OWNER } };

test("a plan joins on what stands: its mandate, this wallet's; its legs, landed and hers", async () => {
  const store = createMemoryGuardStore();
  const joined = await joinPilot({ owner: OWNER, said: "працюй з моїми 2 SOL і 100 USDC", plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  assert.equal(joined.ok, true);
  assert.equal(joined.entry.status, "working");
  assert.equal(joined.entry.legs.saveUsdc.state, "landed");
  assert.equal(joined.entry.legs.pool.position, POLICY);
  assert.equal(joined.entry.startSolUsd, 150);
  assert.deepEqual((await readPilot(store, "mainnet", OWNER))?.policy, POLICY);
  /* The same plan again — a retry — keeps the first. */
  const again = await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store, { now: () => NOW + 1000 }));
  assert.equal(again.entry.createdAt, NOW);
});

test("a plan is refused when it hangs on what is not hers, or not new", async () => {
  const store = createMemoryGuardStore();
  const base = { owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false };
  assert.equal((await joinPilot({ ...base, policy: OWNER }, deps(store))).ok, false, "a mandate the agent does not work for");
  assert.equal((await joinPilot({ ...base, policy: null }, deps(store))).ok, false, "a trading plan without its mandate");
  const old = deps(store, { mandate: async () => ({ owner: OWNER, preset: "small", createdAt: NOW - JOIN_FRESH_MS - 1, status: "working" }) });
  assert.equal((await joinPilot(base, old)).ok, false, "a stranger's old mandate");
  assert.equal((await joinPilot({ ...base, proven: true }, old)).ok, true, "her own proven wallet may join it later");
  assert.equal((await joinPilot(base, deps(store, { landed: async () => null }))).ok, false, "a leg that did not land, or another payer's");
  assert.equal((await joinPilot(base, deps(store, { landed: async () => { throw new Error("rpc"); } }))).code, "UNAVAILABLE");
  assert.equal((await joinPilot({ ...base, plan: { ...plan(), preset: "large" } }, deps(store))).ok, false);
  assert.equal((await joinPilot({ ...base, legs: { ...legs, saveUsdc: { signature: "not-one" } } }, deps(store))).ok, false);
});

test("devnet: the savings and the pier run on paper; the trade is the mandate", async () => {
  const store = createMemoryGuardStore();
  const devPlan = planData(splitOf({ solRaw: 2n * SOL, usdcRaw: 0n, named: {} }, "devnet", 150));
  const joined = await joinPilot({ owner: OWNER, said: null, plan: devPlan, policy: POLICY, legs: {}, proven: false }, deps(store, { cluster: "devnet", mandate: async () => ({ owner: OWNER, preset: devPlan.preset, createdAt: NOW, status: "working" }) }));
  assert.equal(joined.ok, true);
  assert.equal(joined.entry.legs.saveSol.state, "paper");
  assert.equal(joined.entry.legs.pool.state, "paper");
});

/* ---------------------------------------------------------------- the pass */

const record = { owner: OWNER, settings: OWNER, vault: OWNER, policy: POLICY, budget: OWNER, perTrade: BUDGET_PRESETS.small.perTrade.toString(), perDay: BUDGET_PRESETS.small.perDay.toString(), expiresAt: String(Math.floor(NOW / 1000) + 86_400 * 30) };
const bookEntry = (status = "working", pausedBy) => ({ v: 1, cluster: "mainnet", record, preset: "small", strategy: "steady", said: null, receiveMint: OWNER, status, ...(pausedBy ? { pausedBy } : {}), trades: [], createdAt: NOW - 60_000, updatedAt: NOW - 60_000 });

function harness(store, price) {
  const state = { price, netRaw: 0n, stopped: false };
  const reads = {
    trade: async () => {
      const row = await store.collection("agentMandates").get(entryKey("mainnet", POLICY));
      return { state: { status: state.stopped ? "stopped" : row.status, pausedBy: row.pausedBy ?? null, since: row.updatedAt }, netRaw: state.netRaw };
    },
    lend: async () => ({ usdc: { underlyingRaw: 100_100_000n, depositedRaw: 100_000_000n }, sol: { underlyingRaw: 10n ** 18n, depositedRaw: 10n ** 18n } }),
    pier: async () => 75,
    solUsd: async () => state.price,
    hold: (policy, why, now) => setHold(store, "mainnet", policy, why, now),
    go: (policy, now) => setHold(store, "mainnet", policy, null, now),
  };
  return { state, reads };
}

test("the agent's pass: a sharp fall holds the trade in the agent's book, calm lets it go, her stop ends the plan", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry());
  const joined = await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  assert.equal(joined.ok, true);
  /* Marks of a day: SOL from 200 down to 170. */
  await store.collection("moneyPilots").set(`p:mainnet:${OWNER}`, { ...joined.entry, marks: [{ at: NOW - 20 * HOUR, price: 200 }] });
  const { state, reads } = harness(store, 170);

  let lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW });
  assert.deepEqual(lines, [{ owner: OWNER, did: "held" }]);
  let row = await store.collection("agentMandates").get(entryKey("mainnet", POLICY));
  assert.equal(row.status, "paused");
  assert.equal(row.pausedBy, "market");
  let pilot = await readPilot(store, "mainnet", OWNER);
  assert.equal(pilot.held.why, "market");
  assert.equal(pilot.events.at(-1).what, "hold");
  assert.equal(pilot.events.at(-1).fallBps, 1_500);
  assert.ok(pilot.care.weekUsd !== null, "the week is read: the savings' interest, the pier against its SOL");

  /* Within a quarter hour: nothing. */
  assert.deepEqual(await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW + 60_000 }), []);

  /* Seven hours later, SOL back near its high: the trade goes on. */
  state.price = 199;
  lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW + 7 * HOUR });
  assert.deepEqual(lines, [{ owner: OWNER, did: "went" }]);
  row = await store.collection("agentMandates").get(entryKey("mainnet", POLICY));
  assert.equal(row.status, "working");
  assert.equal(row.pausedBy, undefined);
  pilot = await readPilot(store, "mainnet", OWNER);
  assert.equal(pilot.held, undefined);

  /* Her own exit paused the book: the care leaves it. */
  await writeEntry(store, { ...bookEntry("paused", "take") });
  state.price = 120;
  lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW + 7 * HOUR + CARE_EVERY_MS });
  assert.deepEqual(lines, [{ owner: OWNER, did: "cared" }]);
  assert.equal((await store.collection("agentMandates").get(entryKey("mainnet", POLICY))).pausedBy, "take");

  /* She stopped the agent: the plan stops; the savings and the pier stay hers. */
  state.stopped = true;
  lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW + 8 * HOUR + CARE_EVERY_MS });
  assert.deepEqual(lines, [{ owner: OWNER, did: "stopped" }]);
  pilot = await readPilot(store, "mainnet", OWNER);
  assert.equal(pilot.status, "stopped");
  assert.deepEqual(await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW + 9 * HOUR + CARE_EVERY_MS }), []);
});

test("what the plan earned: the trade after fees, the interest, the pier against its SOL — a loss shows as one", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry());
  const p = plan();
  const joined = await joinPilot({ owner: OWNER, said: null, plan: p, policy: POLICY, legs, proven: false }, deps(store));
  const { state, reads } = harness(store, 150);
  state.netRaw = -SOL / 100n; /* the trade is 0.01 SOL down after every fee: −$1.50 */
  await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW });
  const pilot = await readPilot(store, "mainnet", OWNER);
  const l = legsOf(p);
  const poolPut = (Number(l.pool.solRaw) / 1e9) * 150;
  const expected = Math.round((-1.5 + 0.1 + (75 - poolPut)) * 100) / 100;
  assert.equal(pilot.care.earnedUsd, expected);
  assert.equal(pilot.care.weekUsd, expected);
  assert.equal(joined.ok, true);
});

test("setHold never lifts the book's own pause, never touches a mandate no longer working", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry("paused", "loss"));
  assert.equal(await setHold(store, "mainnet", POLICY, "market", NOW), false);
  assert.equal(await setHold(store, "mainnet", POLICY, null, NOW), false);
  await writeEntry(store, bookEntry("ended"));
  assert.equal(await setHold(store, "mainnet", POLICY, "market", NOW), false);
  await writeEntry(store, bookEntry("paused", "balance"));
  assert.equal(await setHold(store, "mainnet", POLICY, "market", NOW), true, "the market's hold over the balance's");
  assert.equal((await store.collection("agentMandates").get(entryKey("mainnet", POLICY))).pausedBy, "market");
  assert.equal(await setHold(store, "mainnet", "nobody", "market", NOW), false);
});

/* ---------------------------------------------------------------- what goes wrong */

test("what goes wrong: every read fails — the care switches nothing and invents no week", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry());
  await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  const fail = async () => { throw new Error("fetch failed"); };
  const reads = { trade: fail, lend: fail, pier: fail, solUsd: fail, hold: () => { throw new Error("no hold without a reading"); }, go: () => { throw new Error("no go without a reading"); } };
  const lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW });
  assert.deepEqual(lines, [{ owner: OWNER, did: "cared" }]);
  const pilot = await readPilot(store, "mainnet", OWNER);
  assert.equal(pilot.care.weekUsd, null);
  assert.equal(pilot.care.shares, null);
  assert.equal(pilot.status, "working");
  assert.equal((await store.collection("agentMandates").get(entryKey("mainnet", POLICY))).status, "working");
});

test("what goes wrong: a price jump up is no fall; the fall from its peak is", () => {
  const up = [{ at: T0 - 3 * HOUR, price: 150 }, { at: T0 - 10 * 60_000, price: 195 }];
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: up, trade: working, values: even }).trade, { do: "leave" });
  const back = [...up, { at: T0 - 60_000, price: 170 }];
  assert.deepEqual(careOf({ rules: DEFAULT_RULES, targets, now: T0, marks: back, trade: working, values: even }).trade, { do: "hold", why: "market" });
});

test("what goes wrong: two care passes at once hold once and leave the book consistent", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry());
  const joined = await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  await store.collection("moneyPilots").set(`p:mainnet:${OWNER}`, { ...joined.entry, marks: [{ at: NOW - 20 * HOUR, price: 200 }] });
  const { reads } = harness(store, 170);
  const both = await Promise.all([runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW }), runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW })]);
  const row = await store.collection("agentMandates").get(entryKey("mainnet", POLICY));
  assert.equal(row.status, "paused");
  assert.equal(row.pausedBy, "market");
  assert.ok(both.flat().filter((line) => line.did === "held").length >= 1);
  const pilot = await readPilot(store, "mainnet", OWNER);
  assert.equal(pilot.held.why, "market");
});

test("what goes wrong: the person's wallet stopped the agent mid-hold — the plan stops, the hold is never lifted onto a stopped mandate", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry("paused", "market"));
  const joined = await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  await store.collection("moneyPilots").set(`p:mainnet:${OWNER}`, { ...joined.entry, held: { why: "market", since: NOW - 8 * HOUR } });
  const { state, reads } = harness(store, 199);
  state.stopped = true;
  const lines = await runPilotPass({ store, cluster: "mainnet", reads, now: () => NOW });
  assert.deepEqual(lines, [{ owner: OWNER, did: "stopped" }]);
  assert.equal((await store.collection("agentMandates").get(entryKey("mainnet", POLICY))).status, "paused", "the care never set a stopped mandate to work");
});

test("what goes wrong: she stops while the care holds the trade — the chain says so, the plan and the book stop", async () => {
  const store = createMemoryGuardStore();
  await writeEntry(store, bookEntry("paused", "market"));
  const joined = await joinPilot({ owner: OWNER, said: null, plan: plan(), policy: POLICY, legs, proven: false }, deps(store));
  await store.collection("moneyPilots").set(`p:mainnet:${OWNER}`, { ...joined.entry, held: { why: "market", since: NOW - HOUR } });
  const { reads } = harness(store, 170);
  const gone = { ...reads, trade: async (policy, owner) => ({ ...(await reads.trade(policy, owner)), live: false }) };
  assert.deepEqual(await runPilotPass({ store, cluster: "mainnet", reads: gone, now: () => NOW }), [{ owner: OWNER, did: "stopped" }]);
  assert.equal((await readPilot(store, "mainnet", OWNER)).status, "stopped");
  const row = await store.collection("agentMandates").get(entryKey("mainnet", POLICY));
  assert.equal(row.status, "stopped");
  assert.equal(row.pausedBy, undefined);
});
