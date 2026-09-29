/**
 * What came back from the wallet, checked against what was reviewed.
 *
 * The bridge burn needs two signatures over one message and they are produced
 * in a fixed order, decided for a reason:
 *
 * 1. **The wallet signs first.** It receives unsigned bytes, exactly as Send
 *    does, so nothing about the prompt is unusual and no wallet has to accept a
 *    partially-signed transaction — a capability wallets vary on.
 * 2. **The returned message is re-checked**, through the same audited
 *    comparator Send uses rather than by hashing. Hashing was the first
 *    version of this check and it refused every real signature: wallets add
 *    their own instructions — a ComputeBudget request, Lighthouse assertions
 *    that verify the transfer did what it claimed — and those change the bytes
 *    while changing nothing about the transfer. What must be identical is what
 *    the transaction *does*: the same business instructions with the same
 *    accounts and the same data, the same signers, the same blockhash, and no
 *    added program beyond those two guards. Anything else is a full stop, and
 *    the caller is told which field moved rather than that something did.
 * 3. **The ephemeral key signs those exact bytes.** It cannot change them: a
 *    signature fills an empty slot in the signature array and the message it
 *    covers is already fixed. So the only difference between what the wallet
 *    signed and what reaches the network is one slot that was zero.
 *
 * That ordering is why this module checks both signatures over **one** message
 * hash rather than checking each transaction separately. Two valid signatures
 * over two different messages is the failure it exists to make impossible.
 */

import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import { getTransactionDecoder } from "@solana/kit";

import type { CctpBurnPlan } from "./cctp-plan.ts";
import { compareWalletTransaction } from "./wallet-modification.ts";

/** DER SPKI prefix for a raw Ed25519 public key. Fixed by RFC 8410. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const CCTP_SIGNED_BURN_VERDICTS = [
  "CLEARED",
  "BYTES_CHANGED",
  "UNREVIEWED_CHANGE",
  "OWNER_SIGNATURE_MISSING",
  "OWNER_SIGNATURE_INVALID",
  "MESSAGE_SIGNATURE_MISSING",
  "MESSAGE_SIGNATURE_INVALID",
  "SIGNER_SET_CHANGED",
  "UNREADABLE",
] as const;
export type CctpSignedBurnVerdict = (typeof CCTP_SIGNED_BURN_VERDICTS)[number];

export type CctpSignedBurnCheck = Readonly<{
  verdict: CctpSignedBurnVerdict;
  comparisons: readonly Readonly<{ field: string; expected: string; actual: string; matched: boolean }>[];
  /** The transaction id, base58 — present only once both signatures verify. */
  signature: string | null;
  /** `EXACT`, or `WALLET_GUARDS_ONLY` when the wallet added its own guards. */
  lane: "EXACT" | "WALLET_GUARDS_ONLY" | null;
  /** Programs the wallet added. Empty on the exact lane. */
  addedPrograms: readonly string[];
  /** The hash of what was actually signed, which the guards may have moved. */
  signedMessageHash: string | null;
  detail: string;
}>;

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out === "" ? "1" : out;
}

