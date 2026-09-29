import { NextResponse } from "next/server";

import { buildChallenge } from "@/lib/api/v1/auth.server";
import { ChallengeRequestSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sign-in challenge for a native client.
 *
 * The server builds the message — domain, URI, statement, nonce, expiry — and
 * the client never does: a client that supplied its own would pick its own
 * domain and expiry and every check in `verifySiws` would become a formality.
 * The client says which app version it is, and a version below the minimum
 * is told the version it needs instead of a challenge it cannot use.
 */
const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const decision = LIMITER.consume(`native-siws:${clientIp(request.headers)}`);
  if (!decision.allowed) return apiFailure("RATE_LIMITED", "Too many sign-in attempts.", { headers: rateLimitHeaders(decision) });
  const read = await readApiBody(request, ChallengeRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const url = new URL(request.url);
  const built = buildChallenge({ address: read.body.address, locale: read.body.locale, client: read.body.client, domain: url.host, uri: url.origin });
  if (!built.ok) return apiFailure(built.code, built.reason, { minimumAppVersion: built.minimumAppVersion });
  return apiJson(built.challenge) as NextResponse;
}
