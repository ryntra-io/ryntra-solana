/**
 * What a person set on the older spot chart (ProChart on Lightweight Charts), brought to the core chart once (CH-17):
 * the drawings — by the keys the core's `importLegacy` reads, the price's and the market cap's apart — the indicators,
 * and the look: the candles' type and palette, the scale and the clock of the time labels. The older keys are only read,
 * never removed: CH-17a takes the older chart away, and with it whatever is still left of its keys.
 */
import type { PriceBasis } from "@ryntra/core/adapters";

import { CANDLE_PALETTES } from "@/lib/chart/theme";

/** The older chart's drawings of a market: `spot:<symbol>` for the price, `spot:<symbol>:cap` for the market cap. */
export function legacyDrawingKeys(symbol: string, basis: PriceBasis): string[] {
  return [`ryntra-drawings:spot:${symbol}${basis.measure === "market_cap" ? ":cap" : ""}`];
}

type Store = Readonly<{ getItem(key: string): string | null }>;

const browserStore = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** An indicator as the core's templates keep it (`TemplateIndicator`). */
export type LegacyIndicator = Readonly<{ name: string; params: readonly number[]; pane: "candles" | "own" }>;

/* The older chart's indicators → the core's names, their numbers in the core's order. Volume is the core's own pane, on by default. */
const INDICATORS: Readonly<Record<string, (params: Record<string, number>) => LegacyIndicator | null>> = {
  sma: (p) => ({ name: "SMA", params: [p.period ?? 20], pane: "candles" }),
  ema: (p) => ({ name: "EMA", params: [p.period ?? 20], pane: "candles" }),
  wma: (p) => ({ name: "WMA", params: [p.period ?? 20], pane: "candles" }),
  bb: (p) => ({ name: "BOLL", params: [p.period ?? 20, p.mult ?? 2], pane: "candles" }),
  vwap: () => ({ name: "VWAP", params: [], pane: "candles" }),
  rsi: (p) => ({ name: "RSI", params: [p.period ?? 14], pane: "own" }),
  macd: (p) => ({ name: "MACD", params: [p.fast ?? 12, p.slow ?? 26, p.signal ?? 9], pane: "own" }),
  atr: (p) => ({ name: "ATR", params: [p.period ?? 14], pane: "own" }),
  volume: () => null,
};

/**
 * The indicators the person kept on the older spot chart (`ryntra-chart-indicators:spot`), the visible ones, as the
 * core's templates name them; null when there is nothing to bring — the core then opens with what it kept itself.
 */
export function legacyIndicators(store: Store | null = browserStore()): LegacyIndicator[] | null {
  if (!store) return null;
  try {
    const raw = store.getItem("ryntra-chart-indicators:spot");
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { v?: unknown; instances?: unknown };
    if (envelope?.v !== 1 || !Array.isArray(envelope.instances)) return null;
    const out: LegacyIndicator[] = [];
    for (const item of envelope.instances as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const entry = item as { type?: unknown; params?: unknown; visible?: unknown };
      if (entry.visible === false || typeof entry.type !== "string") continue;
      const map = INDICATORS[entry.type];
      if (!map) continue;
      const params: Record<string, number> = {};
      if (entry.params && typeof entry.params === "object") {
        for (const [key, value] of Object.entries(entry.params as Record<string, unknown>)) if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
      }
      const indicator = map(params);
      if (indicator) out.push(indicator);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export type CandlePalette = "default" | "contrast" | "colorblind";
export type ChartLook = Readonly<{
  candle: "candles" | "hollow" | "bars" | "line";
  scale: "linear" | "log" | "percent";
  palette: CandlePalette;
  /** "UTC" when the person chose UTC time labels; null — the browser's own zone. */
  timezone: "UTC" | null;
}>;

export const DEFAULT_LOOK: ChartLook = { candle: "candles", scale: "linear", palette: "default", timezone: null };

/** The older chart's display settings (`ryntra-chart-settings`, shared by every older chart): an area chart is a line here. */
export function legacyLook(store: Store | null = browserStore()): ChartLook {
  if (!store) return DEFAULT_LOOK;
  try {
    const raw = store.getItem("ryntra-chart-settings");
    if (!raw) return DEFAULT_LOOK;
    const saved = JSON.parse(raw) as { chartType?: unknown; scale?: { log?: unknown }; palette?: unknown; timezone?: unknown };
    const type = saved.chartType;
    return {
      candle: type === "hollow" || type === "bars" ? type : type === "line" || type === "area" ? "line" : "candles",
      scale: saved.scale?.log === true ? "log" : "linear",
      palette: saved.palette === "contrast" || saved.palette === "colorblind" ? saved.palette : "default",
      /* The older chart printed UTC unless the person chose their own clock; a saved «utc» was their choice or the default — kept. */
      timezone: saved.timezone === "local" ? null : "UTC",
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

/**
 * The two accessibility palettes of the older chart, as the core's candle tokens on the chart's own box: a person who
 * chose one has told us the brand pair does not work for them.
 */
export const PALETTE_TOKENS: Readonly<Record<Exclude<CandlePalette, "default">, Readonly<Record<string, string>>>> = {
  contrast: { "--ryntra-up": CANDLE_PALETTES.contrast.up, "--ryntra-down": CANDLE_PALETTES.contrast.down },
  colorblind: { "--ryntra-up": CANDLE_PALETTES.colorblind.up, "--ryntra-down": CANDLE_PALETTES.colorblind.down },
};
