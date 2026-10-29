import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { WALLET } from "@/lib/phoenix/market-data";
import { readOrderStates } from "@/lib/phoenix/orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Whether a wallet may place Phoenix orders now (B6b), the canary's notional ceiling, and whether a builder's fee rides on
 * them, and its rate as the chain holds it. A wallet the gate does not admit reads the same answer as a closed gate. Builds nothing.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers: { "cache-control": "private, no-store" } });
  const owner = new URL(request.url).searchParams.get("owner");
  return Response.json(await readOrderStates(owner && WALLET.test(owner) ? owner : null), { headers: { "cache-control": "private, no-store" } });
}
