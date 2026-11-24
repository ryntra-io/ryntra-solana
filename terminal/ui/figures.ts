import { money } from '../../city/lib/feed/format.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/**
 * How the terminal writes the engine's figures: the city's own short forms (`city/lib/feed/format.ts`), each in the
 * language's own way — in Ukrainian the decimal point is a comma and the thousands a narrow space. Only for the eye:
 * a value that goes back into a field or a request never passes here.
 *
 * One way of writing on every screen, in both languages (flaws 2 and 3 — «$8,9M» beside «$572,9 тис.», «+0,60%»
 * beside «−1,17 %» on one Ukrainian screen):
 * - a short sum or count takes the letters K, M, B — in Ukrainian too, with its comma: «$8,9M», «77K», «$1,20B»; never
 *   «тис.», «млн», «млрд» beside them;
 * - a per cent stands straight after its number, no space, in both languages: «+0,60%», «20%», «Комісія 0,5%».
 * `figures.test.mjs` holds it across the terminal's code.
 */

/** A price: cents above a dollar, four places below, as many as it takes for a coin worth less than a cent. */
export function priceText(price: number, lang: Lang): string {
  if (!Number.isFinite(price) || price <= 0) return digits('$0', lang);
  if (price >= 1000) return digits(`$${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`, lang);
  if (price >= 1) return digits(`$${price.toFixed(2)}`, lang);
  if (price >= 0.01) return digits(`$${price.toFixed(4)}`, lang);
  const places = Math.min(10, Math.max(4, -Math.floor(Math.log10(price)) + 3));
  return digits(`$${price.toFixed(places)}`, lang);
}

/** Dollars, short: $2.4M, $810K, $1.20B. */
export function usdText(value: number, lang: Lang): string {
  return digits(money(value), lang);
}

/**
 * A sum of trades in dollars: one the short form would round to «$0» (under fifty cents) is «<$1» — a zero reads as a
 * trade of nothing; from fifty cents on, as `usdText` («$1»).
 */
export function sumText(value: number, lang: Lang): string {
  return Number.isFinite(value) && value > 0 && value < 0.5 ? '<$1' : usdText(value, lang);
}

/** A move in percent, signed: +3.72%, −0.09%. */
export function changeText(change: number, lang: Lang): string {
  if (!Number.isFinite(change)) return '—';
  /* A move that rounds to nothing is no move: «0.00%», never «−0.00%». */
  if (Math.abs(change) < 0.005) return digits('0.00%', lang);
  return digits(`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`, lang);
}

/** The tone of a move: growth mint, a fall flare, nothing for none — nor for a move that rounds to nothing. */
export function changeTone(change: number): 'up' | 'down' | undefined {
  return change >= 0.005 ? 'up' : change <= -0.005 ? 'down' : undefined;
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * A decimal written the English way with its run of four zeros or more after «0.» folded into a small figure —
 * 0.0000001383 → «0.0₆1383» — the way the chart writes a small price (`@ryntra/core`'s `formatDecimal` with `fold`),
 * so a pool's head, its liquidity and its ticket say a tiny price as the chart beside them does, never «1.383e-7».
 */
export function foldZeros(text: string): string {
  const match = /^(-?)0\.(0{4,})(\d+)$/.exec(text);
  if (!match) return text;
  const run = [...String(match[2]!.length)].map((digit) => SUBSCRIPT[Number(digit)]).join('');
  return `${match[1]}0.0${run}${match[3]}`;
}

/**
 * How many significant figures tell a pool's neighbouring steps of the price apart («1.31 – 1.32» for a
 * range of 69 steps of a hundredth of a per cent): never fewer than four, five for a step of 0.01 %.
 */
export function stepSignificant(stepBps: number | null): number {
  if (stepBps === null || !(stepBps > 0) || !Number.isFinite(stepBps)) return 4;
  return Math.min(8, Math.max(4, Math.ceil(Math.log10(10_000 / stepBps) - 1e-9) + 1));
}

/** The decimals that give `value` that many significant figures; none from a value that has them before its point. */
export function placesFor(value: number, significant: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0;
  return Math.min(14, Math.max(0, significant - 1 - Math.floor(Math.log10(value))));
}

/** A price to so many decimals, the English way (`digits` makes it the screen's): thousands grouped, a run of zeros folded. */
export function placedFigure(value: number, places: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  return foldZeros(value.toFixed(places));
}

/** A pool's price in the coin it is priced in, to as many figures as its step needs: 0.003649, 1.3108, 0.0₆1383. */
export function stepFigure(value: number, stepBps: number | null): string {
  return placedFigure(value, placesFor(value, stepSignificant(stepBps)));
}

/** A plain amount with at most `places` decimals, trailing zeros dropped. */
export function amountOf(value: number, places: number, lang: Lang): string {
  if (!Number.isFinite(value)) return '—';
  return digits(value.toLocaleString('en-US', { maximumFractionDigits: places, useGrouping: true }), lang);
}
