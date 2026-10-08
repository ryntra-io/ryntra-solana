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
 * One read of a history has a time budget, the node's own waits on a refusal
 * included: what a public node refused is asked again one at a time while it
 * lasts, and what is still unread then leaves the history called partial rather
 * than the page waiting past its time.
 *
 * Nothing here signs or sends. Server-only: it reads through the connection
 * it is given.
 */

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  SwapMode,
  deriveDammV2PoolAddress,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { getBase58Encoder } from "@solana/kit";
import BN from "bn.js";

import { SNIPER_SECONDS, accountPageReached, listsWhole, partnerPartRaw, priceFromSqrtX64, tradeOf, type LaunchTrade, type SwapSeen } from "./market.ts";

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** Anchor's tag on a self-invoked event instruction. */
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
/** Where a swap instruction names its token accounts and its payer: DBC `swap`/`swap2` and DAMM v2 `swap`/`swap2`. */
const SWAP_ACCOUNTS = {
  [DBC_PROGRAM]: { input: 3, output: 4, payer: 9 },
  [DAMM_V2_PROGRAM]: { input: 2, output: 3, payer: 8 },
} as const;

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
}>;

export type GraduatedState = Readonly<{
  pool: string;
  tokenIsA: boolean;
  tokenVault: string;
  pairVault: string;
  sqrtPrice: string;
  tokenReserveRaw: string;
  pairReserveRaw: string;
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
  accounts: Readonly<{ curve: unknown; config: PoolConfig }>;
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
}>;

export type HolderBalance = Readonly<{ owner: string; account: string; amountRaw: string }>;

export type HolderRead = Readonly<{
  balances: readonly HolderBalance[];
  /** Holders with a balance counted across the whole mint — null when the node could not count them. */
  totalHolders: number | null;
}>;

export type Decoded = Readonly<{ slot: number; blockTime: number | null; failed: boolean; trades: readonly LaunchTrade[] }>;

/**
 * Where decoded transactions outlive a process: a confirmed transaction's trades never change, so once any instance has
 * read one from the node, every other instance reads it from here. One reader's index is for one fee wallet — what a
 * trade cost depends on it — and `load` gives every transaction of the token already decoded, by signature.
 */
export type DecodedIndex = Readonly<{
  load(token: string): Promise<ReadonlyMap<string, Decoded>>;
  save(token: string, signature: string, decoded: Decoded): Promise<void>;
}>;

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

