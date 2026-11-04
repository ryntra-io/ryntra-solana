// L9 (CITY-146): Launch Night shows the night's launches only when the start of each is confirmed by the timestamp of
// its DBC creation's block (the flow's `launchSlot.at`), the engine's record agrees with it, and the night has enough of
// them; an act with nobody in it is not shown, and without enough confirmed launches there is no show at all. The
// stand's answers are made-up in the shape of the v1 contract (devnet); nothing here reached a real engine.
import assert from "node:assert/strict";
import test from "node:test";

import { LaunchFlowResponseSchema } from "../../../lib/api/v1/contract.ts";
import { startLaunchFeed } from "./feed.ts";
import { actOf, confirmedStart, dueMarketReads, dueNightReads, NIGHT_ACTS, NIGHT_FRESH_MS, NIGHT_MARKET_MS, NIGHT_RETRY_MS, NIGHT_RULE, nightCandidates, nightOpen, nightShow, nightStartOf, nightSwitch, sameLineup, startFor, startOfTower, withCaps } from "./night.ts";
import { stubEngine } from "./stub.ts";

const NOW = Date.parse("2026-11-01T21:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

/** A launch tower as the feed makes it, started `ago` before NOW. */
function tower(symbol, ago, over = {}) {
  return {
    token: `${symbol}${"1".repeat(40 - symbol.length)}`,
    symbol,
    name: symbol,
    image: null,
    launchedAt: iso(NOW - ago),
    creator: "C".repeat(43),
    preset: "protected",
    graduationUsd: 75_000,
    progress: 10,
    migrated: false,
    marketCapUsd: 9_000,
    liquidityUsd: null,
    holders: 12,
    holdersAtLeast: false,
    checks: ["young", "young", "young"],
    phase: "ascent",
    crew: 0,
    ryntraTest: false,
    network: "solana:devnet",
    mine: false,
    hidden: false,
    flow: null,
    awaitingFlow: false,
    ...over,
  };
}

/** The flow's start for a tower: its creation's block at `at` (the record's time by default). */
const start = (t, over = {}) => ({ createdAt: t.launchedAt, graduated: false, graduatedAt: null, ...over });
const startsOf = (...pairs) => new Map(pairs.map(([t, s]) => [t.token, s ?? start(t)]));

test("the switch: closed unless `open`;", () => {
  assert.equal(nightSwitch(undefined), false);
  assert.equal(nightSwitch("true"), false);
  assert.equal(nightSwitch("open"), true);
  assert.equal(nightOpen("solana:devnet", false), false);
  assert.equal(nightOpen("solana:devnet", true), true);
  assert.equal(nightOpen("solana:mainnet", true, false), false, "without the word on Launch in the city, mainnet stays shut");
  assert.equal(nightOpen("solana:mainnet", true, true), true);
  assert.equal(nightOpen(null, true, true), false);
  assert.equal(NIGHT_RULE.ownerWord, false, "the numbers are a proposal");
});

test("a start is confirmed only by the creation's block, agreeing with the record, inside the night", () => {
  const t = tower("KITE", 20 * MIN);
  assert.equal(confirmedStart(t, start(t), NOW), Date.parse(t.launchedAt));
  assert.equal(confirmedStart(t, null, NOW), null, "no flow — not confirmed");
  assert.equal(confirmedStart(t, start(t, { createdAt: null }), NOW), null, "the read did not reach the block");
  assert.equal(confirmedStart({ launchedAt: null }, start(t), NOW), null, "no record to agree with");
  assert.equal(confirmedStart(t, start(t, { createdAt: iso(Date.parse(t.launchedAt) - 16 * MIN) }), NOW), null, "the block and the record disagree");
  assert.ok(confirmedStart(t, start(t, { createdAt: iso(Date.parse(t.launchedAt) - 14 * MIN) }), NOW) !== null, "within the drift");
  const future = tower("SOON", -10 * MIN);
  assert.equal(confirmedStart(future, start(future), NOW), null, "a block in the future is no start");
  const old = tower("OLD", 25 * HOUR);
  assert.equal(confirmedStart(old, start(old), NOW), null, "outside the night");
});

test("the acts: just launched within the hour, climbing from a quarter of the curve, graduated inside the night", () => {
  const fresh = tower("NEW", 30 * MIN, { progress: 2 });
  assert.equal(actOf(fresh, start(fresh), Date.parse(fresh.launchedAt), NOW), "fresh");
  const slow = tower("SLOW", 3 * HOUR, { progress: 12 });
  assert.equal(actOf(slow, start(slow), Date.parse(slow.launchedAt), NOW), null, "an older launch low on its curve is not on the stage");
  const climb = tower("UP", 3 * HOUR, { progress: 61 });
  assert.equal(actOf(climb, start(climb), Date.parse(climb.launchedAt), NOW), "climbing");
  const grad = tower("GRAD", 6 * HOUR, { migrated: true, progress: 100 });
  assert.equal(actOf(grad, start(grad, { graduated: true, graduatedAt: iso(NOW - 2 * HOUR) }), Date.parse(grad.launchedAt), NOW), "graduated");
  assert.equal(actOf(grad, start(grad), Date.parse(grad.launchedAt), NOW), null, "a graduation the flow has not read is no act");
  assert.equal(actOf(grad, start(grad, { graduated: true, graduatedAt: null }), Date.parse(grad.launchedAt), NOW), null);
});

test("no show without enough confirmed launches: no empty show, ever", () => {
  const a = tower("AAA", 10 * MIN);
  const b = tower("BBB", 20 * MIN);
  const c = tower("CCC", 30 * MIN);
  assert.equal(nightShow({ towers: [], starts: new Map(), network: "solana:devnet", now: NOW }), null);
  assert.equal(nightShow({ towers: [a, b], starts: startsOf([a], [b]), network: "solana:devnet", now: NOW }), null, "two are below the minimum");
  assert.equal(nightShow({ towers: [a, b, c], starts: startsOf([a], [b]), network: "solana:devnet", now: NOW }), null, "the third start is not confirmed");
  assert.equal(nightShow({ towers: [a, b, c], starts: startsOf([a], [b], [c]), network: null, now: NOW }), null, "no network read");
  const show = nightShow({ towers: [a, b, c], starts: startsOf([a], [b], [c]), network: "solana:devnet", now: NOW });
  assert.ok(show);
  assert.equal(show.entries.length, 3);
});

test("an act with nobody in it is not shown, and the stage runs act after act", () => {
  const fresh = [tower("F1", 5 * MIN), tower("F2", 40 * MIN)];
  const climb = [tower("C1", 2 * HOUR, { progress: 30 }), tower("C2", 5 * HOUR, { progress: 80 })];
  const towers = [...fresh, ...climb];
  const show = nightShow({ towers, starts: startsOf(...towers.map((t) => [t])), network: "solana:devnet", now: NOW });
  assert.deepEqual(show.acts.map((act) => act.id), ["fresh", "climbing"], "no graduated act without a graduation");
  assert.ok(show.acts.every((act) => act.entries.length > 0));
  assert.deepEqual(show.entries.map((entry) => entry.symbol), ["F1", "F2", "C2", "C1"], "fresh newest first, climbing furthest first");
  for (const entry of show.entries) assert.ok(NIGHT_ACTS.includes(entry.act));
  const grad = tower("G1", 8 * HOUR, { migrated: true, progress: 100 });
  const withGrad = nightShow({ towers: [...towers, grad], starts: startsOf(...towers.map((t) => [t]), [grad, start(grad, { graduated: true, graduatedAt: iso(NOW - HOUR) })]), network: "solana:devnet", now: NOW });
  assert.deepEqual(withGrad.acts.map((act) => act.id), ["fresh", "climbing", "graduated"]);
  assert.equal(withGrad.entries.at(-1).progress, 100);
  assert.equal(withGrad.entries.at(-1).graduatedAt, iso(NOW - HOUR));
});

test("who never stands on the stage: Ryntra's own, a coin taken down, no ticker, a market cap not read, a lost one", () => {
  const ok = [tower("AAA", 10 * MIN), tower("BBB", 20 * MIN), tower("CCC", 30 * MIN)];
  const left = [
    tower("TEST", 5 * MIN, { ryntraTest: true }),
    tower("GONE", 6 * MIN, { hidden: true }),
    tower("", 7 * MIN, { token: "Z".repeat(40) }),
    tower("NOCAP", 8 * MIN, { marketCapUsd: null }),
    tower("LOST", 9 * MIN, { phase: "lost" }),
  ];
  const towers = [...ok, ...left];
  const show = nightShow({ towers, starts: startsOf(...towers.map((t) => [t])), network: "solana:devnet", now: NOW });
  assert.deepEqual(show.entries.map((entry) => entry.symbol).sort(), ["AAA", "BBB", "CCC"]);
  assert.equal(nightCandidates(towers, NOW).length, 4, "only the market cap is read later: the rest are never asked about");
});

test("an act shows four at most, the show twelve", () => {
  const many = Array.from({ length: 9 }, (_, i) => tower(`F${i}`, (i + 1) * 5 * MIN));
  const show = nightShow({ towers: many, starts: startsOf(...many.map((t) => [t])), network: "solana:devnet", now: NOW });
  assert.equal(show.acts.length, 1);
  assert.equal(show.entries.length, NIGHT_RULE.perAct);
  assert.ok(NIGHT_RULE.maxLaunches >= NIGHT_RULE.perAct * NIGHT_ACTS.length);
});

test("a flow the feed already holds is taken as it is; the rest are read a few at a time, the newest first", () => {
  const read = tower("READ", 3 * HOUR, { migrated: true, progress: 100, flow: { graduated: true, graduatedAt: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), buyers: 60, atLeast: false, survival: [] } });
  assert.deepEqual(startOfTower(read), { createdAt: iso(NOW - 3 * HOUR), graduated: true, graduatedAt: iso(NOW - HOUR) });
  const towers = [read, ...Array.from({ length: 6 }, (_, i) => tower(`N${i}`, (i + 1) * 10 * MIN))];
  const candidates = nightCandidates(towers, NOW);
  assert.deepEqual(dueNightReads(candidates, new Map(), new Set(), NOW), [candidates[0].token, candidates[1].token, candidates[2].token, candidates[3].token]);
  assert.ok(!dueNightReads(candidates, new Map(), new Set(), NOW, 10).includes(read.token), "the feed's own flow confirms it");
  const n0 = candidates[0].token;
  assert.ok(!dueNightReads(candidates, new Map(), new Set([n0]), NOW).includes(n0), "a read in flight is not asked twice");
  const kept = new Map([[n0, { at: NOW, ok: false, start: null }]]);
  assert.ok(!dueNightReads(candidates, kept, new Set(), NOW + 1000, 10).includes(n0), "a failed read waits");
  assert.ok(dueNightReads(candidates, kept, new Set(), NOW + NIGHT_RETRY_MS, 10).includes(n0));
  const good = new Map([[n0, { at: NOW, ok: true, start: start(candidates[0]) }]]);
  assert.ok(!dueNightReads(candidates, good, new Set(), NOW + NIGHT_RETRY_MS, 10).includes(n0), "a confirmed curve rests");
  assert.ok(dueNightReads(candidates, good, new Set(), NOW + NIGHT_FRESH_MS, 10).includes(n0), "and is read again for its graduation");
});

