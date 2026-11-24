/* eslint-disable @next/next/no-img-element -- the card is drawn by next/og, where <img> is the only picture there is. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';

import { BRAND } from '@/city/lib/brand';
import { SITE_ORIGIN } from '@/lib/product/app-address';
import { CARD_FRAME, FRAME_SHA, SHARE_CARD_SIZE, SHARE_WINDOW, framePath, type ShareCardId, type ShareLang } from './cards';
import { SHARE_WORDS } from './words';

/**
 * The terminal's share card, 1200×630 (decision 105): a real frame of the section — a window of the terminal in the
 * card's bottom right corner, its foot fading into the night — and on the left the mark, the section's name, its line and
 * the address as the one amber action. The colours and the form are the terminal's (`docs/terminal/DESIGN.md`: the
 * night's ink, the violet edge, lilac for the second half of the line, amber only on the action, square panels, a 4 px
 * control with its one cut corner); the words are Geist, the mark's RYNTRA is Hubot Sans. The coin's and the pool's cards
 * (`coin.server.tsx`, `pool.server.tsx`) draw with the same pieces.
 */

/** The terminal's colours, as `docs/terminal/DESIGN.md` names them. */
export const INK = {
  ground: '#07060d',
  ink: '#0b0a14',
  panel: '#110e1e',
  violet: '#9945ff',
  lilac: '#c9a2ff',
  amber: '#ffb23f',
  amberHi: '#ffd38a',
  onAmber: '#1a1205',
  mint: '#14f195',
  flare: '#ff4b3a',
  ice: '#eef1ff',
  soft: '#b8b9c9',
  dim: '#9899a6',
  edge: 'rgba(153, 69, 255, 0.34)',
  paneEdge: 'rgba(153, 69, 255, 0.24)',
  glassEdge: 'rgba(238, 241, 255, 0.09)',
  glass: 'linear-gradient(180deg, rgba(30, 24, 52, 0.72), rgba(14, 11, 26, 0.82))',
} as const;

/**
 * The form's corners for a picture drawn by next/og, where a style attribute is the only style there is (decision 106):
 * 4 px on what is pressed — the card's one action — and a circle for a coin's logo or a status dot. Nothing else rounds.
 */
export const CONTROL_CORNER = 4;
export const circle = (size: number): number => size / 2;

export type CardFont = { name: string; data: ArrayBuffer; weight: 500 | 700 | 900; style: 'normal' };
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
 * The terminal's faces, kept for the life of the instance: Geist for every word and figure (Latin and Cyrillic, and the
 * plain zero the owner asked for), Hubot Sans for the mark's RYNTRA. Without them the card still draws in the engine's
 * own face, and is kept a minute only.
 */
export function cardFonts(): Promise<CardFont[] | null> {
  fonts ??= Promise.all([
    googleFace('Geist:wght@500').then((data): CardFont => ({ name: 'Geist', data, weight: 500, style: 'normal' })),
    googleFace('Geist:wght@700').then((data): CardFont => ({ name: 'Geist', data, weight: 700, style: 'normal' })),
    googleFace('Hubot+Sans:wdth,wght@125,900').then((data): CardFont => ({ name: 'Hubot Sans', data, weight: 900, style: 'normal' })),
  ]).catch(() => {
    fonts = null;
    return null;
  });
  return fonts;
}

/** The mark of the terminal's header (`city/components/hud/Mark.tsx`), with the spire's sheen, as one SVG for a card. */
export function markUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="0.65" stop-color="#C9A2FF"/><stop offset="1" stop-color="#FFE7C2"/></linearGradient><linearGradient id="s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFB23F"/><stop offset="1" stop-color="#FFF6E6"/></linearGradient></defs><circle cx="32" cy="34" r="19" fill="none" stroke="url(#r)" stroke-width="4.2"/><circle cx="32" cy="34" r="16.6" fill="#0B0A14"/><path d="M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z" fill="url(#s)"/><path d="M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z" fill="#FFFFFF" opacity="0.35"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const frames = new Map<string, Promise<string | null>>();
const FRAME_MS = 4_000;

