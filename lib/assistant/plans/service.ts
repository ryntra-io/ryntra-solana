/**
 * «План угоди й критик» (AI-11) — the service.
 *
 * A plan is composed once, on the person's press, at the price they were
 * shown: the strong model drafts the plan's words and the levels the person
 * did not name (the architect), the plan engine sizes it and counts its
 * fees, its own checks run, and the same strong model under another
 * instruction argues with it (the critic). The credits are held before the
 * first call and taken only for what came back: the whole price when the
 * plan and its critic did, the plan's part when only the plan did, nothing
 * when the plan did not.
 *
 * Every change is a new version; a version is never rewritten. A plan moves
 * `draft` → `checked` (the strong critic ran on this version) → `approved`
 * (the person's word: their own Trading Plan is written from the version)
 * → `watching` (their plan is active, so Нагляд watches it) → `done` (the
 * position it opened closed) · `cancelled` · `broken` (the price reached the
 * invalidation). The person's plan may be changed on its own page; a read
 * mirrors that change here as a new version too.
 *
 * Ryntra never trades. Nothing here quotes, builds, signs, sends or approves
 * a spend: the person's Trading Plan is the furthest a press goes, and the
 * Review before any signature stays where it is (tested in
 * `plans-ai11.test.mjs`).
 */

import { randomBytes } from "node:crypto";

import type { AssistantPlan, AssistantPlanCritic, AssistantPlanFinding, AssistantPlanResponse, AssistantPlansResponse, AssistantPlanVersion, PlanAsset, PlanPosition, PlanResult, PlanRules, PlanSizing, TradingPlan } from "../../api/v1/contract.ts";
import { AssistantPlanSchema } from "../../api/v1/contract.ts";
import { readBudgetState, reserveCall, writeReceipt, type AgentBudgetConfig, type CreditsContext } from "../../agent/budget.ts";
import { readDraft } from "../../agent/drafts.ts";
import { promptVersionOf, safetyIdentifier } from "../../agent/model.ts";
import type { AgentReaders } from "../../agent/tools/readers.ts";
import type { GuardStore } from "../../guard/store.ts";
import { priceOf } from "../credits/prices.ts";
import type { ModelTask } from "../models.ts";
import { bodyFromRules, buildPlanBody, editBody, rulesOf, type PersonFigures } from "./build.ts";
import { ruleFindings, ruleGaps } from "./checks.ts";
import { criticSentences, proposalSentences, stripCritic, stripProposal, verifyArchitect, verifyCritic, type PlanModel } from "./model.ts";
import { readPlanInputs, type PlanReads } from "./reads.ts";
import { realityOf } from "./reality.ts";
import { currentVersion, ENDED_STATES, listAssistantPlans, newAssistantPlanId, PLANS_PER_WALLET, readAssistantPlan, withJournal, writeAssistantPlan, type AssistantPlanRecord } from "./store.ts";
import type { Locale } from "./words.ts";

/* ------------------------------------------------------------ the seams */

/** The person's Trading Plans, through the plan engine's own service — bound by the runtime, fixtures on the stand. */
export type TradingPlansPort = Readonly<{
  create(owner: string, mint: string, rules: PlanRules, activate: boolean): Promise<Readonly<{ ok: true; plan: TradingPlan }> | Readonly<{ ok: false; code: string; message: string; issues?: readonly Readonly<{ path: string; message: string }>[] }>>;
  read(owner: string, planId: string): Promise<TradingPlan | null>;
  setStatus(owner: string, planId: string, status: "active" | "cancelled", ifVersion: number, reason: string | null): Promise<Readonly<{ ok: true; plan: TradingPlan }> | Readonly<{ ok: false; code: string; message: string }>>;
  results(owner: string, planId: string): Promise<Readonly<{ results: readonly PlanResult[]; position: PlanPosition | null; complete: boolean }> | null>;
}>;

/** What Нагляд says of the person's plan: the monitor's status, and whether a note found the invalidation reached. */
export type WatchRead = Readonly<{ status: "watching" | "needs_attention" | "paused" | "unavailable"; lastCheckedAt: string | null; line: string | null; invalidationAt: string | null }>;
export type MonitoringPort = Readonly<{
  /** Write the monitors for the wallet's plans now, so a plan made active is watched from this moment. */
  sync(owner: string, nowMs: number): Promise<void>;
  /** `since` — the moment the person's plan took its current version: a note older than that judged other levels. */
  read(owner: string, planId: string, locale: Locale, since: string): Promise<WatchRead | null>;
}>;

