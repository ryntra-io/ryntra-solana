import { creditsContextForWallet } from "@/app/api/v1/agent/runtime";
import { AssistantTaskCreateSchema, type AssistantTasksResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readCreditsResponse } from "@/lib/assistant/credits/view";
import { resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { createTask, readTaskSurface, taskRunsCap } from "@/lib/assistant/tasks/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The wallet's share of the day's runs, from this deployment's budget. */
const walletCap = () => {
  const config = resolveAgentBudgetConfig();
  return taskRunsCap(config.dailyCalls, config.tasksGlobalDailyCalls);
};
/** Every wallet's tasks together a day — a rhythm that would overrun it is off before it is turned on. */
const pool = () => resolveAgentBudgetConfig().tasksGlobalDailyCalls;
const NO_STORE = { "cache-control": "private, no-store" } as const;
const limiter = new FixedWindowLimiter({ limit: 12, windowMs: 60_000, maxKeys: 5_000 });
const UNAVAILABLE = "Tasks need a durable store; this deployment does not have one.";

/** The wallet's credits as the price line reads them — the price of one run is the price of one question. */
async function creditsOf(owner: string, nowMs: number) {
  const guard = getGuardRuntime();
  const context = await creditsContextForWallet(owner, nowMs);
  if (!context) return null;
  return (await readCreditsResponse(guard.store, context, nowMs)).credits;
}

/**
 * `GET /api/v1/assistant/tasks` (contract 1.59.0) — the proven wallet's
 * «Доручення»: what each asks, how often, where it goes, when it runs next,
 * what it said last, and the price of a run and of a day. Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  const credits = await creditsOf(proof.address, Date.now()).catch(() => null);
  return apiJson((await readTaskSurface(guard.store, proof.address, credits, walletCap(), pool())) satisfies AssistantTasksResponse, 200, NO_STORE);
}

/**
 * `POST /api/v1/assistant/tasks` — turn a task on: what to ask, how often, where to; `acceptCredits` is the price of a
 * run the client showed. Writes only this wallet's task; signs, sends and trades nothing.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantTaskCreateSchema, 2_048);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many tasks in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  const nowMs = Date.now();
  const credits = await creditsOf(proof.address, nowMs).catch(() => null);
  const made = await createTask(guard.store, proof.address, read.body, credits?.prices.question ?? 0, nowMs, walletCap(), pool());
  if (!made.ok) return apiFailure(made.code, made.reason, { headers: rateLimitHeaders(rate) });
  return apiJson((await readTaskSurface(guard.store, proof.address, credits, walletCap(), pool())) satisfies AssistantTasksResponse, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}
