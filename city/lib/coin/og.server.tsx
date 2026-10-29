/* eslint-disable @next/next/no-img-element -- the card is drawn by next/og, where <img> is the only picture there is. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { getGuardRuntime } from '@/lib/guard/runtime';
import { readLaunchImage } from '@/lib/launch/metadata.server';
import { BRAND } from '@/city/lib/brand';
import { publicHttps } from '@/city/lib/net';
import { PALETTE } from '@/city/lib/palette';
import type { CoinCard } from './read.server';

/**
 * A coin's own share card, 1200×630: the city at night behind it, the coin's picture, `$SYMBOL`, its name, and its
 * price and 24h move when the engine read them — a figure not read is left out, never drawn as a guess. The mark is the
 * city's (`city/components/hud/Mark.tsx`), the colours the city's palette, the type the city's Hubot Sans.
 */

export const COIN_OG_SIZE = { width: 1200, height: 630 } as const;
/** How long a card is kept: about as long as its price stays worth showing. */
export const COIN_OG_SECONDS = 300;

type Font = { name: string; data: ArrayBuffer; weight: 600 | 800 | 900; style: 'normal' };
const FONT_MS = 4_000;
let fonts: Promise<Font[] | null> | null = null;

async function googleFace(query: string): Promise<ArrayBuffer> {
  /* Asked without a browser's agent, Google answers with TrueType, which the engine reads (it cannot read woff2). */
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  const src = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!src) throw new Error('no truetype face');
  return fetch(src, { signal: AbortSignal.timeout(FONT_MS) }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
}

/** The city's faces, kept for the life of the instance; without them the card still draws in the engine's own face. */
function cityFonts(): Promise<Font[] | null> {
  fonts ??= Promise.all([
    googleFace('Hubot+Sans:wdth,wght@125,900').then((data): Font => ({ name: 'Hubot Sans', data, weight: 900, style: 'normal' })),
    googleFace('Mona+Sans:wght@600').then((data): Font => ({ name: 'Mona Sans', data, weight: 600, style: 'normal' })),
    googleFace('Mona+Sans:wght@800').then((data): Font => ({ name: 'Mona Sans', data, weight: 800, style: 'normal' })),
  ]).catch(() => {
    fonts = null;
    return null;
  });
  return fonts;
}

let backdrop: Promise<string | null> | null = null;

