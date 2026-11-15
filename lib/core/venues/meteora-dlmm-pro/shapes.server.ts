/**
 * Liquidity shapes of DLMM Pro: how an amount is spread over a pool's ticks — for a position's ranges and
 * for a limit order's ladder alike.
 *
 * The SDK publishes four: **Spot** (even), **Curve** (most near the price, thinning away from it), **Bid-Ask** (least
 * near the price, thickening away from it) and **Custom** (the caller's own weight per tick). Wave is not one of them
 * in 0.1.2, and this venue does not draw a shape Meteora has not published. Every shape here is the SDK's own
 * `buildLiquidityShape`; this file only names the request and reads the answer back as plain numbers.
 *
 * A shape is a column per tick of the pool's spacing between `minTickId` and `maxTickId`, each with a weight from 1 to
 * 255, and the ranges those columns merge into — at most 45 for a position. A shape with more is fitted by coarsening
 * its weights (`maxRanges`), never by dropping ticks.
 */

import { LiquidityLayout, MAX_LIQUIDITY_WEIGHT, StrategyType, buildLiquidityShape, type LiquidityShape } from "@meteora-ag/dlmm-pro-sdk";

import { DlmmProRefusal } from "./sdk.server.ts";
import { MAX_POSITION_RANGES, MAX_TICK_ID, isUsableTick } from "./ticks.ts";

export const SHAPE_STRATEGIES = ["spot", "curve", "bidAsk", "custom"] as const;
/**
 * The most ticks a shape is worked out over. A shape is worked out a column a tick, in the caller's own request: ten
 * thousand take a fifth of a second and come back as half a megabyte, and a full range of a spacing of 1 would be
 * nearly a million. One shape needs no working out: an even one — Spot — is a single range whatever its width, so a
 * position may take a Spot shape wider than this, the whole of a pool's prices among them, told as that one range
 * with no columns. Any other shape that wide, and any shape of a limit order — which rests on the ticks themselves —
 * is refused.
 */
export const MAX_SHAPE_COLUMNS = 10_000;
export type ShapeStrategy = (typeof SHAPE_STRATEGIES)[number];

export type ShapeRequest = Readonly<{
  strategy: ShapeStrategy;
  /** The first and the last tick the shape stands on; each a tick of the pool's spacing. The last column reaches one spacing above `maxTickId`. */
  minTickId: number;
  maxTickId: number;
  /** For `custom`: a weight per tick, whole, from 0 to 255 — the program's own scale, so the proportions asked for are the proportions built; a tick left out has none. */
  weights?: readonly Readonly<{ tickId: number; weight: number }>[];
  /**
   * How columns become a position's ranges: `vertical` — side by side, one weight each (the default); `horizontal` —
   * overlapping layers that add up. A limit order ignores it.
   */
  layout?: "vertical" | "horizontal";
}>;

const STRATEGY: Readonly<Record<ShapeStrategy, StrategyType>> = { spot: StrategyType.Spot, curve: StrategyType.Curve, bidAsk: StrategyType.BidAsk, custom: StrategyType.Custom };

/**
 * The SDK's shape for a request on a pool at `currentTickId`. `maxRanges` — the most ranges it may merge into.
 * `needs` — what the caller builds from it: a limit order its `columns`, a position its `ranges` alone.
 */
