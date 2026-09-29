import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";

/* `Operation` in the SDK is a namespace of builders, not a type, so an
   annotation using it does not describe an operation. The element type of a
   parsed transaction's own list is the one that always matches what we hold. */
type ParsedOperation = Transaction["operations"][number];

/**
 * The SDK returns a union, and telling the two apart is not what it looks like.
 *
 * This check used to be "does it have an operations array", on the reasonable
 * assumption that a fee-bump has no operations of its own. Measured against
 * `@stellar/stellar-sdk` 16.2.0 on a real fee-bumped testnet payment, that is
 * false: `FeeBumpTransaction` exposes `operations` too, delegating to the
 * transaction it wraps. So every fee-bump passed as a plain transaction, the
 * refusal below never ran, and the first thing to touch `.memo` threw
 * `Cannot read properties of undefined` — an opaque crash where an explicit
 * refusal was written and believed to be running.
 *
 * `innerTransaction` is the property only a fee-bump has, and it is what the
 * wrapper *is* rather than something it happens to expose.
 */
function isPlainTransaction(tx: Transaction | { operations?: unknown }): tx is Transaction {
  if ("innerTransaction" in tx) return false;
  return "operations" in tx && Array.isArray((tx as Transaction).operations);
}

/**
 * What was authorized, and whether the signed bytes still say it.
 *
 * A signature is not consent to whatever comes back. Between the moment a person
 * reads a transaction and the moment a wallet returns one, the bytes have left
 * this process — and the only thing that makes the returned bytes the same
 * intent is checking, not trusting.
 *
 * **The fingerprint is semantic, never byte-equality.** Signing necessarily
 * changes the bytes: it appends signatures. Comparing raw XDR would fail on
 * every honest signature and pass on none, so the comparison is over the fields
 * that decide what the transaction *does* — source, sequence, fee, network, and
 * every material field of every operation. A wallet that returned a different
 * destination, a different amount, a different asset, an extra operation or a
 * different network fails this, and the mismatch is named rather than
 * summarised.
 *
 * **The network is not in the bytes, and comparing it proves nothing.** An
 * XDR carries no passphrase; the network is bound only inside the hash a
 * signature is computed over. So parsing mainnet bytes "as testnet" succeeds
 * and reports testnet, and the passphrase field only ever echoes what was
 * passed in. The first version of this file compared it and believed it was
 * catching network substitution — the test written for exactly that
 * substitution is what proved it was not.
 *
 * The signature is the honest detector, and `verifySignedTransaction` checks it:
 * a signature that verifies for the authorized account over the authorized
 * network proves both who signed and which ledger they signed for. The
 * passphrase stays on the fingerprint because it is a real input on the
 * authorized side, not because comparing it defends anything.
 */

export type OperationFingerprint = Readonly<{
  type: string;
  /** The operation's own source, when it differs from the transaction's. */
  source: string | null;
  /** Every material field, flattened and sorted so comparison is order-stable. */
  fields: Readonly<Record<string, string>>;
}>;

export type TransactionFingerprint = Readonly<{
  networkPassphrase: string;
  source: string;
  sequence: string;
  fee: string;
  memo: string;
  operations: readonly OperationFingerprint[];
}>;

/**
 * The fields that change what an operation does.
 *
 * An allowlist rather than a dump of the operation object: the SDK attaches
 * derived and internal properties that differ harmlessly between a built and a
 * parsed transaction, and comparing those would fail every honest signature.
 * Anything not listed here is, by this file's claim, not material — so adding
 * an operation type means adding its fields, and a type with no entry falls
 * back to every own enumerable string field rather than silently comparing
 * nothing.
 */
const MATERIAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  payment: ["destination", "amount", "asset"],
  createAccount: ["destination", "startingBalance"],
  changeTrust: ["line", "limit"],
  pathPaymentStrictSend: ["destination", "sendAsset", "sendAmount", "destAsset", "destMin", "path"],
  pathPaymentStrictReceive: ["destination", "sendAsset", "sendMax", "destAsset", "destAmount", "path"],
  setTrustLineFlags: ["trustor", "asset", "setFlags", "clearFlags"],
  clawback: ["from", "asset", "amount"],
};

