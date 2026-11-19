/**
 * A price the card could not get, in one calm line. The engine answers in English for its logs — setting names, mint
 * addresses, its own words for the venue — and none of that is for the card: the line is chosen by the code alone, so
 * nothing the server writes ever reaches the screen. `retryable` false: pressing again cannot help, so the card offers
 * no «Try again» for it.
 */

import { wordsNow } from '../i18n/dict.ts';
import { QUOTE } from './words.ts';

export type QuoteLine = Readonly<{ text: string; retryable: boolean }>;

const stop = (text: string): QuoteLine => ({ text, retryable: false });
const retry = (text: string): QuoteLine => ({ text, retryable: true });

/**
 * A refusal that only says «not this moment»: the venue's request window was full, or an answer was slow, lost or the
 * venue's own failure. Measured on production 18.11: Ryntra's Jupiter window (ten requests for the whole site) ran out
 * about once in three windows, and every quote in it answered 429 — words on the screen for something a few seconds
 * later answers by itself. A price on screen stays through such a refusal while it is young, and an order the card
 * builds by itself is refused in silence. A refusal about the coin, the pair or the amount is said at once. The exact
 * order's own codes (`ORDER_…`) read the same.
 */
export function momentary(code: string): boolean {
  return /^(QUOTE_|ORDER_)?(RATE_LIMITED|UNREACHABLE|HTTP_ERROR)$|^(TIMEOUT|NETWORK)$|^HTTP_(429|5\d\d)$/.test(code);
}

/**
 * How long to wait before the one quiet second ask of a price, or null when none is worth it: a full window waits for
 * the slot the venue names (the server passes its reset on, `retryAfterMs`), never past ten seconds; the venue's own
 * failure waits a moment. A slow or lost answer was already asked twice (`askTwice`), and anything else is said.
 * `jitter` (0…1) spreads the people who were refused in the same second.
 */
export function quietWaitMs(failure: Readonly<{ code: string; retryAfterMs?: number }>, jitter: number): number | null {
  const spread = Math.round(Math.max(0, Math.min(1, jitter)) * 400);
  if (/^(QUOTE_)?RATE_LIMITED$|^HTTP_429$/.test(failure.code)) {
    const hint = typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs : 1_500;
    const wait = Math.max(500, hint) + spread;
    return wait <= 10_000 ? wait : null;
  }
  if (/^QUOTE_(UNREACHABLE|HTTP_ERROR)$/.test(failure.code)) return 800 + spread;
  return null;
}

export function quoteLine(code: string): QuoteLine {
  const w = wordsNow(QUOTE);
  // The deployment cannot price at all just now: no setting a person can change.
  if (/KEY_MISSING|KEY_REQUIRED|SWAP_PAUSED|NOT_CONFIGURED/.test(code)) return stop(w.unavailable);
  if (/ASSET_NOT_OFFERED/.test(code)) return stop(w.notOffered);
  if (/MINT_UNREADABLE|PASSPORT_REFUSED/.test(code)) return stop(w.notTradable);
  if (/SAME_MINT/.test(code)) return stop(w.sameCoin);
  if (/VALIDATION|AMOUNT/.test(code)) return stop(w.badAmount);
  if (/NO_ROUTE/.test(code)) return retry(w.noRoute);
  if (/RATE_LIMITED/.test(code)) return retry(w.busy);
  return retry(w.noPrice);
}