/**
 * A section's frame (`public/terminal/share/<frame>.jpg`), read once per instance. On Vercel the function bundle does not
 * carry `public/`, so the file read fails there (the «black preview» of 05.11) and the frame is fetched from the site
 * itself, where `public/` is served — at an address carrying its fingerprint, so an edge's older copy is never taken. A
 * miss is not kept, so the next card asks again.
 */
export function frameUri(frame: string): Promise<string | null> {
  const kept = frames.get(frame);
  if (kept) return kept;
  const path = framePath(frame);
  const read = readFile(join(process.cwd(), 'public', ...path.split('/').filter(Boolean)))
    .catch(() =>
      fetch(`${SITE_ORIGIN}${path}?v=${FRAME_SHA[frame] ?? ''}`, { signal: AbortSignal.timeout(FRAME_MS) }).then((r) =>
        r.ok ? r.arrayBuffer().then((b) => Buffer.from(b)) : Promise.reject(new Error(String(r.status))),
      ),
    )
    .then((bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`)
    .catch(() => {
      frames.delete(frame);
      return null;
    });
  frames.set(frame, read);
  return read;
}

/**
 * How long a card is kept: a day in a browser and a week at the edge once drawn in its own faces (its address changes
 * with it), a coin's five minutes; a minute when it fell back.
 */
export function cardHeaders(drawn: boolean, seconds = 86_400, edge = seconds * 7): Record<string, string> {
  return { 'cache-control': drawn ? `public, max-age=${seconds}, s-maxage=${edge}, stale-while-revalidate=${seconds * 4}` : 'public, max-age=60, s-maxage=60' };
}

/** The mark and RYNTRA, the top left of every card; `tag` beside them in the dim colour. */
export function Brand({ tag }: { tag?: string }): ReactNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <img src={markUri()} alt="" width={44} height={44} />
      <div style={{ display: 'flex', marginLeft: 14, fontFamily: 'Hubot Sans', fontWeight: 900, fontSize: 26, letterSpacing: 3, color: INK.ice }}>{BRAND.name.toUpperCase()}</div>
      {tag ? <div style={{ display: 'flex', marginLeft: 18, paddingLeft: 18, borderLeft: `1px solid ${INK.glassEdge}`, fontSize: 16, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: INK.dim }}>{tag}</div> : null}
    </div>
  );
}

/** The one amber action of a card: the address, on the terminal's action — 4 px corners, the bottom right one cut. */
export function ActionChip({ children }: { children: ReactNode }): ReactNode {
  return (
    <div style={{ display: 'flex', position: 'relative', alignItems: 'center', height: 54, padding: '0 26px', borderRadius: CONTROL_CORNER, background: `linear-gradient(180deg, ${INK.amberHi}, ${INK.amber})`, color: INK.onAmber, fontSize: 22, fontWeight: 700, letterSpacing: 0.2 }}>
      {children}
      <div style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, display: 'flex', background: `linear-gradient(135deg, rgba(0,0,0,0) 50%, ${INK.ground} 50%)` }} />
    </div>
  );
}

/** The night behind every card: the ground, a violet haze high on the right, a warm one low on the left. */
export function Night(): ReactNode {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex', background: 'radial-gradient(circle at 92% 6%, rgba(153,69,255,0.34) 0%, rgba(42,22,64,0.32) 30%, rgba(7,6,13,0) 62%)' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex', background: 'radial-gradient(circle at 4% 100%, rgba(255,178,63,0.10) 0%, rgba(7,6,13,0) 42%)' }} />
    </>
  );
}

/** The page of a card, its night and its faces. */
export function cardPage(body: ReactNode, faces: CardFont[] | null, headers: Record<string, string>): ImageResponse {
  return new ImageResponse(
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: INK.ground, color: INK.ice, fontFamily: faces ? 'Geist' : 'sans-serif' }}>
      <Night />
      {body}
    </div>,
    { ...SHARE_CARD_SIZE, fonts: faces ?? undefined, headers },
  );
}

/** The path a card names under the action, the domain alone for home. */
function addressOf(id: ShareCardId): string {
  const path: Partial<Record<ShareCardId, string>> = { swap: '/swap', launch: '/launch', earn: '/earn', bots: '/bots', agents: '/agent', portfolio: '/portfolio', pool: '/earn', docs: '/docs', help: '/support' };
  return `${BRAND.domain}${path[id] ?? ''}`;
}

/** The left column's width for the line, px. */
const LINE_WIDTH = 400;
/** Geist Bold's mean advance, in em, with room for capitals. */
const ADVANCE = 0.57;

/** How many rows a part takes at a size, wrapped by words as the engine wraps them. */
function rows(part: string, size: number): number {
  const room = LINE_WIDTH / (size * ADVANCE);
  let count = 1;
  let used = 0;
  for (const word of part.split(' ')) {
    const need = used ? used + 1 + word.length : word.length;
    if (need > room && used) {
      count += 1;
      used = word.length;
    } else used = need;
  }
  return count;
}

/**
 * The line's size: the largest at which a short part (one or two words) keeps to one row and a longer one to two — so a
 * row never ends on a lone word of a short phrase («One / signature.»).
 */
export function lineSize(lead: string, accent: string): number {
  const fits = (size: number) => [lead, accent].every((part) => rows(part, size) <= (part.split(' ').length >= 3 ? 2 : 1));
  return [56, 52, 48, 44, 40].find(fits) ?? 36;
}

export type SectionCardInput = Readonly<{ id: ShareCardId; lang?: ShareLang }>;

/** A section's card: its frame of the terminal, the mark, its name, its line and its address. */
export async function sectionCard({ id, lang = 'en' }: SectionCardInput): Promise<ImageResponse> {
  const [faces, frame] = await Promise.all([cardFonts(), frameUri(CARD_FRAME[id])]);
  const w = SHARE_WORDS[id][lang];
  const size = lineSize(w.lead, w.accent);
  const win = SHARE_WINDOW;
  const body = (
    <>
      {/* The window of the terminal: square, its violet edge on the two sides the card shows, a glow behind it. */}
      <div style={{ position: 'absolute', left: win.left, top: win.top, width: win.width, height: win.height, display: 'flex', background: INK.ink, borderTop: `1px solid ${INK.edge}`, borderLeft: `1px solid ${INK.edge}`, boxShadow: '0 0 90px rgba(153,69,255,0.28)' }}>
        {frame ? <img src={frame} alt="" width={win.width} height={win.height} style={{ position: 'absolute', left: 0, top: 0, width: win.width, height: win.height }} /> : null}
        <div style={{ position: 'absolute', left: 0, top: 0, width: win.width, height: win.height, display: 'flex', background: `linear-gradient(180deg, rgba(7,6,13,0) 0%, rgba(7,6,13,0) 48%, rgba(7,6,13,0.78) 82%, ${INK.ground} 100%)` }} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: 140, height: win.height, display: 'flex', background: 'linear-gradient(90deg, rgba(7,6,13,0.55) 0%, rgba(7,6,13,0) 100%)' }} />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: 470, height: '100%', padding: '54px 0 54px 64px' }}>
        <Brand />
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 17, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: INK.lilac }}>
            <div style={{ display: 'flex', width: 22, height: 2, background: INK.violet, marginRight: 12 }} />
            {w.kick}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22, width: LINE_WIDTH, fontSize: size, fontWeight: 700, lineHeight: 1.08, letterSpacing: -0.8 }}>
            <div style={{ display: 'flex', color: INK.ice }}>{w.lead}</div>
            <div style={{ display: 'flex', color: INK.lilac }}>{w.accent}</div>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 40 }}>
          <ActionChip>{addressOf(id)}</ActionChip>
        </div>
      </div>
    </>
  );
  return cardPage(body, faces, cardHeaders(Boolean(faces && frame)));
}