test("the lineup: the same launches in the same acts keep the stage where it is", () => {
  const towers = [tower("AAA", 10 * MIN), tower("BBB", 20 * MIN), tower("CCC", 30 * MIN)];
  const a = nightShow({ towers, starts: startsOf(...towers.map((t) => [t])), network: "solana:devnet", now: NOW });
  const b = nightShow({ towers, starts: startsOf(...towers.map((t) => [t])), network: "solana:devnet", now: NOW + MIN });
  assert.equal(sameLineup(a, b), true);
  assert.equal(sameLineup(a, null), false);
  const c = nightShow({ towers: [...towers, tower("DDD", 5 * MIN)], starts: startsOf(...towers.map((t) => [t]), [tower("DDD", 5 * MIN)]), network: "solana:devnet", now: NOW });
  assert.equal(sameLineup(a, c), false);
});

test("on the stand: the engine's flows confirm three launches of the night; a coin taken down stays off", async () => {
  const now = Date.now();
  const engine = stubEngine({ now: () => now });
  let towers = [];
  const feed = startLaunchFeed({ engine, manual: true, now: () => now, flowWaitMs: 0, onTowers: (next) => (towers = next), onMoments: () => undefined });
  await feed.readNow();
  feed.stop();
  const candidates = nightCandidates(towers, now);
  assert.ok(candidates.length >= 3);
  assert.ok(!candidates.some((t) => t.symbol === "GLNT"), "a coin Ryntra took down is no candidate");
  const starts = new Map();
  for (const t of candidates) {
    const answer = await engine.flow(t.token);
    assert.equal(answer.ok, true);
    LaunchFlowResponseSchema.parse(answer.data);
    starts.set(t.token, nightStartOf(answer.data));
  }
  /* The engine's list carries no market cap: without the markets read, nobody has a headline number — no show. */
  assert.equal(nightShow({ towers: candidates, starts, network: "solana:devnet", now }), null);
  const due = dueMarketReads(candidates, starts, new Map(), new Set(), now, 16);
  assert.equal(due.length, candidates.length, "every confirmed start gets its market read");
  const caps = new Map();
  for (const token of due) {
    const answer = await engine.market(token);
    assert.equal(answer.ok, true);
    caps.set(token, { at: now, ok: true, usd: answer.data.marketCap.usd });
  }
  const show = nightShow({ towers: withCaps(candidates, caps), starts, network: "solana:devnet", now });
  assert.ok(show, "the stand has a show");
  assert.ok(show.entries.length >= NIGHT_RULE.minLaunches);
  assert.ok(show.acts.every((act) => act.entries.length > 0), "no empty act");
  for (const entry of show.entries) {
    const t = candidates.find((c) => c.token === entry.token);
    assert.equal(entry.startedAt, starts.get(entry.token).createdAt, "the start on the stage is the creation's block");
    assert.ok(Math.abs(Date.parse(entry.startedAt) - Date.parse(t.launchedAt)) <= NIGHT_RULE.driftMs);
  }
  /* Without the flows, nothing of the night is confirmed: no show. */
  assert.equal(nightShow({ towers: candidates.map((t) => ({ ...t, flow: null })), starts: new Map(), network: "solana:devnet", now }), null);
});

