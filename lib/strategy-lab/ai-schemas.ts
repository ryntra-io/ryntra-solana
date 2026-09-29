import { z } from "zod";
import type { RuleNode, StrategySpec } from "./types.ts";
import { validateStrategySpec } from "./validation.ts";

const PriceSourceSchema = z.enum(["open", "high", "low", "close", "hl2"]);
const RuleValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("number"), value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000) }).strict(),
  z.object({ kind: z.literal("price"), source: PriceSourceSchema }).strict(),
  z.object({ kind: z.literal("indicator"), id: z.string().min(1).max(48) }).strict(),
]);
const CompareRuleSchema = z.object({
  left: RuleValueSchema,
  operator: z.enum(["above", "below", "crosses_above", "crosses_below"]),
  right: RuleValueSchema,
}).strict();

export const StrategyBriefSchema = z.object({
  symbol: z.string().trim().min(2).max(64).regex(/^[A-Z0-9._:-]+$/i),
  timeframe: z.string().trim().regex(/^(?:[1-9]\d*[mhdw]|[1-9]\d*)$/i).max(8),
  assetClass: z.enum(["crypto", "tokenized-equity", "forex", "index"]),
  thesis: z.string().trim().min(10).max(500),
  entryIdea: z.string().trim().min(3).max(1_500),
  exitIdea: z.string().trim().min(3).max(1_500),
  stopPercent: z.number().finite().min(0.1).max(25),
  riskPercent: z.number().finite().min(0.05).max(5),
  maxDrawdownPercent: z.number().finite().min(1).max(50),
  costModel: z.object({
    commissionBps: z.number().finite().min(0).max(500),
    spreadBps: z.number().finite().min(0).max(500),
    slippageBps: z.number().finite().min(0).max(500),
    fundingBpsPerDay: z.number().finite().min(0).max(500),
  }).strict(),
  assumptions: z.array(z.string().trim().min(3).max(240)).max(12).default([]),
}).strict();

const DraftSpecSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(3).max(80),
  universe: z.object({
    provider: z.literal("tradingview"),
    symbol: z.string().trim().min(2).max(64).regex(/^[A-Z0-9._:-]+$/i),
    assetClass: z.enum(["crypto", "tokenized-equity", "forex", "index"]),
  }).strict(),
  timeframe: z.string().trim().regex(/^(?:[1-9]\d*[mhdw]|[1-9]\d*)$/i).max(8),
  thesis: z.string().trim().min(10).max(500),
  indicators: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    kind: z.enum(["rsi", "ema", "sma", "atr"]),
    source: PriceSourceSchema,
    length: z.number().int().min(2).max(1000),
  }).strict()).max(12),
  entryLogic: z.enum(["all", "any"]),
  entryRules: z.array(CompareRuleSchema).min(1).max(12),
  exitLogic: z.enum(["all", "any"]),
  exitRules: z.array(CompareRuleSchema).min(1).max(12),
  filters: z.array(CompareRuleSchema).max(8),
  stop: z.object({ kind: z.literal("percent"), value: z.number().finite().min(0.1).max(25) }).strict(),
  sizing: z.object({ kind: z.literal("risk_percent"), value: z.number().finite().min(0.05).max(5) }).strict(),
  riskPolicy: z.object({
    maxDrawdownPercent: z.number().finite().min(1).max(50),
    maxOpenPositions: z.literal(1),
    allowShort: z.literal(false),
  }).strict(),
  costModel: z.object({
    commissionBps: z.number().finite().min(0).max(500),
    spreadBps: z.number().finite().min(0).max(500),
    slippageBps: z.number().finite().min(0).max(500),
    fundingBpsPerDay: z.number().finite().min(0).max(500),
  }).strict(),
  assumptions: z.array(z.string().trim().min(3).max(240)).max(12),
}).strict();

export const AIFormalizationSchema = z.object({
  proposal: DraftSpecSchema,
  assumptionsAdded: z.array(z.string().trim().min(3).max(240)).max(12),
  unsupported: z.array(z.string().trim().min(3).max(300)).max(12),
  clarificationQuestions: z.array(z.string().trim().min(3).max(300)).max(8),
}).strict();

const ReviewChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("indicator-length"), indicatorId: z.string().min(1).max(48), value: z.number().int().min(2).max(1000) }).strict(),
  z.object({ kind: z.literal("entry-number"), ruleIndex: z.number().int().min(0).max(11), side: z.enum(["left", "right"]), value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000) }).strict(),
  z.object({ kind: z.literal("exit-number"), ruleIndex: z.number().int().min(0).max(11), side: z.enum(["left", "right"]), value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000) }).strict(),
  z.object({ kind: z.literal("stop-percent"), value: z.number().finite().min(0.1).max(25) }).strict(),
  z.object({ kind: z.literal("risk-percent"), value: z.number().finite().min(0.05).max(5) }).strict(),
  z.object({ kind: z.literal("max-drawdown-percent"), value: z.number().finite().min(1).max(50) }).strict(),
  z.object({
    kind: z.literal("cost-bps"),
    field: z.enum(["commissionBps", "spreadBps", "slippageBps", "fundingBpsPerDay"]),
    value: z.number().finite().min(0).max(500),
  }).strict(),
]);

export const AIReviewSchema = z.object({
  explanation: z.string().trim().min(10).max(2_000),
  evidenceReferences: z.array(z.string().trim().min(3).max(120)).min(1).max(10),
  risks: z.array(z.string().trim().min(3).max(300)).max(10),
  nextHypothesis: z.object({
    statement: z.string().trim().min(10).max(500),
    rationale: z.string().trim().min(10).max(800),
    changes: z.array(ReviewChangeSchema).min(1).max(4),
    expectedObservation: z.string().trim().min(10).max(500),
    falsificationCriterion: z.string().trim().min(10).max(500),
  }).strict(),
}).strict();

/** Provider-neutral bounded proposal contract shared by human and AI sources. */
export const StrategyChangeProposalSchema = AIReviewSchema;

export const EvidenceBundleSchema = z.object({
  quality: z.enum(["incomplete", "basic", "moderate", "strong"]),
  verdict: z.enum(["blocked", "weak-evidence", "mixed-evidence", "sufficient-for-paper-forward"]),
  score: z.number().int().min(0).max(100),
  metrics: z.object({
    trades: z.number().int().min(0).max(20_000),
    netPnl: z.number().finite().min(-1_000_000_000_000_000).max(1_000_000_000_000_000),
    totalReturnPercent: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
    benchmarkReturnPercent: z.number().finite().min(-100).max(100_000).nullable(),
    winRatePercent: z.number().finite().min(0).max(100),
    maxDrawdownPercent: z.number().finite().min(0).max(100),
    expectancy: z.number().finite().min(-1_000_000_000_000_000).max(1_000_000_000_000_000),
    profitFactor: z.number().finite().nonnegative().max(1_000_000_000).nullable(),
  }).strict(),
  dimensions: z.object({
    dataCompleteness: z.number().int().min(0).max(10),
    sampleSize: z.number().int().min(0).max(12),
    costs: z.number().int().min(0).max(12),
    oos: z.number().int().min(0).max(12),
    regimes: z.number().int().min(0).max(10),
    leakage: z.number().int().min(0).max(14),
    parameterSensitivity: z.number().int().min(0).max(10),
    forwardEvidence: z.number().int().min(0).max(10),
    reproducibility: z.number().int().min(0).max(5),
    executionRealism: z.number().int().min(0).max(5),
  }).strict(),
  warnings: z.array(z.string().min(1).max(120)).max(30),
}).strict().superRefine((value, context) => {
  const dimensionScore = Object.values(value.dimensions).reduce((sum, dimension) => sum + dimension, 0);
  if (value.score !== dimensionScore) {
    context.addIssue({ code: "custom", path: ["score"], message: "Score must equal the deterministic dimension sum." });
  }
  if (value.quality === "strong"
    && (value.score < 80 || value.warnings.includes("forward-evidence-missing") || value.warnings.includes("oos-self-attested"))) {
    context.addIssue({ code: "custom", path: ["quality"], message: "Strong evidence requires forward and non-self-attested evidence." });
  }
  if (value.verdict === "sufficient-for-paper-forward" && value.score < 75) {
    context.addIssue({ code: "custom", path: ["verdict"], message: "Paper-forward verdict requires a score of at least 75." });
  }
});

function group(kind: "all" | "any", rules: z.infer<typeof CompareRuleSchema>[]): RuleNode {
  return { kind, rules: rules.map((rule) => ({ kind: "compare" as const, ...rule })) };
}

