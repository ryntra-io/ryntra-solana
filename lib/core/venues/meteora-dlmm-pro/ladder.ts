/**
 * «Buy cheaper», «sell higher»: what a person says, as a ladder of a DLMM Pro limit order.
 *
 * A person names a coin, a side and how far from the price — one slider, or one sentence to an agent. The program
 * knows none of that: an order is up to 25 ticks of one side of a pool's price, an **ask** resting token X above it
 * or a **bid** resting token Y below it (`./limit-orders.server.ts`). This file is the arithmetic between the two, and
 * nothing else: it reads no chain and builds no transaction.
 *
 * - **Which side.** The person's coin is one of the pool's two tokens. Buying token X cheaper is a bid; selling it
 *   higher is an ask. Where the coin is token Y the pool's price runs the other way — the coin gets cheaper as the
 *   price rises — so buying it cheaper is an ask and selling it higher a bid. The person's words stay the same.
 * - **Which prices.** A tick is the price 1.0001^tick, so a distance in percent is a distance in ticks whatever the
 *   price is: the rungs are spread evenly in ticks — evenly in percent — between the nearest and the farthest price
 *   asked for, on the ticks the pool's spacing allows, never more than 25 and never two on one tick.
 * - **How much on each.** Even, or more the farther from the price (`further`) — whole weights the program's own scale
 *   takes as they are.
 * - **The corridor.** A ladder is placed relative to where the price stands when it lands, and refused if the price
 *   has left the corridor meanwhile: an order never comes to rest on the wrong side of a price that moved. `null` asks
 *   for fixed ticks instead — only where the price cannot move, as before a pool opens.
 *
 * Distances are basis points of the coin's price now, always positive: for a buy how much cheaper, for a sell how much
 * dearer. What is told back is what the ticks allow — the caller shows these, not what was asked.
 *
 * Pure: no I/O, no clock, no SDK. Logarithms choose ticks; no amount of money is computed with them.
 */

import { FEE_SHARES } from "./fee.ts";
import { MAX_ORDER_TICKS, MAX_TICK_ID, MIN_TICK_ID, alignTickDown } from "./ticks.ts";

/** A buy rests no farther than 99 % under the price; a sell no farther than a hundred times over it. */
export const MAX_BUY_REACH_BPS = 9_900;
export const MAX_SELL_REACH_BPS = 990_000;
/** The corridor a ladder is given when the caller names none: 1 % of the price either way. */
export const DEFAULT_CORRIDOR_BPS = 100;
/** The widest corridor a caller may ask for: a tenth of the price either way. */
export const MAX_CORRIDOR_BPS = 1_000;
/** A ladder's rungs span at most this many ticks of the pool's spacing — the most a shape is worked out over (`./shapes.server.ts`). */
export const MAX_LADDER_SPAN = 10_000;

export type LadderIntent = Readonly<{
  action: "buy" | "sell";
  /** Which of the pool's two tokens the person's coin is. */
  coin: "x" | "y";
  /** The nearest rung, basis points of the coin's price from the price. Absent — as near as the pool's spacing allows. */
  nearBps?: number;
  /** The farthest rung, basis points of the coin's price from the price. */
  farBps: number;
  /** How many prices. Absent — as many as fit, up to 25. One — a single order at the farthest price. */
  rungs?: number;
  /** How the amount is spread: evenly, or more the farther from the price. Absent — evenly. */
  spread?: "even" | "further";
  /** How far the price may move before the ladder lands, basis points either way. Absent — 1 %; null — fixed ticks. */
  corridorBps?: number | null;
}>;

export type LadderPool = Readonly<{ tickSpacing: number; tickId: number }>;

export type LadderRung = Readonly<{
  tickId: number;
  /** A whole weight, 1 and up: the rung's share of the amount is its weight over the sum of them. */
  weight: number;
  /** How far the rung's price is from the pool's price now, basis points of the coin's price: cheaper for a buy, dearer for a sell. */
  awayBps: number;
}>;

export type LadderPlan = Readonly<{
  /** The program's side: an ask rests token X above the price, a bid token Y below it. */
  side: "ask" | "bid";
  /** The token the order rests in, and the token a fill pays. */
  restsIn: "x" | "y";
  paysIn: "x" | "y";
  /** Nearest the price first. */
  rungs: readonly LadderRung[];
  /** The request `orders.place` takes: the rungs as a shape of the caller's own weights. */
  shape: Readonly<{ strategy: "custom"; minTickId: number; maxTickId: number; weights: readonly Readonly<{ tickId: number; weight: number }>[] }>;
  /** The corridor in ticks, a multiple of the spacing; null — fixed ticks. */
  slippageTicks: number | null;
  /** What the ticks gave: the nearest and the farthest rung from the price, and the corridor. */
  nearBps: number;
  farBps: number;
  corridorBps: number | null;
}>;