export type PlanDeps = Readonly<{
  store: GuardStore;
  readers: AgentReaders;
  /** The strong model, or null — the plan is then the plan engine's own, from the person's figures, and nothing is spent. */
  model: PlanModel | null;
  budget: AgentBudgetConfig;
  credits: CreditsContext | null;
  plans: TradingPlansPort;
  monitoring: MonitoringPort;
  /** False on a deployment whose store takes no writes: a read then answers the state it finds and writes nothing. */
  canWrite?: boolean;
  now?: () => number;
  newId?: () => string;
}>;

export type PlanFailureCode = "VALIDATION_ERROR" | "PLAN_INVALID" | "ASSET_UNCONFIRMED" | "ASSISTANT_PLAN_NOT_FOUND" | "ASSISTANT_PLAN_VERSION_CONFLICT" | "ASSISTANT_PLAN_STATE_REFUSED" | "AGENT_BUSY" | "AGENT_BUDGET_EXHAUSTED" | "UNAVAILABLE";
export type PlanFailure = Readonly<{ ok: false; code: PlanFailureCode; reason: string; issues?: readonly Readonly<{ path: string; message: string }>[] }>;
export type PlanAnswer = Readonly<{ ok: true; response: AssistantPlanResponse }> | PlanFailure;

const nowOf = (deps: PlanDeps): number => (deps.now ?? Date.now)();

const modelOn = (deps: Pick<PlanDeps, "model" | "budget">): boolean => deps.model !== null && deps.budget.modelEnabled;

/** What a plan with its critic and a re-check cost here — nothing where no model composes (the plan engine's own plan is free), the credits' price otherwise. */
export function planPrices(deps: Pick<PlanDeps, "model" | "budget" | "credits">): Readonly<{ plan: number; recheck: number }> {
  /* No model composes, or no credits are served here: nothing is taken, so nothing is shown as a price. */
  if (!modelOn(deps) || !deps.credits) return { plan: 0, recheck: 0 };
  return { plan: priceOf(deps.credits.config, "plan"), recheck: priceOf(deps.credits.config, "deep") };
}

async function receipt(deps: PlanDeps, owner: string, planId: string, task: ModelTask, call: Readonly<{ model: string; usage: Parameters<typeof writeReceipt>[1]["tokens"]; latencyMs: number }>, outcome: Parameters<typeof writeReceipt>[1]["outcome"], nowMs: number): Promise<void> {
  /* Every call writes its tokens and dollars — `[assistant.cost]` in the log — whether its words were used or not. */
  await writeReceipt(deps.store, { owner, sessionId: `plan:${planId}`, turnId: `${task}:${planId}:${nowMs}`, model: call.model, promptVersion: promptVersionOf(task), task, tokens: call.usage, latencyMs: Math.round(call.latencyMs), outcome, at: new Date(nowMs).toISOString() }).catch(() => null);
}

/* ------------------------------------------------------------ the judge */

/**
 * The everyday model's verdict on every sentence a strong call wrote, after the server's own checks: what it refuses
 * — advice, a forecast, a valuation, a deed — a person never reads. `null` when it did not answer: then nothing the
 * strong call wrote is shown, as no word stands that nobody judged.
 */
async function judge(deps: PlanDeps, owner: string, planId: string, sentences: readonly string[], locale: Locale, nowMs: number): Promise<ReadonlySet<number> | null> {
  if (sentences.length === 0) return new Set();
  if (!deps.model) return null;
  const call = await deps.model.judge({ locale, sentences }, safetyIdentifier(owner));
  await receipt(deps, owner, planId, "plan_check", call, call.ok ? "ok" : call.outcome, nowMs);
  return call.ok ? call.flagged : null;
}

/* ------------------------------------------------------------ the critic */

type CriticRun = Readonly<{ critic: AssistantPlanCritic; ran: boolean }>;

async function runCritic(deps: PlanDeps, owner: string, planId: string, symbol: string, body: AssistantPlanVersion["body"], reads: PlanReads | null, locale: Locale, nowMs: number): Promise<CriticRun> {
  const rules = ruleFindings(body, reads, locale);
  const checkedAt = new Date(nowMs).toISOString();
  if (deps.model) {
    const call = await deps.model.critic({ locale, symbol, body, rules, reads }, safetyIdentifier(owner));
    await receipt(deps, owner, planId, "plan_critic", call, call.ok ? "ok" : call.outcome, nowMs);
    if (call.ok) {
      const checked = verifyCritic(call.output, body, reads);
      const verified = stripCritic(checked.value, await judge(deps, owner, planId, criticSentences(checked.value), locale, nowMs));
      if (verified.kept > 0) {
        const findings: AssistantPlanFinding[] = [...rules.filter((row) => row.severity === "major"), ...verified.value.findings, ...rules.filter((row) => row.severity !== "major")].slice(0, 16);
        return { ran: true, critic: { by: "model", model: call.model, findings, summary: verified.value.summary, gaps: [...ruleGaps(reads, true, locale), ...verified.value.gaps].slice(0, 6), checkedAt } };
      }
    }
  }
  return { ran: false, critic: { by: "rules", model: null, findings: rules, summary: null, gaps: ruleGaps(reads, false, locale).slice(0, 6), checkedAt } };
}

