/**
 * Foreign words on their way into Ryntra's question: a coin's symbol and name are written by whoever launched the coin,
 * so they may carry invisible characters or words that pretend to be orders. Every such word passes here before it
 * joins a question the assistant reads.
 *
 * CITY-73 (decision 74) owns the city's cleaning of foreign text. Until it lands, this is the marked call site: a
 * strict interim that drops control, format and bidi characters, folds whitespace and keeps a symbol short. When
 * CITY-73 merges, `foreignWord` calls its cleaner and this body goes.
 */

/** Control characters, zero-width and bidi marks, the BOM, tag characters and variation selectors: nothing a reader sees. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]|\udb40[\udc00-\udc7f]/g;

/** A symbol as a question may carry it: letters, digits and a few marks, never a sentence. */
const SYMBOL_MAX = 16;

/** One foreign word cleaned for a question: invisible characters gone, whitespace folded, at most `max` characters. */
export function foreignWord(text: string, max = SYMBOL_MAX): string {
  return text.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A symbol fit to stand in a question: a short run of letters and digits, or null when nothing of it is. */
export function questionSymbol(symbol: string): string | null {
  const word = foreignWord(symbol, 64).replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, SYMBOL_MAX);
  return word.length ? word : null;
}
