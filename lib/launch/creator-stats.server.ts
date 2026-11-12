/**
 * The creator's cabinet in figures and the creator's public profile — the
 * server's half (SOL-L2).
 *
 * - `readLaunchStats` — one launch as the cabinet and the profile read it:
 *   the token's market read (the same read its page makes, kept a few
 *   seconds) and the creator role's fees read from the chain, put together by
 *   the core (`lib/core/launch/creator-stats.ts`): what the creator's side
 *   earned over the last day and week by source, the volume, the holders, the
 *   traders and those who came back, the liquidity, after the DEX the depth
 *   ±2 % and the pool's fees, the creator's own trades and lock.
 * - `readCreatorProfile` — the launches a wallet made through Ryntra, the
 *   newest first; each one's figures are its own `…/stats`.
 *
 * Everything here is public on chain. A figure that could not be read is
 * said as not read, never as zero.
 */

import type { LaunchCreatorProfileResponse, LaunchStatsResponse } from "../api/v1/contract.ts";
import { creatorEarnings } from "../core/launch/creator-earnings.ts";
import { creatorLockSchedule } from "../core/launch/creator-lock.ts";
import {
  creatorSales,
  poolDepth,
  poolFeeWindows,
  revenueWindows,
  traderCounts,
  volumeWindows,
  type CountFigure,
  type StatTrade,
} from "../core/launch/creator-stats.ts";
import type { CreatorFeesObservation } from "../core/venues/meteora-dbc/claim.server.ts";
import { creatorActivity, creatorSoldShare, shareBps, type LaunchTrade } from "../core/venues/meteora-dbc/market.ts";
import { launchPair } from "./config.server.ts";
import { creatorFeesOf } from "./creator.server.ts";
import { readLaunchRecord, type LaunchRecord } from "./flow.server.ts";
import { readLaunchMarketFacts, type MarketDeps } from "./market.server.ts";
import { metadataOfUri } from "./metadata.server.ts";
import { ryntraOwnWallets } from "./runtime.server.ts";

const DAY = 24 * 60 * 60;
/** A launch's creator fees are read again at most this often: a cabinet and a profile open together read the chain once. */
const FEES_MS = 30_000;
const PROFILE_LAUNCHES = 50;

const FEES = new Map<string, Readonly<{ at: number; value: Promise<CreatorFeesObservation | null> }>>();

function feesOf(deps: MarketDeps, record: LaunchRecord): Promise<CreatorFeesObservation | null> {
  const key = `${deps.network.cluster}:${record.token}`;
  const now = deps.now().getTime();
  const hit = FEES.get(key);
  if (hit && now - hit.at < FEES_MS) return hit.value;
  /* Unread stays unread: the figures that rest on it say so. */
  const value = creatorFeesOf(deps, record).catch(() => null);
  FEES.set(key, { at: now, value });
  return value;
}

