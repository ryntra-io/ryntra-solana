/**
 * DLMM Pro SDK 0.1.3 and its Wave, with no network: the shape as the SDK draws it, the goal «Wave» that
 * stands on it, the same Wave on the grid of a shape of one's own, what the SDK's rework of Curve and Bid-Ask left as
 * it was, and an opening in a wave built and reviewed on the moment the earn rehearsal froze (the build deployed on
 * mainnet, in LiteSVM).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { StrategyType } from "@meteora-ag/dlmm-pro-sdk";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const fixture = readFixture(new URL("./fixtures/earn-rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;

/* The surface reads the deployment's own switches: this test is a devnet deployment of earning, as the earn tests are. */
process.env.RYNTRA_EARN_PRO = "devnet";
process.env.RYNTRA_EARN_PRO_DEVNET_REFERRAL = who.referral;
const ENV = Object.freeze({ RYNTRA_EARN_PRO: "devnet", RYNTRA_EARN_PRO_DEVNET_COIN: `${addresses.usdc}:USDC`, BETA_TOKEN_SECRET: "a-test-secret-of-enough-length" });

const { EARN_GOALS, EARN_STYLES, GOAL_MAX_RANGES, GOAL_STRATEGY, STYLE_STEPS, WAVE_MAX_RANGES, customPlanOf, goalPlanOf, isEarnGoal, openPlanOf } = await import("./goals.ts");
const { SHAPE_STRATEGIES, shapeOf } = await import("./shapes.server.ts");
const { DLMM_PRO_SDK_VERSION, DlmmProRefusal } = await import("./sdk.server.ts");
const { createDlmmProVenue } = await import("./venue.server.ts");
const { GRID_CELL_WEIGHT, GRID_LEVELS, GRID_WAVE, gridFault, gridRanges, rangesOfLayout } = await import("../../liquidity-grid.ts");
const { EARN_PRO_GOALS, EarnProReviewRequestSchema, EarnProSummarySchema } = await import("../../../api/v1/contract.ts");
const { parseEarnProReview, reviewEarnPro } = await import("../../../earn-pro/actions.server.ts");

const POOL = { tickSpacing: 10, tickCurrentId: -18_934 };
const HERE = -18_940;
const weightsOf = (shape) => shape.columns.map((column) => column.weight);
const refused = (work) => work().then(() => null, (error) => (error instanceof DlmmProRefusal ? error.code : `not a refusal: ${error}`));

/* ------------------------------------------------------------------ the SDK's Wave */

test("the SDK is 0.1.3, and Wave is its fifth shape — a strategy of the venue and a goal of earning", () => {
  assert.equal(DLMM_PRO_SDK_VERSION, "0.1.3");
  assert.equal(StrategyType.Wave, 4);
  assert.deepEqual([...SHAPE_STRATEGIES], ["spot", "curve", "bidAsk", "wave", "custom"]);
  assert.deepEqual([...EARN_GOALS], ["even", "near", "edges", "wave"]);
  assert.equal(isEarnGoal("wave"), true);
  assert.equal(GOAL_STRATEGY.wave, "wave");
  assert.equal(GOAL_MAX_RANGES.wave, WAVE_MAX_RANGES);
  assert.equal(WAVE_MAX_RANGES, 9);
  /* The contract names the same goals, the engine's and the wire's in one order. */
  assert.deepEqual([...EARN_PRO_GOALS], [...EARN_GOALS]);
});

