import { PLAN_ID, PlanUpdateRequestSchema, type PlanResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { planFailure } from "@/lib/plans/http";
import { getPlan, updatePlan } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * One plan of the proven wallet: `GET` reads it (the current version in
 * full, every version as a summary), `PUT` makes a new version from new
 * rules — `ifVersion` must be the version the client read, or the edit is
 * refused rather than overwriting the other client's (`PLAN_VERSION_CONFLICT`).
 * Another wallet's plan is not found, never forbidden: a plan id proves nothing.
 */

type Params = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(request: Request, { params }: Params) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a plan id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await getPlan(getGuardRuntime().store, proof.address, id);
  if (!read.ok) return planFailure(read);
  return apiJson({ plan: read.plan, sync: read.sync } satisfies PlanResponse);
}

export async function PUT(request: Request, { params }: Params) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a plan id.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, PlanUpdateRequestSchema, 32_768);
  if (!body.ok) return body.response;
  const runtime = getGuardRuntime();
  /* A plan is written once and read for weeks: the store must outlive the instance, which the runtime's own write gate decides (durable for this deployment shape); a stand with one writer passes, memory does not. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Plans need a durable store; this deployment does not have one.");
  const store = runtime.store;
  const updated = await updatePlan(store, { owner: proof.address, planId: id, rules: body.body.rules, ifVersion: body.body.ifVersion, reason: body.body.reason });
  if (!updated.ok) return planFailure(updated);
  return apiJson({ plan: updated.plan } satisfies PlanResponse);
}
