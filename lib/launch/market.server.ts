/**
 * A launched token's market as its page and the phone read it — assembled
 * from the chain now, around the record Ryntra kept of the launch.
 *
 * The figures are the programs' own: the price from the curve's or the pool's
 * square-root price, every trade from a swap event, every balance from a token
 * account. The labels, the groups' shares, the facts of risk and the chart are
 * built from those by the core (`lib/core/venues/meteora-dbc/market.ts`). The
 * creator's other launches are the ones Ryntra recorded, each read again from
 * the chain. A read is kept a few seconds so a burst of views reads the chain
 * once; a trade sent here forgets it at once.
 */

import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { LaunchCreatorResponse, LaunchMarketResponse } from "../api/v1/contract.ts";
import {
  chartMarkers,
  creatorActivity,
  creatorSoldShare,
  holderGroups,
  windowReadWhole,
  isPerson,
  launchRiskFacts,
  peopleHoldings,
  marketSeries,
  priceMoveBps,
  shareBps,
  uiAmount,
  walletLabels,
  type LaunchHolder,
  type LaunchHolderLabel,
  type LaunchTrade,
} from "../core/venues/meteora-dbc/market.ts";
import type { LaunchMarketReader, MarketState } from "../core/venues/meteora-dbc/market.server.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { createLaunchTradeVenue } from "../core/venues/meteora-dbc/trade.server.ts";
import { launchPair, launchPoolFee } from "./config.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";
import type { LaunchDeps, LaunchReadDeps, LaunchRecord } from "./flow.server.ts";
import { readLaunchRecord } from "./flow.server.ts";
import { noteGraduation } from "./graduation.server.ts";

export type MarketDeps = Pick<LaunchDeps, "network" | "connection" | "store" | "now"> & Pick<LaunchReadDeps, "second" | "adopt">;

/** How long a read of a token's market is served again. */
const CACHE_MS = 5_000;
/**
 * How long one read of a market may take, inside the route's minute: its history first, the opening minutes when the
 * newest page did not reach them while time is left, and room for the holders and the rest. What is unread when time
 * runs out is said as unread.
 */
const MARKET_BUDGET_MS = 45_000;
const HISTORY_BUDGET_MS = 25_000;
const AFTER_HISTORY_MS = 12_000;
/** The creator's other launches, each read again, inside the route's minute. */
const CREATOR_BUDGET_MS = 40_000;
/** How many of the creator's other launches are read again. */
const CREATOR_LAUNCHES = 5;
const ROWS = 100;
const POINTS = 2_000;

const CACHE = new Map<string, Readonly<{ at: number; value: Promise<LaunchMarketResponse | null> }>>();
const CREATOR_CURVES = new Map<string, Readonly<{ at: number; value: number | null }>>();

/** One trade of a transaction: its signature, side, who and how much — the same trade read twice is one. */
const tradeKey = (trade: LaunchTrade) => `${trade.signature}:${trade.side}:${trade.trader}:${trade.tokensRaw}`;

/** A trade sent through Ryntra changes the market: its next read goes to the chain. */
export function forgetLaunchMarket(cluster: string, token: string): void {
  CACHE.delete(`${cluster}:${token}`);
}

export function readLaunchMarket(deps: MarketDeps, token: string): Promise<LaunchMarketResponse | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = CACHE.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = assemble(deps, token);
  CACHE.set(key, { at: now, value });
  value.catch(() => CACHE.delete(key));
  return value;
}

async function curvesOf(reader: LaunchMarketReader, creator: string, now: number): Promise<number | null> {
  const hit = CREATOR_CURVES.get(creator);
  if (hit && now - hit.at < 60_000) return hit.value;
  const value = await reader.curvesBy(creator);
  CREATOR_CURVES.set(creator, { at: now, value });
  return value;
}

