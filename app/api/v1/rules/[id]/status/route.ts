import { RULE_ID, RuleStatusRequestSchema, type RuleResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { setRuleStatus } from "@/lib/autoinvest/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { readsEnabledReference, ruleForReader } from "@/lib/autoinvest/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Pause a rule, or turn it on again — the next reminder counted from now; nothing a pause skipped is caught up. */
export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!RULE_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a rule id.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, RuleStatusRequestSchema, 1_024);
  if (!body.ok) return body.response;
  const runtime = getGuardRuntime();
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Rules need a durable store; this deployment does not have one.");
  const changed = await setRuleStatus(runtime.store, proof.address, id, body.body.status);
  if (!changed.ok) return apiFailure(changed.code, changed.message);
  return apiJson({ rule: ruleForReader(changed.rule, readsEnabledReference(proof.carrier, request.headers)) } satisfies RuleResponse);
}
