import { isResolved, type EvidenceSource } from "../evidence.ts";
import { transactionExplorerUrl, type StellarNetwork, type StellarNetworkId } from "../network.ts";
import { hashCanonicalAsync } from "./digest.ts";
import { observeActualEffects, type ActualEffects, type ExpectedEffects, type ObserveOptions } from "./effects.ts";
import type { TransactionFingerprint } from "./fingerprint.ts";
import { reconcile, type Reconciliation } from "./reconcile.ts";

/**
 * The receipt, and the only thing that makes it one.
 *
 * A document that says a payment happened is not a receipt; it is a claim by
 * whoever wrote it. What makes this a receipt is that every link in it can be
 * recomputed by somebody who does not trust Ryntra:
 *
 * ```text
 * intentHash → authorizationHash → transaction hash → actualEffectsHash → receiptHash
 * ```
 *
 * Each hash is taken over canonical JSON with the Guard kernel's own
 * canonicalizer, so the same bytes produce the same digest on a server, in a
 * browser, or in somebody else's script. `verifyReceipt` recomputes all of them
 * and then goes back to the ledger — it treats the receipt's own contents as a
 * claim to check, never as a source.
 *
 * **What this receipt deliberately does not contain.** There is no strategy
 * version, no policy version and no route plan, because the strategy and
 * policy layers are not built. They appear as `null` with a reason rather
 * than being omitted: a field that is absent looks like an oversight, and a
 * field that is absent from a receipt looks like something removed.
 */

/**
 * The current shape.
 *
 * `1.1.0` adds the ledger's own result code to the observed effects — the
 * answer to *why* a transaction was refused, which `1.0.0` recorded nowhere.
 * A `1.0.0` receipt still verifies against itself, because every hash is taken
 * over the document's own contents; what it cannot do is be re-derived from a
 * fresh ledger read by this reader, and `verifyReceipt` says so in those words
 * rather than reporting the mismatch as tampering.
 */
export const STELLAR_RECEIPT_SCHEMA = "stellar-lifecycle-1.1.0" as const;

/** Every shape this reader can read. Order is oldest first. */
export const STELLAR_RECEIPT_SCHEMAS = ["stellar-lifecycle-1.0.0", "stellar-lifecycle-1.1.0"] as const;

/**
 * The limitations every one of these receipts states about itself.
 *
 * Written into the hashed body, so a receipt cannot be republished with them
 * quietly edited out — the hash would stop matching, which is the point.
 */
export const STELLAR_RECEIPT_LIMITATIONS = [
  "TESTNET_ONLY_NO_VALUE_MOVED",
  "RYNTRA_HELD_NO_KEY_AND_SIGNED_NOTHING",
  "NO_POLICY_EVALUATION_IN_THIS_LIFECYCLE",
  "NOT_LEGAL_OR_COMPLIANCE_PROOF",
  "EXTERNAL_SOURCE_TRUTH_NOT_GUARANTEED",
] as const;

export type StellarReceiptBody = Readonly<{
  schemaVersion: (typeof STELLAR_RECEIPT_SCHEMAS)[number];
  network: StellarNetworkId;
  intent: Readonly<{ hash: string; fingerprint: TransactionFingerprint }>;
  /** Named and null, never absent. See the note above. */
  decision: Readonly<{
    strategyVersion: null;
    policyVersion: null;
    policyDecision: null;
    routePlanHash: null;
    reason: string;
  }>;
  authorization: Readonly<{
    hash: string;
    method: "RYNTRA_IN_APP_HUMAN_AUTHORIZATION";
    /** The account that authorized and signed. A public address, never a key. */
    subject: string;
    authorizedAt: string;
    /** The transaction's own upper time bound: an authorization that expires. */
    expiresAt: string | null;
  }>;
  execution: Readonly<{
    transactionHash: string;
    submittedAt: string;
    ledger: number;
    closedAt: string;
    explorerUrl: string;
  }>;
  expected: ExpectedEffects;
  actual: ActualEffects;
  actualEffectsHash: string;
  reconciliation: Reconciliation;
  evidence: Readonly<{ sources: readonly EvidenceSource[]; observedAt: string }>;
  limitations: readonly string[];
  finalizedAt: string;
}>;