/** The rules alone, on a version the person changed: free, and the strong critic again only on a press. */
function rulesCritic(body: AssistantPlanVersion["body"], locale: Locale, nowMs: number): AssistantPlanCritic {
  return { by: "rules", model: null, findings: ruleFindings(body, null, locale), summary: null, gaps: ruleGaps(null, false, locale).slice(0, 6), checkedAt: new Date(nowMs).toISOString() };
}

/* ------------------------------------------------------------ compose */

export type CreateInput = Readonly<{
  mint: string;
  idea: string;
  riskUsd: number | null;
  budgetUsd: number | null;
  entryUsd: number | null;
  maxPriceUsd: number | null;
  invalidationUsd: number | null;
  targetsUsd: readonly number[];
  horizonDays: number | null;
  draftId: string | null;
  acceptCredits: number | null;
  locale: Locale;
}>;

async function draftFigures(deps: PlanDeps, owner: string, draftId: string | null, mint: string, nowMs: number): Promise<PersonFigures | null> {
  if (!draftId) return null;
  const record = await readDraft(deps.store, owner, draftId, nowMs).catch(() => null);
  if (!record || record.draft.kind !== "planDraft" || record.draft.asset.mint !== mint) return null;
  const prefill = record.draft.prefill;
  return { entryUsd: prefill.entryUsd, maxPriceUsd: prefill.maxPriceUsd, invalidationUsd: prefill.invalidationUsd, targetsUsd: prefill.targetUsd !== null ? [prefill.targetUsd] : [], riskUsd: prefill.riskUsd, budgetUsd: prefill.budgetUsd, horizonDays: prefill.validUntil ? Math.max(1, Math.min(365, Math.round((Date.parse(prefill.validUntil) - nowMs) / 86_400_000))) : null };
}

