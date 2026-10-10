/**
 * A launched market read whole — one read serves the row of «Лаунчі на
 * Ryntra», the market's card and the token's «Здоров'я ринку»:
 *
 * - the market's facts from the chain — the same read the token's page makes:
 *   the curve with its config's prices and segments, the graduated pool, every
 *   trade found, every account of the mint (or the ones found);
 * - Ryntra's steps on it, read from their DLMM position;
 * - the executor's receipts of its acts, and the creator's lock;
 * - Ryntra's own wallets: the internal ones and its published identities;
 * - whether Ryntra's executor acts on this network now.
 *
 * Every figure is then made by its one definition in
 * `lib/core/launch/market-health.ts`. One read of a market runs at a time; it is
 * served again for a while, and an older one answers at once while it is read
 * again behind the answer. When the chain fails, the last good read stands with
 * its own time, never a figure on a guess. What was not read is null. Only
 * what the answers need is kept — never the trades or the accounts read.
 */

import { derivePoolAuthority } from "@meteora-ag/cp-amm-sdk";
import { deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";

import type { LaunchMarketCardResponse, LaunchMarketDepthView, LaunchMarketHealthResponse, LaunchMarketRow, LaunchTokenResponse } from "../api/v1/contract.ts";
import { FLOOR_RULE, priceOfBin, type JournalKind } from "../core/launch/autopilot.ts";
import {
  CONCENTRATION_MARK_BPS,
  DEPTH_DROPS_BPS,
  HOLDER_MIN_USD,
  curveDepthRaw,
  holdersAndConcentration,
  ladderDepthRaw,
  marketCycleState,
  marketRules,
  poolDepthRaw,
  survival,
  type CycleRead,
  type HoldersRead,
  type Survival,
} from "../core/launch/market-health.ts";
import { observeCreatorLock } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { creatorActivity, creatorSoldShare, priceFromSqrtX64, uiAmount } from "../core/venues/meteora-dbc/market.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { autopilotReceipts, floorRecord, type AutopilotReceipt } from "./autopilot.server.ts";
import { marketBudget, type LadderRead } from "./budget.server.ts";
import { launchExecutorAddress, launchPair } from "./config.server.ts";
import type { ExecutorMarket } from "./executor.server.ts";
import { readLaunchRecord, type LaunchRecord } from "./flow.server.ts";
import { readLaunchMarketFacts, type LaunchMarketFacts, type MarketDeps } from "./market.server.ts";
import { metadataOfUri } from "./metadata.server.ts";

/** Ryntra's own wallets, and whether every list of them was read — the admin's among them. */
export type OwnWallets = Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>;

/** Whether Ryntra's executor acts on this network now — its key here, Launch open, its passes coming —, and whether it may move its steps. */
export type ExecutorRuns = Readonly<{ acts: boolean; ladder: boolean }>;

export type HealthDeps = MarketDeps &
  Readonly<{
    /** Where a launch's metadata lives — its picture is named from there. */
    origin: string;
    /** Ryntra's own wallets: the internal ones and its published identities. A launch whose creator is one of them is technical validation. */
    ryntraWallets: () => Promise<OwnWallets>;
    executorRuns: () => Promise<ExecutorRuns>;
    /** What the executor keeps on a market and the operator's stop on it; absent where no executor's records are read. */
    executorOf?: (token: string) => Promise<ExecutorFacts>;
  }>;

/** The operator's stop that holds on a market, and what the executor keeps there — its graduation in flight, its failures, its budget. */
export type ExecutorFacts = Readonly<{
  stop: Readonly<{ scope: "all" | "market"; at: string }> | null;
  market: ExecutorMarket | null;
  /** The switch or the executor's record could not be read now: nothing of the executor's is claimed for the market. */
  unread?: boolean;
}>;
const NO_EXECUTOR_FACTS: ExecutorFacts = { stop: null, market: null };

/** How long a read of a market is served again — briefly when Ryntra's own wallets were not read whole, or there is no market —, and how long the last good one stands in. */
const FRESH_MS = 20_000;
const BRIEF_MS = 5_000;
const FALLBACK_MS = 10 * 60 * 1000;
/** The most reads kept, and the most good ones standing in; the oldest go first. */
const SETTLED_MAX = 2_000;
const LAST_GOOD_MAX = 500;
const SETTLED = new Map<string, Readonly<{ at: number; value: MarketRead | null }>>();
const INFLIGHT = new Map<string, Promise<MarketRead | null>>();
const LAST_GOOD = new Map<string, MarketRead>();
const DBC_AUTHORITY = deriveDbcPoolAuthority().toBase58();
const DAMM_AUTHORITY = derivePoolAuthority().toBase58();

/** The creator's lock as the chain shows it; unix seconds, null where the escrow could not be read. */
export type LockRead = Readonly<{ escrow: string; cliffAt: number | null; endsAt: number | null }>;

/** What the answers need of the chain's state: the curve's way, the pool's two sides, the price. */
export type MarketBasics = Readonly<{
  migrated: boolean;
  progressBps: number;
  thresholdRaw: string;
  tokenDecimals: number;
  pairDecimals: number;
  /** The price now, the pair currency per token. */
  price: number;
  graduated: Readonly<{ pool: string; pairReserveRaw: string; tokenReserveRaw: string }> | null;
}>;

/** What the figures are made from, and the figures — null when the chain could not be read. */
export type MarketRead = Readonly<{
  record: LaunchRecord;
  name: string;
  symbol: string;
  image: string | null;
  technicalValidation: boolean;
  /** Every list of Ryntra's own wallets was read: the technical validation and the holders' exclusions are whole. */
  walletsComplete: boolean;
  /** Ryntra's executor named on this network — its actions are the ones the log calls Ryntra's; null while there is none. */
  executor: string | null;
  runs: ExecutorRuns;
  /** The operator's stop on this market and what the executor keeps on it. */
  executorFacts: ExecutorFacts;
  ladder: LadderRead;
  /** Ryntra's last act on this market, from its receipts. */
  lastAction: Readonly<{ kind: JournalKind; at: string | null; signature: string }> | null;
  lock: LockRead | null;
  basics: MarketBasics | null;
  figures: MarketFigures | null;
  observedAt: string;
}>;

/**
 * A stop of Ryntra's acts on a market: `OPERATOR` — Ryntra's operator stopped its executor on this market or on every
 * market; `STOPPED` — its steps stand and its executor does not act here now (Launch's stop, no key, or no recent pass);
 * `RISK_LIMIT` — a limit the executor records.
 */
export type MarketPause = Readonly<{ code: "OPERATOR" | "STOPPED" | "RISK_LIMIT"; at: number | null }>;

export type MarketFigures = Readonly<{
  cycle: CycleRead;
  depth: readonly LaunchMarketDepthView[];
  survival: Survival;
  graduatedAt: number | null;
  lastTradeAt: number | null;
  holders: HoldersRead;
  creatorSold: boolean | null;
  creatorSoldShare: Readonly<{ bps: number; of: "bought" | "supply" }> | null;
  pause: MarketPause | null;
}>;

const seconds = (iso: string | null | undefined): number | null => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? Math.floor(at / 1000) : null;
};
const iso = (unix: number | null): string | null => (unix === null ? null : new Date(unix * 1000).toISOString());

