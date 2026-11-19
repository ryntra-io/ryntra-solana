/**
 * Every Meteora DLMM Pro pool of a network, read from the chain and named from Jupiter's catalogue.
 *
 * The pools are the program's own accounts (`pools.list`, one indexed read), their depth the two vaults, the names,
 * logos and dollar prices the catalogue's. All of it goes through earning's one door to the venue
 * (`lib/earn-pro/venue.server.ts`), which asks the gate first: where DLMM Pro is closed, nothing here is read.
 *
 * A list is kept a minute for the whole process — the program is read once a minute however many people look — and one
 * pool, read for its own page, twenty seconds.
 */

import { fetchTokenCatalog, type TokenCatalogEntry } from "../solana/catalog.ts";
import { isOffensiveName } from "../spot/offensive-names.ts";
import { stepBpsOfSpacing } from "../earn-pools/bins.ts";
import type { EarnProNetwork } from "../earn-pro/gate.ts";
import { reservesOf } from "../earn-pro/piers.server.ts";
import { earnProConnection, earnProVenue, makerShareOf, referralOwnerOf, type DlmmProPool } from "../earn-pro/venue.server.ts";
import { byDepth, tvlUsdOf, type ProPoolCoin, type ProPoolFee, type ProPoolRow, type ProPoolsAnswer } from "./model.ts";

const LIST_FRESH_MS = 60_000;
const ONE_FRESH_MS = 20_000;
const SOL_MINT = "So11111111111111111111111111111111111111112";

const lists = new Map<EarnProNetwork, Readonly<{ at: number; answer: ProPoolsAnswer }>>();
const asked = new Map<EarnProNetwork, Promise<ProPoolsAnswer>>();
const ones = new Map<string, Readonly<{ at: number; row: ProPoolRow | null }>>();

const FEE_MODE: Readonly<Record<string, ProPoolFee["mode"]>> = { fixed: "fixed", timeLinear: "time", timeExponential: "time", marketCapLinear: "marketCap", marketCapExponential: "marketCap" };

function coinOf(mint: string, decimals: number, entry: TokenCatalogEntry | undefined): ProPoolCoin {
  const usd = entry?.usdPrice != null ? Number(entry.usdPrice) : NaN;
  return {
    mint,
    symbol: entry?.symbol ?? (mint === SOL_MINT ? "SOL" : null),
    name: entry?.name ?? (mint === SOL_MINT ? "Solana" : null),
    decimals,
    icon: entry?.icon ?? null,
    verified: entry?.isVerified ?? (mint === SOL_MINT ? true : null),
    usd: Number.isFinite(usd) && usd > 0 ? usd : null,
  };
}

/** One pool as a row: the chain's pool, its two vaults, the catalogue's names and prices. */
export function rowOf(pool: DlmmProPool, reserves: Readonly<{ x: bigint | null; y: bigint | null }>, catalog: Readonly<Record<string, TokenCatalogEntry>>, referral: boolean): ProPoolRow {
  const x = coinOf(pool.tokenX.mint, pool.tokenX.decimals, catalog[pool.tokenX.mint]);
  const y = coinOf(pool.tokenY.mint, pool.tokenY.decimals, catalog[pool.tokenY.mint]);
  const xRaw = reserves.x === null ? null : reserves.x.toString();
  const yRaw = reserves.y === null ? null : reserves.y.toString();
  return {
    address: pool.address,
    kind: pool.kind,
    x,
    y,
    price: pool.price,
    tickSpacing: pool.tickSpacing,
    stepBps: stepBpsOfSpacing(pool.tickSpacing),
    fee: {
      totalBps: pool.fee.totalBps,
      baseBps: pool.fee.baseBps,
      dynamicBps: pool.fee.dynamicBps,
      mode: FEE_MODE[pool.fee.mode] ?? "fixed",
      protocolShareBps: pool.fee.protocolShareBps,
      collectedIn: pool.fee.collectedIn,
    },
    bonusBps: makerShareOf(pool.fee.totalBps, referral).ownerBps,
    reserves: { xRaw, yRaw },
    tvlUsd: tvlUsdOf(x, y, xRaw, yRaw),
    rewards: pool.rewards.filter((reward) => reward.running).length,
    open: { swap: pool.open.swap.open && !pool.paused.swaps, deposits: pool.open.addLiquidity.open && !pool.paused.deposits },
  };
}

