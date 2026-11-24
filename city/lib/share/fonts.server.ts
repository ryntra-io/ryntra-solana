/**
 * The faces of the cards that keep the city's type — the closed trade's card (`lib/agent-drive/card-art.server.tsx`):
 * Hubot Sans for the big words, Mona Sans for the sentences, Geist under them for Cyrillic, fetched from Google once per
 * instance. The site's share cards draw in the terminal's own faces (`terminal/share/card.server.tsx`), and the mark is
 * theirs.
 */
export { markUri } from '@/terminal/share/card.server';

export type CityCardFont = { name: string; data: ArrayBuffer; weight: 600 | 800 | 900; style: 'normal' };
const FONT_MS = 4_000;
let fonts: Promise<CityCardFont[] | null> | null = null;

async function googleFace(query: string): Promise<ArrayBuffer> {
  /* Asked without a browser's agent, Google answers with TrueType, which the engine reads (it cannot read woff2). */
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  const src = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!src) throw new Error('no truetype face');
  return fetch(src, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
}

/** The city's faces, kept for the life of the instance; without them a card still draws in the engine's own face. */
export function cityFonts(): Promise<CityCardFont[] | null> {
  fonts ??= Promise.all([
    googleFace('Hubot+Sans:wdth,wght@125,900').then((data): CityCardFont => ({ name: 'Hubot Sans', data, weight: 900, style: 'normal' })),
    googleFace('Mona+Sans:wght@600').then((data): CityCardFont => ({ name: 'Mona Sans', data, weight: 600, style: 'normal' })),
    googleFace('Mona+Sans:wght@800').then((data): CityCardFont => ({ name: 'Mona Sans', data, weight: 800, style: 'normal' })),
  ])
    .then(async (faces) => {
      const cyrillic = await googleFace('Geist:wght@800')
        .then((data): CityCardFont => ({ name: 'Geist', data, weight: 800, style: 'normal' }))
        .catch(() => null);
      return cyrillic ? [...faces, cyrillic] : faces;
    })
    .catch(() => {
      fonts = null;
      return null;
    });
  return fonts;
}
