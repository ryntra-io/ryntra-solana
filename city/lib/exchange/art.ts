/**
 * The Exchange's still frames: filmed from our own live 3D city, never a generated city that is not ours. They head the window and fill its empty and no-account states,
 * so no grey placeholder stands on screen. The files are `public/city/art/exchange-*.webp` in two widths: 1600 for a
 * desk, 800 for a phone and cards. They carry no coin, no logo, no price and no number: every figure stays the engine's.
 */

const DIR = '/city/art';

export type ExchangeArt = 'head' | 'invite' | 'empty';

export const EXCHANGE_ART: Readonly<Record<ExchangeArt, Readonly<{ small: string; large: string }>>> = {
  head: { small: `${DIR}/exchange-head-800.webp`, large: `${DIR}/exchange-head-1600.webp` },
  invite: { small: `${DIR}/exchange-invite-800.webp`, large: `${DIR}/exchange-invite-1600.webp` },
  empty: { small: `${DIR}/exchange-empty-800.webp`, large: `${DIR}/exchange-empty-1600.webp` },
};

/** The `srcSet` of a frame: the browser picks the narrowest file at least as wide as it is drawn. */
export const artSrcSet = (art: ExchangeArt): string => `${EXCHANGE_ART[art].small} 800w, ${EXCHANGE_ART[art].large} 1600w`;
