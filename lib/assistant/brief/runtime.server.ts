/**
 * «Ранковий огляд» on the server (AI-10) — what the cron runs every five
 * minutes, bound to the real readers and the real model.
 *
 * The model is called only when the deployment switched it on
 * (`RYNTRA_AGENT_MODEL_ENABLED=1` beside the key), on Flex; every call is
 * counted on the deployment's ceilings (`reserveScheduledCall`) and leaves a
 * priced receipt — the market's summary paid by `system_brief`, a person's
 * part by the wallet it was written for — and a `[assistant.cost]` line.
 * Nothing here signs, sends money or trades.
 */

import { promptVersionOf, safetyIdentifier, type MorningBriefResult } from "../../agent/model.ts";
import { reserveScheduledCall, resolveAgentBudgetConfig, writeReceipt, type AgentBudgetConfig } from "../../agent/budget.ts";
import type { AgentModel } from "../../agent/model.ts";
import type { AgentReaders } from "../../agent/tools/readers.ts";
import type { GuardStore } from "../../guard/store.ts";
import { costMicroUsd } from "../models.ts";
import { runBriefPass, type BriefDeps, type BriefModel } from "./run.ts";
import type { BriefRun } from "./store.ts";

/** The model with its reservation and its receipt around every call. */
export function briefModel(store: GuardStore, model: AgentModel | null, config: AgentBudgetConfig, clock: () => number = Date.now): BriefModel | null {
  if (!model?.composeMorningBrief || !config.modelEnabled) return null;
  const compose = model.composeMorningBrief.bind(model);
  return async (ask, payer) => {
    const nowMs = clock();
    const reserved = await reserveScheduledCall(store, config, nowMs);
    if (!reserved.ok) return { ok: false, outcome: reserved.code === "UNAVAILABLE" ? "unavailable" : "quota", reached: false, usage: { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }, latencyMs: 0, model: model.models?.morning_brief ?? model.name };
    /* The wallet never reaches the provider: a person's part goes under a digest of it, the market's under the platform's own. */
    const result = await compose(ask, safetyIdentifier(payer));
    /* A call that never reached the provider, or a busy Flex that answered 429 and charged nothing, gives the ceiling back. */
    if (!result.ok && (!result.reached || (result.outcome === "rate-limited" && result.usage.total === 0))) await reserved.refund();
    const outcome = result.ok ? "ok" : result.outcome;
    await writeReceipt(store, {
      owner: payer,
      sessionId: `brief:${ask.day}`,
      turnId: `${ask.scope}:${ask.day}:${nowMs.toString(16)}`,
      model: result.model,
      promptVersion: promptVersionOf("morning_brief"),
      task: "morning_brief",
      tokens: result.usage,
      latencyMs: result.latencyMs,
      outcome,
      at: new Date(nowMs).toISOString(),
      ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}),
    }).catch(() => null);
    return result;
  };
}

export function priceOf(result: MorningBriefResult): number | null {
  if (result.usage.total === 0) return result.ok ? 0 : null;
  return costMicroUsd(result.model, result.usage, result.serviceTier ?? "default");
}

export async function runMorningBriefs(input: Readonly<{ store: GuardStore; readers: BriefDeps["readers"]; model: AgentModel | null; budget?: AgentBudgetConfig; env?: Readonly<Record<string, string | undefined>>; clock?: () => number; concurrency?: number }>): Promise<BriefRun> {
  const clock = input.clock ?? Date.now;
  /* The deployment's budget, or the one the stand's dependencies carry (its fixture model switched on). */
  const config = input.budget ?? resolveAgentBudgetConfig(input.env ?? process.env);
  return runBriefPass({ store: input.store, readers: input.readers, model: briefModel(input.store, input.model, config, clock), clock, price: priceOf, ...(input.concurrency ? { concurrency: input.concurrency } : {}) });
}

export type { AgentReaders };