const statTrade = (trade: LaunchTrade): StatTrade => trade;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** A picture the profile names only when it is an address; anything else is none. */
function urlOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function readLaunchStats(deps: MarketDeps, token: string): Promise<LaunchStatsResponse | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const [facts, fees, own] = await Promise.all([readLaunchMarketFacts(deps, token), feesOf(deps, record), ryntraOwnWallets(deps.network, deps.store).catch(() => null)]);
  if (!facts) return null;
  const now = Math.floor(deps.now().getTime() / 1000);
  const state = facts.state;
  const market = facts.response;
  const creator = record.creator;
  const trades = facts.historyTrades.map(statTrade);
  const migrated = state.curve.migrated;

  const graduatedFees = fees?.graduated ?? null;
  const lp =
    graduatedFees?.positionLiquidity && graduatedFees.poolLiquidity
      ? { positionLiquidity: graduatedFees.positionLiquidity, poolLiquidity: graduatedFees.poolLiquidity, changeSlots: facts.liquidityChangeSlots }
      : null;
  const revenue = revenueWindows({ now, trades, cover: facts.cover, read: fees?.read ?? null, graduatedAt: fees ? fees.graduatedAt : state.curve.finishedAt, migrated, lp });

  /* The market's makers are not its traders: the creator, the wallets their buys paid for and Ryntra's own wallets. */
  const unreadCount: CountFigure = { count: null, atLeast: false };
  let counts: Readonly<{ traders: CountFigure; repeat: CountFigure }> = { traders: unreadCount, repeat: unreadCount };
  if (own?.complete) {
    const excluded = new Set<string>([creator, ...own.wallets]);
    for (const [wallet, labels] of facts.labels) if (labels.includes("creator") || labels.includes("bundle")) excluded.add(wallet);
    counts = traderCounts(trades, facts.historyComplete, excluded);
  }

  const pair = launchPair(deps.network, record.preset, record.pairMint);
  const supply = BigInt(state.supplyRaw);
  const activity = creatorActivity(facts.creatorTrades, creator);
  const sold = creatorSoldShare(activity, supply);
  const sales = creatorSales(facts.creatorTrades.map(statTrade), creator);

  const position = BigInt(graduatedFees?.positionLiquidity ?? "0");
  const poolLiquidity = BigInt(graduatedFees?.poolLiquidity ?? "0");
  const schedule = record.lock ? creatorLockSchedule(record.lock.schedule) : null;
  const lockStart = Math.floor(Date.parse(record.launchedAt) / 1000);
  const escrowHolding = record.lock ? (facts.foundHolders.find((holder) => holder.owner === record.lock?.escrow) ?? null) : null;

  return {
    network: deps.network.chain,
    token,
    creator,
    pair: { mint: state.curve.pairMint, symbol: pair.symbol, decimals: state.pairDecimals, dollar: pair.dollar },
    tokenDecimals: state.tokenDecimals,
    venue: state.graduated ? "pool" : "curve",
    progressBps: state.curve.progressBps,
    migrated,
    links: { curve: state.curve.pool, pool: state.graduated?.pool ?? null, position: graduatedFees?.position ?? null, lock: record.lock?.state === "LOCKED" ? record.lock.escrow : null },
    revenue,
    volume: volumeWindows(trades, facts.cover, now),
    holders: { count: market.holders.count, atLeast: market.holders.atLeast },
    traders: counts.traders,
    repeatTraders: counts.repeat,
    liquidity: market.liquidity,
    marketCap: market.marketCap,
    market: state.graduated
      ? {
          depth: poolDepth(state.graduated),
          fees: poolFeeWindows(trades, facts.cover, now),
          lpShareBps: graduatedFees?.positionLiquidity && poolLiquidity > 0n ? shareBps(position, poolLiquidity) : null,
        }
      : null,
    creatorTrades: {
      boughtRaw: sales.boughtRaw,
      soldRaw: sales.soldRaw,
      soldBps: facts.creatorTradesComplete ? (sold?.bps ?? 0) : null,
      soldOf: sold?.of ?? null,
      sales: sales.sales.map((sale) => ({ signature: sale.signature, at: iso(sale.at), tokensRaw: sale.tokensRaw, pairRaw: sale.pairRaw })),
      complete: facts.creatorTradesComplete,
    },
    lock:
      record.lock && schedule
        ? {
            state: record.lock.state,
            schedule: schedule.id,
            escrow: record.lock.escrow,
            lockedRaw: escrowHolding ? escrowHolding.amountRaw : null,
            cliffAt: iso(lockStart + schedule.cliffDays * DAY),
            endAt: iso(lockStart + (schedule.cliffDays + schedule.vestDays) * DAY),
          }
        : null,
    observedAt: deps.now().toISOString(),
  };
}

/**
 * What a launch's creator role earned over all time, raw in the pair currency, on the chain's own counters — the
 * cabinet's figure (`creatorEarnings(…).role.earnedRaw`) — from the same kept read of the creator fees `readLaunchStats`
 * makes, so asked right after it the chain is not read again. Null when the launch or its fees could not be read: never
 * a zero. Read-only; the Hall of Fame's all-time creators (CITY-230).
 */
export async function readLaunchEarnedAll(deps: MarketDeps, token: string): Promise<Readonly<{ raw: string; at: string }> | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const fees = await feesOf(deps, record);
  if (!fees) return null;
  return { raw: creatorEarnings(fees.read, record.creator).role.earnedRaw, at: deps.now().toISOString() };
}

/** The launches a wallet made through Ryntra on this network — its own, not those it shares in —, the newest first. */
export async function readCreatorProfile(deps: MarketDeps, creator: string): Promise<LaunchCreatorProfileResponse> {
  const cluster = deps.network.cluster;
  const records = (await deps.store.collection<LaunchRecord>("launchesByCreator").valuesWithPrefix(`solana:${cluster}:${creator}:`))
    .filter((record) => record.state === "LAUNCHED" && record.cluster === cluster && record.creator === creator)
    .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt))
    .slice(0, PROFILE_LAUNCHES);
  const launches: LaunchCreatorProfileResponse["launches"][number][] = [];
  for (const record of records) {
    const stored = await metadataOfUri(deps.store, record.metadataUri, deps.network.origin).catch(() => null);
    const pair = launchPair(deps.network, record.preset, record.pairMint);
    launches.push({
      token: record.token,
      name: stored?.metadata.name ?? record.name,
      symbol: stored?.metadata.symbol ?? record.symbol,
      image: stored?.takenDown ? null : urlOrNull(stored?.metadata.image),
      preset: record.preset,
      launchedAt: record.launchedAt,
      pair: { mint: record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
    });
  }
  return { network: deps.network.chain, creator, launches, observedAt: deps.now().toISOString() };
}
