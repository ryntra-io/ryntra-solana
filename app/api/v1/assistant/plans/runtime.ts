import { agentDepsFor, fixturesOn } from "@/app/api/v1/agent/runtime";
import type { PlanPosition, PlanResult, TradingPlan } from "@/lib/api/v1/contract";
import { findRowFixture, readMarketFixture } from "@/lib/agent/fixtures";
import { creditsContextFor } from "@/lib/agent/service";
import { createFixturePlanModel, createOpenAiPlanModel } from "@/lib/assistant/plans/model";
import type { MonitoringPort, PlanDeps, TradingPlansPort } from "@/lib/assistant/plans/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import type { GuardStore } from "@/lib/guard/store";
import { syncMonitorsForWallet } from "@/lib/monitoring/service.server";
import { listInbox, listMonitors } from "@/lib/monitoring/store";
import { createPlan, getPlan, getPlanResults, setPlanStatus } from "@/lib/plans/service";

/**
 * The trade plan's dependencies for one request (AI-11): the agent's own
 * readers, budget and credits for the proven wallet; the strong model where
 * the agent's model is on (the fixture on the stand, where nothing is
 * spent); the person's Trading Plans through the plan engine's own service;
 * Нагляд's monitors and notes for what it says of a plan. Nothing here
 * signs, sends or trades.
 */

function tradingPlans(store: GuardStore): TradingPlansPort {
  /* The stand's plans resolve their asset on the fixture market, as the fixture world's own plans do. */
  const deps = fixturesOn() ? { findRow: findRowFixture, readMarket: readMarketFixture } : {};
  return {
    async create(owner, mint, rules, activate) {
      const made = await createPlan(store, { owner, mint, rules, activate }, deps);
      return made.ok ? { ok: true, plan: made.plan } : { ok: false, code: made.code, message: made.message, issues: "issues" in made ? made.issues : undefined };
    },
    async read(owner, planId): Promise<TradingPlan | null> {
      const read = await getPlan(store, owner, planId, deps);
      return read.ok ? read.plan : null;
    },
    async setStatus(owner, planId, status, ifVersion, reason) {
      const set = await setPlanStatus(store, { owner, planId, status, ifVersion, reason }, deps);
      return set.ok ? { ok: true, plan: set.plan } : { ok: false, code: set.code, message: set.message };
    },
    async results(owner, planId): Promise<{ results: readonly PlanResult[]; position: PlanPosition | null; complete: boolean } | null> {
      const read = await getPlanResults(store, owner, planId, deps);
      if (!read.ok) return null;
      return { results: read.results, position: read.positions[0]?.position ?? null, complete: read.sync.state === "complete" };
    },
  };
}

function monitoring(store: GuardStore): MonitoringPort {
  /* One request reads the wallet's monitors and notes once, however many plans it projects; a sync reads them again. */
  let monitors: Promise<Awaited<ReturnType<typeof listMonitors>>> | null = null;
  let inbox: Promise<Awaited<ReturnType<typeof listInbox>>> | null = null;
  return {
    async sync(owner, nowMs) {
      await syncMonitorsForWallet(store, owner, nowMs);
      monitors = null;
      inbox = null;
    },
    async read(owner, planId, locale, since) {
      monitors ??= listMonitors(store, owner);
      const monitor = (await monitors).find((row) => row.subjectKind === "trading-plan" && row.subjectId === planId);
      if (!monitor) return null;
      inbox ??= listInbox(store, owner);
      /* A note older than the plan's current version judged levels the person has since changed. */
      const notes = (await inbox).filter((row) => row.subject?.kind === "trading-plan" && row.subject.id === planId && row.createdAt >= since);
      const latest = [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
      const hit = notes.find((row) => row.finding?.kind === "plan.invalidation" && row.finding.outcome === "fail") ?? null;
      const words = latest ? (latest.text?.[locale] ?? { title: latest.title, reason: latest.reason }) : null;
      return { status: monitor.paused ? "paused" : monitor.status, lastCheckedAt: monitor.lastCheckedAt, line: words ? `${words.title} — ${words.reason}`.slice(0, 240) : null, invalidationAt: hit?.createdAt ?? null };
    },
  };
}

export async function planDepsFor(request: Request, owner: string): Promise<PlanDeps> {
  const store = getGuardRuntime().store;
  const agent = await agentDepsFor(request, owner);
  const nowMs = Date.now();
  const credits = await creditsContextFor(agent, owner, nowMs);
  const model = agent.model === null ? null : fixturesOn() ? createFixturePlanModel({ invent: process.env.RYNTRA_AGENT_FIXTURE_INVENT === "1" }) : createOpenAiPlanModel({ env: process.env });
  return { store, readers: agent.readers, model, budget: agent.budget, credits, plans: tradingPlans(store), monitoring: monitoring(store), canWrite: getGuardRuntime().writes.allowed };
}
