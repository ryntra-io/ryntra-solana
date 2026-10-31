/**
 * The city's own answer where there is no page (CITY-159): an address that never was (404) and a page that broke while
 * it was being drawn (500). Pure data, no React: the walk (`scripts/city/old-addresses.mjs`) and the tests read it as
 * it is, and the page is `city/components/open/Lost.tsx`.
 */

import { districtFrame, type Frame } from '../art/frames.ts';

/** What went wrong: nothing stands at the address, or the page broke. */
export const LOST_KINDS = ['missing', 'broken'] as const;
export type LostKind = (typeof LOST_KINDS)[number];

/** The attribute the page carries, with its kind as the value: how the walk and the tests know it is the city's. */
export const LOST_MARK = 'data-city-lost';

/** The status code each kind is, shown as the page's one big figure. */
export const LOST_CODE: Readonly<Record<LostKind, string>> = { missing: '404', broken: '500' };

/** The one way out: the city's home, a full load, so a page that broke starts again clean. */
export const LOST_HOME = '/';

/**
 * The frame behind the words: the whole island seen from the water under the eclipse, filmed from our own live 3D city
 * (`city/lib/art/frames.ts`) — never a generated city.
 */
export const LOST_FRAME: Frame = districtFrame('market');

/**
 * The width the frame is drawn at, for `sizes`: it covers the screen, so a tall screen draws it at the screen's height
 * times the frame's shape (a 390 × 844 phone draws the 16:9 frame 1 500 px wide), and the browser picks the wide file.
 */
export const LOST_SIZES = `max(100vw, ${Math.round(LOST_FRAME.ratio * 100)}vh)`;