test("«Wave» is even over the half of each side nearest the price, then rises in four steps to twice that at the edges", () => {
  const plan = goalPlanOf("wave", "balanced", POOL);
  assert.equal(plan.goal, "wave");
  assert.deepEqual(plan.shape, { strategy: "wave", minTickId: HERE - 160, maxTickId: HERE + 160 });
  assert.deepEqual([plan.tickLowerId, plan.tickUpperId], [HERE - 160, HERE + 170]);
  const shape = shapeOf(plan.shape, POOL, plan.maxRanges, "ranges");
  /* Sixteen steps a side and the step the price stands in: 4 by the price, 8 at the edges — the SDK's own scale. */
  const side = [4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
  assert.deepEqual(weightsOf(shape), [...[...side].reverse(), 4, ...side]);
  assert.deepEqual(shape.columns.map((column) => column.side).filter((side, index, all) => side !== all[index - 1]), [0, 2, 1], "bid, the price's own step, ask");
  /* The even middle is one range; each of the four steps up, on each side, one more. */
  assert.equal(shape.ranges.length, 9);
  assert.deepEqual(
    shape.ranges.map((range) => [range.tickLowerId - HERE, range.tickUpperId - HERE, range.weight]),
    [[-160, -140, 8], [-140, -120, 7], [-120, -100, 6], [-100, -80, 5], [-80, 90, 4], [90, 110, 5], [110, 130, 6], [130, 150, 7], [150, 170, 8]],
  );
});

test("at every width a wave is the SDK's own, in at most nine ranges either way it is laid — and never coarsened", () => {
  const ranges = {};
  for (const style of EARN_STYLES) {
    const plan = goalPlanOf("wave", style, POOL);
    const steps = STYLE_STEPS[style];
    assert.deepEqual([plan.shape.minTickId, plan.shape.maxTickId, plan.maxRanges], [HERE - steps * 10, HERE + steps * 10, 9], style);
    const free = shapeOf(plan.shape, POOL, null, "ranges");
    const held = shapeOf(plan.shape, POOL, plan.maxRanges, "ranges");
    assert.deepEqual(weightsOf(held), weightsOf(free), `${style}: the bound of nine never changes a weight`);
    const weights = weightsOf(free);
    const middle = steps;
    assert.equal(weights[middle], 4, `${style}: 4 by the price`);
    assert.deepEqual([weights[0], weights.at(-1)], [8, 8], `${style}: twice that at the edges`);
    for (let distance = 1; distance <= steps; distance += 1) {
      for (const at of [middle - distance, middle + distance]) {
        /* The SDK's rule: never under 4, and the share of the way to the edge times 8, rounded up. */
        assert.equal(weights[at], Math.max(4, Math.ceil((8 * distance) / steps)), `${style}: ${distance} steps out`);
        assert.ok(weights[at] >= weights[at + (at < middle ? 1 : -1)], `${style}: never falling outwards`);
      }
    }
    for (const layout of ["vertical", "horizontal"]) {
      const laid = shapeOf({ ...plan.shape, layout }, POOL, 45, "ranges");
      assert.ok(laid.ranges.length <= WAVE_MAX_RANGES, `${style}/${layout}: ${laid.ranges.length}`);
      /* Our grid's rule counts what the SDK merges: the ticket's count of any wave is the SDK's own. */
      const count = rangesOfLayout(laid.columns.map((column) => ({ tickId: column.tickId, weight: column.weight })), POOL.tickSpacing);
      assert.equal(count[layout], laid.ranges.length, `${style}/${layout}: the grid rule's count`);
    }
    ranges[style] = held.ranges.length;
  }
  assert.deepEqual(ranges, { calm: 9, balanced: 9, dense: 7 });
});

test("a wave's range is cut at the program's last ticks as any goal's, refused where a side is gone, and takes no columns", async () => {
  const { MAX_TICK_ID } = await import("./ticks.ts");
  const cut = goalPlanOf("wave", "calm", { tickSpacing: 100, tickCurrentId: MAX_TICK_ID - 1_050 });
  assert.ok(cut.tickUpperId <= MAX_TICK_ID && cut.shape.minTickId < cut.shape.maxTickId);
  const shape = shapeOf(cut.shape, { tickSpacing: 100, tickCurrentId: MAX_TICK_ID - 1_050 }, cut.maxRanges, "ranges");
  assert.ok(shape.ranges.length <= WAVE_MAX_RANGES && weightsOf(shape).every((weight) => weight >= 4 && weight <= 8));
  assert.equal(goalPlanOf("wave", "calm", { tickSpacing: 100, tickCurrentId: MAX_TICK_ID - 50 }), null);
  assert.equal(openPlanOf("wave", "balanced", POOL, GRID_WAVE), null, "a goal takes no columns");
  assert.deepEqual(openPlanOf("wave", "balanced", POOL), goalPlanOf("wave", "balanced", POOL));
});

/* ------------------------------------------------------------------ the same Wave on the grid of a shape of one's own */

test("Meteora's Wave on the grid: half the height by the price, full at the edges — on «Balanced» the SDK's Wave to the tick", () => {
  assert.equal(GRID_WAVE.length, 32);
  assert.equal(Object.isFrozen(GRID_WAVE), true);
  assert.equal(gridFault(GRID_WAVE), null, "a grid the engine builds");
  assert.deepEqual([...GRID_WAVE.slice(16)], [4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  assert.deepEqual([...GRID_WAVE.slice(0, 16)], [...GRID_WAVE.slice(16)].reverse(), "mirrored about the price");
  assert.deepEqual([Math.min(...GRID_WAVE), Math.max(...GRID_WAVE)], [GRID_LEVELS / 2, GRID_LEVELS]);
  /* A column a step: every tick the grid's cells times a cell's weight, in the very proportions of the SDK's Wave. */
  const grid = customPlanOf(GRID_WAVE, "balanced", POOL);
  const sdk = shapeOf(goalPlanOf("wave", "balanced", POOL).shape, POOL, null, "ranges");
  assert.deepEqual([grid.shape.minTickId, grid.shape.maxTickId], [HERE - 160, HERE + 160]);
  assert.deepEqual(grid.shape.weights.map((tick) => tick.weight), weightsOf(sdk).map((weight) => weight * GRID_CELL_WEIGHT));
  assert.equal(grid.ranges, 9);
  assert.deepEqual(shapeOf(grid.shape, POOL, grid.maxRanges, "ranges").ranges.map((range) => [range.tickLowerId, range.tickUpperId]), sdk.ranges.map((range) => [range.tickLowerId, range.tickUpperId]), "the same nine ranges");
  /* On the other widths the grid's rule lays it over the steps; it fits one position everywhere — what the ticket says. */
  assert.deepEqual(Object.fromEntries(EARN_STYLES.map((style) => [style, gridRanges(GRID_WAVE, STYLE_STEPS[style])])), { calm: 9, balanced: 9, dense: 7 });
});

/* ------------------------------------------------------------------ what 0.1.3 reworked and left as it was */

/**
 * 0.1.3 drew Curve and Bid-Ask on one side of the price through the same path as around it (the price's step held to
 * the range's nearer end) where 0.1.2 drew them along a line from the nearer end. The ladders of limit orders stand
 * there. This is 0.1.2's own rule, written out, and the SDK now must give the same weights for it.
 */
function oneSidedOf012(strategy, columns, below) {
  const last = columns - 1;
  const most = Math.min(columns, 255);
  const fall = (distance) => (last === 0 ? most : Math.round(most - ((most - 1) * distance) / last));
  const rise = (distance) => (last === 0 ? 1 : Math.round(1 + ((most - 1) * distance) / last));
  /* The price under the range: Curve falls away from the first tick, Bid-Ask rises; over the range, the other way. */
  const curveLike = strategy === "curve" ? !below : below;
  return Array.from({ length: columns }, (_, index) => (curveLike ? rise(index) : fall(index)));
}

test("one side of the price — a ladder's case — Curve and Bid-Ask weigh every tick as 0.1.2 did", () => {
  for (const spacing of [1, 10, 64]) {
    /* Up to 45 ticks: a shape of a weight a tick merges into as many ranges, and a position holds at most 45. */
    for (const columns of [1, 2, 3, 5, 7, 16, 25, 44, 45]) {
      const minTickId = 1_000 * spacing;
      const maxTickId = minTickId + (columns - 1) * spacing;
      for (const below of [true, false]) {
        /* Under the range by a few steps, or over it: the price outside it either way. */
        const pool = { tickSpacing: spacing, tickCurrentId: below ? minTickId - 3 * spacing - 1 : maxTickId + 2 * spacing };
        for (const strategy of ["curve", "bidAsk"]) {
          const shape = shapeOf({ strategy, minTickId, maxTickId }, pool, null, "ranges");
          assert.deepEqual(weightsOf(shape), oneSidedOf012(strategy, columns, below), `${strategy}, ${columns} ticks of ${spacing}, price ${below ? "under" : "over"}`);
        }
        /* And Wave on one side: lightest at the nearer edge, as Meteora documents it. */
        const wave = weightsOf(shapeOf({ strategy: "wave", minTickId, maxTickId }, pool, null, "ranges"));
        const nearer = below ? wave[0] : wave.at(-1);
        assert.equal(nearer, 4, `wave, ${columns} ticks of ${spacing}`);
        assert.equal(Math.min(...wave), 4);
      }
    }
  }
});

/* ------------------------------------------------------------------ an opening in a wave, on the rehearsal's moment */

const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });
const connectionAt = (moment) => rpcConnection(snapshotSource(fixture.snapshots[moment], {}, lands));

test("a wave paid in SOL alone: the pool's swap, then the opening with its deposit in one transaction — nine ranges, every weight the SDK's", async () => {
  const venue = createDlmmProVenue({ connection: connectionAt("poolOpen"), referralOwner: who.referral });
  const nft = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
  const build = await venue.earn.open({ pool: addresses.pool, wallet: who.person, nftMint: nft, goal: "wave", style: "balanced", pay: { mint: addresses.sol, amountRaw: "2000000000" }, slippageBps: 100 });
  assert.deepEqual(build.steps.map((step) => step.roles.join("+")), ["SWAP", "OPEN+DEPOSIT"]);
  assert.deepEqual(build.steps.map((step) => step.cosigners), [[], [nft]], "the fresh key signs the opening alone");
  assert.equal(build.plan.goal, "wave");
  assert.equal(build.plan.maxRanges, 9);
  assert.equal(build.shape.ranges.length, 9);
  /* Built for the price the swap ends at: the SDK's own Wave on that price's ticks, nothing coarsened. */
  const after = { tickSpacing: 10, tickCurrentId: build.plan.shape.minTickId + 160 };
  assert.deepEqual(weightsOf(build.shape), weightsOf(shapeOf(goalPlanOf("wave", "balanced", after).shape, after, null, "ranges")));
  assert.ok(build.bandBps >= 1 && build.bandBps <= Math.floor(Math.min(build.plan.downBps, build.plan.upBps) / 8), `band ${build.bandBps}`);
  assert.ok(BigInt(build.swap.amountInRaw) + BigInt(build.deposit.maximumXRaw) <= 2_000_000_000n, "never more SOL than was named");
  assert.ok(BigInt(build.deposit.maximumYRaw) <= BigInt(build.swap.minimumOutRaw), "never more of the other coin than the swap surely pays");
  assert.equal(build.swap.referral, true);
  /* Every width opens the same way; a wave with columns is no wave. */
  for (const style of ["calm", "dense"]) {
    const other = await venue.earn.open({ pool: addresses.pool, wallet: who.person, nftMint: nft, goal: "wave", style, pay: { mint: addresses.sol, amountRaw: "2000000000" }, slippageBps: 100 });
    assert.deepEqual(other.steps.map((step) => step.roles.join("+")), ["SWAP", "OPEN+DEPOSIT"], style);
    assert.equal(other.shape.ranges.length, style === "dense" ? 7 : 9, style);
  }
  assert.equal(await refused(() => venue.earn.open({ pool: addresses.pool, wallet: who.person, nftMint: nft, goal: "wave", style: "balanced", columns: GRID_WAVE, pay: { mint: addresses.sol, amountRaw: "1000000000" }, slippageBps: 100 })), "BAD_INPUT");
});

test("the contract takes `goal: \"wave\"` beside the three goals, with no columns — and a Review of it answers as any goal's", async () => {
  const open = { action: "open", owner: who.person, pool: addresses.pool, goal: "wave", style: "balanced", lamports: "2000000000" };
  assert.equal(EarnProReviewRequestSchema.safeParse(open).success, true);
  assert.deepEqual(parseEarnProReview(open), open);
  assert.equal(EarnProReviewRequestSchema.safeParse({ ...open, columns: [...GRID_WAVE] }).success, false, "a goal takes no columns");
  assert.equal(parseEarnProReview({ ...open, columns: [...GRID_WAVE] }), null);
  for (const goal of ["even", "near", "edges", "custom"]) assert.equal(EarnProReviewRequestSchema.safeParse({ ...open, goal, ...(goal === "custom" ? { columns: [...GRID_WAVE] } : {}) }).success, true, `${goal} stands as it was`);
  assert.equal(EarnProReviewRequestSchema.safeParse({ ...open, goal: "Wave" }).success, false);

  /* A new shape of money behind its own switch: closed, a Review of it is refused before anything is read or built. */
  const closed = await reviewEarnPro(parseEarnProReview(open), { env: ENV, connection: connectionAt("poolOpen"), now: () => 5_000_000 });
  assert.deepEqual([closed.ok, closed.status, closed.code], [false, 404, "EARN_PRO_CLOSED"], "closed unless a deployment opens Wave");
  const ajar = await reviewEarnPro(parseEarnProReview(open), { env: { ...ENV, RYNTRA_EARN_PRO_WAVE: "1" }, connection: connectionAt("poolOpen") });
  assert.equal(ajar.code, "EARN_PRO_CLOSED", "only exactly «open» opens it");
  const reviewed = await reviewEarnPro(parseEarnProReview(open), { env: { ...ENV, RYNTRA_EARN_PRO_WAVE: "open" }, connection: connectionAt("poolOpen"), now: () => 5_000_000 });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  const { summary, transactions } = reviewed.value;
  assert.equal(EarnProSummarySchema.safeParse(summary).success, true, JSON.stringify(EarnProSummarySchema.safeParse(summary).error?.issues));
  assert.equal(transactions.length, 2, "the pool's swap, then the opening with its deposit");
  assert.equal(summary.ranges, 9);
  assert.ok(summary.lowerPrice < 150 && summary.upperPrice > 150 && summary.depositLamports > 0);
  /* The stop for new money holds a wave as it holds every opening. */
  const stopped = await reviewEarnPro(parseEarnProReview(open), { env: { ...ENV, RYNTRA_EARN_PRO_WAVE: "open", RYNTRA_EARN_PRO_STOP: "1" }, connection: connectionAt("poolOpen") });
  assert.deepEqual([stopped.ok, stopped.status, stopped.code], [false, 403, "EARN_PRO_STOPPED"]);
});
