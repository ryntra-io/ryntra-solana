/**
 * Asking the server for a receipt this browser has not got.
 *
 * ## Why this is a module and not four lines in the card
 *
 * A receipt is addressed differently by every lane — a cross-chain operation by
 * the intent its plan was written against, a swap by the signature it settled
 * under — and those are the lanes' own words. `app/solana/workspace/hub`
 * enforces that they stop at the ledger and never reach a surface, which is
 * canon §0.5 made mechanical: a screen that speaks a lane's vocabulary is one
 * keystroke from printing it. So the vocabulary lives here, and History asks
 * for *the receipt for this row* without knowing how it is addressed.
 *
 * ## Which lanes can answer, and why the other two cannot
 *
 * `CROSS_SWAP` mints from the order and the provider's report of the fill, so
 * a bridge made on a laptop opens on a phone. `SWAP` keeps the whole signed
 * document on its owner lock and the recovery route hands it back for a swap
 * that is already receipted — it had simply never been asked for one that had
 * finished, so somebody who cleared their site data lost a receipt the server
 * still held.
 *
 * `SEND` and the CCTP `BRIDGE` lane are absent deliberately. Both mint from a
 * bundle held in the browser, and re-issuing them needs the private
 * wallet-scoped archive that waits on a Solana sign-in this repository does not
 * have. Their rows offer a receipt only where the document is here, and that is
 * an honest gap rather than a hidden one.
 */

import type { SolanaWalletAction } from "./action-ledger.ts";

/** Whether the server could produce this row's receipt if asked. */
export function receiptFetchable(action: Pick<SolanaWalletAction, "lane" | "outcome" | "signature">): boolean {
  /* Nothing is stated about an operation still in motion. */
  if (action.outcome === "IN_FLIGHT") return false;
  if (action.lane === "CROSS_SWAP") return true;
  return action.lane === "SWAP" && action.signature !== null;
}

export type FetchedReceipt = Readonly<{ ok: true; receipt: Record<string, unknown> }> | Readonly<{ ok: false }>;

/**
 * The receipt for one row, or a plain no.
 *
 * Never throws and never reports why. The caller is a button on a page about
 * money that has already moved: a receipt that could not be produced this
 * second is not a failed operation, and a provider's refusal code is not a
 * sentence for a customer screen.
 */
export async function fetchReceiptForAction(
  action: Pick<SolanaWalletAction, "lane" | "outcome" | "signature" | "actionId">,
  owner: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedReceipt> {
  if (!receiptFetchable(action)) return { ok: false };
  const request =
    action.lane === "CROSS_SWAP"
      ? { path: "/api/solana/cross-swap/receipt", body: { intentDigest: action.actionId } }
      : { path: "/api/solana/swap/recover", body: { owner, signature: action.signature } };
  try {
    const response = await fetchImpl(request.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const payload = (await response.json()) as { data?: { receipt?: unknown }; receipt?: unknown } | null;
    /* Two shapes, because the two routes were written for different jobs: the
       receipt route answers under `data`, the recovery route answers with the
       recovery result and the receipt beside it. */
    const receipt = payload?.data?.receipt ?? payload?.receipt;
    if (!response.ok || typeof receipt !== "object" || receipt === null) return { ok: false };
    return { ok: true, receipt: receipt as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
