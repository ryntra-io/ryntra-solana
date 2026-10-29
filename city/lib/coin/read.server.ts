import { cache } from 'react';

import { launchViewDeps } from '@/lib/launch/runtime.server';
import { readLaunchView } from '@/lib/launch/view.server';
import { readSpotMarket } from '@/lib/spot/markets.server';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import { sameOriginImage } from '@/city/lib/launch/towers';
import { isMint } from '@/city/lib/search/mint';
import { spotIcon } from '@/city/lib/search/rank';
import type { CoinFacts } from '@/city/lib/search/sources';
import { shownText } from '@/lib/world/text-safety/clean';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';

/**
 * One coin as its link (`/c/<mint>`) and its picture read it on the server: a Ryntra launch's own name and picture
 * from the Launch engine, the market — price and 24h move — from Jupiter through the engine's spot read. Read-only:
 * a launch the store does not know is not adopted from the chain here, and nothing is written. A figure not read is
 * null and the card leaves it out; a coin neither knows is null and its link is just the city.
 */
export type CoinCard = CoinFacts &
  Readonly<{
    /** The remote https address of the market's icon, for the server to fetch; never handed to a browser. */
    remoteIcon: string | null;
    /** The sha256 of a launch's picture in Ryntra's store. */
    launchImage: string | null;
    price: number | null;
    change24h: number | null;
    /** It stands in the city's bundled skyline (the live city may hold more). */
    inCity: boolean;
  }>;

const READ_MS = 4_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function launchOf(mint: string) {
  let deps: ReturnType<typeof launchViewDeps> = null;
  try {
    deps = launchViewDeps();
  } catch {
    return null;
  }
  if (!deps) return null;
  /* Reading only: no adoption from the chain and no partner binding, which write to the store. */
  const reading = { ...deps, adopt: null, bindPartner: undefined };
  return within(readLaunchView(reading, mint), READ_MS);
}

async function marketOf(mint: string) {
  const read = await within(readSpotMarket(mint), READ_MS);
  return read && read.ok ? read.market : null;
}

const finite = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const readCoinCard = cache(async (mint: string): Promise<CoinCard | null> => {
  if (!isMint(mint)) return null;
  const tower = BUNDLED_CITY.towers.find((t) => t.id === mint) ?? null;
  const [launch, market] = await Promise.all([launchOf(mint), marketOf(mint)]);
  const launchImage = launch?.image ? (sameOriginImage(launch.image)?.split('/').pop() ?? null) : null;
  const remoteIcon = market?.icon && market.icon.startsWith('https://') ? market.icon : tower?.verified && tower.icon?.startsWith('https://') ? tower.icon : null;
  /* The coin's own words are somebody else's text (CITY-73): a held ticker names no card; a held name gives way to it. */
  const raw = launch?.symbol ?? market?.symbol ?? (tower?.verified ? tower.symbol : null);
  const symbol = shownText(raw?.replace(/^\$+/, ''), 'symbol', 32);
  if (!symbol) return null;
  const name = shownText(launch?.name ?? market?.name ?? tower?.name, 'name', 128) ?? symbol;
  const icon = launch?.image ? sameOriginImage(launch.image) : tower?.verified && tower.icon ? `/api/icon/${mint}` : spotIcon(mint, market?.icon ?? null);
  return {
    mint,
    symbol,
    name,
    icon,
    launch: launch !== null,
    verified: launch ? false : lookalikeOf(symbol, mint) ? false : (market?.verified ?? tower?.verified ?? null),
    remoteIcon,
    launchImage,
    price: finite(market?.price),
    change24h: finite(market?.change24hPct),
    inCity: tower !== null,
  };
});

/** What the browser is handed to open the coin's trade card without asking again. */
export function factsOf(card: CoinCard): CoinFacts {
  return { mint: card.mint, symbol: card.symbol, name: card.name, icon: card.icon, launch: card.launch, verified: card.verified };
}