export function shapeOf(request: ShapeRequest, pool: Readonly<{ tickSpacing: number; tickCurrentId: number }>, maxRanges: number | null = MAX_POSITION_RANGES, needs: "columns" | "ranges" = "columns"): LiquidityShape {
  const strategy = STRATEGY[request.strategy];
  if (strategy === undefined) throw new DlmmProRefusal("BAD_INPUT", "The shape is Spot, Curve, Bid-Ask or the caller's own weights.");
  if (!isUsableTick(request.minTickId, pool.tickSpacing) || !isUsableTick(request.maxTickId, pool.tickSpacing) || request.minTickId > request.maxTickId) {
    throw new DlmmProRefusal("BAD_INPUT", `The shape's ticks are multiples of the pool's spacing (${pool.tickSpacing}), the first not above the last.`);
  }
  const columns = (request.maxTickId - request.minTickId) / pool.tickSpacing + 1;
  const layout = request.layout === "horizontal" ? LiquidityLayout.Horizontal : LiquidityLayout.Vertical;
  if (columns > MAX_SHAPE_COLUMNS) {
    if (request.strategy !== "spot" || needs !== "ranges") throw new DlmmProRefusal("BAD_INPUT", `A shape is worked out over at most ${MAX_SHAPE_COLUMNS} ticks; this one asks for ${columns}. Only a position's even shape may be wider: it is one range.`);
    if (request.maxTickId + pool.tickSpacing > MAX_TICK_ID) throw new DlmmProRefusal("BAD_INPUT", "The shape's last tick reaches past the program's last one.");
    /* The SDK's own Spot shape of one column — its weight, its fields — drawn out to the shape's last tick: what the SDK merges every Spot shape into. */
    const one = buildLiquidityShape({ strategy, minTickId: request.minTickId, maxTickId: request.minTickId, tickSpacing: pool.tickSpacing, currentTickId: pool.tickCurrentId, layout, maxRanges: 1 });
    return { ...one, columns: [], ranges: [{ ...one.ranges[0]!, tickUpperId: request.maxTickId + pool.tickSpacing }] };
  }
  if (request.strategy === "custom") {
    if (!request.weights || request.weights.length === 0) throw new DlmmProRefusal("BAD_INPUT", "A shape of the caller's own needs its weights.");
    /* A weight outside the shape's own ticks would put liquidity, or an order, where the request did not say. */
    for (const entry of request.weights) {
      if (!isUsableTick(entry.tickId, pool.tickSpacing) || entry.tickId < request.minTickId || entry.tickId > request.maxTickId) throw new DlmmProRefusal("BAD_INPUT", `The weight at tick ${entry.tickId} is outside the shape, or not on the pool's spacing.`);
      /* The SDK would rescale a larger weight to 255 and silently change the proportions between ticks. */
      if (!Number.isInteger(entry.weight) || entry.weight < 0 || entry.weight > MAX_LIQUIDITY_WEIGHT) throw new DlmmProRefusal("BAD_INPUT", `The weight at tick ${entry.tickId} is not a whole number from 0 to ${MAX_LIQUIDITY_WEIGHT}.`);
    }
  }
  return buildLiquidityShape({
    strategy,
    minTickId: request.minTickId,
    maxTickId: request.maxTickId,
    tickSpacing: pool.tickSpacing,
    currentTickId: pool.tickCurrentId,
    ...(request.strategy === "custom" ? { weights: request.weights!.map((entry) => ({ tickId: entry.tickId, weight: entry.weight })) } : {}),
    layout,
    ...(maxRanges === null ? {} : { maxRanges }),
  });
}

export type ShapeView = Readonly<{
  strategy: ShapeStrategy;
  /** A column per tick: where it stands, its weight, and which side of the price it is on. Empty for a position's even shape wider than `MAX_SHAPE_COLUMNS`: it is told as its one range. */
  columns: readonly Readonly<{ tickId: number; weight: number; side: "bid" | "ask" | "active" }>[];
  /** The ranges a position holds the shape in, in slot order. */
  ranges: readonly Readonly<{ tickLowerId: number; tickUpperId: number; weight: number }>[];
}>;

const SIDES = ["bid", "ask", "active"] as const;

/** A shape as plain numbers. */
export function shapeViewOf(strategy: ShapeStrategy, shape: LiquidityShape): ShapeView {
  return {
    strategy,
    columns: shape.columns.map((column) => ({ tickId: column.tickId, weight: column.weight, side: SIDES[column.side] ?? "active" })),
    ranges: shape.ranges.map((range) => ({ tickLowerId: range.tickLowerId, tickUpperId: range.tickUpperId, weight: range.weight })),
  };
}
