/**
 * The Hangar's reads for one wallet, server side: the pool positions from the
 * programs' accounts with the venue's USD prices, the limit orders at Jupiter
 * and on DLMM beside the limits lane's records, the tokens' symbols, prices
 * and decimals, and — for a wallet the request proved — its reminder rules.
 *
 * Read-only. Nothing here builds, signs or sends a transaction, and nothing
 * writes: the limits lane's records are read as they stand (the reconciler
 * keeps them in step), never advanced from here.
 *
 * Each source answers on its own: a venue that did not answer leaves its part
 * `null` and the Hangar says it was not read, rather than showing no bots.
 */

import type { AutoinvestRule } from "../../api/v1/contract.ts";
import { listRules } from "../../autoinvest/service.ts";
import { readWalletPositions } from "../../liquidity/catalog/chain.server.ts";
import { LIQUIDITY_POOL_KINDS, type LiquidityPoolKind } from "../../liquidity/catalog/model.ts";
import { positionView, type PositionView } from "../../liquidity/catalog/positions.ts";
import { peekPoolRecord, readPoolRecord, type PoolRecordRead } from "../../liquidity/catalog/service.server.ts";
import type { PositionEntry } from "../../liquidity/catalog/track.ts";
import type { GuardStore } from "../../guard/store.ts";
import { fetchTokenCatalog } from "../../solana/catalog.ts";
import { limitsConnection } from "../../solana/limits/chain.server.ts";
import { mintDecimals } from "../../solana/limits/review.server.ts";
import { listLimitOrders } from "../../solana/limits/store.server.ts";
import { listTriggerOrders, type TriggerOrderRow } from "../../solana/limits/trigger.server.ts";
import type { GridBot } from "../grid.ts";
import type { BotBundle } from "./bundles.ts";
import { buildHangar, type HangarAnswer, type HangarToken } from "./hangar.ts";
import { hangarOrders, type HangarOrder } from "./orders.ts";

/** The venue's records for USD prices, a few at a time, and never past this. */
const RECORDS_MS = 5_000;
const TOKENS_AT_MOST = 40;

async function readRecords(wanted: readonly Readonly<{ kind: LiquidityPoolKind; pool: string }>[]): Promise<Map<string, PoolRecordRead>> {
  const out = new Map<string, PoolRecordRead>();
  const misses = wanted.filter((item) => {
    const kept = peekPoolRecord(item.kind, item.pool);
    if (kept) out.set(`${item.kind}:${item.pool}`, kept);
    return !kept;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(
      misses.slice(0, 8).map(async (item) => {
        out.set(`${item.kind}:${item.pool}`, await readPoolRecord(item.kind, item.pool, { meteora: { timeoutMs: 3_000 } }));
      }),
    ),
    new Promise((resolve) => (timer = setTimeout(resolve, RECORDS_MS))),
  ]);
  clearTimeout(timer);
  return out;
}

export async function readHangarPositions(wallet: string): Promise<Readonly<{ views: readonly PositionView[]; at: number }> | null> {
  try {
    const read = await readWalletPositions(wallet);
    if (!read.dlmm.ok && !read["damm-v2"].ok) return null;
    const wanted = new Map<string, Readonly<{ kind: LiquidityPoolKind; pool: string }>>();
    for (const kind of LIQUIDITY_POOL_KINDS) {
      const venue = read[kind];
      if (venue.ok) for (const position of venue.value) wanted.set(`${kind}:${position.pool}`, { kind, pool: position.pool });
    }
    const records = await readRecords([...wanted.values()]);
    const views: PositionView[] = [];
    for (const kind of LIQUIDITY_POOL_KINDS) {
      const venue = read[kind];
      if (!venue.ok) continue;
      for (const position of venue.value) {
        const record = records.get(`${kind}:${position.pool}`);
        views.push(positionView(position, kind, record?.pool ?? null, record?.at ?? null));
      }
    }
    return { views, at: Date.now() };
  } catch {
    return null;
  }
}

/** Both venues and the records; null when neither venue answered — a list from the records alone would read as truth. */
export async function readHangarOrders(store: GuardStore, wallet: string): Promise<readonly HangarOrder[] | null> {
  const connection = limitsConnection();
  const [stored, active, history, dlmm] = await Promise.all([
    listLimitOrders(store, wallet).catch(() => ({ records: [], complete: false })),
    listTriggerOrders(wallet, "active").catch(() => ({ ok: false as const })),
    listTriggerOrders(wallet, "history").catch(() => ({ ok: false as const })),
    import("../../solana/limits/dlmm.server.ts").then(({ listDlmmOrders }) => listDlmmOrders(wallet, { connection })).catch(() => ({ ok: false as const })),
  ]);
  if (!active.ok && !dlmm.ok) return null;
  const trigger = new Map<string, TriggerOrderRow>();
  for (const row of [...(history.ok ? history.orders : []), ...(active.ok ? active.orders : [])]) trigger.set(row.order, row);
  return hangarOrders({ records: stored.records, trigger: [...trigger.values()], dlmm: dlmm.ok ? dlmm.orders : [] });
}

export async function readHangarTokens(mints: readonly string[]): Promise<Record<string, HangarToken>> {
  const unique = [...new Set(mints)].slice(0, TOKENS_AT_MOST);
  if (unique.length === 0) return {};
  const connection = limitsConnection();
  const [catalog, decimals] = await Promise.all([
    fetchTokenCatalog(unique).catch(() => null),
    Promise.all(unique.map((mint) => mintDecimals(mint, connection).catch(() => null))),
  ]);
  const out: Record<string, HangarToken> = {};
  unique.forEach((mint, index) => {
    const row = catalog && catalog.ok ? catalog.byMint[mint] : undefined;
    const usd = row?.usdPrice != null ? Number(row.usdPrice) : Number.NaN;
    out[mint] = { symbol: row?.symbol ?? null, decimals: decimals[index] ?? null, usd: Number.isFinite(usd) && usd > 0 ? usd : null };
  });
  return out;
}

export type HangarReadInput = Readonly<{
  wallet: string;
  /** The request proved this wallet: its rules may be read. */
  proven: boolean;
  grids: readonly GridBot[];
  entries: Readonly<Record<string, PositionEntry>>;
  bundles: readonly BotBundle[];
}>;

export async function readHangar(store: GuardStore, input: HangarReadInput): Promise<HangarAnswer> {
  const [positions, orders, rules] = await Promise.all([
    readHangarPositions(input.wallet),
    readHangarOrders(store, input.wallet).catch(() => null),
    input.proven ? listRules(store, input.wallet).then((listed): readonly AutoinvestRule[] => listed.rules).catch(() => null) : Promise.resolve(null),
  ]);
  const mints = (orders ?? []).flatMap((order) => [order.baseMint, order.quoteMint]);
  const tokens = await readHangarTokens(mints);
  /* A position's own read carries its tokens' prices and symbols; the orders' tokens come from the catalogue. */
  return buildHangar({ wallet: input.wallet, nowMs: Date.now(), positions, grids: input.grids, entries: input.entries, orders, bundles: input.bundles, rules, tokens });
}
