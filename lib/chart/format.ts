/* Shared formatting/color helpers for chart modules (drawings + indicators). */

/** Magnitude-aware price formatting: >=1000 → 1dp, >=1 → 2dp, else 4 significant digits. */
export function fmtPrice(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(4);
}

const alphaCache = new Map<string, string>();

/** Apply alpha to #rgb/#rrggbb/rgb()/rgba() colors. Memoized — safe in per-frame draw paths. */
export function withAlpha(color: string, alpha: number): string {
  const key = `${color}|${alpha}`;
  const hit = alphaCache.get(key);
  if (hit) return hit;
  let out: string;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    out = `rgba(${r},${g},${b},${alpha})`;
  } else {
    const rgb = /^rgba?\(([^)]+)\)$/.exec(color.trim());
    if (rgb) {
      const parts = rgb[1].split(",").map((s) => s.trim()).slice(0, 3);
      out = `rgba(${parts.join(",")},${alpha})`;
    } else {
      out = color; // named/other colors pass through unchanged
    }
  }
  if (alphaCache.size > 512) alphaCache.clear();
  alphaCache.set(key, out);
  return out;
}
