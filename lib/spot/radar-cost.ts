/**
 * Market Radar's card (SOL-R1): what a buy would cost before the person opens
 * its Review — the sum asked, paid in USDC, quoted by the same lane choice the
 * ticket's quote uses (fee policy v2, `chooseQuote`), and split into what each
 * party takes.
 *
 * - **Ryntra** — the flow's rate as Jupiter's own answer states it applied
 *   (`ryntraFee.basisPoints`, zero where it was not applied).
 * - **Jupiter** — whatever of Jupiter's total is not Ryntra's
 *   (`additionalJupiterFeeBps`).
 * - **The network** — the signature and the priority fee the buyer pays; none
 *   on a gasless order. A quote with no wallet on the `/build` lane states the
 *   signature only: the priority fee is sized when the bytes are assembled for
 *   the person's wallet, up to {@link PRIORITY_CEILING_LAMPORTS} — so the
 *   priority is said as «at the Review, at most …», never as a zero.
 *
 * Their sum is «Разом комісій» — with an unsized priority, a range from the
 * signature alone to the priority's ceiling. Two figures stand beside it and
 * are not added in, because neither is a fee: the price impact of the route
 * (the pools' own fees are inside the route's price), and the deposit a new
 * token account takes, which comes back when the account is closed — where
 * the quote stated it, that figure; else the plain token account's rent «if
 * you hold none of the token yet».
 *
 * Every dollar figure here is an estimate from the quote's moment: the Review
 * before the signature carries the exact amounts, and the receipt what the
 * chain shows. Pure: no clock, no network.
 */

import { additionalJupiterFeeBps, type RyntraServiceFee } from "../swap/service-fee.ts";

export const LAMPORTS_PER_SOL = 1_000_000_000;
/** The highest priority fee a `/build` swap is assembled with (`PRIORITY_FEE_CEILING_LAMPORTS`, `lib/solana/jupiter-build.ts`). */
export const PRIORITY_CEILING_LAMPORTS = 300_000;
/** The rent of a plain 165-byte token account, the estimate a Review starts from (`lib/solana/jupiter-build.ts`). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;
/** Solana's base fee per signature. */
export const SIGNATURE_LAMPORTS = 5_000;
/** The sums a card may quote: the quick sums' own bounds (`lib/spot/quick-trade.ts`). */
export const COST_MIN_USD = 1;
export const COST_MAX_USD = 1_000_000;

/** The figures of a Jupiter quote the cost is read from. */
export type CostOrderFigures = Readonly<{
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  priceImpactPct: string;
  inUsdValue: string | null;
  outUsdValue: string | null;
  totalFeeBasisPoints: number;
  ryntraFee: Pick<RyntraServiceFee, "mechanism" | "basisPoints" | "state">;
  signatureFeeLamports: string;
  priorityFeeLamports: string;
  rentFeeLamports: string;
  gasless: boolean;
  router: string;
  reviewExpiresAt: string;
}>;

/** The lane the quote was priced on (fee policy v2): `/build` states no priority, no deposit and no dollar figures without a wallet. */
export type CostLane = "BUILD" | "ORDER";

export type BuyCost = Readonly<{
  /** The sum the buy was quoted for, in dollars (USDC). */
  usd: number;
  ryntra: Readonly<{ bps: number; usd: number }>;
  jupiter: Readonly<{ bps: number; usd: number }>;
  /**
   * The signature and, where the quote sized it, the priority fee; `usd` null without SOL's price. `priorityKnown`
   * false: the priority is set at the Review — at most `maxLamports` in all on `/build`, whose assembler caps it; no
   * ceiling (null) on `/order`, whose transaction is Jupiter's.
   */
  network: Readonly<{ lamports: number; usd: number | null; priorityKnown: boolean; maxLamports: number | null; maxUsd: number | null }>;
  /** Ryntra, Jupiter and the network together; `usd` null without SOL's price while the network costs something; `maxUsd` with the priority's ceiling where it is not sized yet. */
  total: Readonly<{ usd: number | null; pct: number | null; feesUsd: number; maxUsd: number | null; maxPct: number | null }>;
  /** The route's price impact, per cent; a favourable one is no cost (0); null where Jupiter states none. */
  impactPct: number | null;
  /** A new token account's deposit, returned when the account is closed. `known` false: the plain account's rent, due only if the buyer holds none of the token yet. */
  deposit: Readonly<{ lamports: number; usd: number | null; known: boolean }>;
  /** What the tokens bought are worth at the market's price, as Jupiter states it. */
  receiveUsd: number | null;
  outRaw: string;
  minOutRaw: string;
  router: string;
  /** SOL's price the network's figures were counted at. */
  solUsd: number | null;
  quotedAt: string;
  expiresAt: string;
}>;

