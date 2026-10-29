/**
 * The city's still frames (CITY-64). The district cards and «How the city works» show frames filmed from our own live
 * 3D city. The files are
 * `public/city/art/`; this module says which file a screen gets, so the page's `<picture>`, its preloads and the
 * tests read one table. No React and no three.js here: the tests run it in Node.
 */

export const ART_DIR = '/city/art';

/** One file of a frame: its address and its width in pixels. */
export type ArtFile = Readonly<{ src: string; width: number }>;

/** A frame in its widths, narrowest first, with its shape (width ÷ height). */
export type Frame = Readonly<{ files: readonly ArtFile[]; ratio: number }>;

/** The two intro frames: a wide 21:9 still of the island for a desk, a tall 9:16 one for a phone. */
export const INTRO: Readonly<Record<'desk' | 'phone', Frame>> = {
  desk: {
    files: [
      { src: `${ART_DIR}/intro-desk-1440.webp`, width: 1440 },
      { src: `${ART_DIR}/intro-desk-2560.webp`, width: 2560 },
    ],
    ratio: 2560 / 1097,
  },
  phone: { files: [{ src: `${ART_DIR}/intro-phone-1080.webp`, width: 1080 }], ratio: 1080 / 1924 },
};

/** A short film made from a still (`public/city/art/video/`, `docs/city/design/2026-10-28/README.md`): WebM, then MP4. */
export type Film = Readonly<{ webm: string; mp4: string }>;

/**
 * The intro's film: the camera closing in on the island over the water, 8 s at 1920 × 820 — the desk still's shape
 * and its first frame, so only a wide screen plays it and a phone keeps its tall still. It is not a loop: it plays once,
 * and if the city is still loading when it ends, it fades back into the still.
 */
export const INTRO_FILM: Film = { webm: `${ART_DIR}/video/intro-city.webm`, mp4: `${ART_DIR}/video/intro-city.mp4` };

/**
 * A screen as tall as it is wide, or taller, gets the phone frame; a wider one the desk frame. The two queries never
 * both match, so of the two preloads only one fetches, and it is the file the `<picture>` then shows.
 */
export const PHONE_MEDIA = '(max-aspect-ratio: 1/1)';
export const DESK_MEDIA = 'not all and (max-aspect-ratio: 1/1)';

/**
 * The width the frame is drawn at, for `sizes`: it covers the screen, so a screen narrower than the frame's shape
 * draws it at the screen's height × the frame's shape (a 1440 × 900 desk draws the 21:9 still 2 100 px wide).
 */
export function introSizes(kind: 'desk' | 'phone'): string {
  return `max(100vw, ${round(INTRO[kind].ratio * 100)}vh)`;
}

export function srcSet(frame: Frame): string {
  return frame.files.map((f) => `${f.src} ${f.width}w`).join(', ');
}

export type Screen = Readonly<{ width: number; height: number; dpr?: number }>;

/** The frame a screen gets and the file the browser picks from its `srcset` — what the tests hold the page to. */
export function introFrame(screen: Screen): Readonly<{ kind: 'desk' | 'phone'; file: ArtFile }> {
  const kind = screen.width / screen.height <= 1 ? 'phone' : 'desk';
  const frame = INTRO[kind];
  const drawn = Math.max(screen.width, screen.height * frame.ratio) * (screen.dpr ?? 1);
  return { kind, file: pick(frame.files, drawn) };
}

/** The narrowest file at least as wide as it is drawn, or the widest there is: how a browser reads `w` candidates. */
export function pick(files: readonly ArtFile[], drawn: number): ArtFile {
  return files.find((f) => f.width >= drawn) ?? files[files.length - 1]!;
}

/** What the visitor's browser asks for: less motion (`prefers-reduced-motion`), less data (`Save-Data`). */
export type Viewer = Readonly<{ reduced: boolean; saveData: boolean }>;

/** A film plays only for a visitor who asked for neither less motion nor less data; anyone else sees its still. */
export function playsFilm(viewer: Viewer): boolean {
  return !viewer.reduced && !viewer.saveData;
}

/**
 * How the intro moves: a slow push in on the still and its lights flickering, the film over it on a wide screen, then
 * a cross-fade into the live city. With reduced motion it is the still alone and the city replaces it at once — no
 * drift, no flicker, no film; a visitor saving data keeps the CSS motion, which costs no bytes, but not the film.
 */
export type IntroMotion = Readonly<{ drift: boolean; glints: number; fadeMs: number; film: boolean }>;

export const INTRO_FADE_MS = 1100;

export function introMotion(viewer: Viewer, wide: boolean): IntroMotion {
  if (viewer.reduced) return { drift: false, glints: 0, fadeMs: 0, film: false };
  return { drift: true, glints: 2, fadeMs: INTRO_FADE_MS, film: wide && playsFilm(viewer) };
}

/**
 * Whether the live city is on the screen: the scene's first composed frame (`city/lib/city/drawn.ts`), or a scene
 * that says so itself on `window.__skyline` (the graphics line's scene, CITY-56).
 */
export function skylineReady(drawn: boolean, skyline: unknown): boolean {
  return drawn || (typeof skyline === 'object' && skyline !== null && (skyline as { ready?: unknown }).ready === true);
}

/** The districts with a frame of their own, in the order «How the city works» shows them. */
export const DISTRICT_IDS = ['market', 'launch', 'harbor', 'agents', 'vault', 'ring', 'home'] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

/** Every district frame comes 800 wide for phones and cards and 1600 wide for desks, 16:9. */
export const DISTRICT_WIDTHS = [800, 1600] as const;

export function districtFrame(id: DistrictId): Frame {
  return { files: DISTRICT_WIDTHS.map((width) => ({ src: `${ART_DIR}/district-${id}-${width}.webp`, width })), ratio: 1600 / 898 };
}

/**
 * The card above the dock is at most 420 px wide on a wide screen; on a phone it spans the screen less its two
 * 16 px margins.
 */
export const CARD_SIZES = '(min-aspect-ratio: 1/1) 420px, calc(100vw - 32px)';

/**
 * The districts with a film of their own, played once when their plate in «How the city works» comes into view. None
 * for now: the generated films showed a city that is not ours; a film comes back filmed
 * from the live scene.
 */
export const DISTRICT_FILMS: Readonly<Partial<Record<DistrictId, Film>>> = {};

/** The districts with a card above the dock: the Market's hot tower, Home, and the three that open soon. */
export const CARD_DISTRICTS: readonly DistrictId[] = ['market', 'home', 'launch', 'harbor', 'agents'];

/** The share card of `/` (Open Graph and X): 1200 × 630. */
export const OG_CARD = Object.freeze({ src: `${ART_DIR}/og-1200x630.jpg`, width: 1200, height: 630 });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
