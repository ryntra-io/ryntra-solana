/* Portfolio Heat — venue-agnostic exposure/concentration engine (STEP 5).
   First consumer: Robinhood Chain wallet holdings + Arcus positions. Pure and deterministic:
   no I/O, no LLM. HONESTY RULES (tested):
     - a holding with unknown value is NEVER treated as zero — totals over a partial set are
       explicitly flagged "partial-data" and percentages are computed over the KNOWN subset only
     - any stale/unknown input propagates to the heat's own dataState (never shown green)
     - correlated risk groups by asset family (tokenized equities move with equities, crypto
       with crypto) — a deliberate coarse first cut, labeled as such, never fake per-name betas */

import type { DataState } from "./capability.ts";
import { combineDataStates } from "./capability.ts";
import type { InstrumentKey } from "./instrument.ts";
import { instrumentId } from "./instrument.ts";

export type HeatHolding = {
  instrument: InstrumentKey;
  /** Position value in USD terms; null when it could not be measured (never guess). */
  notionalUsd: number | null;
  /** Freshness of the valuation input (price × amount). */
  valueState: DataState;
};

export type HeatPolicy = {
  /** Warn when one instrument exceeds this % of known exposure. */
  maxSingleInstrumentPct: number;
  /** Warn when one correlated family exceeds this % of known exposure. */
  maxCorrelatedGroupPct: number;
};

export const DEFAULT_HEAT_POLICY: HeatPolicy = { maxSingleInstrumentPct: 25, maxCorrelatedGroupPct: 60 };

/** Coarse correlation families — honest first cut, not a covariance model. */
export type CorrelationFamily = "equities" | "crypto";

export function correlationFamilyOf(k: InstrumentKey): CorrelationFamily {
  return k.kind === "spot-tokenized-equity" || k.kind === "rwa-perp" ? "equities" : "crypto";
}

export type HeatExposure = {
  id: string; // instrumentId
  instrument: InstrumentKey;
  notionalUsd: number;
  /** % of KNOWN exposure (see partialData). */
  pct: number;
};

export type HeatGroup = {
  family: CorrelationFamily;
  notionalUsd: number;
  pct: number;
};

export type PortfolioHeat = {
  /** Sum over holdings whose value IS known. */
  knownNotionalUsd: number;
  /** Count of holdings excluded because their value is unknown. */
  unknownCount: number;
  /** True when percentages cover only part of the portfolio — UI must disclose it. */
  partialData: boolean;
  exposures: HeatExposure[]; // sorted desc by notional
  groups: HeatGroup[]; // sorted desc by notional
  /** Machine warning codes: "concentration:<id>", "correlated:<family>", "partial-data". */
  warnings: string[];
  /** Worst input freshness — the whole panel inherits it. */
  dataState: DataState;
};

const measurable = (h: HeatHolding): boolean =>
  h.notionalUsd != null && Number.isFinite(h.notionalUsd) && h.notionalUsd > 0;

export function computePortfolioHeat(
  holdings: readonly HeatHolding[],
  policy: HeatPolicy = DEFAULT_HEAT_POLICY
): PortfolioHeat {
  const known = holdings.filter(measurable);
  const unknownCount = holdings.length - known.length;
  const total = known.reduce((s, h) => s + (h.notionalUsd as number), 0);

  const exposures: HeatExposure[] = known
    .map((h) => ({
      id: instrumentId(h.instrument),
      instrument: h.instrument,
      notionalUsd: h.notionalUsd as number,
      pct: total > 0 ? ((h.notionalUsd as number) / total) * 100 : 0,
    }))
    .sort((a, b) => b.notionalUsd - a.notionalUsd);

  const byFamily = new Map<CorrelationFamily, number>();
  for (const h of known) {
    const fam = correlationFamilyOf(h.instrument);
    byFamily.set(fam, (byFamily.get(fam) ?? 0) + (h.notionalUsd as number));
  }
  const groups: HeatGroup[] = [...byFamily.entries()]
    .map(([family, notionalUsd]) => ({
      family,
      notionalUsd,
      pct: total > 0 ? (notionalUsd / total) * 100 : 0,
    }))
    .sort((a, b) => b.notionalUsd - a.notionalUsd);

  const warnings: string[] = [];
  if (unknownCount > 0) warnings.push("partial-data");
  for (const e of exposures) {
    if (e.pct > policy.maxSingleInstrumentPct) warnings.push(`concentration:${e.id}`);
  }
  for (const g of groups) {
    if (g.pct > policy.maxCorrelatedGroupPct) warnings.push(`correlated:${g.family}`);
  }

  // Unmeasurable holdings force the panel's data state down even if known inputs are fresh.
  const inputStates = holdings.map((h) => (measurable(h) ? h.valueState : "unknown"));
  const dataState = combineDataStates(inputStates);

  return {
    knownNotionalUsd: total,
    unknownCount,
    partialData: unknownCount > 0,
    exposures,
    groups,
    warnings,
    dataState,
  };
}
