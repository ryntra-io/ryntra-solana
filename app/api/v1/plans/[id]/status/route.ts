import { PLAN_ID, PlanStatusRequestSchema, type PlanResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { planFailure } from "@/lib/plans/http";
import { syncMonitorsForWallet } from "@/lib/monitoring/service.server";
import { setPlanStatus } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Activate a draft or cancel a plan — a decision with its time and reason in the journal, never a new version. */
export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a plan id.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, PlanStatusRequestSchema, 4_096);
  if (!body.ok) return body.response;
  const runtime = getGuardRuntime();
  /* A plan is written once and read for weeks: the store must outlive the instance, which the runtime's own write gate decides (durable for this deployment shape); a stand with one writer passes, memory does not. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Plans need a durable store; this deployment does not have one.");
  const store = runtime.store;
  const changed = await setPlanStatus(store, { owner: proof.address, planId: id, status: body.body.status, ifVersion: body.body.ifVersion, reason: body.body.reason });
  if (!changed.ok) return planFailure(changed);
  await syncMonitorsForWallet(store, proof.address, Date.now()).catch(() => undefined);
  return apiJson({ plan: changed.plan } satisfies PlanResponse);
}
