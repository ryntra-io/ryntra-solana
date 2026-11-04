import assert from "node:assert/strict";
import test from "node:test";

import { cardOf, curvePercent, launchedList } from "./launched.ts";

// «Launched on Ryntra» (CITY-185): every launch of the launchpad from the district's own feed, people's first and
// Ryntra's technical launches apart; a figure the engine did not read stays off the card.

let n = 0;
function launch(over = {}) {
  n += 1;
  return {
    token: `Launched${String(n).padStart(4, "0")}Mint111111111111111111111111`.slice(0, 44),
    symbol: `C${n}`,
    name: `Coin ${n}`,
    image: null,
    launchedAt: new Date(Date.UTC(2026, 10, 1, n)).toISOString(),
    creator: null,
    preset: "classic",
    graduationUsd: 75_000,
    progress: 40,
    migrated: false,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    holdersAtLeast: false,
    checks: ["young", "young", "young"],
    phase: "ascent",
    crew: 0,
    ryntraTest: false,
    network: "solana:mainnet",
    mine: false,
    hidden: false,
    flow: null,
    awaitingFlow: false,
    ...over,
  };
}

test("Ryntra's technical launches never stand among people's projects", () => {
  const stair = launch({ symbol: "STAIR", ryntraTest: true, migrated: true, progress: 100 });
  const wick = launch({ symbol: "WICK", ryntraTest: true });
  const kite = launch({ symbol: "KITE" });
  const list = launchedList([stair, wick, kite]);
  assert.deepEqual(list.people.map((card) => card.symbol), ["KITE"]);
  assert.deepEqual(list.tests.map((card) => card.symbol), ["WICK", "STAIR"], "newest first");
});

test("only tests on the chain: the list of people's launches is empty", () => {
  const list = launchedList([launch({ ryntraTest: true }), launch({ ryntraTest: true })]);
  assert.equal(list.people.length, 0);
  assert.equal(list.tests.length, 2);
});

test("this browser's own launch first, then the biggest market cap, unread caps last, then the newest", () => {
  const small = launch({ symbol: "SMALL", marketCapUsd: 4_000 });
  const big = launch({ symbol: "BIG", marketCapUsd: 60_000 });
  const unreadOld = launch({ symbol: "OLD" });
  const unreadNew = launch({ symbol: "NEW" });
  const mine = launch({ symbol: "MINE", mine: true, marketCapUsd: 1_000 });
  assert.deepEqual(
    launchedList([small, unreadOld, big, mine, unreadNew]).people.map((card) => card.symbol),
    ["MINE", "BIG", "SMALL", "NEW", "OLD"],
  );
});

test("a launch the city cannot name is not listed, and a mint listed twice stands once", () => {
  const held = launch({ symbol: "" });
  const kite = launch({ symbol: "KITE" });
  assert.deepEqual(launchedList([held, kite, { ...kite, mine: true }]).people.map((card) => card.symbol), ["KITE"]);
});

test("the card: the curve until the pool, «In pool» after it; holders not counted are left off", () => {
  const curve = cardOf(launch({ progress: 42.4, holders: 0, holdersAtLeast: true }));
  assert.equal(curve.curve, 42.4);
  assert.equal(curve.inPool, false);
  assert.equal(curve.holders, null, "«at least none» says nothing");
  const pool = cardOf(launch({ migrated: true, progress: 100, holders: 214, marketCapUsd: 88_000 }));
  assert.equal(pool.curve, null);
  assert.equal(pool.inPool, true);
  assert.deepEqual(pool.holders, { count: 214, atLeast: false });
  assert.equal(pool.marketCapUsd, 88_000);
  const unread = cardOf(launch({ progress: null }));
  assert.equal(unread.curve, null);
  assert.equal(unread.marketCapUsd, null, "never a zero for a figure not read");
});

test("a picture Ryntra took down is not drawn", () => {
  const card = cardOf(launch({ image: "/api/launch/image/" + "a".repeat(64), hidden: true }));
  assert.equal(card.image, null);
});

test("the curve in whole percent: never 100 before the pool, never 0 once something was bought", () => {
  assert.equal(curvePercent(0), 0);
  assert.equal(curvePercent(0.03), 1);
  assert.equal(curvePercent(42.6), 43);
  assert.equal(curvePercent(99.7), 99);
  assert.equal(curvePercent(100), 99);
});
