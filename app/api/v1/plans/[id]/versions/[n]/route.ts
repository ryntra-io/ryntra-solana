import { PLAN_ID, type PlanVersionResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { planFailure } from "@/lib/plans/http";
import { getPlanVersion } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One version of a plan, exactly as it stood — the rules and the size computed from them; never rewritten. */
export async function GET(request: Request, { params }: Readonly<{ params: Promise<{ id: string; n: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id, n } = await params;
  if (!PLAN_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a plan id.");
  if (!/^[1-9][0-9]{0,3}$/.test(n)) return apiFailure("VALIDATION_ERROR", "n: not a version number.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await getPlanVersion(getGuardRuntime().store, proof.address, id, Number(n));
  if (!read.ok) return planFailure(read);
  return apiJson({ planId: id, version: read.version } satisfies PlanVersionResponse);
}
