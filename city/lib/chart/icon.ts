import type { Tower } from '../market/types.ts';

/**
 * The coin's logo in the chart's head (CITY-5a). The engine serves a coin's logo from the URL Jupiter lists for it
 * (`/api/icon/<mint>`), and answers «no logo» for a minute when the logo's gateway is busy. So: the first try; on a
 * failure, the coin's first letter while a moment passes; one more try past the busy minute's cached answer; then the
 * letter for good. A coin the engine lists without a logo wears its letter from the start. Pure.
 */

/** How long the letter stands before the logo is asked once more. */
export const ICON_RETRY_MS = 4_000;

/** The attempt after a failed one: 0 → 1 (wait), 2 → 3 (no more tries). */
export function iconAttempt(failed: number): number {
  return failed === 0 ? 1 : 3;
}

/** The logo's address for an attempt; null while waiting, after the last try, or for a coin with no logo listed. */
export function iconSource(tower: Pick<Tower, 'id' | 'icon'>, attempt: number): string | null {
  if (!tower.icon) return null;
  const path = `/api/icon/${encodeURIComponent(tower.id)}`;
  if (attempt === 0) return path;
  if (attempt === 2) return `${path}?again=1`;
  return null;
}

/** The coin's first letter or digit, as its badge: «$POPCAT» → «P»; a symbol with neither → «$». */
export function monogram(symbol: string): string {
  const letter = [...symbol.replace(/^\$/, '')].find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return letter ? letter.toLocaleUpperCase('en-US') : '$';
}
