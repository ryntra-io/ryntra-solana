import { z } from "zod";
import type { RuleNode, RuleValue, StrategySpec, ValidationIssue } from "./types.ts";

const PriceSource = z.enum(["open", "high", "low", "close", "hl2"]);
const RuleValueSchema: z.ZodType<RuleValue> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("number"), value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000) }).strict(),
  z.object({ kind: z.literal("price"), source: PriceSource }).strict(),
  z.object({ kind: z.literal("indicator"), id: z.string().min(1).max(48) }).strict(),
]);

const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compare"),
    left: RuleValueSchema,
    operator: z.enum(["above", "below", "crosses_above", "crosses_below"]),
    right: RuleValueSchema,
  }).strict(),
  z.object({ kind: z.literal("all"), rules: z.array(RuleNodeSchema).min(1).max(12) }).strict(),
  z.object({ kind: z.literal("any"), rules: z.array(RuleNodeSchema).min(1).max(12) }).strict(),
]));

export const StrategySpecSchema: z.ZodType<StrategySpec> = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(3).max(80),
  universe: z.object({
    provider: z.literal("tradingview"),
    symbol: z.string().trim().min(2).max(64).regex(/^[A-Z0-9._:-]+$/i),
    assetClass: z.enum(["crypto", "tokenized-equity", "forex", "index"]),
  }).strict(),
  timeframe: z.string().regex(/^(?:[1-9]\d*[mhdw]|[1-9]\d*)$/i).max(8),
  thesis: z.string().trim().min(10).max(500),
  indicators: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    kind: z.enum(["rsi", "ema", "sma", "atr"]),
    source: PriceSource,
    length: z.number().int().min(2).max(1000),
  }).strict()).max(12),
  entry: RuleNodeSchema,
  exit: RuleNodeSchema,
  stop: z.object({ kind: z.literal("percent"), value: z.number().min(0.1).max(25) }).strict(),
  sizing: z.object({ kind: z.literal("risk_percent"), value: z.number().min(0.05).max(5) }).strict(),
  filters: z.array(RuleNodeSchema).max(8),
  riskPolicy: z.object({
    maxDrawdownPercent: z.number().min(1).max(50),
    maxOpenPositions: z.literal(1),
    allowShort: z.boolean(),
  }).strict(),
  costModel: z.object({
    commissionBps: z.number().min(0).max(500),
    spreadBps: z.number().min(0).max(500),
    slippageBps: z.number().min(0).max(500),
    fundingBpsPerDay: z.number().min(0).max(500),
  }).strict(),
  assumptions: z.array(z.string().trim().min(3).max(240)).max(12),
}).strict();

function walkRule(node: RuleNode, path: string, indicatorIds: Set<string>, issues: ValidationIssue[]): void {
  if (node.kind === "all" || node.kind === "any") {
    node.rules.forEach((rule, index) => walkRule(rule, `${path}.rules.${index}`, indicatorIds, issues));
    return;
  }
  for (const [side, value] of [["left", node.left], ["right", node.right]] as const) {
    if (value.kind === "indicator" && !indicatorIds.has(value.id)) {
      issues.push({ code: "unknown-indicator", path: `${path}.${side}.id`, message: `Unknown indicator: ${value.id}` });
    }
  }
}

function preflightRuleAst(input: unknown): ValidationIssue[] {
  if (input === null || typeof input !== "object") return [];
  try {
    const raw = input as Record<string, unknown>;
    const stack: Array<{ value: unknown; path: string; depth: number }> = [
      { value: raw.entry, path: "entry", depth: 1 },
      { value: raw.exit, path: "exit", depth: 1 },
    ];
    if (Array.isArray(raw.filters)) {
      raw.filters.forEach((value, index) => stack.push({ value, path: "filters." + index, depth: 1 }));
    }
    const seen = new Set<object>();
    let nodes = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (current.value === null || typeof current.value !== "object") continue;
      if (seen.has(current.value)) {
        return [{ code: "unsupported-rule", path: current.path, message: "Rule AST must be acyclic and must not share nodes." }];
      }
      seen.add(current.value);
      nodes += 1;
      if (nodes > 128) {
        return [{ code: "unsupported-rule", path: current.path, message: "Rule AST cannot exceed 128 nodes." }];
      }
      if (current.depth > 8) {
        return [{ code: "unsupported-rule", path: current.path, message: "Rule AST depth cannot exceed 8 levels." }];
      }
      const node = current.value as Record<string, unknown>;
      if ((node.kind === "all" || node.kind === "any") && Array.isArray(node.rules)) {
        for (let index = node.rules.length - 1; index >= 0; index -= 1) {
          stack.push({ value: node.rules[index], path: current.path + ".rules." + index, depth: current.depth + 1 });
        }
      }
    }
    return [];
  } catch {
    return [{ code: "invalid-spec", path: "entry", message: "Rule AST could not be inspected safely." }];
  }
}

