/* Single source of chart create-options + candle palettes.

   The canvas cannot read CSS variables — but JavaScript can, and hand the
   resolved string to the canvas. That distinction is why this file carried
   nine literals of the retired ramp (#34d399, #f87171, rgba(148,163,184,…))
   long after the design system had moved: the note said "canvas can't read CSS
   vars" and everyone read it as "these have to be literals". They only had to
   be resolved once, at chart-create time, from the same tokens every other
   surface reads.

   Literals survive as FALLBACKS only, for server rendering and for a container
   that is not yet in the document. They are the brand values, so a fallback is
   never a different design — only a less current one. */

import type { ChartOptions, DeepPartial } from "lightweight-charts";
import type { ChartTheme } from "./types";

export type CandlePalette = { up: string; down: string };

/**
 * Resolve a design token against the live document.
 *
 * `host` lets a chart inside a locally themed subtree (a dark instrument island
 * on a light page, `[data-ry-theme]`) resolve the roles that actually apply to
 * it rather than the page's.
 */
function token(name: string, fallback: string, host?: Element | null): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const el = host ?? document.documentElement;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/** Curated palettes only — up stays green-family / down red-family semantics
    (risk colors are locked product-wide; colorblind swaps hue, not direction). */
export const CANDLE_PALETTES = {
  /* Brandbook v1.2: Verified and High risk. Was #34d399 / #f87171, two Tailwind
     defaults that no document in this repository ever named. */
  default: { up: "#3FCB91", down: "#EC6A72" },
  /* The two below are user-selected accessibility overrides, not the product's
     colours. They deliberately leave the brand pair because their whole purpose
     is to be more separable than it — a person who needs them has already told
     us the default does not work for them. */
  contrast: { up: "#00e07f", down: "#ff3b5c" },
  colorblind: { up: "#3b82f6", down: "#f59e0b" },
} as const satisfies Record<string, CandlePalette>;

export type CandlePaletteId = keyof typeof CANDLE_PALETTES;

/** The live palette — brand tokens when the document is available. */
export function candlePalette(id: CandlePaletteId, host?: Element | null): CandlePalette {
  if (id !== "default") return CANDLE_PALETTES[id];
  return {
    up: token("--ry-verified", CANDLE_PALETTES.default.up, host),
    down: token("--ry-risk", CANDLE_PALETTES.default.down, host),
  };
}

export function chartOptions(theme: ChartTheme, host?: Element | null): DeepPartial<ChartOptions> {
  const dark = theme === "dark";
  const grid = token("--rt-chart-grid", dark ? "rgba(39,51,71,0.55)" : "rgba(215,221,216,0.55)", host);
  const border = token("--ry-border", dark ? "#273347" : "#D7DDD8", host);
  const text = token("--ry-muted", dark ? "#98A6B8" : "#5C6A7B", host);
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" },
      textColor: text,
      fontSize: 11,
      fontFamily: token("--ry-font-mono", "ui-monospace, monospace", host),
    },
    grid: {
      vertLines: { color: grid },
      horzLines: { color: grid },
    },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: border },
    rightPriceScale: { borderColor: border },
    crosshair: { mode: 0 },
  };
}
