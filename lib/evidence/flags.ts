/**
 * The compact state of a token's structure — what one line can honestly
 * say before a person opens the card.
 *
 * A flag is a fact the source reports that a person deciding on a token
 * would want named first: the mint authority present (the supply can still
 * grow), the freeze authority present (accounts can be frozen), a transfer
 * tax above zero (the token takes a cut of every transfer). No threshold
 * sits behind any of them — a share of supply is a figure the card shows,
 * never a flag, because where "elevated" begins is the person's own rule,
 * not Ryntra's. A figure the source did not answer is listed as unanswered,
 * so "no flags" is never said of a token the source could not read.
 *
 * Pure and client-safe.
 */

import type { EvidenceMetricId } from "./metrics.ts";
import { metricOf, type MarketEvidenceSnapshot } from "./snapshot.ts";

export const STRUCTURE_FLAGS = ["mint_authority", "freeze_authority", "transfer_tax"] as const;
export type StructureFlag = (typeof STRUCTURE_FLAGS)[number];

export type StructureState = Readonly<{
  /** The facts that stand, in the order the card names them. */
  flags: readonly StructureFlag[];
  /** The structural figures the source answered nothing for — "no flags" is not said while any is here. */
  unanswered: readonly EvidenceMetricId[];
}>;

const STRUCTURAL: readonly EvidenceMetricId[] = ["mint_authority", "freeze_authority", "transfer_tax_pct"];

export function structureStateOf(snapshot: MarketEvidenceSnapshot): StructureState {
  const flags: StructureFlag[] = [];
  const unanswered: EvidenceMetricId[] = [];
  const mint = metricOf(snapshot, "mint_authority");
  const freeze = metricOf(snapshot, "freeze_authority");
  const tax = metricOf(snapshot, "transfer_tax_pct");
  if (mint?.value === 1) flags.push("mint_authority");
  if (freeze?.value === 1) flags.push("freeze_authority");
  if (tax?.value !== null && tax?.value !== undefined && tax.value > 0) flags.push("transfer_tax");
  for (const id of STRUCTURAL) {
    const figure = metricOf(snapshot, id);
    if (!figure || figure.value === null) unanswered.push(id);
  }
  return { flags, unanswered };
}
