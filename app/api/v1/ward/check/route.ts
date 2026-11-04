import { WardCheckRequestSchema, WardCheckResponseSchema, type WardCheckResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { rateLimitHeaders } from "@/lib/http-control";
import { publicOriginOf } from "@/lib/pay/link";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { checkWard, WardInputError } from "@/lib/ward/check";
import { chainReads, recipientRead, securityRead, tokenFactsRead } from "@/lib/ward/reads.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/ward/check` — the pre-sign check (contract 1.87.0, CITY-152 phase 1; working name «ward»): one
 * transaction or one payment link in, `allow` · `warn` · `block` out, with the reasons that put it there. Public and
 * wallet-free, on the Solana read budget. It simulates and reads; it holds no key, signs, sends and stores nothing —
 * not even the bytes it was given.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const body = await readApiBody(request, WardCheckRequestSchema, 16_384);
  if (!body.ok) return body.response;

  const network = body.body.network ?? "mainnet";
  const handle = createSolanaRpcHandle({ network, timeoutMs: 6_000, retries: 1 });
  const origin = publicOriginOf(request);
  const store = body.body.link ? getGuardRuntime().store : null;
  try {
    const result = await checkWard(body.body, {
      ...chainReads(handle),
      security: network === "mainnet" ? securityRead : undefined,
      tokenFacts: network === "mainnet" ? tokenFactsRead : undefined,
      recipient: store ? recipientRead(handle, { origin, store }) : undefined,
    });
    /* Held to the published shape on the way out: an answer that drifted from the contract is not sent. */
    const answer: WardCheckResponse = WardCheckResponseSchema.parse(result);
    return apiJson(answer, 200, rateLimitHeaders(rate));
  } catch (failure) {
    if (failure instanceof WardInputError) return apiFailure("VALIDATION_ERROR", failure.message, { headers: rateLimitHeaders(rate) });
    return apiFailure("UNAVAILABLE", "The check could not be completed. Try again.", { headers: rateLimitHeaders(rate) });
  }
}
