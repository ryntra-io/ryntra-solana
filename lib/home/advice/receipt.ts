import { createHash } from "node:crypto";

import type { ObservedOutcome } from "./advice-case.ts";

/**
 * Receipts, and the one condition that creates them.
 *
 * The rule: **no Receipt before an authoritative observed outcome.**
 * That is the whole module. `issueReceipt` returns `null` for a case with no
 * outcome and for an outcome nobody authoritative observed, and there is no
 * second path into a `Receipt` — so a screen cannot render one by being
 * optimistic, and a pending action cannot acquire a receipt by waiting.
 *
 * **Two books, never one number.** A paper close is authoritative for the paper
 * book; a venue fill is authoritative for the venue. Their receipts sit in
 * separate books and the index deliberately exposes no combined realized
 * figure: adding a simulated result to a real one produces a number that
 * describes nothing that happened. Counts are counts and are safe to add;
 * money is not.
 *
 * `integrity` is a digest over the exact observed outcome. It is not a
 * signature, not a proof and not an attestation — it is what lets a reader see
 * that the outcome behind a receipt has not been restated since. Calling it
 * anything stronger would be the kind of claim this repository fails builds
 * over.
 */

export const RECEIPT_KINDS = ["PAPER_SIMULATED_OUTCOME", "VENUE_OBSERVED_FILL"] as const;

export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export type Receipt = Readonly<{
  receiptId: string;
  caseId: string;
  actionRef: string;
  subjectLabel: string;
  kind: ReceiptKind;
  book: "PAPER" | "LIVE";
  observedAt: string;
  observedBy: string;
  effects: readonly string[];
  realizedAmount: string | null;
  realizedCurrency: string | null;
  /** A digest over the observed outcome. Not a signature and not a proof. */
  integrity: string;
}>;

export type ReceiptRefusal = Readonly<{
  caseId: string;
  actionRef: string | null;
  subjectLabel: string;
  reason: string;
}>;

export type ReceiptBook = Readonly<{
  book: "PAPER" | "LIVE";
  label: string;
  count: number;
  receipts: readonly Receipt[];
  /** What this book's receipts are authoritative *for*. */
  authority: string;
}>;

export type ReceiptIndex = Readonly<{
  books: readonly ReceiptBook[];
  refusals: readonly ReceiptRefusal[];
  /** A count of receipts. There is no combined money figure, by design. */
  count: number;
}>;

export type ReceiptCandidate = Readonly<{
  caseId: string;
  actionRef: string | null;
  subjectLabel: string;
  outcome: ObservedOutcome | null;
}>;

const BOOK_LABEL: Readonly<Record<"PAPER" | "LIVE", string>> = {
  PAPER: "Paper",
  LIVE: "Live",
};

const BOOK_AUTHORITY: Readonly<Record<"PAPER" | "LIVE", string>> = {
  PAPER: "Authoritative for the paper book. A paper fill executes at the chosen price and slippage is not simulated, so a paper result is an optimistic bound and is never a settlement record.",
  LIVE: "Authoritative for the venue that reported the fill. Ryntra observed it; Ryntra did not execute it and holds no key that could have.",
};

function shortDigest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex");
}

export function issueReceipt(candidate: ReceiptCandidate): Receipt | null {
  const { outcome } = candidate;
  /* The gate, and there is no way round it: no outcome, or an outcome nobody
     authoritative observed, means no receipt exists to render. */
  if (outcome === null || !outcome.authoritative || candidate.actionRef === null) return null;

  const integrity = shortDigest([
    candidate.caseId,
    candidate.actionRef,
    outcome.book,
    outcome.observedAt,
    outcome.observedBy,
    outcome.realizedAmount ?? "",
    outcome.realizedCurrency ?? "",
    ...outcome.effects,
  ]);

  return Object.freeze({
    receiptId: `rcp_${shortDigest([candidate.caseId, candidate.actionRef, outcome.observedAt]).slice(0, 12)}`,
    caseId: candidate.caseId,
    actionRef: candidate.actionRef,
    subjectLabel: candidate.subjectLabel,
    kind: outcome.book === "PAPER" ? "PAPER_SIMULATED_OUTCOME" : "VENUE_OBSERVED_FILL",
    book: outcome.book,
    observedAt: outcome.observedAt,
    observedBy: outcome.observedBy,
    effects: Object.freeze([...outcome.effects]),
    realizedAmount: outcome.realizedAmount,
    realizedCurrency: outcome.realizedCurrency,
    integrity: `0x${integrity.slice(0, 16)}`,
  });
}

function refusalReason(candidate: ReceiptCandidate): string {
  if (candidate.actionRef === null) {
    return "No exact action is linked to this case, so there is nothing whose outcome could be observed and receipted.";
  }
  if (candidate.outcome === null) {
    return "This action has no observed outcome yet. A receipt before an authoritative observation would be a claim about something that has not happened.";
  }
  return `The recorded outcome was reported by ${candidate.outcome.observedBy}, which is not an authoritative observer of this action. No receipt is issued from a non-authoritative observation.`;
}

export function projectReceiptIndex(candidates: readonly ReceiptCandidate[]): ReceiptIndex {
  const receipts: Receipt[] = [];
  const refusals: ReceiptRefusal[] = [];

  for (const candidate of candidates) {
    const receipt = issueReceipt(candidate);
    if (receipt === null) {
      refusals.push(
        Object.freeze({
          caseId: candidate.caseId,
          actionRef: candidate.actionRef,
          subjectLabel: candidate.subjectLabel,
          reason: refusalReason(candidate),
        }),
      );
      continue;
    }
    receipts.push(receipt);
  }

  const books = (["LIVE", "PAPER"] as const)
    .map((book) => {
      const inBook = receipts
        .filter((receipt) => receipt.book === book)
        .sort((left, right) => {
          const byTime = right.observedAt.localeCompare(left.observedAt);
          return byTime !== 0 ? byTime : left.receiptId.localeCompare(right.receiptId);
        });
      return Object.freeze({
        book,
        label: BOOK_LABEL[book],
        count: inBook.length,
        receipts: Object.freeze(inBook),
        authority: BOOK_AUTHORITY[book],
      });
    })
    .filter((book) => book.count > 0);

  return Object.freeze({
    books: Object.freeze(books),
    refusals: Object.freeze(
      refusals.sort((left, right) => left.caseId.localeCompare(right.caseId)),
    ),
    count: receipts.length,
  });
}
