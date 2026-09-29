import { createHash } from "node:crypto";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import type { AccountingIssue } from "./accounting.ts";
import {
  addDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  type MoneyValue,
  type RoundingMode,
} from "./decimal.ts";
import { evaluateFreshness, parseExplicitInstant } from "./freshness.ts";
import { parsePositionRecord, type PositionRecord } from "./position.ts";
import {
  calculateValuationCoverage,
  convertMoneyValue,
  type FxReference,
  type InclusionMethod,
  type ValuationCoverage,
} from "./valuation.ts";

export const RISK_CALCULATION_VERSION = "1.0.0" as const;
export const RISK_FORMULA_VERSION = "1.0.0" as const;

export const RISK_METRICS = [
  "MAX_GROSS_EXPOSURE",
  "MAX_SINGLE_UNDERLYING_EXPOSURE",
  "MAX_COMMITTED_CASH",
  "MAX_FUNDS_IN_MOTION",
  "MIN_SPENDABLE_CASH",
  "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE",
  "MAX_SINGLE_UNDERLYING_BPS_OF_NET_OBSERVED_VALUE",
] as const;

export type RiskMetric = (typeof RISK_METRICS)[number];

export type MetricValue =
  | Readonly<{ state: "KNOWN"; value: MoneyValue }>
  | Readonly<{ state: "UNKNOWN"; reasons: readonly string[] }>;

export type RiskConstraint =
  | Readonly<{
      id: string;
      metric:
        | "MAX_GROSS_EXPOSURE"
        | "MAX_SINGLE_UNDERLYING_EXPOSURE"
        | "MAX_COMMITTED_CASH"
        | "MAX_FUNDS_IN_MOTION"
        | "MIN_SPENDABLE_CASH";
      limit: MoneyValue;
    }>
  | Readonly<{
      id: string;
      metric:
        | "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE"
        | "MAX_SINGLE_UNDERLYING_BPS_OF_NET_OBSERVED_VALUE";
      limitBps: number;
    }>;

export type RiskCalculationInput = Readonly<{
  schemaVersion: typeof RISK_CALCULATION_VERSION;
  formulaVersion: typeof RISK_FORMULA_VERSION;
  scope: Readonly<{ scopeId: string; ownerRef: string; contextVersion: number | null }>;
  asOf: string;
  displayCurrency: string;
  scale: number;
  roundingMode: RoundingMode;
  inclusionMethod: InclusionMethod;
  records: readonly PositionRecord[];
  accountingIssues: readonly AccountingIssue[];
  fx: readonly FxReference[];
  constraints: readonly RiskConstraint[];
}>;

export type ConstraintResult = Readonly<{
  id: string;
  metric: RiskMetric;
  status: "WITHIN" | "EXCEEDED" | "UNKNOWN";
  actual: MoneyValue | Readonly<{ basisPoints: number }> | null;
  limit: MoneyValue | Readonly<{ basisPoints: number }>;
  reason: string | null;
}>;

export type UnderlyingRisk = Readonly<{
  underlyingKey: string;
  gross: MetricValue;
  long: MetricValue;
  short: MetricValue;
  net: MetricValue;
}>;

export type RiskCalculation = Readonly<{
  schemaVersion: typeof RISK_CALCULATION_VERSION;
  formulaVersion: typeof RISK_FORMULA_VERSION;
  inputDigest: string;
  scope: RiskCalculationInput["scope"];
  asOf: string;
  valuation: ValuationCoverage;
  cash: Readonly<{
    spendable: MetricValue;
    pending: MetricValue;
    fundsInMotion: MetricValue;
    committed: MetricValue;
    lockedCollateral: MetricValue;
  }>;
  metrics: Readonly<{
    grossExposure: MetricValue;
    longExposure: MetricValue;
    shortExposure: MetricValue;
    netExposure: MetricValue;
    pendingExposure: MetricValue;
    committedExposure: MetricValue;
    collateralExposure: MetricValue;
    riskCapitalValue: MetricValue;
    byUnderlying: readonly UnderlyingRisk[];
  }>;
  constraints: readonly ConstraintResult[];
  bindingConstraintIds: readonly string[];
  unknowns: readonly string[];
}>;

type Totals = {
  long: MoneyValue;
  short: MoneyValue;
  pending: MoneyValue;
  committed: MoneyValue;
  collateral: MoneyValue;
};

type UnknownBuckets = {
  settled: string[];
  pending: string[];
  committed: string[];
  collateral: string[];
};

