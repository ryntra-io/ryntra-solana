import "server-only";

import { readWalletPositions } from "../liquidity/catalog/chain.server.ts";
import { LIQUIDITY_POOL_KINDS, type LiquidityPoolKind } from "../liquidity/catalog/model.ts";
import { positionView } from "../liquidity/catalog/positions.ts";
import { peekPoolRecord, readPoolRecord, type PoolRecordRead } from "../liquidity/catalog/service.server.ts";
import { sightingOf, type LiquiditySighting } from "./liquidity.ts";

/**
 * A proven wallet's pool positions as the liquidity badges read them: the
 * same chain read the Pools pages make (Meteora DLMM and DAMM v2 accounts,
 * through `lib/liquidity`), with the venue's token prices for the value.
 * Read only — nothing here builds a transaction or touches money.
 *
 * One venue that does not answer leaves the other's positions: a day is only
 * ever added from what was read, so a partial read can earn a day and never
 * take one away. A pool whose record was not read is counted as unpriced,
 * not as zero. Value is only what sits in tokens the venue marks verified;
 * the pool's own verified reserves, its blacklist flag and its day's volume
 * say whether it is live.
 */

export type LiquidityRead =
  | Readonly<{ ok: true; partial: boolean; positions: readonly LiquiditySighting[]; unpriced: number; at: string }>
  | Readonly<{ ok: false }>;

/** The venue's records for USD prices: a few at a time, never past this (the DAMM v2 API allows ten a second). */
const RECORDS_AT_ONCE = 3;
const RECORDS_MS = 5_000;
/** The most pools one read prices: past it, the rest of a wallet's pools — in the order the chain gave them — are unpriced. */
const RECORDS_MAX = 24;

async function readRecords(wanted: readonly Readonly<{ kind: LiquidityPoolKind; pool: string }>[]): Promise<Map<string, PoolRecordRead>> {
  const out = new Map<string, PoolRecordRead>();
  const misses = wanted.filter((item) => {
    const kept = peekPoolRecord(item.kind, item.pool);
    if (kept) out.set(`${item.kind}:${item.pool}`, kept);
    return !kept;
  }).slice(0, RECORDS_MAX);
  const deadline = Date.now() + RECORDS_MS;
  let next = 0;
  const worker = async () => {
    while (next < misses.length && Date.now() < deadline) {
      const item = misses[next++]!;
      out.set(`${item.kind}:${item.pool}`, await readPoolRecord(item.kind, item.pool, { meteora: { timeoutMs: 3_000 } }));
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(Array.from({ length: RECORDS_AT_ONCE }, worker)), new Promise((resolve) => (timer = setTimeout(resolve, RECORDS_MS)))]);
  clearTimeout(timer);
  return out;
}

export async function readLiquiditySightings(owner: string): Promise<LiquidityRead> {
  const read = await readWalletPositions(owner);
  if (!read.dlmm.ok && !read["damm-v2"].ok) return { ok: false };
  const wanted = new Map<string, Readonly<{ kind: LiquidityPoolKind; pool: string }>>();
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (venue.ok) for (const position of venue.value) wanted.set(`${kind}:${position.pool}`, { kind, pool: position.pool });
  }
  const records = wanted.size > 0 ? await readRecords([...wanted.values()]) : new Map<string, PoolRecordRead>();
  const positions: LiquiditySighting[] = [];
  let unpriced = 0;
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (!venue.ok) continue;
    for (const position of venue.value) {
      const record = records.get(`${kind}:${position.pool}`);
      const pool = record?.pool ?? null;
      const sighting = sightingOf(positionView(position, kind, pool, record?.at ?? null), pool);
      if (sighting.valueUsd === null) unpriced += 1;
      positions.push(sighting);
    }
  }
  return { ok: true, partial: !read.dlmm.ok || !read["damm-v2"].ok, positions, unpriced, at: new Date().toISOString() };
}