function describe(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(describe).join(",");
  /* Assets and similar SDK values carry a canonical string form; using it keeps
     `USDC:GA5Z…` comparable to itself across a build/parse round trip. */
  const candidate = value as { toString?: () => string };
  if (typeof candidate.toString === "function") {
    const text = candidate.toString();
    if (text !== "[object Object]") return text;
  }
  return JSON.stringify(value);
}

function fingerprintOperation(operation: ParsedOperation): OperationFingerprint {
  const record = operation as unknown as Record<string, unknown>;
  const names =
    MATERIAL_FIELDS[operation.type] ??
    Object.keys(record).filter((key) => key !== "type" && key !== "source");

  const fields: Record<string, string> = {};
  for (const name of [...names].sort()) {
    fields[name] = describe(record[name]);
  }
  return { type: operation.type, source: operation.source ?? null, fields };
}

export function fingerprintTransaction(transaction: Transaction): TransactionFingerprint {
  return {
    networkPassphrase: transaction.networkPassphrase,
    source: transaction.source,
    sequence: transaction.sequence,
    fee: transaction.fee,
    /* Type and value, not the encoded form: a `Memo` instance exposes those
       stably across a build-then-parse round trip, and a memo is material —
       it is what a recipient reconciles a payment against. */
    memo: `${transaction.memo.type}:${describe(transaction.memo.value)}`,
    operations: transaction.operations.map(fingerprintOperation),
  };
}

export function fingerprintXdr(xdr: string, networkPassphrase: string): TransactionFingerprint {
  const parsed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  if (!isPlainTransaction(parsed)) {
    /* A fee-bump wraps another transaction, so its operations are not its own.
       Rather than fingerprint the wrapper and call it the intent, this refuses:
       nothing in this product builds one yet, and silently accepting one would
       mean authorizing an inner transaction nobody compared. */
    throw new Error("A fee-bump transaction cannot be fingerprinted as the authorized intent.");
  }
  return fingerprintTransaction(parsed);
}

export type FingerprintMismatch = Readonly<{ field: string; authorized: string; signed: string }>;

/**
 * Every way the signed transaction differs from the authorized one.
 *
 * Returns the differences rather than a boolean, because "it does not match" is
 * not something to show a person. Which field changed, from what, to what — that
 * is what makes a block explainable and an incident investigable.
 */
export function compareFingerprints(
  authorized: TransactionFingerprint,
  signed: TransactionFingerprint,
): readonly FingerprintMismatch[] {
  const mismatches: FingerprintMismatch[] = [];
  const note = (field: string, a: string, b: string) => {
    if (a !== b) mismatches.push({ field, authorized: a, signed: b });
  };

  note("networkPassphrase", authorized.networkPassphrase, signed.networkPassphrase);
  note("source", authorized.source, signed.source);
  note("sequence", authorized.sequence, signed.sequence);
  note("fee", authorized.fee, signed.fee);
  note("memo", authorized.memo, signed.memo);
  note("operations.length", String(authorized.operations.length), String(signed.operations.length));

  const shared = Math.min(authorized.operations.length, signed.operations.length);
  for (let index = 0; index < shared; index += 1) {
    const a = authorized.operations[index];
    const b = signed.operations[index];
    note(`operations[${index}].type`, a.type, b.type);
    note(`operations[${index}].source`, a.source ?? "", b.source ?? "");
    for (const key of new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])) {
      note(`operations[${index}].${key}`, a.fields[key] ?? "", b.fields[key] ?? "");
    }
  }

  return mismatches;
}