/** A map that keeps its newest `max` entries: a key written again moves to the newest. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as string);
}

const freshFor = (read: MarketRead | null) => (read && read.figures && read.walletsComplete ? FRESH_MS : BRIEF_MS);

/**
 * The market read: one read at a time per market — a second caller waits on the one running —, served again for a
 * while from when it finished; when the chain fails, or Ryntra's own wallets were not read whole, the last good read
 * stands in with its own time.
 */
export function readMarket(deps: HealthDeps, token: string): Promise<MarketRead | null> {
  const key = `${deps.network.cluster}:${token}`;
  const settled = SETTLED.get(key);
  if (settled && deps.now().getTime() - settled.at < freshFor(settled.value)) return Promise.resolve(settled.value);
  const running = INFLIGHT.get(key);
  if (running) return running;
  const value = assemble(deps, token).then((read) => {
    const done = deps.now().getTime();
    let answer = read;
    if (read?.figures && read.walletsComplete) remember(LAST_GOOD, key, read, LAST_GOOD_MAX);
    else if (read) {
      const good = LAST_GOOD.get(key);
      if (good && done - Date.parse(good.observedAt) < FALLBACK_MS) answer = good;
    }
    remember(SETTLED, key, { at: done, value: answer }, SETTLED_MAX);
    return answer;
  });
  INFLIGHT.set(key, value);
  const clear = () => {
    if (INFLIGHT.get(key) === value) INFLIGHT.delete(key);
  };
  value.then(clear, clear);
  return value;
}

