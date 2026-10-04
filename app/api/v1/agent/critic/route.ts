import { AgentLensRequestSchema, type AgentCriticResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { handleAgentCritic } from "@/lib/agent/lens/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

import { agentDepsFor } from "../runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/agent/critic` — the Critic on a subject for the proven
 * wallet (contract 1.10.0): the assumption that
 * conflicts with a figure actually read, the risk that was never
 * established, the condition of the person's own plan that is currently
 * unmet, the previous result of their own that points the other way, the
 * evidence that is stale or absent, the structure of the asset, and the
 * thesis under-specified on its own terms — with `gaps` naming what could
 * **not** be challenged, so silence is never read as agreement.
 *
 * It never says buy or sell: no finding kind carries a direction, and a
 * directive sentence is dropped before a person sees it, whoever wrote it.
 * The budget is the agent's own, exactly as on the Brief.
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
  const result = await handleAgentCritic(deps, { owner: proof.address, subject: read.body.subject, locale: read.body.locale, compose: read.body.compose });
  if (!result.ok) return apiFailure(result.code, result.reason);
  return apiJson(result.response satisfies AgentCriticResponse);
}
