import { AgentLensRequestSchema, type AgentBriefResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { handleAgentBrief } from "@/lib/agent/lens/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { agentDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/agent/brief` — the Brief on a subject for the proven wallet
 * (contract 1.10.0): what changed, what matters for
 * this thesis or plan, which data supports it, what is unknown, what to
 * check next — every sentence citing the read it stands on.
 *
 * The reads are the same Research tools the conversation uses, for this
 * wallet only. `compose: "deterministic"` (the default) never reaches a
 * model and never spends, so a surface may render a Brief on load;
 * `compose: "model"` takes a reservation on the wallet's **existing** agent
 * allowance and writes the same receipt. Over the allowance the Brief is
 * still answered — deterministically — and `budget` says why.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AgentLensRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The agent needs a durable store; this deployment does not have one.");
  const deps = await agentDepsFor(request, proof.address);
  const result = await handleAgentBrief(deps, { owner: proof.address, subject: read.body.subject, locale: read.body.locale, compose: read.body.compose });
  if (!result.ok) return apiFailure(result.code, result.reason);
  return apiJson(result.response satisfies AgentBriefResponse);
}