export type StellarLifecycleReceipt = StellarReceiptBody & Readonly<{ receiptHash: string }>;

/** The bytes the receipt hash covers: everything except the hash itself. */
function receiptBody(receipt: StellarLifecycleReceipt): StellarReceiptBody {
  const { receiptHash: _omitted, ...body } = receipt;
  return body;
}

export async function hashIntent(fingerprint: TransactionFingerprint): Promise<string> {
  return hashCanonicalAsync({ kind: "stellar.intent", fingerprint });
}

export async function hashAuthorization(input: {
  intentHash: string;
  subject: string;
  authorizedAt: string;
  expiresAt: string | null;
}): Promise<string> {
  /* The intent hash is inside the authorization hash on purpose. An
     authorization that does not commit to what was authorized is a timestamp
     with a name on it, and could be replayed against a different intent. */
  return hashCanonicalAsync({ kind: "stellar.authorization", method: "RYNTRA_IN_APP_HUMAN_AUTHORIZATION", ...input });
}

export async function hashActualEffects(actual: ActualEffects): Promise<string> {
  return hashCanonicalAsync({ kind: "stellar.actualEffects", actual });
}

export type FinalizeInput = Readonly<{
  network: StellarNetwork;
  fingerprint: TransactionFingerprint;
  subject: string;
  authorizedAt: string;
  /** Unix seconds from the transaction's timebounds, when it has one. */
  expiresAtUnix: number | null;
  submittedAt: string;
  expected: ExpectedEffects;
  actual: ActualEffects;
  sources: readonly EvidenceSource[];
  observedAt: string;
  finalizedAt: string;
}>;

/**
 * Close the lifecycle.
 *
 * Reconciliation is computed here rather than accepted as an argument. A
 * receipt that is handed its own verdict can be handed the wrong one, and the
 * one field nobody may supply to a receipt is whether it reconciled.
 */
export async function finalizeReceipt(input: FinalizeInput): Promise<StellarLifecycleReceipt> {
  const intentHash = await hashIntent(input.fingerprint);
  const expiresAt = input.expiresAtUnix === null ? null : new Date(input.expiresAtUnix * 1000).toISOString();
  const authorizationHash = await hashAuthorization({
    intentHash,
    subject: input.subject,
    authorizedAt: input.authorizedAt,
    expiresAt,
  });

  const body: StellarReceiptBody = {
    schemaVersion: STELLAR_RECEIPT_SCHEMA,
    network: input.network.id,
    intent: { hash: intentHash, fingerprint: input.fingerprint },
    decision: {
      strategyVersion: null,
      policyVersion: null,
      policyDecision: null,
      routePlanHash: null,
      reason:
        "This lifecycle ran without strategy, policy or route evidence. Those layers are not built, so no decision was evaluated and none is claimed here.",
    },
    authorization: {
      hash: authorizationHash,
      method: "RYNTRA_IN_APP_HUMAN_AUTHORIZATION",
      subject: input.subject,
      authorizedAt: input.authorizedAt,
      expiresAt,
    },
    execution: {
      transactionHash: input.actual.transactionHash,
      submittedAt: input.submittedAt,
      ledger: input.actual.ledger,
      closedAt: input.actual.closedAt,
      explorerUrl: transactionExplorerUrl(input.network, input.actual.transactionHash),
    },
    expected: input.expected,
    actual: input.actual,
    actualEffectsHash: await hashActualEffects(input.actual),
    reconciliation: reconcile(input.expected, input.actual),
    evidence: { sources: input.sources, observedAt: input.observedAt },
    limitations: [...STELLAR_RECEIPT_LIMITATIONS],
    finalizedAt: input.finalizedAt,
  };

  return { ...body, receiptHash: await hashCanonicalAsync(body) };
}

