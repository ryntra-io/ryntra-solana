import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { isSwapNetwork, type SwapNetwork } from "@/lib/swap/catalog";
import { admitCrossSwapCanary } from "@/lib/swap/cross-swap-canary";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { effectiveCrossSwapRouteState } from "@/lib/solana/lane-state";
import { readCrossSwapCanary } from "@/lib/solana/cross-swap-canary-record";
import { quoteCrossSwap, resolveCrossSwapRoute } from "@/lib/swap/cross-swap-service";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";
import { resolveSolanaCrossSwapRouteState } from "@/lib/solana/lane-state";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Declared like its siblings: an undeclared budget is a bodyless 502 with nothing logged. */
export const maxDuration = 30;

/**
 * Live quote for a cross-chain swap — read-only, wallet-free.
 *
 * The unified card classifies FROM/TO itself and asks this route only when the
 * pair is one of the four Owner-approved cross-asset tuples; the route
 * classifies again, because a client is not the gate. It reads Mayan's price
 * API, keeps the one mechanism the lane may act on for that direction (Swift
 * from Solana, Fast MCTP from Base or Ethereum), and answers with the exact
 * expected and minimum amounts, the fees Mayan states, the time and the
 * deadline. It builds no transaction and asks for no wallet; the executable
 * path is `../plan` and `../submit`.
 *
 * The lane state rides along so the card can say "not open yet" before a
 * person reaches Review, not after.
 */

const RequestSchema = z
  .object({
    from: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    to: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    amountRaw: z.string().regex(/^[1-9][0-9]{0,29}$/),
    /** The Solana destination, when known, lets Mayan check the token account exists.
        Relay requires it: it prices the transaction it would actually build. */
    destinationAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/).optional(),
    /** The wallet that would sign on the source chain. Required by Relay-carried pairs. */
    sourceAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/).optional(),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: responseHeaders(rate) });
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success || !isSwapNetwork(parsed.data.from.network) || !isSwapNetwork(parsed.data.to.network)) {
    return failure(400, "VALIDATION_ERROR", "The quote request did not match its schema.", rate);
  }
  const input = parsed.data;

  /* `isSwapNetwork` was checked above; the assertion carries that fact past the
     schema, which can only promise a string. */
  const resolution = await resolveCrossSwapRoute(
    { network: input.from.network as SwapNetwork, asset: input.from.asset },
    { network: input.to.network as SwapNetwork, asset: input.to.asset },
  );
  if (!resolution.ok) {
    return failure(resolution.code === "NOT_A_CROSS_SWAP" ? 409 : 409, resolution.code, resolution.reason, rate, resolution.detail);
  }
  const route = resolution.route;

  const outcome = await quoteCrossSwap(route, input.amountRaw, {
    destinationAddress: input.destinationAddress,
    sourceAddress: input.sourceAddress,
    /* The card shows the fee it is about to be charged, so the quote has to be
       asked for with it. A price shown without the fee and then built with one
       is the same defect as showing one quote and signing another. */
    feeConfig: resolveServiceFeeConfig(),
    /* Ryntra's own key, so this call counts against Ryntra's rate limit rather
       than the anonymous pool and shows up in the Dashboard under the deployment
       that made it. Resolved here because this is a server route; the modules it
       calls never read the environment themselves. */
    deps: { apiKey: resolveRelayApiKey() },
  });
  if (!outcome.ok) {
    return failure(outcome.status, outcome.code, outcome.reason, rate, outcome.detail);
  }

  /* Both sides, because Robinhood Chain carries a switch of its own beneath
     the lane's and a pair is only open when every network in it is. */
  const lane = resolveSolanaCrossSwapRouteState(route.from.network, route.to.network);

  /* Under CANARY the lane is buildable for exactly one operation, so whether
     a button may be offered is not a question the pair alone can answer: it
     depends on the amount and on both wallets. The card has to be told, or it
     would either refuse the controlled operation to the one person allowed to
     make it, or offer every visitor a button that `plan` will refuse by name.
     Compared against the quote that came back rather than the request, for the
     reason `plan` gives: what is pinned is what was built. */
  const canary =
    lane === "CANARY"
      ? admitCrossSwapCanary({
          fromNetwork: route.from.network,
          fromAsset: route.from.catalog?.code ?? route.from.asset,
          amountRaw: outcome.quote.from.amountRaw,
          toNetwork: route.to.network,
          toAsset: route.to.catalog?.address ?? route.to.catalog?.code ?? route.to.asset,
          provider: outcome.quote.provider,
          slippageBps: outcome.quote.slippageBps,
          appFeeUsd: outcome.quote.serviceFee.usd ?? (outcome.quote.serviceFee.basisPoints === 0 ? 0 : null),
          /* Absent wallets cannot match a pinned address, so they refuse. */
          sourceWallet: input.sourceAddress ?? "",
          destinationWallet: input.destinationAddress ?? "",
        })
      : null;

  /* And the ledger, because a controlled operation that has already been
     attempted is closed however well the tuple matches. Without this the card
     offers a live button over a spent canary and `plan` refuses it. */
  const canaryRead = lane === "CANARY" ? await readCrossSwapCanary(getGuardRuntime().store) : null;
  const permission = effectiveCrossSwapRouteState(lane, canaryRead?.ok ? canaryRead.record : null);

  return Response.json(
    {
      kind: "CROSS_SWAP",
      /* The engine is the tuple's, so a reader of this response can see which
         provider was asked without inferring it from the pair of networks. */
      engine: outcome.quote.provider,
      tuple: route.tuple.id,
      quote: outcome.quote,
      alternatives: outcome.considered
        .filter((candidate) => candidate !== outcome.raw)
        .map((candidate) => ({
          route: candidate.type,
          expectedRaw: candidate.expectedAmountOutBaseUnits,
          minimumRaw: candidate.minAmountOutBaseUnits,
          etaSeconds: candidate.etaSeconds,
        })),
      declined: outcome.declined,
      lane,
      /* The one field a surface should gate on. `lane` alone is not enough
         under CANARY, and a client that reads it as a two-state switch reads
         a controlled operation as a closed one. */
      buildable: permission === "PLAN_AND_SUBMIT" && (lane === "OPEN" || canary?.ok === true),
      observedAt: outcome.observedAt,
    },
    { headers: responseHeaders(rate) },
  );
}
