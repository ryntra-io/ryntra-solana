import { randomUUID } from "node:crypto";

import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { exchangeQuotes, resolveExchangeSide } from "@/lib/exchange/quotes.server";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { isSwapNetwork, type SwapNetwork } from "@/lib/swap/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Five executors asked at once, each under its own nine-second deadline. */
export const maxDuration = 30;

/**
 * The Exchange's quotes — read-only, wallet-optional (B9).
 *
 * One request, every executor that serves the pair asked at once: Jupiter and
 * Manifest on Solana; Relay, deBridge and Mayan across networks — each with
 * Ryntra's fee through its own parameter. The answer is the core screen's
 * `ExchangeQuote` list, Ryntra's fee route per executor, the refusals by name and
 * the prices to rank with. Nothing is built and nothing can be signed: executing a
 * chosen quote stays with the lane that carries it.
 */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/;

const RequestSchema = z
  .object({
    from: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    to: z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict(),
    amountRaw: z.string().regex(/^[1-9][0-9]{0,29}$/),
    /** The wallet that would sign on the source network; Relay prices per wallet. */
    user: z.string().regex(ADDRESS).optional(),
    /** Where the money arrives. */
    recipient: z.string().regex(ADDRESS).optional(),
    /** The screen's intent id, so a refresh answers the same exchange. */
    intentId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
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
  /* This build's Exchange sends from Solana; money arriving here from another network is the Bridge's inbound lane. */
  if (input.from.network !== "solana") return failure(409, "SOLANA_ORIGIN_ONLY", "The exchange here starts on Solana.", rate);
  const [from, to] = await Promise.all([
    resolveExchangeSide({ network: input.from.network as SwapNetwork, asset: input.from.asset }),
    resolveExchangeSide({ network: input.to.network as SwapNetwork, asset: input.to.asset }),
  ]);
  if (!from || !to) return failure(409, "TOKEN_UNKNOWN", "One of these tokens could not be identified, so no amount can be worked out for it.", rate);
  if (from.network === to.network && from.asset.toLowerCase() === to.asset.toLowerCase()) return failure(409, "SAME_ASSET", "Choose two different assets.", rate);

  const answer = await exchangeQuotes({
    intentId: input.intentId ?? randomUUID(),
    from,
    to,
    amountRaw: input.amountRaw,
    user: input.user ?? null,
    recipient: input.recipient ?? (from.network === to.network ? input.user ?? null : null),
  });
  return Response.json({ from, to, amountRaw: input.amountRaw, ...answer, observedAt: new Date().toISOString() }, { headers: responseHeaders(rate) });
}
