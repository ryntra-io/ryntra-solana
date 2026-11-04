import 'server-only';

import { readPoolCatalog } from '@/lib/liquidity/catalog/service.server';
import type { CatalogPool } from '@/lib/liquidity/catalog/model';
import { readLimitPool } from '@/lib/liquidity/studio/actions.server';
import { readOnchainMintCached } from '@/lib/stocks/asset.server';
import { readXStocksMultiplier } from '@/lib/stocks/issuer-xstocks.server';
import { readStockUniverse, type StockRow } from '@/lib/stocks/universe.server';
import { multiplierFromMint } from '@/lib/stocks/units';
import { SOLANA_MAINNET_USDC_MINT } from '@/lib/solana/send-kinds';
import { mergePending, type LimitMarket } from './limit';
import { checkLimitPool, checkMintFacts, checkStockRow, LIMIT_QUOTES } from './limit-check';
import { SOL_MINT } from './lst';

/**
 * The markets Sell Higher offers (CITY-97): SOL against USDC, and the most traded listed stocks, each on its deepest
 * Meteora DLMM pool against SOL or USDC that takes limit orders — and only where every gate of `limit-check.ts` passes:
 * the stock universe names the mint, the chain shows a mint a limit order is safe with, and the pool is the program's
 * own and takes limit orders now. The live multiplier is the chain's; a new one the issuer has announced for later is
 * taken when it comes sooner than the chain's own schedule. Kept two minutes, built once at a time. Read-only.
 */

/** How many of the most traded stocks are looked at: each costs one of the catalogue's searches, kept two minutes. */
export const LIMIT_STOCKS_LOOKED_AT = 8;
const CANDIDATES_PER_ASSET = 2;
const KEPT_MS = 2 * 60_000;

let kept: Readonly<{ at: number; value: LimitMarketsAnswer }> | null = null;
let building: Promise<LimitMarketsAnswer> | null = null;

export type LimitMarketsAnswer = Readonly<{ markets: readonly LimitMarket[]; at: string }>;

/** The DLMM pools of an asset against a quote, deepest first, as the catalogue lists them. */
function poolsOf(pools: readonly CatalogPool[], asset: string): CatalogPool[] {
  return pools
    .filter((pool) => pool.kind === 'dlmm' && !pool.blacklisted && pool.binStepBps !== null)
    .filter((pool) => {
      const pair = [pool.x.mint, pool.y.mint];
      return pair.includes(asset) && pair.some((mint) => mint !== asset && LIMIT_QUOTES.has(mint));
    })
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
    .slice(0, CANDIDATES_PER_ASSET);
}

