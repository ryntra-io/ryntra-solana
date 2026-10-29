import { creditsContextForWallet } from "@/app/api/v1/agent/runtime";
import { AssistantTaskUpdateSchema, type AssistantTasksResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readCreditsResponse } from "@/lib/assistant/credits/view";
import { resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { readTaskSurface, removeTask, taskRunsCap, updateTask } from "@/lib/assistant/tasks/service";
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
const ID = /^t_[0-9a-f]{12}$/;
const limiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const UNAVAILABLE = "Tasks need a durable store; this deployment does not have one.";

async function creditsOf(owner: string, nowMs: number) {
  const guard = getGuardRuntime();
  const context = await creditsContextForWallet(owner, nowMs);
  if (!context) return null;
  return (await readCreditsResponse(guard.store, context, nowMs)).credits;
}

/** `PATCH /api/v1/assistant/tasks/<id>` (contract 1.59.0) — «Пауза», «Продовжити» at the price shown, the rhythm, the channels. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!ID.test(id)) return apiFailure("TASK_NOT_FOUND", "No task of this wallet has that id.");
  const read = await readApiBody(request, AssistantTaskUpdateSchema, 1_024);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many changes in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  const nowMs = Date.now();
  const credits = await creditsOf(proof.address, nowMs).catch(() => null);
  const changed = await updateTask(guard.store, proof.address, id, read.body, credits?.prices.question ?? 0, nowMs, walletCap(), pool());
  if (!changed.ok) return apiFailure(changed.code, changed.reason);
  return apiJson((await readTaskSurface(guard.store, proof.address, credits, walletCap(), pool())) satisfies AssistantTasksResponse, 200, NO_STORE);
}

/** `DELETE /api/v1/assistant/tasks/<id>` — «Вимкнути»: the task is gone; the notes it left stay in the inbox. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!ID.test(id)) return apiFailure("TASK_NOT_FOUND", "No task of this wallet has that id.");
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  if (!(await removeTask(guard.store, proof.address, id))) return apiFailure("TASK_NOT_FOUND", "No task of this wallet has that id.");
  const credits = await creditsOf(proof.address, Date.now()).catch(() => null);
  return apiJson((await readTaskSurface(guard.store, proof.address, credits, walletCap(), pool())) satisfies AssistantTasksResponse, 200, NO_STORE);
}