export async function createAssistantPlan(deps: PlanDeps, owner: string, input: CreateInput): Promise<PlanAnswer> {
  const nowMs = nowOf(deps);
  const locale = input.locale;
  const existing = await listAssistantPlans(deps.store, owner);
  if (existing.filter((row) => !ENDED_STATES.has(row.state)).length >= PLANS_PER_WALLET) return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: `A wallet keeps ${PLANS_PER_WALLET} open plans; end one first.` };
  const draft = await draftFigures(deps, owner, input.draftId, input.mint, nowMs);
  const person: PersonFigures = { entryUsd: input.entryUsd, maxPriceUsd: input.maxPriceUsd, invalidationUsd: input.invalidationUsd, targetsUsd: input.targetsUsd, riskUsd: input.riskUsd, budgetUsd: input.budgetUsd, horizonDays: input.horizonDays };
  if (person.riskUsd === null && person.budgetUsd === null && draft?.riskUsd == null && draft?.budgetUsd == null) return { ok: false, code: "VALIDATION_ERROR", reason: "Name your loss limit or your budget: the money is yours to decide." };

  const read = await readPlanInputs(deps.readers, input.mint, nowMs, locale);
  if (!read.ok) return { ok: false, code: read.code, reason: read.reason };
  const reads = read.reads;
  const asset: PlanAsset = reads.asset.asset;
  const id = (deps.newId ?? newAssistantPlanId)();
  const prices = planPrices(deps);

  /* Without the strong model the plan is the plan engine's own, from the person's figures — free, and said so. */
  if (!modelOn(deps)) {
    const built = buildPlanBody({ asset, idea: input.idea, person, draft, proposal: null, priceUsd: reads.priceUsd, sources: reads.sources, locale, nowMs });
    if (!built.ok) return { ok: false, code: "PLAN_INVALID", reason: "The figures do not make a plan.", issues: built.issues };
    const critic = await runCritic({ ...deps, model: null }, owner, id, asset.symbol, built.body, reads, locale, nowMs);
    return store(deps, owner, id, asset, built.body, critic.critic, locale, nowMs, { credits: 0, architect: "rules", critic: "rules" });
  }

  const reservation = await reserveCall(deps.store, owner, deps.budget, nowMs, deps.credits ? { context: deps.credits, action: "plan", acceptCredits: input.acceptCredits, idem: `plan:${id}` } : null);
  if (!reservation.ok) return { ok: false, code: reservation.code === "AGENT_BUSY" ? "AGENT_BUSY" : reservation.code === "UNAVAILABLE" ? "UNAVAILABLE" : "AGENT_BUDGET_EXHAUSTED", reason: reservation.reason };
  try {
    const architect = await deps.model!.architect({ locale, symbol: asset.symbol, kind: asset.kind ?? "stock", idea: input.idea, person: { ...person, entryUsd: person.entryUsd ?? draft?.entryUsd ?? null }, reads }, safetyIdentifier(owner));
    await receipt(deps, owner, id, "plan", architect, architect.ok ? "ok" : architect.outcome, nowMs);
    if (!architect.ok) {
      if (!architect.reached) await reservation.refund();
      else await reservation.forgive();
      return { ok: false, code: "UNAVAILABLE", reason: "The plan could not be composed right now; nothing was charged." };
    }
    const checked = verifyArchitect(architect.output, reads, person);
    const verified = stripProposal(checked.value, await judge(deps, owner, id, proposalSentences(checked.value), locale, nowMs));
    const proposal = verified.value;
    /* Not one of the model's words stood: the plan is the plan engine's own, and its part is not taken. */
    const architectStood = verified.kept > 0;
    const built = buildPlanBody({ asset, idea: input.idea, person, draft, proposal, priceUsd: reads.priceUsd, sources: reads.sources, locale, nowMs });
    if (!built.ok) {
      await reservation.forgive();
      return { ok: false, code: "PLAN_INVALID", reason: "The figures do not make a plan; nothing was charged.", issues: built.issues };
    }
    const critic = await runCritic(deps, owner, id, asset.symbol, built.body, reads, locale, nowMs);
    /* The whole price for a plan and its critic; the plan's part alone when the critic did not come back, the critic's alone when the plan's words did not stand. */
    const recheckPart = deps.credits ? Math.min(prices.recheck, reservation.credits) : 0;
    const taken = (architectStood ? reservation.credits - recheckPart : 0) + (critic.ran ? recheckPart : 0);
    const answer = await store(deps, owner, id, asset, built.body, critic.critic, locale, nowMs, { credits: taken, architect: architectStood ? "model" : "rules", critic: critic.ran ? "model" : "rules" });
    if (answer.ok) await reservation.charge(taken);
    else await reservation.forgive();
    return answer;
  } finally {
    await reservation.release();
  }
}

async function store(deps: PlanDeps, owner: string, id: string, asset: PlanAsset, body: AssistantPlanVersion["body"], critic: AssistantPlanCritic, locale: Locale, nowMs: number, spent: NonNullable<AssistantPlanResponse["spent"]>): Promise<PlanAnswer> {
  const at = new Date(nowMs).toISOString();
  const record: AssistantPlanRecord = {
    schema: "ryntra.assistant.plan",
    version: 1,
    id,
    owner,
    mint: asset.mint,
    symbol: asset.symbol,
    state: critic.by === "model" ? "checked" : "draft",
    stateReason: null,
    versions: [{ n: 1, body, critic, createdAt: at, by: "ryntra", reason: null, tradingPlanVersion: null }],
    journal: [{ at, event: "created", version: 1, note: null }, ...(critic.by === "model" ? [{ at, event: "checked" as const, version: 1, note: null }] : [])],
    tradingPlan: null,
    locale,
    createdAt: at,
    updatedAt: at,
  };
  const written = await writeAssistantPlan(deps.store, record, null).catch(() => false);
  if (!written) return { ok: false, code: "UNAVAILABLE", reason: "The plan could not be stored; try again." };
  return answerFor(deps, record, locale, nowMs, spent);
}

/* ------------------------------------------------------------ change, check again, decide */

export type EditInput = Readonly<{ ifVersion: number; thesis?: string; entryUsd?: number; maxPriceUsd?: number; invalidationUsd?: number; targetsUsd?: readonly number[]; riskUsd?: number; budgetUsd?: number; reason: string | null; locale: Locale }>;

