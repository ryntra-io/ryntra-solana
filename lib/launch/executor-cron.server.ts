/**
 * The executor's minute: one pass of `runAutopilot` over the network's launches, as the scheduled route runs it.
 *
 * It runs only where the executor may — a network, Launch's operator stop open, the executor's key here (on mainnet
 * only the key of the address the attribution registry publishes) — and otherwise answers why it did not. The answer
 * names each step the pass took and the transactions it sent, nothing of the key. Two minutes that overlap never act on
 * one token together: each act holds a lease on its token.
 *
 * After the pass (SOL-L6): what failed is said to the operator in Telegram — a market paused by its risk limits,
 * transactions failing in a row, the executor's SOL low, the main node not answering, the queue lagging, the switch not
 * read, the passes silent (`./engine.server.ts`).
 */

import { lastAutopilotPass, runAutopilot, type AutopilotStats, type AutopilotStep } from "./autopilot.server.ts";
import { autopilotDeps } from "./autopilot-chain.server.ts";
import { tellOperator, type EngineTold } from "./engine.server.ts";
import { sentCount, type AutopilotPaused } from "./executor.server.ts";

/**
 * The pass stops starting new acts after this long, and signs nothing five seconds later: a send it starts (up to ~33 s
 * to confirm) is seen through inside the route's 60 s.
 */
export const EXECUTOR_CRON_BUDGET_MS = 18_000;

export type ExecutorCronAnswer =
  | Readonly<{ state: "PAUSED"; reason: AutopilotPaused }>
  | Readonly<{ state: "RAN"; network: string; executor: string; steps: readonly AutopilotStep[]; sent: number; ms: number; stats: AutopilotStats | null; told: EngineTold }>;

/** Steps said as a count in the minute's answer, not one by one: hundreds of markets with nothing to do. */
const QUIET_STEPS: ReadonlySet<string> = new Set(["ON_CURVE", "BUDGET_IN_POOL", "FLOOR_NOT_OURS", "FLOOR_NOT_THIS_PRESET", "GRADUATED_KNOWN", "BUDGET_NOTHING", "FLOOR_HOLDS", "FLOOR_SAMPLING"]);

export async function runExecutorMinute(now: () => number = Date.now): Promise<ExecutorCronAnswer> {
  const deps = autopilotDeps();
  if ("paused" in deps) return { state: "PAUSED", reason: deps.paused };
  const started = now();
  const previous = await lastAutopilotPass(deps.store, deps.network.cluster);
  const report = await runAutopilot(deps, { budgetMs: EXECUTOR_CRON_BUDGET_MS });
  const nodes = deps.chain.nodes?.() ?? null;
  const told = await tellOperator(deps.store, {
    cluster: deps.network.cluster,
    pass: report,
    previousAt: previous?.at ?? null,
    startedAt: new Date(started),
    now: new Date(now()),
    nodes,
    lamports: await deps.chain.lamports().catch(() => null),
    alert: deps.alert,
  }).catch((): EngineTold => ({ said: [], delivered: null }));
  const quiet = new Map<string, number>();
  for (const step of report.steps) if (QUIET_STEPS.has(step.step)) quiet.set(step.step, (quiet.get(step.step) ?? 0) + 1);
  return {
    state: "RAN",
    network: deps.network.cluster,
    executor: report.executor,
    steps: [...report.steps.filter((step) => !QUIET_STEPS.has(step.step)), ...[...quiet].map(([step, count]) => ({ token: `×${count}`, step }))],
    sent: sentCount(report.steps),
    ms: now() - started,
    stats: report.stats ?? null,
    told,
  };
}
