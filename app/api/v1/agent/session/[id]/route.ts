import { AGENT_SESSION_ID, type AgentSessionResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readAgentSession } from "@/lib/agent/service";

import { agentDepsFor } from "../../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/v1/agent/session/{id}` — the proven wallet's session read back with its budget state; another wallet's id is not found. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await context.params;
  if (!AGENT_SESSION_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a session id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const deps = await agentDepsFor(request, proof.address);
  const session = await readAgentSession(deps, proof.address, id);
  if (!session) return apiFailure("AGENT_SESSION_NOT_FOUND", "No session of this wallet has that id.");
  return apiJson(session satisfies AgentSessionResponse);
}
