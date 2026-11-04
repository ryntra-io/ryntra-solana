/**
 * The bots' simulations on candles: a DLMM grid, a limit ladder, reminder
 * DCA and plain holding, each with what it costs to run — the pool's fee a
 * taker pays, slippage, the network's signature fee and the priority fee —
 * and each against keeping what went in.
 *
 * **A grid is approximate.** A DLMM bin converts at its own price when the
 * price crosses it, which is what this replays: every level the candle's path
 * (open → low → high → close on a rising bar, open → high → low → close on a
 * falling one) crosses converts and earns the pool's fee on what it converted.
 * What candles cannot show — the order of trades inside a bar, swaps that
 * stay inside one bin, the pool's dynamic fee, other LPs' share of a bin — is
 * left out, so the figure is labelled «приблизно» wherever it is shown.
 *
 * Amounts are in the pair's quote (USDC on a dollar pair); `quoteUsd` turns
 * them into dollars. Pure. Floats: a picture, never a sum a transaction is
 * sized from.
 */

import { TRIGGER_V1_JUPITER_FEE_BPS, DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT } from "../../solana/limits/model.ts";
import type { Candle } from "./candles.ts";

/** Lamports per signature, Solana's base fee. */
export const SIGNATURE_LAMPORTS = 5_000;

export type ExecutionCosts = Readonly<{
  /** The pool's swap fee, basis points: a grid earns it on what its levels convert; a taker pays it. */
  poolFeeBps: number;
  /** What a taker trade loses to the price moving under it, basis points. */
  slippageBps: number;
  /** The priority fee one transaction bids, lamports. */
  priorityFeeLamports: number;
  /** SOL's price, for the network's fees. */
  solUsd: number;
  /** One unit of the pair's quote in dollars: 1 on a USDC pair. */
  quoteUsd: number;
}>;

/** Conservative defaults: a 0.25 % pool, 0.3 % slippage, 0.0001 SOL of priority a transaction. */
export const DEFAULT_COSTS: ExecutionCosts = Object.freeze({ poolFeeBps: 25, slippageBps: 30, priorityFeeLamports: 100_000, solUsd: 200, quoteUsd: 1 });

export type CostBreakdown = Readonly<{ networkUsd: number; priorityUsd: number; slippageUsd: number; protocolUsd: number }>;

export type SimResult = Readonly<{
  bot: "grid" | "ladder" | "dca" | "hold";
  /** True for a grid: candles cannot replay a bin's crossings exactly. */
  approximate: boolean;
  /** What went in, at the first open, USD. */
  startUsd: number;
  /** The bot at the last close, fees in and costs out, USD. */
  endUsd: number;
  /** What went in, kept untouched, at the last close, USD. */
  holdUsd: number;
  pnlUsd: number;
  vsHoldUsd: number;
  feesEarnedUsd: number;
  costs: CostBreakdown;
  /** The deepest fall of the bot's value from a high, along the closes. */
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  fills: number;
  /** What the bot holds at the end, each token's own unit, and the last close. */
  end: Readonly<{ base: number; quote: number; price: number }>;
  from: number;
  to: number;
}>;

const txUsd = (costs: ExecutionCosts, signatures: number) => ({
  network: ((SIGNATURE_LAMPORTS * signatures) / 1e9) * costs.solUsd,
  priority: (costs.priorityFeeLamports / 1e9) * costs.solUsd,
});

/** The prices a candle passes through, in order. */
export function candlePath(bar: Candle): readonly number[] {
  return bar.c >= bar.o ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
}

