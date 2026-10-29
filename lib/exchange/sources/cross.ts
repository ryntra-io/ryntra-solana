/**
 * The Exchange's quotes across networks (B9): Relay first, deBridge second,
 * Mayan third, each with Ryntra's 25 bps through its
 * own fee parameter (`../fees.ts`).
 *
 * Each source asks one executor and turns its answer into the core's
 * `ExchangeQuote`: what arrives after every fee taken out of the amount
 * (`out_expected`), the least that can arrive (`out_min`), every fee by who takes
 * it (`fees`) and the executor's own delivery estimate. A fee paid from the wallet
 * on top of the amount goes into `gas`, so the screen's «after every cost» ranking
 * counts it — deBridge's fixed fee is one, and its route line says so.
 *
 * No source here builds a transaction or sees a key. Relative imports only: the
 * tests import this module directly.
 */

import type { Amount } from "@ryntra/core/adapters";

import { DEBRIDGE_CHAIN_IDS, DEBRIDGE_EVM_NATIVE, DEBRIDGE_SOLANA_NATIVE, fetchDebridgeQuote, type DebridgeQuote, type DebridgeQuoteDependencies } from "../../debridge/quote-api.ts";
import { RELAY_QUOTE_VALIDITY_SECONDS, type RelayRawQuote } from "../../relay/quote-api.ts";
import { RELAY_SOLANA_CHAIN_ID, RELAY_SOLANA_NATIVE_ADDRESS } from "../../relay/chains.ts";
import type { SwapTokenRow } from "../../relay/currencies.ts";
import type { MayanQuoteDependencies, MayanRawQuote } from "../../mayan/price-api.ts";
import { ARC_USDC_CONTRACT, ARC_USDC_DECIMALS, SOLANA_NATIVE_SOL_MINT, SWAP_CATALOG, SWAP_NETWORK_META, isSwapNetwork, type SwapNetwork } from "../../swap/catalog.ts";
import { quoteCrossSwap, quoteViaMayan, resolveCrossSwapRoute, type CrossSwapRoute } from "../../swap/cross-swap-service.ts";
import { normalizeServiceFeeConfig } from "../../swap/service-fee.ts";
import { amountOf, feesOf, quoteId, rescale, type ExchangeFeeRoute, type ExchangeQuoteRequest, type ExchangeQuoteSource, type ExchangeRefusal, type ExchangeSide, type ExchangeSourceAnswer } from "../contract.ts";
import { CROSS_NETWORK_FEE_BPS, DEBRIDGE_AFFILIATE_FEE_BPS, EXCHANGE_FEE_DESTINATION, type ExchangeFeeConfig } from "../fees.ts";

/** A Solana signature's base fee, in lamports: the least the wallet pays on top of anything sent from Solana. */
const SOLANA_SIGNATURE_FEE_LAMPORTS = 5_000n;

/** How long deBridge's and Mayan's prices are treated as fresh; neither states a validity, so this is ours, like Relay's. */
const CROSS_QUOTE_VALIDITY_MS = 30_000;

