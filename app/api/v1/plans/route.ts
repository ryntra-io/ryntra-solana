import { PlanCreateRequestSchema, type PlanListResponse, type PlanResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { planFailure } from "@/lib/plans/http";
import { syncMonitorsForWallet } from "@/lib/monitoring/service.server";
import { createPlan, listPlans } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The proven wallet's trading plans (`RYN-STRATEGY-PLAN-001`, contract 1.1.0):
 * `GET` lists them newest first, `POST` creates one — the rules validated and
 * sized the one way, the asset resolved from the confirmed universe, the plan
 * stored for this wallet and no other. One set of routes for the web (proof
 * cookie) and the phone (bearer); see `lib/api/v1/proof.ts`.
 */

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const listed = await listPlans(getGuardRuntime().store, proof.address);
  return apiJson({ address: proof.address, plans: [...listed.plans], total: listed.total } satisfies PlanListResponse);
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, PlanCreateRequestSchema, 32_768);
  if (!read.ok) return read.response;
  const runtime = getGuardRuntime();
  /* A plan is written once and read for weeks: the store must outlive the instance, which the runtime's own write gate decides (durable for this deployment shape); a stand with one writer passes, memory does not. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Plans need a durable store; this deployment does not have one.");
  const store = runtime.store;
  const created = await createPlan(store, { owner: proof.address, mint: read.body.asset.mint, rules: read.body.rules, activate: read.body.activate });
  if (!created.ok) return planFailure(created);
  await syncMonitorsForWallet(store, proof.address, Date.now()).catch(() => undefined);
  return apiJson({ plan: created.plan } satisfies PlanResponse, 201);
}
