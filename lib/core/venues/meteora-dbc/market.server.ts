/**
 * A Ryntra launch's market read from the chain — the curve or the pool it
 * graduated into, every trade from the programs' own swap events, and the
 * holders' balances now.
 *
 * - **State**: the DBC curve's account (its price as a Q64.64 square root, its
 *   reserves, whether it graduated) and, after graduation, the DAMM v2 pool's,
 *   whose address follows from the config's migration option and the two mints.
 * - **Trades**: the signatures that touched the curve and the pool, newest
 *   first, up to a bound; each transaction once, its `EvtSwap2` events decoded
 *   with each program's own coder. A confirmed transaction never changes, so a
 *   decoded one is kept for the life of the process.
 * - **Holders**: the exact token accounts the trades moved tokens through, the
 *   associated accounts of every wallet that traded and of the creator, the
 *   curve's and the pool's vaults and the creator's lock, read in one batch; and
 *   the largest accounts, where the node answers them — a wallet that received
 *   the token without trading it is found that way.
 *
 * The signature lists come from Helius's Parsed Events Scan where the history node is Helius on mainnet (CITY-245):
 * one request filtered to the token's transactions, newest first, back to the account's start. Elsewhere, or when the
 * scan fails, they are paged from the node as before. Either way the transactions are read and decoded here.
 *
 * One read of a history has a time budget, the node's own waits on a refusal
 * included: what a public node refused is asked again one at a time while it
 * lasts, and what is still unread then leaves the history called partial rather
 * than the page waiting past its time.
 *
 * Nothing here signs or sends. Server-only: it reads through the connection
 * it is given.
 */

import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  SwapMode,
  deriveDammV2PoolAddress,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { getBase58Encoder } from "@solana/kit";
import BN from "bn.js";

import { cpAmmOf, dbcClientOf } from "../meteora-clients.server.ts";
import { SNIPER_SECONDS, accountPageReached, listsWhole, partnerPartRaw, priceFromSqrtX64, tradeOf, type LaunchTrade, type SwapSeen } from "./market.ts";
import { getTransactionAnyVersion } from "../../../solana/v1-tx.ts";
import type { AddressHistory } from "../../history/address-history.ts";

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** Anchor's tag on a self-invoked event instruction. */
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
/** Where a swap instruction names its token accounts and its payer: DBC `swap`/`swap2` and DAMM v2 `swap`/`swap2`. */
const SWAP_ACCOUNTS = {
  [DBC_PROGRAM]: { input: 3, output: 4, payer: 9 },
  [DAMM_V2_PROGRAM]: { input: 2, output: 3, payer: 8 },
} as const;

/** A signature as an account's list gives it — the node's page or the scan's (CITY-245). */
type Listed = Readonly<{ signature: string; slot: number; err: unknown; memo: string | null; blockTime?: number | null }>;

/** How many of the newest signatures of each of the curve and the pool are read; beyond it the history is said to be partial. */
export const TRADE_HISTORY_LIMIT = 300;
/**
 * How long one read of a token's history may take, and of its opening minutes when they are read apart: the node's own
 * waits on a refusal included, so a read ends inside the route's minute with what it has, called partial.
 */
const HISTORY_BUDGET_MS = 25_000;
const OPENING_BUDGET_MS = 12_000;
const RETRY_PAUSE_MS = 400;
/** How many of an account's newest signatures are read for a wallet's own trades. */
const ACCOUNT_SIGNATURES = 200;
const ACCOUNT_BUDGET_MS = 10_000;
/** A window of a market's history read for its survival (SOL-L3): pages of a thousand signatures back to it, decoded in batches. */
const WINDOW_PAGES = 20;
const WINDOW_DECODE_BATCH = 40;
const WINDOW_BUDGET_MS = 15_000;

export type CurveState = Readonly<{
  pool: string;
  config: string;
  creator: string;
  pairMint: string;
  baseVault: string;
  sqrtPrice: string;
  quoteReserveRaw: string;
  thresholdRaw: string;
  progressBps: number;
  migrated: boolean;
  /** The second the curve opened — the config activates by time. */
  activatedAt: number | null;
  /** When the curve was filled for the DEX (`finish_curve_timestamp`, unix seconds); null while it is not. */
  finishedAt: number | null;
  creatorTradingFeePct: number;
  /**
   * The curve's `migration_progress`: 0 on the curve; 1 filled, waiting for its locker; 2 filled and ready to migrate —
   * the swap that fills a curve with no locked vesting (every Ryntra preset) marks it 2 at once —; 3 its pool made.
   */
  migrationProgress: number;
  /** The config's square-root prices, Q64.64: where the curve opens and where it graduates, and its segments — the liquidity each holds up to its price. */
  sqrtStartPrice: string;
  migrationSqrtPrice: string;
  points: readonly Readonly<{ sqrtPrice: string; liquidity: string }>[];
}>;

export type GraduatedState = Readonly<{
  pool: string;
  tokenIsA: boolean;
  tokenVault: string;
  pairVault: string;
  sqrtPrice: string;
  tokenReserveRaw: string;
  pairReserveRaw: string;
  /** `collect_fee_mode` 2: the pool compounds and prices by its two reserves; otherwise by its liquidity inside its range. */
  compounding: boolean;
  /** `collect_fee_mode`: 0 both tokens, 1 only B, 2 compounding (only B). */
  collectFeeMode: number;
  liquidity: string;
  sqrtMinPrice: string;
  sqrtMaxPrice: string;
}>;

export type MarketState = Readonly<{
  curve: CurveState;
  graduated: GraduatedState | null;
  supplyRaw: string;
  tokenDecimals: number;
  pairDecimals: number;
  /** The token program the pair currency lives under — where a wallet's account of it is. */
  pairProgram: string;
  /** The price now in the pair currency per token: the pool's after graduation, else the curve's. */
  price: number;
  /** The curve's opening price, from its config. */
  openingPrice: number;
  /** The accounts as read, for a quote on this same read: the curve's account and its config. Never sent anywhere. */
  accounts: Readonly<{ curve: unknown; config: PoolConfig; /** The graduated pool's account as the read saw it, when it has one. */ pool?: unknown }>;
}>;

export type TradeHistory = Readonly<{
  trades: readonly LaunchTrade[];
  /** Every signature of the curve and the pool was read: no trade is missing. */
  complete: boolean;
  /** The creation's block and time, when its transaction was read. */
  created: Readonly<{ slot: number; at: number | null }> | null;
  /** The graduated pool's first transaction — its creation — when the pool's whole history was read. */
  graduated: Readonly<{ at: number; signature: string }> | null;
  /** From when every signature was listed: null — from the start; else the oldest listed of a list cut at its limit. */
  coveredFrom: number | null;
  /** When the transactions listed but not read landed (unix seconds; one with no time counts as now). */
  gaps: readonly number[];
  /**
   * The slots of the graduated pool's transactions that added or took out liquidity, among those read; null when one of
   * its transactions was decoded without looking for it. Empty before graduation.
   */
  liquidityChangeSlots: readonly number[] | null;
}>;

export type HolderBalance = Readonly<{ owner: string; account: string; amountRaw: string }>;

