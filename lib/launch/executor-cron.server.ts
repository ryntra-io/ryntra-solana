/**
 * The executor's minute: one pass of `runAutopilot` over the network's launches, as the scheduled route runs it.
 *
 * It runs only where the executor may — a network, Launch's operator stop open, the executor's key here (on mainnet
 * only the key of the address the attribution registry publishes) — and otherwise answers why it did not. The answer
 * names each step the pass took and the transactions it sent, nothing of the key. Two minutes that overlap never act on
 * one token together: each act holds a lease on its token.
 */

import { runAutopilot, type AutopilotStep } from "./autopilot.server.ts";
import { autopilotDeps } from "./autopilot-chain.server.ts";
import { sentCount, type AutopilotPaused } from "./executor.server.ts";

/**
 * The pass stops starting new acts after this long, and signs nothing five seconds later: a send it starts (up to ~33 s
 * to confirm) is seen through inside the route's 60 s.
 */
export const EXECUTOR_CRON_BUDGET_MS = 18_000;

export type ExecutorCronAnswer =
  | Readonly<{ state: "PAUSED"; reason: AutopilotPaused }>
  | Readonly<{ state: "RAN"; network: string; executor: string; steps: readonly AutopilotStep[]; sent: number; ms: number }>;

export async function runExecutorMinute(now: () => number = Date.now): Promise<ExecutorCronAnswer> {
  const deps = autopilotDeps();
  if ("paused" in deps) return { state: "PAUSED", reason: deps.paused };
  const started = now();
  const report = await runAutopilot(deps, { budgetMs: EXECUTOR_CRON_BUDGET_MS });
  return {
    state: "RAN",
    network: deps.network.cluster,
    executor: report.executor,
    steps: report.steps,
    sent: sentCount(report.steps),
    ms: now() - started,
  };
}

