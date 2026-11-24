/* eslint-disable @next/next/no-img-element -- the card is drawn by next/og, where <img> is the only picture there is. */
import type { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';

import type { CoinCard } from '@/city/lib/coin/read.server';
import { getGuardRuntime } from '@/lib/guard/runtime';
import { readLaunchImage } from '@/lib/launch/metadata.server';
import { topTradedRank } from '@/lib/spot/markets.server';
import { changeText, changeTone, priceText, usdText } from '@/terminal/ui/figures';
import { ActionChip, Brand, INK, cardFonts, cardHeaders, cardPage, circle, sectionCard } from './card.server';
import { SHARE_CARD_SIZE, topChip } from './cards';
import { coinLogoUri, pictureUri, type FetchLike } from './logo.server';
import { CARD_UI } from './words';

const W = CARD_UI.en;

/**
 * A coin's share card, 1200×630, in the terminal's language (`card.server.tsx`): the coin's own logo (the terminal's chain
 * of logo addresses, `logo.server.ts` — the letter only when no address brings one), `$SYMBOL` and its name, what is true
 * of it — a Ryntra launch, Jupiter's verification, its place among the day's most traded when it is among the first
 * hundred — and its price, the day's move, its capitalisation and the day's volume as the engine read them. A figure not
 * read is «—», never a guess. No frame of the terminal behind it: another coin's chart would read as this coin's.
 */

export const COIN_OG_SIZE = SHARE_CARD_SIZE;
/** How long a card is kept: about as long as its price stays worth showing. */
export const COIN_OG_SECONDS = 300;

/** What the card says of the coin, in order: a Ryntra launch, its place by volume, Jupiter's word. */
export function coinChips(coin: CoinCard, rank: number | null): ReadonlyArray<Readonly<{ text: string; tone: 'lilac' | 'mint' | 'soft' }>> {
  const chips: { text: string; tone: 'lilac' | 'mint' | 'soft' }[] = [];
  if (coin.launch) chips.push({ text: W.launch, tone: 'lilac' });
  const top = topChip(rank);
  if (top) chips.push({ text: top, tone: 'lilac' });
  if (!coin.launch) chips.push(coin.verified ? { text: W.verified, tone: 'mint' } : { text: W.notVerified, tone: 'soft' });
  return chips;
}

async function launchPicture(sha: string): Promise<string | null> {
  const stored = await readLaunchImage(getGuardRuntime().store, sha).catch(() => null);
  return stored ? pictureUri(new Uint8Array(Buffer.from(stored.base64, 'base64'))) : null;
}

/** The coin's picture: a Ryntra launch's own from the store, else the terminal's chain of logo addresses. */
async function picture(coin: CoinCard, get: FetchLike): Promise<string | null> {
  if (coin.launchImage) {
    const own = await launchPicture(coin.launchImage);
    if (own) return own;
  }
  return coinLogoUri(coin.mint, coin.remoteIcon, get);
}

function symbolSize(symbol: string): number {
  const n = symbol.length;
  return n <= 5 ? 104 : n <= 7 ? 88 : n <= 9 ? 72 : n <= 12 ? 58 : 46;
}

/** A disc for the logo — a circle, as the terminal draws every coin — or the letter on the night's ink. */
export function Logo({ src, letter, size }: { src: string | null; letter: string; size: number }): ReactNode {
  return (
    <div style={{ display: 'flex', width: size, height: size, borderRadius: circle(size), padding: 3, background: `linear-gradient(135deg, ${INK.violet}, ${INK.lilac})`, flexShrink: 0 }}>
      {src ? (
        <img src={src} alt="" width={size - 6} height={size - 6} style={{ width: size - 6, height: size - 6, borderRadius: circle(size - 6), objectFit: 'cover', background: INK.ink }} />
      ) : (
        <div style={{ display: 'flex', width: size - 6, height: size - 6, borderRadius: circle(size - 6), background: INK.ink, alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: Math.round(size * 0.42), color: INK.lilac }}>{letter}</div>
      )}
    </div>
  );
}

/** A figure's size by its length, so the longest price still fits its tile. */
function figureSize(value: string): number {
  const n = value.length;
  return n <= 8 ? 42 : n <= 10 ? 36 : n <= 12 ? 30 : 26;
}

/** One figure of the panel: its name above, the number below; «—» when the engine did not read it. */
export function Figure({ kick, value, tone, first, top }: { kick: string; value: string | null; tone?: string; first?: boolean; top?: boolean }): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 242, height: 168, padding: '0 28px', borderLeft: first ? 'none' : `1px solid ${INK.glassEdge}`, borderTop: top ? 'none' : `1px solid ${INK.glassEdge}` }}>
      <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, letterSpacing: 2.4, textTransform: 'uppercase', color: INK.dim }}>{kick}</div>
      <div style={{ display: 'flex', marginTop: 12, fontSize: value ? figureSize(value) : 42, fontWeight: 700, letterSpacing: -0.5, color: value ? (tone ?? INK.ice) : INK.dim }}>{value ?? '—'}</div>
    </div>
  );
}

