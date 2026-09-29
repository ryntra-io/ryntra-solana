/**
 * The Brief and the Critic on a subject (`RYN-BRIEF-CRITIC-001`).
 *
 * One engine, two formats. The subject is the same `AgentContext` a
 * conversation is opened from — an asset, a plan, the portfolio, a
 * monitoring note, a page — and the tools that run for it are the same
 * Research tools of `RYN-AGENT-TEXT-001`, chosen here by the server and
 * never by a model. What comes back is a `ToolRun` per read; the Brief and
 * the Critic are compositions over those runs.
 *
 * The budget is the agent's own and there is no other: `deterministic`
 * never reaches a model and never spends, so a surface may render a Brief
 * on load; `model` takes a reservation on the wallet's existing counters,
 * writes the same receipt, and refunds when the provider was never reached.
 * Over the allowance the format is still returned — deterministically —
 * and the budget state on the response says why the model was not called.
 *
 * Nothing here executes. The tool registry asserts the boundary at module
 * load, and the two `prepare` tools are not reachable from this path at all:
 * a lens reads.
 */

import { randomBytes } from "node:crypto";

import type { AgentBrief, AgentCard, AgentContext, AgentCritic, AgentCriticFinding, AgentHandoff, AgentToolOutcome, TradingPlan } from "../../api/v1/contract.ts";
import { AGENT_CARDS_MAX, AGENT_CITATIONS_MAX, AgentBriefResponseSchema, AgentCriticResponseSchema, type AgentBriefResponse, type AgentCriticResponse } from "../../api/v1/contract.ts";
import { allowedFromRuns } from "../answer.ts";
import { readBudgetState, reserveCall, writeReceipt } from "../budget.ts";
import { AGENT_PROMPT_VERSION, safetyIdentifier } from "../model.ts";
import { CitationBook, type Locale } from "../provenance.ts";
import type { AgentDeps } from "../service.ts";
import { resolveAsset } from "../tools/readers.ts";
import { runTool } from "../tools/registry.ts";
import type { ToolContext, ToolRun } from "../tools/types.ts";
import { composeBrief } from "./brief.ts";
import { composeCritic, isDirective, isForecast } from "./critic.ts";
import type { LensFormat, LensPacket } from "./packet.ts";
import { projectReads, subjectSymbol, type LensReads } from "./reads.ts";

export type LensCompose = "deterministic" | "model";
export type { LensFormat, LensPacket };

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

/* ------------------------------------------------------------ the reads a subject needs */

type Call = Readonly<{ name: string; input: Record<string, unknown> }>;

/**
 * Which tools answer for a subject. The Critic asks for one read more than
 * the Brief where the extra read is what an argument would stand on — the
 * wallet's own memory and its history — and never for a read the Brief
 * would not have made on the same subject.
 */
export function lensTools(subject: AgentContext, format: LensFormat, plan: TradingPlan | null, symbol: string | null = null): readonly Call[] {
  switch (subject.kind) {
    case "asset": {
      const named = symbol ?? subject.symbol ?? null;
      const calls: Call[] = [{ name: "market_read", input: { query: subject.mint } }];
      calls.push({ name: "evidence_read", input: { mint: subject.mint, window: "now", symbol: named ?? undefined } });
      calls.push({ name: "evidence_read", input: { mint: subject.mint, window: "24h", symbol: named ?? undefined } });
      if (plan) calls.push({ name: "plan_read", input: { planId: plan.id } });
      /* Memory is read **scoped to this asset**: the whole wallet's record would make a Brief about an asset nothing read look as if something had been. */
      if (named) calls.push({ name: "memory_read", input: { symbol: named } });
      /* The wallet's own holdings are an RPC read: the Critic asks for them because *you already hold this* is an argument; the Brief, which loads by itself on a page, does not. */
      if (format === "critic") calls.push({ name: "holdings_read", input: {} });
      return calls;
    }
    case "plan": {
      const calls: Call[] = [{ name: "plan_read", input: { planId: subject.planId } }];
      if (plan) calls.push({ name: "market_read", input: { query: plan.asset.mint } });
      if (plan && format === "critic") calls.push({ name: "evidence_read", input: { mint: plan.asset.mint, window: "now", symbol: plan.asset.symbol } });
      calls.push({ name: "memory_read", input: { planId: subject.planId } });
      calls.push({ name: "results_read", input: { planId: subject.planId } });
      return calls;
    }
    case "portfolio":
      return [{ name: "holdings_read", input: {} }, { name: "plans_read", input: {} }, { name: "memory_read", input: {} }, { name: "monitoring_read", input: {} }, { name: "activity_read", input: { limit: 5 } }];
    case "note":
      return [{ name: "monitoring_read", input: { inboxId: subject.inboxId } }, { name: "memory_read", input: {} }];
    case "page":
      return subject.page === "results" || subject.page === "strategies"
        ? [{ name: "plans_read", input: {} }, { name: "memory_read", input: {} }, { name: "results_read", input: {} }, { name: "monitoring_read", input: {} }]
        : [{ name: "holdings_read", input: {} }, { name: "plans_read", input: {} }, { name: "memory_read", input: {} }];
  }
}