/**
 * A read to answer with at once: one fresh enough as it is; an older good one within the time it may stand in, with
 * `behind` — the read again, for after the answer; none — read now.
 */
export async function marketForAnswer(deps: HealthDeps, token: string): Promise<Readonly<{ read: MarketRead | null; behind: (() => Promise<unknown>) | null }>> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const settled = SETTLED.get(key);
  if (settled && now - settled.at < freshFor(settled.value)) return { read: settled.value, behind: null };
  const good = lastGoodMarket(deps.network.cluster, token, now);
  if (good) return { read: good, behind: () => readMarket(deps, token) };
  return { read: await readMarket(deps, token), behind: null };
}

/** The last read of a market that had its figures, within the time a good read may stand in; null when there is none. */
export function lastGoodMarket(cluster: string, token: string, now: number = Date.now()): MarketRead | null {
  const good = LAST_GOOD.get(`${cluster}:${token}`) ?? null;
  return good && now - Date.parse(good.observedAt) < FALLBACK_MS ? good : null;
}

/** Ryntra's steps on a token: none, placed with each step's holding, or placed and not read now. */
async function readLadder(deps: HealthDeps, token: string, tokenDecimals: number, pairDecimals: number): Promise<LadderRead> {
  const stored = await floorRecord(deps.store, deps.network.cluster, token).catch(() => null);
  if (!stored || stored.state !== "PLACED" || !stored.pool) return { state: "NONE" };
  if (!stored.position) return { state: "UNREAD", pool: stored.pool, position: null };
  /* The DLMM client is loaded only for a token that has the steps. */
  const { createFloorVenue } = await import("../core/venues/meteora-dlmm/floor.server.ts");
  const venue = createFloorVenue({ connection: deps.connection, cluster: deps.network.cluster });
  const pool = stored.pool;
  const position = stored.position;
  const once = () => venue.readSteps(pool, position).catch(() => null);
  /* A public node's refusal is often a moment's: asked once more before the steps are said not read. */
  let steps = await once();
  if (!steps?.bins) {
    await new Promise((done) => setTimeout(done, 600));
    steps = await once();
  }
  if (!steps?.bins) return { state: "UNREAD", pool, position };
  const price = (binId: number) => priceOfBin(binId, FLOOR_RULE.binStep, tokenDecimals, pairDecimals);
  return {
    state: "PLACED",
    pool: stored.pool,
    position: stored.position,
    pairRaw: steps.pairRaw,
    tokensRaw: steps.tokenRaw,
    bins: steps.bins.map((bin) => ({ price: price(bin.binId), pairRaw: bin.pairRaw })),
    lowerPrice: price(steps.lowerBinId),
    upperPrice: price(steps.upperBinId),
  };
}

async function readLock(deps: HealthDeps, record: LaunchRecord): Promise<LockRead | null> {
  if (!record.lock || record.lock.state === "FAILED") return null;
  const observed = await observeCreatorLock(deps.connection, record.lock.escrow).catch(() => undefined);
  /* An escrow the chain does not hold (yet, or never) is no lock; one not read is a lock of unknown dates. */
  if (observed === null) return record.lock.state === "LOCKED" ? { escrow: record.lock.escrow, cliffAt: null, endsAt: null } : null;
  if (observed === undefined) return { escrow: record.lock.escrow, cliffAt: null, endsAt: null };
  return { escrow: record.lock.escrow, cliffAt: observed.cliffAt, endsAt: observed.endsAt };
}

