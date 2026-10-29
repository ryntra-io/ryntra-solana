/**
 * Mayan price API — the read-only quote boundary of the cross-chain swap lane.
 *
 * Unified Swap V1, since 2026-09-07: Mayan is the single cross-asset provider.
 * This module asks `price-api.mayan.finance/v3/quote` and turns the answer into
 * the one shape the card, the plan route and the receipt all speak. It builds
 * nothing, signs nothing and never sees a wallet; every network call takes an
 * injected `fetchImpl` so tests run against a recorded fixture, not the
 * internet.
 *
 * Two of Mayan's mechanisms carry V1, and each is tied to a direction on
 * purpose:
 *
 * - **Swift** for Solana-origin. The SDK builds a Swift order with no extra
 *   signer, so the server can assemble the transaction and the person's wallet
 *   is the only key that ever touches it — the same custody line Send, Swap and
 *   Bridge already hold. Fast MCTP from Solana needs a throwaway keypair the
 *   SDK generates for Circle's message account; a key this process would have
 *   to create and sign with is exactly what "nothing here holds or creates a
 *   Solana key" forbids, so from Solana it is not offered.
 * - **Fast MCTP** for EVM-origin: Circle CCTP v2 burn on Base or Ethereum, a
 *   Mayan relayer mints and swaps on Solana. The only signature is the EVM
 *   wallet's.
 *
 * Standard MCTP (15–20 minutes) and the Wormhole route are read but never
 * chosen: the first is a different promise about time, the second lands
 * wrapped assets.
 */

import { z } from "zod";

import type { CrossSwapTuple, SwapNetwork } from "../swap/catalog.ts";
import { crossSwapQuoteMaterialChange, type CrossSwapQuote } from "../swap/cross-swap-quote.ts";
import {
  serviceFeeNotApplied,
  serviceFeeQuoted,
  serviceFeeUnconfigured,
  type RyntraServiceFee,
} from "../swap/service-fee.ts";

/* The cross-swap quote shape and its material-change test now live beside the
   catalog, because a second provider needs them too. Re-exported here so
   every existing importer of this module keeps working unchanged. */
export { crossSwapQuoteMaterialChange, type CrossSwapQuote };

export const MAYAN_PRICE_API_ORIGIN = "https://price-api.mayan.finance";
export const MAYAN_QUOTE_PATH = "/v3/quote";
/**
 * The SDK version the quote endpoint was read against. Mayan answers HTTP 406
 * to anything older than 13 and hides Swift v2 from it; pin what was verified.
 */
export const MAYAN_SDK_VERSION = "15_2_2";
export const MAYAN_NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
export const MAYAN_ROUTE_TYPES = ["SWIFT", "FAST_MCTP"] as const;
export type MayanRouteType = (typeof MAYAN_ROUTE_TYPES)[number];

/**
 * The networks Mayan serves for this product — three of the catalog's four.
 *
 * Robinhood Chain is deliberately absent and the type says so rather than the
 * map quietly answering `undefined`. Mayan's own token endpoint returns HTTP
 * 500 for `robinhood`, `robinhoodchain` and `rhc` while returning 200 for
 * `base` and `arbitrum` (read 2026-09-09): the chain is not served, and a URL
 * built with `toChain=undefined` would ask a question Mayan cannot answer and
 * report the failure as if the market were unavailable. Pairs that touch chain
 * 4663 belong to Relay, and the classifier routes them there by tuple.
 */
/*
 * Named outright rather than derived by exclusion.
 *
 * It was `Exclude<SwapNetwork, "robinhood">`, which was the same set while this
 * product had four networks — and quietly became a claim that Mayan serves
 * Arbitrum, Optimism, Polygon and BNB Chain the moment those were added. It
 * serves the three below and nothing else here, and a rail's coverage is not a
 * function of which networks some other rail has gained.
 */
export type MayanServedNetwork = "solana" | "base" | "ethereum";

export const MAYAN_CHAIN_NAME: Readonly<Record<MayanServedNetwork, "solana" | "base" | "ethereum">> = {
  solana: "solana",
  base: "base",
  ethereum: "ethereum",
};

export function isMayanServedNetwork(network: SwapNetwork): network is MayanServedNetwork {
  return network in MAYAN_CHAIN_NAME;
}