test("the market caps: read for a confirmed start only, again after their time; a cap read is laid on the tower", () => {
  const a = tower("AAA", 10 * MIN, { marketCapUsd: null });
  const b = tower("BBB", 20 * MIN, { marketCapUsd: null });
  const starts = startsOf([a]);
  assert.deepEqual(dueMarketReads([a, b], starts, new Map(), new Set(), NOW), [a.token], "no start confirmed — no market read");
  const kept = new Map([[a.token, { at: NOW, ok: true, usd: 12_000 }]]);
  assert.deepEqual(dueMarketReads([a, b], starts, kept, new Set(), NOW + MIN), []);
  assert.deepEqual(dueMarketReads([a, b], starts, kept, new Set(), NOW + NIGHT_MARKET_MS), [a.token]);
  const failed = new Map([[a.token, { at: NOW, ok: false, usd: null }]]);
  assert.deepEqual(dueMarketReads([a, b], starts, failed, new Set(), NOW + NIGHT_RETRY_MS), [a.token]);
  assert.deepEqual(dueMarketReads([a, b], starts, new Map(), new Set([a.token]), NOW), [], "a read in flight is not asked twice");
  const [laid, untouched] = withCaps([a, b], new Map([[a.token, { at: NOW, ok: true, usd: 12_000 }], [b.token, { at: NOW, ok: true, usd: null }]]));
  assert.equal(laid.marketCapUsd, 12_000);
  assert.equal(untouched.marketCapUsd, null, "a cap the engine did not read stays not read");
});