type CashFlowTotals = {
  pending: MoneyValue;
  fundsInMotion: MoneyValue;
  committed: MoneyValue;
};

type CashFlowUnknowns = {
  pending: string[];
  fundsInMotion: string[];
  committed: string[];
};

function zero(scale: number, currency: string): MoneyValue {
  return { amount: decimal("0", scale), currency };
}

function addMoney(left: MoneyValue, right: MoneyValue, scale: number, mode: RoundingMode): MoneyValue {
  return { amount: addDecimal(left.amount, right.amount, scale, mode), currency: left.currency };
}

function subtractMoney(left: MoneyValue, right: MoneyValue, scale: number, mode: RoundingMode): MoneyValue {
  return { amount: subtractDecimal(left.amount, right.amount, scale, mode), currency: left.currency };
}

function known(value: MoneyValue): MetricValue {
  return { state: "KNOWN", value };
}

function unknown(reasons: readonly string[]): MetricValue {
  return { state: "UNKNOWN", reasons: [...new Set(reasons)].sort(compareCanonicalStrings) };
}

function metric(value: MoneyValue, reasons: readonly string[]): MetricValue {
  return reasons.length ? unknown(reasons) : known(value);
}

function normalizedInput(input: RiskCalculationInput): RiskCalculationInput {
  if (input.schemaVersion !== RISK_CALCULATION_VERSION || input.formulaVersion !== RISK_FORMULA_VERSION) {
    throw new TypeError("unsupported RiskCalculation version");
  }
  if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 18) {
    throw new TypeError("invalid RiskCalculation scale");
  }
  if (parseExplicitInstant(input.asOf) === null) throw new TypeError("invalid RiskCalculation asOf");
  const records = input.records.map(parsePositionRecord).sort((left, right) => compareCanonicalStrings(
    [
      left.positionId,
      left.source.sourceId,
      left.source.sourcePositionKey,
      left.source.sourceVersion ?? "",
      left.source.observedAt,
    ].join("\u0000"),
    [
      right.positionId,
      right.source.sourceId,
      right.source.sourcePositionKey,
      right.source.sourceVersion ?? "",
      right.source.observedAt,
    ].join("\u0000"),
  ));
  const constraints = [...input.constraints].sort((left, right) => compareCanonicalStrings(left.id, right.id));
  if (new Set(constraints.map((item) => item.id)).size !== constraints.length) {
    throw new TypeError("duplicate risk constraint id");
  }
  for (const constraint of constraints) {
    if (!(RISK_METRICS as readonly string[]).includes(constraint.metric)) throw new TypeError("unsupported risk metric");
    if ("limitBps" in constraint) {
      if (!Number.isInteger(constraint.limitBps) || constraint.limitBps < 0) throw new TypeError("invalid basis-point limit");
    } else if (constraint.limit.currency !== input.displayCurrency) {
      throw new TypeError("constraint currency must equal display currency");
    }
  }
  const accountingIssues = [...input.accountingIssues].sort((left, right) => compareCanonicalStrings(
    `${left.code}\u0000${left.lotKey}\u0000${left.positionIds.join("\u0000")}`,
    `${right.code}\u0000${right.lotKey}\u0000${right.positionIds.join("\u0000")}`,
  ));
  const fx = [...input.fx].sort((left, right) => compareCanonicalStrings(
    `${left.baseCurrency}\u0000${left.quoteCurrency}\u0000${left.sourceRef}`,
    `${right.baseCurrency}\u0000${right.quoteCurrency}\u0000${right.sourceRef}`,
  ));
  return { ...input, records, constraints, accountingIssues, fx };
}