export type LadderRefusalCode = "BAD_INPUT" | "TOO_NEAR" | "TOO_FAR" | "TOO_WIDE";

export class LadderRefusal extends Error {
  readonly code: LadderRefusalCode;
  constructor(code: LadderRefusalCode, message: string) {
    super(message);
    this.name = "LadderRefusal";
    this.code = code;
  }
}

const LN_TICK = Math.log(1.0001);
/** How many ticks a price multiple is: 1.0001^ticks = multiple. */
export const ticksOfMultiple = (multiple: number): number => Math.log(multiple) / LN_TICK;
/** The price multiple of a distance in ticks. */
export const multipleOfTicks = (ticks: number): number => Math.exp(ticks * LN_TICK);

const whole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** The coin's price multiple of a distance, by what the person is doing: under one for a buy, over one for a sell. */
const coinMultipleOf = (action: "buy" | "sell", bps: number) => (action === "buy" ? 1 - bps / 10_000 : 1 + bps / 10_000);
/** How far a tick's price is from the price at `fromTick`, basis points of the coin's price, positive away from it. */
function awayBpsOf(action: "buy" | "sell", coin: "x" | "y", tickId: number, fromTick: number): number {
  const pool = multipleOfTicks(tickId - fromTick);
  const ofCoin = coin === "x" ? pool : 1 / pool;
  return Math.round((action === "buy" ? 1 - ofCoin : ofCoin - 1) * 10_000);
}

/** The farthest a ladder may reach on this pool, basis points of the coin's price — what a slider's end is. */
export function ladderReachOf(action: "buy" | "sell", coin: "x" | "y", pool: LadderPool): number {
  const cap = action === "buy" ? MAX_BUY_REACH_BPS : MAX_SELL_REACH_BPS;
  const aligned = alignTickDown(pool.tickId, pool.tickSpacing);
  /* The pool's side the ladder goes to, and how many ticks of it are left before the program's last one — or the widest shape. */
  const up = (action === "sell") === (coin === "x");
  const room = Math.min(MAX_LADDER_SPAN * pool.tickSpacing, up ? MAX_TICK_ID - aligned - pool.tickSpacing : aligned - MIN_TICK_ID - pool.tickSpacing);
  if (room < pool.tickSpacing) return 0;
  const reach = awayBpsOf(action, coin, up ? aligned + room : aligned - room, pool.tickId);
  return Math.max(0, Math.min(cap, reach));
}