async function marketOf(pool: CatalogPool, asset: Readonly<{ mint: string; kind: 'sol' | 'stock'; row: StockRow | null }>, nowMs: number): Promise<LimitMarket | null> {
  const quoteMint = pool.x.mint === asset.mint ? pool.y.mint : pool.x.mint;
  const quote = LIMIT_QUOTES.get(quoteMint);
  if (!quote) return null;
  const chainPool = await readLimitPool(pool.address).catch(() => null);
  const where = checkLimitPool(chainPool, asset.mint, quoteMint);
  if (!where.ok || !chainPool) return reject(asset.mint, where.ok ? 'the pool was not read' : where.reason);
  let multiplier = { current: 1, pending: null as number | null, effectiveAt: null as string | null };
  let name: string | null = null;
  let symbol = 'SOL';
  if (asset.kind === 'stock') {
    const row = asset.row;
    const who = checkStockRow(row, asset.mint);
    if (!who.ok || !row) return reject(asset.mint, who.ok ? 'no row' : who.reason);
    const onchain = await readOnchainMintCached(asset.mint).catch(() => ({ error: 'read' }) as const);
    const facts = 'error' in onchain ? null : onchain;
    const what = checkMintFacts(facts);
    if (!what.ok || !facts) return reject(asset.mint, what.ok ? 'not read' : what.reason);
    const chain = multiplierFromMint(facts, nowMs);
    if (!chain) return reject(asset.mint, 'no multiplier');
    const issuer = row.representation.issuer.id === 'xstocks' ? await readXStocksMultiplier(row.representation.symbol, { timeoutMs: 3_000 }).catch(() => null) : null;
    multiplier = mergePending(chain, issuer && issuer.ok ? issuer : null, nowMs);
    name = row.representation.underlying.name ?? row.representation.name;
    symbol = row.representation.symbol;
  }
  const assetToken = chainPool.tokenX.mint === asset.mint ? chainPool.tokenX : chainPool.tokenY;
  const catalogAsset = pool.x.mint === asset.mint ? pool.x : pool.y;
  const catalogQuote = pool.x.mint === asset.mint ? pool.y : pool.x;
  return {
    pool: pool.address,
    asset: { mint: asset.mint, symbol, decimals: assetToken.decimals, kind: asset.kind, name },
    quote: { mint: quoteMint, symbol: quote.symbol, decimals: quote.decimals },
    assetIsX: where.assetIsX,
    binStepBps: chainPool.binStepBps,
    activeBin: chainPool.activeBin,
    feeBps: chainPool.feeBps,
    multiplier,
    // The venue's price per token is per base token; an xStock's per unit the wallet shows is the stock row's.
    priceUsd: asset.kind === 'stock' ? (asset.row?.market.priceUsd ?? null) : catalogAsset.priceUsd,
    quoteUsd: catalogQuote.priceUsd,
    at: new Date(chainPool.source.at).toISOString(),
  };
}

function reject(mint: string, reason: string): null {
  console.info(`earn limits: ${mint.slice(0, 6)}… not offered — ${reason}`);
  return null;
}

/** The first candidate pool that passes every gate. */
async function firstMarket(candidates: readonly CatalogPool[], asset: Readonly<{ mint: string; kind: 'sol' | 'stock'; row: StockRow | null }>, nowMs: number): Promise<LimitMarket | null> {
  for (const pool of candidates) {
    const market = await marketOf(pool, asset, nowMs);
    if (market) return market;
  }
  return null;
}

async function build(nowMs: number): Promise<LimitMarketsAnswer> {
  const [top, universe] = await Promise.all([readPoolCatalog(null), readStockUniverse()]);
  const solPools = poolsOf(top.pools, SOL_MINT).filter((pool) => [pool.x.mint, pool.y.mint].includes(SOLANA_MAINNET_USDC_MINT));
  const rows = universe.ok
    ? universe.universe.rows
        .filter((row) => checkStockRow(row, row.representation.mint).ok)
        .sort((a, b) => (b.market.volume24hUsd ?? 0) - (a.market.volume24hUsd ?? 0))
        .slice(0, LIMIT_STOCKS_LOOKED_AT)
    : [];
  const stockSearches = await Promise.all(rows.map((row) => readPoolCatalog(row.representation.mint).catch(() => null)));
  const markets = await Promise.all([
    firstMarket(solPools, { mint: SOL_MINT, kind: 'sol', row: null }, nowMs),
    ...rows.map((row, index) => firstMarket(poolsOf(stockSearches[index]?.pools ?? [], row.representation.mint), { mint: row.representation.mint, kind: 'stock', row }, nowMs)),
  ]);
  return { markets: markets.filter((market): market is LimitMarket => market !== null), at: new Date(nowMs).toISOString() };
}

export function readLimitMarkets(nowMs: number = Date.now()): Promise<LimitMarketsAnswer> {
  if (kept && nowMs - kept.at < KEPT_MS) return Promise.resolve(kept.value);
  if (building) return building;
  building = build(nowMs)
    .then((value) => {
      // An empty answer is kept only briefly: a provider that failed is asked again soon.
      if (value.markets.length) kept = { at: nowMs, value };
      return value;
    })
    .finally(() => {
      building = null;
    });
  return building;
}
