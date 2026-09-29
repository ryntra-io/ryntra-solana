import {
  AIReviewSchema,
  EvidenceBundleSchema,
  StrategyBriefSchema,
  applyReviewChanges,
  type AIReviewProposal,
  type StrategyBrief,
} from "./ai-schemas.ts";
import type { EvidenceReport, StrategySpec } from "./types.ts";
import { validateStrategySpec } from "./validation.ts";

export type FormalizationAnchor =
  | "assetClass"
  | "symbol"
  | "timeframe"
  | "stopPercent"
  | "riskPercent"
  | "maxDrawdownPercent"
  | "commissionBps"
  | "spreadBps"
  | "slippageBps"
  | "fundingBpsPerDay";

export type FormalizationGuardResult =
  | { ok: true; brief: StrategyBrief; strategy: StrategySpec }
  | { ok: false; error: "invalid-brief" | "invalid-strategy" }
  | { ok: false; error: "anchor-mismatch"; fields: FormalizationAnchor[] }
  | { ok: false; error: "prompt-injection"; path: string }
  | { ok: false; error: "prohibited-claim"; claim: ProhibitedClaim; path: string };

export type ProhibitedClaim =
  | "profit"
  | "approved"
  | "safe"
  | "guarantee"
  | "execution"
  | "automation"
  | "wallet"
  | "position-size";

export type ReviewGuardResult =
  | {
      ok: true;
      proposal: AIReviewProposal;
      draft: StrategySpec;
      changedFields: string[];
    }
  | { ok: false; error: "invalid-evidence" | "invalid-strategy" | "invalid-proposal" }
  | { ok: false; error: "missing-evidence-reference" }
  | { ok: false; error: "unknown-evidence-reference"; reference: string }
  | { ok: false; error: "prompt-injection"; path: string }
  | { ok: false; error: "prohibited-claim"; claim: ProhibitedClaim; path: string }
  | { ok: false; error: "prohibited-change"; change: "risk-percent" }
  | { ok: false; error: "unsupported-change" };

const EVIDENCE_SCALAR_PATHS = ["quality", "verdict", "score"] as const;
const EVIDENCE_METRIC_PATHS = [
  "metrics.trades",
  "metrics.netPnl",
  "metrics.totalReturnPercent",
  "metrics.benchmarkReturnPercent",
  "metrics.winRatePercent",
  "metrics.maxDrawdownPercent",
  "metrics.expectancy",
  "metrics.profitFactor",
] as const;
const EVIDENCE_DIMENSION_PATHS = [
  "dimensions.dataCompleteness",
  "dimensions.sampleSize",
  "dimensions.costs",
  "dimensions.oos",
  "dimensions.regimes",
  "dimensions.leakage",
  "dimensions.parameterSensitivity",
  "dimensions.forwardEvidence",
  "dimensions.reproducibility",
  "dimensions.executionRealism",
] as const;

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions?|messages?|rules?)\b/i,
  /\b(?:system|developer|assistant)\s*(?:message|prompt|instruction)\s*:/i,
  /\byou\s+are\s+now\b/i,
  /\b(?:override|bypass|disregard)\s+(?:the\s+)?(?:instructions?|rules?|guardrails?|safety)\b/i,
  /<\/?(?:system|developer|assistant)(?:\s[^>]*)?>/i,
] as const;

const PROHIBITED_CLAIM_PATTERNS: ReadonlyArray<{
  claim: ProhibitedClaim;
  pattern: RegExp;
}> = [
  { claim: "profit", pattern: /\bprofit(?:s|ed|ing|able|ability)?\b/i },
  { claim: "approved", pattern: /\bapprov(?:e|es|ed|ing|al)\b/i },
  { claim: "safe", pattern: /\bsaf(?:e|er|est|ely|ety)\b/i },
  { claim: "guarantee", pattern: /\bguarantee(?:s|d|ing)?\b/i },
  {
    claim: "execution",
    pattern: /\b(?:live[\s-]*(?:execution|trad(?:e|es|ed|ing))|execut(?:e|es|ed|ing)\s+(?:a\s+)?(?:trade|order|strategy)|plac(?:e|es|ed|ing)\s+(?:a\s+)?(?:trade|order))\b/i,
  },
  {
    claim: "automation",
    pattern: /\b(?:automation|automat(?:e|es|ed|ing)|trading\s+bot|autonomous\s+agent)\b/i,
  },
  { claim: "wallet", pattern: /\bwallets?\b/i },
  {
    claim: "position-size",
    pattern: /\b(?:position[\s-]*(?:size|sizing)|siz(?:e|es|ed|ing)\s+(?:the|a|your)\s+position)\b/i,
  },
];

