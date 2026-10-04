/**
 * What a wallet needs before it can buy — the pure half of «Поповнити» and
 * of «Простий»'s empty states.
 *
 * Two things, never confused on a beginner's screen: **USDC**, the dollars a
 * purchase spends (from $1), and **a little SOL**, what the network
 * charges for every transaction and, once for each company the wallet does
 * not hold yet, the reserve that opens the token's account in the wallet.
 *
 * **Why a beginner still needs SOL here.** Jupiter pays the gas only for
 * a taker below 0.01 SOL, from about $10, and only on an order with no
 * referral or payer parameters; it does so by adding its own fee payer as a
 * second signer (dev.jup.ag «Gasless», read 2026-09-24). Every purchase here
 * carries the product's referral fee, and the owner-effect firewall refuses a
 * fee payer other than the person's own wallet (`lib/solana/swap-transaction
 * -check.ts`, `lib/solana/swap-effect-firewall.ts`). The first purchase
 * without gas is therefore not proven on this path, and a wallet without SOL
 * is told what is missing and where to get it — never sent into a Review the
 * network would refuse.
 *
 * No fetch, no clock, no React: the pages hand the wallet's read in.
 */

import { NATIVE_SOL_FEE_RESERVE_LAMPORTS } from "../../../lib/solana/send-inventory.ts";
import { NATIVE_SOL_DECIMALS, SOLANA_MAINNET_USDC_MINT } from "../../../lib/solana/send-kinds.ts";
import type { WalletHolding } from "../wallet-view-model.ts";
import { MIN_BUY_USD } from "./company-model.ts";

/**
 * The account a first purchase of a company opens in the wallet. Measured on
 * 2026-09-14: every xStock opens a Token-2022 account of 179 bytes holding
 * 1,559,560 lamports under the network's rent (`lib/solana/rent.ts`); a
 * pre-IPO token's extensions add a few bytes. Rounded up, so the floor never
 * sends a wallet into a Review the network would refuse.
 */
export const NEW_TOKEN_ACCOUNT_LAMPORTS = 2_000_000n;

/**
 * The SOL one purchase needs: the product's own fee reserve (the ceiling
 * Send and Spot already keep back for a transaction's fee), plus the new
 * account for a company the wallet does not hold yet.
 */
export const PURCHASE_FEE_LAMPORTS = NATIVE_SOL_FEE_RESERVE_LAMPORTS;
export const FIRST_PURCHASE_LAMPORTS = PURCHASE_FEE_LAMPORTS + NEW_TOKEN_ACCOUNT_LAMPORTS;

/** What the screens suggest: 0.01 SOL — four first purchases of new companies, and many more of ones already held. */
export const SUGGESTED_SOL_LAMPORTS = 10_000_000n;

const LAMPORTS_PER_SOL = 10n ** BigInt(NATIVE_SOL_DECIMALS);

export type Funds = Readonly<{
  /** USDC in dollars; null when the read cannot say. */
  usdc: number | null;
  /** SOL in lamports; null when it was not read. */
  solLamports: bigint | null;
  /** SOL's price in dollars, when the read carried one. */
  solUsd: number | null;
  /** The wallet holds a company already — its next purchase of one needs no new account. */
  ownsCompany: boolean;
}>;

/** Nothing known yet. */
export const UNKNOWN_FUNDS: Funds = { usdc: null, solLamports: null, solUsd: null, ownsCompany: false };

function positiveNumber(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The wallet's USDC and SOL from its holdings read. A missing USDC row is
 * zero only when the read is complete — a partial read that did not reach the
 * token program holding it says nothing about it. A missing SOL row means the
 * read did not answer: the route always sends it, zero included.
 */
export function fundsOf(holdings: readonly WalletHolding[] | null, complete: boolean): Funds {
  if (!holdings) return UNKNOWN_FUNDS;
  const usdcRow = holdings.find((row) => row.kind !== "NATIVE_SOL" && row.mint === SOLANA_MAINNET_USDC_MINT) ?? null;
  const solRow = holdings.find((row) => row.kind === "NATIVE_SOL") ?? null;
  const usdc = usdcRow ? Number(usdcRow.amountRaw) / 10 ** usdcRow.decimals : complete ? 0 : null;
  return {
    usdc: usdc !== null && Number.isFinite(usdc) ? usdc : null,
    solLamports: solRow && /^\d+$/.test(solRow.amountRaw) ? BigInt(solRow.amountRaw) : null,
    solUsd: positiveNumber(solRow?.catalog?.usdPrice),
    ownsCompany: holdings.some((row) => row.catalog?.category === "stock" && /^\d+$/.test(row.amountRaw) && BigInt(row.amountRaw) > 0n),
  };
}

/** Whether the wallet's SOL cannot carry the next purchase: its fee, and for a company it does not hold yet, the new account too. */
export function solShort(lamports: bigint, holdsToken: boolean): boolean {
  return lamports < (holdsToken ? PURCHASE_FEE_LAMPORTS : FIRST_PURCHASE_LAMPORTS);
}

/**
 * The one thing that stands between this wallet and a purchase, in the order
 * a beginner meets them: dollars first (nothing can be bought without them),
 * then the network's SOL, then nothing.
 */
export type FundingNeed = "unknown" | "usdc" | "sol" | "ready";

export function fundingNeed(funds: Funds): FundingNeed {
  if (funds.usdc === null || funds.solLamports === null) return "unknown";
  if (funds.usdc < MIN_BUY_USD) return "usdc";
  if (solShort(funds.solLamports, funds.ownsCompany)) return "sol";
  return "ready";
}

/** Whether each of the two is there — the top-up's two lines. */
export function fundsReady(funds: Funds): Readonly<{ usdc: boolean | null; sol: boolean | null }> {
  return {
    usdc: funds.usdc === null ? null : funds.usdc >= MIN_BUY_USD,
    sol: funds.solLamports === null ? null : !solShort(funds.solLamports, funds.ownsCompany),
  };
}

/** SOL as a person reads it: «0,12», «0,0021», «0» — four decimals at most, never a tiny balance printed as zero. */
export function solAmount(lamports: bigint, numberLocale: string): string {
  const value = Number(lamports) / Number(LAMPORTS_PER_SOL);
  if (value > 0 && value < 0.0001) return `< ${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 4 }).format(0.0001)}`;
  return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 4 }).format(value);
}

/** The suggested SOL in dollars, to the whole dollar and never below $1 — «≈ $2»; null without a price. */
export function suggestedSolUsd(solUsd: number | null): number | null {
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  return Math.max(1, Math.round((Number(SUGGESTED_SOL_LAMPORTS) / Number(LAMPORTS_PER_SOL)) * solUsd));
}

/**
 * Where «Продовжити купівлю» goes back to: a page of the cabinet the person
 * came from, never anything else — a path under `/app/`, no scheme, no host,
 * no protocol-relative trick.
 */
export function returnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  if (!/^\/app\/[A-Za-z0-9._~\-/]*$/.test(value)) return null;
  if (value.includes("//") || value.includes("/..")) return null;
  return value;
}