/** The plan the subject is about, read once before the tools so the tool plan can name it. */
async function subjectPlan(deps: AgentDeps, owner: string, subject: AgentContext): Promise<TradingPlan | null> {
  if (subject.kind === "plan") {
    const read = await deps.readers.plan(owner, subject.planId);
    return read.ok ? read.plan : null;
  }
  if (subject.kind === "asset") {
    const listed = await deps.readers.plans(owner);
    const onMint = listed.plans.filter((plan) => plan.asset.mint === subject.mint);
    return onMint.find((plan) => plan.status === "active") ?? onMint[0] ?? null;
  }
  return null;
}

/* ------------------------------------------------------------ the title and the handoffs */

function lensTitle(subject: AgentContext, reads: LensReads, format: LensFormat, locale: Locale): string {
  const symbol = subjectSymbol(reads);
  const head = format === "brief" ? w(locale, "Brief", "Стисло") : w(locale, "Critic", "Критик");
  switch (subject.kind) {
    case "asset":
      return `${head} · ${symbol ?? w(locale, "the asset", "актив")}`;
    case "plan":
      return `${head} · ${symbol ? w(locale, `your ${symbol} plan`, `твій план ${symbol}`) : w(locale, "your plan", "твій план")}`;
    case "portfolio":
      return `${head} · ${w(locale, "your portfolio", "твій портфель")}`;
    case "note":
      return `${head} · ${w(locale, "a monitoring note", "нотатка Нагляду")}`;
    case "page":
      return `${head} · ${w(locale, "your record", "твій запис")}`;
  }
}

function lensHandoffs(reads: LensReads, subject: AgentContext, locale: Locale): AgentHandoff[] {
  const out: AgentHandoff[] = [];
  const seen = new Set<string>();
  const push = (handoff: AgentHandoff) => {
    if (seen.has(handoff.href)) return;
    seen.add(handoff.href);
    out.push(handoff);
  };
  if (reads.plan) {
    push({ kind: "plan", href: reads.plan.href, label: w(locale, `Open the ${reads.plan.symbol} plan`, `Відкрити план ${reads.plan.symbol}`), primary: true });
  } else if (subject.kind === "asset") {
    push({ kind: "builder", href: `/app/strategies/new?mint=${subject.mint}`, label: w(locale, "Write a plan on this asset", "Написати план на цей актив"), primary: true });
  }
  for (const run of reads.runs) for (const handoff of run.handoffs) push({ ...handoff, primary: false });
  let primary = false;
  return out
    .map((handoff) => {
      if (handoff.primary && !primary) {
        primary = true;
        return handoff;
      }
      return { ...handoff, primary: false };
    })
    .slice(0, 6);
}

/* ------------------------------------------------------------ the verifier */

const NUMBER = /\d[\d,  ]*(?:[.,]\d+)?/g;

