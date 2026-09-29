import type { DecimalValue, MoneyValue } from "./decimal.ts";

/**
 * Rendering, and only rendering.
 *
 * Every figure on the Home surfaces arrives as a canonical integer plus a
 * scale, and this file turns that pair into text by moving a character — not by
 * dividing. `Number(units) / 10 ** scale` is the shortest way to write this and
 * it silently loses exactness above 2^53, which for a portfolio is not an edge
 * case but a Tuesday: eighteen-decimal token quantities pass that boundary at
 * nine units.
 *
 * Nothing here computes a value. A surface that needed a sum would be asking
 * the wrong layer — the read model owns arithmetic and this owns the glyphs.
 */
export function formatDecimal(value: DecimalValue): string {
  const negative = value.units.startsWith("-");
  const digits = negative ? value.units.slice(1) : value.units;
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const whole = padded.slice(0, padded.length - value.scale);
  const fraction = padded.slice(padded.length - value.scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function grouped(whole: string): string {
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    parts.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${negative ? "-" : ""}${parts.join(",")}`;
}

/**
 * A money value with its currency attached, always.
 *
 * The currency is not decoration: two of the six valuation states exist because
 * a figure without its unit is not a fact, and a total whose currency lives in a
 * heading three tiles away is one refactor from lying.
 */
export function formatMoney(value: MoneyValue): string {
  const text = formatDecimal(value.amount);
  const [whole, fraction] = text.split(".");
  return `${grouped(whole)}${fraction === undefined ? "" : `.${fraction}`} ${value.currency}`;
}

/**
 * Coverage as a percentage, with `null` rendered as the em dash.
 *
 * `null` means the share is unknown, and `0%` would say the opposite — the exact
 * substitution the whole surface exists to refuse.
 */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  const negative = bps < 0;
  const magnitude = Math.abs(bps).toString().padStart(3, "0");
  const whole = magnitude.slice(0, magnitude.length - 2);
  const fraction = magnitude.slice(magnitude.length - 2);
  return `${negative ? "-" : ""}${grouped(whole)}.${fraction}%`;
}