async function assemble(deps: HealthDeps, token: string): Promise<MarketRead | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const pair = launchPair(deps.network, record.preset);
  const [stored, wallets, receipts, lock, facts, runs] = await Promise.all([
    metadataOfUri(deps.store, record.metadataUri, deps.origin).catch(() => null),
    deps.ryntraWallets().catch((): OwnWallets => ({ wallets: new Set<string>(), complete: false })),
    autopilotReceipts(deps.store, deps.network.cluster, token).catch(() => [] as AutopilotReceipt[]),
    readLock(deps, record),
    readLaunchMarketFacts(deps, token).catch(() => null),
    deps.executorRuns().catch((): ExecutorRuns => ({ acts: false, ladder: false })),
  ]);
  /* A switch that could not be read is said as not read — no stop invented, and nothing of the executor's claimed. */
  const executorFacts = deps.executorOf ? await deps.executorOf(token).catch((): ExecutorFacts => ({ stop: null, market: null, unread: true })) : NO_EXECUTOR_FACTS;
  const ladder = await readLadder(deps, token, facts?.state.tokenDecimals ?? 6, pair.decimals);
  return marketReadOf({
    record,
    metadata: stored ? { name: stored.metadata.name, symbol: stored.metadata.symbol, image: stored.metadata.image ?? null } : null,
    wallets,
    receipts,
    lock,
    facts,
    ladder,
    executor: launchExecutorAddress(deps.network),
    runs,
    executorFacts,
    usdPerPair: pair.dollar ? 1 : pair.usdPrice > 0 ? pair.usdPrice : null,
    now: deps.now(),
  });
}

/** A market's read from its parts — what the answers need of them, and the figures. Pure: the parts are its input. */
export function marketReadOf(args: Readonly<{
  record: LaunchRecord;
  metadata: Readonly<{ name: string; symbol: string; image: string | null }> | null;
  wallets: OwnWallets;
  receipts: readonly AutopilotReceipt[];
  lock: LockRead | null;
  facts: LaunchMarketFacts | null;
  ladder: LadderRead;
  executor: string | null;
  runs: ExecutorRuns;
  executorFacts?: ExecutorFacts;
  usdPerPair: number | null;
  now: Date;
}>): MarketRead {
  const { record, facts, ladder, executor } = args;
  const last = [...args.receipts].reverse().find((receipt) => receipt.actor === "ryntra") ?? null;
  const state = facts?.state ?? null;
  return {
    record,
    name: args.metadata?.name ?? record.name,
    symbol: args.metadata?.symbol ?? record.symbol,
    image: args.metadata?.image ?? null,
    technicalValidation: args.wallets.wallets.has(record.creator) || (executor !== null && record.creator === executor),
    walletsComplete: args.wallets.complete,
    executor,
    runs: args.runs,
    executorFacts: args.executorFacts ?? NO_EXECUTOR_FACTS,
    ladder,
    lastAction: last ? { kind: last.kind, at: last.at, signature: last.signature } : null,
    lock: args.lock,
    basics: state
      ? {
          migrated: state.curve.migrated,
          progressBps: state.curve.progressBps,
          thresholdRaw: state.curve.thresholdRaw,
          tokenDecimals: state.tokenDecimals,
          pairDecimals: state.pairDecimals,
          price: state.price,
          graduated: state.graduated ? { pool: state.graduated.pool, pairReserveRaw: state.graduated.pairReserveRaw, tokenReserveRaw: state.graduated.tokenReserveRaw } : null,
        }
      : null,
    figures: facts
      ? marketFigures({ facts, record, ladder, receipts: args.receipts, wallets: args.wallets.wallets, lock: args.lock, runs: args.runs, executorFacts: args.executorFacts, now: Math.floor(args.now.getTime() / 1000), usdPerPair: args.usdPerPair })
      : null,
    observedAt: args.now.toISOString(),
  };
}

/**
 * A stop of Ryntra's acts on a market: the operator's first, at any stage of the market; then steps standing where the
 * executor does not act now, may not move them, or moves none — the ladder moves only on a market Ryntra launched itself
 * (`ours`). Null when Ryntra's acts there go on.
 */
export function marketPause(args: Readonly<{ stop: ExecutorFacts["stop"]; migrated: boolean; ladder: LadderRead["state"]; runs: ExecutorRuns; ours: boolean }>): MarketPause | null {
  if (args.stop) return { code: "OPERATOR", at: seconds(args.stop.at) };
  return args.migrated && args.ladder !== "NONE" && !(args.runs.acts && args.runs.ladder && args.ours) ? { code: "STOPPED", at: null } : null;
}

