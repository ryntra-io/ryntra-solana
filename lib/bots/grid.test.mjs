import assert from "node:assert/strict";
import test from "node:test";

import { binsFrom } from "../liquidity/studio/actions.ts";
import {
  GRID_LEVELS,
  GRID_PLACE,
  GRID_SETTLE_MS,
  GRID_SIDES,
  gridBins,
  gridHalf,
  gridResult,
  gridSides,
  gridState,
  planGrid,
  readGridBot,
} from "./grid.ts";

const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const POSITION = "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6";

const view = (over = {}) => ({
  kind: "dlmm",
  address: POSITION,
  pool: POOL,
  name: "SOL/USDC",
  x: { symbol: "SOL", amount: 0.5, unclaimed: 0.001, priceUsd: 200 },
  y: { symbol: "USDC", amount: 100, unclaimed: 0.2, priceUsd: 1 },
  rangeState: "in_range",
  lower: 190,
  upper: 210,
  price: 200,
  valueUsd: 200,
  unclaimedUsd: 0.4,
  lockedBps: 0,
  feesElsewhere: false,
  hasRewards: false,
  slot: 1,
  at: 1_000_000,
  pricesAt: null,
  ...over,
});

test("a grid's bins are the very bins the pools' Review builds for its side and width", () => {
  for (const side of GRID_SIDES) {
    for (const levels of GRID_LEVELS) {
      for (const activeBin of [-4_217, 0, 812]) {
        const bins = gridBins(activeBin, side, levels);
        assert.deepEqual(bins, binsFrom(activeBin, { place: GRID_PLACE[side], half: gridHalf(levels) }), `${side} ${levels} at ${activeBin}`);
        assert.equal(bins.upper - bins.lower + 1, levels, "one bin a level");
      }
    }
  }
  /* The Review takes a half-width of 0–34: the widest grid is one position of 69 bins. */
  assert.ok(GRID_LEVELS.every((levels) => levels % 2 === 1 && gridHalf(levels) <= 34));
});

test("a buying grid sits below the price in the quote, a selling one above it in the base, both across it", () => {
  const input = { activeBin: 100, binStepBps: 10, price: 200, levels: 21, amountX: 1, amountY: 210 };
  const buy = planGrid({ ...input, side: "buy" });
  assert.ok(buy.upperPrice < 200 && buy.upPct === 0 && buy.downPct > 0);
  assert.equal(buy.buyLevels, 21);
  assert.equal(buy.sellLevels, 0);
  assert.deepEqual(buy.perLevel, { x: 0, y: 10 }, "the base typed for a buying grid is not put in");

  const sell = planGrid({ ...input, side: "sell" });
  assert.ok(sell.lowerPrice > 200 && sell.downPct === 0 && sell.upPct > 0);
  assert.deepEqual(sell.perLevel, { x: 1 / 21, y: 0 });

  const both = planGrid({ ...input, side: "both" });
  assert.ok(both.lowerPrice < 200 && both.upperPrice > 200);
  assert.equal(both.buyLevels, 11, "ten below and the price's own");
  assert.equal(both.sellLevels, 11);
  assert.deepEqual(gridSides("both"), { x: true, y: true });
});

test("the levels are the pool's own steps: each one bin step above the last", () => {
  const plan = planGrid({ activeBin: 0, binStepBps: 25, price: 1, side: "both", levels: 11, amountX: 0, amountY: 0 });
  assert.equal(plan.stepPct, 0.25);
  assert.ok(Math.abs(plan.upperPrice - 1.0025 ** 5) < 1e-12);
  assert.ok(Math.abs(plan.lowerPrice - 1.0025 ** -5) < 1e-12);
  assert.ok(Math.abs(plan.upPct - (1.0025 ** 5 - 1) * 100) < 1e-9);
});

test("a choice that is not a grid makes no plan", () => {
  const base = { activeBin: 0, binStepBps: 10, price: 1, side: "both", levels: 21, amountX: 1, amountY: 1 };
  assert.equal(planGrid({ ...base, levels: 20 }), null, "an even count the Review cannot build");
  assert.equal(planGrid({ ...base, levels: 71 }), null, "wider than one position");
  assert.equal(planGrid({ ...base, price: 0 }), null);
  assert.equal(planGrid({ ...base, binStepBps: 0 }), null);
  assert.equal(planGrid({ ...base, activeBin: 1.5 }), null);
});

