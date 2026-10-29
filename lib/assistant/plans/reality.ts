/**
 * «План проти реальності» and the receipt of each trade in words (H10).
 *
 * The trades are the plan engine's own results for the person's Trading
 * Plan — every operation History holds under it, settled on the chain, the
 * version it was bound to, the Review that stood before the signature — so
 * nothing here reads a wallet of its own. Each trade is set against the plan
 * it was made under: the price against the entry and its bound, the size
 * against the sized one, the fee, and what the position risks now at the
 * invalidation against the person's limit. Pure: no store, no clock.
 */

import type { AssistantPlanReality, AssistantPlanTrade, PlanPosition, PlanResult } from "../../api/v1/contract.ts";
import { realityWords, type Locale } from "./words.ts";

const round2 = (value: number): number => Math.round(value * 100) / 100;

function tradeOf(result: PlanResult, symbol: string, feeBps: number, locale: Locale, open: boolean): AssistantPlanTrade {
  const t = realityWords(locale);
  const side = result.actual.side;
  const planned = { priceUsd: result.plan.entryPerShareUsd, maxPriceUsd: result.plan.maxPricePerShareUsd, units: result.plan.sizedUnits };
  const price = result.actual.perShareUsd;
  const units = side === "SELL" ? (result.actual.unitsOut !== null ? Number(result.actual.unitsOut) : null) : result.actual.amount !== null ? Number(result.actual.amount) : null;
  const usd = side === "SELL" ? result.actual.proceedsUsd : result.actual.usd;
  const receipt: string[] = [];
  const risk: string[] = [];
  let priceDeviationPct: number | null = null;
  let sizeDeviationPct: number | null = null;

  if (result.actual.outcome === "FAILED") receipt.push(t.failed);
  else if (result.actual.outcome === "UNKNOWN") receipt.push(t.pending);
  else if (side === "SELL") {
    receipt.push(t.sell(units ?? 0, symbol, price, usd));
    if (result.exit) receipt.push(result.exit.verdict === "deviated" ? t.exitDeviated : t.exitFollowed);
    receipt.push(t.fee(result.actual.feeUsd, round2(((usd ?? 0) * feeBps) / 10_000)));
  } else {
    receipt.push(t.buy(units ?? 0, symbol, price, usd));
    if (price !== null) {
      priceDeviationPct = Math.round(((price - planned.priceUsd) / planned.priceUsd) * 10_000) / 100;
      receipt.push(planned.maxPriceUsd !== null && price > planned.maxPriceUsd ? t.aboveMax(planned.maxPriceUsd) : t.priceVsPlan(priceDeviationPct, planned.priceUsd));
    }
    if (units !== null && planned.units > 0) {
      sizeDeviationPct = Math.round(((units - planned.units) / planned.units) * 10_000) / 100;
      if (receipt.length < 3) receipt.push(t.sizeVsPlan(sizeDeviationPct, planned.units));
    }
    receipt.push(t.fee(result.actual.feeUsd, round2((planned.units * planned.priceUsd * feeBps) / 10_000)));
    /* The risk of the trade now — while the position is open: the units bought, from the price paid down to the invalidation, with the way out's fee. */
    if (!open) {
      /* A closed position risks nothing more; its result is in the summary. */
    } else if (price !== null && units !== null) {
      const invalidation = result.plan.invalidationPerShareUsd;
      const loss = round2(Math.max(0, units * (price - invalidation)) + (units * invalidation * feeBps) / 10_000 + (result.actual.feeUsd ?? 0));
      risk.push(t.riskNow(loss, result.plan.plannedRiskUsd));
    } else risk.push(t.riskUnknown);
    if (open) risk.push(t.noOrder);
  }
  const verdict = side === "SELL" ? (result.exit?.verdict ?? "unknown") : result.verdict;
  return {
    signature: result.actual.signature,
    at: result.actual.settledAt,
    side,
    outcome: result.actual.outcome,
    planned,
    actual: { priceUsd: price, units: units !== null && Number.isFinite(units) ? units : null, usd, feeUsd: result.actual.feeUsd },
    priceDeviationPct,
    sizeDeviationPct,
    verdict,
    receipt: receipt.slice(0, 4).map((line) => line.slice(0, 400)),
    risk: risk.slice(0, 3).map((line) => line.slice(0, 400)),
    receiptHash: result.actual.receiptHash,
  };
}

/** The plan against what happened under it — newest trade first. */
export function realityOf(input: Readonly<{ results: readonly PlanResult[]; position: PlanPosition | null; complete: boolean; symbol: string; feeBps: number; locale: Locale }>): AssistantPlanReality {
  const t = realityWords(input.locale);
  const open = input.position?.state === "open";
  const trades = input.results.slice(0, 20).map((result) => tradeOf(result, input.symbol, input.feeBps, input.locale, open));
  const summary: string[] = [];
  const position = input.position;
  if (trades.length === 0) summary.push(t.summaryNone);
  else {
    if (position?.state === "open") summary.push(t.summaryOpen(Number(position.unitsHeld), input.symbol));
    if (position?.state === "closed") summary.push(t.summaryClosed(position.realisedUsd));
    const deviated = trades.filter((trade) => trade.verdict === "deviated").length;
    summary.push(deviated > 0 ? t.summaryDeviated(deviated) : t.summaryFollowed);
  }
  return {
    trades,
    position: position
      ? { state: position.state, unitsHeld: Number.isFinite(Number(position.unitsHeld)) ? Number(position.unitsHeld) : null, costBasisUsd: position.costBasisUsd, realisedUsd: position.realisedUsd }
      : { state: "none", unitsHeld: null, costBasisUsd: null, realisedUsd: null },
    summary: summary.slice(0, 4),
    complete: input.complete,
  };
}
