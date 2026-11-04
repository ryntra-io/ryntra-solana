import assert from "node:assert/strict";
import test from "node:test";

import { LaunchMarketsResponseSchema, LaunchSurvivalResponseSchema } from "../../../lib/api/v1/contract.ts";
import { FLOW_READS_MAX, HOLD_MS, startLaunchFeed } from "./feed.ts";
import { FLOW_FRESH_MS, FLOW_SETTLED_MS, silhouetteOf } from "./silhouette.ts";
import { STUB_PRESETS_ANSWER, stubAddress, stubEngine } from "./stub.ts";
import { shownLaunches, towerOf } from "./towers.ts";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const KITE = stubAddress("feed:KITE");
const MOTH = stubAddress("feed:MOTH");

/** One market of the engine's list, in the contract's shape. */
function row(token, symbol, over = {}) {
  return {
    token,
    name: symbol,
    symbol,
    image: `https://ryntra.io/api/launch/image/${"b".repeat(64)}`,
    preset: "protected",
    launchedAt: new Date(NOW - 8 * DAY).toISOString(),
    creator: stubAddress(`creator:${symbol}`),
    technicalValidation: false,
    pair: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, dollar: true },
    read: true,
    state: null,
    venue: "curve",
    progress: { bps: 9600, migrated: false },
    poolLiquidity: null,
    budget: { state: "NOT_COUNTED", earnedRaw: null, reserveRaw: null, ladder: "NONE", deployed: null },
    depth5Raw: null,
    daysSinceDex: null,
    traded24h: true,
    holders: 120,
    holdersAtLeast: false,
    creatorLock: null,
    creatorSold: false,
    observedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function survival(markets) {
  const tally = { eligible: 0, alive: 0, quiet: 0, unread: 0 };
  return LaunchSurvivalResponseSchema.parse({
    network: "solana:devnet",
    windowDays: 7,
    horizons: [7, 30, 90].map((days) => ({ days, people: tally, ryntra: tally })),
    markets: markets.map(([token, symbol, day7]) => ({
      token,
      symbol,
      launchedAt: new Date(NOW - 8 * DAY).toISOString(),
      own: false,
      outcomes: [
        { days: 7, state: day7, proof: day7 === "alive" ? { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() } : null },
        { days: 30, state: "young", proof: null },
        { days: 90, state: "young", proof: null },
      ],
    })),
    listedAll: true,
    ownWalletsComplete: true,
    complete: true,
    observedAt: new Date(NOW).toISOString(),
  });
}

/**
 * A token's flow as the engine answers it (L3), only what the silhouette reads filled in: graduated `minutes` after the
 * creation with `buyers` independent buyers, or still on its curve; day 7 proven by `day7` (`independent` its proof).
 */
function flowAnswer(token, { minutes = null, buyers = 0, atLeast = false, day7 = "young", independent = null } = {}) {
  const created = NOW - 8 * DAY;
  return {
    network: "solana:devnet",
    token,
    creator: stubAddress(`creator:${token}`),
    rules: { version: "launch-flow-1.0.0", floorUsd: 1, singleTradeBps: 5000, hops: 2 },
    launchSlot: { slot: 1, at: new Date(created).toISOString(), buys: 0, wallets: 0, supplyBps: 0, signatures: [] },
    bundles: { groups: [], count: 0, wallets: 0, supplyBps: 0, holdsBps: 0, complete: true },
    dev: { wallet: stubAddress(`creator:${token}`), boughtBps: 0, soldBps: 0, soldOfBoughtBps: null, sales: 0, lastSale: null, holdsBps: 0, linked: { wallets: 0, boughtBps: 0, holdsBps: 0 }, complete: true },
    buyers: { wallets: buyers, independent: buyers, merged: 0, creatorLinked: 0, unknown: 0, roundTrips: 0, atLeast },
    graduation: {
      graduated: minutes !== null,
      at: minutes === null ? null : new Date(created + minutes * 60_000).toISOString(),
      signature: minutes === null ? null : "4".repeat(88),
      buyers: minutes === null ? null : { wallets: buyers, independent: buyers },
      largestBuy: null,
      singleTrade: false,
      complete: true,
    },
    survival: [
      { days: 7, state: day7, proof: day7 === "alive" ? { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() } : null, independent: day7 === "alive" ? independent : null },
      { days: 30, state: "young", proof: null, independent: null },
      { days: 90, state: "young", proof: null, independent: null },
    ],
    creatorRecord: { launches: [], count: 0, judged: 0, survived: 0, complete: true },
    complete: true,
    observedAt: new Date(NOW).toISOString(),
  };
}

/**
 * An engine whose reads follow a script: each read of the list takes the next answer; each token's flow reads take
 * its next answer in `flows` (a function of the token's read count), «not found» when it has none.
 */
function scripted(lists, survivals, flows = {}) {
  const calls = [];
  let list = 0;
  let checks = 0;
  const flowReads = new Map();
  return {
    calls,
    flow: async (token) => {
      calls.push(`flow:${token}`);
      const n = flowReads.get(token) ?? 0;
      flowReads.set(token, n + 1);
      const answer = flows[token]?.(n);
      return answer ? (answer instanceof Promise ? answer : { ok: true, data: answer }) : { ok: false, code: "LAUNCH_NOT_FOUND", message: "" };
    },
    presets: async () => ({ ok: true, data: STUB_PRESETS_ANSWER }),
    markets: async () => {
      calls.push("markets");
      const markets = lists[Math.min(list++, lists.length - 1)];
      return markets ? { ok: true, data: LaunchMarketsResponseSchema.parse({ network: "solana:devnet", markets, complete: true, observedAt: new Date(NOW).toISOString() }) } : { ok: false, code: "UNAVAILABLE", message: "" };
    },
    survival: async () => ({ ok: true, data: survivals[Math.min(checks++, survivals.length - 1)] }),
    crews: async () => ({ ok: true, data: { network: "solana:devnet", crews: [], observedAt: new Date(NOW).toISOString() } }),
    market: async (token) => (calls.push(`market:${token}`), { ok: false, code: "LAUNCH_NOT_FOUND", message: "" }),
    metadata: async () => ({ ok: false, code: "LAUNCH_UNAVAILABLE", message: "" }),
    build: async () => ({ ok: false, code: "LAUNCH_UNAVAILABLE", message: "" }),
    submit: async () => ({ ok: false, code: "LAUNCH_UNAVAILABLE", message: "" }),
  };
}

function feedOf(engine, now = () => NOW, focus = () => [], flowWaitMs = 50) {
  const seen = { towers: [], moments: [], states: [] };
  const feed = startLaunchFeed({
    engine,
    manual: true,
    now,
    focus,
    flowWaitMs,
    onTowers: (towers) => seen.towers.push(towers),
    onMoments: (moments) => seen.moments.push(...moments),
    onState: (state) => seen.states.push(state),
  });
  return { feed, seen };
}

test("the first read raises the towers quietly: what already happened is not played again", async () => {
  const engine = scripted([[row(KITE, "KITE"), row(MOTH, "MOTH", { venue: "pool", progress: { bps: 10_000, migrated: true }, poolLiquidity: { pair: 31_000, usd: 31_000 } })]], [survival([[MOTH, "MOTH", "alive"]])]);
  const { feed, seen } = feedOf(engine);
  await feed.readNow();
  const towers = seen.towers[0];
  assert.equal(towers.length, 2);
  const kite = towers.find((tower) => tower.symbol === "KITE");
  const moth = towers.find((tower) => tower.symbol === "MOTH");
  assert.equal(kite.migrated, false);
  assert.equal(kite.progress, 96);
  assert.equal(kite.graduationUsd, 75_000);
  assert.equal(kite.image, `/api/launch/image/${"b".repeat(64)}`);
  assert.equal(moth.migrated, true);
  assert.equal(moth.liquidityUsd, 31_000);
  assert.deepEqual(moth.checks, ["alive", "young", "young"]);
  assert.deepEqual(seen.moments, []);
  assert.deepEqual(seen.states, ["live"]);
});

test("a curve that fills becomes the city's moment «into the skyline» at $75K once its graduation passed the rule, a passed day 7 its check", async () => {
  const before = [row(KITE, "KITE"), row(MOTH, "MOTH")];
  const after = [row(KITE, "KITE", { venue: "pool", progress: { bps: 10_000, migrated: true } }), row(MOTH, "MOTH")];
  let clock = NOW;
  const engine = scripted([before, after], [survival([[MOTH, "MOTH", "young"]]), survival([[MOTH, "MOTH", "alive"]])], {
    [KITE]: () => flowAnswer(KITE, { minutes: 95, buyers: 64 }),
    [MOTH]: () => flowAnswer(MOTH, { day7: "alive", independent: true }),
  });
  const { feed, seen } = feedOf(engine, () => clock);
  await feed.readNow();
  /* The checks are read again five minutes on. */
  clock += 6 * 60_000;
  await feed.readNow();
  assert.deepEqual(
    seen.moments.map((moment) => [moment.symbol, moment.title, moment.value]),
    [
      ["KITE", "Into the skyline", "$75K · POOL OPEN"],
      ["MOTH", "Day 7 check", "STILL TRADING"],
    ],
  );
});

test("a graduation below the rule is «graduated» and keeps the Docks; the move into the skyline plays once the flow proves it", async () => {
  const before = [row(KITE, "KITE")];
  const after = [row(KITE, "KITE", { venue: "pool", progress: { bps: 10_000, migrated: true } })];
  let clock = NOW;
  /* The first read after the graduation counts a floor of 31 buyers; the next one, with more starts traced, 58. */
  const engine = scripted([before, after], [survival([])], { [KITE]: (n) => flowAnswer(KITE, { minutes: 95, buyers: n === 0 ? 31 : 58, atLeast: n === 0 }) });
  const { feed, seen } = feedOf(engine, () => clock);
  await feed.readNow();
  await feed.readNow();
  assert.deepEqual(seen.moments.map((moment) => [moment.title, moment.value]), [["Graduated", "$75K · POOL OPEN"]]);
  const kite = seen.towers.at(-1).find((tower) => tower.symbol === "KITE");
  assert.deepEqual([silhouetteOf(kite).status, silhouetteOf(kite).buyers, towerOf(kite).district], ["few", 31, "docks"]);
  /* A flow kept fresh is not asked again; five minutes on it is. */
  await feed.readNow();
  assert.equal(engine.calls.filter((call) => call === `flow:${KITE}`).length, 1);
  clock += FLOW_FRESH_MS;
  await feed.readNow();
  assert.equal(engine.calls.filter((call) => call === `flow:${KITE}`).length, 2);
  assert.deepEqual(seen.moments.map((moment) => moment.title), ["Graduated", "Into the skyline"]);
  assert.equal(towerOf(seen.towers.at(-1)[0]).district, "strip");
});

test("a fast exit stays in the Docks without a move into the skyline", async () => {
  const before = [row(KITE, "KITE")];
  const after = [row(KITE, "KITE", { venue: "pool", progress: { bps: 10_000, migrated: true } })];
  const engine = scripted([before, after], [survival([])], { [KITE]: () => flowAnswer(KITE, { minutes: 4, buyers: 140 }) });
  const { feed, seen } = feedOf(engine);
  await feed.readNow();
  await feed.readNow();
  await feed.readNow();
  assert.deepEqual(seen.moments.map((moment) => moment.title), ["Graduated"]);
  assert.equal(silhouetteOf(seen.towers.at(-1)[0]).status, "fast");
});

test("a graduated tower seen first waits for its flow, then takes its place at once; a long-graduated one plays no moment", async () => {
  let give;
  const slow = new Promise((resolve) => (give = resolve));
  const engine = scripted([[row(MOTH, "MOTH", { venue: "pool", progress: { bps: 10_000, migrated: true } })]], [survival([])], { [MOTH]: () => slow });
  const { feed, seen } = feedOf(engine, () => NOW, () => [], 5);
  await feed.readNow();
  const held = seen.towers[0].find((tower) => tower.symbol === "MOTH");
  assert.equal(held.awaitingFlow, true);
  assert.equal(shownLaunches(seen.towers[0]).length, 0, "not put in the Docks to jump to the skyline later");
  give({ ok: true, data: flowAnswer(MOTH, { minutes: 300, buyers: 90 }) });
  await slow;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const placed = seen.towers.at(-1).find((tower) => tower.symbol === "MOTH");
  assert.equal(placed.awaitingFlow, false);
  assert.equal(towerOf(placed).district, "strip");
  assert.deepEqual(seen.moments, [], "it graduated before the city looked: nothing is played");
});

test("a flow the engine does not give leaves a graduated tower in the Docks, never in the skyline", async () => {
  const engine = scripted([[row(MOTH, "MOTH", { venue: "pool", progress: { bps: 10_000, migrated: true } })]], [survival([])]);
  const { feed, seen } = feedOf(engine);
  await feed.readNow();
  const moth = seen.towers[0][0];
  assert.equal(moth.awaitingFlow, false);
  assert.equal(towerOf(moth).district, "docks");
  assert.equal(shownLaunches(seen.towers[0]).length, 1);
});

test("a tower on its curve with no passed check costs no flow read", async () => {
  const engine = scripted([[row(KITE, "KITE")]], [survival([[KITE, "KITE", "young"]])]);
  const { feed } = feedOf(engine);
  await feed.readNow();
  assert.equal(engine.calls.filter((call) => call.startsWith("flow:")).length, 0);
});

const pool = (over = {}) => ({ venue: "pool", progress: { bps: 10_000, migrated: true }, ...over });

test("on the first read every graduated tower not drawn yet waits for its flow — none stands in the Docks to move later", async () => {
  const tokens = Array.from({ length: 10 }, (_, i) => stubAddress(`feed:G${i}`));
  const engine = scripted([tokens.map((token, i) => row(token, `G${i}`, pool()))], [survival([])], Object.fromEntries(tokens.map((token) => [token, () => flowAnswer(token, { minutes: 90, buyers: 70 })])));
  let clock = NOW;
  const { feed, seen } = feedOf(engine, () => clock);
  await feed.readNow();
  const first = seen.towers.at(-1);
  assert.equal(first.filter((tower) => tower.flow !== null).length, FLOW_READS_MAX);
  assert.ok(first.filter((tower) => tower.flow === null).every((tower) => tower.awaitingFlow), "the ones not asked yet are held back too");
  assert.ok(shownLaunches(first).every((tower) => towerOf(tower).district === "strip"), "nothing stands in the Docks to jump later");
  clock += 30_000;
  await feed.readNow();
  assert.ok(seen.towers.at(-1).every((tower) => tower.flow !== null && !tower.awaitingFlow));
  assert.deepEqual(seen.moments, [], "graduated before the city looked: nothing played");
});

test("a held tower whose flow does not come within its wait stands in the Docks", async () => {
  const engine = scripted([[row(MOTH, "MOTH", pool())]], [survival([])], { [MOTH]: () => new Promise(() => {}) });
  let clock = NOW;
  const { feed, seen } = feedOf(engine, () => clock, () => [], 5);
  await feed.readNow();
  assert.equal(seen.towers.at(-1)[0].awaitingFlow, true);
  clock += HOLD_MS;
  await feed.readNow();
  assert.equal(seen.towers.at(-1)[0].awaitingFlow, false);
  assert.equal(towerOf(seen.towers.at(-1)[0]).district, "docks");
});

test("every tower that needs a flow gets one in turn, however many there are; a settled one rests", async () => {
  const tokens = Array.from({ length: 30 }, (_, i) => stubAddress(`feed:R${i}`));
  const engine = scripted([tokens.map((token, i) => row(token, `R${i}`, pool({ launchedAt: new Date(NOW - (10 + i) * DAY).toISOString() })))], [survival([])], Object.fromEntries(tokens.map((token) => [token, () => flowAnswer(token, { minutes: 90, buyers: 70 })])));
  let clock = NOW;
  const { feed } = feedOf(engine, () => clock);
  for (let i = 0; i < 6; i += 1) {
    await feed.readNow();
    clock += 30_000;
  }
  const reads = engine.calls.filter((call) => call.startsWith("flow:"));
  assert.equal(new Set(reads).size, 30, "the oldest graduation is read too");
  assert.equal(reads.length, 30, "a flow counted whole is not asked again soon");
  clock += FLOW_SETTLED_MS;
  await feed.readNow();
  assert.equal(engine.calls.filter((call) => call.startsWith("flow:")).length, 30 + FLOW_READS_MAX);
});

test("an older graduation that can displace no tower shown costs no read; the newest, the day-90 ones and the shown do", async () => {
  /* 44 launches: under the scene's own 48 (`SCENE_MISSIONS_MAX`), which bounds what the city reads at all. */
  const fresh = Array.from({ length: 10 }, (_, i) => row(stubAddress(`feed:F${i}`), `F${i}`, { launchedAt: new Date(NOW - (i + 1) * 3_600_000).toISOString() }));
  const old = Array.from({ length: 34 }, (_, i) => row(stubAddress(`feed:O${i}`), `O${i}`, pool({ launchedAt: new Date(NOW - (10 + i) * DAY).toISOString() })));
  const landmark = stubAddress("feed:O33");
  const checks = survival([[landmark, "O33", "alive"]]);
  const proof = { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() };
  const lived = { ...checks, markets: checks.markets.map((market) => ({ ...market, outcomes: market.outcomes.map((outcome) => ({ ...outcome, state: "alive", proof })) })) };
  const lit = (token) => () => {
    const flow = flowAnswer(token, { minutes: 90, buyers: 140, atLeast: true });
    flow.survival = flow.survival.map((check) => ({ ...check, state: "alive", proof, independent: true }));
    return flow;
  };
  const engine = scripted([[...fresh, ...old]], [lived], Object.fromEntries(old.map((entry) => [entry.token, entry.token === landmark ? lit(entry.token) : () => flowAnswer(entry.token, { minutes: 90, buyers: 140, atLeast: true })])));
  let clock = NOW;
  const { feed, seen } = feedOf(engine, () => clock);
  for (let i = 0; i < 12; i += 1) {
    await feed.readNow();
    clock += 30_000;
  }
  const read = new Set(engine.calls.filter((call) => call.startsWith("flow:")).map((call) => call.slice(5)));
  assert.equal(read.size, 25, "the 24 newest graduations and the oldest one, a day-90 candidate");
  assert.ok(read.has(landmark));
  assert.ok(!read.has(stubAddress("feed:O30")), "older than the newest 24, no day-90 ring, not shown");
  assert.equal(engine.calls.filter((call) => call.startsWith("flow:")).length, 25, "a floor already past the bar rests");
  assert.ok(seen.towers.at(-1).filter((tower) => !read.has(tower.token) && tower.migrated).every((tower) => !tower.awaitingFlow), "never held back for a read that never comes");
});

test("a flow that stays behind its checks is asked again less and less often", async () => {
  const engine = scripted([[row(KITE, "KITE")]], [survival([[KITE, "KITE", "alive"]])], { [KITE]: () => flowAnswer(KITE, { day7: "young" }) });
  let clock = NOW;
  const { feed } = feedOf(engine, () => clock);
  for (let i = 0; i < 20; i += 1) {
    await feed.readNow();
    clock += 30_000;
  }
  /* Ten minutes: the first read, then after 1, 2 and 4 minutes — not twenty asks. */
  assert.equal(engine.calls.filter((call) => call === `flow:${KITE}`).length, 4);
  /* A day-90 candidate backs off the same way. */
  const lived = survival([[MOTH, "MOTH", "alive"]]);
  const old = { ...lived, markets: lived.markets.map((market) => ({ ...market, outcomes: market.outcomes.map((outcome) => ({ ...outcome, state: "alive", proof: { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() } })) })) };
  const landmark = scripted([[row(MOTH, "MOTH", pool())]], [old], { [MOTH]: () => flowAnswer(MOTH, { minutes: 300, buyers: 90 }) });
  clock = NOW;
  const other = feedOf(landmark, () => clock);
  for (let i = 0; i < 20; i += 1) {
    await other.feed.readNow();
    clock += 30_000;
  }
  assert.equal(landmark.calls.filter((call) => call === `flow:${MOTH}`).length, 4);
});

test("a quiet graduated coin someone looks at is read and stands; one nobody looks at is never held back", async () => {
  const quiet = row(MOTH, "MOTH", pool({ traded24h: false }));
  const engine = scripted([[quiet]], [survival([[MOTH, "MOTH", "quiet"]])], { [MOTH]: () => flowAnswer(MOTH, { minutes: 300, buyers: 90 }) });
  const { feed, seen } = feedOf(engine, () => NOW, () => [MOTH]);
  await feed.readNow();
  const moth = seen.towers.at(-1)[0];
  assert.equal(moth.phase, "lost");
  assert.equal(moth.awaitingFlow, false);
  assert.equal(silhouetteOf(moth).stand, "skyline");
  const unwatched = scripted([[quiet]], [survival([[MOTH, "MOTH", "quiet"]])], { [MOTH]: () => flowAnswer(MOTH, { minutes: 300, buyers: 90 }) });
  const other = feedOf(unwatched);
  await other.feed.readNow();
  assert.equal(other.seen.towers.at(-1)[0].awaitingFlow, false);
  assert.equal(unwatched.calls.filter((call) => call.startsWith("flow:")).length, 0);
});

test("a day-90 ring on a tower the Docks keep plays as its day-90 check, never as a landmark", async () => {
  const before = survival([[KITE, "KITE", "alive"]]);
  const day90 = (state) => ({ ...before, markets: before.markets.map((market) => ({ ...market, outcomes: market.outcomes.map((outcome) => ({ ...outcome, state: "alive", proof: { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() } })).map((outcome, i) => (i === 2 ? { ...outcome, state, proof: state === "alive" ? outcome.proof : null } : outcome)) })) });
  const answer = (minutes) => () => {
    const flow = flowAnswer(KITE, { minutes, buyers: 90, day7: "alive", independent: true });
    flow.survival = flow.survival.map((check) => ({ ...check, state: "alive", proof: { signature: "5".repeat(88), at: new Date(NOW - DAY).toISOString() }, independent: true }));
    return flow;
  };
  for (const [minutes, title] of [[5, "Day 90 check"], [300, "Day 90 landmark"]]) {
    let clock = NOW;
    const engine = scripted([[row(KITE, "KITE", pool())]], [day90("young"), day90("alive")], { [KITE]: answer(minutes) });
    const { feed, seen } = feedOf(engine, () => clock);
    await feed.readNow();
    clock += 6 * 60_000;
    await feed.readNow();
    assert.deepEqual(seen.moments.map((moment) => moment.title), [title], `${minutes} min on its curve`);
  }
});

test("a floor that dips on a later read does not move a tower out of the skyline, and an old graduation plays nothing", async () => {
  const counts = [55, 48, 55, 48];
  const engine = scripted([[row(MOTH, "MOTH", pool())]], [survival([])], { [MOTH]: (n) => flowAnswer(MOTH, { minutes: 300, buyers: counts[Math.min(n, 3)], atLeast: true }) });
  let clock = NOW;
  const { feed, seen } = feedOf(engine, () => clock);
  for (let i = 0; i < 4; i += 1) {
    await feed.readNow();
    assert.equal(towerOf(seen.towers.at(-1)[0]).district, "strip", `read ${i + 1}`);
    clock += FLOW_SETTLED_MS;
  }
  assert.equal(engine.calls.filter((call) => call === `flow:${MOTH}`).length, 4);
  assert.deepEqual(seen.moments, []);
});

test("a graduation whose flow comes late: «graduated», then «into the skyline» once", async () => {
  let give;
  const late = new Promise((resolve) => (give = resolve));
  const engine = scripted([[row(KITE, "KITE")], [row(KITE, "KITE", pool())]], [survival([])], { [KITE]: () => late });
  const { feed, seen } = feedOf(engine, () => NOW, () => [], 5);
  await feed.readNow();
  await feed.readNow();
  assert.deepEqual(seen.moments.map((moment) => moment.title), ["Graduated"]);
  give({ ok: true, data: flowAnswer(KITE, { minutes: 95, buyers: 64 }) });
  await late;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await feed.readNow();
  assert.deepEqual(seen.moments.map((moment) => moment.title), ["Graduated", "Into the skyline"]);
});

test("a passed check plays only once its ring burns: a proof by an untraced wallet waits, a traced one plays", async () => {
  const before = [row(KITE, "KITE")];
  let clock = NOW;
  let traced = null;
  const engine = scripted([before], [survival([[KITE, "KITE", "young"]]), survival([[KITE, "KITE", "alive"]])], { [KITE]: () => flowAnswer(KITE, { day7: "alive", independent: traced }) });
  const { feed, seen } = feedOf(engine, () => clock);
  await feed.readNow();
  clock += 6 * 60_000;
  await feed.readNow();
  assert.deepEqual(seen.moments, [], "day 7 by a wallet not traced: no ring, no moment");
  traced = true;
  clock += 6 * 60_000;
  await feed.readNow();
  assert.deepEqual(seen.moments.map((moment) => [moment.title, moment.value]), [["Day 7 check", "STILL TRADING"]]);
});

test("the towers someone looks at are read whole, the others in turn", async () => {
  const engine = scripted([[row(KITE, "KITE"), row(MOTH, "MOTH")]], [survival([])]);
  const { feed } = feedOf(engine, () => NOW, () => [KITE]);
  await feed.readNow();
  await feed.readNow();
  const reads = engine.calls.filter((call) => call.startsWith("market:"));
  assert.equal(reads.filter((call) => call === `market:${KITE}`).length, 2, "the focus every time");
  assert.equal(reads.filter((call) => call === `market:${MOTH}`).length, 2, "the other one in turn");
});

test("a list that cannot be read keeps the last towers and says the read is stale", async () => {
  const engine = scripted([[row(KITE, "KITE")], null], [survival([])]);
  const { feed, seen } = feedOf(engine);
  await feed.readNow();
  await feed.readNow();
  assert.equal(seen.towers.length, 1);
  assert.deepEqual(seen.states, ["live", "stale"]);
});

test("on the stub's stand the market of a tower read whole gives its market cap", async () => {
  const engine = stubEngine({ now: () => NOW });
  const markets = await engine.markets();
  const nova = markets.data.markets.find((entry) => entry.symbol === "NOVA");
  const { feed, seen } = feedOf(engine, () => NOW, () => [nova.token]);
  await feed.readNow();
  const tower = seen.towers[0].find((entry) => entry.token === nova.token);
  assert.equal(tower.progress, 62);
  assert.ok(tower.marketCapUsd > 5_000 && tower.marketCapUsd < 75_000);
  assert.equal(seen.towers[0].find((entry) => entry.symbol === "DUSK").phase, "lost");
  assert.equal(seen.towers[0].find((entry) => entry.symbol === "OWL").phase, "star");
});

test("a coin Ryntra took down stands as a tower without its picture, marked hidden; the others are not", async () => {
  const engine = stubEngine({ now: () => NOW });
  const { feed, seen } = feedOf(engine, () => NOW, () => []);
  await feed.readNow();
  const glint = seen.towers[0].find((entry) => entry.symbol === "GLNT");
  assert.equal(glint.hidden, true);
  assert.equal(glint.image, null);
  assert.equal(glint.name, "Glint", "the name and ticker stay: the chain holds them");
  assert.ok(seen.towers[0].filter((entry) => entry.symbol !== "GLNT").every((entry) => entry.hidden === false));
});