/** The city's own still (`public/city/card.jpg`), the share card of the home. */
function cityBackdrop(): Promise<string | null> {
  backdrop ??= readFile(join(process.cwd(), 'public', 'city', 'card.jpg'))
    .then((bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`)
    .catch(() => null);
  return backdrop;
}

/** PNG, JPEG or GIF by their bytes: the only pictures the engine draws. */
function drawable(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  return null;
}

const MAX_BYTES = 1_000_000;

/** The market's icon, fetched as the icon routes do: https to a public host, at most three checked redirects, under 1 MB. */
async function remotePicture(raw: string): Promise<string | null> {
  let url = publicHttps(raw);
  for (let hop = 0; hop <= 3 && url; hop += 1) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4_000), headers: { accept: 'image/png,image/jpeg,image/gif' } }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      url = location ? publicHttps(new URL(location, url).toString()) : null;
      continue;
    }
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = bytes.byteLength <= MAX_BYTES ? drawable(bytes) : null;
    return type ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null;
  }
  return null;
}

async function launchPicture(sha: string): Promise<string | null> {
  const stored = await readLaunchImage(getGuardRuntime().store, sha).catch(() => null);
  if (!stored) return null;
  const bytes = new Uint8Array(Buffer.from(stored.base64, 'base64'));
  const type = drawable(bytes);
  return type ? `data:${type};base64,${stored.base64}` : null;
}

async function picture(coin: CoinCard | null): Promise<string | null> {
  if (!coin) return null;
  if (coin.launchImage) {
    const own = await launchPicture(coin.launchImage);
    if (own) return own;
  }
  /* Jupiter's logos are drawn for coins it verified and for Ryntra's own launches; another pool keeps the disc. */
  if (coin.remoteIcon && (coin.verified || coin.launch)) return remotePicture(coin.remoteIcon);
  return null;
}

/** The mark of `Mark.tsx`, as one SVG for the card. */
function markUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="0.65" stop-color="#C9A2FF"/><stop offset="1" stop-color="#FFE7C2"/></linearGradient><linearGradient id="s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFB23F"/><stop offset="1" stop-color="#FFF6E6"/></linearGradient></defs><circle cx="32" cy="34" r="19" fill="none" stroke="url(#r)" stroke-width="4.2"/><circle cx="32" cy="34" r="16.6" fill="#0B0A14"/><circle cx="45.6" cy="20.4" r="2.6" fill="#FFF6E6"/><path d="M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z" fill="url(#s)"/><path d="M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z" fill="#FFFFFF" opacity="0.35"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function formatPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p <= 0) return '$0';
  // Small prices keep four significant digits.
  return `$${p.toPrecision(4).replace(/e-?\d+$/, '')}`;
}

function symbolSize(symbol: string): number {
  const n = symbol.length + 1;
  return n <= 5 ? 150 : n <= 7 ? 124 : n <= 9 ? 100 : n <= 12 ? 78 : 60;
}

export async function coinOpenGraph(coin: CoinCard | null): Promise<ImageResponse> {
  const [faces, city, pic] = await Promise.all([cityFonts(), cityBackdrop(), picture(coin).catch(() => null)]);
  const display = faces ? 'Hubot Sans' : 'sans-serif';
  const ui = faces ? 'Mona Sans' : 'sans-serif';
  const symbol = coin ? `$${coin.symbol.toUpperCase().slice(0, 14)}` : BRAND.name.toUpperCase();
  /* A move that rounds to nothing is said flat, in neither colour. */
  const move = coin?.change24h != null ? Number(coin.change24h.toFixed(1)) : null;
  const up = (move ?? 0) >= 0;
  const moveColour = move === 0 ? 'rgba(238,241,255,0.78)' : up ? PALETTE.mint : PALETTE.flare;
  const tag = !coin ? null : coin.launch ? 'Ryntra Launch' : coin.inCity ? 'A tower of the city' : coin.verified ? 'Verified by Jupiter' : 'Not verified by Jupiter';
  const headers = { 'cache-control': faces ? `public, max-age=${COIN_OG_SECONDS}, s-maxage=${COIN_OG_SECONDS}, stale-while-revalidate=${COIN_OG_SECONDS * 4}` : 'public, max-age=60, s-maxage=60' };
  return new ImageResponse(
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: PALETTE.inkDeep, color: PALETTE.ice, fontFamily: ui }}>
      {/* The still's upper part only: its own words stand in its lower left and must not show through this card's. */}
      {city ? <img src={city} alt="" width={1626} height={915} style={{ position: 'absolute', left: 60, top: 0, width: 1626, height: 915 }} /> : null}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex', background: 'linear-gradient(90deg, rgba(6,5,12,0.96) 0%, rgba(6,5,12,0.86) 46%, rgba(6,5,12,0.25) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 220, display: 'flex', background: 'linear-gradient(0deg, rgba(6,5,12,0.92) 0%, rgba(6,5,12,0) 100%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '52px 64px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={markUri()} alt="" width={52} height={52} />
          <div style={{ display: 'flex', marginLeft: 14, fontFamily: display, fontWeight: 900, fontSize: 30, letterSpacing: 3 }}>{BRAND.name.toUpperCase()}</div>
          <div style={{ display: 'flex', marginLeft: 18, fontSize: 20, fontWeight: 600, letterSpacing: 2, color: 'rgba(238,241,255,0.62)' }}>CITY · SOLANA</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto' }}>
          <div style={{ display: 'flex', width: 148, height: 148, borderRadius: 74, padding: 6, background: `linear-gradient(135deg, ${PALETTE.violet}, ${PALETTE.warmWhite})`, flexShrink: 0 }}>
            {pic ? (
              <img src={pic} alt="" width={136} height={136} style={{ width: 136, height: 136, borderRadius: 68, objectFit: 'cover', background: PALETTE.ink }} />
            ) : (
              <div style={{ display: 'flex', width: 136, height: 136, borderRadius: 68, background: PALETTE.ink, alignItems: 'center', justifyContent: 'center', fontFamily: display, fontWeight: 900, fontSize: 60, color: PALETTE.amber }}>
                {coin ? coin.symbol.slice(0, 1).toUpperCase() : 'R'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 34, minWidth: 0 }}>
            <div style={{ display: 'flex', fontFamily: display, fontWeight: 900, fontSize: symbolSize(symbol), lineHeight: 1, letterSpacing: 1 }}>{symbol}</div>
            <div style={{ display: 'flex', marginTop: 10, fontSize: 36, fontWeight: 600, color: 'rgba(238,241,255,0.78)', maxWidth: 820 }}>{coin ? coin.name.slice(0, 48) : BRAND.hook}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 34, minHeight: 64 }}>
          {coin?.price != null ? <div style={{ display: 'flex', fontFamily: display, fontWeight: 900, fontSize: 52 }}>{formatPrice(coin.price)}</div> : null}
          {move != null ? (
            <div style={{ display: 'flex', alignItems: 'baseline', marginLeft: coin?.price != null ? 26 : 0, fontSize: 40, fontWeight: 800, color: moveColour }}>
              {`${move === 0 ? '' : up ? '+' : '−'}${Math.abs(move).toFixed(1)}%`}
              <span style={{ marginLeft: 10, fontSize: 24, letterSpacing: 2, color: 'rgba(238,241,255,0.62)' }}>24H</span>
            </div>
          ) : null}
          {tag ? (
            <div style={{ display: 'flex', marginLeft: coin?.price != null || move != null ? 30 : 0, padding: '8px 16px', fontSize: 20, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', background: 'rgba(153,69,255,0.26)', color: coin?.launch || coin?.inCity ? PALETTE.amber : PALETTE.ice }}>
              {tag}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 800, color: PALETTE.ice }}>
            <div style={{ display: 'flex', width: 40, height: 5, background: PALETTE.amber, marginRight: 16 }} />
            {coin ? `Open $${coin.symbol.toUpperCase().slice(0, 14)} in the city · ${BRAND.domain}` : BRAND.domain}
          </div>
          <div style={{ display: 'flex', fontSize: 17, fontWeight: 600, color: 'rgba(238,241,255,0.5)' }}>Market data: Jupiter · not financial advice</div>
        </div>
      </div>
    </div>,
    { ...COIN_OG_SIZE, fonts: faces ?? undefined, headers },
  );
}
