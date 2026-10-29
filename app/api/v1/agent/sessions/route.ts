import { type AgentSessionListResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { listAgentSessions } from "@/lib/agent/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { agentDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/agent/sessions` — the proven wallet's conversations within
 * their retention (contract 1.43.0): each one's first question, its turn
 * count, its dates and when it expires — never an answer. A conversation
 * older than its retention is removed on this read and never listed.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The agent needs a durable store; this deployment does not have one.");
  const deps = await agentDepsFor(request, proof.address);
  return apiJson((await listAgentSessions(deps, proof.address)) satisfies AgentSessionListResponse);
}
