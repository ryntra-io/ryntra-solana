/**
 * The Exchange's quotes on one network, Solana:
 * Jupiter, the aggregator, first; Manifest, the order book alone, second — one
 * aggregator and one direct book, compared.
 *
 * Both carry Ryntra's fee as the swap lane does, by fee policy v2: the flow's
 * tariff (`lib/core/fee-policy.ts`), paid into the fee wallet inside the swap. The
 * Jupiter source asks the lane's own choice (`chooseQuote`), so the Exchange's
 * Jupiter price is the Swap card's price to the unit. Manifest is asked through
 * Jupiter's `/build` held to `dexes=Manifest` — Manifest's own book, routed by
 * the program that reads it (label `Manifest`, program `MNFSTqtC…`), and the
 * one path where the fee wallet is paid in the same transaction.
 *
 * The world is injected (`SolanaSourceDeps`), so the tests run on recorded
 * answers; the server wires the real calls in `../quotes.server.ts`. Relative
 * imports only.
 */

import type { Amount } from "@ryntra/core/adapters";

import { FEE_POLICY_V2, type FeeFlow } from "../../core/fee-policy.ts";
import type { JupiterBuildFee, JupiterBuildRequest, JupiterBuildResult } from "../../solana/jupiter-build.ts";
import type { JupiterOrderQuote } from "../../solana/quotes.ts";
import { SOLANA_NATIVE_SOL_MINT } from "../../swap/catalog.ts";
import type { RyntraServiceFee } from "../../swap/service-fee.ts";
import { amountOf, feesOf, quoteId, type ExchangeFeeRoute, type ExchangeQuote, type ExchangeQuoteRequest, type ExchangeQuoteSource, type ExchangeRefusal, type ExchangeSourceAnswer } from "../contract.ts";
import { EXCHANGE_FEE_DESTINATION } from "../fees.ts";

/** One Solana confirmation, near enough: the same-network delivery the screen shows, never a promise. */
export const SOLANA_DELIVERY_MS = 2_000;

/** Jupiter's label for Manifest's program `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms` (`/program-id-to-label`, 2026-10-15). */
export const MANIFEST_DEX_LABEL = "Manifest";

type FailureCode = "NO_ROUTE" | "RATE_LIMITED" | string;

export type SolanaSourceDeps = Readonly<{
  /** The lane's own choice for the Swap card: fee policy v2, `/build` or `/order`. */
  chooseQuote: (request: Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>) => Promise<
    Readonly<{ ok: true; order: JupiterOrderQuote; flow: FeeFlow; lane: "BUILD" | "ORDER" }> | Readonly<{ ok: false; failure: Readonly<{ code: FailureCode; reason: string }> }>
  >;
  /** The flow of a pair, as fee policy v2 reads it. */
  flowOf: (inputMint: string, outputMint: string) => Promise<FeeFlow>;
  /** The flow's `/build` fee, or why it carries none here. */
  buildFee: (flow: FeeFlow, inputMint: string, outputMint: string) => Promise<Readonly<{ ok: true; fee: JupiterBuildFee | null }> | Readonly<{ ok: false; reason: string }>>;
  fetchBuild: (request: JupiterBuildRequest) => Promise<JupiterBuildResult>;
  /** Whether the operator has put the lane back on «as now» — `/order` with the referral, where Manifest carries no fee. */
  policy: "v2" | "as-now";
}>;

const sameNetwork = (request: ExchangeQuoteRequest): boolean => request.from.network === "solana" && request.to.network === "solana" && request.from.asset !== request.to.asset;

const refuse = (executor: string, code: ExchangeRefusal["code"], reason: string): ExchangeSourceAnswer => ({ ok: false, refusal: { executor, code, reason } });

