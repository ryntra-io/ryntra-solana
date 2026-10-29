/**
 * A price the card could not get, in one calm line. The engine answers in English for its logs — setting names, mint
 * addresses, its own words for the venue — and none of that is for the card: the line is chosen by the code alone, so
 * nothing the server writes ever reaches the screen. `retryable` false: pressing again cannot help, so the card offers
 * no «Try again» for it.
 */

export type QuoteLine = Readonly<{ text: string; retryable: boolean }>;

const stop = (text: string): QuoteLine => ({ text, retryable: false });
const retry = (text: string): QuoteLine => ({ text, retryable: true });

export function quoteLine(code: string): QuoteLine {
  // The deployment cannot price at all just now: no setting a person can change.
  if (/KEY_MISSING|KEY_REQUIRED|SWAP_PAUSED|NOT_CONFIGURED/.test(code)) return stop('Prices are unavailable right now.');
  if (/ASSET_NOT_OFFERED/.test(code)) return stop('This coin is not offered here.');
  if (/MINT_UNREADABLE|PASSPORT_REFUSED/.test(code)) return stop('This coin cannot be traded here.');
  if (/SAME_MINT/.test(code)) return stop('Pick two different coins.');
  if (/VALIDATION|AMOUNT/.test(code)) return stop('This amount cannot be traded.');
  if (/NO_ROUTE/.test(code)) return retry('No price for this pair right now.');
  if (/RATE_LIMITED/.test(code)) return retry('Busy for a moment. Try again.');
  return retry('No price just now. Try again.');
}
