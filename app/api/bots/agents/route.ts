import { answerAgents } from "@/lib/bots/agents-door.server";
import { agentsOfOwner, agentsOpen } from "@/lib/mandate/owner.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A wallet's agents, for any browser and the phone: `POST {owner}` → its mandates (the vault, the budget,
 * what is at work, the state, the autopilot on it), its autopilot and the piers its agent looks after — mainnet and
 * devnet apart, from the agent's book and the chain. Read only: this route builds, signs and moves nothing.
 *
 * Only the wallet's own: the request proves the wallet it reads (`lib/bots/agents-door.server.ts`) — 401 without a
 * proof, 403 for another wallet. Closed (404) while neither the agent's budget nor its care is open on the deployment.
 */
export async function POST(request: Request) {
  if (!agentsOpen(process.env)) return Response.json({ error: { code: "AGENTS_CLOSED", message: "Not found." } }, { status: 404, headers: { "cache-control": "no-store" } });
  return answerAgents(request, (owner) => agentsOfOwner(owner));
}
