/**
 * Ryntra Launch's executor — the wallet that acts on launched tokens after
 * their curve, by Meteora's own programs, and keeps a receipt of each act.
 *
 * One pass over Ryntra's launches on this network (`runAutopilot`), in loops
 * so a graduation never waits on liquidity:
 * - **the operator's switch first** — a market stopped on its own, or every
 *   market stopped, gets nothing signed; a switch that cannot be read stops
 *   the whole pass;
 * - **curves** — a curve that holds its threshold and has not graduated is
 *   graduated: the executor sends Meteora's migration to DAMM v2 and pays its
 *   rent, written down before the send. One refused, failed or expired is
 *   sent again by the executor itself — at once, then after a growing wait. A
 *   graduation sent by anyone else is recorded with whoever sent it, from the
 *   graduated pool's first transaction once that transaction is shown to be
 *   the curve's migration;
 * - **then the markets' budgets** — on Micro and the demo market, whose
 *   config names the executor its fee claimer, and only on markets
 *   Ryntra launched itself: the migration fee, the partner's surplus, its curve
 *   fees and its locked DAMM v2 position's fees claimed one at a time, each
 *   written down before the send and counted from its confirmed transaction —
 *   into the market's budget, a quarter of the last two with Ryntra's revenue
 *   apart; on people's markets nothing is claimed and the fees wait in
 *   Meteora's pools;
 * - **then the Fee-Funded Liquidity Ladder** — on the Classic and Protected
 *   presets (`FLOOR_RULE`) when its own operator stop is open, the money the
 *   operator put in; on Micro and the demo market from the market's budget
 *   (`BUDGET_LADDER`, at most 70 % of it, 5 USDC a step, the risk limits read
 *   every pass); only on markets Ryntra launched itself (by the creator), the
 *   executor holding SOL for its rent: the DLMM pool (with the cent's proof
 *   the pool asks for), the steps below the price, moved up after the price,
 *   topped up when more is free;
 * - **then Ryntra's revenue** — what the claims brought Ryntra and still sits
 *   on the executor's wallet beyond the markets' budgets: above 100 USDC the
 *   operator is told, once per 100 USDC more;
 * - **then what changed** — the executor's first pass over a market and each
 *   new state of its cycle, as marks in its flight log; a pass that changes
 *   nothing writes nothing.
 *
 * Every act is sent once and written down before the send; its receipt comes
 * from the confirmed transaction — its time, its amounts, the executor's SOL
 * it took — and nothing is written from a transaction that could not be read.
 * An act whose answer was lost is settled from the chain by the next pass; a
 * move up whose steps were emptied is finished by the next pass, never left
 * with the money in the wallet.
 *
 * What the executor never does: claim the partner's fees of a config whose fee
 * claimer is the partner's multisig (Classic, Protected, «Спільнота»), sign
 * anything outside its list (`./executor-signing.server.ts`) or on a market the
 * operator stopped, pay any holder,
 * move the pair currency anywhere but into its own steps and back, or act on a
 * token another instance is acting on (a lease per token, compare-and-set).
 *
 * The chain is reached only through `AutopilotChain` — the real one in
 * `./autopilot-chain.server.ts` — so every money path here is tested against a
 * chain that answers on purpose.
 */

import type { Keypair, Transaction } from "@solana/web3.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { HOLDER_CLAIM_EVERY_MS, collectorShouldClaim, holderGrantState } from "../core/launch/holder.ts";
import {
  BUDGET_LADDER,
  BUDGET_RULE,
  addPriceSeen,
  budgetExhausted,
  budgetPlaceableRaw,
  budgetRisk,
  budgetSteps,
  budgetTotals,
  creatorWatchProven,
  dayTopUpsRaw,
  revenueAlertDue,
  revenueLeftRaw,
  splitClaim,
  walletFreeRaw,
  type BudgetDataProblem,
  type BudgetRisk,
  type BudgetSource,
} from "../core/launch/budget.ts";
import {
  CLASSIC_SHAPE,
  EXECUTOR_JOURNALED_STATES,
  FLOOR_RULE,
  OWNER_LADDER_PRESETS,
  addSample,
  binOfPrice,
  floorBudgetRaw,
  floorLadder,
  floorRaise,
  graduationActor,
  graduationRetryDelaySeconds,
  priceOfBin,
  readyToPlace,
  referenceBin,
  type FloorLadder,
  type FloorSample,
  type LadderShape,
  type JournalActor,
  type JournalMark,
} from "../core/launch/autopilot.ts";
import { ENGINE_RULE, engineOrder, nextSlot, queueLagSeconds, visitOutcome, type EngineNodes, type EnginePhase, type EngineSlot } from "../core/launch/engine.ts";
import { marketCycleState, type MarketCycleState } from "../core/launch/market-health.ts";
import type { PartnerFeesRead } from "../core/venues/meteora-dbc/partner.server.ts";
import type { HolderPool, HolderVenue } from "../core/venues/meteora-damm-v2/holder.server.ts";
import type { FloorPool, FloorVenue } from "../core/venues/meteora-dlmm/floor.server.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { budgetFigures, executorClaimsPreset, readBudgetRecord, readBudgetRecords, readRevenue, updateBudgetRecord, writeRevenue, type BudgetFigures, type MarketBudgetRecord } from "./budget.server.ts";
import type { LaunchNetwork } from "./config.server.ts";
import type { LaunchRecord, Sent } from "./flow.server.ts";
import { noteGraduation } from "./graduation.server.ts";
import { readEngineQueue, writeEngineQueue } from "./engine.server.ts";
import { emptyExecutorMarket, readExecutorMarket, readExecutorMarkets, readExecutorStops, stopOn, updateExecutorMarket, writeJournalMark, type ExecutorMarket, type ExecutorStops } from "./executor.server.ts";
import { HOLDER_CHECKS, allHolderPositions, closedAccountsOf, dropHolderClaim, dropHolderPosition, putHolderPosition, holderClaims, setHolderClaim, writeHolderClaim, type HolderClaimReceipt, type HolderPositionRecord } from "./holder.server.ts";

export type AutopilotKind = "GRADUATED" | "FLOOR_POOL" | "FLOOR_PLACED" | "FLOOR_WITHDRAWN" | "FLOOR_RAISED" | "FLOOR_ADDED" | "FEE_CLAIMED";

/** One act on a token, as the confirmed transaction shows it. */
export type AutopilotReceipt = Readonly<{
  cluster: LaunchNetwork["cluster"];
  token: string;
  kind: AutopilotKind;
  signature: string;
  at: string | null;
  slot: number;
  actor: JournalActor;
  /** The pair currency the act moved, raw: the curve's threshold for a graduation, what went into or came out of the steps, what they hold after a move. */
  pairRaw: string | null;
  /** The token the act moved, raw: what the pool's proof bought. */
  tokensRaw: string | null;
  pool: string | null;
  position: string | null;
  lowerBinId: number | null;
  upperBinId: number | null;
  priceLow: number | null;
  priceHigh: number | null;
  /** The executor's SOL the act took — fees and rent; null for an act someone else sent. */
  lamports: string | null;
  /** A claim into the market's budget: which fee, and the budget's part of `pairRaw` — the rest is Ryntra's revenue. */
  source?: BudgetSource | null;
  budgetRaw?: string | null;
}>;

type Pending = Readonly<{
  kind: "FLOOR_PLACED" | "FLOOR_RAISED" | "FLOOR_ADDED";
  signature: string;
  validUntil: number;
  position: string | null;
  lowerBinId: number;
  upperBinId: number;
  /** A placement: what it puts in; a move or a top-up: only its top-up — the rest is the steps' own money. */
  pairRaw: string;
  sentAt: string;
}>;

type Redeposit = Readonly<{
  syncSignature: string;
  validUntil: number;
  /** What emptying the steps took out of them, read from that transaction; null until it is read. */
  raw: string | null;
  lowerBinId: number;
  upperBinId: number;
}>;

/** The Fee-Funded Liquidity Ladder on one token, and what the executor has read and sent for it. */
export type FloorRecord = Readonly<{
  version: number;
  cluster: LaunchNetwork["cluster"];
  token: string;
  state: "WATCHING" | "PLACED";
  pool: string | null;
  position: string | null;
  lowerBinId: number | null;
  upperBinId: number | null;
  /** Every amount the executor put into the steps from outside them, raw. */
  placedRaw: string;
  /** The price's bin as the executor read it, at most once in `FLOOR_RULE.sampleSpacingSeconds`, within the window. */
  samples: readonly FloorSample[];
  raiseSeen: Readonly<{ at: number; marketBinId: number }> | null;
  /** Why the steps cannot be placed on this token at all — the pair's pool made by someone else on other terms. */
  blocked: string | null;
  pending: Pending | null;
  /**
   * A move up under way: the steps were emptied and the pool's price moved (`syncSignature`), and what that took out
   * of them goes back into the steps of `lowerBinId`…`upperBinId`. Kept until the steps hold it again. Absent on older
   * records.
   */
  redeposit?: Redeposit | null;
  /** The pool's creation, written down before its send: a creation whose answer was lost still gets its receipt. */
  poolSent?: Readonly<{ signature: string; validUntil: number }> | null;
  /**
   * Whose money the steps hold: the operator's (Classic, Protected — `FLOOR_RULE`) or the market's budget (Micro, the demo
   * market — `BUDGET_LADDER`); and the bin step of the pool they stand in. Absent on older records: the operator's, 1 %.
   */
  funding?: "owner" | "budget";
  binStep?: number;
  updatedAt: string;
}>;

/** What a confirmed transaction shows. */
export type TxFacts = Readonly<{
  feePayer: string;
  at: string | null;
  slot: number;
  logs: readonly string[];
  /** The executor's SOL the transaction took; null when the executor is not in it. */
  lamportsSpent: bigint | null;
  /** Whether the transaction failed on chain: a failed one proves nothing and is no receipt. */
  failed: boolean;
  /** The executor's own change of a mint, raw. */
  delta(mint: string): bigint;
  /** Another wallet's change of a mint, raw — a holder's fees the collector paid to it. */
  deltaOf(owner: string, mint: string): bigint;
}>;

export type CurveRead = Readonly<{
  migrated: boolean;
  reserveRaw: bigint;
  thresholdRaw: bigint;
  /** `finish_curve_timestamp`, unix seconds; null while the curve is not full. */
  finishedAt: number | null;
  /** The graduated pool the curve migrates into. */
  dammPool: string | null;
}>;

/** Everything the executor asks of the chain; the real one signs with the executor's key. */
export type AutopilotChain = Readonly<{
  executor: string;
  curve(record: LaunchRecord): Promise<CurveRead | null>;
  /**
   * Many curves at once — a request of the node per hundred (SOL-L6): by token, null where a curve is not there, absent
   * where it was not read (the pass then reads that one alone). Optional: a chain without it is read one curve at a time.
   */
  curves?(records: readonly LaunchRecord[]): Promise<ReadonlyMap<string, CurveRead | null>>;
  /**
   * Many graduated pools' prices at once (SOL-L6): `prices` from the main node, `pricesSecond` from the second — by pool;
   * a pool left out was not read. Optional: without them each ladder reads its own.
   */
  prices?(pools: ReadonlyArray<Readonly<{ dammPool: string; token: string }>>): Promise<ReadonlyMap<string, Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }>>>;
  pricesSecond?(pools: ReadonlyArray<Readonly<{ dammPool: string; token: string }>>): Promise<ReadonlyMap<string, number>>;
  /** How the nodes answered this chain's reads (SOL-L6, SOL-C9): reads, the main node down for some, neither answering. Optional. */
  nodes?(): EngineNodes;
  /** The migration built — signed later, by the executor and its positions' new keys (`signers`), and sent once. */
  buildMigration(record: LaunchRecord): Promise<Readonly<{ transaction: Transaction; signers: readonly Keypair[] }>>;
  /** An account's first transaction that did not fail, or null when its history could not be read to the start. */
  oldestSignature(address: string): Promise<string | null>;
  transaction(signature: string): Promise<TxFacts | null>;
  price(dammPool: string, token: string): Promise<Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }> | null>;
  partnerEarned(record: LaunchRecord): Promise<bigint>;
  /** The partner's fees on a launch as Meteora's programs count them, and the config's fee claimer. */
  partnerFees(record: LaunchRecord): Promise<PartnerFeesRead>;
  /** One source's claim, built only where the config's fee claimer is the executor. */
  buildPartnerClaim(read: PartnerFeesRead, source: BudgetSource): Promise<Transaction>;
  /** The graduated pool's price as a second node reads it; null when there is no second node or it gave none. */
  priceSecond(dammPool: string, token: string): Promise<number | null>;
  /** What a wallet holds of a mint, raw; null when it could not be read. */
  heldBy(owner: string, mint: string): Promise<bigint | null>;
  /** A mint's decimals; they never change. */
  decimals(mint: string): Promise<number>;
  held(mint: string): Promise<bigint>;
  lamports(): Promise<bigint>;
  floor: FloorVenue;
  /** Holders' positions in graduated pools: the pool, a position, and the collector's claim to the owner's own accounts. */
  holder: Pick<HolderVenue, "pool" | "readPosition" | "buildCollectorClaim">;
  /**
   * Signs with the executor (and a new account's key) on a fresh blockhash — only what the executor's list allows;
   * `payees`: wallets besides the executor whose own accounts the transaction may pay (a holder's, for the collector).
   */
  prepare(tx: Transaction, extra: readonly Keypair[], payees?: readonly string[]): Promise<Readonly<{ signature: string; validUntil: number }>>;
  send(tx: Transaction, validUntil: number): Promise<Sent>;
  outcome(signature: string, validUntil: number): Promise<Sent["outcome"] | "EXPIRED">;
}>;

export type AutopilotDeps = Readonly<{
  network: Pick<LaunchNetwork, "cluster">;
  store: GuardStore;
  chain: AutopilotChain;
  floorOpen: boolean;
  /** Whether a launch is Ryntra's own, by its creator: one of Ryntra's internal wallets. In phase 0 the ladder stands only there. */
  ryntraLaunched: (creator: string) => Promise<boolean>;
  now: () => Date;
  /** After this moment (ms) nothing new is signed: the pass sets it so a send it starts can still be seen through. */
  deadline?: number;
  /** Tells the operator — Ryntra's revenue on the executor's wallet above 100 USDC; true when the word was delivered. */
  alert?: (text: string) => Promise<boolean>;
  /**
   * The operator's switch of people's Micro markets (SOL-L6, `./engine.server.ts`): while it is open the executor claims
   * the budget and keeps the ladder on a Micro market a person launched, by the same policies as on Ryntra's own. Asked
   * once a pass and again before each signature on such a market; absent or not answering — closed.
   */
  peopleOpen?: () => Promise<boolean>;
  /** Markets acted on at once where their acts move only their own money (`ENGINE_RULE.concurrency`). */
  concurrency?: number;
}>;

