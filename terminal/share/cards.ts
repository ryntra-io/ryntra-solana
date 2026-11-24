import { SHARE_WORDS } from './words.ts';

/**
 * The share cards of ryntra.io (decision 105: the terminal is Ryntra's face, the city is not shown in any card): what X,
 * Telegram, Discord and the rest draw under a link. Each big section has its own — a real frame of that section of the
 * terminal (`public/terminal/share/<frame>.jpg`, cut by `scripts/terminal/share-frames.mjs` from a live shot), the mark,
 * the section's name and its line (`words.ts`) — drawn by `card.server.tsx`; a coin and a pool draw their own from the
 * engine's figures (`coin.server.tsx`, `pool.server.tsx`).
 *
 * Pure data and pure functions, no React and no next/og: the site's metadata (`app/seo.ts`) and the tests read it in Node.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** The window of the terminal a card draws: where it stands and its size — flush with the card's right and bottom edges. */
export const SHARE_WINDOW = { left: 470, top: 82, width: 730, height: 548 } as const;

export const SHARE_CARDS = ['home', 'swap', 'launch', 'earn', 'bots', 'agents', 'portfolio', 'pool', 'docs', 'help'] as const;
export type ShareCardId = (typeof SHARE_CARDS)[number];
export type ShareLang = 'en' | 'uk';

export function isShareCard(value: unknown): value is ShareCardId {
  return typeof value === 'string' && (SHARE_CARDS as readonly string[]).includes(value);
}

/** The frame each card stands on: Help shows the docs, every other card its own section. */
export const CARD_FRAME: Readonly<Record<ShareCardId, string>> = {
  home: 'home',
  swap: 'swap',
  launch: 'launch',
  earn: 'earn',
  bots: 'bots',
  agents: 'agents',
  portfolio: 'portfolio',
  pool: 'pool',
  docs: 'docs',
  help: 'docs',
};

/** A frame's address under `public/`. */
export function framePath(frame: string): string {
  return `/terminal/share/${frame}.jpg`;
}

/**
 * The first 8 hex of each frame's sha256, as `scripts/terminal/share-frames.mjs` writes them; `cards.test.mjs` holds them
 * equal to the files. A new frame changes its card's fingerprint, and so the card's address.
 */
export const FRAME_SHA: Readonly<Record<string, string>> = {
  home: '1ed42663',
  swap: 'a7e698c1',
  launch: '9f326db3',
  earn: 'd6b9b21e',
  bots: '553a89a5',
  agents: '8ab0fd05',
  portfolio: 'c747f5e2',
  pool: 'b6dfce67',
  docs: '01f7aad2',
};

/** Bump when a card's drawing (`card.server.tsx`) changes and neither its words nor its frame do. */
export const SHARE_CARD_REVISION = '2026-11-21';

/** Bump when the coin's or the pool's card is drawn anew: their figures change every few minutes, their address does not. */
export const MARKET_CARD_REVISION = '2026-11-21';

/** FNV-1a, 32-bit: a short fingerprint for a query string, not a secret. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A card's fingerprint, carried in its address (`?v=`). Link previews keep a picture by its address for days, so the
 * address changes exactly when the picture does: the drawing's revision, the frame's bytes and the words.
 */
export function shareCardVersion(id: ShareCardId): string {
  const words = Object.values(SHARE_WORDS[id]).flatMap((line) => Object.values(line));
  return fnv1a([SHARE_CARD_REVISION, id, FRAME_SHA[CARD_FRAME[id]] ?? '', ...words].join('|'));
}

/**
 * A card's path on the site, fingerprint included. Home's card is the root's own (`/opengraph-image`, and
 * `/uk/opengraph-image` for the Ukrainian addresses) — what every page without one of its own shows; a section's is
 * `/og/terminal/<id>`, in English as the terminal's pages name themselves to a link's preview.
 */
export function shareCardPath(id: ShareCardId, lang: ShareLang = 'en'): string {
  const v = `?v=${shareCardVersion(id)}`;
  if (id === 'home') return `${lang === 'uk' ? '/uk' : ''}/opengraph-image${v}`;
  return `/og/terminal/${id}${v}`;
}

/** The alt of a card's picture, in the language its address draws it in. */
export function shareCardAlt(id: ShareCardId, lang: ShareLang = 'en'): string {
  return SHARE_WORDS[id][id === 'home' ? lang : 'en'].alt;
}

/** A path's first segments and the card that answers for them, most specific first. */
const BY_PATH: ReadonlyArray<readonly [RegExp, ShareCardId]> = [
  [/^\/(?:uk\/)?(?:market)?$/, 'home'],
  [/^\/(?:swap|bridge|spot|coin)(?:\/|$)/, 'swap'],
  [/^\/(?:uk\/)?launch(?:es)?(?:\/|$)/, 'launch'],
  [/^\/pool(?:\/|$)/, 'pool'],
  [/^\/(?:earn|pro)(?:\/|$)/, 'earn'],
  [/^\/bots(?:\/|$)/, 'bots'],
  [/^\/(?:agent|agents|x)(?:\/|$)/, 'agents'],
  [/^\/(?:portfolio|wallet|money|rewards|watch|private)(?:\/|$)/, 'portfolio'],
  [/^\/(?:uk\/)?(?:docs|developers|connector)(?:\/|$)/, 'docs'],
  [/^\/(?:support|feedback)(?:\/|$)/, 'help'],
];

/** The card a page shows by its address: its section's, else home's. */
export function cardOfPath(path: string): ShareCardId {
  const bare = path.split(/[?#]/)[0] || '/';
  return BY_PATH.find(([pattern]) => pattern.test(bare))?.[1] ?? 'home';
}

/** A coin's card: drawn from the engine's figures at `/c/<mint>/opengraph-image`, read again every five minutes. */
export function coinCardPath(mint: string): string {
  return `/c/${encodeURIComponent(mint)}/opengraph-image?v=${MARKET_CARD_REVISION}`;
}

/** A pool's card: its pair and its figures from the engine, at `/og/pool/<address>`. */
export function poolCardPath(address: string): string {
  return `/og/pool/${encodeURIComponent(address)}?v=${MARKET_CARD_REVISION}`;
}

/**
 * The chip of a coin's place among the day's most traded (`topTradedRank`, `toptraded/24h`): the bucket it falls in, so a
 * card kept five minutes stays true; nothing past the first hundred, nor when the list did not answer.
 */
export function topChip(rank: number | null): string | null {
  if (rank === null || !Number.isInteger(rank) || rank < 1) return null;
  const bucket = [10, 25, 50, 100].find((top) => rank <= top);
  return bucket ? `Top ${bucket} by volume · 24h` : null;
}
