/**
 * «Перевірка», counted once — on the server (contract 1.20.0).
 *
 * The four lines a person reads before the signature — **Спишеться ·
 * Отримаєш · Усі витрати · Що це** — and the account's reserve, for a company
 * bought with USDC and for a company sold into USDC. The quote route counts
 * them on its live quote, the order route on the exact order the wallet will
 * sign, and both answer them as `check`; the web and the phone draw what the
 * server counted and count nothing themselves, so the same sum shows the same
 * figures on both.
 *
 * The rules are the ones the web counted by until 1.20.0, unchanged:
 *
 * - **Спишеться / Отримаєш** — the raw amounts the venue states, in the unit
 *   the wallet shows: USDC as dollars, a company's token through its Scaled
 *   UI Amount multiplier (shares for a listed company, tokens for a private
 *   one); what arrives, and the least that may (the chain's minimum).
 * - **Усі витрати** — the venue's own dollar values of what leaves and what
 *   arrives, whose difference already holds every fee inside the route
 *   (Ryntra's too), the issuer's fee on a token whose mint withholds one and
 *   the price impact; never less than the stated fees and impact; and the
 *   network's fee in SOL at SOL's price. The sum they are counted on is the
 *   purchase's dollars, or the venue's value of what a sale gives. The issuer's
 *   fee is said again on its own — «з них комісія емітента 3 % ≈ $0,03» —
 *   the share of that sum the mint withholds, at the rate the chain states.
 *   Without SOL's price the figure is unknown — never a smaller one.
 * - **The reserve** — the one-time rent an account the transaction opens keeps
 *   in the wallet: never a cost, a line of its own under «Усі витрати», and
 *   said before the four lines when it is more than the purchase. Stated on
 *   the order only: the figure the simulation proved; the venue's estimate on
 *   a quote is short of every Token-2022 account.
 * - **Що це** — the one line of truth about the token (`truth.ts`) in both
 *   languages, and under it the issuer's event said to a buyer (the IPO and
 *   conversion watch) or, on a private company's sale, «Продати може не
 *   вийти».
 *
 * Pure and client-safe: the facts come in — the order, the company as the
 * universe states it, SOL's price — and the lines go out.
 */

import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import type { StockIssuerId } from "./representations.ts";
import { truthLine } from "./truth.ts";
import { scaledAmountString } from "./units.ts";

/** USDC's decimals on Solana — the dollars a purchase is paid with and a sale is paid in. */
export const USDC_DECIMALS = 6;

/** A private company's sale, said before any sum and again in «Що це» — the documentation's own words. */
export const SALE_MAY_FAIL = {
  en: "Selling may not be possible: the issuer promises no liquidity.",
  uk: "Продати може не вийти: емітент ліквідності не обіцяє.",
} as const;

/* ------------------------------------------------------------ the units */

/**
 * The amount a person gets, in the unit the wallet shows — shares for a
 * listed company, tokens for a private one — from the raw base amount the
 * venue states. A mint with the Scaled UI Amount extension counts its
 * scaled unit, which is the one priced as a share (`units.ts`).
 */