async function readFor(deps: PlanDeps, owner: string, id: string, ifVersion: number | null): Promise<Readonly<{ ok: true; record: AssistantPlanRecord }> | PlanFailure> {
  const record = await readAssistantPlan(deps.store, owner, id);
  if (!record) return { ok: false, code: "ASSISTANT_PLAN_NOT_FOUND", reason: "No such plan for this wallet." };
  if (ifVersion !== null && currentVersion(record).n !== ifVersion) return { ok: false, code: "ASSISTANT_PLAN_VERSION_CONFLICT", reason: `The plan is at version ${currentVersion(record).n}; read it again.` };
  return { ok: true, record };
}

export async function editAssistantPlan(deps: PlanDeps, owner: string, id: string, input: EditInput): Promise<PlanAnswer> {
  const nowMs = nowOf(deps);
  const found = await readFor(deps, owner, id, input.ifVersion);
  if (!found.ok) return found;
  const record = found.record;
  /* After the approval the plan is the person's own Trading Plan: it is changed on its page, and the change comes back here as a version. */
  if (record.state !== "draft" && record.state !== "checked") return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: record.tradingPlan ? "The plan is approved: change it on its own page." : "An ended plan is not changed." };
  const change = { thesis: input.thesis, entryUsd: input.entryUsd, maxPriceUsd: input.maxPriceUsd, invalidationUsd: input.invalidationUsd, targetsUsd: input.targetsUsd, riskUsd: input.riskUsd, budgetUsd: input.budgetUsd };
  if (Object.values(change).every((value) => value === undefined)) return { ok: false, code: "VALIDATION_ERROR", reason: "Nothing to change." };
  const asset = await assetOf(deps, record);
  if (!asset) return { ok: false, code: "UNAVAILABLE", reason: "The plan engine did not answer for this token right now." };
  const built = editBody(currentVersion(record).body, change, asset, nowMs, input.locale);
  if (!built.ok) return { ok: false, code: "PLAN_INVALID", reason: "The figures do not make a plan.", issues: built.issues };
  const at = new Date(nowMs).toISOString();
  const n = currentVersion(record).n + 1;
  const next: AssistantPlanRecord = {
    ...record,
    version: record.version + 1,
    state: "draft",
    versions: [...record.versions, { n, body: built.body, critic: rulesCritic(built.body, input.locale, nowMs), createdAt: at, by: "person" as const, reason: input.reason, tradingPlanVersion: null }].slice(-50),
    journal: withJournal(record, { at, event: "edited", version: n, note: input.reason }),
    updatedAt: at,
  };
  if (!(await writeAssistantPlan(deps.store, next, record.version).catch(() => false))) return { ok: false, code: "ASSISTANT_PLAN_VERSION_CONFLICT", reason: "The plan changed meanwhile; read it again." };
  return answerFor(deps, next, input.locale, nowMs, null);
}

async function assetOf(deps: PlanDeps, record: AssistantPlanRecord): Promise<PlanAsset | null> {
  const read = await deps.readers.planAsset(record.mint).catch(() => null);
  return read && read.ok ? read.read.asset : null;
}

export async function recheckAssistantPlan(deps: PlanDeps, owner: string, id: string, input: Readonly<{ ifVersion: number; acceptCredits: number | null; locale: Locale }>): Promise<PlanAnswer> {
  const nowMs = nowOf(deps);
  const found = await readFor(deps, owner, id, input.ifVersion);
  if (!found.ok) return found;
  /* Level with the person's own plan first: the critic is paid for the version that stands, not one the plan's page replaced. */
  const record = (await syncState(deps, found.record, input.locale, nowMs)).record;
  if (currentVersion(record).n !== input.ifVersion) return { ok: false, code: "ASSISTANT_PLAN_VERSION_CONFLICT", reason: `The plan is at version ${currentVersion(record).n}: it was changed on its own page; read it again.` };
  if (ENDED_STATES.has(record.state)) return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: "An ended plan is not checked again." };
  if (!modelOn(deps)) return { ok: false, code: "UNAVAILABLE", reason: "The strong critic is not configured on this deployment." };
  const read = await readPlanInputs(deps.readers, record.mint, nowMs, input.locale);
  const reads = read.ok ? read.reads : null;
  const reservation = await reserveCall(deps.store, owner, deps.budget, nowMs, deps.credits ? { context: deps.credits, action: "deep", acceptCredits: input.acceptCredits, idem: `plan-recheck:${id}:${currentVersion(record).n}:${randomBytes(6).toString("hex")}` } : null);
  if (!reservation.ok) return { ok: false, code: reservation.code === "AGENT_BUSY" ? "AGENT_BUSY" : reservation.code === "UNAVAILABLE" ? "UNAVAILABLE" : "AGENT_BUDGET_EXHAUSTED", reason: reservation.reason };
  try {
    const body = currentVersion(record).body;
    const critic = await runCritic(deps, owner, id, record.symbol, body, reads, input.locale, nowMs);
    if (!critic.ran) {
      await reservation.forgive();
      return { ok: false, code: "UNAVAILABLE", reason: "The critic did not answer right now; nothing was charged." };
    }
    const at = new Date(nowMs).toISOString();
    const versions = record.versions.map((row, index) => (index === record.versions.length - 1 ? { ...row, critic: critic.critic } : row));
    const next: AssistantPlanRecord = { ...record, version: record.version + 1, state: record.state === "draft" ? "checked" : record.state, versions, journal: withJournal(record, { at, event: "checked", version: currentVersion(record).n, note: null }), updatedAt: at };
    if (!(await writeAssistantPlan(deps.store, next, record.version).catch(() => false))) {
      await reservation.forgive();
      return { ok: false, code: "ASSISTANT_PLAN_VERSION_CONFLICT", reason: "The plan changed meanwhile; nothing was charged." };
    }
    await reservation.charge();
    return answerFor(deps, next, input.locale, nowMs, { credits: reservation.credits, architect: "rules", critic: "model" });
  } finally {
    await reservation.release();
  }
}