function safeParse<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeTimeframe(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The AI may fill in rule structure, but it cannot reinterpret the user's
 * instrument, interval, asset class, stop, or per-strategy risk anchor.
 */
export function validateFormalizationAnchors(
  briefInput: unknown,
  strategyInput: unknown,
  outputTextInput: unknown = null,
): FormalizationGuardResult {
  const brief = safeParse(() => StrategyBriefSchema.safeParse(briefInput));
  if (!brief?.success) return { ok: false, error: "invalid-brief" };

  const strategy = validateStrategySpec(strategyInput);
  if (!strategy.ok) return { ok: false, error: "invalid-strategy" };

  const fields: FormalizationAnchor[] = [];
  if (brief.data.assetClass !== strategy.value.universe.assetClass) fields.push("assetClass");
  if (normalizeSymbol(brief.data.symbol) !== normalizeSymbol(strategy.value.universe.symbol)) fields.push("symbol");
  if (normalizeTimeframe(brief.data.timeframe) !== normalizeTimeframe(strategy.value.timeframe)) fields.push("timeframe");
  if (brief.data.stopPercent !== strategy.value.stop.value) fields.push("stopPercent");
  if (brief.data.riskPercent !== strategy.value.sizing.value) fields.push("riskPercent");
  if (brief.data.maxDrawdownPercent !== strategy.value.riskPolicy.maxDrawdownPercent) fields.push("maxDrawdownPercent");
  if (brief.data.costModel.commissionBps !== strategy.value.costModel.commissionBps) fields.push("commissionBps");
  if (brief.data.costModel.spreadBps !== strategy.value.costModel.spreadBps) fields.push("spreadBps");
  if (brief.data.costModel.slippageBps !== strategy.value.costModel.slippageBps) fields.push("slippageBps");
  if (brief.data.costModel.fundingBpsPerDay !== strategy.value.costModel.fundingBpsPerDay) fields.push("fundingBpsPerDay");

  if (fields.length > 0) return { ok: false, error: "anchor-mismatch", fields };

  for (const entry of textEntries(outputTextInput)) {
    const value = normalizedText(entry.value);
    if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
      return { ok: false, error: "prompt-injection", path: entry.path };
    }
    const prohibited = PROHIBITED_CLAIM_PATTERNS.find(({ pattern }) => pattern.test(value));
    if (prohibited) return { ok: false, error: "prohibited-claim", claim: prohibited.claim, path: entry.path };
  }

  return { ok: true, brief: brief.data, strategy: strategy.value };
}

function validatedEvidence(input: unknown): EvidenceReport | null {
  const parsed = safeParse(() => EvidenceBundleSchema.safeParse(input));
  return parsed?.success ? parsed.data : null;
}

/** Exact leaf references that exist in this deterministic report instance. */
export function evidenceReferenceAllowlist(evidenceInput: unknown): readonly string[] {
  const evidence = validatedEvidence(evidenceInput);
  if (!evidence) return [];
  return Object.freeze([
    ...EVIDENCE_SCALAR_PATHS,
    ...EVIDENCE_METRIC_PATHS,
    ...EVIDENCE_DIMENSION_PATHS,
    ...evidence.warnings.map((warning) => `warnings.${warning}`),
  ]);
}

type TextEntry = { path: string; value: string };

function textEntries(value: unknown, path = "$", entries: TextEntry[] = []): TextEntry[] {
  if (typeof value === "string") {
    entries.push({ path, value });
    return entries;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => textEntries(item, `${path}.${index}`, entries));
    return entries;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => textEntries(item, `${path}.${key}`, entries));
  }
  return entries;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function missingReferences(input: unknown): boolean {
  try {
    if (!input || typeof input !== "object") return false;
    const raw = input as { evidenceReferences?: unknown };
    return !("evidenceReferences" in raw)
      || (Array.isArray(raw.evidenceReferences) && raw.evidenceReferences.length === 0);
  } catch {
    return false;
  }
}

/**
 * Semantically validates an AI review and dry-runs its bounded changes. The
 * approved input and proposal are never mutated; success yields a new draft.
 */
export function validateReviewProposal(
  evidenceInput: unknown,
  currentStrategyInput: unknown,
  proposalInput: unknown,
): ReviewGuardResult {
  const evidence = validatedEvidence(evidenceInput);
  if (!evidence) return { ok: false, error: "invalid-evidence" };

  const current = validateStrategySpec(currentStrategyInput);
  if (!current.ok) return { ok: false, error: "invalid-strategy" };

  if (missingReferences(proposalInput)) return { ok: false, error: "missing-evidence-reference" };
  const parsed = safeParse(() => AIReviewSchema.safeParse(proposalInput));
  if (!parsed?.success) return { ok: false, error: "invalid-proposal" };

  const allowlist = new Set(evidenceReferenceAllowlist(evidence));
  const unknownReference = parsed.data.evidenceReferences.find((reference) => !allowlist.has(reference));
  if (unknownReference) {
    return { ok: false, error: "unknown-evidence-reference", reference: unknownReference };
  }

  for (const entry of textEntries(parsed.data)) {
    const value = normalizedText(entry.value);
    if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
      return { ok: false, error: "prompt-injection", path: entry.path };
    }
    const prohibited = PROHIBITED_CLAIM_PATTERNS.find(({ pattern }) => pattern.test(value));
    if (prohibited) {
      return { ok: false, error: "prohibited-claim", claim: prohibited.claim, path: entry.path };
    }
  }

  if (parsed.data.nextHypothesis.changes.some((change) => change.kind === "risk-percent")) {
    return { ok: false, error: "prohibited-change", change: "risk-percent" };
  }

  const applied = applyReviewChanges(current.value, parsed.data);
  if (!applied.ok) {
    return {
      ok: false,
      error: applied.error === "invalid-proposal" ? "invalid-proposal" : "unsupported-change",
    };
  }

  return {
    ok: true,
    proposal: structuredClone(parsed.data),
    draft: applied.strategy,
    changedFields: [...applied.changedFields],
  };
}
