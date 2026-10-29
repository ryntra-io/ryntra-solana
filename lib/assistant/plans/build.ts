/**
 * A trade plan's version, built — pure.
 *
 * The levels come in a fixed order of authority: the person's own figure,
 * then the conversation's draft, then the strong model's proposal (a level
 * it may suggest only inside fixed bounds around the entry, marked as
 * Ryntra's and named as an assumption the person replaces), then the plan
 * engine's rule. Money — the loss limit and the budget — is only ever the
 * person's or the draft's: no model writes it. The size is the plan engine's
 * own (`computePlanSizing`), the fees the fee policy's, so the plan, the
 * builder and the Review never disagree about the same number.
 *
 * No store, no clock of its own, no network.
 */

import type { AssistantPlanBody, AssistantPlanFees, AssistantPlanLevel, PlanAsset, PlanRules, PlanSizing } from "../../api/v1/contract.ts";
import { PlanRulesSchema, planAssetKind } from "../../api/v1/contract.ts";
import { FEE_POLICY_V2, FEE_POLICY_VERSION, MAJOR_MINTS } from "../../core/fee-policy.ts";
import { INVALIDATION_EXAMPLE_UNDER_ENTRY, MAX_PRICE_OVER_ENTRY } from "../../plans/builder-defaults.ts";
import { sizingContextOf } from "../../plans/service.ts";
import { computePlanSizing, type PlanIssue } from "../../plans/sizing.ts";
import type { PlanSource } from "./reads.ts";
import { assumptionWords, type Locale } from "./words.ts";

/** The plan engine's cost buffer at least: one per cent of the entry, the builder's own default. */
export const COST_BUFFER_BPS = 100;
/** Slippage and price impact on the way in and out, beside Ryntra's fee, inside the buffer. */
export const SLIPPAGE_BPS = 50;

/**
 * The buffer a plan sizes with: Ryntra's fee in and out plus slippage, never under the builder's one per cent. The plan
 * engine counts costs once, in this buffer (`lossPerShare`), so the size it computes keeps the person's loss limit with
 * every fee — a meme's 1 % each way is 2.5 %, a major's 0.10 % stays under the 1 %.
 */
export function costBufferFor(feeBps: number): number {
  return Math.max(COST_BUFFER_BPS, 2 * feeBps + SLIPPAGE_BPS);
}
/** Two transactions' network fees, an estimate in dollars — small, and named as an estimate. */
export const NETWORK_FEE_USD = 0.002;
/** A model's invalidation must lie within these fractions under the entry; a target within these multiples over it. */
export const PROPOSED_INVALIDATION_FLOOR = 0.5;
export const PROPOSED_TARGET_CEILING = 5;
const DAY_MS = 86_400_000;

export type PersonFigures = Readonly<{
  entryUsd: number | null;
  maxPriceUsd: number | null;
  invalidationUsd: number | null;
  targetsUsd: readonly number[];
  riskUsd: number | null;
  budgetUsd: number | null;
  horizonDays: number | null;
}>;

/** What the strong model proposed, already validated against its schema; every field may be missing. */
export type ArchitectProposal = Readonly<{
  thesis: string | null;
  whyNow: string | null;
  entryCondition: string | null;
  invalidation: Readonly<{ priceUsd: number; why: string }> | null;
  targets: readonly Readonly<{ priceUsd: number; why: string }>[];
  assumptions: readonly string[];
}>;

export type BuildInput = Readonly<{
  asset: PlanAsset;
  idea: string;
  person: PersonFigures;
  /** The conversation's draft figures, when the plan was made from one. */
  draft: PersonFigures | null;
  proposal: ArchitectProposal | null;
  priceUsd: number | null;
  sources: readonly PlanSource[];
  locale: Locale;
  nowMs: number;
}>;

export type BuildResult = Readonly<{ ok: true; body: AssistantPlanBody; rules: PlanRules }> | Readonly<{ ok: false; issues: readonly PlanIssue[] }>;

const round2 = (value: number): number => Math.round(value * 100) / 100;
/** A per-unit price the way the builder writes one: two decimals above a cent, six significant digits below. */
export function roundUnit(value: number): number {
  return value >= 0.01 ? round2(value) : Number(value.toPrecision(6));
}
const reserveFor = (budget: number): number => Math.max(0.1, Math.round(budget) / 100);

