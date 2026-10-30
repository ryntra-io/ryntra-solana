import { dateText, digits, wordsNow } from '../i18n/dict.ts';
import { plainFigure } from '../i18n/figures.ts';
import { EX_FORMAT } from './words.ts';

/**
 * How the Exchange writes the engine's figures: it places the point and the sign and shortens for the eye. A figure the
 * engine did not send is a dash, never a zero. Every figure here is for the eye only and is written in the language on
 * screen (`digits`); a value that goes back into a field is `plainPrice`, which never is.
 */

const DASH = '—';

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function grouped(value: number, digits: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * A price per unit of the asset: cents from a dollar up — three places read as thousands with a comma for the point
 * («$97,350» beside the Spot's «$97,48», CITY-150) — and as many places as the price needs below one.
 */
export function price(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return DASH;
  if (value >= 10_000) return digits(`$${grouped(value, 1)}`);
  if (value >= 1) return digits(`$${grouped(value, 2)}`);
  const places = Math.min(10, Math.max(4, -Math.floor(Math.log10(value)) + 3));
  return digits(`$${value.toFixed(places)}`);
}

/** Dollars of money: cents, and the sub-cent places a fee needs. */
export function usd(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  const abs = Math.abs(value);
  const text = abs === 0 ? '0.00' : abs < 0.01 ? abs.toFixed(4) : grouped(abs, 2);
  return digits(`${value < 0 ? '−' : ''}$${text}`);
}

/** A result with its sign, as the city writes every move: +$12.40, −$3.10. */
export function signedUsd(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  if (value === 0) return digits('$0.00');
  // `usd` already writes its figure in the language on screen.
  return `${value > 0 ? '+' : '−'}${usd(Math.abs(value))}`;
}

/** A per cent with its sign. */
export function signedPercent(value: number | null | undefined, places = 1): string {
  if (!finite(value)) return DASH;
  return digits(`${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(places)}%`);
}

export function percent(value: number | null | undefined, places = 1): string {
  if (!finite(value)) return DASH;
  return digits(`${value.toFixed(places)}%`);
}

/** An amount of the asset with its symbol: up to four places from one, four significant below it, never an exponent. */
export function units(value: number | null | undefined, symbol: string): string {
  if (!finite(value)) return `${DASH} ${symbol}`;
  const abs = Math.abs(value);
  const text = abs >= 1000 ? grouped(abs, 0) : plainFigure(abs);
  return `${digits(text)} ${symbol}`;
}

/** Leverage as Phoenix states it: 5.2×. */
export function leverage(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return DASH;
  return digits(`${value >= 10 ? Math.round(value) : Number(value.toFixed(1))}×`);
}

/** Lamports as SOL, for the network fee and the rent. */
export function lamportsSol(lamports: string | null | undefined): string {
  if (typeof lamports !== 'string' || !/^\d+$/.test(lamports)) return DASH;
  const value = Number(BigInt(lamports)) / 1e9;
  return `${digits(plainFigure(value, { significant: 3 }))} SOL`;
}

/** Micro-dollars of USDC (six decimals) as dollars, down to the cent. */
export function micro(value: bigint | string | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  const amount = typeof value === 'bigint' ? value : /^-?\d+$/.test(value) ? BigInt(value) : null;
  if (amount === null) return DASH;
  const negative = amount < 0n;
  const cents = (negative ? -amount : amount) / 10_000n;
  return digits(`${negative ? '−' : ''}$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`);
}

/** The funding now: the rate for its period and who pays, where the mark agrees (the engine's `fundingPayer`). */
export function funding(input: Readonly<{ ratePercent: number; payer: 'long' | 'short' | null; periodSeconds: number | null }> | null): string {
  if (!input || !finite(input.ratePercent)) return DASH;
  // A period Phoenix measures to a fraction of a second (3599.98 s) is still an hour: whole minutes decide.
  const w = wordsNow(EX_FORMAT);
  const minutes = input.periodSeconds === null || !finite(input.periodSeconds) ? null : Math.round(input.periodSeconds / 60);
  const period = minutes === null || minutes <= 0 ? '' : minutes % 60 === 0 ? ` / ${w.hours(minutes / 60)}` : ` / ${w.minutes(minutes)}`;
  const payer = input.payer === 'long' ? ` · ${w.longsPay}` : input.payer === 'short' ? ` · ${w.shortsPay}` : '';
  return `${input.ratePercent >= 0 ? '' : '−'}${digits(Math.abs(input.ratePercent).toFixed(4))}%${period}${payer}`;
}

/** A clock time for «read at»: 14:05. */
export function clock(ms: number | null | undefined): string {
  if (!finite(ms) || ms <= 0) return DASH;
  return dateText(ms, { hour: '2-digit', minute: '2-digit' });
}

/** A day and time for history rows: 28 Oct 14:05. */
export function when(ms: number | null | undefined): string {
  if (!finite(ms) || ms <= 0) return DASH;
  return `${dateText(ms, { day: 'numeric', month: 'short' })} ${dateText(ms, { hour: '2-digit', minute: '2-digit' })}`;
}

/** A large sum for the eye: $12.3M, $840K. */
export function compactUsd(value: number | null | undefined): string {
  if (!finite(value) || value < 0) return DASH;
  if (value >= 1e9) return digits(`$${(value / 1e9).toFixed(2)}B`);
  if (value >= 1e6) return digits(`$${(value / 1e6).toFixed(1)}M`);
  if (value >= 1e3) return digits(`$${(value / 1e3).toFixed(0)}K`);
  return digits(`$${value.toFixed(0)}`);
}

/** A price as a field takes it back: plain digits and a point, no grouping, no exponent — 0.00000012, 165.5. */
export function plainPrice(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return '';
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}
