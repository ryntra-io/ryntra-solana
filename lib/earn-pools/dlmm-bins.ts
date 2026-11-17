/**
 * A Meteora DLMM pool's bins around its active bin as the one answer of `./bins.ts`: the bins through the
 * venue's own SDK (`getBinsAroundActiveBin`), what a new position's accounts cost and give back, and where Jupiter
 * prices the pair now. Everything it reads comes through `deps` — the server hands it the chain and the SDK
 * (`./bins.server.ts`), a test hands it a pool of its own; the SDK itself is never loaded here.
 *
 * Read-only: nothing here builds, signs or moves anything. The market's price is a courtesy: when Jupiter does not
 * answer, the bins still do.
 */

import { PublicKey } from "@solana/web3.js";

import { gapPctOf, marketPriceOf, type EarnBin, type EarnBinLedger, type EarnBinsAnswer, type EarnBinsRent } from "./bins.ts";
import { MARKET_DEADLINE_MS } from "./market-price.ts";

export type BinsRead = Readonly<{ ok: true; value: EarnBinsAnswer }> | Readonly<{ ok: false; code: "NOT_A_POOL" | "UNAVAILABLE"; reason: string }>;

type Units = Readonly<{ toString(): string }>;

/** The part of the SDK's pool the reader stands on. */
export type DlmmPairLike = Readonly<{
  lbPair: Readonly<{ activeId: number; binStep: number }>;
  tokenX: Readonly<{ publicKey: PublicKey; mint: Readonly<{ decimals: number }> }>;
  tokenY: Readonly<{ publicKey: PublicKey; mint: Readonly<{ decimals: number }> }>;
  getBinsAroundActiveBin(left: number, right: number): Promise<Readonly<{ activeBin: number; bins: readonly Readonly<{ binId: number; xAmount: Units; yAmount: Units; pricePerToken: string }>[] }>>;
}>;

export type DlmmBinsDeps = Readonly<{
  /** The pool at an address; null — no DLMM pool there. */
  open: (pool: PublicKey) => Promise<DlmmPairLike | null>;
  /** The pool's shared ledgers (bin arrays) that hold the bins from `lower` to `upper`: each one's account and the ids it holds. */
  ledgers: (pool: PublicKey, lower: number, upper: number) => readonly Readonly<{ key: PublicKey; lower: number; upper: number }>[];
  /** Which of the accounts exist. */
  exist: (keys: readonly PublicKey[]) => Promise<readonly boolean[]>;
  /** What an account of the program's kind costs to keep, lamports. */
  rentOf: (account: "positionV2" | "binArray") => Promise<bigint>;
  /** Jupiter's dollar price of each mint; a mint it does not price is absent. */
  market: (mints: readonly string[]) => Promise<Readonly<Record<string, number>>>;
}>;

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A ledger holds this many bins. */
const LEDGER_BINS = 70;

/**
 * The pool's shared ledgers (bin arrays) a new position around the price can need, each with the ids it holds and
 * whether it is open. A position's accounts name the ledger its lowest bin is in and the one after it (the SDK's own
 * rule, which the engine's add follows), so the ledgers are read one ledger past the highest bin.
 */
async function ledgersOf(pool: PublicKey, lower: number, upper: number, deps: Pick<DlmmBinsDeps, "ledgers" | "exist">): Promise<EarnBinLedger[]> {
  const arrays = deps.ledgers(pool, lower, upper + LEDGER_BINS);
  const open = await deps.exist(arrays.map((entry) => entry.key));
  return arrays.map((entry, index) => ({ lower: entry.lower, upper: entry.upper, open: open[index] === true })).sort((a, b) => a.lower - b.lower);
}

/** One read of the chain: the bins, the accounts' cost and the market's price, as the one answer. */
export async function readDlmmBinsAnswer(address: string, half: number, deps: DlmmBinsDeps, now: () => number): Promise<BinsRead> {
  let pool: PublicKey;
  try {
    pool = new PublicKey(address);
  } catch {
    return { ok: false, code: "NOT_A_POOL", reason: "The pool is not an address." };
  }
  const pair = await deps.open(pool);
  if (!pair) return { ok: false, code: "NOT_A_POOL", reason: "No DLMM pool at the address." };
  const around = await pair.getBinsAroundActiveBin(half, half);
  const active = around.activeBin;
  const x = { mint: pair.tokenX.publicKey.toBase58(), decimals: pair.tokenX.mint.decimals };
  const y = { mint: pair.tokenY.publicKey.toBase58(), decimals: pair.tokenY.mint.decimals };
  const bins: EarnBin[] = around.bins
    .map((bin) => ({ offset: bin.binId - active, id: bin.binId, price: Number(bin.pricePerToken), x: bin.xAmount.toString(), y: bin.yAmount.toString() }))
    // The SDK reads whole stretches and may hand back a bin past each end: the answer holds exactly what was asked.
    .filter((bin) => Math.abs(bin.offset) <= half && Number.isFinite(bin.price) && bin.price > 0 && /^\d+$/.test(bin.x) && /^\d+$/.test(bin.y))
    .sort((a, b) => a.offset - b.offset);
  const at = bins.find((bin) => bin.offset === 0);
  if (!at) return { ok: false, code: "UNAVAILABLE", reason: "The pool's active bin was not read." };

  const [ledgers, positionLamports, ledgerLamports, usd] = await Promise.all([
    ledgersOf(pool, active - half, active + half, deps),
    deps.rentOf("positionV2"),
    deps.rentOf("binArray"),
    withTimeout(deps.market([x.mint, y.mint]), MARKET_DEADLINE_MS + 500, "Jupiter").catch(() => ({}) as Readonly<Record<string, number>>),
  ]);
  const rent: EarnBinsRent = { positionLamports: positionLamports.toString(), ledgerLamports: ledgerLamports.toString(), ledgers };
  const marketPrice = marketPriceOf(usd[x.mint] ?? null, usd[y.mint] ?? null);
  return {
    ok: true,
    value: {
      venue: "dlmm",
      pool: address,
      x,
      y,
      stepBps: pair.lbPair.binStep,
      activeId: active,
      price: at.price,
      bins,
      market: { price: marketPrice, gapPct: gapPctOf(at.price, marketPrice) },
      rent,
      at: new Date(now()).toISOString(),
    },
  };
}
