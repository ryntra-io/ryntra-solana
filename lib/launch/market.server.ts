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
import type { StepTiming } from "../core/pipeline.ts";
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
import type { HolderBalance, LaunchMarketReader, MarketState, TradeHistory } from "../core/venues/meteora-dbc/market.server.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { createLaunchTradeVenue } from "../core/venues/meteora-dbc/trade.server.ts";
import { launchPair, launchPoolFee } from "./config.server.ts";
import { forgetSharedReads } from "../core/venues/meteora-dbc/market.server.ts";
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
/**
 * The newest page of the history for the first answer (SOL-P1): a token's market answers within the three seconds of
 * its limit even cold, with what this page reached; the full read goes on behind it.
 */
const FIRST_HISTORY_MS = 1_200;
/** How long a route waits for the full read before it answers with the first. */
export const FIRST_ANSWER_MS = 2_000;
/** A read still under way after this long is not waited for again: a node that never answers leaves no market stuck. */
const STUCK_MS = MARKET_BUDGET_MS + 15_000;
const AFTER_HISTORY_MS = 12_000;
/** The creator's other launches, each read again, inside the route's minute. */
const CREATOR_BUDGET_MS = 40_000;
/** How many of the creator's other launches are read again. */
const CREATOR_LAUNCHES = 5;
const ROWS = 100;
const POINTS = 2_000;

/**
 * What one read of a market knew beyond its response: the creator's own trades, whole or not — the flight log's
 * «Творець продав» comes from them —, the supply, and the graduated pool's first transaction when its history was read.
 */
export type LaunchMarketFacts = Readonly<{
  response: LaunchMarketResponse;
  creatorTrades: readonly LaunchTrade[];
  creatorTradesComplete: boolean;
  supplyRaw: string;
  graduated: Readonly<{ at: number; signature: string }> | null;
  /** The chain's state the read was made from: the curve with its config's prices and segments, the graduated pool. */
  state: MarketState;
  /** Every account of the mint with a balance, from the node's scan; null when the node would not answer it. */
  mintAccounts: readonly HolderBalance[] | null;
  /** The holders the read found, merged by owner — the traders, the creator, the vaults, the escrow and the mint's largest accounts. */
  foundHolders: readonly HolderBalance[];
  /** Whether the node answered the mint's largest accounts, so `foundHolders` hold the ten largest. */
  largestRead: boolean;
  /** Every trade the read found — the history, the opening minutes, the creator's own — the oldest first. */
  trades: readonly LaunchTrade[];
  /** Whether every trade of the token was read, and whether the last day's were. */
  historyComplete: boolean;
  dayReadWhole: boolean;
  /** Which part of the token's history was read — a window's figure is exact only where it reaches (SOL-L2). */
  cover: Readonly<{ complete: boolean; coveredFrom: number | null; gaps: readonly number[] }>;
  /** The token's own history (without the opening minutes and the creator's trades read apart): the trades the windows add up. */
  historyTrades: readonly LaunchTrade[];
  /** The graduated pool's liquidity moves among its transactions read, by slot; null when one was decoded without looking. */
  liquidityChangeSlots: readonly number[] | null;
  /** The labels each trader carries on this token — the creator, their bundle, the snipers. */
  labels: ReadonlyMap<string, readonly LaunchHolderLabel[]>;
  /** How long each step of this read took (SOL-P1) — what the route's `Server-Timing` names; never an address or an amount. */
  timings: readonly StepTiming[];
}>;

/** A part of the history read apart — the creator's own trades, the opening minutes — and whether it was read whole. */
type PartRead = Readonly<{ trades: readonly LaunchTrade[]; complete: boolean }>;

/**
 * One read of a market per process at a time, and its answer for a few seconds after it ends: `first` and `full` are
 * the read's two answers (`assemble`); `firstReady` — the first answer has come.
 */
type CachedRead = {
  at: number;
  settled: number | null;
  first: Promise<LaunchMarketFacts | null>;
  full: Promise<LaunchMarketFacts | null>;
  firstReady: boolean;
  /** The full read this one follows, while it goes on: a page that had the whole market keeps it, never a first answer in its place. */
  previous: Readonly<{ at: number; facts: LaunchMarketFacts }> | null;
  /** This read's full answer, once it ended with one. */
  fullFacts: LaunchMarketFacts | null;
};
const CACHE = new Map<string, CachedRead>();
const CACHE_MAX = 500;
/** How old a full read may be to stand in while the next one goes on (SOL-P1): the page's own refresh is 20 s. */
const PREVIOUS_MS = 60_000;
const CREATOR_CURVES = new Map<string, Readonly<{ at: number; value: number | null }>>();

