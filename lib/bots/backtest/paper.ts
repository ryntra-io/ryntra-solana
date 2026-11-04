/**
 * The paper twin: a grid that runs on paper beside the person's real one,
 * from the same moment, on the same candles, with another setting — wider,
 * narrower, more levels — so the Hangar can say what that setting would have
 * done instead. Nothing is placed: the twin is numbers kept beside the bot.
 *
 * The twin's state is plain JSON, so it is kept between reads and moved on
 * with each new page of candles; a candle it has already seen is never
 * counted twice. Its figures are as approximate as any grid's (`sim.ts`).
 *
 * Pure.
 */

import type { Candle } from "./candles.ts";
import { DEFAULT_COSTS, gridCosts, gridHoldings, gridStart, gridValue, runGrid, type ExecutionCosts, type GridSetting, type GridState } from "./sim.ts";

export type PaperTwin = Readonly<{
  setting: GridSetting;
  state: GridState;
  /** ms: the open of the candle it started on, and of the newest it has run. */
  startedAt: number;
  lastT: number;
  startPrice: number;
  /** What its placement would have cost, USD, already out of its value. */
  costsUsd: number;
  quoteUsd: number;
}>;

/** A twin started at a candle's open, as the real grid was placed. */
export function startPaperTwin(setting: GridSetting, at: Candle, costs: ExecutionCosts = DEFAULT_COSTS): PaperTwin {
  const spent = gridCosts(setting, at.o, costs);
  return {
    setting,
    state: gridStart(setting, at.o, costs.poolFeeBps),
    startedAt: at.t,
    lastT: at.t - 1,
    startPrice: at.o,
    costsUsd: spent.networkUsd + spent.priorityUsd + spent.slippageUsd + spent.protocolUsd,
    quoteUsd: costs.quoteUsd,
  };
}

/** Moved on with the candles newer than it has seen. */
export function stepPaperTwin(twin: PaperTwin, candles: readonly Candle[]): PaperTwin {
  const fresh = candles.filter((bar) => bar.t > twin.lastT && bar.t >= twin.startedAt).sort((a, b) => a.t - b.t);
  if (fresh.length === 0) return twin;
  return { ...twin, state: runGrid(twin.state, fresh), lastT: fresh[fresh.length - 1]!.t };
}

export type TwinReading = Readonly<{
  valueUsd: number;
  vsHoldUsd: number;
  feesUsd: number;
  fills: number;
}>;

export function readPaperTwin(twin: PaperTwin): TwinReading {
  const start = gridHoldings(gridStart(twin.setting, twin.startPrice, twin.state.feeBps));
  const valueUsd = gridValue(twin.state) * twin.quoteUsd - twin.costsUsd;
  const holdUsd = (start.quote + start.base * twin.state.price) * twin.quoteUsd;
  return { valueUsd, vsHoldUsd: valueUsd - holdUsd, feesUsd: twin.state.fees * twin.quoteUsd, fills: twin.state.fills };
}

/** The twin against the real bot's value now, USD: what the other setting would have made more (or less). */
export function twinDifference(twin: PaperTwin, liveValueUsd: number): number {
  return readPaperTwin(twin).valueUsd - liveValueUsd;
}
