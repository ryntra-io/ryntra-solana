import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { createEvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { buildEvmFastMctpCalls, buildSolanaSwiftTransaction } from "@/lib/mayan/build.server";
import { claimCrossSwapOrder, crossSwapIntentDigest, crossSwapReviewDigest, sha256HexOf } from "@/lib/mayan/cross-swap-order";
import { crossSwapQuoteMaterialChange, type MayanRawQuote } from "@/lib/mayan/price-api";
import { wireHash } from "@/lib/mayan/signed-transaction";
import { buildRelayEvmCalls, buildRelaySolanaTransaction } from "@/lib/relay/build.server";
import type { RelayRawQuote } from "@/lib/relay/quote-api";
import { mutationOriginAllowed } from "@/lib/security";
import { effectiveCrossSwapRouteState, resolveSolanaCrossSwapRouteState, SOLANA_CROSS_SWAP_NETWORK_STATE_ENV } from "@/lib/solana/lane-state";
import { claimCrossSwapCanaryPlan, readCrossSwapCanary } from "@/lib/solana/cross-swap-canary-record";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { isSwapNetwork, type SwapNetwork } from "@/lib/swap/catalog";
import { addressShapeOk, crossSwapImpactBand, quoteCrossSwap, resolveCrossSwapRoute } from "@/lib/swap/cross-swap-service";
import { admitCrossSwapCanary } from "@/lib/swap/cross-swap-canary";
import { buildCrossSwapPreSign } from "@/lib/swap/pre-sign";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Review of a cross-chain swap: exact bytes for the person's wallet.
 *
 * Re-quotes Mayan for the pair, refuses to build on anything materially worse
 * than what the person reviewed, and assembles what the source wallet signs —
 * one Solana transaction with the wallet as its only signer, or the EVM
 * Forwarder call (with an exact-amount approval before it when the input is an
 * ERC-20). The Solana bytes are simulated before anyone is shown a Review.
 * Nothing is broadcast, and no key exists on this side; the order is claimed
 * by intent so a second plan over the same reviewed facts cannot become a
 * second submit.
 */

const CROSS_SWAP_REVIEW_WINDOW_MS = 45_000;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RAW = /^[1-9][0-9]{0,29}$/;

const RequestSchema = z
  .object({
    from: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    to: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    amountRaw: z.string().regex(RAW),
    owner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/),
    destination: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/),
    /** What the card showed; a fresh quote materially worse than this opens a new Review instead of building. */
    reviewed: z
      .object({
        route: z.enum(["SWIFT", "FAST_MCTP", "RELAY_DEPOSIT"]),
        amountRaw: z.string().regex(RAW),
        minimumRaw: z.string().regex(/^[0-9]{1,30}$/),
      })
      .strict(),
    /**
     * The exact price impact the person saw and accepted, in basis points.
     * Only read when the quote comes back in the severe band, and only
     * honoured when it equals that quote's own figure — an acknowledgement of
     * one number is not an acknowledgement of a worse one.
     */
    acknowledgeImpactBps: z.number().int().min(-100_000).max(100_000).optional(),
  })
  .strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: headers(rate) });
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return failure(403, "FORBIDDEN_ORIGIN", "This request did not come from Ryntra.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success || !isSwapNetwork(parsed.data.from.network) || !isSwapNetwork(parsed.data.to.network)) {
    return failure(400, "VALIDATION_ERROR", "The plan request did not match its schema.", rate);
  }
  const input = parsed.data;

  const store = getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) {
    return failure(503, "STORE_NOT_DURABLE", "A signable Review requires the durable order store.", rate);
  }

  const resolved = await resolveCrossSwapRoute({ network: input.from.network as SwapNetwork, asset: input.from.asset }, { network: input.to.network as SwapNetwork, asset: input.to.asset });
  if (!resolved.ok) return failure(409, resolved.code, resolved.reason, rate, resolved.detail);
  const route = resolved.route;
  /* The gate is read for this pair, not for the lane in general: Robinhood
     Chain carries a switch of its own beneath the lane's, and a pair is open
     only when every network in it is. Read once the route is known, so the
     refusal names the pair the person actually asked for. */
  const configuredState = resolveSolanaCrossSwapRouteState(route.from.network, route.to.network);
  const canaryRead = configuredState === "CANARY" ? await readCrossSwapCanary(store) : null;
  const permission = effectiveCrossSwapRouteState(configuredState, canaryRead?.ok ? canaryRead.record : null);
  if (permission === "CLOSED") {
    return failure(409, "CROSS_SWAP_PAUSED", "This route is not open yet.", rate, { from: route.from.network, to: route.to.network });
  }
  if (!addressShapeOk(route.from.network, input.owner) || !addressShapeOk(route.to.network, input.destination)) {
    return failure(400, "ADDRESS_SHAPE", "The wallet addresses do not match their networks.", rate);
  }
  if (route.from.network === "solana" && !SOLANA_ADDRESS.test(input.owner)) return failure(400, "ADDRESS_SHAPE", "The Solana owner is not a base58 address.", rate);
  if (route.from.network !== "solana" && !EVM_ADDRESS.test(input.owner)) return failure(400, "ADDRESS_SHAPE", "The EVM owner is not a 0x address.", rate);

  /* Resolved once, and the same object feeds the quote and the build. Reading
     configuration twice is how a fee gets quoted against one address and
     collected by another. */
  const feeConfig = resolveServiceFeeConfig();
  /* The plan re-quotes rather than trusting what the card had: this is the read
     that decides what somebody is about to sign, and `QUOTE_CHANGED` below is
     how a moved market stops a stale Review instead of signing it. */
  const quoted = await quoteCrossSwap(route, input.amountRaw, {
    destinationAddress: input.destination,
    sourceAddress: input.owner,
    feeConfig,
    deps: { apiKey: resolveRelayApiKey() },
  });
  if (!quoted.ok) return failure(quoted.status, quoted.code, quoted.reason, rate, quoted.detail);
  const { quote, raw } = quoted;

  /* Under `CANARY` the route carries exactly one operation, and every field of
     it is compared literally — amount, both networks, both assets, provider,
     slippage, app fee and both wallets. A near-miss is refused with the field
     that differed, and is refused as hard as `PAUSED` refuses everything: a
     controlled operation that quietly accepted a different amount would be an
     open lane wearing a closed lane's name.
     Checked after the quote because the provider and the slippage the quote
     actually came back with are part of what is being pinned — checking the
     request alone would pin what was asked for rather than what was built. */
  if (configuredState === "CANARY") {
    const admitted = admitCrossSwapCanary({
      fromNetwork: route.from.network,
      fromAsset: route.from.catalog?.code ?? route.from.asset,
      amountRaw: quote.from.amountRaw,
      toNetwork: route.to.network,
      toAsset: route.to.catalog?.address ?? route.to.catalog?.code ?? route.to.asset,
      provider: quote.provider,
      slippageBps: quote.slippageBps,
      /* The fee this quote actually carries, not a hard-coded zero. A controlled
         operation is defined by there being none, so if monetization is on for a
         route the canary is pinned to, the canary must refuse rather than let a
         charge through under a closed lane's name. */
      appFeeUsd: quote.serviceFee.usd ?? (quote.serviceFee.basisPoints === 0 ? 0 : null),
      sourceWallet: input.owner,
      destinationWallet: input.destination,
    });
    if (!admitted.ok) return failure(409, admitted.code, admitted.reason, rate, { state: "CANARY" });
  }

  /* A price nobody should accept by accident.
     Widening which assets the lane carries made this the control the ten-pair
     list had been providing by accident: every pair on it was liquid, so a
     terrible quote never arrived. Arbitrary tokens produce them routinely —
     Base DEGEN to Robinhood USDG came back at −84.8% on a small amount, real
     and executable.
     So past `SEVERE` the plan refuses to build until the person has
     acknowledged **this** quote's number. Not the pair, not a session-wide
     toggle: the exact figure, so an acknowledgement cannot be inherited by a
     later, worse quote. It is never a refusal — somebody may knowingly move a
     small amount at a bad price — only a guarantee that the signature is not
     the first time they see it. */
  const band = crossSwapImpactBand(quote.priceImpactBps);
  if (band === "SEVERE" && input.acknowledgeImpactBps !== quote.priceImpactBps) {
    return failure(409, "IMPACT_NOT_ACKNOWLEDGED", "This swap loses a large part of its value on the way. Look at the figure before continuing.", rate, {
      priceImpactBps: quote.priceImpactBps,
      band,
      quote,
    });
  }

  const change = crossSwapQuoteMaterialChange(
    { route: input.reviewed.route, from: { amountRaw: input.reviewed.amountRaw } as never, to: { minimumRaw: input.reviewed.minimumRaw } as never },
    { route: quote.route, from: quote.from as never, to: quote.to as never },
  );
  if (change.changed) {
    return failure(409, "QUOTE_CHANGED", "The market moved; look at the new figures before continuing.", rate, { change, quote });
  }

  const builtAt = new Date().toISOString();
  const reviewExpiresAt = new Date(Date.parse(builtAt) + CROSS_SWAP_REVIEW_WINDOW_MS).toISOString();
  const reviewDigest = crossSwapReviewDigest({
    route: quote.route,
    amountInRaw: quote.from.amountRaw,
    expectedOutRaw: quote.to.expectedRaw,
    minimumOutRaw: quote.to.minimumRaw,
    deadlineUnix: quote.deadlineUnix,
    walletPrompts: quote.walletPrompts,
  });
  const intentDigest = crossSwapIntentDigest({
    sourceWallet: input.owner,
    destinationWallet: input.destination,
    tupleId: route.tuple.id,
    route: quote.route,
    amountInRaw: quote.from.amountRaw,
    minimumOutRaw: quote.to.minimumRaw,
    quoteId: quote.quoteId,
    builtAt,
  });

  const common = {
    store,
    intentDigest,
    reviewDigest,
    provider: quote.provider,
    tupleId: route.tuple.id,
    route: quote.route,
    sourceChain: route.from.network,
    destinationChain: route.to.network,
    sourceWallet: input.owner,
    destinationWallet: input.destination,
    amountInRaw: quote.from.amountRaw,
    expectedOutRaw: quote.to.expectedRaw,
    minimumOutRaw: quote.to.minimumRaw,
    fromDecimals: route.fromDecimals,
    toDecimals: route.toDecimals,
    fromSymbol: quote.from.symbol,
    toSymbol: quote.to.symbol,
    deadlineUnix: quote.deadlineUnix,
    quoteId: quote.quoteId,
    at: builtAt,
  } as const;

  if (route.from.network === "solana") {
    const handle = createSolanaRpcHandle({ network: "mainnet" });
    /* Each provider describes a Solana origin in its own terms — Mayan through
       its SDK, Relay as instructions carried inside the quote — and each
       builder refuses anything that would need a second signer or reach an
       unexpected program. Both answer in one shape, so all of the rest is
       common: the same simulation, the same claim, the same Review. */
    const built =
      quote.provider === "RELAY"
        ? await buildRelaySolanaTransaction({ quote: raw as RelayRawQuote, owner: input.owner, rpcUrl: handle.endpoint })
        : await buildSolanaSwiftTransaction({
            quote: raw as MayanRawQuote,
            owner: input.owner,
            destination: input.destination,
            rpcUrl: handle.endpoint,
            /* Relay carries its fee inside the quote's own steps; Mayan needs the
               address again here or the rate it quoted is collected by nobody. */
            referrer: feeConfig.mayanReferrerSolana,
          });
    if (!built.ok) return failure(built.code === "BUILD_FAILED" ? 502 : 409, built.code, built.reason, rate);

    let simulation: { succeeded: boolean; error: string | null; unitsConsumed: string | null; host: string };
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .simulateTransaction(built.unsignedWireBase64 as never, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" })
          .send({ abortSignal }),
      );
      const failed = response.value.err !== null && response.value.err !== undefined;
      simulation = {
        succeeded: !failed,
        error: failed ? JSON.stringify(response.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)) : null,
        unitsConsumed: response.value.unitsConsumed === undefined ? null : String(response.value.unitsConsumed),
        host: handle.host(),
      };
    } catch (cause) {
      return failure(502, "SIMULATION_UNAVAILABLE", `The order could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`, rate);
    }
    if (!simulation.succeeded) {
      return failure(409, "SIMULATION_FAILED", "The order would fail on chain as built, so no Review is offered.", rate, { simulation });
    }

    /* The controlled operation records that a plan exists. Rebuilding a stale
       plan lands here again and is expected — it moves nothing and consumes
       nothing. What it cannot do is happen after a submit was attempted. */
    const canaryPlan = configuredState === "CANARY" ? await claimCrossSwapCanaryPlan(store, intentDigest, builtAt) : null;
    if (canaryPlan && !canaryPlan.ok) return failure(409, canaryPlan.code, canaryPlan.reason, rate, { state: "CANARY" });
    const claim = await claimCrossSwapOrder({ ...common, reviewedWireHash: wireHash(built.unsignedWireBase64) });
    if (!claim.ok) return failure(claim.code === "CROSS_SWAP_ALREADY_STARTED" ? 409 : 503, claim.code, claim.reason, rate, { state: claim.record?.state ?? null });

    return Response.json(
      {
        kind: "CROSS_SWAP",
        engine: quote.provider,
        intentDigest,
        quote,
        /* Read off this same build — the same quote, the same destination, the
           same bytes whose hash the submit will insist on. A snapshot from a
           second quote is the thing this makes impossible. */
        preSign: buildCrossSwapPreSign({
          quote,
          destinationAddress: input.destination,
          sourceWallet: input.owner,
          fromContract: route.from.catalog?.address ?? (route.from.catalog ? null : route.from.asset),
          toContract: route.to.catalog?.address ?? (route.to.catalog ? null : route.to.asset),
          gateVariable: SOLANA_CROSS_SWAP_NETWORK_STATE_ENV.robinhood,
          builtAt,
          reviewExpiresAt,
          requiresImpactAcknowledgement: band === "SEVERE",
          solana: {
            feePayer: built.feePayer,
            requiredSignatures: built.requiredSignatures,
            instructionCount: built.instructionCount,
            programIds: built.programIds,
            wireSha256: wireHash(built.unsignedWireBase64),
            lastValidBlockHeight: built.lastValidBlockHeight,
          },
        }),
        plan: {
          origin: "solana" as const,
          unsignedWireBase64: built.unsignedWireBase64,
          blockhash: built.blockhash,
          lastValidBlockHeight: built.lastValidBlockHeight,
          feePayer: built.feePayer,
          requiredSignatures: built.requiredSignatures,
          instructionCount: built.instructionCount,
          programIds: built.programIds,
          simulation,
          walletPrompts: 1,
        },
        builtAt,
        reviewExpiresAt,
        state: claim.record.state,
        attempt: claim.record.attempt,
      },
      { headers: headers(rate) },
    );
  }

  /* Narrowed by the Solana branch above, which returns. */
  const chain = route.from.network;
  const evmHandle = createEvmRpcHandle(chain);
  /* The chain id is the handle's own, rather than a ternary that had to be
     edited every time a chain was added — and was, twice. */
  const chainId = evmHandle.chain.chainId;
  const inputToken = route.from.catalog?.kind === "TOKEN" ? (route.from.catalog.address as string) : null;
  const built =
    quote.provider === "RELAY"
      ? await buildRelayEvmCalls({ quote: raw as RelayRawQuote, owner: input.owner, chainId, handle: evmHandle, inputToken, amountRaw: quote.from.amountRaw })
      : await buildEvmFastMctpCalls({
          quote: raw as MayanRawQuote,
          owner: input.owner,
          destination: input.destination,
          chainId,
          handle: evmHandle,
          inputToken,
          referrer: feeConfig.mayanReferrerSolana,
        });
  if (!built.ok) return failure(built.code === "BUILD_FAILED" ? 502 : 409, built.code, built.reason, rate);
  const swapCall = built.calls.find((call) => call.purpose === "SWAP");
  if (!swapCall) return failure(502, "BUILD_FAILED", "The plan has no swap call.", rate);
  const canaryPlanEvm = configuredState === "CANARY" ? await claimCrossSwapCanaryPlan(store, intentDigest, builtAt) : null;
  if (canaryPlanEvm && !canaryPlanEvm.ok) return failure(409, canaryPlanEvm.code, canaryPlanEvm.reason, rate, { state: "CANARY" });
  const claim = await claimCrossSwapOrder({ ...common, reviewedCallHash: sha256HexOf(`${swapCall.to.toLowerCase()}|${swapCall.data.toLowerCase()}|${swapCall.value.toLowerCase()}`) });
  if (!claim.ok) return failure(claim.code === "CROSS_SWAP_ALREADY_STARTED" ? 409 : 503, claim.code, claim.reason, rate, { state: claim.record?.state ?? null });

  return Response.json(
    {
      kind: "CROSS_SWAP",
      engine: quote.provider,
      intentDigest,
      quote,
      preSign: buildCrossSwapPreSign({
        quote,
        destinationAddress: input.destination,
        sourceWallet: input.owner,
        fromContract: route.from.catalog?.address ?? (route.from.catalog ? null : route.from.asset),
        toContract: route.to.catalog?.address ?? (route.to.catalog ? null : route.to.asset),
        gateVariable: SOLANA_CROSS_SWAP_NETWORK_STATE_ENV.robinhood,
        builtAt,
        reviewExpiresAt,
        requiresImpactAcknowledgement: band === "SEVERE",
        evm: { calls: built.calls },
      }),
      plan: {
        origin: "evm" as const,
        chain,
        chainId: built.chainId,
        calls: built.calls,
        walletPrompts: built.walletPrompts,
        allowance: built.allowance,
        gasPriceWei: built.gasPriceWei,
        totalMaximumCostWei: built.totalMaximumCostWei,
      },
      builtAt,
      reviewExpiresAt,
      state: claim.record.state,
      attempt: claim.record.attempt,
    },
    { headers: headers(rate) },
  );
}