/**
 * The person's word. `approved` writes their Trading Plan from the current
 * version as a draft; `watching` makes it active (writing it first when it
 * is not there yet) so Нагляд watches it; `cancelled` ends the plan, and
 * their Trading Plan with it while nothing was traded under it.
 */
export async function setAssistantPlanState(deps: PlanDeps, owner: string, id: string, input: Readonly<{ to: "approved" | "watching" | "cancelled"; ifVersion: number; locale: Locale }>): Promise<PlanAnswer> {
  const nowMs = nowOf(deps);
  const found = await readFor(deps, owner, id, input.ifVersion);
  if (!found.ok) return found;
  const synced = await syncState(deps, found.record, input.locale, nowMs);
  const record = synced.record;
  if (ENDED_STATES.has(record.state)) return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: "The plan has ended." };
  const at = new Date(nowMs).toISOString();
  const current = currentVersion(record);
  let next: AssistantPlanRecord | null = null;

  if (input.to === "cancelled") {
    if (record.tradingPlan && !synced.tradingPlan) return { ok: false, code: "UNAVAILABLE", reason: "Your plan could not be read right now, so it was not cancelled; try again." };
    if (record.tradingPlan && synced.tradingPlan && (synced.tradingPlan.status === "draft" || synced.tradingPlan.status === "active") && synced.tradingPlan.executions.length === 0) {
      const cancelled = await deps.plans.setStatus(owner, record.tradingPlan.id, "cancelled", synced.tradingPlan.version, "Cancelled in Ryntra's plan").catch(() => null);
      if (!cancelled || !cancelled.ok) return { ok: false, code: "UNAVAILABLE", reason: "Your plan could not be cancelled right now; try again." };
      await deps.monitoring.sync(owner, nowMs).catch(() => null);
    }
    next = { ...record, version: record.version + 1, state: "cancelled", stateReason: "person", journal: withJournal(record, { at, event: "cancelled", version: current.n, note: null }), updatedAt: at };
  } else if (record.tradingPlan === null) {
    if (record.state !== "draft" && record.state !== "checked") return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: "The plan cannot be approved from where it stands." };
    const made = await deps.plans.create(owner, record.mint, rulesOf(current.body, current.body.fees.costBufferBps), input.to === "watching");
    if (!made.ok) return made.code === "PLAN_INVALID" ? { ok: false, code: "PLAN_INVALID", reason: made.message, issues: made.issues } : { ok: false, code: made.code === "ASSET_UNCONFIRMED" ? "ASSET_UNCONFIRMED" : "UNAVAILABLE", reason: made.message };
    if (input.to === "watching") await deps.monitoring.sync(owner, nowMs).catch(() => null);
    const versions = record.versions.map((row, index) => (index === record.versions.length - 1 ? { ...row, tradingPlanVersion: made.plan.version } : row));
    const journal = [...withJournal(record, { at, event: "approved", version: current.n, note: null })];
    if (input.to === "watching") journal.push({ at, event: "watching", version: current.n, note: null });
    next = { ...record, version: record.version + 1, state: input.to, versions, tradingPlan: { id: made.plan.id, version: made.plan.version }, journal: journal.slice(-200), updatedAt: at };
  } else if (input.to === "watching" && record.state === "approved" && synced.tradingPlan) {
    const active = await deps.plans.setStatus(owner, record.tradingPlan.id, "active", synced.tradingPlan.version, null).catch(() => null);
    if (!active || !active.ok) return { ok: false, code: "UNAVAILABLE", reason: active && !active.ok ? active.message : "Your plan could not be made active right now; try again." };
    await deps.monitoring.sync(owner, nowMs).catch(() => null);
    next = { ...record, version: record.version + 1, state: "watching", journal: withJournal(record, { at, event: "watching", version: current.n, note: null }), updatedAt: at };
  }
  if (!next) return { ok: false, code: "ASSISTANT_PLAN_STATE_REFUSED", reason: `The plan is ${record.state}; it does not move to ${input.to}.` };
  if (!(await writeAssistantPlan(deps.store, next, record.version).catch(() => false))) {
    /* The person's plan was written for a record that changed meanwhile: it is cancelled again, so no plan is left that nothing here names. */
    if (record.tradingPlan === null && next.tradingPlan) {
      await deps.plans.setStatus(owner, next.tradingPlan.id, "cancelled", next.tradingPlan.version, "Written for a plan that changed meanwhile").catch(() => null);
      await deps.monitoring.sync(owner, nowMs).catch(() => null);
    }
    return { ok: false, code: "ASSISTANT_PLAN_VERSION_CONFLICT", reason: "The plan changed meanwhile; read it again." };
  }
  return answerFor(deps, next, input.locale, nowMs, null);
}

