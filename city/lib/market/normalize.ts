import { cleanName, cleanSymbol } from '../../../lib/world/text-safety/clean.ts';
import { lookalikeOf } from '../../../lib/world/text-safety/lookalike.ts';
import { measured } from '../../../lib/world/text-safety/measured.ts';
import type { District, Tower, TowerFigure } from './types.ts';

/** The part of a Jupiter Tokens API v2 mint record the city reads. */
export type JupiterToken = {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string | null;
  mcap?: number;
  liquidity?: number;
  usdPrice?: number;
  holderCount?: number;
  organicScore?: number;
  isVerified?: boolean;
  tags?: string[];
  firstPool?: { createdAt?: string } | null;
  stats5m?: JupiterStats | null;
  stats1h?: JupiterStats | null;
  stats24h?: JupiterStats | null;
};

type JupiterStats = {
  priceChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numTraders?: number;
};

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Only https icons are drawn; anything else becomes a generated badge. */
function iconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A coin's own words are somebody else's text (CITY-73): hidden and direction characters out, and a ticker that hides
 * a disguised word or an order stands no tower at all. A name that is held gives way to the ticker.
 */
function words(token: JupiterToken): { symbol: string; name: string } | null {
  const symbol = cleanSymbol(token.symbol);
  if (!symbol.ok) return null;
  const name = cleanName(token.name);
  return { symbol: symbol.text, name: name.ok ? name.text : symbol.text };
}

export function toTower(token: JupiterToken, district: District): Tower | null {
  if (typeof token?.id !== 'string' || token.id.length < 32) return null;
  const named = words(token);
  if (!named) return null;
  const { symbol, name } = named;
  const s24 = token.stats24h ?? {};
  /* What Jupiter left out stays zero for the scene and is «Not measured» on a screen. */
  const read: Record<TowerFigure, unknown> = {
    price: token.usdPrice,
    mcap: token.mcap,
    liquidity: token.liquidity,
    holders: token.holderCount,
    change5m: token.stats5m?.priceChange,
    change1h: token.stats1h?.priceChange,
    change24h: s24.priceChange,
    volume24h: measured(s24.buyVolume) === null && measured(s24.sellVolume) === null ? undefined : 0,
    traders1h: token.stats1h?.numTraders,
    organic: token.organicScore,
  };
  const unread = (Object.keys(read) as TowerFigure[]).filter((figure) => measured(read[figure]) === null);
  return {
    id: token.id,
    symbol,
    name,
    icon: iconUrl(token.icon),
    district,
    price: num(token.usdPrice),
    mcap: num(token.mcap),
    liquidity: num(token.liquidity),
    holders: num(token.holderCount),
    change5m: num(token.stats5m?.priceChange),
    change1h: num(token.stats1h?.priceChange),
    change24h: num(s24.priceChange),
    volume24h: num(s24.buyVolume) + num(s24.sellVolume),
    traders1h: num(token.stats1h?.numTraders),
    organic: num(token.organicScore),
    /* A ticker that passes for a known coin it is not is never vouched for: the tower stands without a name. */
    verified: token.isVerified === true && lookalikeOf(symbol, token.id) === null,
    launchedAt: typeof token.firstPool?.createdAt === 'string' ? token.firstPool.createdAt : null,
    ...(unread.length ? { unread } : {}),
  };
}

/**
 * Builds the skyline from the three reads: the curated city (majors, DeFi, memes, stocks),
 * the trending hour and the newest pools. Each mint appears once, in the first district that claims it.
 */
export function buildTowers(
  curated: readonly JupiterToken[],
  districtOf: (id: string) => District | undefined,
  trending: readonly JupiterToken[],
  recent: readonly JupiterToken[],
): Tower[] {
  const seen = new Set<string>();
  const towers: Tower[] = [];
  const add = (token: JupiterToken, district: District) => {
    if (!token || seen.has(token.id)) return;
    const tower = toTower(token, district);
    if (!tower) return;
    seen.add(tower.id);
    towers.push(tower);
  };
  for (const token of curated) {
    const district = districtOf(token.id);
    if (district) add(token, district);
  }
  // Trending tokens join the strip only when the activity looks human; wash-traded spikes stay out of the skyline.
  for (const token of trending) {
    if (num(token.organicScore) >= 30 && num(token.liquidity) >= 50_000) add(token, 'strip');
  }
  // The docks show what launched in the last hours, labelled as unverified on screen.
  for (const token of recent) {
    if (num(token.mcap) >= 5_000 && iconUrl(token.icon)) add(token, 'docks');
  }
  return towers;
}