export type LaunchMarketReader = Readonly<{
  state(args: Readonly<{ token: string; pool: string }>): Promise<MarketState>;
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
  /** The trades one transaction made on this token, from its swap events; null when the node has no record of it yet. */
  /** `fresh`: a decode this process kept from before Ryntra's part of a trade was counted is read from the node again. */
  transaction(args: Readonly<{ token: string; state: MarketState; signature: string; fresh?: boolean }>): Promise<readonly LaunchTrade[] | null>;
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
const REFUSAL_PAUSE_MS = 5 * 60 * 1000;
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
    REFUSED.set(key, Date.now());
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
 * account in the pair currency is Meteora's referral paid to Ryntra, and is Ryntra's part of the trade's fee.
 */
export function createLaunchMarketReader(
  connection: Connection,
  options: Readonly<{ feeWallet?: string | null; referralOwner?: string | null; indexed?: string | null; index?: DecodedIndex | null; history?: string | null; archive?: string | null }> = {},
): LaunchMarketReader {
  const lenient = sideConnection(options.indexed ?? connection.rpcEndpoint);
  const listing = options.history && options.history !== connection.rpcEndpoint ? sideConnection(options.history) : connection;
  const archive = options.archive && options.archive !== connection.rpcEndpoint ? sideConnection(options.archive) : null;
  const feeWallet = options.feeWallet ?? null;
  const referralOwner = options.referralOwner ?? null;
  const index = options.index ?? null;
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const lenientClient = new DynamicBondingCurveClient(lenient, "confirmed");
  const cpAmm = new CpAmm(connection);
  const dbcCoder = (client.state.getProgram() as unknown as { coder: { events: { decode(data: string): { name: string; data: Record<string, unknown> } | null } } }).coder;
  const dammCoder = (cpAmm._program as unknown as { coder: { events: { decode(data: string): { name: string; data: Record<string, unknown> } | null } } }).coder;

  function configOf(address: PublicKey): Promise<PoolConfig> {
    const key = `${connection.rpcEndpoint}:${address.toBase58()}`;
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

  async function state({ token, pool }: Readonly<{ token: string; pool: string }>): Promise<MarketState> {
    const tokenKey = new PublicKey(token);
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
    };
    let graduated: GraduatedState | null = null;
    if (migrated) {
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      const dammPool = dammConfig ? deriveDammV2PoolAddress(dammConfig, tokenKey, config.quoteMint) : null;
      const poolState = dammPool ? await cpAmm.fetchPoolState(dammPool).catch(() => null) : null;
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
      accounts: { curve: virtual, config },
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
    if (cached && (!fresh || cached.trades.every((trade) => trade.ryntraRaw !== undefined))) return cached;
    let tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    /* A public node keeps a day or two of transactions: an older one is asked of the archive. */
    if (!tx && archive) tx = await archive.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!tx?.meta) return null;
    const message = tx.transaction.message;
    const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const keyAt = (index: number) => keys.get(index)?.toBase58() ?? "";
    const seen: SwapSeen[] = [];
    let unsure = false;
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
    const decoded: Decoded = { slot: tx.slot, blockTime: tx.blockTime ?? null, failed: tx.meta.err !== null, trades: tx.meta.err === null ? trades : [] };
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
    const decoded = await inTurns(signatures, (signature) => (Date.now() < until ? decode(token, signature, market).catch(() => null) : Promise.resolve(null)));
    for (let index = 0; index < decoded.length && Date.now() < until; index += 1) {
      if (decoded[index] !== null) continue;
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
      decoded[index] = await decode(token, signatures[index]!, market).catch(() => null);
    }
    return decoded;
  }

  /** An account's signatures from the endpoint with the whole history, or the main one when that does not answer. */
  async function signaturesOf(address: PublicKey, options: Readonly<{ before?: string; limit: number }>) {
    return (await listedFrom(address, options)).entries;
  }

  /** The same, and whether the endpoint with the whole history gave it — a short list from any other proves nothing. */
  async function listedFrom(address: PublicKey, options: Readonly<{ before?: string; limit: number }>) {
    if (listing !== connection) {
      const entries = await listing.getSignaturesForAddress(address, options, "confirmed").catch(() => null);
      if (entries) return { entries, deep: true };
    }
    return { entries: await connection.getSignaturesForAddress(address, options, "confirmed"), deep: false };
  }

  async function trades({ token, state: market, creationSignature, limit = TRADE_HISTORY_LIMIT, budgetMs = HISTORY_BUDGET_MS }: Parameters<LaunchMarketReader["trades"]>[0]): Promise<TradeHistory> {
    const until = Date.now() + budgetMs;
    const curveSignatures = await signaturesOf(new PublicKey(market.curve.pool), { limit });
    const poolSignatures = market.graduated ? await signaturesOf(new PublicKey(market.graduated.pool), { limit }) : [];
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
    return {
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
    for (const account of accounts) {
      const listed = await listedFrom(new PublicKey(account), { limit: ACCOUNT_SIGNATURES }).catch(() => null);
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
      const batch = await signaturesOf(pool, { before, limit: 1_000 });
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
    const largest = (await optional(lenient.rpcEndpoint, "largest", () => lenient.getTokenLargestAccounts(mint, "confirmed").then((answer) => answer.value.map((entry) => entry.address.toBase58())))) ?? [];
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
    const totalHolders = await countHolders(mint);
    return { balances: [...byOwner.values()], totalHolders };
  }

  /** Every account of the mint with a balance, counted on the node; null where the node does not index the token program. */
  async function countHolders(mint: PublicKey): Promise<number | null> {
    return optional(lenient.rpcEndpoint, "holders", async () => {
      const accounts = await lenient.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        dataSlice: { offset: 64, length: 8 },
      });
      return accounts.filter((entry) => Buffer.from(entry.account.data).readBigUInt64LE(0) > 0n).length;
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

  return { state, trades, opening, accountTrades, transaction, holders, curvesBy, feeNowBps };
}

/** The graduated pool's price of the token in the pair currency: its square root prices B in A. */
export function dammPrice(sqrtPrice: string, tokenIsA: boolean, tokenDecimals: number, pairDecimals: number): number {
  if (tokenIsA) return priceFromSqrtX64(sqrtPrice, tokenDecimals, pairDecimals);
  const inverse = priceFromSqrtX64(sqrtPrice, pairDecimals, tokenDecimals);
  return inverse > 0 ? 1 / inverse : 0;
}