export function proposalToStrategySpec(input: unknown): { ok: true; value: StrategySpec; envelope: z.infer<typeof AIFormalizationSchema> } | { ok: false } {
  const parsed = AIFormalizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const draft = parsed.data.proposal;
  const spec: StrategySpec = {
    schemaVersion: 1,
    name: draft.name,
    universe: draft.universe,
    timeframe: draft.timeframe,
    thesis: draft.thesis,
    indicators: draft.indicators,
    entry: group(draft.entryLogic, draft.entryRules),
    exit: group(draft.exitLogic, draft.exitRules),
    stop: draft.stop,
    sizing: draft.sizing,
    filters: draft.filters.map((rule) => ({ kind: "compare" as const, ...rule })),
    riskPolicy: draft.riskPolicy,
    costModel: draft.costModel,
    assumptions: draft.assumptions,
  };
  const validated = validateStrategySpec(spec);
  return validated.ok ? { ok: true, value: validated.value, envelope: parsed.data } : { ok: false };
}

function compareRuleAt(node: RuleNode, index: number) {
  if (node.kind === "compare") return index === 0 ? node : null;
  const candidate = node.rules[index];
  return candidate?.kind === "compare" ? candidate : null;
}

export function applyReviewChanges(
  current: StrategySpec,
  proposal: unknown,
): { ok: true; strategy: StrategySpec; changedFields: string[] } | { ok: false; error: "invalid-proposal" | "unsupported-change" } {
  const parsed = AIReviewSchema.safeParse(proposal);
  if (!parsed.success) return { ok: false, error: "invalid-proposal" };
  const next = structuredClone(current);
  const touched = new Map<string, { initial: number; read: () => number }>();
  const touch = (path: string, initial: number, read: () => number) => {
    if (!touched.has(path)) touched.set(path, { initial, read });
  };

  for (const change of parsed.data.nextHypothesis.changes) {
    if (change.kind === "indicator-length") {
      const indicator = next.indicators.find((item) => item.id === change.indicatorId);
      if (!indicator) return { ok: false, error: "unsupported-change" };
      touch(`indicators.${change.indicatorId}.length`, indicator.length, () => indicator.length);
      indicator.length = change.value;
      continue;
    }
    if (change.kind === "entry-number" || change.kind === "exit-number") {
      const node = change.kind === "entry-number" ? next.entry : next.exit;
      const rule = compareRuleAt(node, change.ruleIndex);
      if (!rule) return { ok: false, error: "unsupported-change" };
      const currentValue = rule[change.side];
      if (currentValue.kind !== "number") return { ok: false, error: "unsupported-change" };
      const section = change.kind === 'entry-number' ? 'entry' : 'exit';
      const rulePath = node.kind === 'compare' ? section : `${section}.rules.${change.ruleIndex}`;
      const initial = currentValue.value;
      const read = () => {
        const value = rule[change.side];
        return value.kind === 'number' ? value.value : Number.NaN;
      };
      touch(`${rulePath}.${change.side}.value`, initial, read);
      rule[change.side] = { kind: "number", value: change.value };
      continue;
    }
    if (change.kind === "stop-percent") {
      touch('stop.value', next.stop.value, () => next.stop.value);
      next.stop.value = change.value;
      continue;
    }
    if (change.kind === "risk-percent") {
      touch('sizing.value', next.sizing.value, () => next.sizing.value);
      next.sizing.value = change.value;
      continue;
    }
    if (change.kind === "max-drawdown-percent") {
      touch('riskPolicy.maxDrawdownPercent', next.riskPolicy.maxDrawdownPercent, () => next.riskPolicy.maxDrawdownPercent);
      next.riskPolicy.maxDrawdownPercent = change.value;
      continue;
    }
    if (change.kind === "cost-bps") {
      touch(`costModel.${change.field}`, next.costModel[change.field], () => next.costModel[change.field]);
      next.costModel[change.field] = change.value;
    }
  }

  const validated = validateStrategySpec(next);
  if (!validated.ok) return { ok: false, error: "unsupported-change" };
  const changedFields = [...touched.entries()]
    .filter(([, value]) => value.initial !== value.read())
    .map(([path]) => path);
  return changedFields.length > 0
    ? { ok: true, strategy: validated.value, changedFields }
    : { ok: false, error: "unsupported-change" };
}

export type StrategyBrief = z.infer<typeof StrategyBriefSchema>;
export type AIReviewProposal = z.infer<typeof AIReviewSchema>;
export type StrategyChangeProposal = z.infer<typeof StrategyChangeProposalSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