/** One trade of a transaction: its signature, side, who and how much — the same trade read twice is one. */
const tradeKey = (trade: LaunchTrade) => `${trade.signature}:${trade.side}:${trade.trader}:${trade.tokensRaw}`;

/** A trade sent through Ryntra changes the market: its next read goes to the chain — the curve and the holders read again too. */
export function forgetLaunchMarket(cluster: string, token: string): void {
  CACHE.delete(`${cluster}:${token}`);
  forgetSharedReads(token);
}

export function readLaunchMarket(deps: MarketDeps, token: string): Promise<LaunchMarketResponse | null> {
  return readLaunchMarketFacts(deps, token).then((facts) => facts?.response ?? null);
}

/** Whether the next read of this market is served from this process's few seconds of memory — the route says so in `Server-Timing`. */
export function launchMarketCached(deps: MarketDeps, token: string): boolean {
  const hit = CACHE.get(`${deps.network.cluster}:${token}`);
  return hit !== undefined && hit.settled !== null && deps.now().getTime() - hit.settled < CACHE_MS;
}

/** The read under way or just ended, or a new one: a read in flight is joined, never started twice. */
function readOf(deps: MarketDeps, token: string): CachedRead {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = CACHE.get(key);
  if (hit && (hit.settled === null ? now - hit.at < STUCK_MS : now - hit.settled < CACHE_MS)) return hit;
  const { first, full } = assemble(deps, token);
  /* The last full read stands in while this one goes on, a minute at most. */
  const previous = hit && hit.settled !== null && hit.fullFacts ? { at: hit.settled, facts: hit.fullFacts } : (hit?.previous ?? null);
  const entry: CachedRead = { at: now, settled: null, first, full, firstReady: false, previous: previous && now - previous.at < PREVIOUS_MS ? previous : null, fullFacts: null };
  CACHE.delete(key);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, entry);
  void first.then(() => {
    entry.firstReady = true;
  });
  full.then(
    (facts) => {
      entry.fullFacts = facts;
      entry.settled = deps.now().getTime();
    },
    () => {
      if (CACHE.get(key) === entry) CACHE.delete(key);
    },
  );
  return entry;
}

/** The same read, with what it knew beyond the response — one read of the chain serves both. The full read, always. */
export function readLaunchMarketFacts(deps: MarketDeps, token: string): Promise<LaunchMarketFacts | null> {
  return readOf(deps, token).full;
}

/**
 * The market's answer for a page (SOL-P1): the full read when it ends inside `waitMs`; else, while a full read of the
 * last minute stands in, that one — a page that had the whole market never drops to a part of it; else the first
 * answer — `first: true`, and the page asks again in a moment. A first answer already there is given at once: a second
 * person opening the page while the full read goes on never waits for it. A read that fails is the full read's failure.
 */
export function readLaunchMarketAnswer(deps: MarketDeps, token: string, waitMs: number = FIRST_ANSWER_MS): Promise<Readonly<{ facts: LaunchMarketFacts | null; first: boolean; behind: boolean }>> {
  return marketAnswer(readOf(deps, token), waitMs, deps.now().getTime());
}

/**
 * The race behind `readLaunchMarketAnswer`, on a read's two answers — apart, so it is tested without a chain. `behind`:
 * the answer is not this read's own full one (a first answer, or the previous full read standing in) — the caller keeps
 * the full read going after its answer. The previous read stands in while it is under `PREVIOUS_MS` old at the answer.
 */