class Drawdown {
  #peak = Number.NEGATIVE_INFINITY;
  pct = 0;
  usd = 0;
  see(value: number) {
    this.#peak = Math.max(this.#peak, value);
    if (this.#peak > 0 && this.#peak - value > this.usd) {
      this.usd = this.#peak - value;
      this.pct = (this.usd / this.#peak) * 100;
    }
  }
}

/* ------------------------------------------------------------------ grid */

export type GridSetting = Readonly<{
  lower: number;
  upper: number;
  levels: number;
  side: "buy" | "sell" | "both";
  /** What the grid holds at the start, in the quote. */
  amountQuote: number;
}>;

type Level = { price: number; base: number; quote: number };

/** A grid as it runs: JSON-shaped, so a paper twin can be kept and resumed. */
export type GridState = Readonly<{
  levels: readonly Readonly<Level>[];
  price: number;
  /** Fees earned, in the quote. */
  fees: number;
  fills: number;
  feeBps: number;
}>;

/** The grid's levels from its lower to its upper price, one bin step apart (geometric). */
export function gridLevels(setting: Pick<GridSetting, "lower" | "upper" | "levels">): number[] {
  const { lower, upper, levels } = setting;
  if (!(lower > 0) || !(upper > lower) || !Number.isInteger(levels) || levels < 2) return [];
  const step = (upper / lower) ** (1 / (levels - 1));
  return Array.from({ length: levels }, (_, i) => lower * step ** i);
}

/**
 * The grid at its start: levels below the price hold the quote — they buy as the price falls to them — and levels
 * above hold the base, bought at the price now — they sell as it rises. A buying grid funds only the levels below,
 * a selling one only those above.
 */
export function gridStart(setting: GridSetting, price: number, feeBps: number): GridState {
  const prices = gridLevels(setting);
  const below = prices.filter((p) => p <= price);
  const above = prices.filter((p) => p > price);
  const funded = setting.side === "buy" ? below.length : setting.side === "sell" ? above.length : prices.length;
  const per = funded > 0 && setting.amountQuote > 0 ? setting.amountQuote / funded : 0;
  const levels = prices.map((p) => {
    if (p <= price) return { price: p, base: 0, quote: setting.side === "sell" ? 0 : per };
    return { price: p, base: setting.side === "buy" ? 0 : per / price, quote: 0 };
  });
  return { levels, price, fees: 0, fills: 0, feeBps };
}

/** The price moves from where the grid stands to `to`: each level it crosses converts at its own price. */
export function gridMove(state: GridState, to: number): GridState {
  const from = state.price;
  if (!(to > 0) || to === from) return state;
  let fees = state.fees;
  let fills = state.fills;
  const fee = state.feeBps / 10_000;
  const levels = state.levels.map((level) => {
    if (to > from && level.price > from && level.price <= to && level.base > 0) {
      const got = level.base * level.price;
      fees += got * fee;
      fills += 1;
      return { price: level.price, base: 0, quote: level.quote + got };
    }
    if (to < from && level.price <= from && level.price > to && level.quote > 0) {
      fees += level.quote * fee;
      fills += 1;
      return { price: level.price, base: level.base + level.quote / level.price, quote: 0 };
    }
    return level;
  });
  return { levels, price: to, fees, fills, feeBps: state.feeBps };
}

export function gridHoldings(state: GridState): Readonly<{ base: number; quote: number }> {
  let base = 0;
  let quote = 0;
  for (const level of state.levels) {
    base += level.base;
    quote += level.quote;
  }
  return { base, quote };
}

/** The grid's value at its own price, fees in, in the quote. */
export function gridValue(state: GridState, price: number = state.price): number {
  const { base, quote } = gridHoldings(state);
  return quote + base * price + state.fees;
}

export function runGrid(state: GridState, candles: readonly Candle[], each?: (state: GridState, bar: Candle) => void): GridState {
  let current = state;
  for (const bar of candles) {
    for (const price of candlePath(bar)) current = gridMove(current, price);
    each?.(current, bar);
  }
  return current;
}

/** The costs of a grid's life: the placement (wallet and the position's new account sign), its closing, the base it buys to start. */
export function gridCosts(setting: GridSetting, price: number, costs: ExecutionCosts, nonRefundableRentLamports = 0): CostBreakdown {
  const place = txUsd(costs, 2);
  const close = txUsd(costs, 1);
  const prices = gridLevels(setting);
  const baseShare = setting.side === "buy" ? 0 : setting.side === "sell" ? 1 : prices.filter((p) => p > price).length / Math.max(1, prices.length);
  const bought = setting.amountQuote * baseShare * costs.quoteUsd;
  return {
    networkUsd: place.network + close.network + (nonRefundableRentLamports / 1e9) * costs.solUsd,
    priorityUsd: place.priority + close.priority,
    slippageUsd: (bought * costs.slippageBps) / 10_000,
    protocolUsd: (bought * costs.poolFeeBps) / 10_000,
  };
}

const total = (costs: CostBreakdown) => costs.networkUsd + costs.priorityUsd + costs.slippageUsd + costs.protocolUsd;

export function simulateGrid(candles: readonly Candle[], setting: GridSetting, costs: ExecutionCosts = DEFAULT_COSTS, nonRefundableRentLamports = 0): SimResult | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last || gridLevels(setting).length === 0 || !(setting.amountQuote > 0)) return null;
  const start = gridStart(setting, first.o, costs.poolFeeBps);
  const spent = gridCosts(setting, first.o, costs, nonRefundableRentLamports);
  const spentUsd = total(spent);
  const startHeld = gridHoldings(start);
  const drawdown = new Drawdown();
  drawdown.see(gridValue(start, first.o) * costs.quoteUsd - spentUsd);
  const end = runGrid(start, candles, (state, bar) => drawdown.see(gridValue(state, bar.c) * costs.quoteUsd - spentUsd));
  const held = gridHoldings(end);
  const endUsd = gridValue(end, last.c) * costs.quoteUsd - spentUsd;
  const holdUsd = (startHeld.quote + startHeld.base * last.c) * costs.quoteUsd;
  const startUsd = setting.amountQuote * costs.quoteUsd;
  return {
    bot: "grid",
    approximate: true,
    startUsd,
    endUsd,
    holdUsd,
    pnlUsd: endUsd - startUsd,
    vsHoldUsd: endUsd - holdUsd,
    feesEarnedUsd: end.fees * costs.quoteUsd,
    costs: spent,
    maxDrawdownPct: drawdown.pct,
    maxDrawdownUsd: drawdown.usd,
    fills: end.fills,
    end: { base: held.base, quote: held.quote, price: last.c },
    from: first.t,
    to: last.t,
  };
}