export type AutopilotStep = Readonly<{ token: string; step: string; signature?: string }>;

/** What a pass did, counted — kept with the pass for the operator and the alerts. */
export type AutopilotStats = Readonly<{
  ms: number;
  markets: number;
  /** Curves read in bulk, and read one by one. */
  curvesBulk: number;
  curvesSingle: number;
  /** Curves the bulk read could not reach this pass: their markets wait for the next. */
  curvesUnread: number;
  /** Per phase of the queue: markets due, visited, left for the next pass, and the longest a due market has waited (s). */
  budget: PhaseStats;
  floor: PhaseStats;
  failing: number;
  peopleOpen: boolean;
}>;
export type PhaseStats = Readonly<{ due: number; visited: number; left: number; lagSeconds: number }>;
export type AutopilotReport = Readonly<{ state: "RAN"; executor: string; steps: readonly AutopilotStep[]; stats?: AutopilotStats }>;

/** The states of a market on the DEX: a pass reaches these after every market still on its curve. */
const ON_DEX: ReadonlySet<MarketCycleState> = new Set<MarketCycleState>(["CORE_MARKET_LIVE", "ENDOWMENT_FUNDED", "LADDER_ACTIVE", "MAINTAINING", "PAUSED_RISK", "MATURE", "ENDOWMENT_EXHAUSTED"]);
/** The presets whose ladder stands on money the operator puts in, opened by the ladder's own stop (Micro's and the demo market's stands on their budget). */
const LADDER_PRESETS = OWNER_LADDER_PRESETS;
/** Failed graduations that landed, written into the log in one run; the rest of the run is counted. */
export const GRADUATION_FAILURES_LOGGED = 3;

/** The fewest lamports the executor keeps; below it it sends nothing — a graduation costs about 0.024 SOL of rent. */
export const EXECUTOR_FLOOR_LAMPORTS = 30_000_000n;
/**
 * The lamports the ladder on one token needs before the executor starts it: the pool (≈ 0.025 SOL), the
 * position and its bin arrays (≈ 0.146 SOL), the token account of the pool's proof — measured on devnet 2026-10-07 —
 * and the reserve below which nothing is sent, so a graduation is never starved by liquidity.
 */
export const FLOOR_START_LAMPORTS = 230_000_000n;
/** A graduation's rent and fee, ≈ 0.024 SOL: set aside in the pass before it is signed. */
export const GRADUATION_LAMPORTS = 25_000_000n;
/** A claim's fee with its priority, set aside in the pass before it is signed. */
export const FEE_LAMPORTS = 100_000n;
/** A move up may open a new bin array (≈ 0.072 SOL) and grow the position: it starts only above the reserve plus this. */
export const FLOOR_MOVE_LAMPORTS = 90_000_000n;
/** The pair currency's cent the pool's proof costs, raw (6 decimals). */
export const PROOF_RAW = 10_000n;
/** Below this the steps are said to hold none of the token: a raw unit or two left by rounding is not a holding. */
const TOKEN_DUST_RAW = 1_000n;
const LEASE_MS = 120_000;
const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

const RECEIPTS = "launchAutopilot";
const FLOORS = "launchFloors";
const LEASES = "launchAutopilotLeases";
const PASSES = "launchAutopilotPasses";
const receiptKey = (cluster: string, token: string, signature = "") => `solana:${cluster}:${token}:${signature}`;
const floorKey = (cluster: string, token: string) => `solana:${cluster}:${token}`;

type Lease = Readonly<{ version: number; holder: string; until: number }>;

/** When the executor last finished a pass on a network — what a market's health reads to say whether it acts now. */
export type AutopilotPass = Readonly<{ cluster: LaunchNetwork["cluster"]; executor: string; at: string; stats?: AutopilotStats }>;

/** The executor's last finished pass on a network; null when it never passed, or the store did not answer. */
export async function lastAutopilotPass(store: GuardStore, cluster: string): Promise<AutopilotPass | null> {
  return (await store.collection<AutopilotPass>(PASSES).get(`solana:${cluster}`).catch(() => null)) ?? null;
}

