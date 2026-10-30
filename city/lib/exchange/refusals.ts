import { wordsNow } from '../i18n/dict.ts';
import { EX_REFUSALS } from './words.ts';

/**
 * The engine's refusals as the Exchange says them: what happened, in a person's words, and that nothing was sent. Every
 * code here is one the Phoenix routes (`app/api/solana/futures/**`) or the city's own flow give before anything was
 * sent; a refusal after a send does not exist — that outcome is the chain's to say (`flow.ts`). A code this release
 * does not know is said plainly rather than in the server's own wording, which is written for developers (the clean
 * interface rule of 28.10: no technical words on screen).
 */

/** The line for an engine code, in the language on screen (`words.ts`); a plain line for a code this release does not know. */
export function refusalWords(code: string): string {
  const w = wordsNow(EX_REFUSALS);
  return code !== 'FALLBACK' && Object.hasOwn(w, code) ? (w as Readonly<Record<string, string>>)[code]! : w.FALLBACK;
}

/** Codes that a fresh Review cures by itself: the card offers «Review again» rather than a dead end. */
export const AGAIN: ReadonlySet<string> = new Set(['TICKET_EXPIRED', 'TICKET_INVALID', 'PHOENIX_UNAVAILABLE', 'PHOENIX_RATE_LIMITED', 'UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PRICE_UNKNOWN']);
