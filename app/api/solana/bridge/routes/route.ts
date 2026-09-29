import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { bridgeFailure, bridgeHeaders } from "@/lib/solana/bridge-http";
import { resolveBridgeRouteMatrix } from "@/lib/solana/bridge-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which networks the bridge offers right now, and why the others are not
 * offered.
 *
 * A read, on the read budget, with nothing to send. The card asks this once
 * when it mounts so that the network chooser it draws is the deployment's own
 * answer — Base open, Ethereum gated until its first verified transfer,
 * Robinhood Chain named as having no USDC route — rather than a list of
 * whatever some provider happens to enumerate.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  return Response.json({ data: resolveBridgeRouteMatrix() }, { headers: bridgeHeaders(rate) });
}
