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
