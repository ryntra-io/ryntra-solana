import { solFigure, usdFigure } from '../../city/lib/autopilot/report.ts';
import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/**
 * How the Agents screen writes the agent's own figures. Every one is the book's or the chain's, counted in whole
 * lamports; a figure that was not read is null and stays off the screen — never a zero, never a guess. Pure.
 */

const DAY_MS = 86_400_000;
const DIGITS = /^\d{1,30}$/u;
const SIGNED = /^-?\d{1,30}$/u;

/** Whole days a mandate has left, counted up: «27 days left» the moment it is signed for 27 days and a minute. */
export function daysLeft(expiresAtSeconds: string, now: number): number | null {
  if (!DIGITS.test(expiresAtSeconds)) return null;
  return Math.max(0, Math.ceil((Number(expiresAtSeconds) * 1000 - now) / DAY_MS));
}

/**
 * Lamports as SOL in a budget's line: two places where the amount has no more («0.04», «0.10»), four where it does —
 * cut, never rounded up, so «spent» never reads as more than was spent.
 */
export function solPlain(raw: string, lang: Lang): string {
  if (!DIGITS.test(raw)) return '—';
  const value = BigInt(raw);
  // Less than 0.0001 keeps every digit it has: a spend is never written as a zero.
  const places = value % 10_000_000n === 0n ? 2 : value >= 100_000n ? 4 : 9;
  const step = 10n ** BigInt(9 - places);
  const units = value / step;
  const whole = units / 10n ** BigInt(places);
  const padded = (units % 10n ** BigInt(places)).toString().padStart(places, '0');
  const fraction = places === 9 ? padded.replace(/0+$/u, '') : padded;
  return digits(fraction ? `${whole}.${fraction}` : `${whole}`, lang);
}

/**
 * Lamports at SOL's price as cents: a gain cut down to the cent, a loss counted up to it — the dollars never read better
 * than the lamports. Null without a price.
 */
export function centsOf(raw: string, solUsd: number | null): bigint | null {
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0 || !SIGNED.test(raw)) return null;
  const micros = BigInt(Math.round(solUsd * 1_000_000));
  const scaled = BigInt(raw) * micros;
  const unit = 10_000_000_000_000n;
  const cents = scaled / unit;
  return scaled < 0n && scaled % unit !== 0n ? cents - 1n : cents;
}

/** Cents as dollars, signed: «+$4.00», «−$0.40», «$0.00». */
function centsText(cents: bigint, lang: Lang): string {
  const abs = cents < 0n ? -cents : cents;
  const sign = cents > 0n ? '+' : cents < 0n ? '−' : '';
  return digits(`${sign}$${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`, lang);
}

/** How much of the day's budget is spent, 0–1; null when the spend was not read. */
export function budgetUse(perDayRaw: string, spentRaw: string | null): number | null {
  if (spentRaw === null || !DIGITS.test(perDayRaw) || !DIGITS.test(spentRaw)) return null;
  const day = BigInt(perDayRaw);
  if (day <= 0n) return null;
  const spent = BigInt(spentRaw);
  return spent >= day ? 1 : Number((spent * 10_000n) / day) / 10_000;
}

export type Tone = 'up' | 'down' | undefined;
export type Shown = Readonly<{ text: string; tone: Tone }>;

/**
 * A result in lamports as the screen says it: in dollars at SOL's price now when the market read gave one, else in SOL.
 * The sign and the tone are the result's own; nothing is rounded in the agent's favour.
 */
export function resultShown(raw: string | null, solUsd: number | null, lang: Lang): Shown | null {
  if (raw === null || !SIGNED.test(raw)) return null;
  const value = BigInt(raw);
  const tone: Tone = value > 0n ? 'up' : value < 0n ? 'down' : undefined;
  const cents = centsOf(raw, solUsd);
  return { text: cents === null ? solFigure(raw, lang) : centsText(cents, lang), tone };
}

/** A result already in dollars — the autopilot's week — to the cent, a gain cut down and a loss up. */
export function usdShown(usd: number | null, lang: Lang): Shown | null {
  if (usd === null || !Number.isFinite(usd)) return null;
  const cents = Math.floor(usd * 100) / 100;
  return { text: usdFigure(cents, lang), tone: cents > 0 ? 'up' : cents < 0 ? 'down' : undefined };
}

/** SOL as a person types it into a budget's field → lamports; null for anything that is not a plain positive amount. */
export function lamportsTyped(text: string): bigint | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d{0,9}(\.\d{0,9})?$/u.test(value) || !/\d/u.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const raw = BigInt(whole || '0') * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
  return raw > 0n ? raw : null;
}

/** A budget as its field shows it: «0.1», «0.25» — no trailing zeros, the language's decimal mark. */
export function budgetText(lamports: bigint, lang: Lang): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/u, '');
  return digits(fraction ? `${whole}.${fraction}` : `${whole}`, lang);
}
