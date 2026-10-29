import { clientIp, FixedWindowLimiter } from "@/lib/http-control";
import { readSignatureStates } from "@/lib/liquidity/studio/actions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where a relay's signatures stand on the chain — landed, failed or not seen
 * yet. A receipt asks it when the relay's own answer was lost on the way back,
 * so a person is never told that nothing moved when it did. Read-only.
 */
const STATUS_LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function GET(request: Request) {
  const rate = STATUS_LIMITER.consume(`liquidity-status:${clientIp(request.headers)}`);
  const headers = { "cache-control": "private, no-store" };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const signatures = (new URL(request.url).searchParams.get("signatures") ?? "").split(",").filter(Boolean);
  if (signatures.length === 0 || signatures.length > 16 || !signatures.every((signature) => SIGNATURE.test(signature))) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Signatures, comma-separated, up to sixteen." } }, { status: 400, headers });
  }
  const states = await readSignatureStates(signatures);
  if (!states) return Response.json({ error: { code: "UNAVAILABLE", message: "Solana did not answer." } }, { status: 503, headers });
  return Response.json({ results: signatures.map((signature, index) => ({ signature, ...states[index]! })) }, { headers });
}
