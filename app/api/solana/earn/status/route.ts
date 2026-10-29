import { readEarnSignatures } from "@/lib/earn/service.server";
import { signaturesParam } from "@/lib/earn/routes";
import { clientIp, FixedWindowLimiter } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where a signed Earn action stands on the chain — landed, failed, or not seen yet.
 *
 * A receipt asks this when the relay's own answer was lost on the way back, so a person is never told that
 * nothing moved when it did. Outside the gate on purpose: it reads one public signature as an explorer would,
 * and a receipt must still be able to learn how its transaction ended after the gate has closed.
 */
const STATUS_LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });

export async function GET(request: Request) {
  const rate = STATUS_LIMITER.consume(`earn-status:${clientIp(request.headers)}`);
  const headers = { "cache-control": "private, no-store" };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const signatures = signaturesParam(new URL(request.url).searchParams.get("signatures"));
  if (signatures.length === 0) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "A signature." } }, { status: 400, headers });
  }
  return Response.json({ results: await readEarnSignatures(signatures) }, { headers });
}
