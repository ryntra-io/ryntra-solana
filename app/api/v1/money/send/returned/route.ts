import { SendReturnedRequestSchema, type SendReturnedResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { readReturnedBytes } from "@/lib/solana/send-returned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/money/send/returned` — what the wallet returned, against the
 * Review it was handed (contract 1.22.0). The web's card decodes the signed
 * bytes itself and decides between `settle` and `adopt`; a phone asks here
 * instead, and the answer is the same function's (`checkReturnedBytes`).
 * Stateless and wallet-free: it moves, signs and records nothing — the
 * settle route verifies the bytes again before anything reaches the network.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, SendReturnedRequestSchema, 32_768);
  if (!read.ok) return read.response;
  const answer = await readReturnedBytes(read.body);
  return apiJson(answer satisfies SendReturnedResponse);
}
