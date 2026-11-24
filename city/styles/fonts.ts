import type { CSSProperties } from 'react';

import { hubotSans as display, monaSans as ui } from '@/app/fonts/city';
import { geistCyrillic as cyrillic } from '@/app/fonts/root';

/**
 * The city's two faces (brandbook: Hubot Sans for the big words, Mona Sans for the sentences) and the Cyrillic beneath
 * them. Hubot and Mona have no Cyrillic, so a Ukrainian letter falls to Geist — the brand's interface face,
 * which has it — before the metric fallback; Latin letters keep their own faces. Geist's Cyrillic is the face the root
 * layout already loads and preloads (`app/fonts/root.ts`), so it costs no extra download. Every file is the repository's
 * own (`app/fonts/`).
 */

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