const lamportsOf = (text: string): number => {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const usdOfLamports = (lamports: number, solUsd: number | null): number | null => (solUsd === null ? (lamports === 0 ? 0 : null) : (lamports / LAMPORTS_PER_SOL) * solUsd);

const finiteOrNull = (text: string | null): number | null => {
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** A quote's cost, split by who takes what. */
export function buyCostOf(input: Readonly<{ usd: number; order: CostOrderFigures; lane: CostLane; solUsd: number | null; quotedAt: string }>): BuyCost {
  const { usd, order, lane } = input;
  const solUsd = input.solUsd !== null && Number.isFinite(input.solUsd) && input.solUsd > 0 ? input.solUsd : null;
  const ryntraBps = Math.max(0, order.ryntraFee.basisPoints);
  const jupiterBps = additionalJupiterFeeBps(order.totalFeeBasisPoints, order.ryntraFee) ?? 0;
  /*
   * The quote is asked with no wallet: `/build` sizes neither the priority nor the accounts, and `/order` cannot know
   * whether the buyer holds the token's account. A zero from either is «not yet», never «none» — only a figure the
   * quote stated above zero is taken as sized (as `lib/stocks/check.ts` reads a zero network fee).
   */
  const sized = lane === "ORDER";
  const signature = order.gasless ? 0 : lamportsOf(order.signatureFeeLamports) || SIGNATURE_LAMPORTS;
  const priorityKnown = order.gasless || (sized && lamportsOf(order.priorityFeeLamports) > 0);
  const networkLamports = order.gasless ? 0 : signature + (priorityKnown ? lamportsOf(order.priorityFeeLamports) : 0);
  /* Only Ryntra's own `/build` assembly caps the priority; Jupiter's `/order` bytes carry no ceiling Ryntra can promise. */
  const maxLamports = priorityKnown ? networkLamports : sized ? null : signature + PRIORITY_CEILING_LAMPORTS;
  const depositKnown = order.gasless || (sized && lamportsOf(order.rentFeeLamports) > 0);
  const depositLamports = order.gasless ? 0 : depositKnown ? lamportsOf(order.rentFeeLamports) : TOKEN_ACCOUNT_RENT_LAMPORTS;
  const ryntraUsd = (usd * ryntraBps) / 10_000;
  const jupiterUsd = (usd * jupiterBps) / 10_000;
  const networkUsd = usdOfLamports(networkLamports, solUsd);
  const networkMaxUsd = maxLamports === null ? null : usdOfLamports(maxLamports, solUsd);
  const feesUsd = ryntraUsd + jupiterUsd;
  const totalUsd = networkUsd === null ? null : feesUsd + networkUsd;
  const totalMaxUsd = networkMaxUsd === null ? null : feesUsd + networkMaxUsd;
  const pctOf = (value: number | null) => (value === null || usd <= 0 ? null : (value / usd) * 100);
  const impact = finiteOrNull(order.priceImpactPct);
  return {
    usd,
    ryntra: { bps: ryntraBps, usd: ryntraUsd },
    jupiter: { bps: jupiterBps, usd: jupiterUsd },
    network: { lamports: networkLamports, usd: networkUsd, priorityKnown, maxLamports, maxUsd: networkMaxUsd },
    total: { usd: totalUsd, pct: pctOf(totalUsd), feesUsd, maxUsd: totalMaxUsd, maxPct: pctOf(totalMaxUsd) },
    impactPct: impact === null ? null : Math.max(0, impact),
    deposit: { lamports: depositLamports, usd: usdOfLamports(depositLamports, solUsd), known: depositKnown },
    receiveUsd: finiteOrNull(order.outUsdValue),
    outRaw: order.outAmountRaw,
    minOutRaw: order.minReceivedRaw,
    router: order.router,
    solUsd,
    quotedAt: input.quotedAt,
    expiresAt: order.reviewExpiresAt,
  };
}

/** A sum the card may quote, in whole cents, or null. */
export function costSumOf(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < COST_MIN_USD || number > COST_MAX_USD) return null;
  return Math.round(number * 100) / 100;
}

/** USDC base units for a dollar sum (six decimals). */
export function usdcRawOf(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}
