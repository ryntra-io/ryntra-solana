/**
 * The liquidity reader — one mint in, one `StockLiquidity` out, from a
 * per-mint cache in front of Meteora's two Data APIs.
 *
 * The budget is the page's, not the venue's: a fresh read costs at most two
 * bounded calls (DLMM, DAMM v2, in parallel, ≤ 6 s each), a read inside the
 * five-minute TTL costs nothing, and a venue that has stopped answering
 * costs one attempt a minute and no more — the failure is remembered for
 * sixty seconds so a page viewed twice does not wait twice. That is the
 * lesson of the xStocks outage: a provider's silence must never gate a
 * surface's time.
 *
 * A source that fails while a complete copy from the last six hours exists
 * is served from that copy and marked stale, with the copy's own time; the
 * other source is read fresh regardless, so one API's outage never hides the
 * other's pools. Nothing here throws to the page: every path ends in a
 * `StockLiquidity` whose `state` says what happened.
 */

import { readMeteoraPools, type MeteoraDeps } from "./meteora/client.server.ts";
import { assembleStockLiquidity, LIQUIDITY_POOL_KINDS, type LiquidityPool, type LiquidityPoolKind, type LiquiditySourceState, type StockLiquidity } from "./model.ts";

export const LIQUIDITY_TTL_MS = 5 * 60 * 1000;
export const LIQUIDITY_GRACE_MS = 6 * 60 * 60 * 1000;
export const LIQUIDITY_NEGATIVE_TTL_MS = 60 * 1000;

type Entry = Readonly<{ at: number; read: StockLiquidity }>;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<StockLiquidity>>();

export type LiquidityDeps = Readonly<{
  /** The confirmed stock mints, so a stock–stock pool counts as money-like; empty when the caller has no universe. */
  stockMints?: ReadonlySet<string>;
  meteora?: MeteoraDeps;
  now?: () => Date;
}>;

export function resetStockLiquidityCache(): void {
  cache.clear();
  inflight.clear();
}

/** Tests only: a read placed in the cache as if it had been made at `atMs`. */
export function primeStockLiquidity(read: StockLiquidity, atMs: number): void {
  cache.set(read.mint, { at: atMs, read });
}

/** The last complete copy of one source, while its own read time is inside the grace window. */
const graceCopy = (entry: Entry | undefined, kind: LiquidityPoolKind, nowMs: number): Readonly<{ pools: readonly LiquidityPool[]; fetchedAt: string }> | null => {
  if (!entry) return null;
  const source = entry.read.sources[kind];
  if (!source.ok || !source.fetchedAt) return null;
  const readAt = Date.parse(source.fetchedAt);
  if (!Number.isFinite(readAt) || nowMs - readAt >= LIQUIDITY_GRACE_MS) return null;
  return { pools: entry.read.pools.filter((pool) => pool.kind === kind), fetchedAt: source.fetchedAt };
};

/** Every Meteora pool that holds the mint, ranked and summarized; never throws. */
export function readStockLiquidity(mint: string, deps: LiquidityDeps = {}): Promise<StockLiquidity> {
  const now = deps.now ?? (() => new Date());
  const nowMs = now().getTime();
  const hit = cache.get(mint);
  if (hit) {
    /* A read every source answered fresh keeps for the TTL; anything less is asked again after a minute, so a recovery is seen soon and a silent venue costs one attempt a minute. */
    const ttl = hit.read.state === "current" ? LIQUIDITY_TTL_MS : LIQUIDITY_NEGATIVE_TTL_MS;
    if (nowMs - hit.at < ttl) return Promise.resolve(hit.read);
  }
  const pending = inflight.get(mint);
  if (pending) return pending;
  const stockMints = deps.stockMints ?? new Set<string>();
  const promise = (async (): Promise<StockLiquidity> => {
    const reads = await Promise.all(LIQUIDITY_POOL_KINDS.map((kind) => readMeteoraPools(kind, mint, stockMints, { ...deps.meteora, now: deps.meteora?.now ?? now })));
    const pools: LiquidityPool[] = [];
    const sources = {} as Record<LiquidityPoolKind, LiquiditySourceState>;
    for (const read of reads) {
      if (read.ok) {
        pools.push(...read.pools);
        sources[read.kind] = { ok: true, stale: false, fetchedAt: read.fetchedAt, reason: null };
        continue;
      }
      const copy = graceCopy(hit, read.kind, nowMs);
      if (copy) {
        pools.push(...copy.pools);
        sources[read.kind] = { ok: true, stale: true, fetchedAt: copy.fetchedAt, reason: read.reason };
      } else {
        sources[read.kind] = { ok: false, stale: false, fetchedAt: null, reason: read.reason };
      }
    }
    const read = assembleStockLiquidity({ mint, pools, sources });
    /* Remembered with the time of this attempt; a grace copy keeps its own
       read time in `sources`, so it ages out of the grace window on the
       clock that matters. */
    cache.set(mint, { at: nowMs, read });
    return read;
  })().finally(() => {
    inflight.delete(mint);
  });
  inflight.set(mint, promise);
  return promise;
}
