import { agentsOfOwner, agentsOpen } from "@/lib/mandate/owner.server";
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from "@/lib/liquidity/studio/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/**
 * CITY-207 — a wallet's agents, for any browser and the phone: `POST {owner}` → its mandates (the vault, the budget,
 * what is at work, the state, the autopilot on it), its autopilot and the piers its agent looks after — mainnet and
 * devnet apart, from the agent's book and the chain. Read only: this route builds, signs and moves nothing.
 *
 * The door is the care's (`/api/city/earn/care`): a browser from this site, or the phone's bearer — which reads only
 * its own wallet. Closed (404) while neither the agent's budget nor its care is open on the deployment.
 */
export async function POST(request: Request) {
  if (!agentsOpen(process.env)) return Response.json({ error: { code: "AGENTS_CLOSED", message: "Not found." } }, { status: 404, headers: { "cache-control": "no-store" } });
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const body = (door.body ?? {}) as Record<string, unknown>;
  const owner = typeof body.owner === "string" ? body.owner : "";
  if (!Base58.test(owner)) return liquidityFailure(400, "VALIDATION_ERROR", "Not an address.", door.rate);
  if (door.mismatch(owner)) return liquidityFailure(403, "WALLET_MISMATCH", "The session's wallet is not this wallet.", door.rate);
  const agents = await agentsOfOwner(owner).catch(() => null);
  if (!agents) return liquidityFailure(503, "UNAVAILABLE", "The agent's book did not answer.", door.rate);
  return Response.json(agents, { headers: liquidityHeaders(door.rate) });
}