export type HolderRead = Readonly<{
  balances: readonly HolderBalance[];
  /** Holders with a balance counted across the whole mint — null when the node could not count them. */
  totalHolders: number | null;
  /** Every account of the mint with a balance, its owner and amount — from the same scan as the count; null with it. */
  accounts: readonly HolderBalance[] | null;
  /** The node answered the mint's largest accounts, and `balances` hold them: the ten largest are among them. */
  largestRead: boolean;
}>;

/**
 * One transaction as decoded. `marks` (SOL-L2): it was read for the creator's and the LP's part of each swap and for a
 * change of the graduated pool's liquidity; a decode without them is read again from the node when a history needs them.
 */
export type Decoded = Readonly<{ slot: number; blockTime: number | null; failed: boolean; trades: readonly LaunchTrade[]; marks?: Readonly<{ v: 1; liquidityChanged: boolean }> }>;

/**
 * Where decoded transactions outlive a process: a confirmed transaction's trades never change, so once any instance has
 * read one from the node, every other instance reads it from here. One reader's index is for one fee wallet — what a
 * trade cost depends on it — and `load` gives every transaction of the token already decoded, by signature.
 */
export type DecodedIndex = Readonly<{
  load(token: string): Promise<ReadonlyMap<string, Decoded>>;
  save(token: string, signature: string, decoded: Decoded): Promise<void>;
}>;

/** How far back a decode's `marks` matter: the longest window (a week) and a day of margin. */
const MARKS_WINDOW_SECONDS = 8 * 24 * 60 * 60;
/* A decode a node would not give again now: asked again after this pause, not on every read. */
const REFETCH_REFUSED = new Map<string, number>();
const REFETCH_PAUSE_MS = 5 * 60 * 1000;

/* A confirmed transaction never changes: decoded once a process. Bounded, oldest out first. */
const DECODED = new Map<string, Decoded>();
const DECODED_MAX = 20_000;
/* When this process last read a token's decoded transactions from the shared index. */
const WARMED = new Map<string, number>();
const WARM_EVERY_MS = 60_000;
/* A token's opening minutes, once over and read whole. */
const OPENINGS = new Map<string, Readonly<{ trades: readonly LaunchTrade[]; complete: boolean }>>();
/** How far back the opening minutes are looked for: pages of a thousand signatures, and how many of their transactions are read. */
const OPENING_PAGES = 10;
const OPENING_TRADES = 500;
/* A config never changes either. */
const CONFIGS = new Map<string, Promise<PoolConfig>>();
/* A launch's supply and decimals, and its pair's decimals. */
const MINTS = new Map<string, Readonly<{ at: number; value: Readonly<{ supplyRaw: bigint; tokenDecimals: number; pairDecimals: number; pairProgram: string }> }>>();
const MINT_CACHE_MS = 10 * 60 * 1000;
/* A curve's state in flight or read less than a second ago, for reads that may share it (SOL-P1, `state({ shared })`). */
const STATES = new Map<string, { at: number; token: string; settled: number | null; value: Promise<MarketState> }>();
const STATE_SHARE_MS = 1_000;
/** A read of a curve still under way after this long is not joined again: a node that hangs leaves no quote stuck. */
const STATE_STUCK_MS = 15_000;
/* A graduated curve's pool, by the curve's address: it never changes once the curve has moved there. */
const GRADUATED_POOLS = new Map<string, string>();
const STATES_MAX = 500;
/* A scan of a mint's accounts in flight or just answered: `scanHolders` starts it, `holders` takes the same one. */
const SCANS = new Map<string, Readonly<{ at: number; value: Promise<HolderBalance[] | null> }>>();
const SCAN_KEEP_MS = 5_000;
const SCANS_MAX = 500;

function remember(key: string, value: Decoded) {
  if (DECODED.size >= DECODED_MAX) DECODED.delete(DECODED.keys().next().value as string);
  DECODED.set(key, value);
}

const bytesOf = (base58: string) => Buffer.from(getBase58Encoder().encode(base58));
const toNumber = (value: { toString(): string } | number | null | undefined) => (value === null || value === undefined ? 0 : Number(value.toString()));
const big = (value: { toString(): string } | number | null | undefined) => BigInt(value === null || value === undefined ? 0 : value.toString());

/** A token account's owner and amount, from its bytes (the same layout under both token programs). */
function tokenAccountOf(data: Buffer): Readonly<{ mint: string; owner: string; amount: bigint }> | null {
  if (data.length < 72) return null;
  return { mint: new PublicKey(data.subarray(0, 32)).toBase58(), owner: new PublicKey(data.subarray(32, 64)).toBase58(), amount: data.readBigUInt64LE(64) };
}

/** A trade sent changes the market: its curve and its holders are read again, not taken from the shared reads (SOL-P1). */
export function forgetSharedReads(token: string): void {
  for (const [key, entry] of STATES) if (entry.token === token) STATES.delete(key);
  for (const key of [...SCANS.keys()]) if (key.endsWith(`:${token}`)) SCANS.delete(key);
}

export type LaunchMarketReader = Readonly<{
  /**
   * `shared` (SOL-P1): a read of the same curve in flight, or ended less than `STATE_SHARE_MS` ago, is taken rather than
   * read again — a crowd's quotes and market reads ask the node once a second, not once a person. A build asks fresh.
   */
  state(args: Readonly<{ token: string; pool: string; shared?: boolean }>): Promise<MarketState>;
  /** `budgetMs`: how long the read may take, the node's waits included; what is unread then leaves the history partial. */
  trades(args: Readonly<{ token: string; state: MarketState; creationSignature: string; limit?: number; budgetMs?: number }>): Promise<TradeHistory>;
  /** `accounts`: the token accounts the trades moved tokens through, with their owners — a holder in an account of any kind is found. */
  holders(args: Readonly<{ token: string; state: MarketState; wallets: readonly string[]; accounts?: readonly Readonly<{ owner: string; account: string }>[]; escrow: string | null }>): Promise<HolderRead>;
  /**
   * The trades of the token's opening minutes — the snipers' and the bundle's — read back to its creation when the
   * newest page of history did not reach it. `complete`: the creation was reached and every transaction of the window
   * read; otherwise those labels are not known, and the page says so.
   */
  opening(args: Readonly<{ token: string; state: MarketState; creationSignature: string; createdAt: number | null; budgetMs?: number }>): Promise<Readonly<{ trades: readonly LaunchTrade[]; complete: boolean }>>;
  /**
   * The trades of this token among the transactions that touched `accounts` since `since` (unix seconds) — a wallet's
   * own token accounts, so its trades are read whole however long the token's history is. `complete`: every such
   * transaction was read inside the budget.
   */
  accountTrades(args: Readonly<{ token: string; state: MarketState; accounts: readonly string[]; since: number | null; creationSignature?: string | null; budgetMs?: number }>): Promise<Readonly<{ trades: readonly LaunchTrade[]; complete: boolean }>>;
  /**
   * The trades of one window of time, `[from, to)` in unix seconds, on the curve and the graduated pool (SOL-L3: a
   * market's survival at day N), each account's signatures paged back past `from`. `found`: a trade the caller looks for
   * — once one is decoded the read stops. `complete`: every transaction of the window was listed and decoded.
   */
  windowTrades(args: Readonly<{ token: string; state: MarketState; from: number; to: number; found?: (trade: LaunchTrade) => boolean; budgetMs?: number }>): Promise<Readonly<{ trades: readonly LaunchTrade[]; complete: boolean }>>;
  /** The trades one transaction made on this token, from its swap events; null when the node has no record of it yet. */
  /** `fresh`: a decode this process kept from before Ryntra's part of a trade was counted is read from the node again. */
  transaction(args: Readonly<{ token: string; state: MarketState; signature: string; fresh?: boolean }>): Promise<readonly LaunchTrade[] | null>;
  /**
   * Starts the scan of every account of the mint ahead of `holders`, which then waits for the same scan rather than a
   * second one: it hangs on nothing of the history, so a read asks it beside the history (SOL-P1).
   */
  scanHolders(token: string): void;
  /** The DBC curves a wallet created, anywhere — null when the node does not answer the scan. */
  curvesBy(creator: string): Promise<number | null>;
  /** The curve's fee for a trade now, basis points — the falling fee for snipers included. */
  feeNowBps(state: MarketState, side: "buy" | "sell"): Promise<number | null>;
}>;