/* ------------------------------------------------------- verification -- */

export type ReceiptFinding = Readonly<{
  id: string;
  label: string;
  outcome: "CONFIRMED" | "FAILED" | "UNCHECKABLE";
  detail: string;
}>;

export type ReceiptVerification = Readonly<{
  /** `ALTERED` is a statement about the document; `UNCONFIRMED` about the check. */
  verdict: "CONFIRMED" | "ALTERED" | "UNCONFIRMED";
  findings: readonly ReceiptFinding[];
}>;

/**
 * Check a receipt against the ledger, trusting nothing in it.
 *
 * Two independent questions, and they fail differently. Is the document intact
 * — do its own hashes still describe its own contents? And is it true — does
 * the ledger, read again now, still say what it says? A document can be intact
 * and describe a transaction that never happened, which is why the second
 * question is asked of Horizon and not of the receipt.
 */
export async function verifyReceipt(
  receipt: StellarLifecycleReceipt,
  network: StellarNetwork,
  options: ObserveOptions = {},
): Promise<ReceiptVerification> {
  const findings: ReceiptFinding[] = [];
  const add = (finding: ReceiptFinding) => findings.push(finding);

  const recomputedReceiptHash = await hashCanonicalAsync(receiptBody(receipt));
  add({
    id: "hash.receipt",
    label: "The receipt hash covers this exact document",
    outcome: recomputedReceiptHash === receipt.receiptHash ? "CONFIRMED" : "FAILED",
    detail:
      recomputedReceiptHash === receipt.receiptHash
        ? recomputedReceiptHash
        : `Recomputed ${recomputedReceiptHash}, the document claims ${receipt.receiptHash}.`,
  });

  const recomputedIntent = await hashIntent(receipt.intent.fingerprint);
  add({
    id: "hash.intent",
    label: "The intent hash matches the transaction it describes",
    outcome: recomputedIntent === receipt.intent.hash ? "CONFIRMED" : "FAILED",
    detail: recomputedIntent === receipt.intent.hash ? recomputedIntent : `Recomputed ${recomputedIntent}.`,
  });

  const recomputedAuthorization = await hashAuthorization({
    intentHash: receipt.intent.hash,
    subject: receipt.authorization.subject,
    authorizedAt: receipt.authorization.authorizedAt,
    expiresAt: receipt.authorization.expiresAt,
  });
  add({
    id: "hash.authorization",
    label: "The authorization commits to that intent",
    outcome: recomputedAuthorization === receipt.authorization.hash ? "CONFIRMED" : "FAILED",
    detail:
      recomputedAuthorization === receipt.authorization.hash
        ? recomputedAuthorization
        : `Recomputed ${recomputedAuthorization}.`,
  });

  const recomputedEffects = await hashActualEffects(receipt.actual);
  add({
    id: "hash.effects",
    label: "The effects hash matches the effects recorded",
    outcome: recomputedEffects === receipt.actualEffectsHash ? "CONFIRMED" : "FAILED",
    detail: recomputedEffects === receipt.actualEffectsHash ? recomputedEffects : `Recomputed ${recomputedEffects}.`,
  });

  if (receipt.network !== network.id) {
    add({
      id: "network",
      label: "The receipt is being checked against the network it names",
      outcome: "FAILED",
      detail: `The receipt names ${receipt.network} and is being checked against ${network.id}.`,
    });
    return { verdict: "ALTERED", findings };
  }

  /*
   * An older receipt is not a broken one.
   *
   * A fresh ledger read produces the *current* shape, so its hash cannot equal
   * one taken over an earlier shape — and reporting that as `FAILED` would say
   * "altered" about a document nobody touched. Version drift is a limit of the
   * reader, not evidence about the receipt, and the two must never be confused.
   */
  if (receipt.schemaVersion !== STELLAR_RECEIPT_SCHEMA) {
    add({
      id: "ledger.reread",
      label: "The ledger still reports the same effects",
      outcome: "UNCHECKABLE",
      detail:
        `This receipt is ${receipt.schemaVersion} and this reader produces ${STELLAR_RECEIPT_SCHEMA}. ` +
        `Its own hashes are checked above and hold; a fresh ledger read cannot be compared against an earlier shape.`,
    });
    const brokenByHash = findings.some((finding) => finding.outcome === "FAILED");
    return { verdict: brokenByHash ? "ALTERED" : "UNCONFIRMED", findings };
  }

  /* The ledger, read again, from scratch. */
  const observed = await observeActualEffects(network, receipt.execution.transactionHash, options);
  if (!isResolved(observed)) {
    add({
      id: "ledger.reread",
      label: "The ledger still reports this transaction",
      outcome: "UNCHECKABLE",
      detail: observed.reason,
    });
    const broken = findings.some((finding) => finding.outcome === "FAILED");
    return { verdict: broken ? "ALTERED" : "UNCONFIRMED", findings };
  }

  const freshHash = await hashActualEffects(observed.data);
  add({
    id: "ledger.reread",
    label: "The ledger still reports the same effects",
    outcome: freshHash === receipt.actualEffectsHash ? "CONFIRMED" : "FAILED",
    detail:
      freshHash === receipt.actualEffectsHash
        ? `Ledger ${observed.data.ledger}, re-read and identical.`
        : `The ledger now reports effects hashing to ${freshHash}.`,
  });

  const rerun = reconcile(receipt.expected, observed.data);
  add({
    id: "reconciliation",
    label: "Reconciling again produces the same verdict",
    outcome: rerun.status === receipt.reconciliation.status ? "CONFIRMED" : "FAILED",
    detail:
      rerun.status === receipt.reconciliation.status
        ? rerun.status
        : `The receipt records ${receipt.reconciliation.status}; reconciling the ledger now gives ${rerun.status}.`,
  });

  const failed = findings.some((finding) => finding.outcome === "FAILED");
  const unchecked = findings.some((finding) => finding.outcome === "UNCHECKABLE");
  return { verdict: failed ? "ALTERED" : unchecked ? "UNCONFIRMED" : "CONFIRMED", findings };
}