function collectRawIndicatorIssues(input: unknown, issues: ValidationIssue[]): void {
  if (input === null || typeof input !== "object") return;
  try {
    const raw = input as Record<string, unknown>;
    const ids = new Set<string>();
    if (Array.isArray(raw.indicators)) {
      for (const indicator of raw.indicators) {
        if (indicator !== null && typeof indicator === "object" && typeof (indicator as { id?: unknown }).id === "string") {
          ids.add((indicator as { id: string }).id);
        }
      }
    }
    const stack: Array<{ value: unknown; path: string }> = [
      { value: raw.entry, path: "entry" },
      { value: raw.exit, path: "exit" },
      { value: raw.filters, path: "filters" },
    ];
    const seen = new Set<object>();
    let inspected = 0;
    while (stack.length && inspected < 512) {
      const current = stack.pop()!;
      if (current.value === null || typeof current.value !== "object" || seen.has(current.value)) continue;
      seen.add(current.value);
      inspected += 1;
      if (Array.isArray(current.value)) {
        for (let index = Math.min(current.value.length, 128) - 1; index >= 0; index -= 1) {
          stack.push({ value: current.value[index], path: current.path + "." + index });
        }
        continue;
      }
      const node = current.value as Record<string, unknown>;
      if (node.kind === "indicator") {
        if (typeof node.id === "string" && !ids.has(node.id)) {
          issues.push({ code: "unknown-indicator", path: current.path + ".id", message: "Unknown indicator: " + node.id });
        }
        continue;
      }
      if (node.kind === "compare") {
        stack.push({ value: node.left, path: current.path + ".left" });
        stack.push({ value: node.right, path: current.path + ".right" });
      } else if (node.kind === "all" || node.kind === "any") {
        stack.push({ value: node.rules, path: current.path + ".rules" });
      }
    }
  } catch {
    // Zod issues remain authoritative; supplemental issue collection must never throw.
  }
}

function valueAtPath(input: unknown, path: PropertyKey[]): unknown {
  try {
    return path.reduce<unknown>(
      (current, key) => current !== null && typeof current === "object"
        ? (current as Record<PropertyKey, unknown>)[key]
        : undefined,
      input,
    );
  } catch {
    return undefined;
  }
}

function hasRawCustomIndicator(input: unknown): boolean {
  try {
    if (input === null || typeof input !== "object") return false;
    const indicators = (input as { indicators?: unknown }).indicators;
    return Array.isArray(indicators) && indicators.some(
      (indicator) => indicator !== null
        && typeof indicator === "object"
        && (indicator as { kind?: unknown }).kind === "custom_code",
    );
  } catch {
    return false;
  }
}

export function validateStrategySpec(input: unknown): { ok: true; value: StrategySpec } | { ok: false; issues: ValidationIssue[] } {
  const preflightIssues = preflightRuleAst(input);
  if (preflightIssues.length) return { ok: false, issues: preflightIssues };
  let parsed: ReturnType<typeof StrategySpecSchema.safeParse>;
  try {
    parsed = StrategySpecSchema.safeParse(input);
  } catch {
    return { ok: false, issues: [{ code: "invalid-spec", path: "", message: "StrategySpec could not be parsed safely." }] };
  }
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => {
      const value = valueAtPath(input, issue.path);
      if (issue.path[0] === "indicators" && value === "custom_code") {
        return { code: "unsupported-indicator", path: issue.path.join("."), message: "Custom indicator code is not supported." };
      }
      if (issue.path[0] === "sizing" || issue.path[0] === "stop" || issue.path[0] === "riskPolicy") {
        return { code: "risk-out-of-range", path: issue.path.join("."), message: issue.message };
      }
      return { code: "invalid-spec", path: issue.path.join("."), message: issue.message };
    });
    if (hasRawCustomIndicator(input) && !issues.some((issue) => issue.code === "unsupported-indicator")) {
      issues.push({ code: "unsupported-indicator", path: "indicators", message: "Custom indicator code is not supported." });
    }
    collectRawIndicatorIssues(input, issues);
    return { ok: false, issues };
  }

  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const indicator of parsed.data.indicators) {
    if (ids.has(indicator.id)) issues.push({ code: "invalid-spec", path: "indicators", message: `Duplicate indicator id: ${indicator.id}` });
    ids.add(indicator.id);
  }
  walkRule(parsed.data.entry, "entry", ids, issues);
  walkRule(parsed.data.exit, "exit", ids, issues);
  parsed.data.filters.forEach((rule, index) => walkRule(rule, `filters.${index}`, ids, issues));
  if (parsed.data.riskPolicy.allowShort) {
    issues.push({ code: "unsupported-short", path: "riskPolicy.allowShort", message: "Short strategies are not supported in Strategy Lab V1." });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: parsed.data };
}
