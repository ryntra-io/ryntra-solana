import { agentGuestDeps } from "@/app/api/v1/agent/runtime";
import { guestKeyFor } from "@/lib/assistant/guest";
import { handleGuestMessage } from "@/lib/agent/service";
import { AgentGuestRequestSchema, type AgentGuestResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { clientIp, FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A warm instance's burst bound per address; the durable day's allowance is the meter's (`reserveGuestCall`). */
const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/v1/assistant/guest` — a market question without a wallet
 * (contract 1.43.0). The same intent, tools, verifier and model as a
 * conversation, on the market alone: nothing of anyone's own is read and
 * nothing is stored but the meter. The request's address is reduced to a
 * keyed digest of the day before anything sees it; six requests a minute per address, a few
 * model answers a day per address, and past them the answer is still given
 * — composed from the reads.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  /* The key is an HMAC under the deployment's existing token secret: no new secret, and nothing without one. */
  const secret = process.env.BETA_TOKEN_SECRET?.trim();
  if (!secret) return apiFailure("UNAVAILABLE", "The assistant's guest mode is not configured on this deployment.");
  const guest = guestKeyFor(clientIp(request.headers), secret, Date.now());
  const rate = limiter.consume(guest);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many questions in a minute; ask again shortly.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, AgentGuestRequestSchema, 8_192);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The assistant needs a durable store; this deployment does not have one.");
  const deps = await agentGuestDeps();
  const result = await handleGuestMessage(deps, { guest, text: read.body.text, locale: read.body.locale, context: read.body.context });
  if (!result.ok) return apiFailure(result.code, result.reason);
  return apiJson(result.response satisfies AgentGuestResponse, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