/* ------------------------------------------------------------------ ladder */

export type LadderLeg = Readonly<{
  side: "buy" | "sell";
  /** Quote per base the leg is placed at. */
  price: number;
  /** What leaves the wallet into the leg: the quote for a buy, the base for a sell. */
  amount: number;
}>;

export type LadderSetting = Readonly<{ venue: "trigger" | "dlmm"; legs: readonly LadderLeg[] }>;

/**
 * A ladder of limit orders. A Trigger V1 leg delivers exactly what it asks and Jupiter's own fee rides on top, so the
 * market must reach the price past that fee (`effectiveTriggerPrice`); a DLMM leg converts at its bin's price and
 * earns half the bin's swap fee. A leg fills when a candle trades through its price; each leg is one placement and,
 * on DLMM, one claim.
 */
export function simulateLadder(candles: readonly Candle[], setting: LadderSetting, costs: ExecutionCosts = DEFAULT_COSTS): SimResult | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const legs = setting.legs.filter((leg) => leg.price > 0 && leg.amount > 0);
  if (!first || !last || legs.length === 0) return null;
  const jupiter = TRIGGER_V1_JUPITER_FEE_BPS.normal / 10_000;
  const maker = ((costs.poolFeeBps / 10_000) * DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT) / 100;
  let base = legs.filter((leg) => leg.side === "sell").reduce((sum, leg) => sum + leg.amount, 0);
  let quote = legs.filter((leg) => leg.side === "buy").reduce((sum, leg) => sum + leg.amount, 0);
  const startBase = base;
  const startQuote = quote;
  const open = legs.map(() => true);
  let fills = 0;
  let fees = 0;
  const drawdown = new Drawdown();
  const place = txUsd(costs, setting.venue === "dlmm" ? 2 : 1);
  const claim = setting.venue === "dlmm" ? txUsd(costs, 1) : { network: 0, priority: 0 };
  const spent: CostBreakdown = {
    networkUsd: legs.length * (place.network + claim.network),
    priorityUsd: legs.length * (place.priority + claim.priority),
    slippageUsd: 0,
    protocolUsd: 0,
  };
  const spentUsd = total(spent);
  drawdown.see((quote + base * first.o) * costs.quoteUsd - spentUsd);
  for (const bar of candles) {
    legs.forEach((leg, index) => {
      if (!open[index]) return;
      const trigger = setting.venue === "trigger" ? (leg.side === "buy" ? leg.price / (1 + jupiter) : leg.price * (1 + jupiter)) : leg.price;
      const touched = leg.side === "buy" ? bar.l <= trigger : bar.h >= trigger;
      if (!touched) return;
      open[index] = false;
      fills += 1;
      if (leg.side === "buy") {
        quote -= leg.amount;
        base += leg.amount / leg.price;
        if (setting.venue === "dlmm") fees += leg.amount * maker;
      } else {
        base -= leg.amount;
        quote += leg.amount * leg.price;
        if (setting.venue === "dlmm") fees += leg.amount * leg.price * maker;
      }
    });
    drawdown.see((quote + fees + base * bar.c) * costs.quoteUsd - spentUsd);
  }
  const endUsd = (quote + fees + base * last.c) * costs.quoteUsd - spentUsd;
  const holdUsd = (startQuote + startBase * last.c) * costs.quoteUsd;
  const startUsd = (startQuote + startBase * first.o) * costs.quoteUsd;
  return {
    bot: "ladder",
    approximate: false,
    startUsd,
    endUsd,
    holdUsd,
    pnlUsd: endUsd - startUsd,
    vsHoldUsd: endUsd - holdUsd,
    feesEarnedUsd: fees * costs.quoteUsd,
    costs: spent,
    maxDrawdownPct: drawdown.pct,
    maxDrawdownUsd: drawdown.usd,
    fills,
    end: { base, quote: quote + fees, price: last.c },
    from: first.t,
    to: last.t,
  };
}

