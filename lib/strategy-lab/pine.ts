import type { ExperimentWindow, RuleNode, RuleValue, StrategyIndicator, StrategySpec, ValidationIssue } from "./types.ts";
import { validateStrategySpec } from "./validation.ts";

export const PINE_COMPILER_VERSION = "ryntra-pine-v1";

function safeName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9 _.-]/g, "").trim().slice(0, 80);
  return sanitized || "Ryntra Strategy";
}

function variableName(id: string): string {
  return `ind_${id.replace(/-/g, "_")}`;
}

function compileIndicator(indicator: StrategyIndicator): string {
  const name = variableName(indicator.id);
  if (indicator.kind === "atr") return `${name} = ta.atr(${indicator.length})`;
  return `${name} = ta.${indicator.kind}(${indicator.source}, ${indicator.length})`;
}

function compileValue(value: RuleValue): string {
  if (value.kind === "number") return String(value.value);
  if (value.kind === "price") return value.source;
  return variableName(value.id);
}

function compileRule(node: RuleNode): string {
  if (node.kind === "all" || node.kind === "any") {
    const joiner = node.kind === "all" ? " and " : " or ";
    return `(${node.rules.map(compileRule).join(joiner)})`;
  }
  const left = compileValue(node.left);
  const right = compileValue(node.right);
  const op = {
    above: ">",
    below: "<",
    crosses_above: "ta.crossover",
    crosses_below: "ta.crossunder",
  } as const;
  return node.operator === "above" || node.operator === "below"
    ? `(${left} ${op[node.operator]} ${right})`
    : `${op[node.operator]}(${left}, ${right})`;
}

function toTimestamp(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
}

export type PineCompileOptions = {
  initialCapital: number;
};

export function compilePineV6(input: unknown, window: ExperimentWindow, options: PineCompileOptions):
  | { ok: true; code: string; compilerVersion: string; warnings: string[] }
  | { ok: false; issues: ValidationIssue[] } {
  const validated = validateStrategySpec(input);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  const start = toTimestamp(window.start);
  const end = toTimestamp(window.end);
  if (start === null || end === null || start >= end) {
    return { ok: false, issues: [{ code: "invalid-spec", path: "experiment.window", message: "Invalid experiment date window." }] };
  }
  const spec: StrategySpec = validated.value;
  if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0 || options.initialCapital > 1_000_000_000_000) {
    return { ok: false, issues: [{ code: "invalid-spec", path: "experiment.initialCapital", message: "Initial capital must be a positive finite value." }] };
  }
  const initialCapital = Number(options.initialCapital.toFixed(8));
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    return { ok: false, issues: [{ code: "invalid-spec", path: "experiment.initialCapital", message: "Initial capital must remain positive at 8-decimal Pine precision." }] };
  }
  const stopFraction = spec.stop.value / 100;
  const riskFraction = spec.sizing.value / 100;
  const filters = spec.filters.length ? ` and ${spec.filters.map(compileRule).join(" and ")}` : "";
  const code = [
    "//@version=6",
    `// Generated deterministically by ${PINE_COMPILER_VERSION}. Do not edit; change the StrategySpec instead.`,
    `strategy("${safeName(spec.name)}", overlay=true, initial_capital=${initialCapital}, pyramiding=0, commission_type=strategy.commission.percent, commission_value=0)`,
    `startTime = ${start}`,
    `endTime = ${end}`,
    "inWindow = time >= startTime and time < endTime",
    ...spec.indicators.map(compileIndicator),
    `entrySignal = barstate.isconfirmed and inWindow and ${compileRule(spec.entry)}${filters}`,
    `exitSignal = barstate.isconfirmed and ${compileRule(spec.exit)}`,
    `stopDistance = close * ${stopFraction}`,
    `riskCash = strategy.equity * ${riskFraction}`,
    "orderQty = stopDistance > 0 ? riskCash / stopDistance : 0",
    "if entrySignal and strategy.position_size == 0 and orderQty > 0",
    "    strategy.entry(\"Long\", strategy.long, qty=orderQty)",
    `if strategy.position_size > 0`,
    `    strategy.exit("Risk stop", "Long", stop=strategy.position_avg_price * (1 - ${stopFraction}))`,
    "if exitSignal and strategy.position_size > 0",
    "    strategy.close(\"Long\", comment=\"Rule exit\")",
    "// Commission, spread, slippage and funding are applied exactly once by Ryntra after CSV import.",
    "plot(strategy.equity, title=\"Strategy equity\", display=display.none)",
    "",
  ].join("\n");
  return {
    ok: true,
    code,
    compilerVersion: PINE_COMPILER_VERSION,
    warnings: ["all-costs-applied-after-import", "external-backtest-self-attested"],
  };
}
