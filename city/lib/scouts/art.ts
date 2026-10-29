/**
 * The «Scouts» still: filmed from our own live 3D city — towers at night with the scouts' pennants on their roofs —
 * never a generated city that is not ours. It heads the window and fills its no-wallet and
 * sign-in states, so no grey placeholder stands on screen. It carries no coin, no logo, no price and no number: every
 * figure stays the engine's. Two widths: 1440 for a desk, 800 for a phone. Filmed by `shots.mjs` (`FILM=only`).
 */

const DIR = '/city/art';

export const SCOUTS_ART = { small: `${DIR}/scouts-800.webp`, large: `${DIR}/scouts-1440.webp` } as const;

export const scoutsSrcSet = `${SCOUTS_ART.small} 800w, ${SCOUTS_ART.large} 1440w`;
