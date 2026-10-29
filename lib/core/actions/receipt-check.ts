/**
 * The receipt check — does this Outcome Receipt prove *this* action (EXE-2; spec §3.2 «Outcome Receipt», §14.6)?
 *
 * The receipt's own four axes come from the offline verifier every Solana receipt already has
 * (`lib/solana/receipt.ts`); nothing of it is re-implemented. On top of them the ledger asks what only it can: is the
 * receipt's transaction one this action submitted, on the action's network, and does its outcome agree with what the
 * ledger observed. A receipt that is sound but for another action is refused like a forged one — it proves nothing
 * here.
 */

import { verifySolanaOutcomeReceipt, type SolanaReceiptVerification } from "../../solana/receipt.ts";
import type { ActionIntent } from "./model.ts";

export const RECEIPT_CHECK_REASONS = [
  "RECEIPT_UNRECOGNISED",
  "RECEIPT_SCHEMA_INVALID",
  "RECEIPT_INTEGRITY_FAILED",
  "RECEIPT_UNSIGNED",
  "RECEIPT_SIGNATURE_INVALID",
  "RECEIPT_UNTRUSTED_KEY",
  "RECEIPT_NOT_SOLANA",
  "RECEIPT_NETWORK_MISMATCH",
  "RECEIPT_TRANSACTION_MISMATCH",
  "RECEIPT_OUTCOME_MISMATCH",
] as const;
export type ReceiptCheckReason = (typeof RECEIPT_CHECK_REASONS)[number];

export type ActionReceiptCheck = Readonly<{
  ok: boolean;
  reasons: readonly ReceiptCheckReason[];
  verification: SolanaReceiptVerification;
  /** Read from the receipt when its shape held; what the ledger stores beside the verdict. */
  ref: Readonly<{ receiptId: string; contentHash: string; transactionHash: string }> | null;
}>;

export type ReceiptCheckOptions = Readonly<{
  /** The issuer keys this deployment publishes. Required: without them a sound signature by any key would pass. */
  trustedPublicKeys: readonly string[];
  /** Whether the chain showed the transaction landing (`LANDED`) or failing (`FAILED`); null when not yet observed. */
  observed: "LANDED" | "FAILED" | null;
}>;

export function verifyActionReceipt(action: ActionIntent, receipt: unknown, options: ReceiptCheckOptions): ActionReceiptCheck {
  const verification = verifySolanaOutcomeReceipt(receipt, { trustedPublicKeys: options.trustedPublicKeys });
  const reasons: ReceiptCheckReason[] = [];
  if (options.trustedPublicKeys.length === 0) reasons.push("RECEIPT_UNTRUSTED_KEY");
  if (!verification.recognised) reasons.push("RECEIPT_UNRECOGNISED");
  else if (!verification.schema.valid) reasons.push("RECEIPT_SCHEMA_INVALID");
  if (verification.schema.valid && !verification.integrity.valid) reasons.push("RECEIPT_INTEGRITY_FAILED");
  if (verification.schema.valid) {
    if (verification.issuer.verdict === "UNSIGNED") reasons.push("RECEIPT_UNSIGNED");
    if (verification.issuer.verdict === "SIGNATURE_INVALID") reasons.push("RECEIPT_SIGNATURE_INVALID");
    if (verification.issuer.verdict === "UNTRUSTED_KEY" && !reasons.includes("RECEIPT_UNTRUSTED_KEY")) reasons.push("RECEIPT_UNTRUSTED_KEY");
    if (verification.binding.verdict === "NOT_SOLANA" || verification.binding.verdict === "UNREADABLE") reasons.push("RECEIPT_NOT_SOLANA");
  }
  const outcome = verification.outcome;
  if (outcome) {
    if (outcome.network !== action.cluster) reasons.push("RECEIPT_NETWORK_MISMATCH");
    if (!action.signatures.includes(outcome.transactionHash)) reasons.push("RECEIPT_TRANSACTION_MISMATCH");
    /* A receipt that says the action failed proves a failure; it never reconciles a landing, nor the other way round. */
    const receiptLanded = outcome.status !== "FAILED";
    if (options.observed !== null && receiptLanded !== (options.observed === "LANDED")) reasons.push("RECEIPT_OUTCOME_MISMATCH");
  }
  const parsed = receipt as { id?: unknown; contentHash?: unknown } | null;
  const ref = verification.schema.valid && outcome && typeof parsed?.id === "string" && typeof parsed.contentHash === "string"
    ? { receiptId: parsed.id, contentHash: parsed.contentHash, transactionHash: outcome.transactionHash }
    : null;
  return Object.freeze({ ok: reasons.length === 0, reasons: Object.freeze(reasons), verification, ref });
}
