/**
 * The plan engine's own critic — the checks that run on every version
 * without a model, the same on every read: the reward against the risk after
 * fees, the fees against the move, the loss at the invalidation against the
 * person's limit, a stop inside an hour's noise, a target past the month's
 * range, an entry the market already left, liquidity too thin for the size,
 * a price already through the invalidation, levels Ryntra proposed rather
 * than the person, a thesis of a few words, stale or missing data.
 *
 * A finding names a field and cites the source it stands on; it never says
 * what to trade. Pure.
 */

import type { AssistantPlanBody, AssistantPlanFinding } from "../../api/v1/contract.ts";
import type { PlanReads } from "./reads.ts";
import { findingWords, type Locale } from "./words.ts";

type Finding = AssistantPlanFinding;

const factOf = (reads: PlanReads | null, key: string) => reads?.facts.find((fact) => fact.key === key) ?? null;

/** The rules' findings on a version; `reads` null when the market was not read again (an edit), so the market checks say nothing. */
export function ruleFindings(body: AssistantPlanBody, reads: PlanReads | null, locale: Locale): Finding[] {
  const t = findingWords(locale);
  const out: Finding[] = [];
  const push = (finding: Omit<Finding, "by">) => out.push({ ...finding, by: "rules" });
  const priceCite = reads?.priceCite ?? null;
  const cites = priceCite ? [priceCite] : [];
  const { fees } = body;
  const entry = body.entry.priceUsd;
  const target = body.targets[0]!.priceUsd;
  const units = body.sizing.units;
  const gross = units * (target - entry);

  if (fees.rewardToRisk !== null && fees.rewardToRisk < 1) push({ id: "reward-below-risk", severity: "major", kind: "loss-scenario", field: "targets", text: t.rewardBelowRisk(fees.rewardToRisk), cites: [] });
  else if (fees.rewardToRisk !== null && fees.rewardToRisk < 1.5) push({ id: "reward-thin", severity: "minor", kind: "loss-scenario", field: "targets", text: t.rewardThin(fees.rewardToRisk), cites: [] });

  if (gross > 0) {
    const share = (fees.totalUsd / gross) * 100;
    if (share >= 30) push({ id: "fees-eat-reward", severity: share >= 50 ? "major" : "minor", kind: "fees", field: "fees", text: t.feesEatReward(fees.totalUsd, share), cites: [] });
  }

  if (fees.lossAtInvalidationUsd > body.lossLimit.riskUsd * 1.02) push({ id: "loss-above-limit", severity: fees.lossAtInvalidationUsd > body.lossLimit.riskUsd * 1.1 ? "major" : "minor", kind: "fees", field: "lossLimit", text: t.lossAboveLimit(fees.lossAtInvalidationUsd, body.lossLimit.riskUsd), cites: [] });

  const stopPct = ((entry - body.invalidation.priceUsd) / entry) * 100;
  if (stopPct < 1.5) push({ id: "invalidation-tight", severity: "minor", kind: "level", field: "invalidation", text: t.invalidationTight(stopPct), cites: [] });
  else if (stopPct > 40) push({ id: "invalidation-wide", severity: "note", kind: "level", field: "invalidation", text: t.invalidationWide(stopPct), cites: [] });

  if (body.sizing.limitedBy === "capital") push({ id: "capital-limited", severity: "note", kind: "size", field: "sizing", text: t.capitalLimited(Math.min(fees.lossAtInvalidationUsd, body.lossLimit.riskUsd), body.lossLimit.riskUsd), cites: [] });

  if (reads) {
    const price = reads.priceUsd;
    if (price === null) push({ id: "price-missing", severity: "minor", kind: "data", field: "sources", text: t.priceMissing, cites: [] });
    else {
      if (price <= body.invalidation.priceUsd) push({ id: "price-below-invalidation", severity: "major", kind: "contradiction", field: "invalidation", text: t.priceBelowInvalidation(price, body.invalidation.priceUsd), cites });
      else if (price > body.entry.maxPriceUsd) push({ id: "price-above-max", severity: "minor", kind: "contradiction", field: "entry", text: t.entryAboveMax(price, body.entry.maxPriceUsd), cites });
      if (Math.abs(entry - price) / price > 0.15) push({ id: "entry-far", severity: "minor", kind: "level", field: "entry", text: t.entryFar(entry, price), cites });
      if (reads.priceState === "stale") push({ id: "price-stale", severity: "minor", kind: "data", field: "sources", text: t.priceStale, cites });
    }
    const high30 = factOf(reads, "high30d");
    if (high30 && target > high30.value) push({ id: "target-far", severity: "minor", kind: "level", field: "targets", text: t.targetFar(target, high30.value), cites: [high30.cite] });
    const low7 = factOf(reads, "low7d");
    if (low7 && body.invalidation.priceUsd > low7.value && low7.value < entry) push({ id: "invalidation-in-range", severity: "minor", kind: "level", field: "invalidation", text: t.invalidationAboveLow(body.invalidation.priceUsd, low7.value), cites: [low7.cite] });
    const liquidity = factOf(reads, "liquidity");
    if (reads.liquidityUsd === null) push({ id: "liquidity-unknown", severity: "note", kind: "liquidity", field: "fees", text: t.liquidityUnknown, cites: [] });
    else if (reads.liquidityUsd < fees.notionalUsd * 20) push({ id: "liquidity-thin", severity: reads.liquidityUsd < fees.notionalUsd * 5 ? "major" : "minor", kind: "liquidity", field: "fees", text: t.liquidityThin(reads.liquidityUsd, fees.notionalUsd), cites: liquidity ? [liquidity.cite] : [] });
  }

  if ([body.invalidation, ...body.targets].some((level) => level.by === "ryntra")) push({ id: "ryntra-levels", severity: "note", kind: "thesis", field: "invalidation", text: t.ryntraLevels, cites: [] });
  if (body.thesis.text.trim().length < 24) push({ id: "thesis-short", severity: "minor", kind: "thesis", field: "thesis", text: t.thesisShort, cites: [] });

  const rank = { major: 0, minor: 1, note: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

/** What the rules could not challenge, so an empty list is never read as approval. */
export function ruleGaps(reads: PlanReads | null, modelRan: boolean, locale: Locale): string[] {
  const t = findingWords(locale);
  const gaps: string[] = [];
  if (!modelRan) gaps.push(t.gapNoModel);
  if (reads && reads.headlines.length === 0) gaps.push(t.gapNoNews);
  if (reads && reads.candles.length === 0) gaps.push(t.gapNoCandles);
  return gaps;
}
