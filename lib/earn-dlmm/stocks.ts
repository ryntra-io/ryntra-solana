/**
 * A position of one's own in a Meteora DLMM pool of a **checked stock** against USDC or SOL, put in
 * with the two coins the wallet already holds.
 *
 * Where the depth of a stock is on Meteora — Anthropic's ANT by Backpack Securities was the first: sixteen DLMM pools,
 * the deepest against USDC — the city's SOL Pier cannot go: it pays in SOL alone through Meteora's Zap, which takes coins
 * of the Token program only, and a pool against USDC has no SOL side at all. So this path swaps nothing: the person puts
 * in the stock and the other coin they hold, and the engine's own DLMM add (`lib/liquidity/studio/dlmm.ts`, Meteora's SDK
 * — the token program of each side read from its mint, the person's accounts opened by the associated token program at
 * the size the mint asks) builds the position. What it builds is the engine's own Review, unchanged: its gate, its
 * checks of every call, its simulation, its sealed ticket and its relay. No fee of Ryntra's is added.
 *
 * In front of it, this door:
 *
 * - the switch `RYNTRA_EARN_DLMM_STOCKS` — `open` (exactly): everyone the engine admits; `canary` (exactly): only the
 *   wallet named in `RYNTRA_EARN_DLMM_STOCKS_CANARY_WALLET` (the operator tries it first, decision 92); anything else:
 *   closed. The Harbor's own stop (`RYNTRA_CITY_HARBOR_STOP`) stops new money here too, at once;
 * - the pool is DLMM's, one side a stock of the stocks engine's shelf by the rule of DLMM Pro's stock piers
 *   (`lib/earn-pro/stocks.ts`: a listed company's token its issuer still sells, never a pre-IPO token), the other side
 *   USDC or SOL — read from the chain, not from an index;
 * - a stock its issuer paused (its Token-2022 pausable config) takes no deposit: every transfer of it would fail;
 * - the add opens a new position around the price, in the shape and width of the Pier's own goals;
 * - what the engine hands back must be an add on that very pool, of those very coins, of exactly what was asked — or the
 *   ticket is dropped here and never reaches the wallet.
 *
 * Taking fees, leaving and closing are never held by this switch: the route passes them to the engine's own Review
 * whatever it says (`app/api/city/earn/dlmm-stocks/review/route.ts`), as Earn's own positions do.
 *
 * Pure: the chain, the shelf and the engine come in through `deps`.
 */

