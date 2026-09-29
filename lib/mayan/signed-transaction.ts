/**
 * What a wallet gave back for a cross-chain swap, checked before it is sent.
 *
 * Three questions, in order: are these the reviewed bytes (a wallet may only
 * append its own bounded guard assertions, never change the business
 * instructions); did the owner actually sign them; is the owner the only
 * signer the message asks for. Anything else is refused with `submitBoundary:
 * NOT_CROSSED`, which is the one proof that lets a person try again.
 */

import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";

import { PublicKey, VersionedTransaction } from "@solana/web3.js";

import { compareWalletTransaction } from "../solana/wallet-modification.ts";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type SignedCrossSwapCheck =
  | Readonly<{
      ok: true;
      /** Base58 transaction id — the first signature, the owner's. */
      signature: string;
      messageHash: string;
      comparison: "EXACT" | "WALLET_GUARDS_ONLY";
    }>
  | Readonly<{
      ok: false;
      code:
        | "REVIEWED_BYTES_MISMATCH"
        | "WALLET_MODIFIED_BYTES"
        /* Its own code, because it is the one wallet change with an answer a
           person can act on: nothing about the transfer moved, the wallet
           only replaced an ageing blockhash, and a fresh Review signed
           promptly goes through. Folded into WALLET_MODIFIED_BYTES it reads
           as "your wallet did something wrong", which is neither true nor
           useful. */
        | "WALLET_REPLACED_BLOCKHASH"
        | "UNREADABLE"
        | "SIGNER_SHAPE"
        | "OWNER_SIGNATURE_MISSING"
        | "OWNER_SIGNATURE_INVALID";
      /** The comparison's own reason, so an operator reading a refusal sees which check moved. */
      walletChange?: string;
      reason: string;
    }>;

export function wireHash(wireBase64: string): string {
  return `0x${createHash("sha256").update(Buffer.from(wireBase64, "base64")).digest("hex")}`;
}

function verifyOver(messageBytes: Uint8Array, signature: Uint8Array, owner: string): boolean {
  let raw: Uint8Array;
  try {
    raw = new PublicKey(owner).toBytes();
  } catch {
    return false;
  }
  try {
    return verifyBytes(
      null,
      messageBytes,
      createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" }),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

function toBase58(bytes: Uint8Array): string {
  /* web3.js has no exported base58 encoder for arbitrary bytes; a 64-byte
     signature encodes like a public key would, digit for digit. */
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    const rem = Number(value % 58n);
    value /= 58n;
    out = ALPHABET[rem] + out;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function checkSignedCrossSwapTransaction(args: {
  reviewedWireBase64: string;
  reviewedWireHash: string;
  signedWireBase64: string;
  owner: string;
  /** The lookup tables both messages read, so accounts compare by address. */
  lookupTables?: Readonly<Record<string, readonly string[]>>;
}): SignedCrossSwapCheck {
  if (wireHash(args.reviewedWireBase64) !== args.reviewedWireHash) {
    return { ok: false, code: "REVIEWED_BYTES_MISMATCH", reason: "The bytes presented as reviewed are not the ones this order was planned with." };
  }
  const comparison = compareWalletTransaction({
    expectedWireBase64: args.reviewedWireBase64,
    actualWireBase64: args.signedWireBase64,
    expectsTokenGuard: false,
    guardPolicy: "BOUNDED",
    lookupTables: args.lookupTables,
  });
  if (comparison.verdict === "UNREADABLE") {
    return { ok: false, code: "UNREADABLE", reason: "The signed transaction could not be read." };
  }
  if (comparison.verdict === "CHANGED") {
    return {
      ok: false,
      code: comparison.reasonCode === "BLOCKHASH_CHANGED" ? "WALLET_REPLACED_BLOCKHASH" : "WALLET_MODIFIED_BYTES",
      reason: `The wallet returned different bytes than the reviewed order: ${comparison.detail}`,
      walletChange: comparison.reasonCode,
    };
  }
  let signed: VersionedTransaction;
  try {
    signed = VersionedTransaction.deserialize(Buffer.from(args.signedWireBase64, "base64"));
  } catch {
    return { ok: false, code: "UNREADABLE", reason: "The signed transaction is not a versioned Solana transaction." };
  }
  const header = signed.message.header;
  if (header.numRequiredSignatures !== 1) {
    return { ok: false, code: "SIGNER_SHAPE", reason: `The signed message asks for ${header.numRequiredSignatures} signatures; the order asks for exactly the owner's.` };
  }
  const feePayer = signed.message.staticAccountKeys[0]?.toBase58();
  if (feePayer !== args.owner) {
    return { ok: false, code: "SIGNER_SHAPE", reason: "The signed message's fee payer is not the owner who reviewed the order." };
  }
  const signature = signed.signatures[0];
  if (!signature || signature.every((byte) => byte === 0)) {
    return { ok: false, code: "OWNER_SIGNATURE_MISSING", reason: "The wallet returned the order unsigned." };
  }
  const messageBytes = signed.message.serialize();
  if (!verifyOver(messageBytes, signature, args.owner)) {
    return { ok: false, code: "OWNER_SIGNATURE_INVALID", reason: "The owner's signature does not verify over the returned bytes." };
  }
  return {
    ok: true,
    signature: toBase58(signature),
    messageHash: `0x${createHash("sha256").update(messageBytes).digest("hex")}`,
    comparison: comparison.verdict,
  };
}
