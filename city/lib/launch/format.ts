import { digits, wordsNow } from '../i18n/dict.ts';
import { TERMS_WORDS } from './words.ts';

/**
 * How the city says the engine's figures: short, never rounded into more than they are. They are written the English
 * way and handed to `digits`, which writes them in the language on screen: these are for the eye only, never a value
 * that goes back into a field or a request.
 */

/** A share in basis points: 5000 → 50%, 250 → 2.5%. */
export function pct(bps: number): string {
  const value = bps / 100;
  return digits(`${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`);
}

/** A dollar figure, short: 75000 → $75K, 3594.7 → $3.6K, 1250000 → $1.25M. */
export function usd(value: number): string {
  if (value >= 1e6) return digits(`$${Number((value / 1e6).toFixed(2))}M`);
  if (value >= 1e3) return digits(`$${Number((value / 1e3).toFixed(value >= 1e4 ? 0 : 1))}K`);
  return `$${Math.round(value)}`;
}

/** A span of time: 600 → 10 min, 45 → 45 s, 7200 → 2 h. */
export function span(seconds: number): string {
  const w = wordsNow(TERMS_WORDS);
  if (seconds < 60) return w.seconds(digits(String(seconds)));
  if (seconds < 3600) return w.minutes(digits(String(Number((seconds / 60).toFixed(1)))));
  return w.hours(digits(String(Number((seconds / 3600).toFixed(1)))));
}

/** Lamports as SOL with four decimals, rounded up, so a cost never reads as less than it is. */
export function sol(lamports: string): string {
  const unit = 100_000n;
  const up = (BigInt(lamports) + unit - 1n) / unit;
  return digits(`${up / 10_000n}.${(up % 10_000n).toString().padStart(4, '0')}`);
}

/** The time since a launch as the docks count it: T+00:42 in its first day, then the day. */
export function sinceLaunch(launchedAt: string | null, now: number): string | null {
  const at = launchedAt ? Date.parse(launchedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds >= 86_400) return wordsNow(TERMS_WORDS).day(Math.floor(seconds / 86_400));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `T+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `T+${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A wallet address, short: 7xKX…9fQa. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