export type CrossSourceDeps = Readonly<{
  fees: ExchangeFeeConfig;
  /** Ryntra's Relay key, resolved by the server route; never read here. */
  relayApiKey?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>;

/**
 * This build's Exchange sends from Solana: the person's wallet here is a Solana
 * wallet, and every cost below is stated for a Solana origin. Money that starts
 * on another network is the Bridge's inbound lane, not a quote of this screen.
 */
const crossing = (request: ExchangeQuoteRequest): boolean =>
  request.from.network === "solana" && request.to.network !== "solana" && isSwapNetwork(request.to.network);

const refuse = (executor: string, code: ExchangeRefusal["code"], reason: string): ExchangeSourceAnswer => ({ ok: false, refusal: { executor, code, reason } });

const networkLabel = (network: string): string => (isSwapNetwork(network) ? SWAP_NETWORK_META[network].label : network);

/** How the swap lane names a side: a catalogue code for a network's own coin, the mint or contract otherwise. */
export function swapRefOf(side: ExchangeSide): Readonly<{ network: SwapNetwork; asset: string }> {
  const network = side.network as SwapNetwork;
  if (side.native) {
    const coin = SWAP_CATALOG.find((entry) => entry.network === network && entry.kind === "NATIVE");
    if (coin) return { network, asset: coin.code };
  }
  return { network, asset: side.asset };
}

/** The sides as the request already knows them, so the route is not looked up a second time. */
function knownToken(request: ExchangeQuoteRequest) {
  return async (args: Readonly<{ network: SwapNetwork; address: string }>): Promise<SwapTokenRow | null> => {
    for (const side of [request.from, request.to]) {
      if (side.network === args.network && side.asset.toLowerCase() === args.address.toLowerCase()) {
        return { network: args.network, address: side.asset, symbol: side.symbol, name: null, decimals: side.decimals, verified: side.verified ?? true, native: side.native };
      }
    }
    return null;
  };
}

async function routeOf(request: ExchangeQuoteRequest): Promise<CrossSwapRoute | ExchangeRefusal["reason"]> {
  const resolved = await resolveCrossSwapRoute(swapRefOf(request.from), swapRefOf(request.to), { resolveToken: knownToken(request) });
  return resolved.ok ? resolved.route : resolved.reason;
}

const serviceFeeConfigOf = (fees: ExchangeFeeConfig) =>
  normalizeServiceFeeConfig({ relayAppFeeRecipient: fees.relayAppFeeRecipient, mayanReferrerSolana: fees.mayanReferrerSolana });

/* ---------------------------------------------------------------- Relay */

/** Relay names Solana's coin by the System Program id; the Exchange names it by the wrapped-SOL mint, as Jupiter does. */
function relayAsset(chainId: number, address: string): string {
  return chainId === RELAY_SOLANA_CHAIN_ID && address === RELAY_SOLANA_NATIVE_ADDRESS ? SOLANA_NATIVE_SOL_MINT : address;
}

type RelayFee = NonNullable<NonNullable<RelayRawQuote["fees"]>["gas"]>;

function relayFeeAmount(fee: RelayFee | undefined): Amount | null {
  if (!fee?.currency || !fee.amount) return null;
  return amountOf(fee.amount, relayAsset(fee.currency.chainId, fee.currency.address), fee.currency.decimals);
}

export function relayFeeRoute(fees: ExchangeFeeConfig): ExchangeFeeRoute {
  return { executor: "Relay", parameter: "appFees", bps: CROSS_NETWORK_FEE_BPS, paidTo: EXCHANGE_FEE_DESTINATION.Relay, configured: fees.relayAppFeeRecipient !== null };
}

/** Relay's raw answer as the core's quote. Exported for the tests, which read a recorded answer. */
export function exchangeQuoteFromRelay(request: ExchangeQuoteRequest, raw: RelayRawQuote, minimumRaw: string, etaSeconds: number, observedAt: string): ReturnType<typeof buildQuote> {
  const out = raw.details.currencyOut;
  const at = Date.parse(observedAt);
  const fees = raw.fees ?? {};
  return buildQuote("Relay", request, {
    outExpected: out.amount,
    outMin: minimumRaw,
    fees: feesOf({ venue: relayFeeAmount(fees.relayer), builder: null, ryntra: relayFeeAmount(fees.app), gas: relayFeeAmount(fees.gas) }),
    route: `Relay · ${networkLabel(request.from.network)} → ${networkLabel(request.to.network)}`,
    at,
    expiresAt: at + RELAY_QUOTE_VALIDITY_SECONDS * 1_000,
    deliveryMs: Math.max(1, raw.details.timeEstimate ?? etaSeconds) * 1_000,
  });
}

export function relaySource(deps: CrossSourceDeps): ExchangeQuoteSource {
  return {
    executor: "Relay",
    serves: crossing,
    async quote(request) {
      if (!request.user || !request.recipient) return refuse("Relay", "NEEDS_WALLET", "Relay prices for the wallets it will use.");
      const route = await routeOf(request);
      if (typeof route === "string") return refuse("Relay", "NOT_SERVED", route);
      const outcome = await quoteCrossSwap(route, request.amountRaw, {
        sourceAddress: request.user,
        destinationAddress: request.recipient,
        feeConfig: serviceFeeConfigOf(deps.fees),
        deps: { apiKey: deps.relayApiKey ?? null, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.now ? { now: deps.now } : {}) },
      });
      if (!outcome.ok) return refuse("Relay", outcome.status === 429 ? "RATE_LIMITED" : outcome.status === 409 ? "NO_ROUTE" : "UNAVAILABLE", outcome.reason);
      const raw = outcome.raw as unknown as RelayRawQuote;
      const arrived = raw.details.currencyOut.currency;
      const expected = request.to.native ? (request.to.network === "solana" ? SOLANA_NATIVE_SOL_MINT : DEBRIDGE_EVM_NATIVE) : request.to.asset;
      if (relayAsset(arrived.chainId, arrived.address).toLowerCase() !== expected.toLowerCase() || arrived.decimals !== request.to.decimals) {
        return refuse("Relay", "NO_ROUTE", "Relay answered for another asset than the one asked.");
      }
      const quote = exchangeQuoteFromRelay(request, raw, outcome.quote.to.minimumRaw, outcome.quote.etaSeconds, outcome.observedAt);
      return { ok: true, quote, fee: relayFeeRoute(deps.fees) };
    },
  };
}