export async function marketAnswer<T>(
  read: Readonly<{ first: Promise<T>; full: Promise<T>; settled: number | null; firstReady: boolean; previous?: Readonly<{ at: number; facts: T }> | null }>,
  waitMs: number,
  now: number = Date.now(),
): Promise<Readonly<{ facts: T; first: boolean; behind: boolean }>> {
  if (read.settled !== null) return { facts: await read.full, first: false, behind: false };
  if (read.previous && now - read.previous.at < PREVIOUS_MS) {
    const answer = await within(read.full, waitMs);
    return answer.done ? { facts: answer.value, first: false, behind: false } : { facts: read.previous.facts, first: false, behind: true };
  }
  if (read.firstReady) return { facts: await read.first, first: true, behind: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs);
  });
  try {
    let fullDone = false;
    const answer = await Promise.race([
      read.full.then((facts) => {
        fullDone = true;
        return { facts, first: false, behind: false };
      }),
      late,
    ]);
    if (answer !== "late") return answer;
    const facts = await Promise.race([read.first, read.full]);
    return { facts, first: !fullDone, behind: !fullDone };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `read`'s answer if it comes within `ms`; its failure is the caller's. */
async function within<T>(read: Promise<T>, ms: number): Promise<Readonly<{ done: true; value: T }> | Readonly<{ done: false }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Readonly<{ done: false }>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([read.then((value) => ({ done: true as const, value })), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function curvesOf(reader: LaunchMarketReader, creator: string, now: number): Promise<number | null> {
  const hit = CREATOR_CURVES.get(creator);
  if (hit && now - hit.at < 60_000) return hit.value;
  const value = await reader.curvesBy(creator);
  CREATOR_CURVES.set(creator, { at: now, value });
  return value;
}

/**
 * One read of a market, in two answers (SOL-P1). The first comes as soon as the newest page of the history is read
 * inside `FIRST_HISTORY_MS` — what that page did not reach (the rest of the history, the creator's own trades, the
 * opening minutes) said as not read yet, as a read that ran out of time says it; a market whose whole history the page
 * read is answered whole at once. The full read goes on from there, with everything the first one decoded kept.
 */
function assemble(deps: MarketDeps, token: string): Readonly<{ first: Promise<LaunchMarketFacts | null>; full: Promise<LaunchMarketFacts | null> }> {
  let answerFirst: (facts: LaunchMarketFacts | null) => void = () => undefined;
  const first = new Promise<LaunchMarketFacts | null>((resolve) => {
    answerFirst = resolve;
  });
  const full = assembleInTwo(deps, token, (facts) => answerFirst(facts));
  /* A read that ends without a first answer — whole at once, not found, or failed — answers the first with its end. */
  full.then(answerFirst, () => answerFirst(null));
  return { first, full };
}

async function assembleInTwo(deps: MarketDeps, token: string, onFirst: (facts: LaunchMarketFacts) => void): Promise<LaunchMarketFacts | null> {
  const timings: StepTiming[] = [];
  const lap = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await run();
    } finally {
      timings.push({ name, ms: performance.now() - started });
    }
  };
  const record = await lap("record", () => readLaunchRecord(deps, deps.network.cluster, token));
  if (!record || record.state === "PENDING") return null;
  const launch: LaunchRecord = record;
  const reader = launchMarketReader(deps);
  const state = await lap("state", () => reader.state({ token, pool: record.pool, shared: true }));
  /* Two reads that hang on nothing of the history — the creator's other curves and Ryntra's referral account — and the scan of the mint's holders go at once beside it. */
  const curvesRead = lap("curves", () => curvesOf(reader, record.creator, deps.now().getTime()).catch(() => null));
  const trading = createLaunchTradeVenue({ connection: deps.connection, referralOwner: deps.network.referralOwner, poolFee: launchPoolFee(deps.network) });
  const referralRead = lap("referral", () => trading.referralAccount(state.curve.pairMint).catch(() => null));
  reader.scanHolders(token);
  const deadline = Date.now() + MARKET_BUDGET_MS;
  const newest = await lap("history", () => reader.trades({ token, state, creationSignature: record.signature, budgetMs: FIRST_HISTORY_MS }));
  /* The creator is the wallet the launch names: with «Спільнота» sharing its fees the curve's creator role is a vault. */
  const creator = record.creator;
  if (state.curve.migrated) await noteGraduation(deps.store, record, state.curve.finishedAt, deps.now()).catch(() => undefined);
  /*
   * The creator's own trades are read whole even when the token's history is not: their account of the token (what
   * they bought and sold) and of the pair currency (every buy their wallet paid for — the bundle's), since the token
   * opened. «The creator sold» never hangs on how long the history is.
   */
  const creatorAccounts = [
    getAssociatedTokenAddressSync(new PublicKey(token), new PublicKey(creator), true, TOKEN_2022_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(new PublicKey(state.curve.pairMint), new PublicKey(creator), true, new PublicKey(state.pairProgram)).toBase58(),
  ];
  const whole: PartRead = { trades: [], complete: true };
  const unread: PartRead = { trades: [], complete: false };
  if (newest.complete) return finish(newest, whole, whole, "");
  /* The first answer: the creator's trades and the opening minutes not read yet — the page says so, never «none». */
  onFirst(await finish(newest, unread, unread, ""));
  /* The rest of the history only where the newest page left transactions unread; a list that does not reach the creation stays as long as it is. */
  const history = newest.gaps.length
    ? await lap("history-rest", () => reader.trades({ token, state, creationSignature: record.signature, budgetMs: HISTORY_BUDGET_MS - FIRST_HISTORY_MS }))
    : newest;
  const createdAt = state.curve.activatedAt ?? history.created?.at ?? null;
  const creatorTime = Math.min(10_000, deadline - Date.now() - AFTER_HISTORY_MS);
  const creatorRead = history.complete
    ? whole
    : creatorTime >= 3_000
      ? await lap("creator", () => reader.accountTrades({ token, state, accounts: creatorAccounts, since: createdAt === null ? null : createdAt - 60, creationSignature: record.signature, budgetMs: creatorTime }))
      : unread;
  /* The snipers and the bundle are the opening minutes' trades: read back to the creation when the newest page did not reach it. */
  const openingTime = Math.min(12_000, deadline - Date.now() - AFTER_HISTORY_MS);
  const opening = history.complete
    ? whole
    : openingTime >= 3_000
      ? await lap("opening", () => reader.opening({ token, state, creationSignature: record.signature, createdAt, budgetMs: openingTime }))
      : unread;
  return finish(history, creatorRead, opening, "-full");

  /** The market from what was read: the history, the creator's own trades and the opening minutes, each whole or not. */
  /** `phase`: how its steps are named in `Server-Timing` — the full read's own after a first answer. */
  async function finish(history: TradeHistory, creatorRead: PartRead, opening: PartRead, phase: "" | "-full"): Promise<LaunchMarketFacts> {
    const createdAt = state.curve.activatedAt ?? history.created?.at ?? null;
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
    const escrow = launch.lock?.escrow ?? null;
    const traded = known.flatMap((trade) => (trade.account ? [{ owner: trade.trader, account: trade.account }] : []));
    const read = await lap(`holders${phase}`, () => reader.holders({ token, state, wallets: [...new Set(known.map((trade) => trade.trader))], accounts: traded, escrow }));

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
    const curves = await curvesRead;
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
      creatorTradesWhole: history.complete || creatorRead.complete,
    });

    const pair = launchPair(deps.network, launch.preset, launch.pairMint);
    const supplyUi = uiAmount(supply, state.tokenDecimals);
    const money = (pairValue: number) => ({ pair: pairValue, usd: pair.dollar ? pairValue * pair.usdPrice : null });
    const pairUi = (raw: bigint | string) => uiAmount(raw, state.pairDecimals);
    const dayAgo = now - 24 * 60 * 60;
    const volumeRaw = history.trades.filter((trade) => trade.at >= dayAgo).reduce((total, trade) => total + BigInt(trade.pairRaw), 0n);
    const liquidityPair = state.graduated
      ? pairUi(state.graduated.pairReserveRaw) + uiAmount(state.graduated.tokenReserveRaw, state.tokenDecimals) * state.price
      : pairUi(state.curve.quoteReserveRaw);
    const preset = launchPreset(launch.preset);
    const sniperEnds = createdAt !== null && preset ? createdAt + preset.sniperFee.seconds : null;
    const referral = (await referralRead) !== null;
    const points = marketSeries({ trades: history.trades, openedAt: createdAt, openingPrice: state.openingPrice, priceNow: state.price, now, supply: supplyUi, pairUsd: 1 });

    const response: LaunchMarketResponse = {
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
        : { nowBps: await lap(`fee${phase}`, () => reader.feeNowBps(state, "buy")), endBps: preset?.sniperFee.endBps ?? 100, sniperUntil: sniperEnds !== null && now < sniperEnds ? new Date(sniperEnds * 1000).toISOString() : null },
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
    return {
      response,
      creatorTrades: known.filter((trade) => trade.trader === creator),
      creatorTradesComplete: history.complete || creatorRead.complete,
      supplyRaw: state.supplyRaw,
      graduated: history.graduated,
      state,
      mintAccounts: read.accounts,
      foundHolders: read.balances,
      largestRead: read.largestRead,
      trades: known,
      historyComplete: history.complete,
      dayReadWhole: windowReadWhole(history, dayAgo),
      timings: [...timings],
      cover: { complete: history.complete, coveredFrom: history.coveredFrom, gaps: [...history.gaps] },
      historyTrades: history.trades,
      liquidityChangeSlots: history.liquidityChangeSlots,
      labels,
    };
  }
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