/** What the quote endpoint is asked. Amounts are human decimals, as Mayan takes them. */
export type MayanQuoteRequest = Readonly<{
  fromChain: MayanServedNetwork;
  /** Mint or contract; the native coin is Mayan's zero address. */
  fromToken: string;
  toChain: MayanServedNetwork;
  toToken: string;
  amountIn: string;
  slippageBps?: number | "auto";
  /** Lets Mayan check whether the Solana destination token account exists. */
  destinationAddress?: string;
  /**
   * Ryntra's referrer address — **always a Solana address**, whatever the source
   * and destination chains, which is Mayan's own documented rule. The matching
   * `referrerAddresses` must be handed to the SDK at build time or the fee is
   * quoted and never collected; `build.server.ts` carries that half.
   */
  referrer?: string;
  referrerBps?: number;
}>;

const TokenSchema = z
  .object({
    symbol: z.string(),
    contract: z.string(),
    decimals: z.number().int().nonnegative(),
    mint: z.string().optional(),
    wChainId: z.number().optional(),
    chainId: z.number().optional(),
  })
  .passthrough();

const INTEGER = /^[0-9]+$/;

export const MayanRawQuoteSchema = z
  .object({
    type: z.string(),
    quoteId: z.string().optional(),
    fromChain: z.string(),
    toChain: z.string(),
    fromToken: TokenSchema,
    toToken: TokenSchema,
    effectiveAmountIn64: z.string().regex(INTEGER),
    expectedAmountOut: z.number(),
    minAmountOut: z.number(),
    expectedAmountOutBaseUnits: z.string().regex(INTEGER),
    minAmountOutBaseUnits: z.string().regex(INTEGER),
    slippageBps: z.number(),
    etaSeconds: z.number(),
    deadline64: z.string().regex(INTEGER),
    priceImpact: z.number().nullable().optional(),
    priceStat: z.object({ ratio: z.number(), status: z.enum(["GOOD", "NORMAL", "BAD"]) }).optional(),
    protocolBps: z.number().optional(),
    protocolFeeUsd: z.number().optional(),
    referrerBps: z.number().optional(),
    referrerFeeUsd: z.number().optional(),
    clientRelayerFeeSuccess: z.number().nullable().optional(),
    clientRelayerFeeRefund: z.number().nullable().optional(),
    redeemRelayerFee64: z.string().nullable().optional(),
    refundRelayerFee64: z.string().nullable().optional(),
    rentCost: z.string().nullable().optional(),
    suggestedPriorityFee: z.number().optional(),
    gasDrop: z.number().optional(),
    swiftAuctionMode: z.number().optional(),
    swiftVersion: z.string().optional(),
    swiftMayanContract: z.string().optional(),
    swiftInputContract: z.string().optional(),
    fastMctpMayanContract: z.string().optional(),
    fastMctpMinFinality: z.number().optional(),
    circleMaxFee64: z.string().optional(),
    gasless: z.boolean().optional(),
    onlyBridging: z.boolean().optional(),
    meta: z.object({ title: z.string() }).passthrough().optional(),
  })
  .passthrough();

export type MayanRawQuote = z.output<typeof MayanRawQuoteSchema>;

const ResponseSchema = z.object({ quotes: z.array(z.unknown()) }).passthrough();

export type MayanQuoteFailure = Readonly<{
  ok: false;
  code: "HTTP_ERROR" | "RATE_LIMITED" | "SDK_VERSION" | "TRANSPORT" | "UNREADABLE" | "NO_QUOTES";
  status: number | null;
  reason: string;
  /** Mayan's own error code or message, for the operator trail; never shown raw. */
  provider: Readonly<{ code: string | number | null; message: string | null }>;
}>;

export type MayanQuoteSuccess = Readonly<{
  ok: true;
  /** Every quote Mayan returned that parsed, in Mayan's order. */
  quotes: readonly MayanRawQuote[];
  /** Quotes that did not fit the schema are counted, never trusted. */
  unreadable: number;
  observedAt: string;
  requestUrl: string;
}>;

export type MayanQuoteDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  origin?: string;
  timeoutMs?: number;
}>;

