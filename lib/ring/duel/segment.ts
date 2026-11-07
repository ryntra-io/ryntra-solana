/**
 * The hidden stretch of a Market Replay (CITY-51): a window of real candles from Ryntra's market-data gateway (the same
 * read the bots' backtests use, `lib/bots/backtest/candles.server.ts`), picked at random, rebased so it opens at 100
 * and without its times. The agents get only the bars; where and when the stretch was stays with the match and is shown
 * after it — never before, so no model looks it up in what it remembers.
 *
 * Bars are never made up here: no gateway, too few bars — no stretch, and no match.
 *
 * Pure: the candles and the randomness come in.
 */

import type { Candle } from "../../bots/backtest/candles.ts";
import type { Bar } from "./market.ts";

export type Segment = {
  bars: Bar[];
  /** Kept with the match, shown after it: what the stretch was. */
  source: { instrument: string; from: number; to: number; base: number };
};

/** Four decimals on a stretch rebased to 100: finer than any tick the agents could act on. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * A stretch of `length` bars from `candles` (oldest first), starting at `randomInt(n)` among the possible starts,
 * rebased so the first bar opens at 100. `null` when there are not enough bars, or a gap breaks the stretch.
 */
export function pickSegment(candles: readonly Candle[], length: number, instrument: string, randomInt: (n: number) => number): Segment | null {
  if (!Number.isSafeInteger(length) || length < 2 || candles.length < length) return null;
  const starts = candles.length - length + 1;
  const first = randomInt(starts);
  if (!Number.isSafeInteger(first) || first < 0 || first >= starts) throw new RangeError("randomInt went out of range");
  const window = candles.slice(first, first + length);
  const step = window[1]!.t - window[0]!.t;
  if (step <= 0 || window.some((bar, i) => i > 0 && bar.t - window[i - 1]!.t !== step)) return null;
  const base = window[0]!.o;
  if (!(base > 0)) return null;
  const bars = window.map((bar): Bar => {
    const o = round4((bar.o / base) * 100);
    const c = round4((bar.c / base) * 100);
    const h = Math.max(round4((bar.h / base) * 100), o, c);
    const l = Math.min(round4((bar.l / base) * 100), o, c);
    return [o, h, l, c];
  });
  if (bars.some((bar) => bar.some((v) => !(v > 0)))) return null;
  return { bars, source: { instrument, from: window[0]!.t, to: window[length - 1]!.t, base } };
}