import { getPausableConfig, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { StockSeat, StockSeats } from "../earn-pro/stocks.ts";
import { parseReviewInput, type ActionFailure, type LiquidityReview } from "../liquidity/studio/actions.ts";
import { liquidityActionStates } from "../liquidity/studio/gate.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/* ------------------------------------------------------------------ the switch */

export const EARN_DLMM_STOCKS_ENV = "RYNTRA_EARN_DLMM_STOCKS";
export const EARN_DLMM_STOCKS_CANARY_WALLET_ENV = "RYNTRA_EARN_DLMM_STOCKS_CANARY_WALLET";
/** The Harbor's own stop (`city/lib/earn/pier-gate.ts`): set to anything, new money into DLMM from the city stops — here too. */
export const HARBOR_STOP_ENV = "RYNTRA_CITY_HARBOR_STOP";

export const DLMM_STOCKS_MODES = ["closed", "canary", "open"] as const;
export type DlmmStocksMode = (typeof DLMM_STOCKS_MODES)[number];

/** `open` or `canary`, exactly as written; anything else — and nothing — is closed. */
export function dlmmStocksMode(env: Env): DlmmStocksMode {
  const value = env[EARN_DLMM_STOCKS_ENV]?.trim();
  return value === "open" || value === "canary" ? value : "closed";
}

export function dlmmStocksStopped(env: Env): boolean {
  const value = env[HARBOR_STOP_ENV]?.trim().toLowerCase();
  return Boolean(value) && value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

export type DlmmStockAdmission = Readonly<{ ok: true; mode: Exclude<DlmmStocksMode, "closed"> }> | Readonly<{ ok: false; code: "DLMM_STOCKS_CLOSED" | "DLMM_STOCKS_STOPPED" }>;

/** Whether this wallet may put new money into a stock's DLMM pool now. In `canary` a stranger is told the same as under `closed`. */
export function admitDlmmStockAdd(owner: string | null, env: Env): DlmmStockAdmission {
  const mode = dlmmStocksMode(env);
  if (mode === "closed") return { ok: false, code: "DLMM_STOCKS_CLOSED" };
  if (mode === "canary") {
    const wallet = env[EARN_DLMM_STOCKS_CANARY_WALLET_ENV]?.trim();
    if (!wallet || owner === null || owner !== wallet) return { ok: false, code: "DLMM_STOCKS_CLOSED" };
  }
  if (dlmmStocksStopped(env)) return { ok: false, code: "DLMM_STOCKS_STOPPED" };
  return { ok: true, mode };
}

/* ------------------------------------------------------------------ the pool, from the chain */

export const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Where a DLMM pair keeps what the door reads, bytes into its account (program 0.12, the IDL's `LbPair`; checked on a
 * mainnet SOL–USDC pair of the engine's tape): the active bin, the bin step, the status, the two mints.
 */
export const LB_PAIR = { activeId: 76, binStep: 80, status: 82, mintX: 88, mintY: 120, least: 152 } as const;

/** An account as a node answers it: its owner program and its bytes. */
export type ChainAccount = Readonly<{ owner: string; data: Uint8Array }>;

export type PairSide = Readonly<{ mint: string; decimals: number; program: string; paused: boolean }>;
export type DlmmPair = Readonly<{ pool: string; x: PairSide; y: PairSide; activeId: number; binStep: number; enabled: boolean }>;

/** The pair's mints, active bin, step and status; null where the account is no DLMM pair. */
export function lbPairOf(info: ChainAccount | null): Readonly<{ x: string; y: string; activeId: number; binStep: number; enabled: boolean }> | null {
  if (!info || info.owner !== DLMM_PROGRAM || info.data.length < LB_PAIR.least) return null;
  const data = Buffer.from(info.data);
  const binStep = data.readUInt16LE(LB_PAIR.binStep);
  if (binStep <= 0) return null;
  return {
    x: new PublicKey(data.subarray(LB_PAIR.mintX, LB_PAIR.mintX + 32)).toBase58(),
    y: new PublicKey(data.subarray(LB_PAIR.mintY, LB_PAIR.mintY + 32)).toBase58(),
    activeId: data.readInt32LE(LB_PAIR.activeId),
    binStep,
    enabled: data.readUInt8(LB_PAIR.status) === 0,
  };
}

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

/**
 * A coin of the pair from its mint account: its token program, its decimals (byte 44 of every mint) and whether its
 * issuer paused it now (a Token-2022 pausable config). Null where the account is no mint of either token program.
 */
export function sideOf(mint: string, info: ChainAccount | null): PairSide | null {
  if (!info || !TOKEN_PROGRAMS.has(info.owner) || info.data.length < 82) return null;
  const decimals = info.data[44]!;
  let paused = false;
  if (info.owner === TOKEN_2022_PROGRAM_ID.toBase58()) {
    try {
      const unpacked = unpackMint(new PublicKey(mint), { data: Buffer.from(info.data), owner: TOKEN_2022_PROGRAM_ID, lamports: 0, executable: false }, TOKEN_2022_PROGRAM_ID);
      paused = getPausableConfig(unpacked)?.paused === true;
    } catch {
      return null;
    }
  }
  return { mint, decimals, program: info.owner, paused };
}

/** The pair as the chain holds it: the pool's account and its two mints' accounts. */
export function pairOf(pool: string, poolInfo: ChainAccount | null, mintInfo: (mint: string) => ChainAccount | null): DlmmPair | null {
  const pair = lbPairOf(poolInfo);
  if (!pair) return null;
  const x = sideOf(pair.x, mintInfo(pair.x));
  const y = sideOf(pair.y, mintInfo(pair.y));
  if (!x || !y) return null;
  return { pool, x, y, activeId: pair.activeId, binStep: pair.binStep, enabled: pair.enabled };
}

const CALL_MS = 6_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

type AccountsReader = Readonly<{ getMultipleAccountsInfo: (keys: PublicKey[], commitment: "confirmed") => Promise<readonly ({ owner: PublicKey; data: Uint8Array } | null)[]> }>;

/** The pair from one node: the pool's account, then its two mints'. Throws where the node did not answer. */
export async function readPairOn(connection: AccountsReader, pool: string): Promise<DlmmPair | null> {
  let poolKey: PublicKey;
  try {
    poolKey = new PublicKey(pool);
  } catch {
    return null;
  }
  const asChain = (info: { owner: PublicKey; data: Uint8Array } | null | undefined): ChainAccount | null => (info ? { owner: info.owner.toBase58(), data: info.data } : null);
  const [poolInfo] = await within(connection.getMultipleAccountsInfo([poolKey], "confirmed"), CALL_MS);
  const first = asChain(poolInfo);
  const head = lbPairOf(first);
  if (!head) return null;
  const mints = [new PublicKey(head.x), new PublicKey(head.y)];
  const infos = await within(connection.getMultipleAccountsInfo(mints, "confirmed"), CALL_MS);
  const byMint = new Map(mints.map((mint, index) => [mint.toBase58(), asChain(infos[index])]));
  return pairOf(pool, first, (mint) => byMint.get(mint) ?? null);
}

/** Y per one X at a bin, in whole coins: DLMM's own price, (1 + step)^bin moved by the coins' decimals. */
export function binPrice(activeId: number, binStep: number, decimalsX: number, decimalsY: number): number {
  return (1 + binStep / 10_000) ** activeId * 10 ** (decimalsX - decimalsY);
}

/* ------------------------------------------------------------------ the stock and its pair */

export const STOCK_QUOTES = { usdc: SOLANA_MAINNET_USDC_MINT, sol: WRAPPED_SOL_MINT } as const;
export type QuoteKind = keyof typeof STOCK_QUOTES;

const quoteKindOf = (mint: string): QuoteKind | null => (mint === STOCK_QUOTES.usdc ? "usdc" : mint === STOCK_QUOTES.sol ? "sol" : null);

export type DlmmStockPool = Readonly<{
  pool: string;
  stock: StockSeat & Readonly<{ side: "x" | "y"; decimals: number; program: string }>;
  quote: Readonly<{ kind: QuoteKind; mint: string; decimals: number; side: "x" | "y" }>;
  /** The other coin for one whole stock, at the pool's active bin. */
  price: number;
  binStep: number;
  activeId: number;
  /** The stock's issuer paused it: no deposit while it holds. */
  paused: boolean;
  enabled: boolean;
}>;

/** A pair as a stock's pool: one side a seat on the shelf, the other USDC or SOL; null for anything else. */
export function stockPoolOf(pair: DlmmPair, seats: ReadonlyMap<string, StockSeat>): DlmmStockPool | null {
  const xSeat = seats.get(pair.x.mint) ?? null;
  const ySeat = seats.get(pair.y.mint) ?? null;
  if ((xSeat === null) === (ySeat === null)) return null;
  const side = xSeat ? "x" : "y";
  const stockSide = side === "x" ? pair.x : pair.y;
  const quoteSide = side === "x" ? pair.y : pair.x;
  const kind = quoteKindOf(quoteSide.mint);
  if (!kind) return null;
  const seat = (xSeat ?? ySeat)!;
  const yPerX = binPrice(pair.activeId, pair.binStep, pair.x.decimals, pair.y.decimals);
  const price = side === "x" ? yPerX : 1 / yPerX;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    pool: pair.pool,
    stock: { ...seat, side, decimals: stockSide.decimals, program: stockSide.program },
    quote: { kind, mint: quoteSide.mint, decimals: quoteSide.decimals, side: side === "x" ? "y" : "x" },
    price,
    binStep: pair.binStep,
    activeId: pair.activeId,
    paused: stockSide.paused,
    enabled: pair.enabled,
  };
}

/* ------------------------------------------------------------------ what the screen reads */

/** One pool for one wallet: the stock, the other coin, the price, and whether this wallet may put money in now. */
export type DlmmStockRead = Readonly<{
  pool: string;
  stock: Readonly<{ mint: string; symbol: string; issuer: string; side: "x" | "y"; decimals: number }>;
  quote: Readonly<{ kind: QuoteKind; mint: string; decimals: number }>;
  price: number;
  binStepBps: number;
  activeBin: number;
  paused: boolean;
  add: "on" | "off";
  /** New money stopped by the stop — said only to a wallet the switch is open to. */
  stopped: boolean;
}>;

export function stockReadOf(pool: DlmmStockPool, owner: string | null, env: Env): DlmmStockRead {
  const admitted = admitDlmmStockAdd(owner, env);
  const engine = liquidityActionStates(owner, env);
  const add = admitted.ok && engine.add.status === "on" && !pool.paused && pool.enabled;
  return {
    pool: pool.pool,
    stock: { mint: pool.stock.mint, symbol: pool.stock.symbol, issuer: pool.stock.issuer, side: pool.stock.side, decimals: pool.stock.decimals },
    quote: { kind: pool.quote.kind, mint: pool.quote.mint, decimals: pool.quote.decimals },
    price: pool.price,
    binStepBps: pool.binStep,
    activeBin: pool.activeId,
    paused: pool.paused,
    add: add ? "on" : "off",
    stopped: !admitted.ok && admitted.code === "DLMM_STOCKS_STOPPED",
  };
}

/* ------------------------------------------------------------------ the door */

export type DlmmStockDeps = Readonly<{
  env: Env;
  /** The pair as the chain holds it now; null — no DLMM pair there. Throws where the chain did not answer. */
  pair: (pool: string) => Promise<DlmmPair | null>;
  seats: StockSeats;
  /** The engine's own Review of a pool action (`lib/liquidity/studio/actions.server.ts`). */
  review: (body: unknown) => Promise<Readonly<{ ok: true; value: LiquidityReview }> | ActionFailure>;
}>;

export type DlmmStockReview = LiquidityReview & Readonly<{ stock: DlmmStockRead["stock"]; quote: DlmmStockRead["quote"] }>;
export type DlmmStockAnswer = Readonly<{ ok: true; value: DlmmStockReview }> | ActionFailure;

const fail = (status: number, code: string, reason: string): ActionFailure => ({ ok: false, status, code, reason });

/** The pool of a stock as the door reads it for a wallet — the screen's read and the add's first step alike. */
export async function readStockPool(pool: string, deps: Pick<DlmmStockDeps, "pair" | "seats">): Promise<Readonly<{ ok: true; value: DlmmStockPool }> | ActionFailure> {
  let pair: DlmmPair | null;
  try {
    pair = await deps.pair(pool);
  } catch {
    return fail(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }
  if (!pair) return fail(404, "POOL_NOT_FOUND", "No DLMM pool at the address.");
  /* A shelf that did not read seats nothing: no new money on a guess. */
  const seats = await deps.seats([pair.x.mint, pair.y.mint]).catch(() => new Map<string, StockSeat>());
  const stock = stockPoolOf(pair, seats);
  if (!stock) return fail(403, "DLMM_STOCK_PAIR", "This pool is not a checked stock against USDC or SOL.");
  return { ok: true, value: stock };
}

/**
 * The Review of new money into a stock's DLMM pool: the door, then the engine's own Review, then the check that what it
 * built is exactly what was asked. Nothing is signed or sent here.
 */
export async function reviewDlmmStockAdd(body: unknown, deps: DlmmStockDeps): Promise<DlmmStockAnswer> {
  const input = parseReviewInput(body);
  if (!input || input.action !== "add" || input.venue !== "meteora-dlmm") return fail(400, "BAD_REQUEST", "The request was not understood.");
  const request = input.request;
  if (request.position) return fail(400, "BAD_REQUEST", "A stock's pool opens new positions only here.");
  if (!input.range || input.range.place !== "around" || input.range.half < 1) return fail(400, "BAD_REQUEST", "A new position here stands around the price.");
  const admitted = admitDlmmStockAdd(request.owner, deps.env);
  if (!admitted.ok) return fail(403, admitted.code, "New money does not go into this pool from this wallet now.");
  const read = await readStockPool(request.pool, deps);
  if (!read.ok) return read;
  const stock = read.value;
  if (stock.paused) return fail(409, "DLMM_STOCK_PAUSED", "The issuer paused this token: nothing goes into the pool while the pause holds.");
  if (!stock.enabled) return fail(409, "POOL_DISABLED", "The pool does not take liquidity now.");

  const reviewed = await deps.review(body);
  if (!reviewed.ok) return reviewed;
  const preview = reviewed.value.preview;
  const xMint = stock.stock.side === "x" ? stock.stock.mint : stock.quote.mint;
  const yMint = stock.stock.side === "x" ? stock.quote.mint : stock.stock.mint;
  // What the engine built must be a new position on this very pool, of these very coins, of exactly what was asked.
  const same =
    preview.action === "add" &&
    preview.pool === request.pool &&
    preview.opensPosition &&
    preview.deposit.x.asset === xMint &&
    preview.deposit.y.asset === yMint &&
    BigInt(preview.deposit.x.units) === BigInt(request.amountX) &&
    BigInt(preview.deposit.y.units) === BigInt(request.amountY);
  if (!same) return fail(403, "DLMM_STOCK_PAIR", "This add is outside what a stock's pool takes.");
  const facts = stockReadOf(stock, request.owner, deps.env);
  return { ok: true, value: { ...reviewed.value, stock: facts.stock, quote: facts.quote } };
}