/** Ryntra's fee for a buy and a sale of this asset under fee policy 2.0.0 — the flow's rate; a new token's is the meme rate. */
export function ryntraFeeBpsOf(asset: Pick<PlanAsset, "mint" | "kind">): number {
  const kind = planAssetKind(asset);
  if (kind === "stock") return FEE_POLICY_V2.XSTOCK.bps;
  if (MAJOR_MINTS.has(asset.mint)) return FEE_POLICY_V2.MAJOR.bps;
  return kind === "meme" ? FEE_POLICY_V2.MEME.bps : FEE_POLICY_V2.TRENDING.bps;
}

/**
 * The fees and the two outcomes of a sized plan, every cost counted once: the buffer is the plan engine's place for
 * costs on the way in and out (Ryntra's fee among them — `ryntraFeeUsd` says how much of it), the network's fee beside
 * it. The loss at the invalidation is the move plus those costs; the reward at the first target is the move less them.
 */
export function feesOf(input: Readonly<{ entryUsd: number; invalidationUsd: number; targetUsd: number; units: number; feeBps: number; costBufferBps: number }>): AssistantPlanFees {
  const notional = input.units * input.entryUsd;
  const feeIn = (notional * input.feeBps) / 10_000;
  const feeOutTarget = (input.units * input.targetUsd * input.feeBps) / 10_000;
  /* A version written on the plan's page may carry a buffer under Ryntra's fee in and out: the costs counted never go under it. */
  const buffer = (notional * Math.max(input.costBufferBps, 2 * input.feeBps + SLIPPAGE_BPS)) / 10_000;
  const loss = input.units * (input.entryUsd - input.invalidationUsd) + buffer + NETWORK_FEE_USD;
  /* The buffer holds the sale's fee at the entry's price; a sale at a higher target pays more, and that part is beside it. */
  const feeOutBeyond = Math.max(0, feeOutTarget - feeIn);
  const total = buffer + feeOutBeyond + NETWORK_FEE_USD;
  const reward = input.units * (input.targetUsd - input.entryUsd) - total;
  return {
    model: "estimate-v1",
    feePolicy: FEE_POLICY_VERSION,
    ryntraFeeBps: input.feeBps,
    costBufferBps: input.costBufferBps,
    notionalUsd: round2(notional),
    ryntraFeeUsd: round2(feeIn + feeOutTarget),
    costBufferUsd: round2(buffer),
    networkUsd: NETWORK_FEE_USD,
    totalUsd: round2(total),
    lossAtInvalidationUsd: round2(loss),
    rewardAtTargetUsd: round2(reward),
    rewardToRisk: loss > 0 ? Math.round((Math.max(0, reward) / loss) * 100) / 100 : null,
  };
}

/** The Trading Plan's rules a version stands for — the shape the plan engine sizes, the builder opens and the Review judges. */
export function rulesOf(body: Pick<AssistantPlanBody, "thesis" | "entry" | "invalidation" | "lossLimit" | "targets" | "assumptions">, costBufferBps = COST_BUFFER_BPS): PlanRules {
  const horizon = body.thesis.horizonDays === null ? null : body.thesis.horizonDays <= 60 ? { unit: "days" as const, value: body.thesis.horizonDays } : { unit: "weeks" as const, value: Math.min(60, Math.ceil(body.thesis.horizonDays / 7)) };
  return PlanRulesSchema.parse({
    thesis: { text: body.thesis.text.slice(0, 2000), whyNow: body.thesis.whyNow ? body.thesis.whyNow.slice(0, 500) : null, horizon, sources: [], assumptions: body.assumptions.slice(0, 10).map((row) => row.text.slice(0, 240)) },
    entry: { pricePerShare: body.entry.priceUsd, maxPricePerShare: body.entry.maxPriceUsd, validUntil: body.entry.validUntil },
    capital: { budgetUsd: body.lossLimit.budgetUsd, reserveForCostsUsd: round2(reserveFor(body.lossLimit.budgetUsd)) },
    risk: { invalidationPerShare: body.invalidation.priceUsd, plannedRiskUsd: body.lossLimit.riskUsd, costBufferBps },
    exit: { targetPerShare: body.targets[0]?.priceUsd ?? null, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null },
    evidenceConditions: [],
  });
}