function normalise(token: string): number | null {
  const cleaned = token.replace(/[\s ]/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function figuresAllowed(text: string, allowed: ReadonlySet<number>): boolean {
  for (const match of text.matchAll(NUMBER)) {
    const value = normalise(match[0]);
    if (value === null) continue;
    if (allowed.has(value)) continue;
    let ok = false;
    for (const candidate of allowed) {
      if (candidate !== 0 && Math.abs(candidate - value) / Math.abs(candidate) <= 0.005) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

export type LensVerification<T> = Readonly<{ value: T; dropped: number }>;

/**
 * A model's Brief held to the reads: a sentence that cites an id no tool
 * made, states a figure no tool read, or tells a person what to trade is
 * dropped; a section left empty takes the deterministic sentences. The
 * result always parses.
 */
export function verifyBrief(draft: AgentBrief, packet: LensPacket, deterministic: AgentBrief): LensVerification<AgentBrief> {
  const allowed = allowedFromRuns(packet.reads.runs);
  let dropped = 0;
  const out: AgentBrief = { changed: [], matters: [], supports: [], unknown: [], checks: [], insufficient: draft.insufficient || deterministic.insufficient };
  for (const section of ["changed", "matters", "supports", "unknown", "checks"] as const) {
    const kept = draft[section]
      .map((sentence) => {
        const text = sentence.text.trim().slice(0, 400);
        const citesUnknown = sentence.cites.some((id) => !packet.citations.has(id));
        if (text.length === 0 || citesUnknown || !figuresAllowed(text, allowed) || isDirective(text) || isForecast(text)) {
          dropped += 1;
          return null;
        }
        return { text, cites: [...new Set(sentence.cites)].filter((id) => packet.citations.has(id)).slice(0, 6) };
      })
      .filter((row): row is { text: string; cites: string[] } => row !== null);
    out[section] = kept.length > 0 ? kept : deterministic[section];
  }
  return { value: out, dropped };
}

/**
 * A model's Critic held to the same reads — and to more. The model may
 * reword a finding; it may not invent one. Every finding is matched to a
 * deterministic finding by id, and the kind, the figures and the citations
 * are the deterministic ones whatever the model returned; a finding whose
 * id it made up is dropped, and so is one whose words state a figure no
 * tool read or tell a person what to trade.
 */
export function verifyCritic(draft: AgentCritic, packet: LensPacket, deterministic: AgentCritic): LensVerification<AgentCritic> {
  const allowed = allowedFromRuns(packet.reads.runs);
  const byId = new Map(deterministic.findings.map((row) => [row.id, row] as const));
  let dropped = 0;
  const findings: AgentCriticFinding[] = [];
  for (const row of draft.findings.slice(0, 12)) {
    const known = byId.get(row.id);
    if (!known) {
      dropped += 1;
      continue;
    }
    const text = row.text.trim().slice(0, 400);
    if (text.length === 0 || !figuresAllowed(text, allowed) || isDirective(text) || isForecast(text)) {
      dropped += 1;
      findings.push(known);
      continue;
    }
    findings.push({ ...known, text });
  }
  for (const row of deterministic.findings) if (!findings.some((kept) => kept.id === row.id)) findings.push(row);
  const gaps = draft.gaps
    .map((sentence) => {
      const text = sentence.text.trim().slice(0, 400);
      if (text.length === 0 || !figuresAllowed(text, allowed) || isDirective(text) || isForecast(text) || sentence.cites.some((id) => !packet.citations.has(id))) {
        dropped += 1;
        return null;
      }
      return { text, cites: [...new Set(sentence.cites)].slice(0, 6) };
    })
    .filter((row): row is { text: string; cites: string[] } => row !== null);
  return { value: { findings: findings.slice(0, 12), gaps: gaps.length > 0 ? gaps.slice(0, 6) : deterministic.gaps, insufficient: deterministic.insufficient }, dropped };
}

/* ------------------------------------------------------------ the exchange */

export type LensResult =
  | Readonly<{ ok: true; format: "brief"; response: AgentBriefResponse }>
  | Readonly<{ ok: true; format: "critic"; response: AgentCriticResponse }>
  | Readonly<{ ok: false; code: "AGENT_BUSY" | "UNAVAILABLE"; reason: string }>;

const lensTurnId = (): string => `lns_${randomBytes(12).toString("hex")}`;

export async function handleAgentLens(
  deps: AgentDeps,
  input: Readonly<{ owner: string; subject: AgentContext; locale: Locale; format: LensFormat; compose: LensCompose }>,
): Promise<LensResult> {
  const nowMs = (deps.now ?? Date.now)();
  const locale = input.locale;
  const citations = new CitationBook();
  const ctx: ToolContext = { owner: input.owner, locale, nowMs, readers: deps.readers, citations, newDraftId: () => `agd_${randomBytes(12).toString("hex")}` };

  const plan = await subjectPlan(deps, input.owner, input.subject).catch(() => null);
  /* An asset's own symbol, resolved the way the product resolves it, so memory is read for this asset and not for the whole wallet. */
  const resolved = input.subject.kind === "asset" ? await resolveAsset(deps.readers, input.subject.symbol ?? input.subject.mint).catch(() => null) : null;
  const symbol = resolved && resolved.kind !== "none" ? resolved.symbol : null;
  const runs: ToolRun[] = [];
  for (const call of lensTools(input.subject, input.format, plan, symbol)) runs.push(await runTool(call.name, call.input, ctx));

  const reads = projectReads(runs, input.subject.kind === "plan" ? input.subject.planId : (plan?.id ?? null), input.subject.kind);
  const brief = input.format === "brief" ? composeBrief(reads, locale) : null;
  const critic = input.format === "critic" ? composeCritic(reads, locale) : null;
  const packet: LensPacket = { format: input.format, subject: input.subject, locale, reads, citations, brief, critic };

  let finalBrief = brief;
  let finalCritic = critic;
  let composedBy: "model" | "deterministic" = "deterministic";

  const worthy = input.compose === "model" && deps.model !== null && deps.budget.modelEnabled && !(brief?.insufficient ?? false) && !(critic?.insufficient ?? false);
  if (worthy && deps.model) {
    const reservation = await reserveCall(deps.store, input.owner, deps.budget, nowMs);
    if (!reservation.ok) {
      if (reservation.code === "AGENT_BUSY") return { ok: false, code: "AGENT_BUSY", reason: reservation.reason };
      /* Over the allowance the format is still answered, deterministically; the budget state on the response says why. */
    } else {
      const turnId = lensTurnId();
      const composed = input.format === "brief" ? await deps.model.composeBrief?.(packet, safetyIdentifier(input.owner)) : await deps.model.composeCritic?.(packet, safetyIdentifier(input.owner));
      if (composed && composed.ok) {
        if (composed.format === "brief" && brief) finalBrief = verifyBrief(composed.brief, packet, brief).value;
        if (composed.format === "critic" && critic) finalCritic = verifyCritic(composed.critic, packet, critic).value;
        composedBy = "model";
        await writeReceipt(deps.store, { owner: input.owner, sessionId: `lens:${input.format}`, turnId, model: deps.model.name, promptVersion: AGENT_PROMPT_VERSION, phase: "answer", tokens: composed.usage, latencyMs: Math.round(composed.latencyMs), outcome: "ok", at: new Date(nowMs).toISOString() }).catch(() => null);
      } else if (composed) {
        if (!composed.reached) await reservation.refund();
        await writeReceipt(deps.store, { owner: input.owner, sessionId: `lens:${input.format}`, turnId, model: deps.model.name, promptVersion: AGENT_PROMPT_VERSION, phase: "answer", tokens: composed.usage, latencyMs: Math.round(composed.latencyMs), outcome: composed.outcome, at: new Date(nowMs).toISOString() }).catch(() => null);
      } else {
        await reservation.refund();
      }
      await reservation.release();
    }
  }

  const budget = await readBudgetState(deps.store, input.owner, deps.budget, nowMs);
  const cards: AgentCard[] = runs.flatMap((run) => run.cards).slice(0, AGENT_CARDS_MAX);
  const tools: AgentToolOutcome[] = runs.map((run) => ({ tool: run.tool, kind: run.kind, outcome: run.outcome, state: run.state, latencyMs: 0 })).slice(0, 16);
  const shared = {
    subject: input.subject,
    title: lensTitle(input.subject, reads, input.format, locale),
    cards,
    citations: citations.list().slice(0, AGENT_CITATIONS_MAX),
    handoffs: lensHandoffs(reads, input.subject, locale),
    tools,
    composedBy,
    budget,
    observedAt: new Date(nowMs).toISOString(),
  };
  if (input.format === "brief" && finalBrief) return { ok: true, format: "brief", response: AgentBriefResponseSchema.parse({ format: "brief", brief: finalBrief, ...shared }) };
  if (input.format === "critic" && finalCritic) return { ok: true, format: "critic", response: AgentCriticResponseSchema.parse({ format: "critic", critic: finalCritic, ...shared }) };
  return { ok: false, code: "UNAVAILABLE", reason: "The format could not be composed." };
}

/** The Brief and the Critic on one subject, for the conversation's turn — the reads are made once and both formats stand on them. */
export async function composeLensForTurn(
  runs: readonly ToolRun[],
  subjectPlanId: string | null,
  locale: Locale,
  want: Readonly<{ brief: boolean; critic: boolean }>,
): Promise<Readonly<{ brief: AgentBrief | null; critic: AgentCritic | null }>> {
  const reads = projectReads(runs, subjectPlanId);
  return { brief: want.brief ? composeBrief(reads, locale) : null, critic: want.critic ? composeCritic(reads, locale) : null };
}

/** The Brief, typed: the route's `satisfies` needs the one shape, not the union. */
export async function handleAgentBrief(
  deps: AgentDeps,
  input: Readonly<{ owner: string; subject: AgentContext; locale: Locale; compose: LensCompose }>,
): Promise<Readonly<{ ok: true; response: AgentBriefResponse }> | Readonly<{ ok: false; code: "AGENT_BUSY" | "UNAVAILABLE"; reason: string }>> {
  const result = await handleAgentLens(deps, { ...input, format: "brief" });
  if (!result.ok) return result;
  if (result.format !== "brief") return { ok: false, code: "UNAVAILABLE", reason: "The Brief could not be composed." };
  return { ok: true, response: result.response };
}

/** The Critic, typed, for the same reason. */
export async function handleAgentCritic(
  deps: AgentDeps,
  input: Readonly<{ owner: string; subject: AgentContext; locale: Locale; compose: LensCompose }>,
): Promise<Readonly<{ ok: true; response: AgentCriticResponse }> | Readonly<{ ok: false; code: "AGENT_BUSY" | "UNAVAILABLE"; reason: string }>> {
  const result = await handleAgentLens(deps, { ...input, format: "critic" });
  if (!result.ok) return result;
  if (result.format !== "critic") return { ok: false, code: "UNAVAILABLE", reason: "The Critic could not be composed." };
  return { ok: true, response: result.response };
}