function base58Decode(value: string): Uint8Array | null {
  let out = 0n;
  for (const character of value) {
    const index = BASE58.indexOf(character);
    if (index < 0) return null;
    out = out * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (out > 0n) {
    bytes.unshift(Number(out % 256n));
    out /= 256n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

function verifyOver(messageBytes: Uint8Array, signature: Uint8Array, signer: string): boolean {
  const raw = base58Decode(signer);
  if (!raw || raw.length !== 32) return false;
  try {
    return verifyBytes(
      null,
      messageBytes,
      createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

const compare = (field: string, expected: string, actual: string) => ({
  field,
  expected,
  actual,
  matched: expected === actual,
});

function refuse(
  verdict: CctpSignedBurnVerdict,
  detail: string,
  comparisons: CctpSignedBurnCheck["comparisons"] = [],
  addedPrograms: readonly string[] = [],
): CctpSignedBurnCheck {
  return Object.freeze({
    verdict,
    comparisons: Object.freeze(comparisons),
    signature: null,
    lane: null,
    addedPrograms: Object.freeze([...addedPrograms]),
    signedMessageHash: null,
    detail,
  });
}

/**
 * Check a fully signed burn against its reviewed plan.
 *
 * `CLEARED` means all of: these are the reviewed bytes, the owner signed them,
 * the ephemeral message account signed the same bytes, and no signer appeared
 * that the plan did not name. Anything short of that names which half failed,
 * because "the wallet returned something wrong" and "the wallet returned the
 * right thing unsigned" call for different next steps.
 */
export function checkCctpSignedBurn(args: {
  plan: CctpBurnPlan;
  signedWireBase64: string;
}): CctpSignedBurnCheck {
  let messageBytes: Uint8Array;
  let signatures: Record<string, Uint8Array | null>;
  try {
    const decoded = getTransactionDecoder().decode(Buffer.from(args.signedWireBase64, "base64"));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  } catch (cause) {
    return refuse("UNREADABLE", `The returned transaction could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const messageHash = `0x${createHash("sha256").update(messageBytes).digest("hex")}`;
  /* `expectsTokenGuard` is false for the same reason it is false in the
     browser: the flag requires a token assertion rather than permitting one,
     and requiring a guard a wallet may not add would reject an honest
     signature on a guess. Every assertion present is still validated. */
  const comparison = compareWalletTransaction({
    expectedWireBase64: args.plan.unsignedWireBase64,
    actualWireBase64: args.signedWireBase64,
    expectsTokenGuard: false,
    guardPolicy: "BOUNDED",
  });
  const comparisons = [
    compare("reviewedMessageHash", args.plan.fingerprint.messageHash, messageHash),
    compare("walletModification", "EXACT | WALLET_GUARDS_ONLY", comparison.verdict),
  ];
  if (comparison.verdict === "UNREADABLE") {
    return refuse("UNREADABLE", comparison.detail, comparisons, comparison.addedPrograms);
  }
  if (comparison.verdict !== "EXACT" && comparison.verdict !== "WALLET_GUARDS_ONLY") {
    return refuse(
      "UNREVIEWED_CHANGE",
      `${comparison.detail} Return to Review and build a fresh transfer.`,
      comparisons,
      comparison.addedPrograms,
    );
  }

  /* The signer set is part of the message, so a hash match already fixes it.
     Comparing it explicitly gives the refusal a field name instead of leaving
     a reader to infer which part of the message moved. */
  const present = Object.keys(signatures).sort();
  const expected = [...args.plan.fingerprint.signers].sort();
  comparisons.push(compare("signers", expected.join(","), present.join(",")));
  if (present.length !== expected.length || present.some((entry, index) => entry !== expected[index])) {
    return refuse("SIGNER_SET_CHANGED", "The returned transaction requires a different set of signers.", comparisons);
  }

  const ownerSignature = signatures[args.plan.owner];
  if (!ownerSignature) {
    return refuse("OWNER_SIGNATURE_MISSING", "The wallet returned the transaction without the owner's signature.", comparisons);
  }
  if (!verifyOver(messageBytes, ownerSignature, args.plan.owner)) {
    return refuse("OWNER_SIGNATURE_INVALID", "The owner's signature does not verify over the reviewed bytes.", comparisons);
  }

  const messageSignature = signatures[args.plan.messageSentAccount];
  if (!messageSignature) {
    return refuse(
      "MESSAGE_SIGNATURE_MISSING",
      "The message account has not signed yet. Circle's program requires it, and it signs in the browser after the wallet.",
      comparisons,
    );
  }
  if (!verifyOver(messageBytes, messageSignature, args.plan.messageSentAccount)) {
    return refuse(
      "MESSAGE_SIGNATURE_INVALID",
      "The message account's signature does not verify over the reviewed bytes.",
      comparisons,
    );
  }

  return Object.freeze({
    verdict: "CLEARED",
    comparisons: Object.freeze(comparisons),
    /* The fee payer's signature is the transaction id on Solana. */
    signature: base58(ownerSignature),
    lane: comparison.verdict === "EXACT" ? "EXACT" : "WALLET_GUARDS_ONLY",
    addedPrograms: Object.freeze([...comparison.addedPrograms]),
    signedMessageHash: messageHash,
    detail:
      comparison.verdict === "EXACT"
        ? "The reviewed bytes carry both required signatures and nothing else changed."
        : "The transfer is the reviewed one; the wallet added only its own guard instructions, and both required signatures cover what it returned.",
  });
}

/**
 * The wallet's half, checked on its own.
 *
 * Used between the two signing steps: it answers "did the wallet return the
 * bytes we asked it to sign, correctly signed" without demanding the second
 * signature that has not been produced yet. Keeping this separate is what lets
 * the browser stop before the ephemeral key ever touches anything.
 */
export function checkCctpWalletSignature(args: {
  plan: CctpBurnPlan;
  signedWireBase64: string;
}): CctpSignedBurnCheck {
  const full = checkCctpSignedBurn(args);
  if (full.verdict !== "MESSAGE_SIGNATURE_MISSING") return full;
  return Object.freeze({
    verdict: "CLEARED",
    comparisons: full.comparisons,
    signature: null,
    lane: full.lane,
    addedPrograms: full.addedPrograms,
    signedMessageHash: full.signedMessageHash,
    detail: "The wallet returned the reviewed transfer with a valid owner signature. The message account has still to sign.",
  });
}
