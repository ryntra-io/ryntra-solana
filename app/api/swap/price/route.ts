import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { isSwapNetwork, type SwapNetwork } from "@/lib/swap/catalog";
import { readSwapUnitPrices } from "@/lib/swap/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * What a whole unit of each named asset is worth in dollars.
 *
 * `RYN-SWAP-PREMIUM-001`. Both legs of the Swap form change together, so both
 * are asked together and one upstream request answers the screen.
 *
 * **This route decides nothing.** No amount is sized by it, no button is gated
 * on it, no plan reads it and nothing signed depends on it — what gets signed
 * is the quote's own minimum, from the rail that will fill it. An asset with no
 * price simply does not appear in the answer, and the surface renders no dollar
 * line for it, which is a state it already has. That is also why this never
 * fails: an unreachable price source returns an empty list rather than an
 * error, and the form keeps working exactly as it did before there were prices.
 *
 * It is a server route rather than a browser call for one reason worth stating:
 * a browser asking a third party about each token would tell that third party
 * which assets a person is looking at, which is nobody's business.
 */

const SideSchema = z.object({ network: z.string(), asset: z.string().min(1).max(64) }).strict();

const RequestSchema = z.object({ sides: z.array(SideSchema).min(1).max(8) }).strict();

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
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The price request did not match its schema.", rate);

  /* A side naming a network this product does not have is dropped rather than
     refused: the caller asked about several things and the others still have
     answers. */
  const sides = parsed.data.sides
    .filter((side) => isSwapNetwork(side.network))
    .map((side) => ({ network: side.network as SwapNetwork, asset: side.asset }));
  if (sides.length === 0) return Response.json({ data: { prices: [] } }, { headers: responseHeaders(rate) });

  const prices = await readSwapUnitPrices(sides);
  return Response.json({ data: { prices } }, { headers: responseHeaders(rate) });
}
