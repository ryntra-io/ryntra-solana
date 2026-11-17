import { money } from '../../city/lib/feed/format.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/**
 * How the terminal writes the engine's figures: the city's own short forms (`city/lib/feed/format.ts`), each in the
 * language's own way — in Ukrainian the decimal point is a comma and the thousands a narrow space. Only for the eye:
 * a value that goes back into a field or a request never passes here.
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

/** A move in percent, signed: +3.72%, −0.09%. */
export function changeText(change: number, lang: Lang): string {
  if (!Number.isFinite(change)) return '—';
  return digits(`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`, lang);
}

/** The tone of a move: growth mint, a fall flare, nothing for none. */
export function changeTone(change: number): 'up' | 'down' | undefined {
  return change > 0 ? 'up' : change < 0 ? 'down' : undefined;
}

/** A plain amount with at most `places` decimals, trailing zeros dropped. */
export function amountOf(value: number, places: number, lang: Lang): string {
  if (!Number.isFinite(value)) return '—';
  return digits(value.toLocaleString('en-US', { maximumFractionDigits: places, useGrouping: true }), lang);
}
