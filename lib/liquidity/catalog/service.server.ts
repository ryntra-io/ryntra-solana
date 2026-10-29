/**
 * The pools catalogue's reader: two bounded calls to Meteora's Data APIs
 * (DLMM and DAMM v2, in parallel), kept for two minutes. A venue that stops
 * answering is asked again after a minute, not on every view; while a
 * complete copy from the last six hours exists the page is served from it,
 * marked with the copy's own time, and the other venue is read fresh — one
 * API's outage never hides the other's pools. Nothing here throws to a page.
 */

import "server-only";

import { readMeteoraJson, type MeteoraDeps } from "../meteora/client.server.ts";
import {
  catalogUrl,
  LIQUIDITY_POOL_KINDS,
  mapCatalogPage,
  mapCatalogPool,
  matchCatalog,
  mergeCatalog,
  poolRecordUrl,
  type CatalogPool,
  type CatalogSource,
  type LiquidityPoolKind,
  type PoolCatalog,
} from "./model.ts";

export const CATALOG_TTL_MS = 2 * 60 * 1000;
export const CATALOG_NEGATIVE_TTL_MS = 60 * 1000;
export const CATALOG_GRACE_MS = 6 * 60 * 60 * 1000;
/** Searches are many and each one small: kept briefly, and at most this many at once. */
const SEARCHES_KEPT = 64;
/**
 * Fresh searches a process may send Meteora in a minute. Each costs two calls against a venue that allows ten a second
 * for everyone on this server's address; past this, a search filters the top pools instead, so a loop of unique queries
 * can never starve the catalogue every visitor reads.
 */
export const SEARCHES_PER_MINUTE = 30;
let searchWindow = { start: 0, used: 0 };
function searchAllowed(nowMs: number): boolean {
  if (nowMs - searchWindow.start >= 60_000) searchWindow = { start: nowMs, used: 0 };
  if (searchWindow.used >= SEARCHES_PER_MINUTE) return false;
  searchWindow.used += 1;
  return true;
}

type VenueRead = Readonly<{ pools: readonly CatalogPool[]; source: CatalogSource }>;
type Entry = Readonly<{ at: number; venues: Readonly<Record<LiquidityPoolKind, VenueRead>> }>;

const lists = new Map<string, Entry>();
const inflight = new Map<string, Promise<PoolCatalog>>();

export type CatalogDeps = Readonly<{ meteora?: MeteoraDeps; now?: () => number }>;

export function resetPoolCatalogCache(): void {
  lists.clear();
  inflight.clear();
  records.clear();
  recordReads.clear();
  searchWindow = { start: 0, used: 0 };
}

const complete = (entry: Entry): boolean => LIQUIDITY_POOL_KINDS.every((kind) => entry.venues[kind].source.ok && !entry.venues[kind].source.stale);

async function readVenue(kind: LiquidityPoolKind, search: string | null, kept: VenueRead | undefined, nowMs: number, deps: CatalogDeps): Promise<VenueRead> {
  const read = await readMeteoraJson(catalogUrl(kind, search), deps.meteora);
  const page = read.ok ? mapCatalogPage(read.body, kind) : null;
  if (page) return { pools: page.pools, source: { ok: true, stale: false, at: new Date(nowMs).toISOString(), total: page.total } };
  /* The last copy this venue answered whole, while its own time is inside the grace window. */
  if (kept?.source.ok && kept.source.at && nowMs - Date.parse(kept.source.at) < CATALOG_GRACE_MS) {
    return { pools: kept.pools, source: { ...kept.source, stale: true } };
  }
  return { pools: [], source: { ok: false, stale: false, at: null, total: null } };
}

/** The catalogue — the deep pools of both venues, the most traded first — or a search over them; never throws. */
export function readPoolCatalog(search: string | null, deps: CatalogDeps = {}): Promise<PoolCatalog> {
  const now = deps.now ?? Date.now;
  const nowMs = now();
  const key = search ?? "";
  const hit = lists.get(key);
  if (hit && nowMs - hit.at < (complete(hit) ? CATALOG_TTL_MS : CATALOG_NEGATIVE_TTL_MS)) return Promise.resolve(present(hit, search));
  const pending = inflight.get(key);
  if (pending) return pending;
  if (search && !searchAllowed(nowMs)) return readPoolCatalog(null, deps).then((top) => ({ ...top, pools: matchCatalog(top.pools, search), search, searchLimited: true }));
  const promise = (async () => {
    const [dlmm, damm] = await Promise.all(LIQUIDITY_POOL_KINDS.map((kind) => readVenue(kind, search, hit?.venues[kind], nowMs, deps)));
    const entry: Entry = { at: nowMs, venues: { dlmm: dlmm!, "damm-v2": damm! } };
    if (search && !lists.has(key) && lists.size >= SEARCHES_KEPT) {
      const oldest = [...lists.entries()].filter(([k]) => k !== "").sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) lists.delete(oldest[0]);
    }
    lists.set(key, entry);
    return present(entry, search);
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function present(entry: Entry, search: string | null): PoolCatalog {
  return {
    pools: mergeCatalog(LIQUIDITY_POOL_KINDS.map((kind) => entry.venues[kind].pools)),
    sources: { dlmm: entry.venues.dlmm.source, "damm-v2": entry.venues["damm-v2"].source },
    search,
    searchLimited: false,
  };
}

export type PoolRecordRead = Readonly<{ pool: CatalogPool | null; at: string | null; ok: boolean }>;
const records = new Map<string, Readonly<{ at: number; read: PoolRecordRead }>>();
const recordReads = new Map<string, Promise<PoolRecordRead>>();
const RECORDS_KEPT = 512;

/** A record still fresh in the cache, without reading — so a caller can pace only the reads that go out. */
export function peekPoolRecord(kind: LiquidityPoolKind, address: string): PoolRecordRead | null {
  const hit = records.get(`${kind}:${address}`);
  return hit && Date.now() - hit.at < (hit.read.ok ? CATALOG_TTL_MS : CATALOG_NEGATIVE_TTL_MS) ? hit.read : null;
}

/** One pool's record from its venue's Data API — the figures only the venue keeps (TVL, a day's volume and fees, USD prices). */
export function readPoolRecord(kind: LiquidityPoolKind, address: string, deps: CatalogDeps = {}): Promise<PoolRecordRead> {
  const nowMs = (deps.now ?? Date.now)();
  const key = `${kind}:${address}`;
  const hit = records.get(key);
  if (hit && nowMs - hit.at < (hit.read.ok ? CATALOG_TTL_MS : CATALOG_NEGATIVE_TTL_MS)) {
    /* Used again: moved to the young end, so the oldest-used entry is the one evicted. */
    records.delete(key);
    records.set(key, hit);
    return Promise.resolve(hit.read);
  }
  const pending = recordReads.get(key);
  if (pending) return pending;
  const promise = (async (): Promise<PoolRecordRead> => {
    const read = await readMeteoraJson(poolRecordUrl(kind, address), deps.meteora);
    const pool = read.ok ? mapCatalogPool(read.body, kind) : null;
    const result: PoolRecordRead = pool ? { pool, at: new Date(nowMs).toISOString(), ok: true } : { pool: null, at: null, ok: false };
    records.delete(key);
    if (records.size >= RECORDS_KEPT) records.delete(records.keys().next().value!);
    records.set(key, { at: nowMs, read: result });
    return result;
  })().finally(() => recordReads.delete(key));
  recordReads.set(key, promise);
  return promise;
}
