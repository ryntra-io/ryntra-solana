/**
 * «Вартість портфеля» — one rule for Home and Portfolio, so the two places
 * never show two numbers (огляд B13, п. 3): what the wallet holds, plus what
 * it has in Meteora pools, plus what waits in its open limit orders, plus its
 * collateral on Phoenix (SOL-C6, UX-600). A position, an order or collateral
 * is the person's money as much as a token is; leaving them out made the
 * value «fall» by the sum a person put into a pool or onto Phoenix.
 *
 * Collateral is what «Your Phoenix account» reads (`/api/solana/futures/account`):
 * the USDC on the account, and SOL posted there at the wallet's own SOL price.
 * The unrealised result of positions is margin, not a balance: it is never in
 * the sum (C-09), only beside it where Portfolio shows the positions.
 *
 * Pure: the four reads in, the number and its parts out. A part that was not
 * read is named, never counted as zero; a part still being read is named too,
 * and the number stands for what was read. Only the wallet decides whether
 * there is a number at all — Portfolio's rule: a wallet read whole, and never
 * $0 for one whose every asset is unpriced. Launch fees not yet claimed and
 * rewards stay outside the sum, said beside it where they are shown.
 */

import type { LimitOrderView } from "../../lib/solana/limits/sync.server.ts";
import type { LimitToken } from "../solana/workspace/spot/limit-orders-view.ts";
import { isOpenLimit } from "../solana/workspace/spot/limit-orders-view.ts";
import { holdingValue, type WalletHolding } from "./wallet-view-model.ts";