/* ------------------------------------------------------------ the state as the world has it */

type Synced = Readonly<{ record: AssistantPlanRecord; tradingPlan: TradingPlan | null; watch: WatchRead | null }>;

/**
 * Bring the plan level with the person's Trading Plan and with Нагляд: a
 * change made on the plan's page is a new version here, an activation or a
 * cancellation there moves the state, a closed position is `done`, a note
 * that found the invalidation reached — or the price read now at or under
 * it — is `broken`. Written once when something moved; never a guess.
 */
async function syncState(deps: PlanDeps, record: AssistantPlanRecord, locale: Locale, nowMs: number): Promise<Synced> {
  if (!record.tradingPlan || ENDED_STATES.has(record.state)) return { record, tradingPlan: null, watch: null };
  const tradingPlan = await deps.plans.read(record.owner, record.tradingPlan.id).catch(() => null);
  if (!tradingPlan) return { record, tradingPlan: null, watch: null };
  const watch = await deps.monitoring.read(record.owner, record.tradingPlan.id, locale, tradingPlan.current.createdAt).catch(() => null);
  const at = new Date(nowMs).toISOString();
  let next: AssistantPlanRecord = record;
  const journal = [...record.journal];
  let moved = false;

  if (tradingPlan.version > record.tradingPlan.version) {
    const previous = currentVersion(record);
    const body = bodyFromRules(previous.body, tradingPlan.current.rules, tradingPlan.current.sizing as PlanSizing);
    const n = previous.n + 1;
    next = { ...next, versions: [...next.versions, { n, body, critic: rulesCritic(body, locale, nowMs), createdAt: tradingPlan.current.createdAt, by: "plan-page" as const, reason: tradingPlan.current.reason, tradingPlanVersion: tradingPlan.version }].slice(-50), tradingPlan: { id: tradingPlan.id, version: tradingPlan.version } };
    journal.push({ at, event: "synced", version: n, note: tradingPlan.current.reason });
    moved = true;
  }
  const n = currentVersion(next).n;
  const end = (state: "done" | "cancelled" | "broken", reason: AssistantPlanRecord["stateReason"], event: "done" | "cancelled" | "broken") => {
    next = { ...next, state, stateReason: reason };
    journal.push({ at, event, version: n, note: null });
    moved = true;
  };
  if (tradingPlan.status === "cancelled") end("cancelled", "person", "cancelled");
  else if (tradingPlan.status === "expired" && tradingPlan.executions.length === 0) end("cancelled", "expired", "cancelled");
  else {
    if (tradingPlan.status === "active" && next.state === "approved") {
      next = { ...next, state: "watching" };
      journal.push({ at, event: "watching", version: n, note: null });
      moved = true;
    }
    if (tradingPlan.status === "executed") {
      const results = await deps.plans.results(record.owner, tradingPlan.id).catch(() => null);
      if (results?.position?.state === "closed") end("done", "position-closed", "done");
    }
    if (!ENDED_STATES.has(next.state) && next.state === "watching") {
      const invalidation = tradingPlan.current.rules.risk.invalidationPerShare;
      const market = await deps.readers.spotMarket(record.mint).catch(() => null);
      const price = market && market.ok && !market.stale ? (market.market?.price ?? null) : null;
      if (watch?.invalidationAt || (price !== null && price <= invalidation)) end("broken", "invalidation", "broken");
    }
  }
  if (!moved) return { record, tradingPlan, watch };
  const written: AssistantPlanRecord = { ...next, version: record.version + 1, journal: journal.slice(-200), updatedAt: at };
  /* A store that takes no writes: the read answers what it found, and the next read on a writable one moves it. */
  if (deps.canWrite === false) return { record: written, tradingPlan, watch };
  if (await writeAssistantPlan(deps.store, written, record.version).catch(() => false)) return { record: written, tradingPlan, watch };
  /* Lost to a concurrent writer: what that writer wrote is the plan now — never a revision this read made up. */
  const fresh = await readAssistantPlan(deps.store, record.owner, record.id).catch(() => null);
  return { record: fresh ?? record, tradingPlan, watch };
}

