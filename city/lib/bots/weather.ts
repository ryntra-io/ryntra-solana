import { marketWeather, type Fit, type WeatherBot } from '../../../lib/bots/weather/weather.ts';
import type { BotKind } from './kinds.ts';
import { HOUR_MS, type Bar } from './path.ts';

/**
 * The week's weather for a tower, in one line, and how each bot suits it: the engine's reading (CITY-132,
 * `lib/bots/weather/weather.ts` — trend, range or chop from ADX, ATR against its norm and the time inside a band), on the
 * same hourly bars a draft is tried on. A reading of the past, never a forecast. Beside it, the week's own size — a
 * typical day's move and the week's low and high — which sizes a draft's range and steps.
 */

export type { Fit };

/** The engine's three weathers, a trend said with its way. */
export const SKIES = ['trendUp', 'trendDown', 'range', 'chop'] as const;
export type Sky = (typeof SKIES)[number];

export type Weather = Readonly<{
  sky: Sky;
  /** How each kind of bot the engine reads fits this weather. */
  fit: Readonly<Record<WeatherBot, Fit>>;
  /** A typical day's move, percent (hourly swings scaled to a day). */
  dayMovePct: number;
  /** The window's lowest and highest price, and its last. */
  low: number;
  high: number;
  price: number;
  /** Hours the reading covers. */
  hours: number;
}>;

/** The week's size from its bars: a typical day's move, its low, high and last price. */
export function weekSize(bars: readonly Bar[]): Pick<Weather, 'dayMovePct' | 'low' | 'high' | 'price' | 'hours'> | null {
  if (bars.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i += 1) returns.push(Math.log(bars[i]!.c / bars[i - 1]!.c));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const span = (bars[bars.length - 1]!.t - bars[0]!.t) / HOUR_MS;
  const stepHours = Math.max(1, span / (bars.length - 1));
  let low = Infinity;
  let high = -Infinity;
  for (const b of bars) {
    low = Math.min(low, b.l);
    high = Math.max(high, b.h);
  }
  return { dayMovePct: Math.sqrt(variance) * Math.sqrt(24 / stepHours) * 100, low, high, price: bars[bars.length - 1]!.c, hours: Math.round(span) };
}

/** The weather over the bars; null when the engine has too few of them to read it. */
export function weatherOf(bars: readonly Bar[]): Weather | null {
  const read = marketWeather(bars);
  const size = weekSize(bars);
  if (!read || !size) return null;
  const sky: Sky = read.kind === 'trend' ? (read.direction === 'down' ? 'trendDown' : 'trendUp') : read.kind;
  const fit = Object.fromEntries(Object.entries(read.fit).map(([bot, f]) => [bot, f.fit])) as Record<WeatherBot, Fit>;
  return { sky, fit, ...size };
}

/** Each bot of the hub as the engine names it; the ones it does not read have no fit to say. */
const ENGINE_BOT: Readonly<Partial<Record<BotKind, WeatherBot>>> = {
  grid: 'grid',
  lpRange: 'range_lp',
  buyLadder: 'ladder_buy',
  exitLadder: 'ladder_sell',
  recurring: 'dca',
  smartDca: 'dca',
};

/** How a bot suits the weather: the engine's fit, or `fair` — nothing said — for a bot it does not read. */
export function fitOf(kind: BotKind, weather: Weather | null): Fit {
  const bot = ENGINE_BOT[kind];
  return weather && bot ? weather.fit[bot] : 'fair';
}