export function unitsFromRaw(raw: string | null | undefined, decimals: number | null, multiplier: number | null): number | null {
  if (!raw || !/^\d+$/.test(raw) || decimals === null) return null;
  const value = Number(scaledAmountString(BigInt(raw), decimals, multiplier !== null && multiplier > 0 ? multiplier : 1, 8));
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------ «Усі витрати» */

/** The signature fee of one Solana transaction, the least a purchase costs the network. */
export const BASE_SIGNATURE_LAMPORTS = 5_000n;

export type BuyCostInput = Readonly<{
  spendUsd: number;
  /** The venue's own dollar value of what leaves and what arrives. */
  inUsdValue: string | null;
  outUsdValue: string | null;
  /** Every fee inside the quote, Ryntra's included, basis points. */
  totalFeeBasisPoints: number | null;
  /** The venue's stated price impact, per cent. */
  priceImpactPct: string | null;
  signatureFeeLamports: string | null;
  priorityFeeLamports: string | null;
  /** The reserve a new token account keeps, when the purchase opens one. */
  rentFeeLamports: string | null;
  solUsd: number | null;
  /**
   * The fee the token's own mint withholds on the transfer to the buyer, basis
   * points, as the chain states it — a PreStocks token's 1 %. Absent or 0
   * where the mint charges none. The venue quotes what arrives after it, so
   * it is already inside the two dollar values: it only raises the floor, and
   * «Перевірка» says it on its own line.
   */
  issuerFeeBasisPoints?: number | null;
}>;

export type BuyCosts = Readonly<{
  /** Everything the purchase costs beyond what it buys, in dollars. */
  totalUsd: number;
  /** The one-time reserve that opens the token's account in the wallet, in dollars; null when there is none or no SOL price. */
  accountUsd: number | null;
  /** Of `totalUsd`, the issuer's fee on the transfer, in dollars; null where the mint charges none. */
  issuerFeeUsd: number | null;
}>;

const numeric = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const lamports = (value: string | null | undefined): bigint => (value && /^\d+$/.test(value) ? BigInt(value) : 0n);

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * «Усі витрати» — what the purchase costs beyond what it buys:
 * the venue's own dollar values of what leaves and what arrives, whose
 * difference already holds every fee inside the route, Ryntra's too, the
 * issuer's fee on a token whose mint withholds one, and the price impact;
 * never less than the stated fees and impact (a price that moved in the
 * person's favour is not a negative cost); and the network's fee in SOL at
 * SOL's price. The reserve that opens a new token account is said apart: it
 * stays in the wallet's account rather than going to anyone. The issuer's
 * fee is also given alone — «з них комісія емітента 1% ≈ $0,10» — the share
 * of the sum the mint withholds.
 */
export function buyCosts(input: BuyCostInput): BuyCosts {
  const spend = Math.max(0, input.spendUsd);
  const issuerBps = Math.max(0, input.issuerFeeBasisPoints ?? 0);
  const issuerFeeUsd = issuerBps > 0 ? (spend * issuerBps) / 10_000 : null;
  const stated = (spend * (Math.max(0, input.totalFeeBasisPoints ?? 0) + issuerBps)) / 10_000 + (spend * Math.max(0, numeric(input.priceImpactPct) ?? 0)) / 100;
  const inUsd = numeric(input.inUsdValue);
  const outUsd = numeric(input.outUsdValue);
  const route = inUsd !== null && outUsd !== null && inUsd > 0 && outUsd >= 0 ? inUsd - outUsd : null;
  const trade = route !== null && route > stated ? route : stated;
  const networkLamports = lamports(input.signatureFeeLamports) + lamports(input.priorityFeeLamports);
  const fee = networkLamports > 0n ? networkLamports : BASE_SIGNATURE_LAMPORTS;
  const solUsd = input.solUsd !== null && Number.isFinite(input.solUsd) && input.solUsd > 0 ? input.solUsd : null;
  const network = solUsd === null ? 0 : (Number(fee) / 1e9) * solUsd;
  const rent = lamports(input.rentFeeLamports);
  return { totalUsd: trade + network, accountUsd: rent > 0n && solUsd !== null ? (Number(rent) / 1e9) * solUsd : null, issuerFeeUsd };
}

/**
 * Whether the one-time reserve that opens the token's account is more than the
 * purchase itself — then «Перевірка» says so before anything else. The
 * reserve stays in the person's wallet; it is never a cost.
 */
export function reserveOverPurchase(accountUsd: number | null, spendUsd: number): boolean {
  return accountUsd !== null && Number.isFinite(accountUsd) && Number.isFinite(spendUsd) && accountUsd > spendUsd;
}

/* ------------------------------------------------------------ the four lines */

export type CheckSide = "buy" | "sell";
/** `quote`: the live quote's estimate, before a Review; `order`: the exact order the wallet signs. */
export type CheckBasis = "quote" | "order";
/** The unit an amount is in: USDC counted as dollars, or the company's share or token as the wallet shows it. */
export type CheckUnit = "usdc" | "share" | "token";
export type CheckWords = Readonly<{ en: string; uk: string }>;

/** A company bought with USDC, or sold into it — which side, and which mint is the company's. */
export function checkSide(inputMint: string, outputMint: string): Readonly<{ side: CheckSide; stockMint: string }> | null {
  if (inputMint === outputMint) return null;
  if (inputMint === SOLANA_MAINNET_USDC_MINT) return { side: "buy", stockMint: outputMint };
  if (outputMint === SOLANA_MAINNET_USDC_MINT) return { side: "sell", stockMint: inputMint };
  return null;
}

/** The company as the check says it: the universe's row with the chain's decimals and multiplier, read for this answer. */
export type CheckCompany = Readonly<{
  mint: string;
  /** The token's symbol — the venue's key. */
  symbol: string;
  /** The company as a person names it («Apple», «OpenAI»). */
  name: string;
  issuer: StockIssuerId;
  /** What one unit of the token is: a listed company's share, or a private company's token. */
  unit: "share" | "token";
  /** A private company's token (pre-IPO, through PreStocks): its «Що це» is said with care. */
  privateCompany: boolean;
  decimals: number;
  /** The Scaled UI Amount multiplier in force; null where the mint carries none. */
  multiplier: number | null;
  /** The fee the mint withholds on every transfer, basis points, as the chain states it now; null where it charges none. */
  issuerFeeBps: number | null;
}>;

/** The order's figures the lines are counted from — the quote's or the executable order's, as the venue and the simulation state them. */
export type CheckOrderFigures = Readonly<{
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  inUsdValue: string | null;
  outUsdValue: string | null;
  totalFeeBasisPoints: number | null;
  priceImpactPct: string | null;
  signatureFeeLamports: string | null;
  priorityFeeLamports: string | null;
  /** On the order route, the rent the simulation proved; the check reads it only there. */
  rentFeeLamports: string | null;
}>;

export type SwapCheck = Readonly<{
  side: CheckSide;
  basis: CheckBasis;
  company: Readonly<{ mint: string; symbol: string; name: string; issuer: StockIssuerId; unit: "share" | "token"; privateCompany: boolean; decimals: number; multiplier: number | null }>;
  /** «Спишеться»: what leaves the wallet — `usd` the purchase's dollars, or the venue's value of what a sale gives. */
  spend: Readonly<{ mint: string; unit: CheckUnit; amount: number | null; usd: number | null }>;
  /** «Отримаєш»: what arrives, about and at least — `usd` the venue's value of it, or the sale's dollars. */
  get: Readonly<{ mint: string; unit: CheckUnit; amount: number | null; atLeast: number | null; usd: number | null }>;
  /** «Усі витрати» in dollars, with the issuer's fee inside it said alone; null when a figure it needs is unknown. */
  costs: Readonly<{ usd: number; issuerFee: Readonly<{ basisPoints: number; usd: number }> | null }> | null;
  /** The account's one-time reserve, on the order only; null where the transaction opens no account. */
  reserve: Readonly<{ lamports: string; usd: number | null; first: boolean }> | null;
  /** «Що це»: the truth in both languages, the line under it, and whether it is said with care. */
  what: Readonly<{ truth: CheckWords; note: (CheckWords & Readonly<{ kind: "issuer-event" | "sale-may-fail" }>) | null; caution: boolean }>;
  /** SOL's price the network's fee and the reserve were counted at, and when it was read. */
  sol: Readonly<{ usd: number | null; observedAt: string | null }>;
}>;

export type SwapCheckInput = Readonly<{
  side: CheckSide;
  basis: CheckBasis;
  order: CheckOrderFigures;
  company: CheckCompany;
  solUsd: number | null;
  solObservedAt: string | null;
  /** A purchase only: the issuer's event said to a buyer (the IPO and conversion watch), both languages; null for none. */
  event?: CheckWords | null;
}>;

/** The four lines and the reserve, from the order and the facts — the rules the web counted by, unchanged. */
export function buildSwapCheck(input: SwapCheckInput): SwapCheck {
  const { side, basis, order, company } = input;
  const solUsd = positive(input.solUsd) ? input.solUsd : null;
  const shares = (raw: string) => unitsFromRaw(raw, company.decimals, company.multiplier);
  const usdc = (raw: string) => unitsFromRaw(raw, USDC_DECIMALS, null);
  const buying = side === "buy";

  const paid = buying ? usdc(order.inAmountRaw) : null;
  const received = buying ? null : usdc(order.outAmountRaw);
  const spend: SwapCheck["spend"] = buying
    ? { mint: SOLANA_MAINNET_USDC_MINT, unit: "usdc", amount: paid, usd: paid }
    : { mint: company.mint, unit: company.unit, amount: shares(order.inAmountRaw), usd: numeric(order.inUsdValue) };
  const get: SwapCheck["get"] = buying
    ? { mint: company.mint, unit: company.unit, amount: shares(order.outAmountRaw), atLeast: shares(order.minReceivedRaw), usd: numeric(order.outUsdValue) }
    : { mint: SOLANA_MAINNET_USDC_MINT, unit: "usdc", amount: received, atLeast: usdc(order.minReceivedRaw), usd: received };

  /* «Усі витрати» on the sum the web counted them on: the purchase's dollars, the venue's value of what a sale gives. */
  const fee = positive(company.issuerFeeBps) ? company.issuerFeeBps : null;
  const counted =
    spend.usd === null || solUsd === null
      ? null
      : buyCosts({
          spendUsd: spend.usd,
          inUsdValue: order.inUsdValue,
          outUsdValue: order.outUsdValue,
          totalFeeBasisPoints: order.totalFeeBasisPoints,
          priceImpactPct: order.priceImpactPct,
          signatureFeeLamports: order.signatureFeeLamports,
          priorityFeeLamports: order.priorityFeeLamports,
          rentFeeLamports: null,
          solUsd,
          issuerFeeBasisPoints: fee,
        });
  const costs: SwapCheck["costs"] = counted ? { usd: counted.totalUsd, issuerFee: fee !== null && counted.issuerFeeUsd !== null ? { basisPoints: fee, usd: counted.issuerFeeUsd } : null } : null;

  /* The reserve the simulation proved, on the order only; said first when it is more than the purchase. */
  const rent = basis === "order" ? lamports(order.rentFeeLamports) : 0n;
  const reserveUsd = rent > 0n && solUsd !== null ? (Number(rent) / 1e9) * solUsd : null;
  const reserve: SwapCheck["reserve"] = rent > 0n ? { lamports: rent.toString(), usd: reserveUsd, first: buying && paid !== null && reserveOverPurchase(reserveUsd, paid) } : null;

  const truth = { en: truthLine(company.issuer, company.name, "en", fee), uk: truthLine(company.issuer, company.name, "uk", fee) };
  const note: SwapCheck["what"]["note"] = buying
    ? input.event
      ? { kind: "issuer-event", en: input.event.en, uk: input.event.uk }
      : null
    : company.privateCompany
      ? { kind: "sale-may-fail", en: SALE_MAY_FAIL.en, uk: SALE_MAY_FAIL.uk }
      : null;

  return {
    side,
    basis,
    company: { mint: company.mint, symbol: company.symbol, name: company.name, issuer: company.issuer, unit: company.unit, privateCompany: company.privateCompany, decimals: company.decimals, multiplier: company.multiplier },
    spend,
    get,
    costs,
    reserve,
    what: { truth, note, caution: company.privateCompany },
    sol: { usd: solUsd, observedAt: solUsd === null ? null : input.solObservedAt },
  };
}