/** A ladder for what a person asked, on a pool at its price now. Refuses what cannot be placed as asked. */
export function ladderPlanOf(intent: LadderIntent, pool: LadderPool): LadderPlan {
  if (intent.action !== "buy" && intent.action !== "sell") throw new LadderRefusal("BAD_INPUT", "A ladder buys or sells.");
  if (intent.coin !== "x" && intent.coin !== "y") throw new LadderRefusal("BAD_INPUT", "The coin is one of the pool's two tokens.");
  if (!whole(pool.tickSpacing, 1, 256) || !whole(pool.tickId, MIN_TICK_ID, MAX_TICK_ID)) throw new LadderRefusal("BAD_INPUT", "The pool's spacing or price is not one the program has.");
  const cap = intent.action === "buy" ? MAX_BUY_REACH_BPS : MAX_SELL_REACH_BPS;
  if (!whole(intent.farBps, 1, cap)) throw new LadderRefusal("BAD_INPUT", `The farthest price is from 1 to ${cap} basis points away.`);
  if (intent.nearBps !== undefined && !whole(intent.nearBps, 1, intent.farBps)) throw new LadderRefusal("BAD_INPUT", "The nearest price is from 1 basis point away to the farthest price.");
  if (intent.rungs !== undefined && !whole(intent.rungs, 1, MAX_ORDER_TICKS)) throw new LadderRefusal("BAD_INPUT", `A ladder has from 1 to ${MAX_ORDER_TICKS} prices.`);
  if (intent.spread !== undefined && intent.spread !== "even" && intent.spread !== "further") throw new LadderRefusal("BAD_INPUT", "The amount is spread evenly, or more the farther from the price.");
  if (intent.corridorBps !== undefined && intent.corridorBps !== null && !whole(intent.corridorBps, 0, MAX_CORRIDOR_BPS)) throw new LadderRefusal("BAD_INPUT", `The corridor is from 0 to ${MAX_CORRIDOR_BPS} basis points.`);

  const spacing = pool.tickSpacing;
  const aligned = alignTickDown(pool.tickId, spacing);
  /* Up the pool's price: selling token X, or buying token Y. Down it: the other two. */
  const up = (intent.action === "sell") === (intent.coin === "x");
  const direction = up ? 1 : -1;
  /* A distance of the coin's price as steps of the spacing from the price, at least one: an ask stands above the price's own tick, a bid below its aligned one. */
  const stepsOf = (bps: number) => {
    const ofCoin = coinMultipleOf(intent.action, bps);
    const ticks = Math.abs(ticksOfMultiple(intent.coin === "x" ? ofCoin : 1 / ofCoin));
    return Math.max(1, Math.round(ticks / spacing));
  };
  const farSteps = stepsOf(intent.farBps);
  const nearSteps = intent.nearBps === undefined ? 1 : Math.min(farSteps, stepsOf(intent.nearBps));
  const lastTick = aligned + direction * farSteps * spacing;
  if (lastTick > MAX_TICK_ID - spacing || lastTick < MIN_TICK_ID) throw new LadderRefusal("TOO_FAR", "The farthest price is past the program's last tick.");
  if (farSteps - nearSteps + 1 > MAX_LADDER_SPAN) throw new LadderRefusal("TOO_WIDE", `A ladder spans at most ${MAX_LADDER_SPAN} ticks of the pool's spacing.`);

  /* The rungs: evenly between the nearest and the farthest step, each on its own tick. One rung stands at the farthest. */
  const fit = Math.min(intent.rungs ?? MAX_ORDER_TICKS, MAX_ORDER_TICKS, farSteps - nearSteps + 1);
  const steps = fit === 1 ? [farSteps] : Array.from({ length: fit }, (_, index) => nearSteps + Math.round((index * (farSteps - nearSteps)) / (fit - 1)));
  const unique = [...new Set(steps)];
  const rungs: LadderRung[] = unique.map((step, index) => {
    const tickId = aligned + direction * step * spacing;
    return { tickId, weight: intent.spread === "further" ? index + 1 : 1, awayBps: awayBpsOf(intent.action, intent.coin, tickId, pool.tickId) };
  });
  if (rungs[0]!.awayBps <= 0) throw new LadderRefusal("TOO_NEAR", "The nearest price is not past the price now.");

  const tickIds = rungs.map((rung) => rung.tickId);
  const corridorBps = intent.corridorBps === undefined ? DEFAULT_CORRIDOR_BPS : intent.corridorBps;
  /* The corridor in ticks, rounded up to the spacing: a multiple of it, as the program asks, and never none at all where one was asked for. */
  const slippageTicks = corridorBps === null ? null : Math.ceil(ticksOfMultiple(1 + corridorBps / 10_000) / spacing) * spacing;
  return {
    side: up ? "ask" : "bid",
    restsIn: up ? "x" : "y",
    paysIn: up ? "y" : "x",
    rungs,
    shape: { strategy: "custom", minTickId: Math.min(...tickIds), maxTickId: Math.max(...tickIds), weights: rungs.map(({ tickId, weight }) => ({ tickId, weight })) },
    slippageTicks,
    nearBps: rungs[0]!.awayBps,
    farBps: rungs[rungs.length - 1]!.awayBps,
    corridorBps,
  };
}

/**
 * What a maker keeps of the fee a swap pays on what the order filled, basis points of the filled amount: half of the
 * pool's fee is the makers' (Meteora's rule), and a fifth of that half goes to the order's referral where it names one
 * (Ryntra's, decision D-M3). `feeBps` is the pool's fee as it stands — it moves with the pool's schedule and with
 * volatility, so this is the share now, not a promise of the share at the fill.
 */
export function makerShareOf(feeBps: number, referral: boolean): Readonly<{ makerBps: number; ownerBps: number; referralBps: number }> {
  const makerBps = (feeBps * (10_000 - FEE_SHARES.protocolOfOrdersBps)) / 10_000;
  const referralBps = referral ? (makerBps * FEE_SHARES.referralOfOrderFeeBps) / 10_000 : 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { makerBps: round(makerBps), ownerBps: round(makerBps - referralBps), referralBps: round(referralBps) };
}