/* ---------------------------------------------------------------- deBridge */

/**
 * How deBridge is asked for a side. Arc's USDC only as the native face (eighteen
 * decimals) — the same balance as the ERC-20 the Exchange names — so the answer
 * is read back at six.
 */
export function debridgeTokenFor(side: ExchangeSide): Readonly<{ token: string; decimals: number }> {
  if (side.network === "arc" && side.asset.toLowerCase() === ARC_USDC_CONTRACT.toLowerCase()) return { token: DEBRIDGE_EVM_NATIVE, decimals: 18 };
  if (side.native) return { token: side.network === "solana" ? DEBRIDGE_SOLANA_NATIVE : DEBRIDGE_EVM_NATIVE, decimals: side.decimals };
  return { token: side.asset, decimals: side.decimals };
}

export function debridgeFeeRoute(fees: ExchangeFeeConfig, request: ExchangeQuoteRequest): ExchangeFeeRoute {
  /* The recipient is a key of the source network; this build configures the Solana one, the side the Exchange sends from. */
  const configured = request.from.network === "solana" && fees.debridgeAffiliateSolana !== null;
  return { executor: "deBridge", parameter: "affiliateFeePercent + affiliateFeeRecipient", bps: DEBRIDGE_AFFILIATE_FEE_BPS, paidTo: EXCHANGE_FEE_DESTINATION.deBridge, configured };
}

const DEBRIDGE_VENUE_COSTS = new Set(["DlnProtocolFee", "TakerMargin", "EstimatedOperatingExpenses"]);

/** deBridge's answer as the core's quote. Exported for the tests, which read a recorded answer. */
export function exchangeQuoteFromDebridge(request: ExchangeQuoteRequest, quote: DebridgeQuote, observedAt: string): ReturnType<typeof buildQuote> | null {
  const asked = debridgeTokenFor(request.to);
  if (quote.out.token.toLowerCase() !== asked.token.toLowerCase() || quote.out.decimals !== asked.decimals) return null;
  /* What leaves the wallet is what the person typed, in the token they chose — or this is another exchange. */
  const sent = debridgeTokenFor(request.from);
  if (quote.in.amountRaw !== request.amountRaw || quote.in.token.toLowerCase() !== sent.token.toLowerCase()) return null;
  const toOut = (units: bigint) => rescale(units, asked.decimals, request.to.decimals);
  const outExpected = toOut(BigInt(quote.out.amountRaw));

  /* The one exchange rate deBridge's own numbers imply between the source leg and the destination leg: what left the
     source chain against what entered the destination chain. Used only to state the source-side protocol fee in the
     asset that arrives; nothing is priced from outside. */
  const srcChain = DEBRIDGE_CHAIN_IDS[request.from.network];
  const dstChain = DEBRIDGE_CHAIN_IDS[request.to.network];
  const srcRows = quote.costs.filter((row) => row.chain === srcChain);
  const dstRows = quote.costs.filter((row) => row.chain === dstChain);
  const leftSource = srcRows.length ? BigInt(srcRows[srcRows.length - 1].amountOut) : 0n;
  const enteredDestination = dstRows.length ? BigInt(dstRows[0].amountIn) : 0n;
  let venue = 0n;
  for (const row of quote.costs) {
    if (!DEBRIDGE_VENUE_COSTS.has(row.type) || row.feeAmount === null) continue;
    const fee = BigInt(row.feeAmount);
    if (row.chain === dstChain && row.token.toLowerCase() === asked.token.toLowerCase()) venue += toOut(fee);
    else if (row.chain === srcChain && leftSource > 0n && enteredDestination > 0n) venue += toOut((fee * enteredDestination) / leftSource);
  }

  /* Ryntra's fee as deBridge states it: a line in the source chain's own token. */
  const affiliate = quote.costs.find((row) => row.type === "AffiliateFee" && row.chain === srcChain && row.feeAmount !== null);
  const affiliateDecimals = affiliate ? tokenDecimals(request.from.network, affiliate.token, request) : null;
  const ryntra = affiliate && affiliateDecimals !== null ? amountOf(affiliate.feeAmount as string, solanaAsset(affiliate.token), affiliateDecimals) : null;

  /* From Solana the fixed fee is paid in SOL on top of the amount, beside the signature fee. */
  const gas =
    request.from.network === "solana" ? amountOf(BigInt(quote.fixFeeRaw) + SOLANA_SIGNATURE_FEE_LAMPORTS, SOLANA_NATIVE_SOL_MINT, 9) : null;
  const at = Date.parse(observedAt);
  return buildQuote("deBridge", request, {
    outExpected: outExpected.toString(),
    /* A DLN order states the exact amount the taker must deliver; it is filled at that amount or not at all. */
    outMin: outExpected.toString(),
    fees: feesOf({ venue: venue > 0n ? amountOf(venue, request.to.asset, request.to.decimals) : null, builder: null, ryntra, gas }),
    route: `deBridge DLN · ${networkLabel(request.from.network)} → ${networkLabel(request.to.network)} · its fixed fee is in the network line`,
    at,
    expiresAt: at + CROSS_QUOTE_VALIDITY_MS,
    deliveryMs: Math.max(1, quote.fulfillmentDelaySeconds ?? 30) * 1_000,
  });
}

