/**
 * What an order record allows, read the same way by the server and the
 * pages. Pure.
 */

import type { PredictionOrderRecord } from "./paper.ts";

/** Provider order states that are still working, so a cancel can still take something back. */
export const WORKING_ORDER_STATES: ReadonlySet<string> = new Set(["created", "signed", "signing", "pending", "pending_bridge", "bridge_complete", "submitting", "submitted", "open", "partial_fill", "partially_filled_open", "cancel_pending"]);

/**
 * Whether the person may ask to cancel what is left of this order: the
 * provider has not finished it, it has named its orders, and at least one of
 * them is still working (or none was read yet). A filled part stays filled.
 */
export function cancellable(record: Pick<PredictionOrderRecord, "state" | "providerOrderIds" | "execution">): boolean {
  if (record.state !== "submitted") return false;
  if (record.providerOrderIds.length === 0) return false;
  const rows = record.execution?.orders ?? [];
  if (rows.length === 0) return true;
  return rows.some((o) => WORKING_ORDER_STATES.has(o.status));
}