function addExposure(
  totals: Totals,
  bucket: UnknownBuckets,
  byUnderlying: Map<string, { totals: Totals; unknowns: UnknownBuckets }>,
  record: PositionRecord,
  input: RiskCalculationInput,
  allUnknowns: string[],
  cashFlowTotals: CashFlowTotals,
  cashFlowUnknowns: CashFlowUnknowns,
): void {
  for (const leg of record.exposureLegs) {
    if (leg.phase === "PAPER" || leg.phase === "REFERENCE") continue;
    const underlying = byUnderlying.get(leg.underlyingKey) ?? {
      totals: {
        long: zero(input.scale, input.displayCurrency),
        short: zero(input.scale, input.displayCurrency),
        pending: zero(input.scale, input.displayCurrency),
        committed: zero(input.scale, input.displayCurrency),
        collateral: zero(input.scale, input.displayCurrency),
      },
      unknowns: { settled: [], pending: [], committed: [], collateral: [] },
    };
    byUnderlying.set(leg.underlyingKey, underlying);

    const reasonPrefix = `${record.positionId}:${leg.legId}`;
    const freshness = evaluateFreshness({
      observedAt: leg.observedAt,
      validUntil: leg.validUntil,
      policy: leg.freshnessPolicy,
      asOf: input.asOf,
    });
    let value: MoneyValue | null = null;
    let reason: string | null = null;
    if (leg.notional === null) {
      reason = `${reasonPrefix}:EXPOSURE_UNKNOWN`;
    } else if (freshness.state !== "CURRENT") {
      reason = `${reasonPrefix}:EXPOSURE_STALE`;
    } else {
      const converted = convertMoneyValue({
        value: leg.notional,
        displayCurrency: input.displayCurrency,
        scale: input.scale,
        roundingMode: input.roundingMode,
        fx: input.fx,
        asOf: input.asOf,
      });
      if (converted.ok) value = converted.value;
      else reason = `${reasonPrefix}:${converted.code}`;
    }
    if (reason) {
      allUnknowns.push(reason);
      const target = leg.phase === "PENDING" ? "pending" : leg.phase === "COMMITTED" ? "committed" : "settled";
      bucket[target].push(reason);
      underlying.unknowns[target].push(reason);
      if (leg.phase === "PENDING" && record.cashState === "PENDING") cashFlowUnknowns.pending.push(reason);
      if (leg.phase === "PENDING" && record.cashState === "FUNDS_IN_MOTION") cashFlowUnknowns.fundsInMotion.push(reason);
      if (leg.phase === "COMMITTED" && record.cashState === "COMMITTED") cashFlowUnknowns.committed.push(reason);
      if (leg.role === "COLLATERAL") {
        bucket.collateral.push(reason);
        underlying.unknowns.collateral.push(reason);
      }
      continue;
    }
    if (!value) continue;

    if (leg.phase === "PENDING") {
      totals.pending = addMoney(totals.pending, value, input.scale, input.roundingMode);
      underlying.totals.pending = addMoney(underlying.totals.pending, value, input.scale, input.roundingMode);
      if (record.cashState === "PENDING") {
        cashFlowTotals.pending = addMoney(cashFlowTotals.pending, value, input.scale, input.roundingMode);
      }
      if (record.cashState === "FUNDS_IN_MOTION") {
        cashFlowTotals.fundsInMotion = addMoney(cashFlowTotals.fundsInMotion, value, input.scale, input.roundingMode);
      }
    } else if (leg.phase === "COMMITTED") {
      totals.committed = addMoney(totals.committed, value, input.scale, input.roundingMode);
      underlying.totals.committed = addMoney(underlying.totals.committed, value, input.scale, input.roundingMode);
      if (record.cashState === "COMMITTED") {
        cashFlowTotals.committed = addMoney(cashFlowTotals.committed, value, input.scale, input.roundingMode);
      }
    } else if (leg.direction === "LONG") {
      totals.long = addMoney(totals.long, value, input.scale, input.roundingMode);
      underlying.totals.long = addMoney(underlying.totals.long, value, input.scale, input.roundingMode);
    } else if (leg.direction === "SHORT" || leg.direction === "LIABILITY") {
      totals.short = addMoney(totals.short, value, input.scale, input.roundingMode);
      underlying.totals.short = addMoney(underlying.totals.short, value, input.scale, input.roundingMode);
    }
    if (leg.role === "COLLATERAL") {
      totals.collateral = addMoney(totals.collateral, value, input.scale, input.roundingMode);
      underlying.totals.collateral = addMoney(underlying.totals.collateral, value, input.scale, input.roundingMode);
    }
  }
}

function valuationCash(record: PositionRecord, input: RiskCalculationInput): MoneyValue | null {
  if (record.valuation.value === null) return null;
  if (record.valuation.state !== "PRICED" && !(record.valuation.state === "ESTIMATED" && input.inclusionMethod === "PRICED_AND_ESTIMATED")) {
    return null;
  }
  const freshness = evaluateFreshness({
    observedAt: record.valuation.observedAt as string,
    validUntil: record.valuation.validUntil,
    policy: record.valuation.freshnessPolicy as { maxAgeSeconds: number | null },
    asOf: input.asOf,
  });
  if (freshness.state !== "CURRENT") return null;
  const converted = convertMoneyValue({
    value: record.valuation.value,
    displayCurrency: input.displayCurrency,
    scale: input.scale,
    roundingMode: input.roundingMode,
    fx: input.fx,
    asOf: input.asOf,
  });
  return converted.ok ? converted.value : null;
}

