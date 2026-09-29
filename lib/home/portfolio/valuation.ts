import { compareCanonicalStrings } from "../../guard/canonical-json.ts";
import type { AccountingIssue } from "./accounting.ts";
import {
  absoluteDecimal,
  addDecimal,
  compareDecimal,
  decimal,
  multiplyDecimal,
  rescale,
  subtractDecimal,
  type DecimalValue,
  type MoneyValue,
  type RoundingMode,
} from "./decimal.ts";
import { evaluateFreshness, type FreshnessPolicy } from "./freshness.ts";
import { VALUATION_STATES, type PositionRecord } from "./position.ts";

export type InclusionMethod = "PRICED_ONLY" | "PRICED_AND_ESTIMATED";

export type FxReference = Readonly<{
  baseCurrency: string;
  quoteCurrency: string;
  rate: DecimalValue;
  sourceRef: string;
  observedAt: string;
  validUntil: string | null;
  freshnessPolicy: FreshnessPolicy;
}>;

export type ValuationUnknown = Readonly<{
  code:
    | "POTENTIAL_DUPLICATE"
    | "ACCOUNTING_CONFLICT"
    | "MISSING_FX"
    | "STALE_FX"
    | "CONFLICTING_FX"
    | "INVALID_FX"
    | "FUTURE_OBSERVATION"
    | "VALUATION_UNAVAILABLE";
  positionId: string;
  detail: string;
}>;

export type ValuationCoverage = Readonly<{
  displayCurrency: string;
  scale: number;
  inclusionMethod: InclusionMethod;
  stateCounts: Readonly<Record<(typeof VALUATION_STATES)[number], number>>;
  eligiblePositionCount: number;
  includedPositionCount: number;
  positionCoverageBps: number | null;
  marketValueCoverageBps: number | null;
  observedAssetValue: MoneyValue;
  observedLiabilities: MoneyValue;
  netObservedValue: MoneyValue;
  pricedSubtotal: MoneyValue;
  estimatedSubtotal: MoneyValue;
  staleSubtotal: MoneyValue;
  unknowns: readonly ValuationUnknown[];
}>;

export type MoneyConversion =
  | Readonly<{ ok: true; value: MoneyValue }>
  | Readonly<{ ok: false; code: "MISSING_FX" | "STALE_FX" | "CONFLICTING_FX" | "INVALID_FX"; detail: string }>;

function money(units: string, scale: number, currency: string): MoneyValue {
  return { amount: decimal(units, scale), currency };
}

function zero(scale: number, currency: string): MoneyValue {
  return money("0", scale, currency);
}

function addMoney(left: MoneyValue, right: MoneyValue, scale: number, mode: RoundingMode): MoneyValue {
  if (left.currency !== right.currency) throw new TypeError("money currency mismatch");
  return { amount: addDecimal(left.amount, right.amount, scale, mode), currency: left.currency };
}

function absoluteMoney(value: MoneyValue): MoneyValue {
  return { ...value, amount: absoluteDecimal(value.amount) };
}

export function convertMoneyValue(input: {
  value: MoneyValue;
  displayCurrency: string;
  scale: number;
  roundingMode: RoundingMode;
  fx: readonly FxReference[];
  asOf: string;
}): MoneyConversion {
  if (input.value.currency === input.displayCurrency) {
    return {
      ok: true,
      value: {
        amount: rescale(input.value.amount, input.scale, input.roundingMode),
        currency: input.displayCurrency,
      },
    };
  }
  const matches = input.fx
    .filter((item) => item.baseCurrency === input.value.currency && item.quoteCurrency === input.displayCurrency)
    .sort((left, right) => compareCanonicalStrings(left.sourceRef, right.sourceRef));
  if (matches.length === 0) {
    return { ok: false, code: "MISSING_FX", detail: `${input.value.currency}/${input.displayCurrency}` };
  }
  if (matches.length > 1) {
    return { ok: false, code: "CONFLICTING_FX", detail: `${input.value.currency}/${input.displayCurrency}` };
  }
  const reference = matches[0];
  if (compareDecimal(reference.rate, decimal("0", 0)) <= 0) {
    return { ok: false, code: "INVALID_FX", detail: reference.sourceRef };
  }
  const freshness = evaluateFreshness({
    observedAt: reference.observedAt,
    validUntil: reference.validUntil,
    policy: reference.freshnessPolicy,
    asOf: input.asOf,
  });
  if (freshness.state !== "CURRENT") {
    return { ok: false, code: freshness.state === "INVALID" ? "INVALID_FX" : "STALE_FX", detail: reference.sourceRef };
  }
  return {
    ok: true,
    value: {
      amount: multiplyDecimal(input.value.amount, reference.rate, input.scale, input.roundingMode),
      currency: input.displayCurrency,
    },
  };
}

/**
 * The valuation state a record actually has at `asOf`, staleness included.
 *
 * Exported so a projection can group or order by the same state this file
 * totals by. A second implementation of "is this price still current" is the
 * exact duplication the Home read model is forbidden to carry.
 */
export function effectiveState(record: PositionRecord, asOf: string): (typeof VALUATION_STATES)[number] {
  const state = record.valuation.state;
  if (state !== "PRICED" && state !== "ESTIMATED") return state;
  const freshness = evaluateFreshness({
    observedAt: record.valuation.observedAt as string,
    validUntil: record.valuation.validUntil,
    policy: record.valuation.freshnessPolicy as FreshnessPolicy,
    asOf,
  });
  return freshness.state === "CURRENT" ? state : "STALE";
}

