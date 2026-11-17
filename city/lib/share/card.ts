import { SHARE_SCENE } from '../art/frames.ts';
import { terminalOpen } from '../../../terminal/shell/flag.ts';
import { CARD_WORDS } from './words.ts';

/**
 * The city's share card: what X, Telegram and the rest show for a link to ryntra.io — a frame of our own live
 * 3D city (`SHARE_SCENE`), the mark, RYNTRA and the city's line. Every public address that is not a coin shows it
 * (`card.server.tsx`), in its language; a coin draws its own (`city/lib/coin/og.server.tsx`).
 * No React and no next/og here: the site's metadata and the tests read it in Node.
 */

export const CITY_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * The terminal's frame: a shot of the live Market, 1200×630, taken on a stand by
 * `scripts/terminal/share-scene.mjs`. Once the terminal is the home page the site's card and a coin's card stand on it.
 */
export const TERMINAL_SHARE_SCENE = Object.freeze({ src: '/terminal/share-scene.jpg', width: 1200, height: 630 });

/** The frame every card of the site stands on: the terminal's once it is the home page, the city's until then. */
export function shareScene(): Readonly<{ src: string; width: number; height: number }> {
  return terminalOpen() ? TERMINAL_SHARE_SCENE : SHARE_SCENE;
}

/** Bump when the card's drawing (`card.server.tsx`) changes and neither its words nor its frame do. */
export const CITY_CARD_REVISION = '2026-11-05';

/** FNV-1a, 32-bit: a short fingerprint for a query string, not a secret. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The card's fingerprint, carried in its address (`?v=`). Link previews keep a picture by its address for days, so the
 * address changes exactly when the picture does: the drawing's revision, the frame and the words.
 */
export function cityCardVersion(): string {
  const words = Object.values(CARD_WORDS).flatMap((half) => Object.values(half));
  return fnv1a([CITY_CARD_REVISION, shareScene().src, ...words].join('|'));
}