const solanaAsset = (token: string): string => (token === DEBRIDGE_SOLANA_NATIVE ? SOLANA_NATIVE_SOL_MINT : token);

/** Decimals of a token deBridge names on the source chain: one of the request's sides or a catalogue asset; null otherwise. */
function tokenDecimals(network: string, token: string, request: ExchangeQuoteRequest): number | null {
  const wanted = solanaAsset(token).toLowerCase();
  for (const side of [request.from, request.to]) if (side.network === network && side.asset.toLowerCase() === wanted) return side.decimals;
  const listed = SWAP_CATALOG.find((entry) => entry.network === network && ((entry.solanaMint ?? entry.address ?? "").toLowerCase() === wanted));
  return listed ? listed.decimals : null;
}

export function debridgeSource(deps: CrossSourceDeps): ExchangeQuoteSource {
  return {
    executor: "deBridge",
    serves: (request) => crossing(request) && DEBRIDGE_CHAIN_IDS[request.from.network] !== undefined && DEBRIDGE_CHAIN_IDS[request.to.network] !== undefined,
    async quote(request) {
      /* The same gate as every rail of the lane: an asset a network refuses, or a network money only arrives on, is never priced. */
      const route = await routeOf(request);
      if (typeof route === "string") return refuse("deBridge", "NOT_SERVED", route);
      const fee = debridgeFeeRoute(deps.fees, request);
      const result = await fetchDebridgeQuote(
        {
          fromNetwork: request.from.network,
          fromToken: debridgeTokenFor(request.from).token,
          toNetwork: request.to.network,
          toToken: debridgeTokenFor(request.to).token,
          amountRaw: request.amountRaw,
          affiliate: fee.configured && deps.fees.debridgeAffiliateSolana ? { recipient: deps.fees.debridgeAffiliateSolana, bps: fee.bps } : null,
        },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.now ? { now: deps.now } : {}) } satisfies DebridgeQuoteDependencies,
      );
      if (!result.ok) return refuse("deBridge", result.code === "NOT_SERVED" ? "NOT_SERVED" : result.code === "NO_ROUTE" ? "NO_ROUTE" : result.code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE", result.reason);
      const quote = exchangeQuoteFromDebridge(request, result.quote, result.observedAt);
      if (!quote) return refuse("deBridge", "NO_ROUTE", "deBridge answered for another asset than the one asked.");
      return { ok: true, quote, fee };
    },
  };
}

/* ---------------------------------------------------------------- Mayan */

export function mayanFeeRoute(fees: ExchangeFeeConfig): ExchangeFeeRoute {
  return { executor: "Mayan", parameter: "referrer + referrerBps", bps: CROSS_NETWORK_FEE_BPS, paidTo: EXCHANGE_FEE_DESTINATION.Mayan, configured: fees.mayanReferrerSolana !== null };
}