test("a graduation the feed saw wins over the night's own read from before it: the coin reaches the graduated act", () => {
  const a = tower("AAA", 10 * MIN);
  const b = tower("BBB", 20 * MIN);
  const created = iso(NOW - 3 * HOUR);
  const grad = tower("GRAD", 3 * HOUR, { migrated: true, progress: 100, flow: { graduated: true, graduatedAt: iso(NOW - HOUR), createdAt: created, buyers: 60, atLeast: false, survival: [] } });
  /* The night read GRAD's flow while it was still on its curve. */
  const stale = { createdAt: created, graduated: false, graduatedAt: null };
  assert.deepEqual(startFor(grad, new Map([[grad.token, stale]])), { createdAt: created, graduated: true, graduatedAt: iso(NOW - HOUR) });
  const show = nightShow({ towers: [a, b, grad], starts: startsOf([a], [b], [grad, stale]), network: "solana:devnet", now: NOW });
  assert.deepEqual(show.acts.map((act) => act.id), ["fresh", "graduated"]);
  assert.ok(!dueNightReads([grad], new Map([[grad.token, { at: NOW, ok: true, start: stale }]]), new Set(), NOW + NIGHT_RETRY_MS).length, "nothing left to read");
});

test("a flow that keeps confirming nothing is asked again less and less often", () => {
  const t = tower("MISS", 10 * MIN);
  const after = (misses, wait) => dueNightReads([t], new Map([[t.token, { at: NOW, ok: true, start: { createdAt: null, graduated: false, graduatedAt: null }, misses }]]), new Set(), NOW + wait).length > 0;
  assert.equal(after(1, NIGHT_RETRY_MS), true);
  assert.equal(after(3, NIGHT_RETRY_MS), false);
  assert.equal(after(3, 4 * NIGHT_RETRY_MS), true);
  assert.equal(after(20, 15 * MIN), true, "capped");
});
