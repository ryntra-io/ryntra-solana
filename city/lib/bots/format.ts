/**
 * Numbers in the bots window, in the window's language: dollars, prices of any size, percents with their sign, and
 * how long ago. Pure; `Intl` does the digits.
 */

export type Lang = 'en' | 'uk';

const locale = (lang: Lang) => (lang === 'uk' ? 'uk-UA' : 'en-US');

const cache = new Map<string, Intl.NumberFormat>();
function nf(lang: Lang, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}:${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale(lang), options);
    cache.set(key, f);
  }
  return f;
}

/** $1,234.56 — whole dollars from ten thousand, and for a whole amount ($100). */
export function usd(value: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  const digits = Math.abs(value) >= 10_000 || Number.isInteger(value) ? 0 : 2;
  return `${value < 0 ? '−' : ''}$${nf(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))}`;
}

/** +$3.20 / −$1.10: a change always carries its sign. */
export function signedUsd(value: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0.004 ? '+' : value < -0.004 ? '−' : '';
  return `${sign}${usd(Math.abs(value), lang)}`;
}

/** A price with enough digits for its size: 196.4, 0.8213, 0.00002134. */
export function price(value: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : Math.min(10, 3 - Math.floor(Math.log10(value)));
  return `$${nf(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}`;
}

/** A token amount: up to four significant digits after the point for small ones. */
export function amount(value: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 3 : Math.min(9, 3 - Math.floor(Math.log10(abs || 1)));
  return nf(lang, { maximumFractionDigits: digits }).format(value);
}

/** 4.2% / +4.2% with `signed`. */
export function pct(value: number, lang: Lang = 'en', signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const text = nf(lang, { maximumFractionDigits: Math.abs(value) >= 10 ? 0 : 1 }).format(Math.abs(value));
  const sign = signed ? (value > 0.05 ? '+' : value < -0.05 ? '−' : '') : value < 0 ? '−' : '';
  return `${sign}${text}%`;
}

export function sol(value: number, lang: Lang = 'en'): string {
  return nf(lang, { maximumFractionDigits: value < 0.01 ? 4 : 2 }).format(value);
}

/** «2h», «3d» — how long ago, in the window's words. */
export function ago(ms: number, lang: Lang = 'en'): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const uk = lang === 'uk';
  if (m < 60) return uk ? `${Math.max(1, m)} хв` : `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return uk ? `${h} год` : `${h}h`;
  const d = Math.round(h / 24);
  return uk ? `${d} дн.` : `${d}d`;
}

/** «28 Oct, 14:00» — a receipt's time, local. */
export function when(t: number, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
}

export function day(t: number, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(t);
}

/** SOL from lamports, small fees included: 0.00001, 0.0028, 0.07. */
export function lamportsSol(lamports: number, lang: Lang = 'en'): string {
  const value = lamports / 1_000_000_000;
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value < 0.001 ? nf(lang, { maximumSignificantDigits: 2 }).format(value) : nf(lang, { maximumFractionDigits: 4 }).format(value);
}
