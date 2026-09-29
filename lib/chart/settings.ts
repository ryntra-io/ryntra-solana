/* Chart display settings — one global localStorage key shared by both terminals
   (visual preference, not per-market state). Versioned envelope. */

import { CANDLE_PALETTES } from "./theme";
import type { CandlePaletteId } from "./theme";

export type ChartType = "candles" | "bars" | "hollow" | "line" | "area";

export type ChartSettings = {
  v: 1;
  chartType: ChartType;
  grid: boolean;
  crosshair: "normal" | "magnet";
  scale: { log: boolean; autoScale: boolean };
  /** Time-axis LABELS only (formatter-level). Data stays UTC epoch — never shift epochs. */
  timezone: "utc" | "local";
  watermark: boolean;
  palette: CandlePaletteId;
};

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  v: 1,
  chartType: "candles",
  grid: true,
  crosshair: "normal",
  scale: { log: false, autoScale: true },
  timezone: "utc",
  watermark: false,
  palette: "default",
};

const KEY = "ryntra-chart-settings";

const CHART_TYPES: readonly ChartType[] = ["candles", "bars", "hollow", "line", "area"];
const CROSSHAIRS: readonly ChartSettings["crosshair"][] = ["normal", "magnet"];
const TIMEZONES: readonly ChartSettings["timezone"][] = ["utc", "local"];
const PALETTES = Object.keys(CANDLE_PALETTES) as readonly CandlePaletteId[];

/** Persisted value if it's one of the allowed literals, else the default. */
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return v === undefined ? fallback : Boolean(v);
}

export function loadChartSettings(): ChartSettings {
  if (typeof window === "undefined") return DEFAULT_CHART_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CHART_SETTINGS;
    const j = JSON.parse(raw) as Partial<ChartSettings> | null;
    if (!j || j.v !== 1) return DEFAULT_CHART_SETTINGS;
    // Validate field-by-field: stale/corrupt persisted values (e.g. a palette id
    // that no longer exists) must degrade to the default, not crash the chart.
    const d = DEFAULT_CHART_SETTINGS;
    const scale = (j.scale ?? {}) as Partial<ChartSettings["scale"]>;
    return {
      v: 1,
      chartType: pick(j.chartType, CHART_TYPES, d.chartType),
      grid: bool(j.grid, d.grid),
      crosshair: pick(j.crosshair, CROSSHAIRS, d.crosshair),
      scale: {
        log: bool(scale.log, d.scale.log),
        autoScale: bool(scale.autoScale, d.scale.autoScale),
      },
      timezone: pick(j.timezone, TIMEZONES, d.timezone),
      watermark: bool(j.watermark, d.watermark),
      palette: pick(j.palette, PALETTES, d.palette),
    };
  } catch {
    return DEFAULT_CHART_SETTINGS;
  }
}

export function saveChartSettings(s: ChartSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode — settings simply don't persist */
  }
}