/** Whether a state enters the total under the given inclusion method. */
export function included(state: (typeof VALUATION_STATES)[number], method: InclusionMethod): boolean {
  return state === "PRICED" || (state === "ESTIMATED" && method === "PRICED_AND_ESTIMATED");
}

function coverageBps(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  return Number((numerator * 10_000n) / denominator);
}

function unknownSort(left: ValuationUnknown, right: ValuationUnknown): number {
  return compareCanonicalStrings(
    `${left.code}\u0000${left.positionId}\u0000${left.detail}`,
    `${right.code}\u0000${right.positionId}\u0000${right.detail}`,
  );
}

export function calculateValuationCoverage(input: {
  records: readonly PositionRecord[];
  accountingIssues: readonly AccountingIssue[];
  displayCurrency: string;
  scale: number;
  roundingMode: RoundingMode;
  inclusionMethod: InclusionMethod;
  fx: readonly FxReference[];
  asOf: string;
}): ValuationCoverage {
  const stateCounts = Object.fromEntries(VALUATION_STATES.map((state) => [state, 0])) as Record<(typeof VALUATION_STATES)[number], number>;
  const uncertain = new Map<string, AccountingIssue["code"]>();
  for (const issue of input.accountingIssues) {
    for (const positionId of issue.positionIds) uncertain.set(positionId, issue.code);
  }
  const eligible = [...input.records]
    .filter((record) =>
      record.book === "LIVE"
      && record.accountingRole === "PRIMARY"
      && record.valuationContribution !== "NONE")
    .sort((left, right) => compareCanonicalStrings(left.positionId, right.positionId));

  let includedPositionCount = 0;
  let fullMagnitudeKnown = uncertain.size === 0;
  let includedMagnitude = zero(input.scale, input.displayCurrency);
  let fullMagnitude = zero(input.scale, input.displayCurrency);
  let observedAssetValue = zero(input.scale, input.displayCurrency);
  let observedLiabilities = zero(input.scale, input.displayCurrency);
  let pricedSubtotal = zero(input.scale, input.displayCurrency);
  let estimatedSubtotal = zero(input.scale, input.displayCurrency);
  let staleSubtotal = zero(input.scale, input.displayCurrency);
  const unknowns: ValuationUnknown[] = [];

  for (const record of eligible) {
    const state = effectiveState(record, input.asOf);
    stateCounts[state] += 1;
    const isIncluded = included(state, input.inclusionMethod) && !uncertain.has(record.positionId);
    if (isIncluded) includedPositionCount += 1;

    const issueCode = uncertain.get(record.positionId);
    if (issueCode) {
      fullMagnitudeKnown = false;
      unknowns.push({ code: issueCode, positionId: record.positionId, detail: "accounting identity is unresolved" });
      continue;
    }
    if (record.valuation.value === null) {
      fullMagnitudeKnown = false;
      unknowns.push({ code: "VALUATION_UNAVAILABLE", positionId: record.positionId, detail: state });
      continue;
    }

    const converted = convertMoneyValue({
      value: record.valuation.value,
      displayCurrency: input.displayCurrency,
      scale: input.scale,
      roundingMode: input.roundingMode,
      fx: input.fx,
      asOf: input.asOf,
    });
    if (!converted.ok) {
      fullMagnitudeKnown = false;
      unknowns.push({ code: converted.code, positionId: record.positionId, detail: converted.detail });
      continue;
    }

    const magnitude = absoluteMoney(converted.value);
    fullMagnitude = addMoney(fullMagnitude, magnitude, input.scale, input.roundingMode);
    if (state === "PRICED") pricedSubtotal = addMoney(pricedSubtotal, magnitude, input.scale, input.roundingMode);
    if (state === "ESTIMATED") estimatedSubtotal = addMoney(estimatedSubtotal, magnitude, input.scale, input.roundingMode);
    if (state === "STALE") staleSubtotal = addMoney(staleSubtotal, magnitude, input.scale, input.roundingMode);
    if (!isIncluded) continue;

    includedMagnitude = addMoney(includedMagnitude, magnitude, input.scale, input.roundingMode);
    if (record.valuationContribution === "ASSET") {
      observedAssetValue = addMoney(observedAssetValue, converted.value, input.scale, input.roundingMode);
    } else {
      observedLiabilities = addMoney(observedLiabilities, converted.value, input.scale, input.roundingMode);
    }
  }

  const eligiblePositionCount = eligible.length;
  const positionCoverageBps = eligiblePositionCount === 0
    ? null
    : Math.floor((includedPositionCount * 10_000) / eligiblePositionCount);
  const fullUnits = BigInt(fullMagnitude.amount.units);
  const marketValueCoverageBps = fullMagnitudeKnown
    ? coverageBps(BigInt(includedMagnitude.amount.units), fullUnits)
    : null;
  const netObservedValue: MoneyValue = {
    amount: subtractDecimal(
      observedAssetValue.amount,
      observedLiabilities.amount,
      input.scale,
      input.roundingMode,
    ),
    currency: input.displayCurrency,
  };

  return {
    displayCurrency: input.displayCurrency,
    scale: input.scale,
    inclusionMethod: input.inclusionMethod,
    stateCounts,
    eligiblePositionCount,
    includedPositionCount,
    positionCoverageBps,
    marketValueCoverageBps,
    observedAssetValue,
    observedLiabilities,
    netObservedValue,
    pricedSubtotal,
    estimatedSubtotal,
    staleSubtotal,
    unknowns: unknowns.sort(unknownSort),
  };
}
