import { RuleBudgetRequestSchema, type RuleBudgetResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { clearBudget, readBudget, setBudget } from "@/lib/autoinvest/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The proven wallet's «Бюджет місяця» (`RYN-INVEST-SIMPLE-001`, session 4,
 * contract 1.13.0): the person's own ceiling for every rule's purchases in a
 * calendar month on the person's own clock. `GET` reads the month as it
 * stands — settled purchases under rules, and signed ones whose outcome is
 * unknown counted as spent; `PUT` sets the ceiling; `DELETE` removes it. Only
 * the person writes it; a purchase that does not fit what is left is not
 * reminded of, and the rules stand until the 1st.
 */

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  return apiJson({ budget: await readBudget(getGuardRuntime().store, proof.address) } satisfies RuleBudgetResponse);
}

export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, RuleBudgetRequestSchema, 1_024);
  if (!read.ok) return read.response;
  const runtime = getGuardRuntime();
  /* A ceiling holds for months: the store must outlive the instance, which the runtime's own write gate decides. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "The budget needs a durable store; this deployment does not have one.");
  const written = await setBudget(runtime.store, proof.address, { capUsd: read.body.capUsd, timeZone: read.body.timeZone, locale: read.body.locale });
  if (!written.ok) return apiFailure(written.code, written.message);
  return apiJson({ budget: written.budget } satisfies RuleBudgetResponse);
}

export async function DELETE(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const runtime = getGuardRuntime();
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "The budget needs a durable store; this deployment does not have one.");
  const cleared = await clearBudget(runtime.store, proof.address);
  if (!cleared.ok) return apiFailure(cleared.code, cleared.message);
  return apiJson({ budget: cleared.budget } satisfies RuleBudgetResponse);
}