/**
 * Read an untrusted receipt.
 *
 * Narrow on purpose: verification recomputes hashes over whatever object it is
 * handed, so a missing or edited field shows up as a hash that does not match
 * rather than as a parser message. What this must guarantee is only that the
 * few fields the ledger re-read needs are present and are the right kind of
 * thing, so the check cannot fail for the wrong reason.
 */
export function parseReceipt(text: string): { ok: true; receipt: StellarLifecycleReceipt } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That is not JSON." };
  }
  const candidate = value as Partial<StellarLifecycleReceipt>;
  if (!candidate || typeof candidate !== "object") return { ok: false, reason: "A receipt is a JSON object." };
  if (!(STELLAR_RECEIPT_SCHEMAS as readonly string[]).includes(candidate.schemaVersion as string)) {
    return { ok: false, reason: `This is not a Ryntra Stellar lifecycle receipt (${STELLAR_RECEIPT_SCHEMAS.join(" or ")}).` };
  }
  if (typeof candidate.receiptHash !== "string" || !/^0x[0-9a-f]{64}$/.test(candidate.receiptHash)) {
    return { ok: false, reason: "The receipt carries no SHA-256 receipt hash." };
  }
  if (typeof candidate.execution?.transactionHash !== "string" || !/^[0-9a-f]{64}$/.test(candidate.execution.transactionHash)) {
    return { ok: false, reason: "The receipt names no Stellar transaction to check it against." };
  }
  if (!candidate.expected || !candidate.actual || !candidate.intent || !candidate.authorization) {
    return { ok: false, reason: "The receipt is missing a section the check needs." };
  }
  return { ok: true, receipt: candidate as StellarLifecycleReceipt };
}
