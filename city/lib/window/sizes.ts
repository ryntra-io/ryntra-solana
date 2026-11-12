import { areaOf, CITY_SHARE, tallestIn, type Size, type Viewport } from './geometry.ts';

/**
 * A window's first size on this screen (CITY-242, «typical sizes for a large desk»): as tall as its contents ask, up to
 * the workspace between the top bar and the Deck; as wide as it asks — between its narrowest and its widest — as far as
 * the city keeps its share of the screen at that height (helm §4: the windows the system places cover at most 60 %).
 *
 * A fixed size was the same 980 × 640 on a 1440 desk and on a 2560 one: small on the large desk, with the spot form
 * scrolled inside it. Now a large desk gets a larger window, and a 900 px desk one as tall as its workspace.
 */
export function firstSize(viewport: Viewport, widths: Readonly<{ least: number; most: number }>, height: number): Size {
  const area = areaOf(viewport);
  const tall = Math.max(1, Math.min(height, tallestIn(area)));
  // A hair under the city's share, so the cover the frame works out never rounds over it.
  const room = Math.floor((((1 - CITY_SHARE) * 0.995) * viewport.width * viewport.height) / tall);
  const width = Math.max(Math.min(widths.least, area.width), Math.min(widths.most, room, Math.round(area.width * 0.8)));
  return { width, height: tall };
}