/** The states of a full curve not yet on the DEX: it takes no trade until it moves. */
const FULL_CURVE: ReadonlySet<CycleRead["state"]> = new Set(["GRADUATION_READY", "MIGRATING", "MIGRATION_FAILED"]);

/** Every figure of a market from one read, by the definitions of `lib/core/launch/market-health.ts`. Pure: the read is its input. */
export function marketFigures(args: Readonly<{
  facts: LaunchMarketFacts;
  record: LaunchRecord;
  ladder: LadderRead;
  receipts: readonly AutopilotReceipt[];
  wallets: ReadonlySet<string>;
  lock: LockRead | null;
  runs: ExecutorRuns;
  executorFacts?: ExecutorFacts;
  now: number;
  usdPerPair: number | null;
}>): MarketFigures {
  const { facts, record, ladder, receipts, runs, now } = args;
  const { stop, market } = args.executorFacts ?? NO_EXECUTOR_FACTS;
  const state = facts.state;
  const curve = state.curve;
  const creator = record.creator;

  /* The first trade on the curve by a wallet other than the creator's, and not one the creator's wallet paid for. */
  const foreign = facts.trades.filter((trade) => trade.venue === "curve" && trade.trader !== creator && trade.payer !== creator);
  const foreignAt = foreign.length ? Math.min(...foreign.map((trade) => trade.at)) : null;
  const lastTradeAt = facts.trades.length ? Math.max(...facts.trades.map((trade) => trade.at)) : null;
  const graduation = receipts.find((receipt) => receipt.kind === "GRADUATED") ?? null;
  const graduatedAt = curve.migrated ? (seconds(graduation?.at) ?? facts.graduated?.at ?? curve.finishedAt) : null;
  /* The steps as they stand: their latest placing, and their latest move up or top-up since. */
  const placed = [...receipts].reverse().find((receipt) => receipt.kind === "FLOOR_PLACED") ?? null;
  const placedAt = seconds(placed?.at);
  const maintained = placedAt === null ? null : ([...receipts].reverse().find((receipt) => (receipt.kind === "FLOOR_RAISED" || receipt.kind === "FLOOR_ADDED") && (seconds(receipt.at) ?? 0) >= placedAt) ?? null);
  const pause = marketPause({ stop, migrated: curve.migrated, ladder: ladder.state, runs, ours: args.wallets.has(creator) });

  const cycle = marketCycleState({
    migrated: curve.migrated,
    migrationProgress: curve.migrationProgress,
    reserveRaw: BigInt(curve.quoteReserveRaw),
    thresholdRaw: BigInt(curve.thresholdRaw),
    finishedAt: curve.finishedAt,
    launchedAt: seconds(record.launchedAt) ?? now,
    foreignTrade: { seen: foreign.length > 0 ? true : facts.historyComplete ? false : null, at: foreignAt },
    graduatedAt,
    ladder: { placedAt: ladder.state === "NONE" ? null : placedAt, maintainedAt: ladder.state === "NONE" ? null : seconds(maintained?.at) },
    budget: market?.budgetAt ? { state: "FUNDED", at: seconds(market.budgetAt) } : null,
    pause,
    migrationSent: market?.graduation != null,
    migrationFailedAt: market && market.failures > 0 ? market.failedAt : null,
    now,
  });

  const priceNow = state.price;
  const depth: LaunchMarketDepthView[] = DEPTH_DROPS_BPS.map((dropBps) => {
    if (!curve.migrated) {
      /* A full curve takes no sale until it moves to the DEX: it pays out nothing. */
      if (FULL_CURVE.has(cycle.state)) return { dropBps, pairRaw: "0", ladderRaw: null };
      const points = curve.points.map((point) => ({ sqrtPrice: BigInt(point.sqrtPrice), liquidity: BigInt(point.liquidity) }));
      return { dropBps, pairRaw: curveDepthRaw({ sqrtPrice: BigInt(curve.sqrtPrice), sqrtStartPrice: BigInt(curve.sqrtStartPrice), points }, dropBps).toString(), ladderRaw: null };
    }
    const pool = state.graduated;
    if (!pool || ladder.state === "UNREAD") return { dropBps, pairRaw: null, ladderRaw: null };
    const poolRaw = poolDepthRaw(
      {
        compounding: pool.compounding,
        tokenIsA: pool.tokenIsA,
        pairReserveRaw: BigInt(pool.pairReserveRaw),
        sqrtPrice: BigInt(pool.sqrtPrice),
        sqrtMinPrice: BigInt(pool.sqrtMinPrice),
        sqrtMaxPrice: BigInt(pool.sqrtMaxPrice),
        liquidity: BigInt(pool.liquidity),
      },
      dropBps,
    );
    const ladderRaw = ladder.state === "PLACED" ? ladderDepthRaw(ladder.bins.map((bin) => ({ price: bin.price, pairRaw: BigInt(bin.pairRaw) })), priceNow, dropBps) : null;
    return { dropBps, pairRaw: (poolRaw + (ladderRaw ?? 0n)).toString(), ladderRaw: ladderRaw === null ? null : ladderRaw.toString() };
  });

  const exclusions = {
    poolAccounts: new Set([curve.baseVault, ...(state.graduated ? [state.graduated.tokenVault] : [])]),
    poolOwners: new Set([DBC_AUTHORITY, DAMM_AUTHORITY, ...(ladder.state !== "NONE" ? [ladder.pool] : [])]),
    lockOwners: new Set(record.lock && record.lock.state !== "FAILED" ? [record.lock.escrow] : []),
    ryntraOwners: args.wallets,
  };
  /*
   * Every account of the mint when the node scanned it; else the holders the market's read found — the traders, the
   * creator, the vaults, the escrow and the mint's largest accounts —: the count then says «at least», and the share of
   * the ten largest comes from the largest accounts over the supply less the pools and the lock, a floor.
   */
  const usdPerToken = args.usdPerPair === null ? null : priceNow * args.usdPerPair;
  const asAccount = (row: Readonly<{ account: string; owner: string; amountRaw: string }>) => ({ account: row.account, owner: row.owner, amountRaw: BigInt(row.amountRaw) });
  const holders: HoldersRead = facts.mintAccounts
    ? holdersAndConcentration({ accounts: facts.mintAccounts.map(asAccount), exclusions, tokenDecimals: state.tokenDecimals, usdPerToken })
    : holdersAndConcentration({
        accounts: facts.foundHolders.map(asAccount),
        whole: false,
        largestRead: facts.largestRead,
        supplyRaw: BigInt(facts.supplyRaw),
        poolsNotListed: ladder.state === "PLACED" ? [{ owner: ladder.pool, amountRaw: BigInt(ladder.tokensRaw) }] : [],
        exclusions,
        tokenDecimals: state.tokenDecimals,
        usdPerToken,
      });

  /* A floor of none says nothing: with only the holders found and none of them over a dollar, the count is not known. */
  const holdersKnown: HoldersRead = holders.atLeast && holders.holders === 0 ? { ...holders, holders: null } : holders;

  const activity = creatorActivity(facts.creatorTrades, creator);
  const share = creatorSoldShare(activity, BigInt(facts.supplyRaw));
  const creatorSold = activity.soldRaw > 0n ? true : facts.creatorTradesComplete ? false : null;

  const priceAtDex = curve.migrated ? priceFromSqrtX64(curve.migrationSqrtPrice, state.tokenDecimals, state.pairDecimals) : null;
  return {
    cycle,
    depth,
    survival: survival({ graduatedAt, priceNow: curve.migrated ? priceNow : null, priceAtDex, lastTradeAt, dayReadWhole: facts.dayReadWhole, now }),
    graduatedAt,
    lastTradeAt,
    holders: holdersKnown,
    creatorSold,
    creatorSoldShare: share,
    pause,
  };
}

