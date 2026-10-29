import { BRAND } from '../../brand.ts';
import { momentText, type Moment } from '../moment.ts';

/**
 * The words of a post for X: the moment's own words (plain facts, the figure's window, never a promise) and one link
 * back to the tower in the city. X counts every link as 23 characters whatever its length, and a post holds 280.
 */

export const X_MAX = 280;
export const X_LINK = 23;

/** The city with the moment's tower picked, for a coin the city names; the city itself otherwise. */
export function postLink(m: Moment): string {
  const home = `https://${BRAND.domain}/`;
  const ticker = m.symbol?.replace(/^\$/, '');
  return ticker ? `${home}?coin=${encodeURIComponent(ticker)}` : home;
}

/** The length X counts: each link is 23, every other character (a code point) is one. */
export function xLength(text: string): number {
  let length = 0;
  for (const part of text.split(/(https?:\/\/\S+)/)) length += /^https?:\/\//.test(part) ? X_LINK : [...part].length;
  return length;
}

/** The post's words with its link, always within what X holds. */
export function postText(m: Moment, link = postLink(m)): string {
  const text = momentText(m, link);
  if (xLength(text) <= X_MAX) return text;
  // A moment's words are short by design; this only guards a figure that grew.
  const words = momentText(m).replace(new RegExp(` ${BRAND.domain.replace('.', '\\.')}$`), '');
  return `${[...words].slice(0, X_MAX - X_LINK - 2).join('')}… ${link}`;
}
