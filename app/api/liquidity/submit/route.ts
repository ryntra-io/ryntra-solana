import { submitLiquidityAction } from "@/lib/liquidity/studio/actions.server";
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from "@/lib/liquidity/studio/http.server";
import { readTicket } from "@/lib/liquidity/studio/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The wallet's signed pool action: the bytes are held to the Review's ticket —
 * the same messages, the same wallet, every signature real — then sent once
 * each, in order, and settled from the chain's answer. A refusal before the
 * first send means nothing moved.
 */
export async function POST(request: Request) {
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const read = readTicket((door.body as { ticket?: unknown } | null)?.ticket, process.env);
  if (read.ok && door.mismatch(read.ticket.owner)) return liquidityFailure(403, "WALLET_MISMATCH", "The session's wallet is not this action's wallet.", door.rate);
  const relayed = await submitLiquidityAction(door.body);
  if (!relayed.ok) return liquidityFailure(relayed.status, relayed.code, relayed.reason, door.rate);
  return Response.json(relayed.value, { headers: liquidityHeaders(door.rate) });
}