/** One pass over the network's launches, or over one token; stops starting new acts at `budgetMs`. */
export async function runAutopilot(given: AutopilotDeps, options: Readonly<{ only?: string; budgetMs?: number }> = {}): Promise<AutopilotReport> {
  const started = given.now().getTime();
  const end = started + (options.budgetMs ?? 45_000);
  /* Nothing is signed later than a few seconds past the budget: each act checks it before it signs. */
  const deps: AutopilotDeps = { ...given, deadline: given.deadline ?? end + 5_000 };
  const cluster = deps.network.cluster;
  const records = options.only
    ? [await deps.store.collection<LaunchRecord>("launches").get(`solana:${cluster}:${options.only}`)].filter((row): row is LaunchRecord => row != null)
    : await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`);
  /* A record written before launches had a state is a launch the chain confirmed. */
  const launched = records.filter((record) => record.state !== "PENDING").sort((a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt));
  /* The operator's switch first: while it cannot be read, nothing is signed and the pass is not counted. */
  const stops = await readExecutorStops(deps.store, cluster).catch(() => null);
  if (!stops) return { state: "RAN", executor: deps.chain.executor, steps: [{ token: "*", step: "STOPS_UNREAD" }] };
  const concurrency = Math.max(1, deps.concurrency ?? ENGINE_RULE.concurrency);
  const steps: AutopilotStep[] = [];
  const curves = new Map<string, CurveRead>();
  /* Whether a launch is Ryntra's own, by its creator — asked once a pass. */
  const ours = new Map<string, boolean>();
  const ryntraLaunched = async (record: LaunchRecord) => {
    const known = ours.get(record.creator);
    if (known !== undefined) return known;
    const answer = await deps.ryntraLaunched(record.creator).catch(() => false);
    ours.set(record.creator, answer);
    return answer;
  };
  /*
   * People's Micro markets (SOL-L6): the operator's switch asked once for the pass. A market of a person's the executor
   * serves is kept here, so the switch is asked again before each signature on it (`prepareChecked`).
   */
  const peopleOpen = deps.peopleOpen ? await deps.peopleOpen().catch(() => false) : false;
  const people = new Set<string>();
  PEOPLE_MARKETS.set(deps, people);
  /** Whether the executor serves this budget market's budget and ladder: Ryntra's own, or a person's while the switch is open. */
  let ladderRecords: Promise<Readonly<{ floors: ReadonlyMap<string, FloorRecord>; budgets: ReadonlyMap<string, MarketBudgetRecord> }>> | null = null;
  const recordsOf = () =>
    (ladderRecords ??= Promise.all([
      deps.store.versioned<FloorRecord>(FLOORS).valuesWithPrefix(`solana:${cluster}:`).catch((): FloorRecord[] => []),
      readBudgetRecords(deps.store, cluster).catch((): MarketBudgetRecord[] => []),
    ]).then(([floors, budgets]) => ({ floors: new Map(floors.filter((row) => row.cluster === cluster).map((row) => [row.token, row])), budgets: new Map(budgets.map((row) => [row.token, row])) })));
  /**
   * Whether the executor serves this budget market's budget and ladder: Ryntra's own; or a person's, while the switch is
   * open, whose creator was watched from its launch — a sale in an unwatched first week cannot be known (SOL-L6).
   */
  const served = async (record: LaunchRecord) => {
    if (await ryntraLaunched(record)) return true;
    if (!peopleOpen) return false;
    const watchFrom = (await recordsOf()).budgets.get(record.token)?.creatorWatchFrom;
    if (!creatorWatchProven({ watchFrom, launchedAt: seconds(record.launchedAt) ?? unixNow() })) return false;
    people.add(record.token);
    return true;
  };
  const graduated: Array<Readonly<{ record: LaunchRecord; curve: CurveRead }>> = [];
  const now = () => deps.now().getTime();
  const unixNow = () => Math.floor(now() / 1000);

  /*
   * Curves first: a full curve is graduated before any liquidity is touched. Markets not yet on the DEX come first, the
   * newest first — a curve that just filled never waits behind markets that graduated long ago; those follow, oldest
   * first. Every curve is read in a few requests (`curves`); a market still on its curve with nothing of the executor's
   * pending, and one whose graduation is already written down, is said as such without a lease or a write — hundreds
   * fit in a pass. A curve the bulk read could not reach (its node refusing) is not read: the market waits a pass, and
   * never turns into hundreds of reads one by one against a node already refusing.
   *
   * The phases share the pass's time (SOL-L6, measured on devnet 20.10): the curves until 45 % of it, the budgets until
   * 70 %, the ladders until the end — one phase slow on a node never leaves the others nothing.
   */
  const budgetMs = end - started;
  const launchedTokens: ReadonlySet<string> = new Set(launched.map((record) => record.token));
  /* Markets of this pass's budget and ladder queues still failing — the ones the queue will try again. */
  const budgetFailing = new Set<string>();
  const floorFailing = new Set<string>();
  const curvesEnd = started + Math.round(budgetMs * 0.45);
  const budgetsEnd = started + Math.round(budgetMs * 0.7);
  const known = await readExecutorMarkets(deps.store, cluster).catch(() => new Map<string, ExecutorMarket>());
  const onDex = (record: LaunchRecord) => ON_DEX.has(known.get(record.token)?.state ?? "CREATED");
  const order = [...launched.filter((record) => !onDex(record)).reverse(), ...launched.filter(onDex)];
  /* A budget market's creator is watched from the first pass for the first week: those go the long way. */
  const creatorWatched = (record: LaunchRecord) => executorClaimsPreset(record.preset) && unixNow() - (seconds(record.launchedAt) ?? unixNow()) <= BUDGET_RULE.creatorSaleWindowSeconds;
  const bulkTried = Boolean(deps.chain.curves) && order.length > 0;
  const bulk: ReadonlyMap<string, CurveRead | null> = bulkTried ? await deps.chain.curves!(order).catch(() => new Map<string, CurveRead | null>()) : new Map<string, CurveRead | null>();
  /*
   * What is urgent goes first in the phase's time: a curve full or a graduation of ours in flight or failed, then a budget
   * market's first week (its creator watched); then the rest, newest market first.
   */
  const urgency = (record: LaunchRecord) => {
    const read = bulk.get(record.token);
    const market = known.get(record.token);
    if ((read && !read.migrated && read.reserveRaw >= read.thresholdRaw) || market?.graduation || (market?.failures ?? 0) > 0) return 0;
    return creatorWatched(record) ? 1 : 2;
  };
  const urgentFirst = [...order].sort((a, b) => urgency(a) - urgency(b));
  /* Graduations already written down, in one reading: those markets need no lease to go on to their budget and ladder. */
  const recorded = new Set(
    (await deps.store.collection<AutopilotReceipt>(RECEIPTS).valuesWithPrefix(`solana:${cluster}:`).catch((): AutopilotReceipt[] => []))
      .filter((row) => row.kind === "GRADUATED")
      .map((row) => row.token),
  );
  /* A graduation someone else sent and the executor could not yet prove from the chain is looked for again after a wait. */
  const recordSlots = await readEngineQueue(deps.store, cluster, "graduation");
  const recordDue = (token: string) => {
    const slot = recordSlots.get(token);
    return !slot || slot.dueAt === null || slot.dueAt <= unixNow();
  };
  let curvesBulk = 0;
  let curvesSingle = 0;
  let curvesUnread = 0;
  await eachLimited(urgentFirst, concurrency, async (record) => {
    const token = record.token;
    const read = bulk.get(token);
    const market = known.get(token);
    const settled = market?.watchedAt && !market.graduation && market.failures === 0 && !creatorWatched(record);
    if (read && settled && !read.migrated && read.reserveRaw < read.thresholdRaw) {
      curvesBulk += 1;
      curves.set(token, read);
      steps.push({ token, step: "ON_CURVE" });
      return;
    }
    if (read && settled && read.migrated && recorded.has(token)) {
      curvesBulk += 1;
      curves.set(token, read);
      graduated.push({ record, curve: read });
      if (now() <= curvesEnd) await noteGraduation(deps.store, record, read.finishedAt, deps.now()).catch(() => undefined);
      steps.push({ token, step: "GRADUATED_KNOWN" });
      return;
    }
    if (now() > curvesEnd) return;
    if (bulkTried && !bulk.has(token)) {
      curvesUnread += 1;
      steps.push({ token, step: "CURVE_UNREAD" });
      return;
    }
    const stopped = stopOn(stops, token) !== null;
    steps.push(
      ...(await leased(deps, token, async () => {
        const out: AutopilotStep[] = [];
        /* The executor's first pass over a market goes into its log once, before anything it does there. */
        if (!stopped && !market?.watchedAt) out.push(...(await watchOnce(deps, token)));
        /*
         * A budget market's creator, watched from the first pass for the first week — a sale on the curve counts too —, on
         * people's markets whatever the switch says: opened later, the switch finds a sale already known.
         */
        if (executorClaimsPreset(record.preset)) await watchCreator(deps, record).catch(() => undefined);
        /* Read in bulk; a curve the bulk read found no plain curve at (another kind of pool) is read alone. */
        let curve: CurveRead | null = bulk.get(token) ?? null;
        if (curve) curvesBulk += 1;
        /* Read alone: no plain curve in the bulk read, or a full one — read afresh before anything is sent for it. */
        if (!curve || (!curve.migrated && curve.reserveRaw >= curve.thresholdRaw)) {
          curvesSingle += 1;
          curve = await deps.chain.curve(record);
        }
        if (!curve) return [...out, { token, step: "NO_CURVE" }];
        curves.set(token, curve);
        if (!curve.migrated) {
          if (curve.reserveRaw < curve.thresholdRaw) return [...out, { token, step: "ON_CURVE" }];
          if (stopped) return [...out, { token, step: "STOPPED" }];
          const sent = await graduate(deps, record, curve);
          /* Graduated in this pass: what changed is noted from the moved curve. */
          if (sent.some((step) => step.step === "GRADUATED" || step.step === "GRADUATION_LANDED")) curves.set(token, { ...curve, migrated: true });
          return [...out, ...sent];
        }
        graduated.push({ record, curve });
        await noteGraduation(deps.store, record, curve.finishedAt, deps.now()).catch(() => undefined);
        /* The curve has moved: a graduation of ours in flight or failed is over, whoever sent the one that went through. */
        await settleMoved(deps, record, curve).catch(() => undefined);
        if (!recorded.has(token) && !recordDue(token)) return [...out, { token, step: "GRADUATION_RECORD_LATER" }];
        const step = await recordGraduation(deps, record, curve).catch((error: unknown) => ({ token, step: `GRADUATION_ERROR: ${message(error)}` }));
        /* Not proven from the chain this time: looked for again after a growing wait, not every minute. */
        const failed = step.step === "GRADUATION_UNREAD" || step.step === "GRADUATION_UNPROVEN" || step.step.startsWith("GRADUATION_ERROR");
        recordSlots.set(token, nextSlot(recordSlots.get(token) ?? null, { outcome: failed ? "FAILED" : "ACTED", now: unixNow(), restSeconds: 0, error: failed ? step.step : null }));
        return [...out, step];
      })),
    );
  });
  await writeEngineQueue(deps.store, cluster, "graduation", recordSlots, new Set([...launchedTokens].filter((token) => !recorded.has(token))), deps.now()).catch(() => undefined);
  /* The phases after the curves go oldest launch first, whatever order the curves were read in. */
  const launchOrder = new Map(launched.map((record, index) => [record.token, index]));
  graduated.sort((a, b) => (launchOrder.get(a.record.token) ?? 0) - (launchOrder.get(b.record.token) ?? 0));

  /*
   * Then the markets' budgets: on Micro and the demo market the executor claims the partner's fees itself — on markets
   * Ryntra launched, and on people's while the operator's switch is open; elsewhere the fees wait in Meteora's pools.
   * The queue's order, a few at once (a claim only brings a market's own money in), as many as the pass has time for.
   */
  const budgeted = graduated.filter(({ record }) => executorClaimsPreset(record.preset));
  const budgetSlots = await readEngineQueue(deps.store, cluster, "budget");
  const claimable: LaunchRecord[] = [];
  for (const { record } of budgeted) {
    if (stopOn(stops, record.token)) steps.push({ token: record.token, step: "STOPPED" });
    else if (!(await served(record))) steps.push({ token: record.token, step: "BUDGET_IN_POOL" });
    else claimable.push(record);
  }
  const budgetStats = await queuePhase(deps, "budget", claimable, budgetSlots, { end: budgetsEnd, concurrency, rest: ENGINE_RULE.budgetRestSeconds, steps, keep: launchedTokens, failing: budgetFailing }, (record) => leased(deps, record.token, () => claimBudget(deps, record)));

  /*
   * Then the Fee-Funded Liquidity Ladder — on markets Ryntra launched itself, and on people's Micro markets while the
   * switch is open: on Micro and the demo market from the market's budget; on Classic and Protected from the operator's
   * money, while its own stop is open, one at a time, oldest launch first, each reading the wallet afresh. The budgets'
   * ladders then in the queue's order, a few at once — each takes only its own budget's reserve, from one reading of
   * the wallet for the whole pass.
   */
  let ownerClosed = false;
  const ownerLadders: Array<Readonly<{ record: LaunchRecord; dammPool: string }>> = [];
  const budgetLadders: Array<Readonly<{ token: string; record: LaunchRecord; dammPool: string; finishOnly?: boolean }>> = [];
  for (const { record, curve } of graduated) {
    if (!curve.dammPool) continue;
    const funding = executorClaimsPreset(record.preset) ? "budget" : LADDER_PRESETS.has(record.preset) ? "owner" : null;
    if (funding === null) {
      steps.push({ token: record.token, step: "FLOOR_NOT_THIS_PRESET" });
      continue;
    }
    if (funding === "owner" && !deps.floorOpen) {
      ownerClosed = true;
      continue;
    }
    if (stopOn(stops, record.token)) {
      steps.push({ token: record.token, step: "STOPPED" });
      continue;
    }
    if (!(await (funding === "budget" ? served(record) : ryntraLaunched(record)))) {
      /*
       * A person's ladder the switch closed on in the middle of an act — a send not read yet, steps emptied for a move —
       * is finished: the act read from the chain and the money put back into the steps; nothing new goes in.
       */
      const stored = funding === "budget" ? ((await recordsOf()).floors.get(record.token) ?? null) : null;
      if (stored && (stored.pending || stored.redeposit)) budgetLadders.push({ token: record.token, record, dammPool: curve.dammPool, finishOnly: true });
      else steps.push({ token: record.token, step: "FLOOR_NOT_OURS" });
      continue;
    }
    if (funding === "owner") ownerLadders.push({ record, dammPool: curve.dammPool });
    else budgetLadders.push({ token: record.token, record, dammPool: curve.dammPool });
  }
  for (const { record, dammPool } of ownerLadders) {
    if (now() > end) break;
    steps.push(...(await leased(deps, record.token, () => floor(deps, record, dammPool, end, "owner"))));
  }
  if (ownerClosed) steps.push({ token: "*", step: "FLOOR_CLOSED" });
  const wallet: PassWallet = { shares: new Map() };
  /* Every budget ladder's price in a few requests, from each node apart; the risk limits' SOL read once. */
  if (budgetLadders.length && deps.chain.prices) {
    const pools = budgetLadders.map((run) => ({ dammPool: run.dammPool, token: run.token }));
    const [main, second] = await Promise.all([deps.chain.prices(pools).catch(() => null), deps.chain.pricesSecond ? deps.chain.pricesSecond(pools).catch(() => null) : Promise.resolve(undefined)]);
    wallet.prices = main ?? new Map();
    if (second !== undefined) wallet.seconds = second ?? new Map();
    /* Not read: each ladder reads its own — one failed read never fails every ladder of the pass. */
    wallet.lamports = deps.chain.lamports().catch(() => null);
  }
  const floorSlots = await readEngineQueue(deps.store, cluster, "floor");
  const floorStats = await queuePhase(deps, "floor", budgetLadders, floorSlots, { end, concurrency, rest: ENGINE_RULE.floorRestSeconds, steps, keep: launchedTokens, failing: floorFailing }, (run) =>
    leased(deps, run.token, () => floor(deps, run.record, run.dammPool, end, "budget", wallet, run.finishOnly === true)),
  );
  /* The switch of people's markets holds over their budgets and ladders alone: the holders' collector is not asked it. */
  people.clear();

  /* Then Ryntra's revenue on the executor's wallet: above 100 USDC the operator is told. */
  if (budgeted.length) steps.push(...(await noteRevenue(deps).catch((error: unknown) => [{ token: "*", step: `REVENUE_ERROR: ${message(error)}` }])));

  /* Then the holders' positions: the fees their owners let Ryntra's collector bring to their wallets. */
  if (!stops.all?.stopped) steps.push(...(await collectForHolders(deps, end, stops).catch((error: unknown) => [{ token: "*", step: `HOLDERS_ERROR: ${message(error)}` }])));
  /*
   * Then what changed on each market, written down — store writes only, a little past the acts' budget at most. Each
   * market's state is worked out from one reading of every record; only a market whose state moved is leased and written.
   */
  const changed = await statesMoved(deps, launched, curves).catch(() => null);
  for (const record of launched) {
    if (now() > end + 10_000) break;
    const curve = curves.get(record.token);
    if (!curve || stopOn(stops, record.token)) continue;
    if (changed && !changed.has(record.token)) continue;
    const noted = await leased(deps, record.token, () => noteState(deps, record, curve));
    steps.push(...noted.filter((step) => step.step !== "LEASED"));
  }
  const stats: AutopilotStats = {
    ms: now() - started,
    markets: launched.length,
    curvesBulk,
    curvesSingle,
    curvesUnread,
    budget: budgetStats,
    floor: floorStats,
    failing: new Set([...failingMarkets(steps).filter((token) => !stopOn(stops, token)), ...budgetFailing, ...floorFailing]).size,
    peopleOpen,
  };
  /* The pass is written down: a market's health says the executor acts only while its passes keep coming. */
  await deps.store
    .collection<AutopilotPass>(PASSES)
    .set(`solana:${cluster}`, { cluster, executor: deps.chain.executor, at: deps.now().toISOString(), stats })
    .catch(() => undefined);
  return { state: "RAN", executor: deps.chain.executor, steps, stats };
}

/* ------------------------------------------------------------------ the queue and the pass's own reading of the wallet */

/**
 * The executor's SOL is one wallet for every market (SOL-L6): acts run a few at once, so each sets aside what it may
 * spend — rent and fees — before it signs, and an act starting meanwhile reads the wallet less what the acts still
 * running set aside. An act that ends gives its part back: the wallet then shows what it spent.
 */
const SOL_SET_ASIDE = new WeakMap<AutopilotDeps, { reserved: bigint }>();
/** What the act running now set aside, given back when it ends — the wallet read after it already shows what it spent. */
const ACT_SET_ASIDE = new AsyncLocalStorage<{ reserved: bigint }>();

/** Whether the executor may start an act needing `need` lamports on its wallet; if so, `cost` is set aside for it at once. */
async function solFor(deps: AutopilotDeps, need: bigint, cost: bigint): Promise<boolean> {
  const held = await deps.chain.lamports();
  const ledger = SOL_SET_ASIDE.get(deps) ?? { reserved: 0n };
  SOL_SET_ASIDE.set(deps, ledger);
  if (held - ledger.reserved < need) return false;
  ledger.reserved += cost;
  const act = ACT_SET_ASIDE.getStore();
  if (act) act.reserved += cost;
  return true;
}

/** People's markets the executor serves in a pass, by the pass's deps: the switch is asked again before each signature there. */
const PEOPLE_MARKETS = new WeakMap<AutopilotDeps, ReadonlySet<string>>();

/**
 * What a pass reads once for its budget ladders: the executor's wallet by pair currency, every ladder's price from each
 * of the two nodes (absent — not read in bulk, each ladder reads its own), and the executor's SOL for the risk limits.
 */
type PassWallet = {
  shares: Map<string, Promise<WalletShares>>;
  prices?: ReadonlyMap<string, Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }>> | null;
  seconds?: ReadonlyMap<string, number> | null;
  lamports?: Promise<bigint | null>;
};

/** `act` on each item, at most `limit` at once, in the items' order. */
async function eachLimited<T>(items: readonly T[], limit: number, act: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await act(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * One phase of the queue: the markets due in its order, a few at once, while the pass has time; each visit moves the
 * market's place — due again next pass after an act or a wait, after the phase's rest when there was nothing to do, after
 * a growing wait when it failed. The queue is written back for the next pass.
 */
async function queuePhase<T extends Readonly<{ token: string }>>(
  deps: AutopilotDeps,
  phase: EnginePhase,
  items: readonly T[],
  slots: Map<string, EngineSlot>,
  args: Readonly<{ end: number; concurrency: number; rest: number; steps: AutopilotStep[]; /** The markets whose places are kept — every launch of the network, so a market left out of this pass keeps its wait. */ keep: ReadonlySet<string>; /** Collects the markets of this phase still failing — their visit failed and they wait to be tried again. */ failing?: Set<string> }>,
  visit: (item: T) => Promise<AutopilotStep[]>,
): Promise<PhaseStats> {
  const due = engineOrder(items, slots, Math.floor(deps.now().getTime() / 1000));
  for (const item of items) if ((slots.get(item.token)?.errors ?? 0) > 0) args.failing?.add(item.token);
  let visited = 0;
  await eachLimited(due, args.concurrency, async (item) => {
    if (deps.now().getTime() > args.end) return;
    const out = await visit(item).catch((error: unknown) => [{ token: item.token, step: `ERROR: ${message(error)}` }]);
    args.steps.push(...out);
    visited += 1;
    const outcome = visitOutcome(out);
    const error = outcome === "FAILED" ? (out.find((row) => /ERROR|FAILED|REJECTED|REFUSED|LAPSED/.test(row.step))?.step ?? null) : null;
    slots.set(item.token, nextSlot(slots.get(item.token) ?? null, { outcome, now: Math.floor(deps.now().getTime() / 1000), restSeconds: args.rest, error }));
    if (outcome === "FAILED") args.failing?.add(item.token);
    else args.failing?.delete(item.token);
  });
  const tokens = new Set(items.map((item) => item.token));
  await writeEngineQueue(deps.store, deps.network.cluster, phase, slots, args.keep, deps.now()).catch(() => undefined);
  const mine = [...slots].filter(([token]) => tokens.has(token)).map(([, slot]) => slot);
  return { due: due.length, visited, left: due.length - visited, lagSeconds: queueLagSeconds(mine, Math.floor(deps.now().getTime() / 1000)) };
}

/** Markets whose visit failed in a pass. */
function failingMarkets(steps: readonly AutopilotStep[]): string[] {
  const byToken = new Map<string, AutopilotStep[]>();
  for (const step of steps) if (step.token !== "*") byToken.set(step.token, [...(byToken.get(step.token) ?? []), step]);
  return [...byToken].filter(([, rows]) => visitOutcome(rows) === "FAILED").map(([token]) => token);
}

/**
 * The markets whose state as the executor reads it differs from the one it last wrote down — worked out from one
 * reading of every market's record, ladder, budget and receipts.
 */
async function statesMoved(deps: AutopilotDeps, launched: readonly LaunchRecord[], curves: ReadonlyMap<string, CurveRead>): Promise<Set<string>> {
  const cluster = deps.network.cluster;
  const [markets, floors, budgets, receipts] = await Promise.all([
    readExecutorMarkets(deps.store, cluster),
    deps.store.versioned<FloorRecord>(FLOORS).valuesWithPrefix(`solana:${cluster}:`),
    readBudgetRecords(deps.store, cluster),
    deps.store.collection<AutopilotReceipt>(RECEIPTS).valuesWithPrefix(`solana:${cluster}:`),
  ]);
  const floorOf = new Map(floors.filter((row) => row.cluster === cluster).map((row) => [row.token, row]));
  const budgetOf = new Map(budgets.map((row) => [row.token, row]));
  const receiptsOf = groupReceipts(receipts);
  const moved = new Set<string>();
  for (const record of launched) {
    const curve = curves.get(record.token);
    if (!curve) continue;
    const market = markets.get(record.token) ?? emptyExecutorMarket(cluster, record.token, deps.now());
    const state = executorStateOf({
      record,
      curve,
      market,
      floor: floorOf.get(record.token) ?? null,
      receipts: receiptsOf.get(record.token) ?? [],
      now: Math.floor(deps.now().getTime() / 1000),
      budget: executorClaimsPreset(record.preset) ? (budgetOf.get(record.token) ?? null) : null,
    });
    if (state !== null && state !== market.state) moved.add(record.token);
  }
  return moved;
}

/** Receipts by token, each token's the oldest first — as `autopilotReceipts` gives them. */
function groupReceipts(rows: readonly AutopilotReceipt[]): Map<string, AutopilotReceipt[]> {
  const byToken = new Map<string, AutopilotReceipt[]>();
  for (const row of rows) byToken.set(row.token, [...(byToken.get(row.token) ?? []), row]);
  for (const list of byToken.values()) list.sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0));
  return byToken;
}

/* ------------------------------------------------------------------ the executor's marks */

const iso = (deps: AutopilotDeps) => deps.now().toISOString();
const unix = (deps: AutopilotDeps) => Math.floor(deps.now().getTime() / 1000);
const seconds = (at: string | null | undefined): number | null => {
  const parsed = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
};

/** The executor's first pass over a market, noted once in its log — the mark first, under a key of its own, so a pass that dies between the two writes it once. */
async function watchOnce(deps: AutopilotDeps, token: string): Promise<AutopilotStep[]> {
  const known = await readExecutorMarket(deps.store, deps.network.cluster, token);
  if (known?.watchedAt) return [];
  const at = iso(deps);
  await writeJournalMark(deps.store, deps.network.cluster, token, { kind: "WATCH_STARTED", at, actor: "ryntra", state: null, from: null, signature: null, scope: null, pairRaw: null }, "WATCH_STARTED");
  await updateExecutorMarket(deps.store, deps.network.cluster, token, deps.now(), (market) => ({ ...market, watchedAt: market.watchedAt ?? at }));
  return [{ token, step: "WATCH_STARTED" }];
}

/**
 * A curve that has moved: a run of failed graduations is over, and a graduation of ours that was in flight gets its
 * receipt from its own transaction — kept in flight until that transaction is read or the graduation has a receipt.
 */
async function settleMoved(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<void> {
  const token = record.token;
  const known = await readExecutorMarket(deps.store, deps.network.cluster, token);
  if (!known || (known.graduation === null && known.failures === 0)) return;
  let landed = known.graduation === null;
  if (known.graduation) {
    const receipted = (await autopilotReceipts(deps.store, deps.network.cluster, token)).some((row) => row.kind === "GRADUATED");
    const facts = receipted ? null : await deps.chain.transaction(known.graduation.signature).catch(() => null);
    if (facts && !facts.failed) await writeReceipt(deps, receiptOf(deps, { kind: "GRADUATED", token, signature: known.graduation.signature, facts, actor: "ryntra", pairRaw: curve.thresholdRaw.toString() }));
    landed = receipted || facts !== null;
  }
  await updateExecutorMarket(deps.store, deps.network.cluster, token, deps.now(), (market) => ({ ...market, graduation: landed ? null : market.graduation, failures: 0, failedAt: null }));
}

/**
 * The market's state as the executor reads it — by the same definitions as a market's health — when it is one the
 * executor writes down: from the move to the DEX on. Null on the curve.
 */
export function executorStateOf(
  args: Readonly<{ record: LaunchRecord; curve: CurveRead; market: ExecutorMarket; floor: FloorRecord | null; receipts: readonly AutopilotReceipt[]; now: number; budget?: MarketBudgetRecord | null }>,
): MarketCycleState | null {
  const budget = args.budget ?? null;
  const { curve, market, receipts, now } = args;
  const graduation = receipts.find((receipt) => receipt.kind === "GRADUATED") ?? null;
  const placed = [...receipts].reverse().find((receipt) => receipt.kind === "FLOOR_PLACED") ?? null;
  const placedAt = args.floor?.state === "PLACED" ? (seconds(placed?.at) ?? now) : null;
  const maintained =
    placedAt === null ? null : ([...receipts].reverse().find((receipt) => (receipt.kind === "FLOOR_RAISED" || receipt.kind === "FLOOR_ADDED") && (seconds(receipt.at) ?? 0) >= placedAt) ?? null);
  const cycle = marketCycleState({
    migrated: curve.migrated,
    migrationProgress: null,
    reserveRaw: curve.reserveRaw,
    thresholdRaw: curve.thresholdRaw,
    finishedAt: curve.finishedAt,
    launchedAt: seconds(args.record.launchedAt) ?? now,
    foreignTrade: { seen: null, at: null },
    graduatedAt: curve.migrated ? (seconds(graduation?.at) ?? curve.finishedAt) : null,
    ladder: { placedAt, maintainedAt: maintained ? (seconds(maintained.at) ?? now) : null },
    budget: budget?.exhaustedAt ? { state: "EXHAUSTED", at: seconds(budget.exhaustedAt) } : market.budgetAt ? { state: "FUNDED", at: seconds(market.budgetAt) } : null,
    /* A risk limit of the budget's holds: no new money goes into the steps until it clears. */
    pause: curve.migrated && budget && budget.risks.length ? { at: budget.riskAt } : null,
    migrationSent: market.graduation !== null,
    migrationFailedAt: market.failures > 0 ? market.failedAt : null,
    now,
  });
  return EXECUTOR_JOURNALED_STATES.has(cycle.state) ? cycle.state : null;
}

/** A market's new state, noted in its log with the transaction it rests on; the same state twice is noted once. */
async function noteState(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<AutopilotStep[]> {
  const cluster = deps.network.cluster;
  const token = record.token;
  const market = (await readExecutorMarket(deps.store, cluster, token)) ?? emptyExecutorMarket(cluster, token, deps.now());
  const receipts = await autopilotReceipts(deps.store, cluster, token);
  const stored = await floorRecord(deps.store, cluster, token);
  const budget = executorClaimsPreset(record.preset) ? await readBudgetRecord(deps.store, cluster, token) : null;
  const state = executorStateOf({ record, curve, market, floor: stored, receipts, now: unix(deps), budget });
  if (state === null || state === market.state) return [];
  /* A retry in flight after a failed graduation is not a new state of the market: the log has the failure, then the DEX. */
  if (state === "MIGRATING" && market.state === "MIGRATION_FAILED") return [];
  const latest = (kinds: readonly AutopilotKind[]) => [...receipts].reverse().find((receipt) => kinds.includes(receipt.kind))?.signature ?? null;
  const signature =
    state === "CORE_MARKET_LIVE"
      ? latest(["GRADUATED"])
      : state === "MIGRATING"
        ? (market.graduation?.signature ?? null)
        : state === "LADDER_ACTIVE"
          ? latest(["FLOOR_PLACED"])
          : state === "MAINTAINING"
            ? latest(["FLOOR_RAISED", "FLOOR_ADDED"])
            : null;
  const mark: JournalMark = {
    kind: "STATE",
    at: iso(deps),
    actor: "ryntra",
    state,
    from: market.state,
    signature,
    scope: null,
    pairRaw: state === "ENDOWMENT_FUNDED" ? market.budgetRaw : null,
    ...(state === "PAUSED_RISK" ? { risks: [...(budget?.risks ?? [])] } : {}),
  };
  /* The mark first, keyed by the record's next version: a pass that dies before the record is written writes the same mark again, not a second one. */
  await writeJournalMark(deps.store, cluster, token, mark, `STATE:${state}:v${market.version + 1}`);
  await updateExecutorMarket(deps.store, cluster, token, deps.now(), (current) => ({ ...current, state }));
  return [{ token, step: `STATE_${state}`, ...(signature ? { signature } : {}) }];
}

/**
 * Ryntra's collector on the holders' positions (the decision of 2026-10-07): on a position whose permission
 * is exactly Ryntra's two bits, with at least a dollar waiting and no claim of its in a day, the fees are claimed — the
 * program pays them only to the owner's own accounts. Every claim is written down before the send and becomes a receipt
 * from its confirmed transaction: what the owner's accounts received. A claim whose answer was lost is read again by the
 * next pass; it never sends a second while the first may still land.
 */
async function collectForHolders(deps: AutopilotDeps, end: number, stops: ExecutorStops): Promise<AutopilotStep[]> {
  /* A position on a market the operator stopped waits: the collector signs nothing there either. */
  const all = (await allHolderPositions(deps.store, deps.network.cluster)).filter((row) => stopOn(stops, row.token) === null);
  const steps: AutopilotStep[] = [];
  /* An entry whose answer was lost is settled here too: the holder need not come back for the collector to start. */
  const opened: HolderPositionRecord[] = [];
  /* A few a pass: a burst of lost answers never eats the pass before the claims. */
  for (const row of all.filter((each) => each.state === "PENDING").slice(0, 10)) {
    if (deps.now().getTime() > end) break;
    const now = await settleEntryOf(deps, row).catch(() => row);
    if (now && now.state === "OPEN") opened.push(now);
  }
  /* The positions not due yet are skipped without a read; the rest go oldest-checked first, so none waits behind the others. */
  const checks = new Map((await deps.store.collection<HolderCheck>(HOLDER_CHECKS).valuesWithPrefix(`${deps.network.cluster}:`)).map((check) => [check.position, check]));
  const at = deps.now().getTime();
  const rows = [...all.filter((row) => row.state === "OPEN"), ...opened]
    .filter((row) => (checks.get(row.position)?.nextAt ?? 0) <= at)
    .sort((a, b) => (checks.get(a.position)?.checkedAt ?? 0) - (checks.get(b.position)?.checkedAt ?? 0));
  if (!rows.length) return steps;
  const pools = new Map<string, HolderPool>();
  for (const row of rows) {
    if (deps.now().getTime() > end) break;
    /* One instance at a time on a position: two passes never claim it together. */
    const done = await leased(deps, `holder-${row.position}`, async () => {
      try {
        return await collectOne(deps, row, pools);
      } catch (error) {
        if (error instanceof StoppedNow) return [{ token: row.token, step: "HOLDER_STOPPED" }];
        if (error instanceof OutOfTime) return [{ token: row.token, step: "HOLDER_OUT_OF_TIME" }];
        return [{ token: row.token, step: `HOLDER_ERROR: ${message(error)}` }];
      }
    });
    steps.push(...done.map((step) => (step.step === "LEASED" ? { token: row.token, step: "HOLDER_LEASED" } : step)));
    await noteHolderCheck(deps, row.position, done.map((step) => step.step)).catch(() => undefined);
    if (done.some((step) => step.step === "HOLDER_LOW_SOL")) break;
  }
  return steps;
}

/**
 * When the collector reads a position again — its own pace, apart from the day rule: under a dollar, without the
 * permission or with an account of the owner's closed (only a read, no fee), an hour; a claim refused or failed, six
 * hours (a claim costs the collector its fee, a retry every minute would pay it for nothing); a position closed, a day;
 * a read that failed, ten minutes; a claim made or one to read, the next pass.
 */
type HolderCheck = Readonly<{ position: string; checkedAt: number; nextAt: number }>;
const HOUR_MS = 60 * 60 * 1000;
async function noteHolderCheck(deps: AutopilotDeps, position: string, results: readonly string[]): Promise<void> {
  const at = deps.now().getTime();
  const later = results.some((step) => step === "HOLDER_CLOSED")
    ? 24 * HOUR_MS
    : results.some((step) => /^HOLDER_(CLAIM_REFUSED|CLAIM_FAILED|CLAIM_LAPSED|MOVED)$/.test(step))
      ? 6 * HOUR_MS
      : results.some((step) => /^HOLDER_(WAIT|NO_ACCOUNT|NONE|WIDER|OTHER_DELEGATE|TRANSFERABLE)$/.test(step))
        ? HOUR_MS
        : results.some((step) => step.startsWith("HOLDER_ERROR"))
          ? 10 * 60 * 1000
          : 0;
  await deps.store.collection<HolderCheck>(HOLDER_CHECKS).set(`${deps.network.cluster}:${position}`, { position, checkedAt: at, nextAt: at + later });
}

/** A PENDING entry as the chain settles it: landed — OPEN; never landed and no position — gone; not known yet — as it was. */
async function settleEntryOf(deps: AutopilotDeps, row: HolderPositionRecord): Promise<HolderPositionRecord | null> {
  const outcome = await deps.chain.outcome(row.entrySignature, Number(row.validUntil));
  if (outcome === "CONFIRMED") {
    const open: HolderPositionRecord = { ...row, state: "OPEN" };
    await putHolderPosition(deps.store, open);
    return open;
  }
  if (outcome === "FAILED" || outcome === "REJECTED" || outcome === "EXPIRED") {
    const pool = await deps.chain.holder.pool(row.pool, row.token);
    const read = await deps.chain.holder.readPosition(pool, row);
    if (read.closed) {
      await dropHolderPosition(deps.store, row);
      return null;
    }
    const open: HolderPositionRecord = { ...row, state: "OPEN" };
    await putHolderPosition(deps.store, open);
    return open;
  }
  return row;
}

async function collectOne(deps: AutopilotDeps, row: HolderPositionRecord, pools: Map<string, HolderPool>): Promise<AutopilotStep[]> {
  const claims = await holderClaims(deps, row.position);
  /* A claim sent and not read yet: read it first; nothing new is sent on the position meanwhile. */
  const pending = claims.find((claim) => claim.state === "PENDING");
  if (pending) {
    return [await settleHolderClaim(deps, row.token, pending)];
  }
  /* Claimed within the day: nothing to read on chain until the day is out — the rule is at most a claim a day. */
  const last = claims[0]?.sentAt ?? null;
  if (last && deps.now().getTime() - Date.parse(last) < HOLDER_CLAIM_EVERY_MS) {
    return [{ token: row.token, step: "HOLDER_WAIT" }];
  }
  const pool = pools.get(row.pool) ?? (await deps.chain.holder.pool(row.pool, row.token));
  pools.set(row.pool, pool);
  const read = await deps.chain.holder.readPosition(pool, row);
  if (read.closed) {
    return [{ token: row.token, step: "HOLDER_CLOSED" }];
  }
  if (!read.owner) {
    return [{ token: row.token, step: "HOLDER_MOVED" }];
  }
  const grant = holderGrantState({ delegate: read.delegate, delegatedAmount: read.delegatedAmount, bitmask: read.bitmask, collector: deps.chain.executor });
  if (grant !== "GRANTED") {
    return [{ token: row.token, step: `HOLDER_${grant}` }];
  }
  /* An account of the owner's the fees are paid into is closed: the collector does not reopen it at its cost; it waits, and the position says so. */
  if (closedAccountsOf(read).length) {
    return [{ token: row.token, step: "HOLDER_NO_ACCOUNT" }];
  }
  if (!collectorShouldClaim({ claimablePairRaw: BigInt(read.unclaimedPairRaw), pairDecimals: pool.pairDecimals, pairIsDollar: row.pairDollar === true, lastClaimAt: last, now: deps.now().getTime() })) {
    return [{ token: row.token, step: "HOLDER_WAIT" }];
  }
  if (!(await solFor(deps, EXECUTOR_FLOOR_LAMPORTS, FEE_LAMPORTS))) {
    return [{ token: row.token, step: "HOLDER_LOW_SOL" }];
  }
  const tx = await deps.chain.holder.buildCollectorClaim(pool, { collector: deps.chain.executor, owner: read.owner, position: row.position, nftMint: row.nftMint });
  if (!tx) {
    return [{ token: row.token, step: "HOLDER_NO_ACCOUNT" }];
  }
  /* The program pays a delegate's claim only to the position's owner: their accounts are the one destination allowed. */
  const prepared = await prepareChecked(deps, row.token, tx, [], [read.owner]);
  const claim: HolderClaimReceipt = {
    cluster: deps.network.cluster,
    position: row.position,
    owner: read.owner,
    token: row.token,
    pairMint: pool.pairMint,
    signature: prepared.signature,
    state: "PENDING",
    sentAt: deps.now().toISOString(),
    validUntil: prepared.validUntil,
    at: null,
    pairRaw: "0",
    tokenRaw: "0",
    lamports: null,
  };
  /* Written before the send: a lost answer still leaves the claim to read. */
  await writeHolderClaim(deps.store, claim);
  const sent = await deps.chain.send(tx, prepared.validUntil);
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await dropHolderClaim(deps.store, claim);
    return [{ token: row.token, step: "HOLDER_CLAIM_REFUSED", signature: sent.signature }];
  }
  return [await settleHolderClaim(deps, row.token, claim)];
}

/** A claim the collector sent, read from its transaction: a receipt of what the owner received, or let go when it never landed. */
async function settleHolderClaim(deps: AutopilotDeps, token: string, claim: HolderClaimReceipt): Promise<AutopilotStep> {
  const facts = await deps.chain.transaction(claim.signature);
  if (facts && !facts.failed) {
    await setHolderClaim(deps.store, { ...claim, state: "CONFIRMED", at: facts.at, pairRaw: facts.deltaOf(claim.owner, claim.pairMint).toString(), tokenRaw: facts.deltaOf(claim.owner, token).toString(), lamports: facts.lamportsSpent?.toString() ?? null });
    return { token, step: "HOLDER_CLAIMED", signature: claim.signature };
  }
  if (facts?.failed) {
    await dropHolderClaim(deps.store, claim);
    return { token, step: "HOLDER_CLAIM_FAILED", signature: claim.signature };
  }
  const outcome = await deps.chain.outcome(claim.signature, claim.validUntil);
  if (outcome === "EXPIRED" || outcome === "REJECTED" || outcome === "FAILED") {
    await dropHolderClaim(deps.store, claim);
    return { token, step: "HOLDER_CLAIM_LAPSED", signature: claim.signature };
  }
  return { token, step: "HOLDER_CLAIM_PENDING", signature: claim.signature };
}

/* An error's words, a node's address cut to its host: a key in a query string never reaches an answer. */
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/(https?:\/\/[^/\s?#]+)[^\s"']*/g, "$1").slice(0, 160) : "unknown");

/** The operator stopped this market — or every market — after the pass began: nothing more is signed on it. */
class StoppedNow extends Error {}
/** The pass has no time left to see a send through: nothing new is signed until the next minute. */
class OutOfTime extends Error {}

/**
 * Every transaction of the executor's is signed here, and only after two checks made at that moment, before anything is
 * written down for it: the operator's switch read again from the store — a stop flipped while the pass runs holds at
 * once —, and the pass still inside its time, so a send is never started that the minute cannot see through.
 */
async function prepareChecked(deps: AutopilotDeps, token: string, tx: Transaction, extra: readonly Keypair[], payees: readonly string[] = []): Promise<Readonly<{ signature: string; validUntil: number }>> {
  if (deps.deadline !== undefined && deps.now().getTime() > deps.deadline) throw new OutOfTime("out of time");
  const stops = await readExecutorStops(deps.store, deps.network.cluster).catch(() => null);
  if (!stops || stopOn(stops, token)) throw new StoppedNow("stopped");
  /* A person's market: the operator's switch of people's markets read again — closed while the pass runs, it holds at once. */
  if (PEOPLE_MARKETS.get(deps)?.has(token) && !(await (deps.peopleOpen?.() ?? Promise.resolve(false)).catch(() => false))) throw new StoppedNow("people closed");
  return deps.chain.prepare(tx, extra, payees);
}

async function leased(deps: AutopilotDeps, token: string, act: () => Promise<AutopilotStep[]>): Promise<AutopilotStep[]> {
  const holder = randomUUID();
  if (!(await takeLease(deps, token, holder))) return [{ token, step: "LEASED" }];
  const setAside = { reserved: 0n };
  try {
    return await ACT_SET_ASIDE.run(setAside, act);
  } catch (error) {
    if (error instanceof StoppedNow) return [{ token, step: "STOPPED" }];
    if (error instanceof OutOfTime) return [{ token, step: "OUT_OF_TIME" }];
    return [{ token, step: `ERROR: ${message(error)}` }];
  } finally {
    /* The act is over: what it set aside is given back — what it spent, the wallet itself now shows. */
    const ledger = SOL_SET_ASIDE.get(deps);
    if (ledger) ledger.reserved -= setAside.reserved;
    await dropLease(deps, token, holder).catch(() => undefined);
  }
}

async function takeLease(deps: AutopilotDeps, token: string, holder: string): Promise<boolean> {
  const leases = deps.store.versioned<Lease>(LEASES);
  const key = floorKey(deps.network.cluster, token);
  const now = deps.now().getTime();
  /* `false` asks the store again (the record moved under the write); a lease another instance holds is an answer. */
  return withBoundedCasRetry(async () => {
    const current = await leases.get(key);
    if (current && current.until > now && current.holder !== holder) return { taken: false };
    return (await leases.compareAndSet(key, current ? current.version : null, { version: (current?.version ?? -1) + 1, holder, until: now + LEASE_MS })) ? { taken: true } : false;
  })
    .then((answer) => answer.taken)
    .catch(() => false);
}

async function dropLease(deps: AutopilotDeps, token: string, holder: string): Promise<void> {
  const leases = deps.store.versioned<Lease>(LEASES);
  const key = floorKey(deps.network.cluster, token);
  const current = await leases.get(key);
  if (current?.holder === holder) await leases.compareAndSet(key, current.version, { version: current.version + 1, holder, until: 0 });
}

/* ------------------------------------------------------------------ graduation */

/**
 * A full curve graduated by the executor. A graduation of its own still in flight is read first — nothing new is sent
 * while it may land. One that failed — refused, failed on chain, expired unseen — is sent again: at once after the first
 * failure, then after a growing wait (`graduationRetryDelaySeconds`). Each is written down before its send, and its
 * receipt comes only from the transaction read back.
 */
async function graduate(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<AutopilotStep[]> {
  const token = record.token;
  const cluster = deps.network.cluster;
  let market = (await readExecutorMarket(deps.store, cluster, token)) ?? emptyExecutorMarket(cluster, token, deps.now());
  const steps: AutopilotStep[] = [];
  if (market.graduation) {
    const { signature, validUntil } = market.graduation;
    const outcome = await deps.chain.outcome(signature, validUntil);
    if (outcome === "UNKNOWN") return [{ token, step: "GRADUATION_PENDING", signature }];
    if (outcome === "CONFIRMED") {
      const facts = await deps.chain.transaction(signature);
      if (!facts) return [{ token, step: "GRADUATION_PENDING", signature }];
      if (!facts.failed) {
        await graduated(deps, record, curve, signature, facts);
        return [{ token, step: "GRADUATION_LANDED", signature }];
      }
      market = await graduationFailed(deps, token, market, signature, true);
    } else market = await graduationFailed(deps, token, market, signature, outcome === "FAILED");
    steps.push({ token, step: "GRADUATION_FAILED_EARLIER", signature });
  }
  if (market.failures > 0 && market.failedAt !== null && unix(deps) < market.failedAt + graduationRetryDelaySeconds(market.failures)) {
    return [...steps, { token, step: "GRADUATION_WAIT" }];
  }
  if (!(await solFor(deps, EXECUTOR_FLOOR_LAMPORTS, GRADUATION_LAMPORTS))) return [...steps, { token, step: "LOW_SOL" }];
  const built = await deps.chain.buildMigration(record);
  const prepared = await prepareChecked(deps, token, built.transaction, built.signers);
  /* Written before the send: an answer lost still leaves the graduation to read, and no second is sent over it. */
  market = await updateExecutorMarket(deps.store, cluster, token, deps.now(), (current) => ({ ...current, graduation: { signature: prepared.signature, validUntil: prepared.validUntil, sentAt: iso(deps) } }));
  const sent = await deps.chain.send(built.transaction, prepared.validUntil);
  if (sent.outcome === "UNKNOWN") return [...steps, { token, step: "GRADUATION_SENT", signature: sent.signature }];
  if (sent.outcome !== "CONFIRMED") {
    await graduationFailed(deps, token, market, sent.signature, sent.outcome === "FAILED");
    return [...steps, { token, step: `GRADUATION_${sent.outcome}`, signature: sent.signature }];
  }
  /* Read back; a transaction not read yet stays in flight and is recorded by the next pass — never guessed. */
  const facts = await deps.chain.transaction(sent.signature);
  if (facts?.failed) {
    await graduationFailed(deps, token, market, sent.signature, true);
    return [...steps, { token, step: "GRADUATION_FAILED", signature: sent.signature }];
  }
  if (facts) await graduated(deps, record, curve, sent.signature, facts);
  return [...steps, { token, step: "GRADUATED", signature: sent.signature }];
}

/** A graduation of the executor's read back from its transaction: its receipt, and the run of failures over. */
async function graduated(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead, signature: string, facts: TxFacts): Promise<void> {
  await writeReceipt(deps, receiptOf(deps, { kind: "GRADUATED", token: record.token, signature, facts, actor: "ryntra", pairRaw: curve.thresholdRaw.toString() }));
  await updateExecutorMarket(deps.store, deps.network.cluster, record.token, deps.now(), (current) => ({ ...current, graduation: null, failures: 0, failedAt: null }));
}

/**
 * A graduation that did not go through: counted, its time kept for the wait before the next, the market's state now a
 * failed graduation. The log has the first failure of a run, and each failed attempt that landed — a transaction of
 * Ryntra's — up to `GRADUATION_FAILURES_LOGGED` in a run; after that the run is counted, not repeated, in the log (the
 * operator sees the count).
 */
async function graduationFailed(deps: AutopilotDeps, token: string, market: ExecutorMarket, signature: string, landed: boolean): Promise<ExecutorMarket> {
  const failures = market.failures + 1;
  if (market.failures === 0 || (landed && failures <= GRADUATION_FAILURES_LOGGED)) {
    /* The mark first, keyed by the run's count: a pass that dies before the record is written writes it once. */
    await writeJournalMark(
      deps.store,
      deps.network.cluster,
      token,
      {
        kind: "GRADUATION_FAILED",
        at: iso(deps),
        actor: "ryntra",
        state: "MIGRATION_FAILED",
        from: market.state === "MIGRATION_FAILED" ? null : market.state,
        signature: landed ? signature : null,
        scope: null,
        pairRaw: null,
      },
      `GRADUATION_FAILED:${signature}`,
    );
  }
  return updateExecutorMarket(deps.store, deps.network.cluster, token, deps.now(), (current) => ({
    ...current,
    graduation: null,
    failures: current.failures + 1,
    failedAt: unix(deps),
    state: "MIGRATION_FAILED",
  }));
}

/**
 * A graduation recorded once, whoever sent it: the graduated pool's first transaction, when it is the curve's own
 * migration — the curve's program called at the top with its migration instruction — and its fee payer sent it.
 */
async function recordGraduation(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<AutopilotStep> {
  const known = (await autopilotReceipts(deps.store, deps.network.cluster, record.token)).find((row) => row.kind === "GRADUATED");
  if (known) return { token: record.token, step: "GRADUATED_KNOWN", signature: known.signature };
  if (!curve.dammPool) return { token: record.token, step: "GRADUATION_UNREAD" };
  const first = await deps.chain.oldestSignature(curve.dammPool);
  if (!first) return { token: record.token, step: "GRADUATION_UNREAD" };
  const facts = await deps.chain.transaction(first);
  if (!facts) return { token: record.token, step: "GRADUATION_UNREAD" };
  if (facts.failed || !isMigration(facts.logs)) return { token: record.token, step: "GRADUATION_UNPROVEN", signature: first };
  const actor = graduationActor(facts.feePayer, deps.chain.executor);
  await writeReceipt(deps, receiptOf(deps, { kind: "GRADUATED", token: record.token, signature: first, facts, actor, pairRaw: curve.thresholdRaw.toString() }));
  return { token: record.token, step: "GRADUATION_RECORDED", signature: first };
}

/** Whether a transaction's logs show the curve's own migration to DAMM v2, called at the top level. */
export function isMigration(logs: readonly string[]): boolean {
  const at = logs.findIndex((line) => line === `Program ${DBC_PROGRAM} invoke [1]`);
  return at >= 0 && logs.slice(at + 1, at + 4).some((line) => line === "Program log: Instruction: MigrationDammV2");
}

/* ------------------------------------------------------------------ the Fee-Funded Liquidity Ladder */

type Save = (next: Omit<FloorRecord, "version" | "updatedAt">) => Promise<FloorRecord>;

/** A budget ladder's geometry before its depth is known: steps of 2.5 %, the first ≈ −4.8 %, the deepest ≈ −25.6 % (`BUDGET_LADDER`). */
export const BUDGET_SHAPE: LadderShape = Object.freeze({ binStep: BUDGET_LADDER.binStep, topGapBins: BUDGET_LADDER.topGapBins, depthBins: BUDGET_LADDER.maxStepsByDepth, raiseStepBins: BUDGET_LADDER.raiseStepBins });

async function floor(deps: AutopilotDeps, record: LaunchRecord, dammPool: string, end: number, funding: "owner" | "budget" = "owner", wallet?: PassWallet, finishOnly = false): Promise<AutopilotStep[]> {
  const token = record.token;
  const floors = deps.store.versioned<FloorRecord>(FLOORS);
  const key = floorKey(deps.network.cluster, token);
  const now = Math.floor(deps.now().getTime() / 1000);
  const base = funding === "budget" ? BUDGET_SHAPE : CLASSIC_SHAPE;
  let current: FloorRecord =
    (await floors.get(key)) ??
    { version: -1, cluster: deps.network.cluster, token, state: "WATCHING", pool: null, position: null, lowerBinId: null, upperBinId: null, placedRaw: "0", samples: [], raiseSeen: null, blocked: null, pending: null, redeposit: null, funding, binStep: base.binStep, updatedAt: deps.now().toISOString() };
  /* A record keeps the pool it was made for: its own bin step, the operator's 1 % on records from before budgets. */
  const shape: LadderShape = { ...base, binStep: current.binStep ?? CLASSIC_SHAPE.binStep };
  const save: Save = async (next) => {
    const written: FloorRecord = { ...next, version: current.version + 1, updatedAt: deps.now().toISOString() };
    if (!(await floors.compareAndSet(key, current.version < 0 ? null : current.version, written))) throw new Error("The liquidity's record changed under this pass.");
    current = written;
    return written;
  };
  if (current.blocked) return [{ token, step: `FLOOR_BLOCKED_${current.blocked}` }];

  /* An act whose answer was lost is settled from the chain before anything new is sent. */
  if (current.pending) {
    const settled = await settle(deps, current);
    if (settled === "WAIT") return [{ token, step: "FLOOR_PENDING", signature: current.pending.signature }];
    await save(settled);
  }
  /* A person's ladder after the switch closed: a move begun puts its money back; nothing else is done. */
  if (finishOnly) {
    if (current.state === "PLACED" && current.redeposit && current.pool && current.position) return [{ token, step: "FLOOR_PEOPLE_CLOSED" }, ...(await finishMove(deps, current, current.samples, 0n, save))];
    return [{ token, step: "FLOOR_PEOPLE_CLOSED" }];
  }

  /* Read in bulk for the pass where it was; a pool the bulk read missed waits a pass — never read alone after its node refused. */
  const price = wallet?.prices ? (wallet.prices.get(dammPool) ?? null) : await deps.chain.price(dammPool, token);
  if (!price || !(price.price > 0)) return [{ token, step: "NO_PRICE" }];
  const marketBin = binOfPrice(price.price, shape.binStep, price.tokenDecimals, price.pairDecimals);
  const samples = addSample(current.samples, now, marketBin);
  const reference = referenceBin(marketBin, samples);
  /*
   * What emptying the steps took out sits in the wallet but is owed back to them: never free for a top-up. While the
   * amount is not read yet, nothing is free.
   */
  const owed = current.redeposit ? (current.redeposit.raw === null ? null : BigInt(current.redeposit.raw)) : 0n;
  /*
   * One wallet holds every market's budget, the money owed back to steps being moved and Ryntra's revenue: a ladder may
   * take only what is its own — a budget market its own reserve, the operator's Classic ladder none of the budgets and
   * none of the revenue.
   */
  const shares = await sharesOf(deps, price.pairMint, funding === "budget" ? wallet : undefined);
  const ownReserve = funding === "budget" ? (shares.reserves.get(token) ?? 0n) : 0n;
  const free = owed === null || shares.owedUnread ? 0n : walletFreeRaw({ walletPairRaw: shares.held, reservesRaw: shares.reservesTotal, ownReserveRaw: ownReserve, owedRaw: shares.owedTotal, revenueLeftRaw: shares.revenueLeft });
  let budget: bigint;
  let gate: BudgetGate | null = null;
  if (funding === "budget") {
    /* The risk limits first: with the price unchecked or the reads interrupted, this pass only reads — but a move already begun puts its money back. */
    gate = await budgetGate(deps, record, dammPool, price.price, now, wallet);
    if (!gate.act) {
      if (gate.data === "STALE") await save({ ...current, samples });
      if (current.state === "PLACED" && current.redeposit && current.pool && current.position) return [{ token, step: `BUDGET_DATA_${gate.data}` }, ...(await finishMove(deps, current, current.samples, 0n, save))];
      return [{ token, step: `BUDGET_DATA_${gate.data}` }];
    }
    budget = gate.risks.length
      ? 0n
      : budgetPlaceableRaw({
          earnedRaw: gate.figures.totals.earnedRaw,
          placedRaw: BigInt(current.placedRaw),
          costsRaw: gate.figures.costsRaw,
          freeRaw: free,
          topUp: current.state === "PLACED",
          dayTopUpsRaw: dayTopUpsRaw(gate.record?.topUps ?? [], now),
        });
  } else {
    const earned = await deps.chain.partnerEarned(record);
    budget = floorBudgetRaw({ partnerEarnedRaw: earned, placedRaw: BigInt(current.placedRaw), freeRaw: free });
  }
  const owner = deps.chain.executor;

  if (current.state === "WATCHING") {
    if (!readyToPlace(samples, now)) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_SAMPLING" }];
    }
    if (budget === 0n) {
      await save({ ...current, samples });
      return [{ token, step: gate?.risks.length ? `BUDGET_RISK_${gate.risks.join("_")}` : "FLOOR_NO_BUDGET" }];
    }
    if (!(await solFor(deps, FLOOR_START_LAMPORTS, FLOOR_START_LAMPORTS - EXECUTOR_FLOOR_LAMPORTS))) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_LOW_SOL" }];
    }
    let pool = await deps.chain.floor.pool(token, price.pairMint);
    /* A creation whose answer was lost: its receipt from the chain now that the pool is there. */
    if (pool && current.poolSent) {
      const outcome = await deps.chain.outcome(current.poolSent.signature, current.poolSent.validUntil);
      const facts = outcome === "CONFIRMED" ? await deps.chain.transaction(current.poolSent.signature) : null;
      if (facts && !facts.failed) await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_POOL", token, signature: current.poolSent.signature, facts, actor: "ryntra", pairMint: price.pairMint }));
      if (outcome !== "UNKNOWN" && (outcome !== "CONFIRMED" || facts)) await save({ ...current, poolSent: null });
    }
    /* No second creation while the first may still land — its receipt would be lost; one that never landed is let go. */
    if (!pool && current.poolSent) {
      const outcome = await deps.chain.outcome(current.poolSent.signature, current.poolSent.validUntil);
      if (outcome === "UNKNOWN" || outcome === "CONFIRMED") {
        await save({ ...current, samples });
        return [{ token, step: "FLOOR_POOL_PENDING", signature: current.poolSent.signature }];
      }
      await save({ ...current, samples, poolSent: null });
    }
    if (pool && !poolAccepted(pool, owner, now, shape.binStep)) {
      await save({ ...current, samples, blocked: "POOL_TAKEN" });
      return [{ token, step: "FLOOR_BLOCKED_POOL_TAKEN" }];
    }
    const steps: AutopilotStep[] = [];
    if (!pool) {
      const proof = (await deps.chain.held(token)) > 0n ? null : { dammPool, amountRaw: PROOF_RAW };
      const tx = await deps.chain.floor.createPool({ token, pair: price.pairMint, activeBinId: reference, payer: owner, proof, binStep: shape.binStep });
      const prepared = await prepareChecked(deps, token, tx, []);
      const sentDown = await save({ ...current, samples, poolSent: { signature: prepared.signature, validUntil: prepared.validUntil } });
      const sent = await deps.chain.send(tx, prepared.validUntil);
      /* A pool whose answer was lost is found by its address next pass, and its receipt written then; nothing else is sent now. */
      if (sent.outcome !== "CONFIRMED") {
        if (sent.outcome !== "UNKNOWN") await save({ ...sentDown, poolSent: null });
        return [{ token, step: `FLOOR_POOL_${sent.outcome}`, signature: sent.signature }];
      }
      const facts = await deps.chain.transaction(sent.signature);
      if (facts && !facts.failed) {
        await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_POOL", token, signature: sent.signature, facts, actor: "ryntra", pairMint: price.pairMint }));
        await save({ ...sentDown, poolSent: null });
      }
      steps.push({ token, step: "FLOOR_POOL", signature: sent.signature });
      /* The proof's cent came out of what was free: the steps get the rest, never another's money. */
      if (proof && budget + proof.amountRaw > free) budget = free > proof.amountRaw ? free - proof.amountRaw : 0n;
      if (budget === 0n || (funding === "budget" && budget < BUDGET_RULE.minStepRaw)) {
        await save({ ...current, samples, pool: null });
        return [...steps, { token, step: "FLOOR_NO_BUDGET" }];
      }
      pool = await deps.chain.floor.pool(token, price.pairMint);
      if (!pool) return [...steps, { token, step: "FLOOR_POOL_UNREAD" }];
      if (deps.now().getTime() > end) {
        await save({ ...current, samples, pool: pool.pool });
        return steps;
      }
    }
    /* Our pool's price taken to the price that held, through its empty bins, before the steps go in below it. */
    if (pool.activeBinId !== reference) {
      const tx = await deps.chain.floor.syncSteps({ pool: pool.pool, owner, position: null, activeBinId: reference });
      if (tx) {
        const prepared = await prepareChecked(deps, token, tx, []);
        const sent = await deps.chain.send(tx, prepared.validUntil);
        if (sent.outcome !== "CONFIRMED") return [...steps, { token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
      }
      pool = { ...pool, activeBinId: reference };
    }
    /* A budget's ladder: as many steps as it pays 5 USDC each for; the Classic rule: its 45. */
    const ladder = floorLadder(pool.activeBinId, funding === "budget" ? { ...shape, depthBins: Math.max(1, budgetSteps(budget)) } : shape);
    const opened = await deps.chain.floor.openSteps({ pool: pool.pool, owner, ladder, amountRaw: budget });
    const tx = opened.transactions[0]!;
    const prepared = await prepareChecked(deps, token, tx, [opened.position]);
    const position = opened.position.publicKey.toBase58();
    /* The position's address is kept before the send: an answer lost still leaves the steps findable. */
    const pending: Pending = { kind: "FLOOR_PLACED", signature: prepared.signature, validUntil: prepared.validUntil, position, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId, pairRaw: budget.toString(), sentAt: deps.now().toISOString() };
    const saved = await save({ ...current, samples, pool: pool.pool, pending });
    const sent = await deps.chain.send(tx, prepared.validUntil);
    return [...steps, ...(await afterSend(deps, saved, sent, "FLOOR_PLACED", save))];
  }

  /* The steps stand. A move up whose steps were emptied is finished before anything else. */
  if (!current.pool || !current.position) return [{ token, step: "FLOOR_INCOMPLETE" }];
  if (current.redeposit) return finishMove(deps, current, samples, budget, save);
  const read = await deps.chain.floor.readSteps(current.pool, current.position);
  if (!read) return [{ token, step: "FLOOR_UNREAD" }];
  const holdsToken = BigInt(read.tokenRaw) > TOKEN_DUST_RAW;
  /* What the budget's steps hold now, and whether the budget is exhausted — the steps empty of the pair currency, the reserve below a step. */
  if (gate) await noteSteps(deps, record, gate.figures, BigInt(read.pairRaw));
  const decision = floorRaise({ ladder: { lowerBinId: read.lowerBinId, upperBinId: read.upperBinId }, marketBinId: reference, holdsToken, seen: current.raiseSeen, at: now, shape });
  if (decision.raise) {
    if (!(await solFor(deps, EXECUTOR_FLOOR_LAMPORTS + FLOOR_MOVE_LAMPORTS, FLOOR_MOVE_LAMPORTS))) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_LOW_SOL" }];
    }
    return startMove(deps, current, decision.ladder, samples, budget, save);
  }
  /*
   * More is free for these steps: added to them where they stand, the position holding only the pair currency. A budget's
   * ladder grows deeper as the money allows — never fewer than 5 USDC a step, never below ≈ −25.6 %.
   */
  if (budget > 0n && !holdsToken && (await solFor(deps, EXECUTOR_FLOOR_LAMPORTS + FLOOR_MOVE_LAMPORTS, FLOOR_MOVE_LAMPORTS))) {
    const deeper = gate ? read.upperBinId - Math.max(1, budgetSteps(BigInt(read.pairRaw) + budget)) + 1 : read.lowerBinId;
    const ladder = { lowerBinId: Math.min(read.lowerBinId, deeper), upperBinId: read.upperBinId };
    return place(deps, current, ladder, budget, "FLOOR_ADDED", samples, save);
  }
  await save({ ...current, samples, raiseSeen: decision.seen });
  return [{ token, step: decision.seen ? "FLOOR_RAISE_SEEN" : "FLOOR_HOLDS" }];
}

/** A pool of the pair the steps may stand in: ours, or one made on the same terms — open now, nobody able to switch it off. */
export function poolAccepted(pool: FloorPool, executor: string, now: number, binStep: number = FLOOR_RULE.binStep): boolean {
  if (!pool.tokenIsX || pool.binStep !== binStep) return false;
  if (pool.creator === executor) return true;
  return pool.baseFeeBps === FLOOR_RULE.feeBps && pool.collectsFeeInY && pool.enabled && !pool.creatorCanSwitchOff && !pool.alphaVault && pool.activationAt !== null && pool.activationAt <= now;
}

/**
 * A move up, first half: the steps emptied and the pool's price taken to the new level in one transaction, written
 * down before the send — whatever happens to its answer, the next pass finishes it.
 */
async function startMove(deps: AutopilotDeps, current: FloorRecord, ladder: FloorLadder, samples: readonly FloorSample[], budget: bigint, save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  const activeBinId = ladder.upperBinId + (current.funding === "budget" ? BUDGET_LADDER.topGapBins : FLOOR_RULE.topGapBins);
  const tx = await deps.chain.floor.syncSteps({ pool: current.pool!, owner: deps.chain.executor, position: current.position!, activeBinId });
  if (!tx) return place(deps, current, ladder, budget, "FLOOR_RAISED", samples, save);
  const prepared = await prepareChecked(deps, token, tx, []);
  const redeposit: Redeposit = { syncSignature: prepared.signature, validUntil: prepared.validUntil, raw: null, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId };
  const saved = await save({ ...current, samples, raiseSeen: null, redeposit });
  const sent = await deps.chain.send(tx, prepared.validUntil);
  if (sent.outcome === "UNKNOWN") return [{ token, step: "FLOOR_SYNC_PENDING", signature: sent.signature }];
  if (sent.outcome !== "CONFIRMED") {
    await save({ ...saved, redeposit: null });
    return [{ token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
  }
  return [{ token, step: "FLOOR_SYNCED", signature: sent.signature }, ...(await finishMove(deps, saved, samples, budget, save))];
}

/**
 * A move up, second half: what emptying took out — read from that transaction, its own receipt — goes back into the
 * new steps, with the pool's price taken there again if anyone moved it meanwhile.
 */
async function finishMove(deps: AutopilotDeps, current: FloorRecord, samples: readonly FloorSample[], budget: bigint, save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  let record = current;
  let redeposit = current.redeposit!;
  const ladder = { lowerBinId: redeposit.lowerBinId, upperBinId: redeposit.upperBinId };
  const pairMint = await pairOf(deps, token);
  if (redeposit.raw === null) {
    const outcome = await deps.chain.outcome(redeposit.syncSignature, redeposit.validUntil);
    if (outcome === "UNKNOWN") return [{ token, step: "FLOOR_SYNC_PENDING", signature: redeposit.syncSignature }];
    if (outcome !== "CONFIRMED") {
      await save({ ...record, redeposit: null });
      return [{ token, step: `FLOOR_SYNC_${outcome}`, signature: redeposit.syncSignature }];
    }
    const facts = await deps.chain.transaction(redeposit.syncSignature);
    if (!facts) return [{ token, step: "FLOOR_SYNC_UNREAD", signature: redeposit.syncSignature }];
    if (facts.failed) {
      await save({ ...record, redeposit: null });
      return [{ token, step: "FLOOR_SYNC_FAILED", signature: redeposit.syncSignature }];
    }
    const taken = facts.delta(pairMint);
    const withdrawn = taken > 0n ? taken : 0n;
    await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_WITHDRAWN", token, signature: redeposit.syncSignature, facts, actor: "ryntra", pairRaw: withdrawn.toString(), pool: record.pool, position: record.position }));
    redeposit = { ...redeposit, raw: withdrawn.toString() };
    record = await save({ ...record, samples, redeposit });
  }
  /* The pool's price may have been moved since — `go_to_a_bin` asks no signature: taken back first, through empty bins. */
  const pool = await deps.chain.floor.pool(token, pairMint);
  const target = ladder.upperBinId + (current.funding === "budget" ? BUDGET_LADDER.topGapBins : FLOOR_RULE.topGapBins);
  if (pool && pool.activeBinId !== target) {
    const tx = await deps.chain.floor.syncSteps({ pool: record.pool!, owner: deps.chain.executor, position: record.position, activeBinId: target });
    if (tx) {
      const prepared = await prepareChecked(deps, token, tx, []);
      const sent = await deps.chain.send(tx, prepared.validUntil);
      if (sent.outcome !== "CONFIRMED") return [{ token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
    }
  }
  return place(deps, record, ladder, budget, "FLOOR_RAISED", samples, save, BigInt(redeposit.raw ?? "0"));
}

/** One `rebalance_liquidity` into `ladder`: what the steps hold, what came back from emptying them, and the top-up. */
async function place(
  deps: AutopilotDeps,
  current: FloorRecord,
  ladder: FloorLadder,
  topUpRaw: bigint,
  kind: "FLOOR_RAISED" | "FLOOR_ADDED",
  samples: readonly FloorSample[],
  save: Save,
  returningRaw = 0n,
): Promise<AutopilotStep[]> {
  const tx = await deps.chain.floor.placeSteps({ pool: current.pool!, owner: deps.chain.executor, position: current.position!, ladder, amountRaw: returningRaw + topUpRaw });
  const prepared = await prepareChecked(deps, current.token, tx, []);
  const pending: Pending = { kind, signature: prepared.signature, validUntil: prepared.validUntil, position: current.position, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId, pairRaw: topUpRaw.toString(), sentAt: deps.now().toISOString() };
  const saved = await save({ ...current, samples, raiseSeen: null, pending });
  const sent = await deps.chain.send(tx, prepared.validUntil);
  return afterSend(deps, saved, sent, kind, save);
}

async function afterSend(deps: AutopilotDeps, current: FloorRecord, sent: Sent, kind: Pending["kind"], save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  if (sent.outcome === "UNKNOWN") return [{ token, step: `${kind}_PENDING`, signature: sent.signature }];
  const settled = await settle(deps, current, sent.outcome);
  if (settled === "WAIT") return [{ token, step: `${kind}_PENDING`, signature: sent.signature }];
  await save(settled);
  return [{ token, step: sent.outcome === "CONFIRMED" ? kind : `${kind}_${sent.outcome}`, signature: sent.signature }];
}

/**
 * An act's outcome applied to the record: landed and read — its receipt written and the steps where it put them;
 * refused, failed or expired unseen — forgotten, to be decided again (a move's emptied money stays owed to the steps);
 * not known yet, or landed but not read — wait.
 */
async function settle(deps: AutopilotDeps, current: FloorRecord, known?: Sent["outcome"]): Promise<Omit<FloorRecord, "version" | "updatedAt"> | "WAIT"> {
  const pending = current.pending!;
  const outcome = known && known !== "UNKNOWN" ? known : await deps.chain.outcome(pending.signature, pending.validUntil);
  if (outcome === "UNKNOWN") return "WAIT";
  if (outcome !== "CONFIRMED") return { ...current, pending: null };
  const facts = await deps.chain.transaction(pending.signature);
  if (!facts) return "WAIT";
  if (facts.failed) return { ...current, pending: null };
  const pairMint = await pairOf(deps, current.token);
  const decimals = await decimalsOf(deps, current.token);
  const steps = current.pool && pending.position ? await deps.chain.floor.readSteps(current.pool, pending.position).catch(() => null) : null;
  /* A placement: what went in, from the transaction. A move or a top-up: what the steps hold after it — unread, unknown. */
  const putIn = -facts.delta(pairMint);
  const pairRaw = pending.kind === "FLOOR_PLACED" ? (putIn > 0n ? putIn : 0n).toString() : (steps?.pairRaw ?? null);
  await writeReceipt(
    deps,
    receiptOf(deps, {
      kind: pending.kind,
      token: current.token,
      signature: pending.signature,
      facts,
      actor: "ryntra",
      pairRaw,
      pool: current.pool,
      position: pending.position,
      ladder: {
        lowerBinId: pending.lowerBinId,
        upperBinId: pending.upperBinId,
        priceLow: priceOfBin(pending.lowerBinId, current.binStep ?? FLOOR_RULE.binStep, decimals.token, decimals.pair),
        priceHigh: priceOfBin(pending.upperBinId, current.binStep ?? FLOOR_RULE.binStep, decimals.token, decimals.pair),
      },
    }),
  );
  /* What was ever placed grows by money from outside the steps only: a placement's amount, a move's or a top-up's top-up. */
  const added = pending.kind === "FLOOR_PLACED" ? (putIn > 0n ? putIn : 0n) : BigInt(pending.pairRaw);
  /* A budget's top-up counts against the day's ceiling — once, by the transaction that made it. */
  if (current.funding === "budget" && pending.kind !== "FLOOR_PLACED" && added > 0n) {
    const at = seconds(facts.at) ?? unix(deps);
    await updateBudgetRecord(deps.store, { cluster: deps.network.cluster, token: current.token, pairMint, now: deps.now() }, (row) => ({
      ...row,
      topUps: row.topUps.some((entry) => entry.signature === pending.signature)
        ? row.topUps
        : [...row.topUps.filter((entry) => entry.at > at - BUDGET_RULE.dayBeforeSeconds), { at, raw: added.toString(), signature: pending.signature }],
    }));
  }
  return {
    ...current,
    state: "PLACED",
    position: pending.position ?? current.position,
    lowerBinId: pending.lowerBinId,
    upperBinId: pending.upperBinId,
    placedRaw: (BigInt(current.placedRaw) + added).toString(),
    pending: null,
    redeposit: null,
  };
}

/* ------------------------------------------------------------------ the markets' budgets */

/** The order the executor claims a market's fees in: the largest and one-time first. */
const CLAIM_ORDER: readonly BudgetSource[] = ["migration", "surplus", "curve", "lp"];

/** A market's budget figures now: its ledger, what its steps took from it, what its pool cost. */
export async function budgetFiguresOf(store: GuardStore, cluster: string, token: string): Promise<Readonly<{ record: MarketBudgetRecord | null; figures: BudgetFigures }>> {
  const [record, stored, receipts] = await Promise.all([readBudgetRecord(store, cluster, token), floorRecord(store, cluster, token), autopilotReceipts(store, cluster, token)]);
  const costs = receipts.filter((row) => row.kind === "FLOOR_POOL").reduce((total, row) => total + BigInt(row.pairRaw ?? "0"), 0n);
  return { record, figures: budgetFigures({ record, placedRaw: BigInt(stored?.placedRaw ?? "0"), costsRaw: costs }) };
}

/**
 * One claim of a market's partner fees into its budget, one source a pass: a claim of its own still in flight is read
 * first; then the first source that holds a fee — the migration fee, the partner's surplus, the curve's fees, and the
 * locked position's fees once a day from 1 USDC. Only where the config's fee claimer on chain is the executor. Written
 * down before the send; counted only from the confirmed transaction — what the executor's accounts received.
 */
async function claimBudget(deps: AutopilotDeps, record: LaunchRecord): Promise<AutopilotStep[]> {
  const token = record.token;
  const where = { cluster: deps.network.cluster, token, pairMint: record.pairMint, now: deps.now() };
  const known = await readBudgetRecord(deps.store, deps.network.cluster, token);
  if (known?.pending) return [await settleClaim(deps, record, known.pending)];
  const read = await deps.chain.partnerFees(record);
  /* The config on chain names the claimer: a market whose fee claimer is not the executor is never claimed by it. */
  if (read.feeClaimer !== deps.chain.executor) return [{ token, step: "BUDGET_NOT_CLAIMER" }];
  const now = unix(deps);
  const holds = (source: BudgetSource): boolean => {
    if (source === "migration") return read.migrated && !read.migration.withdrawn && read.migration.raw > 0n;
    if (source === "surplus") return !read.surplus.withdrawn && read.surplus.raw > 0n;
    if (source === "curve") return read.curveRaw >= BUDGET_RULE.curveClaimMinRaw;
    const last = known?.lpClaimedAt ?? null;
    return read.lp !== null && read.lp.pairRaw >= BUDGET_RULE.lpClaimMinRaw && (last === null || now - last >= BUDGET_RULE.lpClaimEverySeconds);
  };
  const source = CLAIM_ORDER.find(holds);
  /* The locked position not looked up this pass: said in the pass's steps, so a node that keeps refusing is seen. */
  if (!source) return [{ token, step: read.lpUnread ? "BUDGET_LP_UNREAD" : "BUDGET_NOTHING" }];
  if (!(await solFor(deps, EXECUTOR_FLOOR_LAMPORTS, FEE_LAMPORTS))) return [{ token, step: "BUDGET_LOW_SOL" }];
  const tx = await deps.chain.buildPartnerClaim(read, source);
  const prepared = await prepareChecked(deps, token, tx, []);
  const pending = { source, signature: prepared.signature, validUntil: prepared.validUntil, sentAt: iso(deps) };
  /* Written before the send: a lost answer still leaves the claim to read, and no second is sent over it. */
  await updateBudgetRecord(deps.store, where, (row) => ({ ...row, pairMint: record.pairMint, pending }));
  const sent = await deps.chain.send(tx, prepared.validUntil);
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await updateBudgetRecord(deps.store, where, (row) => ({ ...row, pending: row.pending?.signature === pending.signature ? null : row.pending }));
    return [{ token, step: `BUDGET_CLAIM_${sent.outcome}`, signature: sent.signature }];
  }
  return [await settleClaim(deps, record, pending)];
}

/**
 * A claim read from its transaction: counted once into the ledger — the budget's part and Ryntra's revenue apart — with
 * its receipt in the flight log; let go when it never landed; left in flight while not known.
 */
async function settleClaim(deps: AutopilotDeps, record: LaunchRecord, pending: NonNullable<MarketBudgetRecord["pending"]>): Promise<AutopilotStep> {
  const token = record.token;
  const where = { cluster: deps.network.cluster, token, pairMint: record.pairMint, now: deps.now() };
  const facts = await deps.chain.transaction(pending.signature);
  const drop = () => updateBudgetRecord(deps.store, where, (row) => ({ ...row, pending: row.pending?.signature === pending.signature ? null : row.pending }));
  if (!facts) {
    const outcome = await deps.chain.outcome(pending.signature, pending.validUntil);
    if (outcome === "EXPIRED" || outcome === "REJECTED" || outcome === "FAILED") {
      await drop();
      return { token, step: "BUDGET_CLAIM_LAPSED", signature: pending.signature };
    }
    return { token, step: "BUDGET_CLAIM_PENDING", signature: pending.signature };
  }
  if (facts.failed) {
    await drop();
    return { token, step: "BUDGET_CLAIM_FAILED", signature: pending.signature };
  }
  const pairIn = facts.delta(record.pairMint);
  const tokensIn = facts.delta(token);
  const pair = pairIn > 0n ? pairIn : 0n;
  const tokens = tokensIn > 0n ? tokensIn : 0n;
  const split = splitClaim(pending.source, pair);
  const tokenSplit = splitClaim(pending.source, tokens);
  const claim = {
    source: pending.source,
    signature: pending.signature,
    at: facts.at,
    pairRaw: pair.toString(),
    tokensRaw: tokens.toString(),
    budgetRaw: split.budgetRaw.toString(),
    revenueRaw: split.revenueRaw.toString(),
    budgetTokensRaw: tokenSplit.budgetRaw.toString(),
  };
  /* The receipt first, under the transaction's own key: written twice it stays one. */
  if (pair > 0n || tokens > 0n) {
    await writeReceipt(deps, { ...receiptOf(deps, { kind: "FEE_CLAIMED", token, signature: pending.signature, facts, actor: "ryntra", pairRaw: pair.toString() }), source: pending.source, budgetRaw: split.budgetRaw.toString() });
  }
  const at = seconds(facts.at) ?? unix(deps);
  const updated = await updateBudgetRecord(deps.store, where, (row) => ({
    ...row,
    claims: row.claims.some((entry) => entry.signature === claim.signature) ? row.claims : [...row.claims, claim],
    pending: row.pending?.signature === pending.signature ? null : row.pending,
    lpClaimedAt: pending.source === "lp" ? at : row.lpClaimedAt,
  }));
  /* The market's budget is funded with its first claim that brought it anything: the state's mark names how much. */
  const earned = budgetTotals(updated.claims).earnedRaw;
  if (earned > 0n) {
    await updateExecutorMarket(deps.store, deps.network.cluster, token, deps.now(), (market) => (market.budgetAt ? market : { ...market, budgetAt: facts.at ?? iso(deps), budgetRaw: earned.toString() }));
  }
  return { token, step: "BUDGET_CLAIMED", signature: pending.signature };
}

type BudgetGate = Readonly<{
  act: boolean;
  data: BudgetDataProblem | null;
  risks: readonly BudgetRisk[];
  record: MarketBudgetRecord | null;
  figures: BudgetFigures;
}>;

/**
 * The risk limits of a market's budget, read for this pass: the price checked on a second node, the reads without
 * a gap, the fall within the hour, a sale from the creator's wallet in the first week, the executor's SOL. What it read
 * is kept for the next pass; a limit that holds is kept with the moment it began.
 */
async function budgetGate(deps: AutopilotDeps, record: LaunchRecord, dammPool: string, price: number, now: number, wallet?: PassWallet): Promise<BudgetGate> {
  const token = record.token;
  const where = { cluster: deps.network.cluster, token, pairMint: record.pairMint, now: deps.now() };
  /* A second node's failure to answer is a price not checked — said apart from no second node at all. */
  const [second, lamports, known] = await Promise.all([
    /* The second node's price as the pass read it in bulk (a pool it missed — not checked), else read now. */
    wallet?.seconds ? Promise.resolve(wallet.seconds.get(dammPool) ?? Number.NaN) : deps.chain.priceSecond(dammPool, token).catch(() => Number.NaN),
    wallet?.lamports ? wallet.lamports.then((held) => held ?? deps.chain.lamports()) : deps.chain.lamports(),
    budgetFiguresOf(deps.store, deps.network.cluster, token),
  ]);
  const launchedAt = seconds(record.launchedAt) ?? now;
  const before = known.record;
  const read = budgetRisk({ price, second, seen: before?.seen ?? [], now, launchedAt, creatorSoldAt: before?.creatorSoldAt ?? null, lamports });
  const checked = read.data === null || read.data === "STALE";
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((entry, index) => entry === b[index]);
  const updated = await updateBudgetRecord(deps.store, where, (row) => ({
    ...row,
    pairMint: record.pairMint,
    /* A price not checked against the second node is not kept: the next pass decides on reads it can trust. */
    seen: checked ? addPriceSeen(row.seen, now, price) : row.seen,
    risks: checked ? [...read.risks] : row.risks,
    riskAt: !checked ? row.riskAt : read.risks.length === 0 ? null : same(row.risks, read.risks) && row.riskAt !== null ? row.riskAt : now,
  }));
  return { act: read.act, data: read.data, risks: read.risks, record: updated, figures: known.figures };
}

/**
 * The creator of a budget market, watched from the executor's first pass for the market's first week: the most their
 * wallet held of the token, and a fall below it — a sale, or a move out — is kept for good: no new money goes into the
 * steps after it. (Micro's first purchase sits in the creator's lock, not the wallet.)
 */
async function watchCreator(deps: AutopilotDeps, record: LaunchRecord): Promise<void> {
  const now = unix(deps);
  const launchedAt = seconds(record.launchedAt) ?? now;
  if (now - launchedAt > BUDGET_RULE.creatorSaleWindowSeconds) return;
  const held = await deps.chain.heldBy(record.creator, record.token);
  if (held === null) return;
  /* A pass that sees nothing new writes nothing. */
  const known = await readBudgetRecord(deps.store, deps.network.cluster, record.token);
  const knownHigh = known?.creatorHighRaw ? BigInt(known.creatorHighRaw) : null;
  if (knownHigh !== null && held <= knownHigh && (known!.creatorSoldAt !== null || held + TOKEN_DUST_RAW >= knownHigh)) return;
  await updateBudgetRecord(deps.store, { cluster: deps.network.cluster, token: record.token, pairMint: record.pairMint, now: deps.now() }, (row) => {
    const high = row.creatorHighRaw ? BigInt(row.creatorHighRaw) : null;
    if (high === null || held > high) return { ...row, creatorHighRaw: held.toString(), creatorWatchFrom: row.creatorWatchFrom ?? (high === null ? now : null) };
    if (row.creatorSoldAt === null && held + TOKEN_DUST_RAW < high) return { ...row, creatorSoldAt: now };
    return row;
  });
}

type WalletShares = Readonly<{ held: bigint; reserves: ReadonlyMap<string, bigint>; reservesTotal: bigint; owedTotal: bigint; revenueLeft: bigint; owedUnread: boolean }>;

/**
 * The executor's wallet in one pair currency, divided: each budget market's reserve, the money owed back to steps being
 * moved on every market, and Ryntra's revenue still on it — counted with the revenue the claims brought since the last
 * pass's count; the rest is the operator's.
 */
async function walletShares(deps: AutopilotDeps, pairMint: string): Promise<WalletShares> {
  const cluster = deps.network.cluster;
  /* Every market's ledger, ladder and receipts in one reading each — not three readings per market (SOL-L6). */
  const [budgets, floors, receipts] = await Promise.all([
    readBudgetRecords(deps.store, cluster),
    deps.store.versioned<FloorRecord>(FLOORS).valuesWithPrefix(`solana:${cluster}:`),
    deps.store.collection<AutopilotReceipt>(RECEIPTS).valuesWithPrefix(`solana:${cluster}:`),
  ]);
  const rows = budgets.filter((row) => row.pairMint === pairMint);
  const placedOf = new Map(floors.map((row) => [row.token, BigInt(row.placedRaw ?? "0")]));
  const costsOf = new Map<string, bigint>();
  for (const row of receipts) if (row.kind === "FLOOR_POOL") costsOf.set(row.token, (costsOf.get(row.token) ?? 0n) + BigInt(row.pairRaw ?? "0"));
  const reserves = new Map<string, bigint>();
  for (const row of rows) reserves.set(row.token, budgetFigures({ record: row, placedRaw: placedOf.get(row.token) ?? 0n, costsRaw: costsOf.get(row.token) ?? 0n }).reserveRaw);
  const reservesTotal = [...reserves.values()].reduce((total, value) => total + value, 0n);
  let owedTotal = 0n;
  let owedUnread = false;
  for (const stored of floors) {
    if (!stored.redeposit) continue;
    /* Steps emptied by a move whose answer is not read: how much is owed back is not known — nothing is free meanwhile. */
    if (stored.redeposit.raw === null) owedUnread = true;
    else owedTotal += BigInt(stored.redeposit.raw);
  }
  const held = await deps.chain.held(pairMint);
  const claimed = rows.reduce((total, row) => total + budgetTotals(row.claims).revenueRaw, 0n);
  const before = await readRevenue(deps.store, cluster);
  const revenueLeft = revenueLeftRaw({
    prevLeftRaw: BigInt(before?.onWalletRaw ?? "0"),
    prevClaimedRaw: BigInt(before?.claimedRaw ?? "0"),
    claimedRaw: claimed,
    walletPairRaw: held,
    reservesRaw: reservesTotal,
    owedRaw: owedTotal,
  });
  return { held, reserves, reservesTotal, owedTotal, revenueLeft, owedUnread };
}

/**
 * The wallet divided, for a ladder: read afresh, or — for a pass's budget ladders — once for the pass. One reading is
 * enough for those: each takes only its own budget's reserve, and what one of them spends leaves its own reserve with the
 * money, so the rest of the wallet stays the others'.
 */
function sharesOf(deps: AutopilotDeps, pairMint: string, wallet?: PassWallet): Promise<WalletShares> {
  if (!wallet) return walletShares(deps, pairMint);
  const known = wallet.shares.get(pairMint);
  if (known) return known;
  const read = walletShares(deps, pairMint);
  wallet.shares.set(pairMint, read);
  /* A reading that failed is not kept: the next ladder reads again. */
  read.catch(() => wallet.shares.delete(pairMint));
  return read;
}

/** What the budget's steps hold, kept for the market's state: exhausted when they hold none of the pair currency and the reserve is below a step. */
async function noteSteps(deps: AutopilotDeps, record: LaunchRecord, figures: BudgetFigures, stepsPairRaw: bigint): Promise<void> {
  const exhausted = budgetExhausted({ placedRaw: figures.placedRaw, stepsPairRaw, reserveRaw: figures.reserveRaw });
  await updateBudgetRecord(deps.store, { cluster: deps.network.cluster, token: record.token, pairMint: record.pairMint, now: deps.now() }, (row) => ({
    ...row,
    stepsPairRaw: stepsPairRaw.toString(),
    exhaustedAt: exhausted ? (row.exhaustedAt ?? iso(deps)) : null,
  }));
}

/**
 * Ryntra's revenue still on the executor's wallet — what the claims brought Ryntra, bounded by the wallet beyond the
 * markets' reserves and the money owed back to steps being moved. Above 100 USDC the operator is told, and again only
 * when it has grown by another 100 USDC since; once it stands below 100 again, the next crossing is told anew.
 */
async function noteRevenue(deps: AutopilotDeps): Promise<AutopilotStep[]> {
  const cluster = deps.network.cluster;
  const rows = await readBudgetRecords(deps.store, cluster);
  const claimed = rows.reduce((total, row) => total + budgetTotals(row.claims).revenueRaw, 0n);
  if (claimed === 0n) return [];
  const pairMint = rows.find((row) => row.claims.length)?.pairMint ?? rows[0]!.pairMint;
  const shares = await walletShares(deps, pairMint);
  const onWallet = shares.revenueLeft;
  const before = await readRevenue(deps.store, cluster);
  const below = onWallet <= BUDGET_RULE.revenueAlertRaw;
  const lastAlert = !below && before?.alertedRaw ? BigInt(before.alertedRaw) : null;
  /* A word that did not reach the operator is tried again an hour later, not every minute. */
  const triedLately = before?.attemptAt ? deps.now().getTime() - Date.parse(before.attemptAt) < 3_600_000 : false;
  const due = revenueAlertDue({ onWalletRaw: onWallet, lastAlertRaw: lastAlert }) && !triedLately;
  let delivered: boolean | null = below ? null : (before?.delivered ?? null);
  let alertedRaw = below ? null : (before?.alertedRaw ?? null);
  let alertedAt = below ? null : (before?.alertedAt ?? null);
  let attemptAt = below ? null : (before?.attemptAt ?? null);
  if (due) {
    const usdc = (value: bigint) => (Number(value) / 1_000_000).toFixed(2);
    const text = `Ryntra: дохід Ryntra на гаманці виконавця — ${usdc(onWallet)} USDC (понад ${usdc(BUDGET_RULE.revenueAlertRaw)}). Перекажи його на мультисиг своїм підписом. Бюджети ринків (${usdc(shares.reservesTotal)} USDC) лишаються на гаманці — це не надлишок.`;
    delivered = deps.alert ? await deps.alert(text).catch(() => false) : false;
    /* Only a word that reached the operator moves the mark; the next is due 100 USDC later. */
    if (delivered) {
      alertedRaw = onWallet.toString();
      alertedAt = iso(deps);
      attemptAt = null;
    } else attemptAt = iso(deps);
  }
  await writeRevenue(deps.store, { cluster, executor: deps.chain.executor, pairMint, claimedRaw: claimed.toString(), onWalletRaw: onWallet.toString(), reservesRaw: shares.reservesTotal.toString(), alertedRaw, alertedAt, delivered, attemptAt, at: iso(deps) });
  return due ? [{ token: "*", step: delivered ? "REVENUE_ALERTED" : "REVENUE_ALERT_UNDELIVERED" }] : [];
}

/* ------------------------------------------------------------------ receipts */

function receiptOf(
  deps: AutopilotDeps,
  args: Readonly<{
    kind: AutopilotKind;
    token: string;
    signature: string;
    facts: TxFacts;
    actor: JournalActor;
    pairRaw?: string | null;
    pairMint?: string;
    pool?: string | null;
    position?: string | null;
    ladder?: Readonly<{ lowerBinId: number; upperBinId: number; priceLow: number; priceHigh: number }> | null;
  }>,
): AutopilotReceipt {
  const pairDelta = args.pairMint ? args.facts.delta(args.pairMint) : null;
  const tokenDelta = args.facts.delta(args.token);
  return {
    cluster: deps.network.cluster,
    token: args.token,
    kind: args.kind,
    signature: args.signature,
    at: args.facts.at,
    slot: args.facts.slot,
    actor: args.actor,
    pairRaw: args.pairRaw !== undefined ? args.pairRaw : pairDelta === null ? null : (pairDelta < 0n ? -pairDelta : pairDelta).toString(),
    tokensRaw: tokenDelta === 0n ? null : (tokenDelta < 0n ? -tokenDelta : tokenDelta).toString(),
    pool: args.pool ?? null,
    position: args.position ?? null,
    lowerBinId: args.ladder?.lowerBinId ?? null,
    upperBinId: args.ladder?.upperBinId ?? null,
    priceLow: args.ladder?.priceLow ?? null,
    priceHigh: args.ladder?.priceHigh ?? null,
    lamports: args.actor === "ryntra" && args.facts.lamportsSpent !== null ? args.facts.lamportsSpent.toString() : null,
  };
}

async function writeReceipt(deps: AutopilotDeps, receipt: AutopilotReceipt): Promise<void> {
  await deps.store.collection<AutopilotReceipt>(RECEIPTS).set(receiptKey(deps.network.cluster, receipt.token, receipt.signature), receipt);
}

/** Every receipt of a token's acts, the oldest first. */
export async function autopilotReceipts(store: GuardStore, cluster: string, token: string): Promise<readonly AutopilotReceipt[]> {
  const rows = await store.collection<AutopilotReceipt>(RECEIPTS).valuesWithPrefix(receiptKey(cluster, token));
  return [...rows].filter((row) => row.token === token).sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0));
}

/** The ladder's record on a token, as the executor last wrote it. */
export async function floorRecord(store: GuardStore, cluster: string, token: string): Promise<FloorRecord | null> {
  return (await store.versioned<FloorRecord>(FLOORS).get(floorKey(cluster, token))) ?? null;
}

async function pairOf(deps: AutopilotDeps, token: string): Promise<string> {
  const record = await deps.store.collection<LaunchRecord>("launches").get(`solana:${deps.network.cluster}:${token}`);
  if (!record) throw new Error(`No launch ${token}.`);
  return record.pairMint;
}

/** The token's and the pair currency's decimals. */
async function decimalsOf(deps: AutopilotDeps, token: string): Promise<Readonly<{ token: number; pair: number }>> {
  return { token: await deps.chain.decimals(token), pair: await deps.chain.decimals(await pairOf(deps, token)) };
}