async function assemble(deps: MarketDeps, token: string): Promise<LaunchMarketResponse | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const reader = launchMarketReader(deps);
  const state = await reader.state({ token, pool: record.pool });
  const deadline = Date.now() + MARKET_BUDGET_MS;
  const history = await reader.trades({ token, state, creationSignature: record.signature, budgetMs: HISTORY_BUDGET_MS });
  /* The creator is the wallet the launch names: with «Спільнота» sharing its fees the curve's creator role is a vault. */
  const creator = record.creator;
  if (state.curve.migrated) await noteGraduation(deps.store, record, state.curve.finishedAt, deps.now()).catch(() => undefined);
  const createdAt = state.curve.activatedAt ?? history.created?.at ?? null;
  /*
   * The creator's own trades are read whole even when the token's history is not: their account of the token (what
   * they bought and sold) and of the pair currency (every buy their wallet paid for — the bundle's), since the token
   * opened. «The creator sold» never hangs on how long the history is.
   */
  const creatorAccounts = [
    getAssociatedTokenAddressSync(new PublicKey(token), new PublicKey(creator), true, TOKEN_2022_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(new PublicKey(state.curve.pairMint), new PublicKey(creator), true, new PublicKey(state.pairProgram)).toBase58(),
  ];
  const creatorTime = Math.min(10_000, deadline - Date.now() - AFTER_HISTORY_MS);
  const creatorRead = history.complete
    ? { trades: [] as LaunchTrade[], complete: true }
    : creatorTime >= 3_000
      ? await reader.accountTrades({ token, state, accounts: creatorAccounts, since: createdAt === null ? null : createdAt - 60, creationSignature: record.signature, budgetMs: creatorTime })
      : { trades: [] as LaunchTrade[], complete: false };
  /* The snipers and the bundle are the opening minutes' trades: read back to the creation when the newest page did not reach it. */
  const openingTime = Math.min(12_000, deadline - Date.now() - AFTER_HISTORY_MS);
  const opening = history.complete
    ? { trades: [] as LaunchTrade[], complete: true }
    : openingTime >= 3_000
      ? await reader.opening({ token, state, creationSignature: record.signature, createdAt, budgetMs: openingTime })
      : { trades: [] as LaunchTrade[], complete: false };
  const openingRead = history.complete || opening.complete;
  const seen = new Set(history.trades.map(tradeKey));
  const known = [...history.trades];
  for (const trade of [...opening.trades, ...creatorRead.trades]) {
    if (seen.has(tradeKey(trade))) continue;
    seen.add(tradeKey(trade));
    known.push(trade);
  }
  known.sort((a, b) => a.slot - b.slot || a.at - b.at);
  const labels = walletLabels({ trades: known, creator, createdSlot: history.created?.slot ?? null, createdAt });
  const escrow = record.lock?.escrow ?? null;
  const traded = known.flatMap((trade) => (trade.account ? [{ owner: trade.trader, account: trade.account }] : []));
  const read = await reader.holders({ token, state, wallets: [...new Set(known.map((trade) => trade.trader))], accounts: traded, escrow });

  const supply = BigInt(state.supplyRaw);
  const special = (owner: string): LaunchHolderLabel[] | null =>
    owner === state.curve.baseVault ? ["curve"] : owner === state.graduated?.tokenVault ? ["pool"] : owner === escrow ? ["lock"] : null;
  const holders: LaunchHolder[] = read.balances
    .map((balance) => ({ owner: balance.owner, amountRaw: balance.amountRaw, shareBps: shareBps(BigInt(balance.amountRaw), supply), labels: special(balance.owner) ?? labels.get(balance.owner) ?? [] }))
    .sort((a, b) => (BigInt(b.amountRaw) > BigInt(a.amountRaw) ? 1 : BigInt(b.amountRaw) < BigInt(a.amountRaw) ? -1 : 0));
  const groups = holderGroups(holders, supply);
  /* People holding the token — the creator counted when their buy sits in their lock. */
  const people = peopleHoldings(holders);
  /* The node's count is of accounts with a balance — the vaults and the escrow among them — and those are not people. */
  const notPeople = holders.filter((holder) => !isPerson(holder)).length;
  const count = read.totalHolders === null ? people.length : Math.max(people.length, read.totalHolders - notPeople);
  const nowMs = deps.now().getTime();
  const now = Math.floor(nowMs / 1000);
  const activity = creatorActivity(known, creator);
  const curves = await curvesOf(reader, creator, nowMs);
  const risk = launchRiskFacts({
    creator,
    creatorAccount: creatorAccounts[0]!,
    activity,
    groups,
    supplyRaw: supply,
    openingRead,
    holders: { count, atLeast: read.totalHolders === null },
    createdAt,
    now,
    historyComplete: history.complete,
    bundleWhole: history.complete || (openingRead && creatorRead.complete),
    tradesRead: history.trades.length,
    creatorCurves: curves,
  });

  const pair = launchPair(deps.network, record.preset);
  const supplyUi = uiAmount(supply, state.tokenDecimals);
  const money = (pairValue: number) => ({ pair: pairValue, usd: pair.dollar ? pairValue * pair.usdPrice : null });
  const pairUi = (raw: bigint | string) => uiAmount(raw, state.pairDecimals);
  const dayAgo = now - 24 * 60 * 60;
  const volumeRaw = history.trades.filter((trade) => trade.at >= dayAgo).reduce((total, trade) => total + BigInt(trade.pairRaw), 0n);
  const liquidityPair = state.graduated
    ? pairUi(state.graduated.pairReserveRaw) + uiAmount(state.graduated.tokenReserveRaw, state.tokenDecimals) * state.price
    : pairUi(state.curve.quoteReserveRaw);
  const preset = launchPreset(record.preset);
  const sniperEnds = createdAt !== null && preset ? createdAt + preset.sniperFee.seconds : null;
  const trading = createLaunchTradeVenue({ connection: deps.connection, referralOwner: deps.network.referralOwner, poolFee: launchPoolFee(deps.network) });
  const referral = (await trading.referralAccount(state.curve.pairMint).catch(() => null)) !== null;
  const points = marketSeries({ trades: history.trades, openedAt: createdAt, openingPrice: state.openingPrice, priceNow: state.price, now, supply: supplyUi, pairUsd: 1 });

  return {
    network: deps.network.chain,
    token,
    venue: state.graduated ? "pool" : "curve",
    pair: { mint: state.curve.pairMint, symbol: pair.symbol, decimals: state.pairDecimals, dollar: pair.dollar },
    supplyRaw: state.supplyRaw,
    tokenDecimals: state.tokenDecimals,
    price: money(state.price),
    marketCap: money(state.price * supplyUi),
    sinceLaunchBps: priceMoveBps(state.openingPrice, state.price),
    liquidity: money(liquidityPair),
    volume24h: { ...money(pairUi(volumeRaw)), complete: windowReadWhole(history, dayAgo) },
    progress: { bps: state.curve.progressBps, migrated: state.curve.migrated, reserveRaw: state.curve.quoteReserveRaw, thresholdRaw: state.curve.thresholdRaw },
    curveFee: state.curve.migrated
      ? null
      : { nowBps: await reader.feeNowBps(state, "buy"), endBps: preset?.sniperFee.endBps ?? 100, sniperUntil: sniperEnds !== null && now < sniperEnds ? new Date(sniperEnds * 1000).toISOString() : null },
    holders: {
      count,
      atLeast: read.totalHolders === null,
      rows: holders.slice(0, ROWS).map((holder) => ({ ...holder, labels: [...holder.labels] })),
      /* Unread opening minutes: the snipers and the bundle are not known, never «none». */
      /* A buy the creator's wallet paid for can come at any time: on a history read in part the bundle is a floor. */
      groups: {
        creatorBps: groups.creator.shareBps,
        snipers: openingRead ? groups.snipers : null,
        bundle: openingRead ? { ...groups.bundle, atLeast: !(history.complete || creatorRead.complete) } : null,
        top10Bps: groups.top10.shareBps,
      },
    },
    trades: {
      rows: [...history.trades]
        .reverse()
        .slice(0, ROWS)
        .map((trade) => ({
          signature: trade.signature,
          at: new Date(trade.at * 1000).toISOString(),
          side: trade.side,
          venue: trade.venue,
          trader: trade.trader,
          payer: trade.payer,
          traderLabels: labels.get(trade.trader) ?? [],
          tokensRaw: trade.tokensRaw,
          pairRaw: trade.pairRaw,
          feeRaw: trade.feeRaw,
          marketCapPair: trade.priceAfter * supplyUi,
        })),
      complete: history.complete,
      read: history.trades.length,
    },
    chart: {
      points: points.slice(-POINTS).map((point) => ({ t: point.t, marketCapPair: point.marketCapUsd })),
      markers: chartMarkers(known, creator, history.graduated).slice(-500),
    },
    risk,
    creator: { address: creator, curves, tradesComplete: history.complete || creatorRead.complete },
    trading: { venue: state.graduated ? "pool" : "curve", pool: state.graduated?.pool ?? state.curve.pool, referral, jupiter: deps.network.jupiter && state.curve.migrated },
    observedAt: deps.now().toISOString(),
  };
}