/** Micro-dollars, the unit `walletValue` counts in. */
const MICRO = 1_000_000;

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const DOLLARS: ReadonlySet<string> = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const KNOWN_DECIMALS: Readonly<Record<string, number>> = {
  [WRAPPED_SOL]: 9,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

/** The account states that hold nothing: Phoenix has never seen the wallet, or the account was never opened. */
const NO_ACCOUNT: ReadonlySet<string> = new Set(["none", "uninitialized"]);

export type ValuePart = "wallet" | "pools" | "orders" | "collateral";
type ReadPhase = "loading" | "ready" | "failed";

export type PortfolioValueInput = Readonly<{
  wallet: Readonly<{ status: "idle" | "loading" | "ready" | "error"; complete: boolean; holdings: readonly WalletHolding[] }>;
  /** Each position's value, USD — null where a price was missing. */
  pools: Readonly<{ status: "idle" | "loading" | "ready" | "failed"; values: readonly (number | null)[]; complete: boolean }>;
  orders: Readonly<{ status: "idle" | "loading" | "ready" | "failed"; complete: boolean; orders: readonly LimitOrderView[]; tokens: Readonly<Record<string, LimitToken>> }>;
  /**
   * The Phoenix account, as «Your Phoenix account» reads it: its state, the dollars of USDC on it and the SOL posted;
   * null where it says none. `state` "none" is a wallet Phoenix has never seen.
   */
  collateral: Readonly<{ status: "idle" | "loading" | "ready" | "failed"; state: string | null; usd: number | null; sol: number | null }>;
}>;

export type PortfolioValue = Readonly<{
  /** The wallet decides: loading until it is read, unread when it failed or is not whole. */
  phase: "loading" | "ready" | "unread";
  /** Why there is no number: the wallet failed, was read in part, or nothing in it has a price. */
  reason: "unread" | "partial" | "unpriced" | null;
  /** Micro-USD, the sum of every part read; null without a number. */
  total: bigint | null;
  /** Each part, micro-USD; null while it is read or when it failed. */
  parts: Readonly<Record<ValuePart, bigint | null>>;
  /** Each part's own read. */
  reads: Readonly<Record<ValuePart, ReadPhase>>;
  /** Assets, positions and orders that have no price: outside the sum, said beside it. */
  unpriced: number;
  /** A part that failed, or was read only in part (a venue or a pool that did not answer): the number is a floor. */
  partial: boolean;
}>;

function phaseOf(status: "idle" | "loading" | "ready" | "failed" | "error"): ReadPhase {
  if (status === "ready") return "ready";
  if (status === "failed" || status === "error") return "failed";
  return "loading";
}

const usdMicro = (usd: number): bigint => BigInt(Math.round(usd * MICRO));

/** A mint's price per whole token, USD, from what the wallet's own read priced; the two dollars at one. */
export function priceBook(holdings: readonly WalletHolding[]): ReadonlyMap<string, number> {
  const book = new Map<string, number>();
  for (const mint of DOLLARS) book.set(mint, 1);
  for (const holding of holdings) {
    const price = Number(holding.catalog?.usdPrice ?? Number.NaN);
    if (!Number.isFinite(price) || price <= 0) continue;
    const mint = holding.kind === "NATIVE_SOL" ? WRAPPED_SOL : holding.mint;
    /* A scaled mint is priced per shown unit, not per raw unit: its orders are left unpriced rather than guessed. */
    if (!mint || (typeof holding.uiMultiplier === "number" && holding.uiMultiplier !== 1)) continue;
    if (!book.has(mint)) book.set(mint, price);
  }
  return book;
}

/**
 * What an open order still holds, micro-USD: the part of its input not yet
 * filled, at the input's price. Null when the scale or the price is unknown.
 */
export function orderHeld(order: LimitOrderView, tokens: Readonly<Record<string, LimitToken>>, prices: ReadonlyMap<string, number>): bigint | null {
  const decimals = tokens[order.inputMint]?.decimals ?? KNOWN_DECIMALS[order.inputMint] ?? null;
  const price = prices.get(order.inputMint) ?? null;
  if (decimals === null || price === null) return null;
  let left: bigint;
  try {
    left = BigInt(order.makingRaw) - BigInt(order.filledInputRaw);
  } catch {
    return null;
  }
  if (left <= 0n) return 0n;
  /* Whole tokens × price in micro-dollars, without a float on the raw amount. */
  const scale = 10n ** BigInt(decimals);
  const priceMicro = usdMicro(price);
  return (left * priceMicro) / scale;
}

export function portfolioValue(input: PortfolioValueInput): PortfolioValue {
  const reads: Record<ValuePart, ReadPhase> = {
    wallet: phaseOf(input.wallet.status),
    pools: phaseOf(input.pools.status),
    orders: phaseOf(input.orders.status),
    /* An account that is there but did not state its dollars is not read, never $0. */
    collateral: input.collateral.status === "ready" && input.collateral.usd === null && !NO_ACCOUNT.has(input.collateral.state ?? "") ? "failed" : phaseOf(input.collateral.status),
  };
  const parts: Record<ValuePart, bigint | null> = { wallet: null, pools: null, orders: null, collateral: null };
  let unpriced = 0;
  let partial = false;

  if (reads.wallet === "ready") {
    let total = 0n;
    for (const holding of input.wallet.holdings) {
      const value = holdingValue(holding);
      if (value === null) unpriced += 1;
      else total += value;
    }
    parts.wallet = total;
  }
  if (reads.pools === "ready") {
    let total = 0n;
    for (const value of input.pools.values) {
      if (value === null || !Number.isFinite(value)) unpriced += 1;
      else total += usdMicro(Math.max(0, value));
    }
    parts.pools = total;
    if (!input.pools.complete) partial = true;
  }
  if (reads.orders === "ready") {
    const prices = priceBook(input.wallet.holdings);
    let total = 0n;
    for (const order of input.orders.orders) {
      if (!isOpenLimit(order)) continue;
      const held = orderHeld(order, input.orders.tokens, prices);
      if (held === null) unpriced += 1;
      else total += held;
    }
    parts.orders = total;
    if (!input.orders.complete) partial = true;
  }
  if (reads.collateral === "ready") {
    const { usd, sol } = input.collateral;
    /* As Phoenix states it, below zero too: a balance owed after losses or funding is the account's truth. */
    let total = usd !== null && Number.isFinite(usd) ? usdMicro(usd) : 0n;
    if (sol !== null && Number.isFinite(sol) && sol > 0) {
      /* SOL posted is priced as the wallet's SOL is; without that price it is unpriced, never $0. */
      const price = priceBook(input.wallet.holdings).get(WRAPPED_SOL) ?? null;
      if (price === null) unpriced += 1;
      else total += usdMicro(sol * price);
    }
    parts.collateral = total;
  }

  if (reads.wallet === "loading") return { phase: "loading", reason: null, total: null, parts, reads, unpriced, partial };
  const pricedWallet = input.wallet.holdings.some((holding) => holdingValue(holding) !== null);
  const reason = reads.wallet === "failed" ? "unread" : !input.wallet.complete ? "partial" : !pricedWallet && input.wallet.holdings.length > 0 ? "unpriced" : null;
  if (reason) return { phase: "unread", reason, total: null, parts, reads, unpriced, partial };
  /* A part that failed is not counted, so the number is at least what it says — and says so. */
  if (reads.pools === "failed" || reads.orders === "failed" || reads.collateral === "failed") partial = true;
  const total = (parts.wallet ?? 0n) + (parts.pools ?? 0n) + (parts.orders ?? 0n) + (parts.collateral ?? 0n);
  return { phase: "ready", reason: null, total, parts, reads, unpriced, partial };
}