/** Mayan's chosen answer as the core's quote. Exported for the tests. */
export function exchangeQuoteFromMayan(
  request: ExchangeQuoteRequest,
  raw: MayanRawQuote,
  facts: Readonly<{ expectedRaw: string; minimumRaw: string; etaSeconds: number; protocolBps: number; referrerBps: number; rentLamports: string | null; observedAt: string }>,
): ReturnType<typeof buildQuote> {
  const paid = BigInt(request.amountRaw);
  /* Both are rates on the amount sent, in the asset sent, as Mayan applies them: its protocol fee and, on top of it, Ryntra's referrer fee. */
  const venue = (paid * BigInt(Math.max(0, Math.trunc(facts.protocolBps)))) / 10_000n;
  const ryntra = (paid * BigInt(Math.max(0, Math.trunc(facts.referrerBps)))) / 10_000n;
  const gas = request.from.network === "solana" ? amountOf(SOLANA_SIGNATURE_FEE_LAMPORTS + BigInt(facts.rentLamports ?? "0"), SOLANA_NATIVE_SOL_MINT, 9) : null;
  const at = Date.parse(facts.observedAt);
  return buildQuote("Mayan", request, {
    outExpected: facts.expectedRaw,
    outMin: facts.minimumRaw,
    fees: feesOf({ venue: amountOf(venue, request.from.asset, request.from.decimals), builder: null, ryntra: amountOf(ryntra, request.from.asset, request.from.decimals), gas }),
    route: `Mayan ${raw.type === "FAST_MCTP" ? "Fast MCTP" : "Swift"} · ${networkLabel(request.from.network)} → ${networkLabel(request.to.network)}`,
    at,
    expiresAt: at + CROSS_QUOTE_VALIDITY_MS,
    deliveryMs: Math.max(1, facts.etaSeconds) * 1_000,
  });
}

export function mayanSource(deps: CrossSourceDeps): ExchangeQuoteSource {
  return {
    executor: "Mayan",
    serves: crossing,
    async quote(request) {
      const route = await routeOf(request);
      if (typeof route === "string") return refuse("Mayan", "NOT_SERVED", route);
      /* The lane's routing names Relay for every pair; asking Mayan is asking it as itself, with its own two mechanisms. */
      const asMayan: CrossSwapRoute = { ...route, engine: "MAYAN", tuple: { ...route.tuple, provider: "MAYAN", expectedRoutes: ["SWIFT", "FAST_MCTP"] } };
      const outcome = await quoteViaMayan(asMayan, request.amountRaw, {
        ...(request.recipient ? { destinationAddress: request.recipient } : {}),
        feeConfig: serviceFeeConfigOf(deps.fees),
        deps: { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.now ? { now: deps.now } : {}) } satisfies MayanQuoteDependencies,
      });
      if (!outcome.ok) {
        const notServed = outcome.code === "PAIR_NOT_SUPPORTED";
        return refuse("Mayan", notServed ? "NOT_SERVED" : outcome.status === 429 ? "RATE_LIMITED" : outcome.status === 409 ? "NO_ROUTE" : "UNAVAILABLE", outcome.reason);
      }
      const q = outcome.quote;
      const quote = exchangeQuoteFromMayan(request, outcome.raw as MayanRawQuote, {
        expectedRaw: q.to.expectedRaw,
        minimumRaw: q.to.minimumRaw,
        etaSeconds: q.etaSeconds,
        protocolBps: q.fees.protocolBps,
        referrerBps: q.fees.referrerBps,
        rentLamports: q.fees.rentLamports,
        observedAt: outcome.observedAt,
      });
      return { ok: true, quote, fee: mayanFeeRoute(deps.fees) };
    },
  };
}

/* ---------------------------------------------------------------- shared */

type QuoteParts = Readonly<{
  outExpected: string;
  outMin: string;
  fees: ReturnType<typeof feesOf>;
  route: string;
  at: number;
  expiresAt: number;
  deliveryMs: number;
}>;

export function buildQuote(executor: string, request: ExchangeQuoteRequest, parts: QuoteParts) {
  return {
    id: quoteId(executor, request.intentId),
    executor,
    delivery_ms: parts.deliveryMs,
    quote: {
      intent_id: request.intentId,
      out_expected: amountOf(parts.outExpected, request.to.asset, request.to.decimals),
      out_min: amountOf(parts.outMin, request.to.asset, request.to.decimals),
      fees: parts.fees,
      route: parts.route,
      at: parts.at,
      expires_at: parts.expiresAt,
    },
  };
}

/** The Arc USDC face the Exchange names, for callers that build a side by hand. */
export const ARC_USDC_SIDE: ExchangeSide = { network: "arc", asset: ARC_USDC_CONTRACT, symbol: "USDC", decimals: ARC_USDC_DECIMALS, native: false };
