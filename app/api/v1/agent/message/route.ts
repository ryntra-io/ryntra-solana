import { AgentMessageRequestSchema, type AgentMessageResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { handleAgentMessage } from "@/lib/agent/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { agentDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/agent/message` — the person's words into the proven wallet's
 * session, Ryn's structured answer back (contract 1.8.0). The tools read
 * through the existing services for this wallet only; a request to execute is
 * refused and prepared for the Review; a request for a secret is refused. Over
 * the budget: `AGENT_BUDGET_EXHAUSTED` never hides an answer — the answer is
 * composed deterministically and the budget state on the response says why
 * the model was not called; `AGENT_BUSY` while a question of the same wallet
 * is being answered.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AgentMessageRequestSchema, 8_192);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The agent needs a durable store; this deployment does not have one.");
  const deps = await agentDepsFor(request, proof.address);
  const result = await handleAgentMessage(deps, { owner: proof.address, sessionId: read.body.sessionId, text: read.body.text, locale: read.body.locale });
  if (!result.ok) return apiFailure(result.code, result.reason);
  return apiJson(result.response satisfies AgentMessageResponse);
}