/* ------------------------------------------------------------------ DCA and hold */

export type DcaSetting = Readonly<{ everyBars: number; amountQuote: number }>;

/** A reminder DCA: a purchase at the open of every `everyBars`-th bar, each a taker swap the person signs. */
export function simulateDca(candles: readonly Candle[], setting: DcaSetting, costs: ExecutionCosts = DEFAULT_COSTS): SimResult | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last || !Number.isInteger(setting.everyBars) || setting.everyBars < 1 || !(setting.amountQuote > 0)) return null;
  const buys = Math.ceil(candles.length / setting.everyBars);
  let quote = buys * setting.amountQuote;
  const startQuote = quote;
  let base = 0;
  const one = txUsd(costs, 1);
  const spent = { networkUsd: 0, priorityUsd: 0, slippageUsd: 0, protocolUsd: 0 };
  const drawdown = new Drawdown();
  drawdown.see(quote * costs.quoteUsd);
  candles.forEach((bar, index) => {
    if (index % setting.everyBars === 0) {
      const slip = (setting.amountQuote * costs.slippageBps) / 10_000;
      const fee = (setting.amountQuote * costs.poolFeeBps) / 10_000;
      base += (setting.amountQuote - slip - fee) / bar.o;
      quote -= setting.amountQuote;
      spent.networkUsd += one.network;
      spent.priorityUsd += one.priority;
      spent.slippageUsd += slip * costs.quoteUsd;
      spent.protocolUsd += fee * costs.quoteUsd;
    }
    drawdown.see((quote + base * bar.c) * costs.quoteUsd - spent.networkUsd - spent.priorityUsd);
  });
  const endUsd = (quote + base * last.c) * costs.quoteUsd - spent.networkUsd - spent.priorityUsd;
  const startUsd = startQuote * costs.quoteUsd;
  return {
    bot: "dca",
    approximate: false,
    startUsd,
    endUsd,
    holdUsd: startUsd,
    pnlUsd: endUsd - startUsd,
    vsHoldUsd: endUsd - startUsd,
    feesEarnedUsd: 0,
    costs: spent,
    maxDrawdownPct: drawdown.pct,
    maxDrawdownUsd: drawdown.usd,
    fills: buys,
    end: { base, quote, price: last.c },
    from: first.t,
    to: last.t,
  };
}

/** Holding the base bought at the first open: the line every bot is read against. */
export function simulateHold(candles: readonly Candle[], amountQuote: number, costs: ExecutionCosts = DEFAULT_COSTS): SimResult | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last || !(amountQuote > 0)) return null;
  const base = amountQuote / first.o;
  const drawdown = new Drawdown();
  for (const bar of candles) drawdown.see(base * bar.c * costs.quoteUsd);
  const endUsd = base * last.c * costs.quoteUsd;
  const startUsd = amountQuote * costs.quoteUsd;
  return {
    bot: "hold",
    approximate: false,
    startUsd,
    endUsd,
    holdUsd: endUsd,
    pnlUsd: endUsd - startUsd,
    vsHoldUsd: 0,
    feesEarnedUsd: 0,
    costs: { networkUsd: 0, priorityUsd: 0, slippageUsd: 0, protocolUsd: 0 },
    maxDrawdownPct: drawdown.pct,
    maxDrawdownUsd: drawdown.usd,
    fills: 0,
    end: { base, quote: 0, price: last.c },
    from: first.t,
    to: last.t,
  };
}
