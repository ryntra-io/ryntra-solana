/**
 * The Nansen mapper — two provider rows in, one normalized snapshot out,
 * nothing else through.
 *
 * The rights map names the fields the mapper may read from each family; it
 * reads exactly those into the registry's metrics and lets the rest of the
 * answer fall away. A figure the source did not answer is `null` with
 * coverage `absent` — never a zero, because a zero is a claim and a null is
 * the absence of one. The provider's own `warnings[]` become coverage notes
 * in the person's language of facts (the source said the figure is limited),
 * not decoration.
 *
 * Time: `fetchedAt` is when Ryntra asked; neither family states an
 * observation time, so `observedAt` is `null` and the documented response
 * cache of the family is the stated lag. `expiresAt` is the shortest cache
 * the rights map allows across the families in the snapshot, so a combined
 * copy never outlives its most perishable part.
 *
 * Pure: rows and a clock in, a snapshot out; no fetch, no key, no store.
 */

import type { EvidenceWindow, MarketWindow } from "../../metrics.ts";
import { familyRights, filterFields, NANSEN_RIGHTS } from "../../rights.ts";
import { EVIDENCE_NETWORK, type EvidenceCoverage, type EvidenceMetricValue, type MarketEvidenceSnapshot } from "../../snapshot.ts";

export const NANSEN_SCREENER_FAMILY = "tgm/token-screener";
export const NANSEN_FLOWS_FAMILY = "tgm/flow-intelligence";

/** The provider's timeframe words for Ryntra's windows, per family. */
export const NANSEN_TIMEFRAMES: Readonly<Record<MarketWindow, Readonly<{ screener: string; flows: string }>>> = {
  "24h": { screener: "24h", flows: "1d" },
  "7d": { screener: "7d", flows: "7d" },
};

export type NansenFamilyAnswer = Readonly<{
  /** The first row the family answered, or null when it answered none. */
  row: Readonly<Record<string, unknown>> | null;
  /** Whether the family answered at all (a failure is `false`; an empty answer is `true` with `row: null`). */
  answered: boolean;
  /** The provider's own warnings, verbatim, bounded. */
  warnings: readonly string[];
  /** Why the family did not answer, when it did not. */
  failure: string | null;
}>;

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function figure(id: EvidenceMetricValue["id"], unit: EvidenceMetricValue["unit"], window: EvidenceWindow, value: number | null, answered: boolean, note: string | null): EvidenceMetricValue {
  const coverage: EvidenceCoverage = value === null ? "absent" : note ? "partial" : "full";
  return { id, value, unit, window, coverage, note: value === null && !answered ? (note ?? "The source did not answer.") : note };
}

/** Every object row the answer's `data` carries (a list, or one object as a list of one). */
export function rowsOf(json: unknown): readonly Readonly<Record<string, unknown>>[] {
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : null;
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export function firstRow(json: unknown): Readonly<Record<string, unknown>> | null {
  return rowsOf(json)[0] ?? null;
}

export function warningsOf(json: unknown): readonly string[] {
  const warnings = json && typeof json === "object" ? (json as { warnings?: unknown }).warnings : null;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((warning): warning is string => typeof warning === "string").map((warning) => warning.slice(0, 200)).slice(0, 5);
}

/**
 * Build the snapshot. Returns `null` when neither family answered a row for
 * the token — the provider covers no such asset, which the read reports as
 * UNKNOWN rather than as a card of nulls.
 */
export function mapNansenSnapshot(input: {
  mint: string;
  window: EvidenceWindow;
  fetchedAtMs: number;
  screener: NansenFamilyAnswer;
  flows: NansenFamilyAnswer;
}): MarketEvidenceSnapshot | null {
  const { window } = input;
  const screenerRights = familyRights(NANSEN_RIGHTS, NANSEN_SCREENER_FAMILY);
  const flowsRights = familyRights(NANSEN_RIGHTS, NANSEN_FLOWS_FAMILY);
  if (!screenerRights || !flowsRights) throw new Error("the Nansen rights map names no screener or flows family");

  const screenerRow = input.screener.row ? filterFields(screenerRights, input.screener.row) : null;
  const flowsRow = input.flows.row ? filterFields(flowsRights, input.flows.row) : null;
  if (!screenerRow && !flowsRow) return null;

  const symbol = typeof screenerRow?.token_symbol === "string" && screenerRow.token_symbol.length <= 32 ? screenerRow.token_symbol : null;
  const screenerNote = input.screener.answered ? null : (input.screener.failure ?? "The source did not answer.");
  const flowsNote = input.flows.answered ? null : (input.flows.failure ?? "The source did not answer.");
  const flowsWarning = input.flows.warnings.length > 0 ? input.flows.warnings.join(" ") : null;

  const metrics: EvidenceMetricValue[] = [
    figure("dex_volume_usd", "usd", window, number(screenerRow?.volume), input.screener.answered, screenerNote),
    figure("dex_buy_volume_usd", "usd", window, number(screenerRow?.buy_volume), input.screener.answered, screenerNote),
    figure("dex_sell_volume_usd", "usd", window, number(screenerRow?.sell_volume), input.screener.answered, screenerNote),
    figure("dex_net_volume_usd", "usd", window, number(screenerRow?.netflow), input.screener.answered, screenerNote),
    figure("exchange_net_flow_usd", "usd", window, number(flowsRow?.exchange_net_flow_usd), input.flows.answered, flowsNote ?? flowsWarning),
    figure("whale_net_flow_usd", "usd", window, number(flowsRow?.whale_net_flow_usd), input.flows.answered, flowsNote ?? flowsWarning),
    figure("whale_wallet_count", "wallets", window, number(flowsRow?.whale_wallet_count), input.flows.answered, flowsNote ?? flowsWarning),
  ];

  const families = [screenerRow ? NANSEN_SCREENER_FAMILY : null, flowsRow ? NANSEN_FLOWS_FAMILY : null].filter((family): family is string => family !== null);
  const cacheSeconds = Math.min(...families.map((family) => familyRights(NANSEN_RIGHTS, family)?.cacheSeconds[window] ?? Infinity));
  const lagSeconds = Math.max(...families.map((family) => familyRights(NANSEN_RIGHTS, family)?.providerLagSeconds[window] ?? 0));
  const warnings: string[] = [];
  if (!screenerRow) warnings.push(input.screener.answered ? "The source has no trading figures for this token." : `Trading figures: ${screenerNote}`);
  if (!flowsRow) warnings.push(input.flows.answered ? "The source has no movement figures for this token." : `Movement figures: ${flowsNote}`);
  if (flowsRow && flowsWarning) warnings.push(flowsWarning);

  return {
    provider: "nansen",
    subject: { network: EVIDENCE_NETWORK, mint: input.mint, symbol },
    window,
    fetchedAt: new Date(input.fetchedAtMs).toISOString(),
    observedAt: null,
    providerLagSeconds: lagSeconds,
    expiresAt: new Date(input.fetchedAtMs + cacheSeconds * 1000).toISOString(),
    metrics,
    warnings,
    attribution: NANSEN_RIGHTS.attribution,
    rightsPolicy: NANSEN_RIGHTS.policy,
    families,
  };
}