export function buildMayanQuoteUrl(request: MayanQuoteRequest, origin: string = MAYAN_PRICE_API_ORIGIN): string {
  const url = new URL(MAYAN_QUOTE_PATH, origin);
  url.searchParams.set("amountIn", request.amountIn);
  url.searchParams.set("fromToken", request.fromToken);
  url.searchParams.set("fromChain", MAYAN_CHAIN_NAME[request.fromChain]);
  url.searchParams.set("toToken", request.toToken);
  url.searchParams.set("toChain", MAYAN_CHAIN_NAME[request.toChain]);
  url.searchParams.set("slippageBps", String(request.slippageBps ?? "auto"));
  url.searchParams.set("gasDrop", "0");
  url.searchParams.set("swift", "true");
  url.searchParams.set("mctp", "true");
  url.searchParams.set("fastMctp", "true");
  url.searchParams.set("shuttle", "false");
  url.searchParams.set("wormhole", "false");
  url.searchParams.set("fullList", "true");
  url.searchParams.set("sdkVersion", MAYAN_SDK_VERSION);
  if (request.destinationAddress) url.searchParams.set("destinationAddress", request.destinationAddress);
  if (request.referrer) {
    url.searchParams.set("referrer", request.referrer);
    url.searchParams.set("referrerBps", String(request.referrerBps ?? 0));
  }
  return url.toString();
}

export async function fetchMayanQuotes(
  request: MayanQuoteRequest,
  deps: MayanQuoteDependencies = {},
): Promise<MayanQuoteSuccess | MayanQuoteFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const requestUrl = buildMayanQuoteUrl(request, deps.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 12_000);
  let response: Response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    return {
      ok: false,
      code: "TRANSPORT",
      status: null,
      reason: "Mayan's quote service did not answer.",
      provider: { code: null, message: error instanceof Error ? error.message : String(error) },
    };
  }
  clearTimeout(timer);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const provider = readProviderError(payload);
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", status: 429, reason: "Mayan is rate-limiting quotes right now.", provider };
    }
    if (response.status === 406) {
      /* 406 is Mayan's answer to two different questions, and the status alone
         does not tell them apart — its own code does. `ROUTE_NOT_FOUND` is by
         far the common one: this pair has no route right now, which is a market
         fact and not a fault in this product. Reading every 406 as a version
         refusal was harmless while the lane carried ten liquid pairs that always
         routed, and became a lie the moment any token could be named: a person
         asking for an unroutable pair was told the software was out of date.
         Verified 2026-09-09 — a deliberately ancient `sdkVersion` also answers
         `ROUTE_NOT_FOUND`, so the version case may not even be reachable this
         way; it is kept because guessing that it is not would be the same
         mistake in the other direction. */
      if (provider.code === "ROUTE_NOT_FOUND") {
        return { ok: false, code: "NO_QUOTES", status: 406, reason: "Mayan has no route for this pair right now.", provider };
      }
      return { ok: false, code: "SDK_VERSION", status: 406, reason: "Mayan no longer answers this quote version.", provider };
    }
    return { ok: false, code: "HTTP_ERROR", status: response.status, reason: `Mayan answered HTTP ${response.status}.`, provider };
  }
  const parsed = ResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      code: "UNREADABLE",
      status: response.status,
      reason: "Mayan's answer did not have the shape of a quote list.",
      provider: { code: null, message: null },
    };
  }
  const quotes: MayanRawQuote[] = [];
  let unreadable = 0;
  for (const candidate of parsed.data.quotes) {
    const quote = MayanRawQuoteSchema.safeParse(candidate);
    if (quote.success) quotes.push(quote.data);
    else unreadable += 1;
  }
  if (quotes.length === 0) {
    return {
      ok: false,
      code: "NO_QUOTES",
      status: response.status,
      reason: "Mayan has no route for this pair right now.",
      provider: { code: null, message: null },
    };
  }
  return { ok: true, quotes, unreadable, observedAt: now().toISOString(), requestUrl };
}

function readProviderError(payload: unknown): Readonly<{ code: string | number | null; message: string | null }> {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const code = record.code;
    const message = record.msg ?? record.message;
    return {
      code: typeof code === "string" || typeof code === "number" ? code : null,
      message: typeof message === "string" ? message : null,
    };
  }
  return { code: null, message: null };
}