/**
 * A cleared transaction, and the bytes it cleared.
 *
 * The verdict carries the XDR rather than merely approving one, so that
 * submitting takes *this value* and not a boolean plus a string a caller
 * supplies separately. Those two arguments can disagree — verdict from one
 * transaction, bytes from another — and no amount of care at the call site
 * makes that impossible. Carrying them together does.
 *
 * `transactionHash` is computed here, before anything is submitted, because it
 * is derived from the signed bytes and not granted by the network. That is what
 * makes an unknown submission outcome recoverable: if the network never
 * answers, the person still holds the exact hash to look up.
 */
export type ClearedTransaction = Readonly<{
  allowed: true;
  fingerprint: TransactionFingerprint;
  signedXdr: string;
  /** Lowercase hex, no `0x`, as Stellar explorers and Horizon write it. */
  transactionHash: string;
}>;

export type SubmissionVerdict =
  | ClearedTransaction
  | Readonly<{ allowed: false; mismatches: readonly FingerprintMismatch[]; reason: string }>;

/**
 * The gate between a signature and the network.
 *
 * **A signature is not a submission.** This is the only function that may say a
 * signed transaction is the one that was authorized, and it says so by
 * comparison rather than by the fact that a wallet returned something. It fails
 * closed: an XDR that cannot be parsed is refused rather than passed along on
 * the grounds that it looked signed.
 */
export function verifySignedTransaction(input: {
  authorized: TransactionFingerprint;
  signedXdr: string;
}): SubmissionVerdict {
  let parsed: Transaction;
  try {
    const candidate = TransactionBuilder.fromXDR(input.signedXdr, input.authorized.networkPassphrase);
    if (!isPlainTransaction(candidate)) throw new Error("a fee-bump transaction is not the authorized intent");
    parsed = candidate;
  } catch (error) {
    return {
      allowed: false,
      mismatches: [],
      reason: `The signed transaction could not be read: ${(error as Error).message}`,
    };
  }

  /*
   * The network is not in the bytes.
   *
   * A transaction's XDR carries no passphrase — the network is bound only at
   * signature time, inside the hash a signature is computed over. So parsing
   * mainnet bytes "as testnet" succeeds and reports testnet, and comparing the
   * passphrase field detects nothing: it only ever echoes what was passed in.
   * A test written to catch exactly that substitution is what exposed it here.
   *
   * The signature is therefore the only honest detector. Verifying it against
   * the authorized source over the authorized network proves both that this
   * account signed and that it signed *for this ledger* — the substitution that
   * leaves every visible field identical cannot survive it.
   */
  const signatures = parsed.signatures;
  if (signatures.length === 0) {
    return { allowed: false, mismatches: [], reason: "The transaction carries no signature." };
  }

  let signedByAuthorizedSource = false;
  try {
    const hash = parsed.hash();
    const signer = Keypair.fromPublicKey(input.authorized.source);
    signedByAuthorizedSource = signatures.some((entry) => signer.verify(hash, entry.signature()));
  } catch {
    signedByAuthorizedSource = false;
  }

  if (!signedByAuthorizedSource) {
    return {
      allowed: false,
      mismatches: [],
      reason:
        "No signature on this transaction verifies for the authorized account on the authorized network. " +
        "It was signed by another key, or for another network.",
    };
  }

  /* Fingerprinting is reading someone else's bytes, so it is wrapped. The
     fee-bump case above used to reach this line and throw a `TypeError` that no
     caller expected — the gate happened to fail closed by crashing, which is
     luck rather than design. */
  let signed: TransactionFingerprint;
  try {
    signed = fingerprintTransaction(parsed);
  } catch (error) {
    return {
      allowed: false,
      mismatches: [],
      reason: `The signed transaction could not be described: ${(error as Error).message}`,
    };
  }

  const mismatches = compareFingerprints(input.authorized, signed);
  if (mismatches.length > 0) {
    return {
      allowed: false,
      mismatches,
      reason: `The signed transaction differs from the authorized one in ${mismatches.length} field(s).`,
    };
  }
  return {
    allowed: true,
    fingerprint: signed,
    signedXdr: input.signedXdr,
    transactionHash: parsed.hash().toString("hex"),
  };
}
