/**
 * Whether an answer the ticket could not call final is known now (SOL-C12, UX-256; the core's rule C-07: while the
 * outcome is unknown, nothing is sent a second time). A market order the network left unknown is known once the
 * wallet's history names its signature done or failed; a limit the chain had not confirmed is known once the wallet's
 * orders hold it by its signature in a state the chain decided — not «PLACING», which Ryntra writes before the bytes
 * are sent. Until then the ticket offers the transaction and a read again — never «Trade again».
 *
 * Pure.
 */

export type KnownOutcome = "done" | "failed" | "placed";

type HistoryRow = Readonly<{ signature?: string | null; outcome: string }>;
type OrderRow = Readonly<{ placeSignature: string | null; state: string }>;

export function knownOutcome(
  input: Readonly<{ signature: string | null; limit: boolean; history: readonly HistoryRow[] | null; orders: readonly OrderRow[] | null }>,
): KnownOutcome | null {
  const { signature, limit, history, orders } = input;
  if (!signature) return null;
  if (limit) {
    const order = orders?.find((row) => row.placeSignature === signature);
    if (!order || order.state === "PLACING") return null;
    return order.state === "FAILED" ? "failed" : "placed";
  }
  const row = history?.find((action) => action.signature === signature);
  if (!row) return null;
  return row.outcome === "DONE" ? "done" : row.outcome === "FAILED" ? "failed" : null;
}
