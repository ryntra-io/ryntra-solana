import assert from "node:assert/strict";
import test from "node:test";

import { LaunchMarketsResponseSchema, LaunchSurvivalResponseSchema } from "../../../lib/api/v1/contract.ts";
import { startLaunchFeed } from "./feed.ts";
import { STUB_PRESETS_ANSWER, stubAddress, stubEngine } from "./stub.ts";

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

/** An engine whose reads follow a script: each read of the list takes the next answer. */
function scripted(lists, survivals) {
  const calls = [];
  let list = 0;
  let checks = 0;
  return {
    calls,
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

function feedOf(engine, now = () => NOW, focus = () => []) {
  const seen = { towers: [], moments: [], states: [] };
  const feed = startLaunchFeed({
    engine,
    manual: true,
    now,
    focus,
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

test("a curve that fills becomes the city's moment «into the skyline» at $75K, a passed day 7 its check", async () => {
  const before = [row(KITE, "KITE"), row(MOTH, "MOTH")];
  const after = [row(KITE, "KITE", { venue: "pool", progress: { bps: 10_000, migrated: true } }), row(MOTH, "MOTH")];
  let clock = NOW;
  const engine = scripted([before, after], [survival([[MOTH, "MOTH", "young"]]), survival([[MOTH, "MOTH", "alive"]])]);
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
