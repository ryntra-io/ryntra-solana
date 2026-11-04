import manifest from './films.json' with { type: 'json' };

/**
 * Where «How it works» takes its lessons from (CITY-43). The lessons are made by the video factory (`apps/video`,
 * CITY-61; the lessons themselves are CITY-42) and placed in `public/city/how/` by
 * `node scripts/city/how-films.mjs <guide> <lesson out folder>`, which writes their entry in `films.json`. Every file
 * is served from our own domain — no player and no host of anyone else's. A function without its film has no card:
 * a lesson appears when its film is here, never an empty place or a «soon». No React here: the tests run it in Node.
 */

export const HOW_DIR = '/city/how';

/** One lesson as the page plays it: MP4 (H.264, what the factory finishes), WebM first where there is one, captions. */
export type GuideFilm = Readonly<{
  mp4: string;
  webm?: string;
  /** The lesson's own cover (the factory's, as WebP): the card shows it until the person taps play. */
  poster: string;
  /** WebVTT, the browser's own captions: English and Ukrainian, as the factory writes them. */
  captions?: Readonly<{ en?: string; uk?: string }>;
  /** The lesson's length in seconds, for the card's quiet chip. */
  seconds?: number;
}>;

/** The films by function name, as the manifest gives them; a name the page does not know is simply never shown. */
export type Films = Readonly<Record<string, GuideFilm>>;

/** A path on our own domain, inside the films' folder: anything else is not played. */
export function ownPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(`${HOW_DIR}/`) && !path.includes('..') && !path.includes('//') && !/[?#\\\s]/.test(path);
}

/**
 * A manifest entry the page may play: an MP4 and its cover, every file ours. A bad one is dropped whole, never
 * half-played; one without its cover is dropped too — the card never stands black or grey.
 */
export function readFilm(entry: unknown): GuideFilm | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (!ownPath(e.mp4) || !ownPath(e.poster)) return null;
  if (e.webm !== undefined && !ownPath(e.webm)) return null;
  let captions: { en?: string; uk?: string } | undefined;
  if (e.captions !== undefined) {
    if (!e.captions || typeof e.captions !== 'object') return null;
    const c = e.captions as Record<string, unknown>;
    for (const lang of ['en', 'uk'] as const) {
      if (c[lang] === undefined) continue;
      if (!ownPath(c[lang])) return null;
      captions = { ...captions, [lang]: c[lang] };
    }
  }
  const seconds = typeof e.seconds === 'number' && Number.isFinite(e.seconds) && e.seconds > 0 ? Math.round(e.seconds) : undefined;
  return {
    mp4: e.mp4,
    poster: e.poster,
    ...(typeof e.webm === 'string' ? { webm: e.webm } : {}),
    ...(captions ? { captions } : {}),
    ...(seconds ? { seconds } : {}),
  };
}

/** The films of a manifest by function; an entry that is not ours whole is left out. */
export function readFilms(raw: unknown): Films {
  const films = raw && typeof raw === 'object' ? (raw as { films?: unknown }).films : null;
  const out: Record<string, GuideFilm> = {};
  if (!films || typeof films !== 'object') return out;
  for (const [id, entry] of Object.entries(films as Record<string, unknown>)) {
    const film = readFilm(entry);
    if (film) out[id] = film;
  }
  return out;
}

/** This build's lessons: what `films.json` names and `public/city/how/` holds. */
export const FILMS: Films = readFilms(manifest);

/** Seconds as the card's chip says them: 0:45, 1:30. */
export function length(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
