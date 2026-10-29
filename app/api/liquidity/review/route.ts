import { reviewLiquidityAction } from "@/lib/liquidity/studio/actions.server";
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from "@/lib/liquidity/studio/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Review of a pool action — add, withdraw or claim on Meteora DLMM or DAMM
 * v2: the venue previews it on the chain and builds the transactions, every
 * one is checked to call only the venue and simulated, and the answer is what
 * Review shows with a ticket that seals those exact bytes. Nothing is signed or
 * sent here, and no fee of Ryntra's is added.
 */
export async function POST(request: Request) {
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const owner = (door.body as { request?: { owner?: unknown } } | null)?.request?.owner;
  if (typeof owner === "string" && door.mismatch(owner)) return liquidityFailure(403, "WALLET_MISMATCH", "The session's wallet is not this action's wallet.", door.rate);
  const reviewed = await reviewLiquidityAction(door.body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  return Response.json(reviewed.value, { headers: liquidityHeaders(door.rate) });
}
