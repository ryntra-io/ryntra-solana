import type { CSSProperties } from 'react';
import { Geist, Hubot_Sans, Mona_Sans } from 'next/font/google';

/**
 * The city's two faces (brandbook: Hubot Sans for the big words, Mona Sans for the sentences) and the Cyrillic beneath
 * them (CITY-79). Hubot and Mona have no Cyrillic, so a Ukrainian letter falls to Geist — the brand's interface face,
 * which has it — before the metric fallback; Latin letters keep their own faces. Geist's files are the ones the root
 * layout already preloads, so the Cyrillic costs no extra download.
 */
const display = Hubot_Sans({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display', display: 'swap' });
const ui = Mona_Sans({ subsets: ['latin'], axes: ['wdth'], variable: '--font-ui', display: 'swap' });
const cyrillic = Geist({ subsets: ['cyrillic'], display: 'swap', adjustFontFallback: false, preload: false });

/** A face's stack with the Cyrillic face right after the face itself, ahead of its metric fallback. */
function withCyrillic(stack: string): string {
  const [face, ...rest] = stack.split(',').map((part) => part.trim());
  return [face, cyrillic.style.fontFamily, ...rest].join(', ');
}

/** For the route entry's root: the classes that load the faces, and the stacks the city's CSS reads. */
export const CITY_FONTS: Readonly<{ className: string; style: CSSProperties }> = {
  className: `${display.variable} ${ui.variable}`,
  style: { ['--font-display' as string]: withCyrillic(display.style.fontFamily), ['--font-ui' as string]: withCyrillic(ui.style.fontFamily) },
};
