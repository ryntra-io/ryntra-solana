import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import {
  emptyLiquidityRecord,
  observeLiquidity,
  publicLiquidity,
  withLiquidityChoice,
  type LiquidityBadgeId,
  type LiquidityRecord,
  type LiquiditySighting,
} from "./liquidity.ts";

/**
 * The durable half of liquidity badges: one row per proven wallet in
 * `growthLiquidity` — the days Ryntra saw its positions in range, the badges
 * they earned and its choice about the boards. Every write is a
 * compare-and-set on the row's version, so two tabs reading at once add a day
 * once and never lose the other's choice.
 */

export const LIQUIDITY_COLLECTION = "growthLiquidity" as const;

export function liquidityKey(wallet: string): string {
  return `solana:${wallet}`;
}

const isRecord = (value: unknown): value is LiquidityRecord => {
  const row = value as LiquidityRecord | null;
  return Boolean(row && typeof row.wallet === "string" && Number.isInteger(row.version) && Array.isArray(row.days) && Array.isArray(row.rangedDays) && row.earned && typeof row.earned === "object");
};

/** The wallet's record, or an empty one. */
export async function readLiquidity(store: GuardStore, wallet: string): Promise<LiquidityRecord> {
  const row = await store.versioned<LiquidityRecord>(LIQUIDITY_COLLECTION).get(liquidityKey(wallet));
  return isRecord(row) && row.wallet === wallet ? row : emptyLiquidityRecord(wallet);
}

async function change(store: GuardStore, wallet: string, next: (record: LiquidityRecord) => LiquidityRecord | null): Promise<LiquidityRecord> {
  const collection = store.versioned<LiquidityRecord>(LIQUIDITY_COLLECTION);
  const key = liquidityKey(wallet);
  let result = emptyLiquidityRecord(wallet);
  await withBoundedCasRetry(async () => {
    let row = await collection.get(key);
    /* A row with no version cannot be compared and set: it is cleared, so it never blocks every write. */
    if (row && !Number.isInteger(row.version)) {
      await collection.delete(key);
      row = undefined;
    }
    const stored = row ? row.version : null;
    /* A row this module cannot read is begun again, above its version. */
    const current = isRecord(row) && row.wallet === wallet ? row : { ...emptyLiquidityRecord(wallet), version: stored ?? 0 };
    const updated = next(current);
    result = updated ?? current;
    if (!updated) return true;
    return collection.compareAndSet(key, stored, updated);
  });
  return result;
}

/** One read of the chain for this wallet: today's day and any badge it earned, written once. */
export function recordLiquiditySighting(store: GuardStore, wallet: string, positions: readonly LiquiditySighting[], at: string): Promise<LiquidityRecord> {
  return change(store, wallet, (record) => observeLiquidity(record, positions, at));
}

/** Show this wallet's liquidity badges on the boards, or stop. The caller has checked its proof. */
export function setLiquidityShown(store: GuardStore, wallet: string, shown: boolean, at: string): Promise<LiquidityRecord> {
  return change(store, wallet, (record) => withLiquidityChoice(record, shown, at));
}

/**
 * The highest liquidity badge of each of these wallets that chose to show it — what a board may draw. Only the
 * wallets a board shows are read, so a public read costs a board's rows, never every wallet that ever held a position.
 */
export async function readPublicLiquidity(store: GuardStore, wallets: Iterable<string>): Promise<Readonly<Record<string, LiquidityBadgeId>>> {
  const collection = store.collection<LiquidityRecord>(LIQUIDITY_COLLECTION);
  const rows = await Promise.all([...new Set(wallets)].map((wallet) => collection.get(liquidityKey(wallet))));
  return publicLiquidity(rows.filter(isRecord));
}
