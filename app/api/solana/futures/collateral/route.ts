import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { readCollateralStates } from "@/lib/phoenix/collateral.server";
import { WALLET } from "@/lib/phoenix/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * What a wallet may do with its Phoenix collateral now — deposit, withdraw — and the USDC it holds for a deposit (B6).
 * A wallet the gate does not admit reads the same answer as a closed gate. Builds nothing.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers: { "cache-control": "private, no-store" } });
  const owner = new URL(request.url).searchParams.get("owner");
  const states = await readCollateralStates(owner && WALLET.test(owner) ? owner : null);
  return Response.json(states, { headers: { "cache-control": "private, no-store" } });
}