const refusalCode = (code: FailureCode): ExchangeRefusal["code"] => (code === "NO_ROUTE" ? "NO_ROUTE" : code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE");

/** Decimals of an asset the quote names: one of the two sides, or SOL. Null for anything else — never guessed. */
function decimalsOf(asset: string, request: ExchangeQuoteRequest): number | null {
  if (asset === request.from.asset) return request.from.decimals;
  if (asset === request.to.asset) return request.to.decimals;
  return asset === SOLANA_NATIVE_SOL_MINT ? 9 : null;
}

/**
 * Ryntra's fee and, on a referral, Jupiter's fifth of it — split by who takes it.
 *
 * The amount is the one Jupiter or the program states. Where `/build` takes the
 * fee from the output it states only the rate, and the amount follows from the
 * output it quotes: `out` is what arrives after the fee, so the fee is
 * `out × bps / (10 000 − bps)`.
 */
export function feeSplit(fee: RyntraServiceFee, quote: Pick<JupiterOrderQuote, "inputMint" | "outputMint" | "inAmountRaw" | "outAmountRaw">, request: ExchangeQuoteRequest): Readonly<{ ryntra: Amount | null; venue: Amount | null }> {
  if (fee.state !== "QUOTED" || fee.basisPoints <= 0 || !fee.asset) return { ryntra: null, venue: null };
  const decimals = fee.decimals ?? decimalsOf(fee.asset, request);
  if (decimals === null) return { ryntra: null, venue: null };
  const bps = BigInt(fee.basisPoints);
  let whole: bigint | null = fee.amountRaw !== null ? BigInt(fee.amountRaw) : null;
  if (whole === null && fee.asset === quote.outputMint) whole = (BigInt(quote.outAmountRaw) * bps) / (10_000n - bps);
  if (whole === null && fee.asset === quote.inputMint) whole = (BigInt(quote.inAmountRaw) * bps) / 10_000n;
  if (whole === null) return { ryntra: null, venue: null };
  const kept = fee.providerRetainedPercent ? (whole * BigInt(Math.round(fee.providerRetainedPercent))) / 100n : 0n;
  return { ryntra: amountOf(whole - kept, fee.asset, decimals), venue: kept > 0n ? amountOf(kept, fee.asset, decimals) : null };
}

/** The lane's Jupiter quote as the core's quote. Exported for the tests. */
export function exchangeQuoteFromJupiter(executor: string, request: ExchangeQuoteRequest, quote: JupiterOrderQuote): ExchangeQuote {
  const split = feeSplit(quote.ryntraFee, quote, request);
  /* The signature and priority fees the wallet pays on top; a gasless order states another payer and costs the wallet nothing. */
  const payerIsWallet = (payer: string | null) => payer === null || payer === quote.taker;
  const lamports =
    (payerIsWallet(quote.signatureFeePayer) ? BigInt(quote.signatureFeeLamports) : 0n) + (payerIsWallet(quote.priorityFeePayer) ? BigInt(quote.priorityFeeLamports) : 0n);
  const venues = [...new Set(quote.route.map((hop) => hop.label))];
  const at = Date.parse(quote.observedAt);
  return {
    id: quoteId(executor, request.intentId),
    executor,
    delivery_ms: SOLANA_DELIVERY_MS,
    quote: {
      intent_id: request.intentId,
      out_expected: amountOf(quote.outAmountRaw, request.to.asset, request.to.decimals),
      out_min: amountOf(quote.minReceivedRaw, request.to.asset, request.to.decimals),
      fees: feesOf({ venue: split.venue, builder: null, ryntra: split.ryntra, gas: lamports > 0n ? amountOf(lamports, SOLANA_NATIVE_SOL_MINT, 9) : null }),
      route: `${executor} · ${venues.filter((venue) => venue !== executor).join(" → ") || "order book"}`,
      at,
      expires_at: Date.parse(quote.reviewExpiresAt),
    },
  };
}

function flowFeeRoute(executor: "Jupiter" | "Manifest", flow: FeeFlow, lane: "BUILD" | "ORDER", configured: boolean): ExchangeFeeRoute {
  return {
    executor,
    parameter: lane === "BUILD" ? "platformFeeBps + feeAccount" : "referralAccount + referralFee",
    bps: FEE_POLICY_V2[flow].bps,
    paidTo: EXCHANGE_FEE_DESTINATION[executor],
    configured,
  };
}

export function jupiterSource(deps: SolanaSourceDeps): ExchangeQuoteSource {
  return {
    executor: "Jupiter",
    serves: sameNetwork,
    async quote(request) {
      const result = await deps.chooseQuote({ inputMint: request.from.asset, outputMint: request.to.asset, amountRaw: request.amountRaw });
      if (!result.ok) return refuse("Jupiter", refusalCode(result.failure.code), result.failure.reason);
      const quote = exchangeQuoteFromJupiter("Jupiter", request, result.order);
      const fee = result.order.ryntraFee;
      return { ok: true, quote, fee: flowFeeRoute("Jupiter", result.flow, result.lane, fee.state === "QUOTED" || fee.state === "NONE") };
    },
  };
}

export function manifestSource(deps: SolanaSourceDeps): ExchangeQuoteSource {
  return {
    executor: "Manifest",
    serves: sameNetwork,
    async quote(request) {
      /* Under «as now» every swap is `/order` with the referral; `/build` would carry no fee of Ryntra's, so Manifest is not asked. */
      if (deps.policy === "as-now") return refuse("Manifest", "FEE_NOT_CARRIED", "The swap lane runs «as now», where only Jupiter's referral carries Ryntra's fee.");
      const flow = await deps.flowOf(request.from.asset, request.to.asset);
      const rule = FEE_POLICY_V2[flow];
      if (rule.bps > 0 && rule.lane !== "BUILD") return refuse("Manifest", "FEE_NOT_CARRIED", "This pair's fee travels by Jupiter's referral, which the order book alone does not carry.");
      const fee = rule.bps > 0 ? await deps.buildFee(flow, request.from.asset, request.to.asset) : ({ ok: true, fee: null } as const);
      if (!fee.ok) return refuse("Manifest", "FEE_NOT_CARRIED", fee.reason);
      const build = await deps.fetchBuild({ inputMint: request.from.asset, outputMint: request.to.asset, amountRaw: request.amountRaw, taker: null, fee: fee.fee, dexes: [MANIFEST_DEX_LABEL] });
      if (!build.ok) return refuse("Manifest", refusalCode(build.code), build.reason);
      const answer = build.answer.quote;
      /* `dexes` is a request; the answer is checked. A route through anything but the book is not Manifest's price. */
      if (answer.route.length === 0 || answer.route.some((hop) => hop.label !== MANIFEST_DEX_LABEL)) return refuse("Manifest", "NO_ROUTE", "Manifest's book has no route for this pair at this amount.");
      return { ok: true, quote: exchangeQuoteFromJupiter("Manifest", request, answer), fee: flowFeeRoute("Manifest", flow, "BUILD", true) };
    },
  };
}
