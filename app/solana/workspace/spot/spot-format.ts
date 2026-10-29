/**
 * Number shapes for the Spot surface. Pure; every function answers with a
 * string the page prints as-is, and `null` in means an em dash out — the
 * source did not state the figure, and the page says so rather than showing
 * a zero that looks like a measurement.
 */

const DASH = "—";

/** A price with as many decimals as its size needs: `203.14`, `0.1408`, `0.00002946`. */
export function formatPrice(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * The decimals a terminal prints a price of this size with (B15): two from a dollar up (`104.11`, `1.74`, as «Ринки»
 * print them); under a dollar, four significant digits after the zeros — `0.1408`, `0.004512`, `0.000003012`. One number decides it for the header, the chart's axis,
 * its crosshair and the limit lines, so they all print the same figure.
 */
export function priceDecimals(reference: number | null): number {
  if (reference === null || !Number.isFinite(reference) || reference === 0) return 2;
  const abs = Math.abs(reference);
  if (abs >= 1) return 2;
  /* The zeros after the point: 0.1408 → 0, 0.001 → 2, 0.00000301 → 5. */
  const zeros = Math.max(0, Math.ceil(-Math.log10(abs) - 1e-12) - 1);
  return Math.min(zeros + 4, 18);
}

/**
 * A price as a terminal prints it (B15): `104.11`, `0.1408`, and four zeros or more after the point counted in a
 * subscript — `0.0₅3012` for $0.000003012 — so a cheap token reads at a glance and its axis has steps. The locale's own
 * separators: `0,0₅3012` in Ukrainian. `decimals` is the reference price's (`priceDecimals`), so an axis prints every
 * step alike; null in, a dash out.
 */
export function formatTerminalPrice(value: number | null, locale: string, decimals: number = priceDecimals(value)): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).formatToParts(value);
  return parts
    .map((part) => {
      if (part.type !== "fraction") return part.value;
      const integer = parts.find((entry) => entry.type === "integer")?.value;
      const zeros = part.value.match(/^0*/)?.[0].length ?? 0;
      if (integer !== "0" || zeros < 4 || zeros === part.value.length) return part.value;
      return `0${String(zeros)
        .split("")
        .map((digit) => SUBSCRIPT[Number(digit)])
        .join("")}${part.value.slice(zeros)}`;
    })
    .join("");
}

/** `$203.14`, `$0.1408`, or a dash. */
export function formatUsdPrice(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return `$${formatPrice(value, locale)}`;
}

/** An amount of money — a spend, a loss, a budget — in whole cents: `$1,000.00`, `$0.34`, or a dash. A price gets its own decimals above; money is counted in cents. */
export function formatUsdMoney(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

/** Compact USD for a stat: `$1.2B`, `$48.5M`, `$912K`, `$41`. */
export function formatUsdCompact(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  /* Ukrainian says the scale in words — «$2,8 млрд», «$929,7 млн», «$641 тис.» — English keeps B, M and K. */
  const [b, m, k] = locale.startsWith("uk") ? [" млрд", " млн", " тис."] : ["B", "M", "K"];
  if (abs >= 1_000_000_000) return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000_000_000)}${b}`;
  if (abs >= 1_000_000) return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000_000)}${m}`;
  if (abs >= 10_000) return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value / 1_000)}${k}`;
  if (abs >= 1_000) return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}${k}`;
  return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: abs >= 1 ? 0 : 2 }).format(value)}`;
}

/**
 * Compact USD for a chart's axis, the stat's own shape with the figures an axis needs to read its steps apart:
 * `$1.234B`, `$48.56M`, `$912.4K` — four significant figures, the same `$…B` in both languages.
 */
export function formatUsdAxis(value: number, locale: string): string {
  if (!Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  const [scaled, unit] = abs >= 1e9 ? [value / 1e9, "B"] : abs >= 1e6 ? [value / 1e6, "M"] : abs >= 1e3 ? [value / 1e3, "K"] : [value, ""];
  return `$${new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(scaled)}${unit}`;
}

/** A count: `2,342,610` or compact above a million. */
export function formatCount(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  if (Math.abs(value) >= 1_000_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}${locale.startsWith("uk") ? " млн" : "M"}`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** `+1.51%` / `−0.15%`, with the sign the page colours by. */
export function formatPercent(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value * 100) / 100;
  const text = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(rounded));
  return rounded > 0 ? `+${text}%` : rounded < 0 ? `−${text}%` : `${text}%`;
}

export type PnlTone = "up" | "down" | "flat";

export function toneOf(value: number | null): PnlTone {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "up" : "down";
}

/** Whole-day age: `3 d`, `2 y 41 d`, or a dash. */
export function formatAge(days: number | null, uk: boolean): string {
  if (days === null) return DASH;
  if (days < 1) return uk ? "сьогодні" : "today";
  if (days < 365) return uk ? `${days} дн` : `${days} d`;
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  return uk ? `${years} р ${rest} дн` : `${years} y ${rest} d`;
}

/** A token amount, already scaled, trimmed to what fits a row: `0.049962`, `6.78`, `1,234.5`. */
export function formatAmount(value: number | null, locale: string, maxFraction = 6): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? Math.min(2, maxFraction) : abs >= 1 ? Math.min(4, maxFraction) : maxFraction;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** `7BxQ…91Pk` */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Raw base units → a JS number for display only (never for money arithmetic). */
export function rawToNumber(raw: string, decimals: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value : null;
}
