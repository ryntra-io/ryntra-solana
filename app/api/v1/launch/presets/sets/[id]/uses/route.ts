import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";
import { setsDeps } from "@/lib/launch/presets-market/runtime.server";
import { SetUseRequestSchema, countSetUse } from "@/lib/launch/presets-market/service.server";
import { limitSubject } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** As many as the launches an address may make in an hour, and a few more. */
const USES = new FixedWindowLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 5_000 });

/**
 * `POST /api/v1/launch/presets/sets/{id}/uses` — `{ mint }`: a coin Ryntra launched here within the day,
 * counted once for the set it started from, and only where the launch's own numbers are the set's. Answers
 * `{ counted }`. Builds and signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const deps = setsDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = USES.consume(`launch-set-uses:${limitSubject(clientIp(request.headers))}`);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, SetUseRequestSchema, 1_024);
  if (!read.ok) return read.response;
  const { id } = await context.params;
  const counted = await countSetUse(deps, id, read.body.mint);
  if (!counted.ok) return apiFailure(counted.code, counted.message);
  return apiJson({ counted: counted.counted });
}