/**
 * The creator's other Ryntra launches, the newest first, each read again: how
 * far its curve went, whether it graduated, and what share of the tokens the
 * creator bought they sold — said only when the token's whole history was read.
 * Read on its own, after the market, so the page never waits for it.
 */
export async function readCreatorLaunches(deps: MarketDeps, token: string): Promise<LaunchCreatorResponse | null> {
  const current = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!current || current.state === "PENDING") return null;
  const reader = launchMarketReader(deps);
  const records = (await deps.store.collection<LaunchRecord>("launchesByCreator").valuesWithPrefix(`solana:${deps.network.cluster}:${current.creator}:`))
    .filter((record) => record.token !== current.token && record.state !== "PENDING" && record.cluster === deps.network.cluster)
    .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt))
    .slice(0, CREATOR_LAUNCHES);
  const launches: LaunchCreatorResponse["launches"] = [];
  const deadline = Date.now() + CREATOR_BUDGET_MS;
  /* One at a time: a public node answers a burst with 429. What time does not reach is listed unread. */
  for (const record of records) {
    const left = deadline - Date.now();
    let state: MarketState | null = null;
    let sold: Readonly<{ bps: number; of: "bought" | "supply" }> | null = null;
    let soldRead = false;
    try {
      if (left < 6_000) throw new Error("No time left in this read.");
      state = await reader.state({ token: record.token, pool: record.pool });
      const history = await reader.trades({ token: record.token, state, creationSignature: record.signature, limit: 100, budgetMs: Math.min(12_000, left - 4_000) });
      if (history.complete) {
        /* The token page's own rule: of what they bought here, or of the supply when they sold more than that. */
        sold = creatorSoldShare(creatorActivity(history.trades, record.creator), BigInt(state.supplyRaw));
        soldRead = true;
      }
    } catch {
      /* Unread stays unread: no figure on a guess. */
    }
    launches.push({
      token: record.token,
      name: record.name,
      symbol: record.symbol,
      preset: record.preset,
      launchedAt: record.launchedAt,
      progressBps: state ? state.curve.progressBps : null,
      migrated: state ? state.curve.migrated : null,
      creatorSoldBps: soldRead ? (sold?.bps ?? 0) : null,
      creatorSoldOf: sold?.of ?? null,
    });
  }
  return { network: deps.network.chain, token, creator: current.creator, launches, observedAt: deps.now().toISOString() };
}