/** The parts of Mayan's quote that decide what is spent and what arrives where. */
export type MayanQuoteFacts = Readonly<{
  type: string;
  fromChain: string;
  toChain: string;
  fromToken: Readonly<{ contract: string }>;
  toToken: Readonly<{ contract: string }>;
  effectiveAmountIn64: string;
  swiftVersion?: string;
  gasless?: boolean;
}>;

export type MayanQuoteExpectation = Readonly<{
  fromChain: string;
  /** Mint, contract or Mayan's zero address for the native coin, as the request named it. */
  fromToken: string;
  toChain: string;
  toToken: string;
  /** The person's amount in base units; the quote may spend this or less, never more. */
  amountInRaw: string;
}>;

/** A Solana mint is case-sensitive base58; an EVM contract is the same contract in any case. */
function sameToken(chain: string, a: string, b: string): boolean {
  return chain === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether Mayan answered the question it was asked (FIX-XSWAP-1). Any field
 * that differs is named, so the refusal says what moved rather than that
 * something did. Read at the quote and again by the Solana builder, because
 * the builder is the last point before bytes exist.
 */
export function mayanQuoteMatchesRequest(quote: MayanQuoteFacts, expected: MayanQuoteExpectation): Readonly<{ ok: true }> | Readonly<{ ok: false; code: "QUOTE_MISMATCH"; reason: string }> {
  const refuse = (reason: string) => ({ ok: false as const, code: "QUOTE_MISMATCH" as const, reason });
  const mismatch = (field: string) => refuse(`Mayan's quote names a different ${field} from the one you asked for; nothing was built.`);
  if (quote.fromChain !== expected.fromChain) return mismatch("source network");
  if (quote.toChain !== expected.toChain) return mismatch("destination network");
  if (!sameToken(expected.fromChain, quote.fromToken.contract, expected.fromToken)) return mismatch("token to spend");
  if (!sameToken(expected.toChain, quote.toToken.contract, expected.toToken)) return mismatch("token to receive");
  if (!/^[1-9][0-9]*$/.test(quote.effectiveAmountIn64) || !/^[1-9][0-9]*$/.test(expected.amountInRaw)) return mismatch("amount");
  if (BigInt(quote.effectiveAmountIn64) > BigInt(expected.amountInRaw)) {
    return refuse("Mayan's quote spends more than the amount you entered; nothing was built.");
  }
  if (quote.gasless === true) return refuse("Mayan offered a gasless order, which needs a signer other than your wallet.");
  if (quote.type === "SWIFT" && quote.fromChain === "solana" && quote.swiftVersion !== "V2") {
    return refuse("Only Swift V2 orders are built from Solana here.");
  }
  return { ok: true };
}

/**
 * Which of Mayan's answers this lane may act on for a given tuple.
 *
 * Solana-origin: Swift only (see the module note). EVM-origin: Fast MCTP only.
 * Among the admissible quotes the one with the highest signed minimum wins —
 * the minimum is what the person is promised, so it is what decides.
 */
export function admissibleMayanRoutes(tuple: CrossSwapTuple): readonly MayanRouteType[] {
  return tuple.from.network === "solana" ? ["SWIFT"] : ["FAST_MCTP"];
}

export function selectMayanQuote(
  quotes: readonly MayanRawQuote[],
  tuple: CrossSwapTuple,
): Readonly<{ selected: MayanRawQuote | null; considered: readonly MayanRawQuote[]; declined: readonly string[] }> {
  const admissible = admissibleMayanRoutes(tuple);
  const considered = quotes.filter((quote) => (admissible as readonly string[]).includes(quote.type) && quote.gasless !== true);
  const declined = quotes.filter((quote) => !considered.includes(quote)).map((quote) => quote.type);
  let selected: MayanRawQuote | null = null;
  for (const quote of considered) {
    if (!selected || BigInt(quote.minAmountOutBaseUnits) > BigInt(selected.minAmountOutBaseUnits)) selected = quote;
  }
  return { selected, considered, declined };
}

/**
 * Ryntra's referrer fee, as Mayan's own quote states it.
 *
 * Mayan echoes `referrerBps` and `referrerFeeUsd`, and echoing a rate is what
 * makes the fee real — two of its routes earn nothing however the rate is set,
 * and it says so by answering zero: a plain USDC-to-USDC MCTP transfer has no
 * destination swap, and a Wormhole Swap transfer that does not swap does not
 * qualify. This lane never asks for Wormhole, but the zero case is read rather
 * than assumed away.
 *
 * `referrerFeeUsd` is Mayan's own dollar figure. There is no raw amount in the
 * quote, and none is invented: the fee is taken in the locked source asset on
 * Swift and in the stablecoin minted during bridging on Fast MCTP, and neither is
 * stated as base units here.
 */
function readMayanServiceFee(quote: MayanRawQuote, requestedBps: number | null): RyntraServiceFee {
  if (requestedBps === null) {
    return serviceFeeUnconfigured("MAYAN_REFERRER", "No Mayan referrer address is configured, so no referrer fee was requested.");
  }
  const bps = quote.referrerBps ?? 0;
  if (bps <= 0) {
    return serviceFeeNotApplied(
      "MAYAN_REFERRER",
      `Mayan quoted no referrer fee for this ${quote.type} route against the ${requestedBps} bps requested.`,
    );
  }
  return serviceFeeQuoted("MAYAN_REFERRER", { basisPoints: bps, usd: quote.referrerFeeUsd ?? null });
}

export function normalizeMayanQuote(
  quote: MayanRawQuote,
  tuple: CrossSwapTuple,
  context: Readonly<{
    fromDecimals: number;
    toDecimals: number;
    observedAt: string;
    approvals: number;
    /** The rate that was asked for, so a zero answer reads as a zero answer. */
    referrerBps?: number | null;
  }>,
): CrossSwapQuote {
  const route = quote.type as MayanRouteType;
  const priceImpact = quote.priceImpact ?? null;
  return {
    schema: "ryntra.solana.cross-swap-quote",
    schemaVersion: "1.0.0",
    provider: "MAYAN",
    route,
    routeLabel: route === "SWIFT" ? "Mayan Swift" : "Mayan Fast MCTP (Circle CCTP v2)",
    tupleId: tuple.id,
    from: {
      network: tuple.from.network,
      asset: tuple.from.asset,
      symbol: quote.fromToken.symbol,
      decimals: context.fromDecimals,
      amountRaw: quote.effectiveAmountIn64,
    },
    to: {
      network: tuple.to.network,
      asset: tuple.to.asset,
      symbol: quote.toToken.symbol,
      decimals: context.toDecimals,
      expectedRaw: quote.expectedAmountOutBaseUnits,
      minimumRaw: quote.minAmountOutBaseUnits,
    },
    slippageBps: quote.slippageBps,
    etaSeconds: quote.etaSeconds,
    /* Swift signs this deadline into the order: past it an unfilled order is
       refunded on the source chain. It is a protocol guarantee, not a
       freshness hint, and `deadlineKind` is how a surface tells the two apart. */
    deadlineKind: "PROTOCOL",
    deadlineUnix: Number(quote.deadline64),
    fees: {
      protocolBps: quote.protocolBps ?? 0,
      protocolUsd: quote.protocolFeeUsd ?? null,
      relayerUsd: quote.clientRelayerFeeSuccess ?? null,
      /* Mayan does not split its relayer figure into gas and service, and does
         not state the source wallet's own gas at all. Null says "this provider
         did not tell us", which a surface must show as unknown rather than as
         zero — a missing cost read as no cost is how a total quietly lies. */
      relayerGasUsd: null,
      sourceGasUsd: null,
      refundUsd: quote.clientRelayerFeeRefund ?? null,
      rentLamports: tuple.from.network === "solana" ? (quote.rentCost ?? null) : null,
      referrerBps: quote.referrerBps ?? 0,
    },
    serviceFee: readMayanServiceFee(quote, context.referrerBps ?? null),
    approvals: context.approvals,
    walletPrompts: context.approvals + 1,
    priceImpactBps: priceImpact === null ? null : Math.round(priceImpact * 100),
    priceStatus: quote.priceStat?.status ?? null,
    quoteId: quote.quoteId ?? null,
    observedAt: context.observedAt,
  };
}