/* ------------------------------------------------------------ the answer */

async function project(deps: PlanDeps, record: AssistantPlanRecord, locale: Locale, nowMs: number, withReality: boolean): Promise<AssistantPlan> {
  const synced = await syncState(deps, record, locale, nowMs);
  const now = synced.record;
  const current = currentVersion(now);
  let reality: AssistantPlan["reality"] = null;
  if (withReality && now.tradingPlan) {
    const results = await deps.plans.results(now.owner, now.tradingPlan.id).catch(() => null);
    if (results) reality = realityOf({ results: results.results, position: results.position, complete: results.complete, symbol: now.symbol, feeBps: current.body.fees.ryntraFeeBps, locale });
  }
  const open = !ENDED_STATES.has(now.state);
  const tp = synced.tradingPlan;
  return AssistantPlanSchema.parse({
    id: now.id,
    mint: now.mint,
    symbol: now.symbol,
    state: now.state,
    stateReason: now.stateReason,
    version: current.n,
    current,
    versions: now.versions.map((row) => ({ n: row.n, createdAt: row.createdAt, by: row.by, reason: row.reason, critic: row.critic.by })),
    journal: now.journal.slice(-200),
    tradingPlan: now.tradingPlan ? { id: now.tradingPlan.id, status: tp?.status ?? "draft", version: tp?.version ?? now.tradingPlan.version, href: `/app/strategies/plans/${now.tradingPlan.id}` } : null,
    watch: synced.watch ? { status: synced.watch.status, lastCheckedAt: synced.watch.lastCheckedAt, line: synced.watch.line } : { status: "none", lastCheckedAt: null, line: null },
    reality,
    actions: {
      approve: now.state === "draft" || now.state === "checked",
      watch: now.state === "draft" || now.state === "checked" || now.state === "approved",
      edit: now.state === "draft" || now.state === "checked",
      recheck: open && modelOn(deps),
      cancel: open,
    },
    createdAt: now.createdAt,
    updatedAt: now.updatedAt,
  });
}

async function budgetOf(deps: PlanDeps, owner: string, nowMs: number) {
  return readBudgetState(deps.store, owner, deps.budget, nowMs, deps.credits).catch(() => null);
}

async function answerFor(deps: PlanDeps, record: AssistantPlanRecord, locale: Locale, nowMs: number, spent: AssistantPlanResponse["spent"]): Promise<PlanAnswer> {
  const plan = await project(deps, record, locale, nowMs, true);
  return { ok: true, response: { plan, prices: planPrices(deps), spent, budget: await budgetOf(deps, record.owner, nowMs) } };
}

export async function readAssistantPlanAnswer(deps: PlanDeps, owner: string, id: string, locale: Locale): Promise<PlanAnswer> {
  const record = await readAssistantPlan(deps.store, owner, id);
  if (!record) return { ok: false, code: "ASSISTANT_PLAN_NOT_FOUND", reason: "No such plan for this wallet." };
  return answerFor(deps, record, locale, nowOf(deps), null);
}

/** The wallet's plans, the newest changed first — each brought level with the world; «План проти реальності» on the plan's own read. */
export async function listAssistantPlansAnswer(deps: PlanDeps, owner: string, locale: Locale): Promise<AssistantPlansResponse> {
  const nowMs = nowOf(deps);
  const records = await listAssistantPlans(deps.store, owner);
  const plans: AssistantPlan[] = [];
  /* One at a time: a stand's single-connection store answers one query at a time. */
  for (const record of records.slice(0, 20)) plans.push(await project(deps, record, locale, nowMs, false));
  return { plans, prices: planPrices(deps), budget: await budgetOf(deps, owner, nowMs) };
}
