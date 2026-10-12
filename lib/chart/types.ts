/* Shared chart types + candle normalization. Pure TS — no React, no DOM. */

import type { UTCTimestamp } from "lightweight-charts";

/** Canonical candle used by ProChart, indicators and drawings. Time is UNIX seconds. */
export type NormalizedCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-token volume. undefined when the upstream feed omits it. */
  volume?: number;
  isFinal?: boolean;
};

export type LinePoint = { time: UTCTimestamp; value: number };

export type HistogramPoint = { time: UTCTimestamp; value: number; color?: string };

/** Declarative price line (entry/SL/TP overlays) applied by ProChart. */
/**
 * A mark on the main series at a moment (unix seconds): the chart puts it on
 * the bar the moment falls in, and marks that land on one bar are one mark —
 * the first one's face, the texts joined. `color` accepts the palette's
 * semantic "up"/"down" and "ink" (the theme's text colour) besides a hex.
 */
export type ChartMarkerSpec = {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text: string;
};

export type PriceLineSpec = {
  id: string;
  price: number;
  color: string;
  title: string;
  style?: "solid" | "dashed";
  width?: 1 | 2;
};

/* ---- feed normalization ---- */

/** Perp candles (Arcus /v1/candles + WS): openTime in MICROSECONDS, OHLCV as strings. */
export function fromArcusCandle(c: {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
  isFinal?: boolean;
}): NormalizedCandle {
  return {
    time: Math.floor(c.openTime / 1e6) as UTCTimestamp,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : undefined,
    isFinal: c.isFinal,
  };
}

/** Spot candles (router.spot.arcus.xyz): openTime already in SECONDS. */
export function fromSpotCandle(c: {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
  isFinal?: boolean;
}): NormalizedCandle {
  return {
    time: c.openTime as UTCTimestamp,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : undefined,
    isFinal: c.isFinal,
  };
}

/* ---- timeframes ---- */

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1d": 86_400,
  "1w": 604_800,
};

/** Seconds per bar for a timeframe token ("1m".."1w"). Falls back to 60. */
export function tfToSeconds(tf: string): number {
  return TF_SECONDS[tf] ?? 60;
}

/** Resolved UI theme (matches app/app/theme.ts resolveTheme output). */
export type ChartTheme = "dark" | "light";
