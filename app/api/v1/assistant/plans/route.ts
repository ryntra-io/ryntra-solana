import { AssistantPlanCreateSchema, type AssistantPlansResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { createAssistantPlan, listAssistantPlansAnswer } from "@/lib/assistant/plans/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

import { localeOf, NO_STORE, planAnswer } from "./http";
import { planDepsFor } from "./runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The plan, its judge, the critic, its judge — 30 + 8 + 30 + 8 s at most, inside the agent's 90 s lease; the reads and the writes beside them. */
export const maxDuration = 120;

/** Six plans a minute per wallet on a warm instance: a person composes one, a script would compose hundreds. */
const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `GET /api/v1/assistant/plans` (contract 1.61.0) — the proven wallet's
 * trade plans, each with its state brought level with the person's Trading
 * Plan and Нагляд, and what a plan with its critic costs. Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  const deps = await planDepsFor(request, proof.address);
  return apiJson((await listAssistantPlansAnswer(deps, proof.address, localeOf(request))) satisfies AssistantPlansResponse, 200, NO_STORE);
}

/**
 * `POST /api/v1/assistant/plans` — compose a plan with its critic from the
 * person's idea, their loss limit or budget and any level they know, at the
 * price they were shown (`acceptCredits`). Writes only the wallet's own
 * plan; quotes, builds, signs and sends nothing.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantPlanCreateSchema, 4_096);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many plans in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Trade plans need a durable store; this deployment does not have one.");
  const deps = await planDepsFor(request, proof.address);
  const body = read.body;
  const answer = await createAssistantPlan(deps, proof.address, { mint: body.mint, idea: body.idea, riskUsd: body.riskUsd, budgetUsd: body.budgetUsd, entryUsd: body.entryUsd, maxPriceUsd: body.maxPriceUsd, invalidationUsd: body.invalidationUsd, targetsUsd: body.targetsUsd, horizonDays: body.horizonDays, draftId: body.draftId, acceptCredits: body.acceptCredits, locale: body.locale });
  return planAnswer(answer, rateLimitHeaders(rate));
}