export function Chip({ text, tone }: { text: string; tone: 'lilac' | 'mint' | 'soft' }): ReactNode {
  const colour = tone === 'mint' ? INK.mint : tone === 'lilac' ? INK.lilac : INK.soft;
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 14px', marginRight: 10, border: `1px solid ${INK.glassEdge}`, background: 'rgba(17,14,30,0.7)', fontSize: 18, fontWeight: 700, letterSpacing: 0.3, color: INK.soft }}>
      <div style={{ display: 'flex', width: 8, height: 8, borderRadius: circle(8), background: colour, marginRight: 10 }} />
      {text}
    </div>
  );
}

export type CoinCardDeps = Readonly<{ fetch?: FetchLike; rank?: (mint: string) => Promise<number | null> }>;

/** The card of a coin; home's card when the engine knows no such coin — never a card of empty figures. */
export async function coinOpenGraph(coin: CoinCard | null, deps: CoinCardDeps = {}): Promise<ImageResponse> {
  if (!coin) return sectionCard({ id: 'home' });
  const get = deps.fetch ?? fetch;
  const rankOf = deps.rank ?? topTradedRank;
  const [faces, pic, rank] = await Promise.all([cardFonts(), picture(coin, get).catch(() => null), rankOf(coin.mint).catch(() => null)]);
  const bare = coin.symbol.replace(/^\$+/u, '').slice(0, 14);
  /* The ticker as the coin writes it — «$TSLAx», never «$TSLAX». */
  const symbol = `$${bare}`;
  const tone = coin.change24h != null ? changeTone(coin.change24h) : undefined;
  const body = (
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', padding: '54px 64px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 560, height: '100%' }}>
        <Brand tag={W.network} />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 64 }}>
          <Logo src={pic} letter={bare.slice(0, 1).toUpperCase()} size={116} />
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 28, minWidth: 0 }}>
            <div style={{ display: 'flex', fontSize: symbolSize(symbol), fontWeight: 700, lineHeight: 1, letterSpacing: -1.5, color: INK.ice }}>{symbol}</div>
            <div style={{ display: 'flex', marginTop: 10, fontSize: 28, fontWeight: 500, color: INK.soft, maxWidth: 400 }}>{coin.name.slice(0, 32)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 34 }}>{coinChips(coin, rank).map((chip) => <Chip key={chip.text} {...chip} />)}</div>
        <div style={{ display: 'flex', marginTop: 'auto' }}>
          <ActionChip>{W.trade(symbol)}</ActionChip>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 'auto', marginTop: 76 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', width: 486, background: INK.glass, border: `1px solid ${INK.paneEdge}`, boxShadow: '0 0 90px rgba(153,69,255,0.22)' }}>
          <Figure kick={W.price} value={coin.price != null ? priceText(coin.price, 'en') : null} first top />
          <Figure kick={W.change} value={coin.change24h != null ? changeText(coin.change24h, 'en') : null} tone={tone === 'up' ? INK.mint : tone === 'down' ? INK.flare : INK.ice} top />
          <Figure kick={W.marketCap} value={coin.marketCapUsd != null ? usdText(coin.marketCapUsd, 'en') : null} first />
          <Figure kick={W.volume} value={coin.volume24hUsd != null ? usdText(coin.volume24hUsd, 'en') : null} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', fontSize: 16, fontWeight: 500, color: INK.dim }}>{W.coinData}</div>
      </div>
    </div>
  );
  return cardPage(body, faces, cardHeaders(Boolean(faces), COIN_OG_SECONDS, COIN_OG_SECONDS));
}
