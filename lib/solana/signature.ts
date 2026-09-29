/**
 * Checking what came back from the wallet against what we asked it to sign.
 *
 * A wallet is a separate program with its own UI, its own state and its own
 * idea of which account is active. Handing it bytes and trusting the reply is
 * the gap where a signed-something becomes a signed-something-else, so this
 * module treats the returned transaction as untrusted input and answers two
 * questions independently:
 *
 * 1. **Are these the bytes we built?** The compiled message is re-hashed and
 *    compared to the fingerprint taken before anything left. Every field of
 *    the transfer is compared too, so a mismatch says *which* field moved
 *    rather than only that something did.
 * 2. **Is the signature real, over those exact bytes, by the account that was
 *    supposed to sign?** Verified with Ed25519 against the fee payer's own
 *    public key. The Stellar lifecycle recorded why this half is not optional:
 *    comparing the fields around a signed payload detects nothing, because a
 *    wallet returning a different transaction returns different fields too.
 *
 * Like `transaction.ts`, this is outside the public evidence kit — it exists
 * to gate a write, and the kit performs none.
 */

import { createPublicKey, createHash, verify as verifyBytes } from "node:crypto";
import { getAddressEncoder, getTransactionDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";

import type { TransferFingerprint, TransferPlan } from "./transaction.ts";

/** DER SPKI prefix for a raw Ed25519 public key. Fixed by RFC 8410. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const SIGNED_TRANSFER_VERDICTS = [
  "CLEARED",
  "BYTES_CHANGED",
  "SIGNATURE_INVALID",
  "SIGNATURE_MISSING",
  "UNREADABLE",
] as const;
export type SignedTransferVerdict = (typeof SIGNED_TRANSFER_VERDICTS)[number];

export type SignedTransferCheck = Readonly<{
  verdict: SignedTransferVerdict;
  /** Every field compared, and what each one said. Reported even on success. */
  comparisons: readonly Readonly<{ field: string; expected: string; actual: string; matched: boolean }>[];
  signature: Readonly<{
    /** The transaction signature, base58 — present only once it verifies. */
    value: string | null;
    signer: string;
    detail: string;
  }>;
  detail: string;
}>;