test("a stored bot is read field by field; anything else is no bot", () => {
  const bot = { position: POSITION, pool: POOL, pair: "SOL/USDC", side: "both", levels: 21, lowerPrice: 190, upperPrice: 210, at: 5 };
  assert.deepEqual(readGridBot(bot), bot);
  assert.equal(readGridBot({ ...bot, levels: 22 }), null);
  assert.equal(readGridBot({ ...bot, side: "short" }), null);
  assert.equal(readGridBot({ ...bot, position: "not a key" }), null);
  assert.equal(readGridBot({ ...bot, upperPrice: 100 }), null, "the highest level under the lowest");
  assert.equal(readGridBot({ ...bot, pair: "" }), null);
  assert.equal(readGridBot(null), null);
  assert.deepEqual(readGridBot({ ...bot, missedAt: 9 }), { ...bot, missedAt: 9 }, "a first read without the position is kept");
  assert.deepEqual(readGridBot({ ...bot, missedAt: "x" }), bot, "a broken mark is no mark");
});

test("the bot's state: working inside its levels; off them by side; closed only once the chain has had time", () => {
  const bot = (side) => ({ position: POSITION, pool: POOL, pair: "SOL/USDC", side, levels: 21, lowerPrice: 190, upperPrice: 210, at: 1_000_000 });
  assert.equal(gridState(bot("both"), view(), { at: 1_000_000 }), "working");
  /* The position above the price holds only the base: a buying grid has bought it all; a selling one waits. */
  assert.equal(gridState(bot("buy"), view({ rangeState: "above" }), null), "all_bought");
  assert.equal(gridState(bot("both"), view({ rangeState: "above" }), null), "all_bought");
  assert.equal(gridState(bot("sell"), view({ rangeState: "above" }), null), "waiting");
  assert.equal(gridState(bot("sell"), view({ rangeState: "below" }), null), "all_sold");
  assert.equal(gridState(bot("buy"), view({ rangeState: "below" }), null), "waiting");
  /* Missing from a read: too fresh to tell, then closed. */
  assert.equal(gridState(bot("both"), null, null), null);
  assert.equal(gridState(bot("both"), null, { at: 1_000_000 + GRID_SETTLE_MS - 1 }), null);
  assert.equal(gridState(bot("both"), null, { at: 1_000_000 + GRID_SETTLE_MS }), "closed");
});

test("the bot's one number: value and fees against what went in at its own prices", () => {
  const entry = { x: 0.5, y: 100, usd: 195, claimedUsd: 0.6, at: 1, source: "ryntra" };
  const result = gridResult(view(), entry);
  /* 200 held + 0.4 unclaimed + 0.6 claimed − 195 in. */
  assert.ok(Math.abs(result.usd - 6) < 1e-9);
  assert.ok(Math.abs(result.pct - (6 / 195) * 100) < 1e-9);
  assert.ok(Math.abs(result.feesUsd - 1) < 1e-9);
  assert.equal(gridResult(view(), null), null, "no entry — no number, never a guess");
  assert.equal(gridResult(view(), { ...entry, usd: null }), null, "an entry without its prices");
  assert.equal(gridResult(view({ valueUsd: null }), entry), null, "the position unpriced");
});

test("after an action the grids read the chain again, past the server's kept answer, and are charged for it", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../app/api/liquidity/positions/route.ts", import.meta.url), "utf8");
  assert.match(route, /const rate = !fresh && hasFreshPositions\(owner\) \? FREE : POSITIONS_LIMITER\.consume/, "a fresh read is never free");
  assert.match(route, /if \(fresh\) forgetWalletPositions\(owner\);/, "a fresh read drops the kept answer before it reads");
  const hook = readFileSync(new URL("../../app/app/markets/pools/my-positions.tsx", import.meta.url), "utf8");
  assert.match(hook, /actedLately\(owner\) \? "&fresh=1" : ""/, "only a read soon after an action asks for it");
  assert.match(hook, /export function forgetPositions[\s\S]*?markActed\(owner\);/, "every action marks the wallet");
  const grids = readFileSync(new URL("../../app/app/bots/my-grids.tsx", import.meta.url), "utf8");
  assert.match(grids, /usePositions\(owner && bots && bots\.length > 0 \? owner : null, reread\)/);
  assert.match(grids, /if \(acted\) setReread\(\(n\) => n \+ 1\);/);
});
