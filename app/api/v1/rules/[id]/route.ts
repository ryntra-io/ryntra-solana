import { RULE_ID, type RuleDeleteResponse, type RuleResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { deleteRule, getRule } from "@/lib/autoinvest/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One rule of the proven wallet, its occurrences read through History; `DELETE` removes it — its purchases stay in History. */
export async function GET(request: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!RULE_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a rule id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await getRule(getGuardRuntime().store, proof.address, id);
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson({ rule: read.rule } satisfies RuleResponse);
}

export async function DELETE(request: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!RULE_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a rule id.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const runtime = getGuardRuntime();
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Rules need a durable store; this deployment does not have one.");
  const removed = await deleteRule(runtime.store, proof.address, id);
  if (!removed.ok) return apiFailure(removed.code, removed.message);
  return apiJson({ deleted: true, id: removed.id } satisfies RuleDeleteResponse);
}