function sha256Hex(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function base58Signature(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out === "" ? "1" : out;
}

function compare(field: string, expected: string, actual: string) {
  return { field, expected, actual, matched: expected === actual };
}

function failure(
  verdict: SignedTransferVerdict,
  detail: string,
  comparisons: SignedTransferCheck["comparisons"] = [],
  signer = "",
): SignedTransferCheck {
  return Object.freeze({
    verdict,
    comparisons: Object.freeze(comparisons),
    signature: Object.freeze({ value: null, signer, detail }),
    detail,
  });
}

/**
 * Recompute the fingerprint of a transaction we did not build.
 *
 * Only the message-level facts are recoverable here without re-parsing every
 * instruction; the transfer's own fields are compared through the plan's
 * fingerprint against the message hash, which covers them all at once. A hash
 * that matches means every instruction field matched, because the hash is over
 * the bytes those fields compile to.
 */
function messageFacts(messageBytes: Uint8Array): Pick<TransferFingerprint, "messageHash"> {
  return { messageHash: sha256Hex(messageBytes) };
}

/**
 * Verify a signature without a plan to compare against.
 *
 * The browser holds the fingerprint of the bytes it built, so the
 * "are these the bytes we built" half belongs there — it is a check that
 * protects the person in front of the wallet. A server that accepted a
 * client-supplied fingerprint and then *reported* having compared against it
 * would be attesting to a check it did not perform, which is the exact class
 * of claim this product exists to refuse.
 *
 * So the server checks what it can establish on its own: that these bytes
 * carry a real Ed25519 signature by the account that claims to be sending.
 * The receipt then rests on the chain read, not on either check.
 */
export function verifySignatureOnly(args: {
  signedWireBase64: string;
  expectedSigner: string;
}): SignedTransferCheck {
  let messageBytes: Uint8Array;
  let signatures: Record<string, Uint8Array | null>;
  try {
    const decoded = getTransactionDecoder().decode(Buffer.from(args.signedWireBase64, "base64"));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  } catch (cause) {
    return failure(
      "UNREADABLE",
      `The submitted payload did not decode as a Solana transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const raw = signatures[args.expectedSigner as Address] ?? null;
  if (!raw) {
    return failure(
      "SIGNATURE_MISSING",
      `The transaction carries no signature for ${args.expectedSigner}.`,
      [],
      args.expectedSigner,
    );
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(getAddressEncoder().encode(args.expectedSigner as Address)),
      ]),
      format: "der",
      type: "spki",
    });
    if (!verifyBytes(null, Buffer.from(messageBytes), publicKey, Buffer.from(raw))) {
      return failure(
        "SIGNATURE_INVALID",
        `The signature filed under ${args.expectedSigner} does not verify over these message bytes.`,
        [],
        args.expectedSigner,
      );
    }
  } catch (cause) {
    return failure(
      "SIGNATURE_INVALID",
      `The signature could not be checked: ${cause instanceof Error ? cause.message : String(cause)}`,
      [],
      args.expectedSigner,
    );
  }

  return Object.freeze({
    verdict: "CLEARED" as const,
    comparisons: Object.freeze([]),
    signature: Object.freeze({
      value: base58Signature(raw),
      signer: args.expectedSigner,
      detail: "verified with Ed25519 over the message bytes as submitted",
    }),
    detail:
      "The payload carries a real signature by the sending account. Whether it is the transaction the browser built is checked in the browser, which is where the fingerprint of the built bytes lives.",
  });
}

/**
 * Verify a wallet's reply. Never throws — unreadable input is a verdict.
 *
 * The result is deliberately not a boolean: a caller that only learns "bad"
 * cannot tell a wallet that signed the wrong thing from a wallet that signed
 * nothing, and those need different sentences in front of a person.
 */
export function checkSignedTransfer(args: {
  plan: TransferPlan;
  signedWireBase64: string;
}): SignedTransferCheck {
  const { plan } = args;

  let messageBytes: Uint8Array;
  let signatures: Record<string, Uint8Array | null>;
  try {
    const decoded = getTransactionDecoder().decode(Buffer.from(args.signedWireBase64, "base64"));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  } catch (cause) {
    return failure(
      "UNREADABLE",
      `The wallet's reply did not decode as a Solana transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const facts = messageFacts(messageBytes);
  const comparisons = [
    compare("messageHash", plan.fingerprint.messageHash, facts.messageHash),
    compare("feePayer", plan.fingerprint.feePayer, Object.keys(signatures)[0] ?? ""),
  ];

  if (!comparisons[0].matched) {
    return failure(
      "BYTES_CHANGED",
      "The wallet returned a transaction whose message is not the one that was built. Nothing is submitted; build again and read the wallet's own summary before approving.",
      comparisons,
      plan.fingerprint.feePayer,
    );
  }

  const raw = signatures[plan.fingerprint.feePayer as Address] ?? null;
  if (!raw) {
    return failure(
      "SIGNATURE_MISSING",
      `The transaction came back with no signature for ${plan.fingerprint.feePayer}. The wallet may have been cancelled, or it signed with a different account than the one this transfer names.`,
      comparisons,
      plan.fingerprint.feePayer,
    );
  }

  let valid = false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(getAddressEncoder().encode(plan.fingerprint.feePayer as Address)),
      ]),
      format: "der",
      type: "spki",
    });
    valid = verifyBytes(null, Buffer.from(messageBytes), publicKey, Buffer.from(raw));
  } catch (cause) {
    return failure(
      "SIGNATURE_INVALID",
      `The signature could not be checked against ${plan.fingerprint.feePayer}: ${cause instanceof Error ? cause.message : String(cause)}`,
      comparisons,
      plan.fingerprint.feePayer,
    );
  }

  if (!valid) {
    return failure(
      "SIGNATURE_INVALID",
      "A signature is present but does not verify over these exact message bytes for the account that was asked to sign.",
      comparisons,
      plan.fingerprint.feePayer,
    );
  }

  return Object.freeze({
    verdict: "CLEARED" as const,
    comparisons: Object.freeze(comparisons),
    signature: Object.freeze({
      /* On Solana the first signature *is* the transaction id, so this value is
         how the submitted transaction will be found again — derived from the
         verified bytes rather than from whatever the wallet said it was. */
      value: base58Signature(raw),
      signer: plan.fingerprint.feePayer,
      detail: "verified with Ed25519 over the exact message bytes that were built",
    }),
    detail: "The wallet returned the transaction that was built, signed by the account that was asked to sign it.",
  });
}