function ratioBps(numerator: MoneyValue, denominator: MoneyValue): number {
  const scale = Math.max(numerator.amount.scale, denominator.amount.scale);
  const n = BigInt(numerator.amount.units) * 10n ** BigInt(scale - numerator.amount.scale);
  const d = BigInt(denominator.amount.units) * 10n ** BigInt(scale - denominator.amount.scale);
  return Number((n * 10_000n) / d);
}

export function calculateRisk(rawInput: RiskCalculationInput): RiskCalculation {
  const input = normalizedInput(rawInput);
  const inputDigest = `0x${createHash("sha256").update(
    `RYNTRA_HOME_RISK_CALCULATION_V1\n${canonicalJson(input)}`,
    "utf8",
  ).digest("hex")}`;
  const valuation = calculateValuationCoverage({
    records: input.records,
    accountingIssues: input.accountingIssues,
    displayCurrency: input.displayCurrency,
    scale: input.scale,
    roundingMode: input.roundingMode,
    inclusionMethod: input.inclusionMethod,
    fx: input.fx,
    asOf: input.asOf,
  });
  const uncertain = new Set(input.accountingIssues.flatMap((item) => item.positionIds));
  const totals: Totals = {
    long: zero(input.scale, input.displayCurrency),
    short: zero(input.scale, input.displayCurrency),
    pending: zero(input.scale, input.displayCurrency),
    committed: zero(input.scale, input.displayCurrency),
    collateral: zero(input.scale, input.displayCurrency),
  };
  const buckets: UnknownBuckets = { settled: [], pending: [], committed: [], collateral: [] };
  const byUnderlyingRaw = new Map<string, { totals: Totals; unknowns: UnknownBuckets }>();
  const allUnknowns = valuation.unknowns.map((item) => `${item.positionId}:${item.code}`);
  const cashFlowTotals: CashFlowTotals = {
    pending: zero(input.scale, input.displayCurrency),
    fundsInMotion: zero(input.scale, input.displayCurrency),
    committed: zero(input.scale, input.displayCurrency),
  };
  const cashFlowUnknowns: CashFlowUnknowns = { pending: [], fundsInMotion: [], committed: [] };

  let spendable = zero(input.scale, input.displayCurrency);
  let locked = zero(input.scale, input.displayCurrency);
  const spendableUnknowns: string[] = [];
  const lockedUnknowns: string[] = [];
  for (const record of input.records) {
    if (uncertain.has(record.positionId)) continue;
    addExposure(
      totals,
      buckets,
      byUnderlyingRaw,
      record,
      input,
      allUnknowns,
      cashFlowTotals,
      cashFlowUnknowns,
    );
    if (record.cashState === "SPENDABLE" || record.cashState === "LOCKED_COLLATERAL") {
      const value = valuationCash(record, input);
      if (!value) {
        const reason = `${record.positionId}:CASH_VALUE_UNKNOWN`;
        allUnknowns.push(reason);
        (record.cashState === "SPENDABLE" ? spendableUnknowns : lockedUnknowns).push(reason);
      } else if (record.cashState === "SPENDABLE") {
        spendable = addMoney(spendable, value, input.scale, input.roundingMode);
      } else {
        locked = addMoney(locked, value, input.scale, input.roundingMode);
      }
    }
  }

  const longExposure = metric(totals.long, buckets.settled);
  const shortExposure = metric(totals.short, buckets.settled);
  const grossValue = addMoney(totals.long, totals.short, input.scale, input.roundingMode);
  const netValue = subtractMoney(totals.long, totals.short, input.scale, input.roundingMode);
  const grossExposure = metric(grossValue, buckets.settled);
  const netExposure = metric(netValue, buckets.settled);
  const pendingExposure = metric(totals.pending, buckets.pending);
  const committedExposure = metric(totals.committed, buckets.committed);
  const collateralExposure = metric(totals.collateral, buckets.collateral);
  const byUnderlying: UnderlyingRisk[] = [...byUnderlyingRaw.entries()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([underlyingKey, item]) => ({
      underlyingKey,
      gross: metric(addMoney(item.totals.long, item.totals.short, input.scale, input.roundingMode), item.unknowns.settled),
      long: metric(item.totals.long, item.unknowns.settled),
      short: metric(item.totals.short, item.unknowns.settled),
      net: metric(subtractMoney(item.totals.long, item.totals.short, input.scale, input.roundingMode), item.unknowns.settled),
    }));

  const completeCoverage = valuation.positionCoverageBps === 10_000
    && valuation.marketValueCoverageBps === 10_000
    && input.accountingIssues.length === 0;
  const positiveCapital = compareDecimal(valuation.netObservedValue.amount, decimal("0", 0)) > 0;
  const riskCapitalValue = completeCoverage && positiveCapital
    ? known(valuation.netObservedValue)
    : unknown(["RISK_CAPITAL_UNAVAILABLE"]);

  const cash = {
    spendable: metric(spendable, spendableUnknowns),
    pending: metric(cashFlowTotals.pending, cashFlowUnknowns.pending),
    fundsInMotion: metric(cashFlowTotals.fundsInMotion, cashFlowUnknowns.fundsInMotion),
    committed: metric(cashFlowTotals.committed, cashFlowUnknowns.committed),
    lockedCollateral: metric(locked, lockedUnknowns),
  } as const;
  const maximumUnderlying = (() => {
    const unknownEntry = byUnderlying.find((item) => item.gross.state === "UNKNOWN");
    if (unknownEntry?.gross.state === "UNKNOWN") return unknown(unknownEntry.gross.reasons);
    let maximum = zero(input.scale, input.displayCurrency);
    for (const item of byUnderlying) {
      if (item.gross.state === "KNOWN" && compareDecimal(item.gross.value.amount, maximum.amount) > 0) {
        maximum = item.gross.value;
      }
    }
    return known(maximum);
  })();

  const constraints: ConstraintResult[] = input.constraints.map((constraint) => {
    let actual: MetricValue;
    if (constraint.metric === "MAX_GROSS_EXPOSURE") actual = grossExposure;
    else if (constraint.metric === "MAX_SINGLE_UNDERLYING_EXPOSURE") actual = maximumUnderlying;
    else if (constraint.metric === "MAX_COMMITTED_CASH") actual = cash.committed;
    else if (constraint.metric === "MAX_FUNDS_IN_MOTION") actual = cash.fundsInMotion;
    else if (constraint.metric === "MIN_SPENDABLE_CASH") actual = cash.spendable;
    else actual = constraint.metric === "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE"
      ? grossExposure
      : maximumUnderlying;

    if (actual.state === "UNKNOWN") {
      return {
        id: constraint.id,
        metric: constraint.metric,
        status: "UNKNOWN",
        actual: null,
        limit: "limitBps" in constraint ? { basisPoints: constraint.limitBps } : constraint.limit,
        reason: actual.reasons.includes("RISK_CAPITAL_UNAVAILABLE") ? "RISK_CAPITAL_UNAVAILABLE" : actual.reasons[0] ?? "METRIC_UNAVAILABLE",
      };
    }

    if ("limitBps" in constraint) {
      if (riskCapitalValue.state === "UNKNOWN") {
        return {
          id: constraint.id,
          metric: constraint.metric,
          status: "UNKNOWN",
          actual: null,
          limit: { basisPoints: constraint.limitBps },
          reason: "RISK_CAPITAL_UNAVAILABLE",
        };
      }
      const basisPoints = ratioBps(actual.value, riskCapitalValue.value);
      return {
        id: constraint.id,
        metric: constraint.metric,
        status: basisPoints > constraint.limitBps ? "EXCEEDED" : "WITHIN",
        actual: { basisPoints },
        limit: { basisPoints: constraint.limitBps },
        reason: null,
      };
    }

    const comparison = compareDecimal(actual.value.amount, constraint.limit.amount);
    const exceeded = constraint.metric === "MIN_SPENDABLE_CASH" ? comparison < 0 : comparison > 0;
    return {
      id: constraint.id,
      metric: constraint.metric,
      status: exceeded ? "EXCEEDED" : "WITHIN",
      actual: actual.value,
      limit: constraint.limit,
      reason: null,
    };
  });

  return {
    schemaVersion: RISK_CALCULATION_VERSION,
    formulaVersion: RISK_FORMULA_VERSION,
    inputDigest,
    scope: input.scope,
    asOf: input.asOf,
    valuation,
    cash,
    metrics: {
      grossExposure,
      longExposure,
      shortExposure,
      netExposure,
      pendingExposure,
      committedExposure,
      collateralExposure,
      riskCapitalValue,
      byUnderlying,
    },
    constraints,
    bindingConstraintIds: constraints.filter((item) => item.status === "EXCEEDED").map((item) => item.id),
    unknowns: [...new Set(allUnknowns)].sort(compareCanonicalStrings),
  };
}