async function rowsOf(network: EarnProNetwork, pools: readonly DlmmProPool[]): Promise<ProPoolRow[]> {
  if (pools.length === 0) return [];
  const connection = earnProConnection(network);
  const mints = [...new Set(pools.flatMap((pool) => [pool.tokenX.mint, pool.tokenY.mint]))];
  const [reserves, catalog] = await Promise.all([
    reservesOf(connection, pools),
    // The names are a courtesy: a catalogue that did not answer leaves the pools with their addresses, never without the pools.
    network === "mainnet" ? fetchTokenCatalog(mints, 6_000).catch(() => null) : Promise.resolve(null),
  ]);
  const byMint = catalog && catalog.ok ? catalog.byMint : {};
  const referral = referralOwnerOf(network) !== null;
  return pools.map((pool) => rowOf(pool, { x: reserves.get(pool.tokenX.reserve) ?? null, y: reserves.get(pool.tokenY.reserve) ?? null }, byMint, referral));
}

/** Every pool of the program on the network, deepest first; kept a minute. Throws where the chain did not answer. */
export async function readProPools(network: EarnProNetwork, now: number = Date.now()): Promise<ProPoolsAnswer> {
  const kept = lists.get(network);
  if (kept && now - kept.at < LIST_FRESH_MS) return kept.answer;
  const running = asked.get(network);
  if (running) return running;
  const read = (async () => {
    const venue = earnProVenue(network);
    const pools = await venue.pools.list({});
    // A pool whose coin carries a hate word in its name or ticker is not listed, as on the Market (`lib/spot/offensive-names.ts`).
    const rows = (await rowsOf(network, pools)).filter((row) => !isOffensiveName(row.x.symbol, row.x.name, row.y.symbol, row.y.name)).sort(byDepth);
    const answer: ProPoolsAnswer = { network, at: new Date(now).toISOString(), pools: rows };
    lists.set(network, { at: now, answer });
    return answer;
  })().finally(() => asked.delete(network));
  asked.set(network, read);
  return read;
}

/** One pool of the program, read now (kept twenty seconds); null — no DLMM Pro pool at the address. */
export async function readProPool(network: EarnProNetwork, address: string, now: number = Date.now()): Promise<ProPoolRow | null> {
  const key = `${network}:${address}`;
  const kept = ones.get(key);
  if (kept && now - kept.at < ONE_FRESH_MS) return kept.row;
  const listed = lists.get(network);
  const fromList = listed && now - listed.at < ONE_FRESH_MS ? listed.answer.pools.find((row) => row.address === address) : undefined;
  if (fromList) return fromList;
  const venue = earnProVenue(network);
  const pool = await venue.pools.read(address);
  const row = pool ? ((await rowsOf(network, [pool]))[0] ?? null) : null;
  keepOne(key, { at: now, row }, now);
  return row;
}

/** The most single reads kept: an address anyone may type is never a reason for the process to grow. */
export const ONES_KEPT = 500;

/**
 * Keeps one pool's read: first lets go of every read past its freshness, then — while the map still holds too many —
 * of the oldest, so the map never grows past `ONES_KEPT` however many addresses are asked for (a map iterates in the
 * order its keys were set; a key set again moves to the end).
 */
export function keepOne(key: string, value: Readonly<{ at: number; row: ProPoolRow | null }>, now: number, map: Map<string, Readonly<{ at: number; row: ProPoolRow | null }>> = ones, most: number = ONES_KEPT): void {
  for (const [kept, read] of map) if (now - read.at >= ONE_FRESH_MS) map.delete(kept);
  map.delete(key);
  while (map.size >= most) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, value);
}