/* ------------------------------------------------------------ projections */

const lockView = (lock: LockRead | null) => (lock ? { escrow: lock.escrow, cliffAt: iso(lock.cliffAt), endsAt: iso(lock.endsAt) } : null);
/** A figure in the pair currency, rounded to what the currency can hold — no float noise in an answer. */
const rounded = (value: number, decimals: number) => Number(value.toFixed(Math.min(decimals, 12)));

/** The list's row of a market read; with no figures, the record's facts only. */
export function marketRow(read: MarketRead, network: HealthDeps["network"]): LaunchMarketRow {
  const pair = launchPair(network, read.record.preset);
  const basics = read.basics;
  const figures = read.figures;
  const graduated = basics?.graduated ?? null;
  const poolLiquidity =
    graduated && basics
      ? (() => {
          const value = uiAmount(graduated.pairReserveRaw, basics.pairDecimals) + uiAmount(graduated.tokenReserveRaw, basics.tokenDecimals) * basics.price;
          return { pair: rounded(value, basics.pairDecimals), usd: pair.dollar ? rounded(value * pair.usdPrice, 2) : null };
        })()
      : null;
  return {
    token: read.record.token,
    name: read.name.slice(0, 64),
    symbol: read.symbol.slice(0, 16),
    image: read.image,
    preset: read.record.preset,
    launchedAt: read.record.launchedAt,
    creator: read.record.creator,
    technicalValidation: read.technicalValidation,
    pair: { mint: read.record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
    read: figures !== null,
    state: figures ? { code: figures.cycle.state, since: iso(figures.cycle.since) } : null,
    venue: basics ? (basics.migrated ? "pool" : "curve") : null,
    progress: basics ? { bps: basics.progressBps, migrated: basics.migrated } : null,
    poolLiquidity,
    budget: marketBudget(read.ladder),
    depth5Raw: figures?.depth.find((level) => level.dropBps === 500)?.pairRaw ?? null,
    daysSinceDex: figures?.survival.daysSinceDex ?? null,
    traded24h: figures?.survival.traded24h ?? null,
    holders: figures?.holders.holders ?? null,
    holdersAtLeast: figures?.holders.atLeast ?? false,
    creatorLock: lockView(read.lock),
    creatorSold: figures?.creatorSold ?? null,
    observedAt: read.observedAt,
  };
}

/** The pool's locked positions from the token's receipt, each named by whose share it is: the creator's — their wallet, or the vault sharing their fees — or Ryntra's as the config's partner. */
function lockedPositions(read: MarketRead, view: LaunchTokenResponse | null) {
  const creatorRoles = new Set([read.record.creator, ...(read.record.feeSharing?.vault ? [read.record.feeSharing.vault] : [])]);
  return (view?.receipt?.graduated?.positions ?? []).map((position) => ({ position: position.position, owner: creatorRoles.has(position.owner) ? ("creator" as const) : ("partner" as const), address: position.owner }));
}

/** The vault sharing the creator's fees, once it holds the curve's creator role: the token's read settles it, the record keeps it. */
function feeVault(read: MarketRead, view: LaunchTokenResponse | null): string | null {
  if (view?.feeSharing) return view.feeSharing.state === "SHARED" ? view.feeSharing.vault : null;
  return read.record.feeSharing?.state === "SHARED" ? read.record.feeSharing.vault : null;
}

/** The market's card: its row and the addresses it lives at. `view` — the token's read, for the pool's locked positions. */
export function marketCard(read: MarketRead, network: HealthDeps["network"], view: LaunchTokenResponse | null): LaunchMarketCardResponse {
  return {
    network: network.chain,
    market: marketRow(read, network),
    addresses: {
      config: read.record.config,
      curve: read.record.pool,
      pairMint: read.record.pairMint,
      pool: read.basics?.graduated?.pool ?? null,
      lockedPositions: lockedPositions(read, view)
        .slice(0, 8)
        .map((position) => ({ position: position.position, owner: position.address })),
      creatorLock: read.lock?.escrow ?? null,
      feeVault: feeVault(read, view),
      ladder: read.ladder.state === "NONE" ? null : { pool: read.ladder.pool, position: read.ladder.position },
      executor: read.executor,
    },
    observedAt: read.observedAt,
  };
}

/** The market's health; null when its chain could not be read and no good read stands in. */
export function marketHealth(read: MarketRead, network: HealthDeps["network"], view: LaunchTokenResponse | null): LaunchMarketHealthResponse | null {
  const basics = read.basics;
  const figures = read.figures;
  if (!basics || !figures) return null;
  const pair = launchPair(network, read.record.preset);
  const now = Math.floor(Date.parse(read.observedAt) / 1000);
  const preset = launchPreset(read.record.preset);
  const ladder = read.ladder;
  /* The steps that hold the pair currency now: where they stand against the price. */
  const holding = ladder.state === "PLACED" ? ladder.bins.filter((bin) => BigInt(bin.pairRaw) > 0n) : [];
  /* The ladder's policy runs while its steps stand and the executor may move them — whether or not their position was read now. */
  const stopped = read.executorFacts.stop !== null;
  /* The executor acts here only while its switch was read and holds no stop for this market. */
  const acts = read.runs.acts && !read.executorFacts.unread;
  /* The ladder's policy runs only where the executor moves it: a market Ryntra launched itself, not stopped. */
  const ladderMoves = ladder.state !== "NONE" && acts && read.runs.ladder && !stopped && read.technicalValidation;
  const receipt = view?.receipt ?? null;
  return {
    network: network.chain,
    token: read.record.token,
    pair: { mint: read.record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
    tokenDecimals: basics.tokenDecimals,
    price: { pair: basics.price, usd: pair.dollar ? basics.price * pair.usdPrice : null },
    state: { code: figures.cycle.state, since: iso(figures.cycle.since) },
    technicalValidation: read.technicalValidation,
    venue: basics.migrated ? "pool" : "curve",
    depth: [...figures.depth],
    budget: marketBudget(ladder),
    ladder:
      ladder.state === "PLACED"
        ? {
            pool: ladder.pool,
            pairRaw: ladder.pairRaw,
            tokensRaw: ladder.tokensRaw,
            pairFrom: holding.length ? Math.min(...holding.map((bin) => bin.price)) : null,
            pairTo: holding.length ? Math.max(...holding.map((bin) => bin.price)) : null,
          }
        : null,
    survival: {
      graduatedAt: iso(figures.graduatedAt),
      daysSinceDex: figures.survival.daysSinceDex,
      priceVsDexBps: figures.survival.priceVsDexBps,
      traded24h: figures.survival.traded24h,
      lastTradeAt: iso(figures.lastTradeAt),
    },
    holders: { count: figures.holders.holders, atLeast: figures.holders.atLeast, minUsd: HOLDER_MIN_USD },
    creator: {
      address: read.record.creator,
      lock: lockView(read.lock),
      /* Only a launch built through Ryntra records its lock; one adopted from the chain says nothing of it. */
      lockRequired: launchPreset(read.record.preset)?.creatorLockMinDays != null && BigInt(read.record.firstBuyOutRaw ?? "0") > 0n && read.record.buildId !== "",
      sold: figures.creatorSold,
      soldBps: figures.creatorSoldShare?.bps ?? null,
      soldOf: figures.creatorSoldShare?.of ?? null,
    },
    concentration: {
      top10Bps: figures.holders.top10Bps,
      atLeast: figures.holders.top10AtLeast,
      marked: figures.holders.top10Bps === null ? null : figures.holders.top10Bps > CONCENTRATION_MARK_BPS ? true : figures.holders.top10AtLeast ? null : false,
      markBps: CONCENTRATION_MARK_BPS,
    },
    engine: {
      executor: read.executor,
      acts,
      lastAction: read.lastAction,
      pause: figures.pause ? { code: figures.pause.code, at: iso(figures.pause.at) } : null,
    },
    rules: marketRules({
      migrated: basics.migrated,
      tokenMarks: receipt?.marks ?? [],
      config: read.record.config,
      curve: read.record.pool,
      launchSignature: read.record.signature,
      thresholdRaw: basics.thresholdRaw,
      lockedPositions: lockedPositions(read, view).map((position) => ({ position: position.position, owner: position.owner })),
      creatorLock: read.lock,
      feeVault: feeVault(read, view),
      firstBuyCapBps: preset?.creatorFirstBuyCapBps ?? null,
      executor: acts && !stopped ? read.executor : null,
      ladderPool: ladderMoves ? ladder.pool : null,
      concentrationRead: figures.holders.top10Bps !== null,
      creatorSalesRead: figures.creatorSold !== null,
      now,
    }).map((rule) => ({ ...rule, values: { ...rule.values } })),
    rulesComplete: receipt !== null,
    observedAt: read.observedAt,
  };
}
