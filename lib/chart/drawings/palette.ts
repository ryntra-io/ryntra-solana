/* Resolve the drawing palette from CSS custom properties on the chart container.
   No caching here — the caller caches and re-reads on theme/accent change. */

import type { ThemePalette } from "./types";

const FALLBACK: ThemePalette = {
  accent: "#ff5a1f",
  success: "#3fcb91",
  danger: "#ec6a72",
  warning: "#e8b34f",
  text: "#fff3e8",
  textDim: "#a5bed6",
  panel: "#113558",
  border: "rgba(148,163,184,0.12)",
};

export function readPalette(el: HTMLElement): ThemePalette {
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: string): string => {
    const v = cs.getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  };
  return {
    accent: read("--accent", FALLBACK.accent),
    success: read("--success", FALLBACK.success),
    danger: read("--danger", FALLBACK.danger),
    warning: read("--warning", FALLBACK.warning),
    text: read("--text", FALLBACK.text),
    textDim: read("--text-dim", FALLBACK.textDim),
    panel: read("--panel", FALLBACK.panel),
    border: read("--border", FALLBACK.border),
  };
}
