import { isPoolAddress } from "@/lib/liquidity/catalog/model";
import { liquidityActionStates } from "@/lib/liquidity/studio/gate";
import { ticketKeyConfigured } from "@/lib/liquidity/studio/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a wallet may do on a pool now — add, withdraw, claim — as the core's
 * capability states, with the most an add may put in when there is a ceiling.
 * A wallet the gate does not admit reads the same answer as under a closed
 * gate. Reads nothing from the chain.
 */
export function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner");
  const wallet = owner && isPoolAddress(owner) ? owner : null;
  /* Without the key that seals a Review nothing can be built, so the gate reads as closed. */
  const states = liquidityActionStates(wallet, ticketKeyConfigured(process.env) ? process.env : {});
  return Response.json(states, { headers: { "cache-control": "private, no-store" } });
}
