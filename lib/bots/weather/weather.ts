/**
 * The market's weather for bots: trend, range or chop, read from three
 * numbers — ADX (does the price go one way), ATR against its norm (does it
 * swing harder than usual) and the share of time inside a band (does it stay
 * in a channel) — with one plain line and, for every kind of bot, how well it
 * fits now.
 *
 * | Weather | When                                              | Grid / range LP | Limit ladder | DCA  |
 * |---------|---------------------------------------------------|-----------------|--------------|------|
 * | trend   | ADX ≥ 25                                          | poor            | by direction | good / fair |
 * | range   | ADX < 20, ATR ≤ 1.25 × norm, ≥ 80 % inside band   | good            | good         | fair |
 * | chop    | anything else                                     | fair            | fair         | good |
 *
 * A reading of the past bars, never a forecast: the line says what the market
 * has been doing, and a bot's fit is what that weather does to its kind.
 *
 * Pure and client-safe.
 */

import type { Candle } from "../backtest/candles.ts";
import { ADX_PERIOD, adx, atrRatio, bandShare } from "./indicators.ts";

export const WEATHER_KINDS = ["trend", "range", "chop"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const WEATHER_BOTS = ["grid", "range_lp", "ladder_buy", "ladder_sell", "dca"] as const;
export type WeatherBot = (typeof WEATHER_BOTS)[number];
export type Fit = "good" | "fair" | "poor";

export const TREND_ADX = 25;
export const RANGE_ADX = 20;
export const RANGE_ATR_RATIO = 1.25;
export const RANGE_BAND_SHARE = 0.8;
/** Bars the ATR norm and the band share look back over. */
export const WEATHER_LOOKBACK = 100;
/** The fewest bars a reading stands on: ADX needs two periods, the norm a lookback of its own. */
export const WEATHER_MIN_BARS = 2 * ADX_PERIOD + 30;

type Line = Readonly<{ uk: string; en: string }>;

export type Weather = Readonly<{
  kind: WeatherKind;
  /** Trend only: which way. */
  direction: "up" | "down" | null;
  adx: number;
  atrRatio: number;
  bandShare: number;
  line: Line;
  fit: Readonly<Record<WeatherBot, Readonly<{ fit: Fit; line: Line }>>>;
  bars: number;
  /** The newest bar's open, ms. */
  at: number;
}>;

const LINES: Readonly<Record<WeatherKind | "trend_up" | "trend_down", Line>> = {
  trend: { uk: "Тренд", en: "Trending" },
  trend_up: { uk: "Тренд угору", en: "Trending up" },
  trend_down: { uk: "Тренд униз", en: "Trending down" },
  range: { uk: "Боковик — ціна ходить у каналі", en: "Ranging — the price keeps to a channel" },
  chop: { uk: "Пила — різкі гойдання без напрямку", en: "Choppy — sharp swings, no direction" },
};

const BOT_NAMES: Readonly<Record<WeatherBot, Line>> = {
  grid: { uk: "сітка", en: "a grid" },
  range_lp: { uk: "діапазон", en: "a range" },
  ladder_buy: { uk: "драбина купівлі", en: "a buy ladder" },
  ladder_sell: { uk: "драбина продажу", en: "a sell ladder" },
  dca: { uk: "DCA", en: "DCA" },
};

const FIT_WORDS: Readonly<Record<Fit, Line>> = {
  good: { uk: "зараз добре підходить", en: "fits well now" },
  fair: { uk: "підходить частково", en: "fits in part" },
  poor: { uk: "зараз погано підходить", en: "fits poorly now" },
};

function fitTable(kind: WeatherKind, direction: "up" | "down" | null): Readonly<Record<WeatherBot, Fit>> {
  if (kind === "range") return { grid: "good", range_lp: "good", ladder_buy: "good", ladder_sell: "good", dca: "fair" };
  if (kind === "chop") return { grid: "fair", range_lp: "fair", ladder_buy: "fair", ladder_sell: "fair", dca: "good" };
  /* A trend walks out of any fixed range: the grid ends all in one token, the range earns nothing past its edge. */
  return direction === "up"
    ? { grid: "poor", range_lp: "poor", ladder_buy: "fair", ladder_sell: "good", dca: "good" }
    : { grid: "poor", range_lp: "poor", ladder_buy: "fair", ladder_sell: "poor", dca: "fair" };
}

export function weatherLine(kind: WeatherKind, direction: "up" | "down" | null): Line {
  return kind === "trend" && direction ? LINES[direction === "up" ? "trend_up" : "trend_down"] : LINES[kind];
}

/** «тренд — сітка зараз погано підходить». */
function botLine(kind: WeatherKind, direction: "up" | "down" | null, bot: WeatherBot, fit: Fit): Line {
  const weather = weatherLine(kind, direction);
  return { uk: `${weather.uk.split(" — ")[0]!.toLowerCase()} — ${BOT_NAMES[bot].uk} ${FIT_WORDS[fit].uk}`, en: `${weather.en.split(" — ")[0]!.toLowerCase()} — ${BOT_NAMES[bot].en} ${FIT_WORDS[fit].en}` };
}

/** The weather over the candles; null when there are too few to read it. */
export function marketWeather(candles: readonly Candle[]): Weather | null {
  if (candles.length < WEATHER_MIN_BARS) return null;
  const last = adx(candles)[candles.length - 1];
  const ratio = atrRatio(candles, WEATHER_LOOKBACK);
  const share = bandShare(candles, WEATHER_LOOKBACK);
  if (!last || !Number.isFinite(last.adx) || !Number.isFinite(ratio) || !Number.isFinite(share)) return null;
  let kind: WeatherKind;
  if (last.adx >= TREND_ADX) kind = "trend";
  else if (last.adx < RANGE_ADX && ratio <= RANGE_ATR_RATIO && share >= RANGE_BAND_SHARE) kind = "range";
  else kind = "chop";
  const direction = kind === "trend" ? (last.plusDi >= last.minusDi ? "up" : "down") : null;
  const table = fitTable(kind, direction);
  const fit = Object.fromEntries(WEATHER_BOTS.map((bot) => [bot, { fit: table[bot], line: botLine(kind, direction, bot, table[bot]) }])) as Weather["fit"];
  return { kind, direction, adx: last.adx, atrRatio: ratio, bandShare: share, line: weatherLine(kind, direction), fit, bars: candles.length, at: candles[candles.length - 1]!.t };
}
