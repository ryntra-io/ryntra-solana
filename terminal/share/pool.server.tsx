import type { ImageResponse } from 'next/og';

import { readEarnPools } from '@/lib/earn-pools/service.server';
import { earnProGate } from '@/lib/earn-pro/gate';
import { readProPool } from '@/lib/pro-pools/read.server';
import { readSpotMarket } from '@/lib/spot/markets.server';
import { priceText, usdText } from '@/terminal/ui/figures';
import { ActionChip, Brand, INK, cardFonts, cardHeaders, cardPage, sectionCard } from './card.server';
import { Chip, Figure, Logo } from './coin.server';
import { coinLogoUri, type FetchLike } from './logo.server';
import { CARD_UI } from './words';

const W = CARD_UI.en;

/**
 * A Meteora pool's share card, 1200×630 (`/og/pool/<address>`): its two coins' logos (the terminal's chain of logo
 * addresses), the pair, the venue, and what the engine read of it — liquidity, the day's volume and fees, the fee a swap
 * pays now; a DLMM Pro pool, which nobody keeps a day of, its price instead. A pool the engine does not know draws the
 * pool section's card, never empty figures.
 */

export const POOL_OG_SECONDS = 300;
const READ_MS = 4_000;

export type PoolCardFacts = Readonly<{
  venue: 'Meteora DLMM' | 'Meteora DAMM v2' | 'Meteora DLMM Pro';
  x: Readonly<{ mint: string; symbol: string }>;
  y: Readonly<{ mint: string; symbol: string }>;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  feePct: number | null;
  /** Token Y per token X, in whole coins; DLMM Pro's only. */
  price: number | null;
}>;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** What the engine knows of a pool: Meteora's catalogue (DLMM, DAMM v2), else DLMM Pro's own account; null for neither. */
export async function readPoolFacts(address: string): Promise<PoolCardFacts | null> {
  const catalog = await within(readEarnPools(), READ_MS);
  const pool = catalog?.pools.find((one) => one.address === address) ?? null;
  if (pool) {
    return {
      venue: pool.kind === 'dlmm' ? 'Meteora DLMM' : 'Meteora DAMM v2',
      x: { mint: pool.x.mint, symbol: pool.x.symbol },
      y: { mint: pool.y.mint, symbol: pool.y.symbol },
      tvlUsd: pool.tvlUsd,
      volume24hUsd: pool.volume24hUsd,
      fees24hUsd: pool.fees24hUsd,
      feePct: pool.feePct,
      price: null,
    };
  }
  const gate = earnProGate(process.env);
  if (!gate.open) return null;
  const row = await within(readProPool(gate.network, address), READ_MS);
  if (!row) return null;
  const name = (coin: typeof row.x) => coin.symbol ?? coin.mint.slice(0, 4);
  return { venue: 'Meteora DLMM Pro', x: { mint: row.x.mint, symbol: name(row.x) }, y: { mint: row.y.mint, symbol: name(row.y) }, tvlUsd: row.tvlUsd, volume24hUsd: null, fees24hUsd: null, feePct: row.fee.totalBps / 100, price: row.price };
}

/** A coin's catalogue picture address, for the logo chain; null when the market did not answer. */
async function iconOf(mint: string): Promise<string | null> {
  const read = await within(readSpotMarket(mint), READ_MS);
  return read && read.ok && read.market?.icon?.startsWith('https://') ? read.market.icon : null;
}

export type PoolCardDeps = Readonly<{ fetch?: FetchLike; icon?: (mint: string) => Promise<string | null> }>;

/** The card of a pool; the pool section's card when the engine does not know it. */
export async function poolOpenGraph(facts: PoolCardFacts | null, deps: PoolCardDeps = {}): Promise<ImageResponse> {
  if (!facts) return sectionCard({ id: 'pool' });
  const get = deps.fetch ?? fetch;
  const icon = deps.icon ?? iconOf;
  const logo = async (mint: string) => coinLogoUri(mint, await icon(mint).catch(() => null), get).catch(() => null);
  const [faces, xPic, yPic] = await Promise.all([cardFonts(), logo(facts.x.mint), logo(facts.y.mint)]);
  const pair = `${facts.x.symbol} / ${facts.y.symbol}`;
  const pairSize = pair.length <= 11 ? 84 : pair.length <= 15 ? 68 : 54;
  const fee = facts.feePct != null ? `${Number(facts.feePct.toFixed(4))}%` : null;
  const pro = facts.venue === 'Meteora DLMM Pro';
  const body = (
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', padding: '54px 64px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 580, height: '100%' }}>
        <Brand tag={W.network} />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 64 }}>
          <Logo src={xPic} letter={facts.x.symbol.slice(0, 1).toUpperCase()} size={96} />
          <div style={{ display: 'flex', marginLeft: -26 }}>
            <Logo src={yPic} letter={facts.y.symbol.slice(0, 1).toUpperCase()} size={96} />
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 26, fontSize: pairSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1.5, color: INK.ice }}>{pair}</div>
        <div style={{ display: 'flex', marginTop: 26 }}>
          <Chip text={facts.venue} tone="lilac" />
          {fee ? <Chip text={W.fee(fee)} tone="soft" /> : null}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto' }}>
          <ActionChip>{W.openPool}</ActionChip>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 'auto', marginTop: 76 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', width: 486, background: INK.glass, border: `1px solid ${INK.paneEdge}`, boxShadow: '0 0 90px rgba(153,69,255,0.22)' }}>
          {pro ? (
            <Figure kick={W.price} value={facts.price != null ? priceText(facts.price, 'en').replace(/^\$/, '') + ` ${facts.y.symbol}` : null} first top />
          ) : (
            <Figure kick={W.volume} value={facts.volume24hUsd != null ? usdText(facts.volume24hUsd, 'en') : null} first top />
          )}
          <Figure kick={W.liquidity} value={facts.tvlUsd != null ? usdText(facts.tvlUsd, 'en') : null} top />
          <Figure kick={W.fees} value={facts.fees24hUsd != null ? usdText(facts.fees24hUsd, 'en') : null} first />
          <Figure kick={W.swapFee} value={fee} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', fontSize: 16, fontWeight: 500, color: INK.dim }}>{W.poolData}</div>
      </div>
    </div>
  );
  return cardPage(body, faces, cardHeaders(Boolean(faces), POOL_OG_SECONDS, POOL_OG_SECONDS));
}
