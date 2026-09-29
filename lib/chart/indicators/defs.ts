/* Indicator registry: static defs + instance factory. Pure TS, no chart deps. */

export type IndicatorType =
  | "sma"
  | "ema"
  | "wma"
  | "bb"
  | "vwap"
  | "rsi"
  | "macd"
  | "atr"
  | "volume";

export type ParamDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type IndicatorDef = {
  type: IndicatorType;
  label: string;
  /** "overlay" renders on the price pane; "pane" gets its own pane.
      volume is special-cased as a bottom-anchored overlay histogram. */
  placement: "overlay" | "pane";
  params: ParamDef[];
  requiresVolume?: boolean;
  defaultColor: string;
};

const period = (def: number, max = 500): ParamDef => ({
  key: "period",
  label: "Period",
  min: 2,
  max,
  step: 1,
  default: def,
});

export const INDICATOR_DEFS: Record<IndicatorType, IndicatorDef> = {
  sma: {
    type: "sma",
    label: "SMA",
    placement: "overlay",
    params: [period(20)],
    defaultColor: "#ff5a1f",
  },
  ema: {
    type: "ema",
    label: "EMA",
    placement: "overlay",
    params: [period(20)],
    defaultColor: "#a78bfa",
  },
  wma: {
    type: "wma",
    label: "WMA",
    placement: "overlay",
    params: [period(20)],
    defaultColor: "#60a5fa",
  },
  bb: {
    type: "bb",
    label: "Bollinger Bands",
    placement: "overlay",
    params: [
      period(20),
      { key: "mult", label: "StdDev", min: 1, max: 4, step: 0.5, default: 2 },
    ],
    defaultColor: "#f472b6",
  },
  vwap: {
    type: "vwap",
    label: "VWAP",
    placement: "overlay",
    params: [],
    requiresVolume: true,
    defaultColor: "#e879f9",
  },
  rsi: {
    type: "rsi",
    label: "RSI",
    placement: "pane",
    params: [period(14, 100)],
    defaultColor: "#a78bfa",
  },
  macd: {
    type: "macd",
    label: "MACD",
    placement: "pane",
    params: [
      { key: "fast", label: "Fast", min: 2, max: 100, step: 1, default: 12 },
      { key: "slow", label: "Slow", min: 2, max: 200, step: 1, default: 26 },
      { key: "signal", label: "Signal", min: 2, max: 100, step: 1, default: 9 },
    ],
    defaultColor: "#ff5a1f",
  },
  atr: {
    type: "atr",
    label: "ATR",
    placement: "pane",
    params: [period(14, 100)],
    defaultColor: "#fb923c",
  },
  volume: {
    type: "volume",
    label: "Volume",
    placement: "overlay",
    params: [],
    requiresVolume: true,
    defaultColor: "#94a3b8",
  },
};

/** Curated line colors; deliberately excludes the locked success/danger/warning hues. */
export const INDICATOR_COLORS = [
  "#ff5a1f",
  "#8fa6c8",
  "#c9b08f",
  "#b33a0a",
  "#6e8ca0",
  "#d98f6b",
  "#ff8552",
  "#64748b",
];

export type IndicatorInstance = {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
  color: string;
  lineWidth: 1 | 2 | 3;
  visible: boolean;
};

export function defaultParams(type: IndicatorType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of INDICATOR_DEFS[type].params) out[p.key] = p.default;
  return out;
}

export function makeInstance(type: IndicatorType, existing: IndicatorInstance[]): IndicatorInstance {
  const used = new Set(existing.map((i) => i.color));
  const color =
    INDICATOR_COLORS.find((c) => !used.has(c)) ??
    INDICATOR_COLORS[existing.length % INDICATOR_COLORS.length];
  return {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    params: defaultParams(type),
    color,
    lineWidth: 2,
    visible: true,
  };
}

/** "EMA 20", "MACD 12 26 9", "VWAP" — params in def order. */
export function instanceLabel(i: IndicatorInstance): string {
  const def = INDICATOR_DEFS[i.type];
  const parts = def.params.map((p) => String(i.params[p.key] ?? p.default));
  return parts.length > 0 ? `${def.label} ${parts.join(" ")}` : def.label;
}