/*
 * The reads a page can do without — the largest accounts, the count of every holder, the creator's curves anywhere —
 * go through a connection that does not retry a refusal, so a public node's 429 costs nothing but the figure; and a
 * node that refused is not asked again for a while.
 */
const REFUSED = new Map<string, number>();
/*
 * A minute, not five: a public node's refusal is mostly a moment's burst limit, and a five-minute silence made a
 * market's holders and concentration read «not read» on every read in it (18.10: now figures, now null).
 */
const REFUSAL_PAUSE_MS = 60 * 1000;
/** The most refusals kept — a key per node and mint; the paused ones past their minute go first. */
const REFUSED_MAX = 2_000;
/** How long one of them may take; a node that has not answered by then is a node that refused. */
const OPTIONAL_READ_MS = 8_000;

async function optional<T>(endpoint: string, kind: string, read: () => Promise<T>): Promise<T | null> {
  const key = `${endpoint}:${kind}`;
  const at = REFUSED.get(key);
  if (at !== undefined && Date.now() - at < REFUSAL_PAUSE_MS) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The node did not answer in time.")), OPTIONAL_READ_MS);
      }),
    ]);
  } catch {
    const now = Date.now();
    REFUSED.delete(key);
    REFUSED.set(key, now);
    if (REFUSED.size > REFUSED_MAX) for (const [old, at] of REFUSED) if (now - at >= REFUSAL_PAUSE_MS || REFUSED.size > REFUSED_MAX) REFUSED.delete(old);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * The endpoints beside the main one — indexed reads, whole signature lists, older transactions — one connection each
 * per process, and none of them waits out a refusal: a 429 is answered at once (the read falls back or is left
 * unread), so a page never sleeps through a public node's backoff past its budget.
 */
const SIDE_CONNECTIONS = new Map<string, Connection>();
function sideConnection(url: string): Connection {
  const known = SIDE_CONNECTIONS.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  SIDE_CONNECTIONS.set(url, known);
  return known;
}

/**
 * `feeWallet`: Ryntra's fee wallet on this network — what a transaction moved into it in the pair currency is Ryntra's
 * own fee on the trade in it, and is counted in what the trade cost. `indexed`: the endpoint for the reads a node answers
 * from its indexes — the largest accounts, every holder of the mint, a creator's curves — where it is not the main one
 * (a public node may refuse them). `index`: decoded transactions shared beyond this process. `history`: the endpoint whose
 * signature lists reach back to a token's creation — a public node keeps a day or two of them, and a list cut short by the
 * node reads as whole to anyone who trusts its length. `archive`: the endpoint asked for a transaction the main one no
 * longer keeps. `referralOwner`: the address Ryntra's referral token accounts belong to — what a transaction moved into its
 * account in the pair currency is Meteora's referral paid to Ryntra, and is Ryntra's part of the trade's fee. `scan`:
 * the history node's Parsed Events Scan (CITY-245) — where given, an account's signatures are found through it first.
 */
export function createLaunchMarketReader(
  connection: Connection,
  options: Readonly<{ feeWallet?: string | null; referralOwner?: string | null; indexed?: string | null; index?: DecodedIndex | null; history?: string | null; archive?: string | null; scan?: AddressHistory | null }> = {},
): LaunchMarketReader {
  const lenient = sideConnection(options.indexed ?? connection.rpcEndpoint);
  /*
   * The holders' reads — every account of the mint, its largest accounts — are asked of the indexed node and then of the
   * node whose lists reach back, each in turn until one answers: one node's refusal is no longer the figure's.
   */
  const lenients = [lenient, ...(options.history ? [sideConnection(options.history)] : [])].filter((node, index, all) => all.findIndex((other) => other.rpcEndpoint === node.rpcEndpoint) === index);
  async function fromAny<T>(kind: string, read: (node: Connection) => Promise<T>): Promise<T | null> {
    for (const node of lenients) {
      /* A scan of one mint that timed out says nothing of another's: its pause is the mint's (`kind` names it). */
      const answer = await optional(node.rpcEndpoint, kind, () => read(node));
      if (answer !== null) return answer;
    }
    return null;
  }
  const listing = options.history && options.history !== connection.rpcEndpoint ? sideConnection(options.history) : connection;
  const archive = options.archive && options.archive !== connection.rpcEndpoint ? sideConnection(options.archive) : null;
  const feeWallet = options.feeWallet ?? null;
  const referralOwner = options.referralOwner ?? null;
  const index = options.index ?? null;
  const scan = options.scan ?? null;
  const client = dbcClientOf(connection);
  const lenientClient = dbcClientOf(lenient);
  const cpAmm = cpAmmOf(connection);
  const dbcCoder = (client.state.program as unknown as { coder: { events: { decode(data: string): { name: string; data: Record<string, unknown> } | null } } }).coder;
  const dammCoder = (cpAmm._program as unknown as { coder: { events: { decode(data: string): { name: string; data: Record<string, unknown> } | null } } }).coder;

  function configOf(address: PublicKey): Promise<PoolConfig> {
    /* Keyed by the SDK too: an account one version decoded is never quoted by the other (SOL-L9). */
    const key = `${client.sdk}:${connection.rpcEndpoint}:${address.toBase58()}`;
    const cached = CONFIGS.get(key);
    if (cached) return cached;
    const read = client.state.getPoolConfig(address).then((config) => {
      if (!config) throw new Error(`No DBC config at ${address.toBase58()}.`);
      return config;
    });
    CONFIGS.set(key, read);
    read.catch(() => CONFIGS.delete(key));
    return read;
  }

  function state({ token, pool, shared = false }: Readonly<{ token: string; pool: string; shared?: boolean }>): Promise<MarketState> {
    if (!shared) return readState(token, pool);
    const key = `${client.sdk}:${connection.rpcEndpoint}:${pool}`;
    const hit = STATES.get(key);
    if (hit && (hit.settled === null ? Date.now() - hit.at < STATE_STUCK_MS : Date.now() - hit.settled < STATE_SHARE_MS)) return hit.value;
    STATES.delete(key);
    if (STATES.size >= STATES_MAX) STATES.delete(STATES.keys().next().value as string);
    const entry: { at: number; token: string; settled: number | null; value: Promise<MarketState> } = { at: Date.now(), token, settled: null, value: readState(token, pool) };
    STATES.set(key, entry);
    entry.value.then(
      () => {
        entry.settled = Date.now();
      },
      () => {
        if (STATES.get(key) === entry) STATES.delete(key);
      },
    );
    return entry.value;
  }

  async function readState(token: string, pool: string): Promise<MarketState> {
    const tokenKey = new PublicKey(token);
    /* A curve that graduated has one pool for ever: once known, the pool is read beside the curve, not after it (SOL-P1). */
    const knownPool = GRADUATED_POOLS.get(pool) ?? null;
    const early = knownPool ? cpAmm.fetchPoolState(new PublicKey(knownPool)).catch(() => null) : null;
    const virtual = await client.state.getPool(new PublicKey(pool));
    if (!virtual) throw new Error(`No curve at ${pool}.`);
    const curveState = (virtual as unknown as { poolState?: typeof virtual } & typeof virtual).poolState ?? virtual;
    const config = await configOf(curveState.config);
    const { supplyRaw, tokenDecimals, pairDecimals, pairProgram } = await mintsOf(tokenKey, config.quoteMint);
    const threshold = big(config.migrationQuoteThreshold);
    const reserve = big(curveState.quoteReserve);
    const migrated = curveState.isMigrated === 1;
    const curve: CurveState = {
      pool,
      config: curveState.config.toBase58(),
      creator: curveState.creator.toBase58(),
      pairMint: config.quoteMint.toBase58(),
      baseVault: curveState.baseVault.toBase58(),
      sqrtPrice: curveState.sqrtPrice.toString(),
      quoteReserveRaw: reserve.toString(),
      thresholdRaw: threshold.toString(),
      progressBps: threshold === 0n ? 0 : Math.min(10_000, Number((reserve * 10_000n) / threshold)),
      migrated,
      activatedAt: config.activationType === 1 ? toNumber(curveState.activationPoint) : null,
      finishedAt: toNumber(curveState.finishCurveTimestamp) > 0 ? toNumber(curveState.finishCurveTimestamp) : null,
      creatorTradingFeePct: config.creatorTradingFeePercentage,
      migrationProgress: toNumber(curveState.migrationProgress),
      sqrtStartPrice: config.sqrtStartPrice.toString(),
      migrationSqrtPrice: config.migrationSqrtPrice.toString(),
      /* The config writes all twenty segments; the unused ones are zero. */
      points: config.curve.filter((point) => big(point.sqrtPrice) > 0n).map((point) => ({ sqrtPrice: point.sqrtPrice.toString(), liquidity: point.liquidity.toString() })),
    };
    let graduated: GraduatedState | null = null;
    /* The graduated pool's account as this read saw it: a quote on it reads it again only where this read did not. */
    let graduatedPool: unknown = null;
    if (migrated) {
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      const dammPool = dammConfig ? deriveDammV2PoolAddress(dammConfig, tokenKey, config.quoteMint) : null;
      const poolState = dammPool ? await (early && knownPool === dammPool.toBase58() ? early : cpAmm.fetchPoolState(dammPool).catch(() => null)) : null;
      graduatedPool = poolState;
      if (dammPool && poolState) {
        if (GRADUATED_POOLS.size >= STATES_MAX) GRADUATED_POOLS.delete(GRADUATED_POOLS.keys().next().value as string);
        GRADUATED_POOLS.set(pool, dammPool.toBase58());
      }
      if (dammPool && poolState) {
        const tokenIsA = poolState.tokenAMint.equals(tokenKey);
        graduated = {
          pool: dammPool.toBase58(),
          tokenIsA,
          tokenVault: (tokenIsA ? poolState.tokenAVault : poolState.tokenBVault).toBase58(),
          pairVault: (tokenIsA ? poolState.tokenBVault : poolState.tokenAVault).toBase58(),
          sqrtPrice: poolState.sqrtPrice.toString(),
          tokenReserveRaw: (tokenIsA ? poolState.tokenAAmount : poolState.tokenBAmount).toString(),
          pairReserveRaw: (tokenIsA ? poolState.tokenBAmount : poolState.tokenAAmount).toString(),
          compounding: toNumber(poolState.collectFeeMode) === 2,
          collectFeeMode: toNumber(poolState.collectFeeMode),
          liquidity: poolState.liquidity.toString(),
          sqrtMinPrice: poolState.sqrtMinPrice.toString(),
          sqrtMaxPrice: poolState.sqrtMaxPrice.toString(),
        };
      }
    }
    const curvePrice = priceFromSqrtX64(curve.sqrtPrice, tokenDecimals, pairDecimals);
    const poolPrice = graduated ? dammPrice(graduated.sqrtPrice, graduated.tokenIsA, tokenDecimals, pairDecimals) : null;
    return {
      curve,
      graduated,
      supplyRaw: supplyRaw.toString(),
      tokenDecimals,
      pairDecimals,
      pairProgram,
      price: poolPrice ?? curvePrice,
      openingPrice: priceFromSqrtX64(config.sqrtStartPrice.toString(), tokenDecimals, pairDecimals),
      accounts: { curve: virtual, config, pool: graduatedPool },
    };
  }

  /**
   * The token's supply and decimals and the pair's decimals. A launch's mint has no authority left, so its supply is
   * fixed; a pair's decimals never change: read once a while, not on every quote.
   */
  async function mintsOf(token: PublicKey, pair: PublicKey): Promise<Readonly<{ supplyRaw: bigint; tokenDecimals: number; pairDecimals: number; pairProgram: string }>> {
    const key = `${connection.rpcEndpoint}:${token.toBase58()}:${pair.toBase58()}`;
    const hit = MINTS.get(key);
    if (hit && Date.now() - hit.at < MINT_CACHE_MS) return hit.value;
    const [mintInfo, pairInfo] = await connection.getMultipleAccountsInfo([token, pair], "confirmed");
    if (!mintInfo || !pairInfo) throw new Error("The token or its pair currency could not be read.");
    /* A mint's supply sits at byte 36 and its decimals at 44, under both token programs. */
    const value = { supplyRaw: mintInfo.data.readBigUInt64LE(36), tokenDecimals: mintInfo.data[44] ?? 6, pairDecimals: pairInfo.data[44] ?? 6, pairProgram: pairInfo.owner.toBase58() };
    MINTS.set(key, { at: Date.now(), value });
    return value;
  }

  /** One transaction's trades on this token, decoded from the programs' swap events. */
  async function decode(token: string, signature: string, market: MarketState, fresh = false): Promise<Decoded | null> {
    /* What a trade cost depends on the fee wallet read with it. */
    const key = `${token}:${signature}:${feeWallet ?? ""}`;
    const cached = DECODED.get(key);
    /*
     * A decode made before `marks` is read again only while it can still count in a window (the last week and a day):
     * an older one stays as it is, and the windows never reach it. A read again that fails keeps the older decode.
     */
    const refusedAt = REFETCH_REFUSED.get(key);
    const marksMatter =
      cached !== undefined &&
      !cached.marks &&
      cached.blockTime !== null &&
      cached.blockTime >= Math.floor(Date.now() / 1000) - MARKS_WINDOW_SECONDS &&
      (refusedAt === undefined || Date.now() - refusedAt > REFETCH_PAUSE_MS);
    if (cached && !marksMatter && (!fresh || cached.trades.every((trade) => trade.ryntraRaw !== undefined))) return cached;
    let tx = await getTransactionAnyVersion(connection, signature).catch((error) => {
      if (marksMatter) return null;
      throw error;
    });
    /* A public node keeps a day or two of transactions: an older one is asked of the archive. */
    if (!tx && archive) tx = await getTransactionAnyVersion(archive, signature).catch(() => null);
    if (!tx?.meta) {
      /* Not read again now: the older decode stands, and this process asks again only after a pause. */
      if (marksMatter) {
        /* Bounded, oldest out first, as the decodes are. */
        if (REFETCH_REFUSED.size >= DECODED_MAX) REFETCH_REFUSED.delete(REFETCH_REFUSED.keys().next().value!);
        REFETCH_REFUSED.set(key, Date.now());
      }
      return marksMatter ? cached : null;
    }
    const message = tx.transaction.message;
    const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const keyAt = (index: number) => keys.get(index)?.toBase58() ?? "";
    const seen: SwapSeen[] = [];
    let unsure = false;
    let liquidityChanged = false;
    /* Who owns each token account the transaction touched, from the chain's own record of its balances. */
    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const balances = [...pre, ...post];
    const ownerAt = (index: number | undefined) => (index === undefined ? null : (balances.find((entry) => entry.accountIndex === index)?.owner ?? null));
    const side = (index: number | undefined) => ({ account: index === undefined ? null : keyAt(index) || null, owner: ownerAt(index) });
    /* The swaps' own input and output accounts: what a trader's account gains or loses is the trade, never Ryntra's fee —
       even when the trader is one of Ryntra's own wallets. */
    const swapAccounts = new Set<number>();
    for (const group of tx.meta.innerInstructions ?? []) {
      const outer = message.compiledInstructions[group.index];
      const outerProgram = outer ? keyAt(outer.programIdIndex) : "";
      for (let position = 0; position < group.instructions.length; position += 1) {
        const ix = group.instructions[position]!;
        const program = keyAt(ix.programIdIndex);
        if (program !== DBC_PROGRAM && program !== DAMM_V2_PROGRAM) continue;
        const data = bytesOf(ix.data);
        if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
        const event = (program === DBC_PROGRAM ? dbcCoder : dammCoder).events.decode(data.subarray(8).toString("base64"));
        /* Liquidity added to or taken out of the graduated pool, or a position split: the creator's share of its fees may have changed here. */
        if ((event?.name === "evtLiquidityChange" || event?.name === "evtSplitPosition2" || event?.name === "evtSplitPosition3") && program === DAMM_V2_PROGRAM) {
          const pool = (event.data as { pool?: PublicKey }).pool?.toBase58();
          if (!market.graduated) unsure = true;
          else if (pool === market.graduated.pool) liquidityChanged = true;
          continue;
        }
        if (!event || event.name !== "evtSwap2") continue;
        const fields = event.data as Record<string, unknown> & { pool: PublicKey; tradeDirection: number; swapResult: Record<string, BN>; currentTimestamp: BN };
        /* The swap that wrote this event: the program's own instruction just before it when another program called it, else the outer one. */
        let accounts: readonly number[] | null = null;
        for (let back = position - 1; back >= 0 && accounts === null; back -= 1) {
          const prior = group.instructions[back]!;
          if (keyAt(prior.programIdIndex) === program && !bytesOf(prior.data).subarray(0, 8).equals(EVENT_IX_TAG)) accounts = prior.accounts;
        }
        if (accounts === null && outer && outerProgram === program) accounts = outer.accountKeyIndexes;
        const at = (name: "input" | "output" | "payer") => accounts?.[SWAP_ACCOUNTS[program as keyof typeof SWAP_ACCOUNTS][name]];
        for (const name of ["input", "output"] as const) {
          const index = at(name);
          if (index !== undefined) swapAccounts.add(index);
        }
        const payerIndex = at("payer");
        const payer = payerIndex !== undefined ? keyAt(payerIndex) : keyAt(0);
        const result = fields.swapResult;
        const common = { signature, slot: tx.slot, at: toNumber(fields.currentTimestamp), inRaw: big(result.includedFeeInputAmount), outRaw: big(result.outputAmount), input: side(at("input")), output: side(at("output")), payer, ryntraFeeRaw: 0n, referralToRyntraRaw: 0n };
        if (program === DBC_PROGRAM) {
          if (fields.pool.toBase58() !== market.curve.pool) continue;
          seen.push({
            ...common,
            venue: "curve",
            side: fields.tradeDirection === 1 ? "buy" : "sell",
            feesRaw: big(result.tradingFee) + big(result.protocolFee) + big(result.referralFee),
            /* Ryntra is the partner of every Ryntra launch config: its part of the trading fee is the creator's remainder. */
            partnerFeeRaw: partnerPartRaw(big(result.tradingFee), market.curve.creatorTradingFeePct),
            creatorFeeRaw: big(result.tradingFee) - partnerPartRaw(big(result.tradingFee), market.curve.creatorTradingFeePct),
            priceAfter: priceFromSqrtX64(result.nextSqrtPrice.toString(), market.tokenDecimals, market.pairDecimals),
          });
        } else {
          const graduated = market.graduated;
          /* A pool's swap read before this read knew the token graduated may be the token's own: not kept as «no trade». */
          if (!graduated) unsure = true;
          if (!graduated || fields.pool.toBase58() !== graduated.pool) continue;
          /* A to B sells A: the token is sold when it is A. */
          const sell = (fields.tradeDirection === 0) === graduated.tokenIsA;
          seen.push({
            ...common,
            venue: "pool",
            side: sell ? "sell" : "buy",
            feesRaw: big(result.claimingFee) + big(result.compoundingFee) + big(result.protocolFee) + big(result.referralFee),
            partnerFeeRaw: 0n,
            /* The LP's part is in the pair currency when the pool collects its fee in B alone and the pair is B. */
            lpFeeRaw: graduated.tokenIsA && (graduated.collectFeeMode === 1 || graduated.collectFeeMode === 2) ? big(result.claimingFee) : null,
            priceAfter: dammPrice(result.nextSqrtPrice.toString(), graduated.tokenIsA, market.tokenDecimals, market.pairDecimals),
          });
        }
      }
    }
    const heldBy = (owner: string | null, list: typeof pre) =>
      list
        .filter((entry) => owner !== null && entry.owner === owner && entry.mint === market.curve.pairMint && !swapAccounts.has(entry.accountIndex))
        .reduce((total, entry) => total + BigInt(entry.uiTokenAmount.amount), 0n);
    /* What the transaction moved into Ryntra's fee wallet in the pair currency: Ryntra's own fee on the trade in it. */
    const ryntraFee = heldBy(feeWallet, post) - heldBy(feeWallet, pre);
    /* What the transaction moved into Ryntra's referral account in the pair currency: Meteora's referral, paid to Ryntra. */
    const referralToRyntra = heldBy(referralOwner, post) - heldBy(referralOwner, pre);
    /* Ryntra's fee and its referral belong to the one trade of their transaction; a transaction of several swaps keeps
       them out rather than guess whose. */
    const trades = seen.map((entry) =>
      tradeOf(seen.length === 1 ? { ...entry, ryntraFeeRaw: ryntraFee > 0n ? ryntraFee : 0n, referralToRyntraRaw: referralToRyntra > 0n ? referralToRyntra : 0n } : entry),
    );
    const decoded: Decoded = {
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      failed: tx.meta.err !== null,
      trades: tx.meta.err === null ? trades : [],
      marks: { v: 1, liquidityChanged: tx.meta.err === null && liquidityChanged },
    };
    /* Kept only when it is whole: a decode that may have missed the token's own pool swap is answered once and read again. */
    if (unsure) return decoded;
    remember(key, decoded);
    /* Shared beyond this process; a store that does not answer costs only the next instance a read of the node. */
    if (index) await index.save(token, signature, decoded).catch(() => undefined);
    return decoded;
  }

  /**
   * What other instances already decoded of this token, into this process's memory — before any of it is read from the
   * node; once a minute at most per token, so a busy token's history is not read from the store on every request.
   */
  async function warm(token: string): Promise<void> {
    if (!index) return;
    const warmKey = `${token}:${feeWallet ?? ""}`;
    const last = WARMED.get(warmKey);
    if (last !== undefined && Date.now() - last < WARM_EVERY_MS) return;
    WARMED.set(warmKey, Date.now());
    const known = await index.load(token).catch(() => null);
    if (!known) {
      WARMED.delete(warmKey);
      return;
    }
    for (const [signature, decoded] of known) {
      const key = `${token}:${signature}:${feeWallet ?? ""}`;
      if (!DECODED.has(key)) remember(key, decoded);
    }
  }

  /** Reads `run` over `items` a few at a time: a public node answers a burst with 429. */
  async function inTurns<T, R>(items: readonly T[], run: (item: T) => Promise<R>, width = 4): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(width, items.length) }, async () => {
        for (;;) {
          const index = next++;
          if (index >= items.length) return;
          out[index] = await run(items[index] as T);
        }
      }),
    );
    return out;
  }

  /**
   * The transactions of `signatures`, decoded: a few at a time while the budget lasts, then what a node refused asked
   * again one at a time while it still lasts. What is unread when it runs out stays null — the history is then partial
   * and says so, rather than the page waiting past its time.
   */
  async function decodeAll(token: string, market: MarketState, signatures: readonly string[], until: number): Promise<(Decoded | null)[]> {
    if (signatures.some((signature) => !DECODED.has(`${token}:${signature}:${feeWallet ?? ""}`))) await warm(token);
    /* Past the budget a decode this process already holds is still given — never a gap where one is known. */
    const known = (signature: string) => DECODED.get(`${token}:${signature}:${feeWallet ?? ""}`) ?? null;
    const decoded = await inTurns(signatures, (signature) => (Date.now() < until ? decode(token, signature, market).catch(() => known(signature)) : Promise.resolve(known(signature))));
    for (let index = 0; index < decoded.length && Date.now() < until; index += 1) {
      if (decoded[index] !== null) continue;
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
      decoded[index] = await decode(token, signatures[index]!, market).catch(() => null);
    }
    return decoded;
  }

  /** An account's signatures from the endpoint with the whole history, or the main one when that does not answer. */
  async function signaturesOf(token: string, address: PublicKey, options: Readonly<{ before?: string; limit: number }>, until?: number): Promise<readonly Listed[]> {
    return (await listedFrom(token, address, options, until)).entries;
  }

  /**
   * The same, and whether the endpoint with the whole history gave it — a short list from any other proves nothing.
   * The scan first (CITY-245): the account's successful transactions in which the curve's or the pool's program ran —
   * every swap however it was routed, the creation, the migration, the pool's liquidity and its positions' splits —
   * newest first; a short list from it is the account's start, or of the window from `since` (unix seconds). It has
   * until `until` (ms) to be whole; past it the node is paged as before.
   */
  async function listedFrom(token: string, address: PublicKey, options: Readonly<{ before?: string; limit: number; since?: number | null; tokenMoved?: boolean }>, until?: number): Promise<Readonly<{ entries: readonly Listed[]; deep: boolean }>> {
    if (scan) {
      const scanned = await scan
        .signatures({
          address: address.toBase58(),
          /* A wallet's account: its trades of this token only — the same account's trades of other launches stay out. */
          match: { programs: [{ programId: DBC_PROGRAM, scope: "transaction" }, { programId: DAMM_V2_PROGRAM, scope: "transaction" }], ...(options.tokenMoved ? { mints: [{ mint: token, scope: "transaction" as const }] } : {}) },
          before: options.before,
          limit: options.limit,
          ...(typeof options.since === "number" ? { time: { gte: options.since } } : {}),
          ...(until === undefined ? {} : { until }),
        })
        .catch(() => null);
      if (scanned) return { entries: scanned.entries, deep: true };
    }
    if (listing !== connection) {
      const entries = await listing.getSignaturesForAddress(address, options, "confirmed").catch(() => null);
      if (entries) return { entries, deep: true };
    }
    return { entries: await connection.getSignaturesForAddress(address, options, "confirmed"), deep: false };
  }

  async function trades({ token, state: market, creationSignature, limit = TRADE_HISTORY_LIMIT, budgetMs = HISTORY_BUDGET_MS }: Parameters<LaunchMarketReader["trades"]>[0]): Promise<TradeHistory> {
    const until = Date.now() + budgetMs;
    /* The scan has half the budget to list; the rest is the transactions' (CITY-245). */
    const listUntil = Date.now() + budgetMs / 2;
    /* The curve's list and the pool's are two independent reads: asked at once (SOL-P1). */
    const [curveSignatures, poolSignatures] = await Promise.all([
      signaturesOf(token, new PublicKey(market.curve.pool), { limit }, listUntil),
      market.graduated ? signaturesOf(token, new PublicKey(market.graduated.pool), { limit }, listUntil) : Promise.resolve([]),
    ]);
    const all = [...new Map([...curveSignatures, ...poolSignatures].filter((entry) => entry.err === null).map((entry) => [entry.signature, entry])).values()];
    if (!all.some((entry) => entry.signature === creationSignature)) all.push({ signature: creationSignature, slot: 0, err: null, memo: null, blockTime: null });
    /* The creation first: the creator's first buy and the opening block rest on it, and it is read once a process. */
    const signatures = [creationSignature, ...all.map((entry) => entry.signature).filter((signature) => signature !== creationSignature)];
    const decoded = await decodeAll(token, market, signatures, until);
    const list: LaunchTrade[] = [];
    let created: TradeHistory["created"] = null;
    decoded.forEach((entry, index) => {
      if (!entry) return;
      list.push(...entry.trades);
      if (signatures[index] === creationSignature) created = { slot: entry.slot, at: entry.blockTime };
    });
    list.sort((a, b) => a.slot - b.slot || a.at - b.at);
    const oldestPool = poolSignatures.at(-1);
    const { curveWhole, poolWhole } = listsWhole({ curve: curveSignatures, pool: market.graduated ? poolSignatures : null, creationSignature, limit });
    /* What a figure over a window can trust: the lists reach back that far, and no transaction in it went unread. */
    const cutAt = (list: typeof curveSignatures, whole: boolean) => (whole ? null : (list.at(-1)?.blockTime ?? Number.POSITIVE_INFINITY));
    const cuts = [cutAt(curveSignatures, curveWhole), ...(market.graduated ? [cutAt(poolSignatures, poolWhole)] : [])].filter((value): value is number => value !== null);
    const times = new Map(all.map((entry) => [entry.signature, entry.blockTime ?? null]));
    /* The pool's liquidity moves: from every transaction of the pool that was read, each decoded looking for it. */
    const ofPool = new Set(poolSignatures.map((entry) => entry.signature));
    let liquidityChangeSlots: number[] | null = [];
    const marksFrom = Math.floor(Date.now() / 1000) - MARKS_WINDOW_SECONDS;
    decoded.forEach((entry, index) => {
      if (!entry || !ofPool.has(signatures[index]!) || liquidityChangeSlots === null) return;
      /* An unmarked decode older than any window cannot fall after a window's first swap: it does not hide the others. */
      if (!entry.marks && entry.blockTime !== null && entry.blockTime < marksFrom) return;
      if (!entry.marks) liquidityChangeSlots = null;
      else if (entry.marks.liquidityChanged) liquidityChangeSlots.push(entry.slot);
    });
    return {
      liquidityChangeSlots,
      coveredFrom: cuts.length ? Math.max(...cuts) : null,
      gaps: signatures.filter((_, index) => decoded[index] === null).map((signature) => times.get(signature) ?? Math.floor(Date.now() / 1000)),
      trades: list,
      complete: curveWhole && poolWhole && decoded.every((entry) => entry !== null),
      created,
      graduated: market.graduated && poolWhole && oldestPool ? { at: oldestPool.blockTime ?? 0, signature: oldestPool.signature } : null,
    };
  }

  async function accountTrades({ token, state: market, accounts, since, creationSignature = null, budgetMs = ACCOUNT_BUDGET_MS }: Parameters<LaunchMarketReader["accountTrades"]>[0]): ReturnType<LaunchMarketReader["accountTrades"]> {
    const until = Date.now() + budgetMs;
    const signatures: string[] = [];
    let complete = true;
    /* Each account's list is its own read: asked at once (SOL-P1), then taken in the accounts' order. */
    const lists = await Promise.all(accounts.map((account) => listedFrom(token, new PublicKey(account), { limit: ACCOUNT_SIGNATURES, since, tokenMoved: true }, Date.now() + budgetMs / 2).catch(() => null)));
    for (const listed of lists) {
      if (!listed) {
        complete = false;
        continue;
      }
      const batch = listed.entries;
      /*
       * Newest first: the window is whole when the page reached past the token's opening — the creation itself, or a
       * transaction older than the window — or when the account's whole history is on it: a short page, and only from
       * the endpoint with the whole history, since a node that keeps a day returns a short page too.
       */
      const reached = accountPageReached({ page: batch, whole: batch.length < ACCOUNT_SIGNATURES && listed.deep, creationSignature, since });
      if (!reached) complete = false;
      for (const entry of batch) {
        if (entry.err !== null) continue;
        if (since === null || entry.blockTime === null || entry.blockTime === undefined || entry.blockTime >= since) signatures.push(entry.signature);
      }
    }
    const unique = [...new Set(signatures)];
    const decoded = await decodeAll(token, market, unique, until);
    return { trades: decoded.flatMap((entry) => entry?.trades ?? []), complete: complete && decoded.every((entry) => entry !== null) };
  }

  async function windowTrades({ token, state: market, from, to, found = () => false, budgetMs = WINDOW_BUDGET_MS }: Parameters<LaunchMarketReader["windowTrades"]>[0]): ReturnType<LaunchMarketReader["windowTrades"]> {
    const until = Date.now() + budgetMs;
    let complete = true;
    const inWindow: string[] = [];
    for (const pool of [market.curve.pool, ...(market.graduated ? [market.graduated.pool] : [])]) {
      let before: string | undefined;
      for (let page = 0; ; page += 1) {
        if (page >= WINDOW_PAGES || Date.now() >= until) {
          complete = false;
          break;
        }
        const listed = await listedFrom(token, new PublicKey(pool), { before, limit: 1_000 }, until).catch(() => null);
        if (!listed) {
          complete = false;
          break;
        }
        const batch = listed.entries;
        for (const entry of batch) {
          if (entry.err !== null) continue;
          /* A signature with no time is decoded: its swap event carries the program's own clock. */
          if (entry.blockTime === null || entry.blockTime === undefined || (entry.blockTime >= from && entry.blockTime < to)) inWindow.push(entry.signature);
        }
        /* Newest first: a page reaching past the window's start holds all of it; a short page is the account's first — whole only from the endpoint with the whole history. */
        const oldest = batch.findLast((entry) => entry.blockTime !== null && entry.blockTime !== undefined)?.blockTime;
        if (oldest !== null && oldest !== undefined && oldest < from) break;
        if (batch.length < 1_000) {
          if (!listed.deep) complete = false;
          break;
        }
        before = batch.at(-1)?.signature;
      }
    }
    const unique = [...new Set(inWindow)];
    const trades: LaunchTrade[] = [];
    for (let index = 0; index < unique.length; index += WINDOW_DECODE_BATCH) {
      if (Date.now() >= until) {
        complete = false;
        break;
      }
      const decoded = await decodeAll(token, market, unique.slice(index, index + WINDOW_DECODE_BATCH), until);
      if (decoded.some((entry) => entry === null)) complete = false;
      const batch = decoded.flatMap((entry) => entry?.trades ?? []).filter((trade) => trade.at >= from && trade.at < to);
      trades.push(...batch);
      if (batch.some(found)) return { trades, complete: complete && index + WINDOW_DECODE_BATCH >= unique.length };
    }
    return { trades, complete };
  }

  async function opening({ token, state: market, creationSignature, createdAt, budgetMs = OPENING_BUDGET_MS }: Parameters<LaunchMarketReader["opening"]>[0]): ReturnType<LaunchMarketReader["opening"]> {
    const key = `${connection.rpcEndpoint}:${token}`;
    const known = OPENINGS.get(key);
    if (known) return known;
    const until = Date.now() + budgetMs;
    const pool = new PublicKey(market.curve.pool);
    const early: string[] = [];
    let before: string | undefined;
    let reached = false;
    for (let page = 0; page < OPENING_PAGES && !reached; page += 1) {
      const batch = await signaturesOf(token, pool, { before, limit: 1_000 }, until);
      for (const entry of batch) {
        if (entry.signature === creationSignature) reached = true;
        if (entry.err !== null) continue;
        /* Newest first: only what landed by the end of the opening minutes is kept. */
        if (createdAt === null || entry.blockTime === null || entry.blockTime === undefined || entry.blockTime <= createdAt + SNIPER_SECONDS) early.push(entry.signature);
      }
      if (batch.length < 1_000) break;
      before = batch.at(-1)?.signature;
    }
    const chosen = early.slice(-OPENING_TRADES);
    const decoded = await decodeAll(token, market, chosen, until);
    const result = { trades: decoded.flatMap((entry) => entry?.trades ?? []), complete: reached && early.length <= OPENING_TRADES && decoded.every((entry) => entry !== null) };
    /* Once the opening minutes are over and read whole, they never change. */
    if (result.complete && createdAt !== null && Date.now() / 1000 > createdAt + SNIPER_SECONDS) OPENINGS.set(key, result);
    return result;
  }

  async function holders({ token, state: market, wallets, accounts: traded = [], escrow }: Parameters<LaunchMarketReader["holders"]>[0]): Promise<HolderRead> {
    const mint = new PublicKey(token);
    const owners = [...new Set([market.curve.creator, ...wallets])];
    const accounts: { owner: string; account: string }[] = owners.map((owner) => ({ owner, account: getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID).toBase58() }));
    /* The exact accounts the trades moved tokens through: a buy into an account that is not the associated one is found too. */
    for (const entry of traded) if (!accounts.some((known) => known.account === entry.account)) accounts.push({ owner: entry.owner, account: entry.account });
    accounts.push({ owner: market.curve.baseVault, account: market.curve.baseVault });
    if (market.graduated) accounts.push({ owner: market.graduated.tokenVault, account: market.graduated.tokenVault });
    if (escrow) accounts.push({ owner: escrow, account: getAssociatedTokenAddressSync(mint, new PublicKey(escrow), true, TOKEN_2022_PROGRAM_ID).toBase58() });
    /* The largest accounts catch a holder who never traded; a node that will not answer them leaves the traders' own. */
    /* Every account of the mint first: when a node scans it, the largest accounts are among them and need no second read. */
    const all = await mintAccounts(mint);
    const answered = all
      ? [...all].sort((a, b) => (BigInt(b.amountRaw) > BigInt(a.amountRaw) ? 1 : BigInt(b.amountRaw) < BigInt(a.amountRaw) ? -1 : 0)).slice(0, 20).map((row) => row.account)
      : await fromAny(`largest:${mint.toBase58()}`, (node) => node.getTokenLargestAccounts(mint, "confirmed").then((answer) => answer.value.map((entry) => entry.address.toBase58())));
    const largest = answered ?? [];
    const known = new Set(accounts.map((entry) => entry.account));
    const extra = largest.filter((address) => !known.has(address));
    const balances: HolderBalance[] = [];
    const addresses = [...accounts.map((entry) => entry.account), ...extra];
    for (let start = 0; start < addresses.length; start += 100) {
      const chunk = addresses.slice(start, start + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk.map((address) => new PublicKey(address)), "confirmed");
      infos.forEach((info, index) => {
        const address = chunk[index] as string;
        if (!info) return;
        const parsed = tokenAccountOf(Buffer.from(info.data));
        if (!parsed || parsed.mint !== token || parsed.amount === 0n) return;
        const named = accounts.find((entry) => entry.account === address);
        /* A vault is listed under its own address; a wallet's account under the wallet. */
        balances.push({ owner: named && named.owner === address ? address : parsed.owner, account: address, amountRaw: parsed.amount.toString() });
      });
    }
    /* Merged by owner: one wallet may hold more than one account of the mint. */
    const byOwner = new Map<string, HolderBalance>();
    for (const balance of balances) {
      const held = byOwner.get(balance.owner);
      byOwner.set(balance.owner, held ? { ...held, amountRaw: (BigInt(held.amountRaw) + BigInt(balance.amountRaw)).toString() } : balance);
    }
    return { balances: [...byOwner.values()], totalHolders: all === null ? null : all.length, accounts: all, largestRead: answered !== null };
  }

  /**
   * Every account of the mint with a balance — its address, owner and amount — scanned on the node: the count of holders
   * and the market's health read the same scan. Null where the node does not index the token program.
   */
  function mintAccounts(mint: PublicKey): Promise<HolderBalance[] | null> {
    const key = `${lenients.map((node) => node.rpcEndpoint).join(",")}:${mint.toBase58()}`;
    const hit = SCANS.get(key);
    if (hit && Date.now() - hit.at < SCAN_KEEP_MS) return hit.value;
    if (SCANS.size >= SCANS_MAX) SCANS.delete(SCANS.keys().next().value as string);
    const value = scanMint(mint);
    SCANS.set(key, { at: Date.now(), value });
    return value;
  }

  function scanHolders(token: string): void {
    void mintAccounts(new PublicKey(token)).catch(() => null);
  }

  async function scanMint(mint: PublicKey): Promise<HolderBalance[] | null> {
    return fromAny(`holders:${mint.toBase58()}`, async (node) => {
      const accounts = await node.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        /* The owner (bytes 32–63) and the amount (64–71) of each account. */
        dataSlice: { offset: 32, length: 40 },
      });
      const rows: HolderBalance[] = [];
      for (const entry of accounts) {
        const data = Buffer.from(entry.account.data);
        if (data.length < 40) continue;
        const amount = data.readBigUInt64LE(32);
        if (amount > 0n) rows.push({ owner: new PublicKey(data.subarray(0, 32)).toBase58(), account: entry.pubkey.toBase58(), amountRaw: amount.toString() });
      }
      return rows;
    });
  }

  async function curvesBy(creator: string): Promise<number | null> {
    return optional(lenient.rpcEndpoint, "curves", async () => (await lenientClient.state.getPoolsByCreator(creator)).length);
  }

  async function feeNowBps(market: MarketState, side: "buy" | "sell"): Promise<number | null> {
    if (market.curve.migrated) return null;
    try {
      /* The curve as this read saw it: no second read of the same account. */
      const virtual = market.accounts.curve;
      const config = market.accounts.config;
      const amount = side === "buy" ? new BN(10 ** market.pairDecimals) : new BN(BigInt(market.supplyRaw) / 1_000_000n).addn(1);
      const quote = client.pool.swapQuote2({
        virtualPool: virtual as never,
        config,
        swapBaseForQuote: side === "sell",
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint: new BN(Math.floor(Date.now() / 1000)),
        swapMode: SwapMode.ExactIn,
        amountIn: amount,
      });
      const fee = big(quote.tradingFee) + big(quote.protocolFee) + big(quote.referralFee);
      const gross = side === "buy" ? big(quote.includedFeeInputAmount) : big(quote.outputAmount) + fee;
      return gross > 0n ? Number((fee * 10_000n) / gross) : null;
    } catch {
      return null;
    }
  }

  async function transaction({ token, state: market, signature, fresh }: Parameters<LaunchMarketReader["transaction"]>[0]): Promise<readonly LaunchTrade[] | null> {
    return (await decode(token, signature, market, fresh === true))?.trades ?? null;
  }

  return { state, trades, opening, accountTrades, windowTrades, transaction, holders, scanHolders, curvesBy, feeNowBps };
}

/** The graduated pool's price of the token in the pair currency: its square root prices B in A. */
export function dammPrice(sqrtPrice: string, tokenIsA: boolean, tokenDecimals: number, pairDecimals: number): number {
  if (tokenIsA) return priceFromSqrtX64(sqrtPrice, tokenDecimals, pairDecimals);
  const inverse = priceFromSqrtX64(sqrtPrice, pairDecimals, tokenDecimals);
  return inverse > 0 ? 1 / inverse : 0;
}