type Author = AssistantPlanLevel["by"];
const pick = <T>(...candidates: readonly (readonly [T | null | undefined, Author])[]): readonly [T, Author] | null => {
  for (const [value, by] of candidates) if (value !== null && value !== undefined) return [value, by];
  return null;
};

/** The whole version: levels by authority, money from the person, the size and the fees from the engine, every assumption named. */
export function buildPlanBody(input: BuildInput): BuildResult {
  const t = assumptionWords(input.locale);
  const { person, draft, proposal } = input;
  const assumptions: { text: string; by: Author }[] = [];

  const entryPick = pick<number>([person.entryUsd, "person"], [draft?.entryUsd, "person"], [input.priceUsd, "market"]);
  if (!entryPick) return { ok: false, issues: [{ path: "entry.pricePerShare", message: t.noEntry }] };
  const entry = roundUnit(entryPick[0]);
  if (entryPick[1] === "market") assumptions.push({ text: t.entryFromMarket(entry), by: "market" });

  const maxPick = pick<number>([person.maxPriceUsd, "person"], [draft?.maxPriceUsd, "person"]);
  const maxPrice = maxPick ? roundUnit(maxPick[0]) : roundUnit(entry * MAX_PRICE_OVER_ENTRY);
  if (!maxPick) assumptions.push({ text: t.maxPriceRule(maxPrice), by: "rules" });

  const proposedInvalidation = proposal?.invalidation && proposal.invalidation.priceUsd < entry && proposal.invalidation.priceUsd >= entry * PROPOSED_INVALIDATION_FLOOR ? proposal.invalidation : null;
  let invalidation: AssistantPlanLevel;
  if (person.invalidationUsd !== null) invalidation = { priceUsd: roundUnit(person.invalidationUsd), by: "person", why: null };
  else if (draft?.invalidationUsd != null) invalidation = { priceUsd: roundUnit(draft.invalidationUsd), by: "person", why: null };
  else if (proposedInvalidation) {
    invalidation = { priceUsd: roundUnit(proposedInvalidation.priceUsd), by: "ryntra", why: proposedInvalidation.why.slice(0, 300) };
    assumptions.push({ text: t.levelByRyntra(t.invalidationWord, invalidation.priceUsd), by: "ryntra" });
  } else {
    invalidation = { priceUsd: roundUnit(entry * INVALIDATION_EXAMPLE_UNDER_ENTRY), by: "rules", why: null };
    assumptions.push({ text: t.invalidationRule(invalidation.priceUsd), by: "rules" });
  }

  const personTargets = (person.targetsUsd.length > 0 ? person.targetsUsd : draft?.targetsUsd ?? []).filter((value) => value > entry);
  let targets: AssistantPlanLevel[] = personTargets.slice(0, 3).map((value) => ({ priceUsd: roundUnit(value), by: "person" as const, why: null }));
  if (targets.length === 0 && proposal) {
    /* A proposed target closer than the invalidation is not a plan's target: the reward would not cover the risk before fees. */
    const floor = entry + (entry - invalidation.priceUsd);
    targets = proposal.targets
      .filter((row) => row.priceUsd >= floor && row.priceUsd <= entry * PROPOSED_TARGET_CEILING)
      .slice(0, 3)
      .map((row) => ({ priceUsd: roundUnit(row.priceUsd), by: "ryntra" as const, why: row.why.slice(0, 300) }));
    if (targets.length > 0) assumptions.push({ text: t.levelByRyntra(t.targetWord, targets[0]!.priceUsd), by: "ryntra" });
  }
  if (targets.length === 0) {
    const twoR = roundUnit(entry + 2 * (entry - invalidation.priceUsd));
    targets = [{ priceUsd: twoR, by: "rules", why: null }];
    assumptions.push({ text: t.targetRule(twoR), by: "rules" });
  }
  targets.sort((a, b) => a.priceUsd - b.priceUsd);

  /* Money is the person's: a limit or a budget must be named; the other follows from it and is said. */
  let risk = person.riskUsd ?? draft?.riskUsd ?? null;
  let budget = person.budgetUsd ?? draft?.budgetUsd ?? null;
  if (risk === null && budget === null) return { ok: false, issues: [{ path: "risk.plannedRiskUsd", message: t.noMoney }] };
  const feeBps = ryntraFeeBpsOf(input.asset);
  const buffer = costBufferFor(feeBps);
  const lossPerUnit = entry - invalidation.priceUsd + (entry * buffer) / 10_000;
  if (risk === null && budget !== null) {
    risk = round2(budget / 10);
    assumptions.push({ text: t.riskFromBudget(risk), by: "rules" });
  }
  if (budget === null && risk !== null) {
    const units = lossPerUnit > 0 ? risk / lossPerUnit : 0;
    const notional = units * entry * 1.01;
    budget = Math.max(1, round2(notional + reserveFor(Math.max(1, notional))));
    assumptions.push({ text: t.budgetFromRisk(budget), by: "rules" });
  }

  const horizonDays = person.horizonDays ?? draft?.horizonDays ?? null;
  const validUntil = new Date(input.nowMs + (horizonDays ?? 30) * DAY_MS).toISOString();
  if (horizonDays === null) assumptions.push({ text: t.validityRule, by: "rules" });
  for (const text of proposal?.assumptions ?? []) if (assumptions.length < 12) assumptions.push({ text: text.slice(0, 400), by: "ryntra" });

  const thesisText = (proposal?.thesis ?? "").trim() || input.idea.trim();
  const thesis = { text: thesisText.slice(0, 600), whyNow: proposal?.whyNow ? proposal.whyNow.slice(0, 300) : null, horizonDays, by: proposal?.thesis ? ("ryntra" as const) : ("person" as const) };
  const shape = {
    thesis,
    entry: { priceUsd: entry, maxPriceUsd: maxPrice, validUntil, condition: proposal?.entryCondition ? proposal.entryCondition.slice(0, 300) : null, by: entryPick[1] },
    invalidation,
    lossLimit: { riskUsd: round2(risk!), budgetUsd: round2(budget!) },
    targets,
    assumptions: assumptions.slice(0, 12),
  };
  const parsedRules = PlanRulesSchema.safeParse(safeRules(shape, buffer));
  if (!parsedRules.success) return { ok: false, issues: parsedRules.error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
  const rules = parsedRules.data;
  const sized = computePlanSizing(rules, input.nowMs, sizingContextOf(input.asset));
  if (!sized.ok) return { ok: false, issues: sized.issues };
  const sizing: PlanSizing = sized.sizing;
  const fees = feesOf({ entryUsd: entry, invalidationUsd: invalidation.priceUsd, targetUsd: targets[0]!.priceUsd, units: sizing.units, feeBps, costBufferBps: buffer });
  return { ok: true, rules, body: { ...shape, fees, sizing, sources: input.sources.slice(0, 12) } };
}

function safeRules(shape: Parameters<typeof rulesOf>[0], costBufferBps: number): unknown {
  try {
    return rulesOf(shape, costBufferBps);
  } catch {
    return null;
  }
}

/** A version rebuilt from a person's change: the same authorities, the changed figures now the person's. */
export function editBody(previous: AssistantPlanBody, change: Readonly<{ thesis?: string; entryUsd?: number; maxPriceUsd?: number; invalidationUsd?: number; targetsUsd?: readonly number[]; riskUsd?: number; budgetUsd?: number }>, asset: PlanAsset, nowMs: number, locale: Locale): BuildResult {
  const t = assumptionWords(locale);
  const entry = change.entryUsd !== undefined ? roundUnit(change.entryUsd) : previous.entry.priceUsd;
  const maxPrice = change.maxPriceUsd !== undefined ? roundUnit(change.maxPriceUsd) : change.entryUsd !== undefined && previous.entry.maxPriceUsd === roundUnit(previous.entry.priceUsd * MAX_PRICE_OVER_ENTRY) ? roundUnit(entry * MAX_PRICE_OVER_ENTRY) : previous.entry.maxPriceUsd;
  const invalidation: AssistantPlanLevel = change.invalidationUsd !== undefined ? { priceUsd: roundUnit(change.invalidationUsd), by: "person", why: null } : previous.invalidation;
  const targets: AssistantPlanLevel[] = change.targetsUsd !== undefined ? [...change.targetsUsd].sort((a, b) => a - b).map((value) => ({ priceUsd: roundUnit(value), by: "person" as const, why: null })) : [...previous.targets];
  const lossLimit = { riskUsd: change.riskUsd !== undefined ? round2(change.riskUsd) : previous.lossLimit.riskUsd, budgetUsd: change.budgetUsd !== undefined ? round2(change.budgetUsd) : previous.lossLimit.budgetUsd };
  /* An assumption about a level the person has now written themself no longer holds. */
  const replaced = new Set<string>();
  if (change.entryUsd !== undefined) replaced.add("entry");
  if (change.maxPriceUsd !== undefined) replaced.add("max");
  if (change.invalidationUsd !== undefined) replaced.add("invalidation");
  if (change.targetsUsd !== undefined) replaced.add("target");
  if (change.riskUsd !== undefined || change.budgetUsd !== undefined) replaced.add("money");
  const assumptions = previous.assumptions.filter((row) => !t.concerns(row.text, replaced));
  const thesis = change.thesis !== undefined ? { ...previous.thesis, text: change.thesis.slice(0, 600), by: "person" as const } : previous.thesis;
  const shape = { thesis, entry: { ...previous.entry, priceUsd: entry, maxPriceUsd: maxPrice, by: change.entryUsd !== undefined ? ("person" as const) : previous.entry.by }, invalidation, lossLimit, targets, assumptions };
  const parsedRules = PlanRulesSchema.safeParse(safeRules(shape, previous.fees.costBufferBps));
  if (!parsedRules.success) return { ok: false, issues: parsedRules.error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
  const sized = computePlanSizing(parsedRules.data, nowMs, sizingContextOf(asset));
  if (!sized.ok) return { ok: false, issues: sized.issues };
  const fees = feesOf({ entryUsd: entry, invalidationUsd: invalidation.priceUsd, targetUsd: targets[0]!.priceUsd, units: sized.sizing.units, feeBps: previous.fees.ryntraFeeBps, costBufferBps: previous.fees.costBufferBps });
  return { ok: true, rules: parsedRules.data, body: { ...shape, fees, sizing: sized.sizing, sources: previous.sources } };
}

/** A version mirrored from the person's own Trading Plan, edited on its page: its rules are the truth, the rest is kept. */
export function bodyFromRules(previous: AssistantPlanBody, rules: PlanRules, sizing: PlanSizing): AssistantPlanBody {
  const sameTarget = previous.targets[0]?.priceUsd === rules.exit.targetPerShare;
  const targets: AssistantPlanLevel[] = rules.exit.targetPerShare === null ? previous.targets : sameTarget ? previous.targets : [{ priceUsd: rules.exit.targetPerShare, by: "person" as const, why: null }, ...previous.targets.slice(1).filter((row) => row.priceUsd > rules.exit.targetPerShare!)].slice(0, 3);
  const invalidation: AssistantPlanLevel = previous.invalidation.priceUsd === rules.risk.invalidationPerShare ? previous.invalidation : { priceUsd: rules.risk.invalidationPerShare, by: "person", why: null };
  const fees = feesOf({ entryUsd: rules.entry.pricePerShare, invalidationUsd: rules.risk.invalidationPerShare, targetUsd: targets[0]!.priceUsd, units: sizing.units, feeBps: previous.fees.ryntraFeeBps, costBufferBps: rules.risk.costBufferBps });
  return {
    ...previous,
    thesis: { ...previous.thesis, text: rules.thesis.text.slice(0, 600) },
    entry: { ...previous.entry, priceUsd: rules.entry.pricePerShare, maxPriceUsd: rules.entry.maxPricePerShare ?? previous.entry.maxPriceUsd, validUntil: rules.entry.validUntil ?? previous.entry.validUntil, by: previous.entry.priceUsd === rules.entry.pricePerShare ? previous.entry.by : "person" },
    invalidation,
    lossLimit: { riskUsd: rules.risk.plannedRiskUsd, budgetUsd: rules.capital.budgetUsd },
    targets,
    fees,
    sizing,
  };
}
