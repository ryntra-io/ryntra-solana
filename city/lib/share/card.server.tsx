/* eslint-disable @next/next/no-img-element -- the card is drawn by next/og, where <img> is the only picture there is. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { SHARE_SCENE } from '@/city/lib/art/frames';
import { BRAND } from '@/city/lib/brand';
import type { Lang } from '@/city/lib/i18n/langs';
import { PALETTE } from '@/city/lib/palette';
import { SITE_ORIGIN } from '@/lib/product/app-address';
import { CITY_CARD_SIZE } from './card';
import type { Words } from '@/city/lib/i18n/dict';
import { CARD_WORDS, type CardLine } from './words';

/**
 * The city's share card, 1200×630 (CITY-158): a frame of our own live city behind (`SHARE_SCENE`), the mark and RYNTRA
 * at the top, and the city's line at the foot, in the page's language. No page's own words: the old pages' titles are
 * the old product's, and the card says only what the city is. The mark is the city's
 * (`city/components/hud/Mark.tsx`), the colours AFTERGLOW, the type Hubot Sans and Mona Sans, with Geist under them for
 * Cyrillic as on the city's screens. The coin's card (`city/lib/coin/og.server.tsx`) draws with the same pieces.
 */

export type CardFont = { name: string; data: ArrayBuffer; weight: 600 | 800 | 900; style: 'normal' };
const FONT_MS = 4_000;
let fonts: Promise<CardFont[] | null> | null = null;

async function googleFace(query: string): Promise<ArrayBuffer> {
  /* Asked without a browser's agent, Google answers with TrueType, which the engine reads (it cannot read woff2). */
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  const src = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!src) throw new Error('no truetype face');
  return fetch(src, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
}

/**
 * The city's faces, kept for the life of the instance; without them the card still draws in the engine's own face.
 * Hubot and Mona have no Cyrillic: Geist carries a Ukrainian letter, and a card without it still draws.
 */
export function cityFonts(): Promise<CardFont[] | null> {
  fonts ??= Promise.all([
    googleFace('Hubot+Sans:wdth,wght@125,900').then((data): CardFont => ({ name: 'Hubot Sans', data, weight: 900, style: 'normal' })),
    googleFace('Mona+Sans:wght@600').then((data): CardFont => ({ name: 'Mona Sans', data, weight: 600, style: 'normal' })),
    googleFace('Mona+Sans:wght@800').then((data): CardFont => ({ name: 'Mona Sans', data, weight: 800, style: 'normal' })),
  ])
    .then(async (faces) => {
      const cyrillic = await googleFace('Geist:wght@800')
        .then((data): CardFont => ({ name: 'Geist', data, weight: 800, style: 'normal' }))
        .catch(() => null);
      return cyrillic ? [...faces, cyrillic] : faces;
    })
    .catch(() => {
      fonts = null;
      return null;
    });
  return fonts;
}

/** The mark of `Mark.tsx`, with the spire's sheen, as one SVG for a card. */
export function markUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="0.65" stop-color="#C9A2FF"/><stop offset="1" stop-color="#FFE7C2"/></linearGradient><linearGradient id="s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFB23F"/><stop offset="1" stop-color="#FFF6E6"/></linearGradient></defs><circle cx="32" cy="34" r="19" fill="none" stroke="url(#r)" stroke-width="4.2"/><circle cx="32" cy="34" r="16.6" fill="#0B0A14"/><path d="M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z" fill="url(#s)"/><path d="M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z" fill="#FFFFFF" opacity="0.35"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

let scene: Promise<string | null> | null = null;
const SCENE_MS = 4_000;

/**
 * The live city's frame (`SHARE_SCENE`), read once per instance. On Vercel the function bundle does not carry
 * `public/`, so the file read fails there and the card was drawn on bare ink: a black preview in every chat. The frame
 * is then fetched from the site itself, where `public/` is served. A miss is not kept, so the next card asks again.
 */
export function sceneUri(): Promise<string | null> {
  scene ??= readFile(join(process.cwd(), 'public', ...SHARE_SCENE.src.split('/').filter(Boolean)))
    .catch(() =>
      fetch(`${SITE_ORIGIN}${SHARE_SCENE.src}`, { signal: AbortSignal.timeout(SCENE_MS) }).then((r) =>
        r.ok ? r.arrayBuffer().then((b) => Buffer.from(b)) : Promise.reject(new Error(String(r.status))),
      ),
    )
    .then((bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`)
    .catch(() => {
      scene = null;
      return null;
    });
  return scene;
}

export type CityCardInput = Readonly<{ lang?: Lang; line?: Words<CardLine> }>;

/**
 * The card. Its address carries `cityCardVersion()`, so the edge keeps it for a long time. A page of the city's own may
 * give its own line (`/launches`, CITY-185) on the same frame of the live city; every other page shows the city's.
 */
export async function cityCard({ lang = 'en', line = CARD_WORDS }: CityCardInput = {}): Promise<ImageResponse> {
  const [faces, city] = await Promise.all([cityFonts(), sceneUri()]);
  const display = faces ? 'Hubot Sans, Geist' : 'sans-serif';
  const ui = faces ? 'Mona Sans, Geist' : 'sans-serif';
  const w = line[lang];
  // The line fits one row of 1072 px at 52 px up to 24 letters; a longer one (the Ukrainian) steps down so it never wraps.
  const lineSize = Math.max(w.lead.length, w.accent.length) > 24 ? 44 : 52;
  const headers = { 'cache-control': faces ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' : 'public, max-age=60, s-maxage=60' };
  return new ImageResponse(
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: PALETTE.inkDeep, color: PALETTE.ice, fontFamily: ui }}>
      {city ? <img src={city} alt="" width={CITY_CARD_SIZE.width} height={CITY_CARD_SIZE.height} style={{ position: 'absolute', left: 0, top: 0, width: CITY_CARD_SIZE.width, height: CITY_CARD_SIZE.height }} /> : null}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex', background: 'linear-gradient(90deg, rgba(6,5,12,0.86) 0%, rgba(6,5,12,0.5) 32%, rgba(6,5,12,0) 56%)' }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 200, display: 'flex', background: 'linear-gradient(0deg, rgba(6,5,12,0.72) 0%, rgba(6,5,12,0) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 140, display: 'flex', background: 'linear-gradient(180deg, rgba(6,5,12,0.6) 0%, rgba(6,5,12,0) 100%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '52px 64px 50px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={markUri()} alt="" width={60} height={60} />
          <div style={{ display: 'flex', marginLeft: 16, fontFamily: display, fontWeight: 900, fontSize: 34, letterSpacing: 3 }}>{BRAND.name.toUpperCase()}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', fontFamily: display, fontWeight: 900, fontSize: lineSize, lineHeight: 1.06, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex' }}>{w.lead}</div>
          <div style={{ display: 'flex', color: PALETTE.amber }}>{w.accent}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 30, fontSize: 26, fontWeight: 800, color: PALETTE.ice }}>
          <div style={{ display: 'flex', width: 44, height: 5, background: PALETTE.amber, marginRight: 16 }} />
          {BRAND.domain}
        </div>
      </div>
    </div>,
    { ...CITY_CARD_SIZE, fonts: faces ?? undefined, headers },
  );
}
