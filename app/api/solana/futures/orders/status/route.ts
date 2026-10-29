import { clientIp, FixedWindowLimiter } from "@/lib/http-control";
import { WALLET } from "@/lib/phoenix/market-data";
import { readOrderSignatures } from "@/lib/phoenix/orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Where an order's signature stands on the chain — landed, failed or not seen yet — and, once landed, Phoenix's record of
 * what it filled (B6b). A receipt asks it when the relay's own answer was lost, or Phoenix's record came later than the
 * landing. Without the gate on purpose: it reads one public signature and one wallet's public history, as an explorer
 * would. Its own rate limit bounds it.
 */
const STATUS_LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function GET(request: Request) {
  const rate = STATUS_LIMITER.consume(`phoenix-orders-status:${clientIp(request.headers)}`);
  const headers = { "cache-control": "private, no-store" };
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers });
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  const signatures = (params.get("signatures") ?? "").split(",").filter(Boolean);
  if (!WALLET.test(owner) || signatures.length !== 1 || !SIGNATURE.test(signatures[0]!)) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "One wallet and one signature." } }, { status: 400, headers });
  }
  const states = await readOrderSignatures(owner, signatures);
  if (!states) return Response.json({ error: { code: "UNAVAILABLE", message: "Solana did not answer." } }, { status: 503, headers });
  return Response.json({ results: signatures.map((signature, index) => ({ signature, ...states[index]! })) }, { headers });
}
