import { AgentSessionOpenRequestSchema, type AgentSessionResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { openAgentSession } from "@/lib/agent/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { agentDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/agent/session` — open or resume the proven wallet's
 * conversation for a context (`RYN-AGENT-TEXT-001`, contract 1.8.0). One
 * route for the web (proof cookie) and the phone (bearer). The session is
 * durable: it needs a store that outlives the instance, and says so.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AgentSessionOpenRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The agent needs a durable store; this deployment does not have one.");
  const deps = await agentDepsFor(request, proof.address);
  const opened = await openAgentSession(deps, { owner: proof.address, locale: read.body.locale, context: read.body.context, sessionId: read.body.sessionId });
  if (!opened.ok) return apiFailure(opened.code, opened.code === "AGENT_SESSION_NOT_FOUND" ? "No session of this wallet has that id." : "The session could not be opened; try again.");
  return apiJson(opened.response satisfies AgentSessionResponse, opened.opened ? 201 : 200);
}
