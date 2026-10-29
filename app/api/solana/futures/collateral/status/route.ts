import { clientIp, FixedWindowLimiter } from "@/lib/http-control";
import { readCollateralSignatures } from "@/lib/phoenix/collateral.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where a collateral relay's signature stands on the chain — landed, failed or not seen yet — and, once landed, the
 * USDC it moved (B6). A receipt asks it when the relay's own answer was lost on the way back, so a person is never told
 * that nothing moved when it did.
 *
 * Without the gate on purpose: it builds, signs and sends nothing — it reads one public signature from the chain, as an
 * explorer would — and a receipt must still learn how its transaction ended after the gate closed. Its own rate limit
 * bounds it.
 */
const STATUS_LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function GET(request: Request) {
  const rate = STATUS_LIMITER.consume(`phoenix-collateral-status:${clientIp(request.headers)}`);
  const headers = { "cache-control": "private, no-store" };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const signatures = (new URL(request.url).searchParams.get("signatures") ?? "").split(",").filter(Boolean);
  if (signatures.length !== 1 || !SIGNATURE.test(signatures[0]!)) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "One signature." } }, { status: 400, headers });
  }
  const states = await readCollateralSignatures(signatures);
  if (!states) return Response.json({ error: { code: "UNAVAILABLE", message: "Solana did not answer." } }, { status: 503, headers });
  return Response.json({ results: signatures.map((signature, index) => ({ signature, ...states[index]! })) }, { headers });
}
