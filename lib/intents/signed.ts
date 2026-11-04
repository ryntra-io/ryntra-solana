/**
 * The wallet's own proof that it signed (CITY-161): the signed transaction bytes the city is about to hand to the swap
 * engine. Read here only far enough to answer two questions — who pays for this transaction (the first account of the
 * message, which is the first signer) and whether the first signature is that account's ed25519 signature over these
 * exact message bytes. Nothing is sent, kept or simulated: the intent keeps only the signature, as the mark that bytes
 * of this claim may now leave.
 *
 * Legacy and v0 messages; anything else is not read. Pure apart from node's ed25519 check.
 */

import { createPublicKey, verify } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";

export type SignedRead = Readonly<{ ok: true; signature: string; feePayer: string }> | Readonly<{ ok: false; reason: string }>;

/** The DER prefix of an ed25519 public key in SubjectPublicKeyInfo form; the 32 raw bytes follow. */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const MAX_WIRE = 1_232;

/** A compact-u16 at `offset`: its value and how many bytes it took. */
function shortVec(bytes: Uint8Array, offset: number): Readonly<{ value: number; size: number }> | null {
  let value = 0;
  for (let i = 0; i < 3; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  return null;
}

export function readSignedBy(wireBase64: string): SignedRead {
  if (typeof wireBase64 !== "string" || wireBase64.length > 2_000 || !/^[A-Za-z0-9+/]+=*$/.test(wireBase64)) return { ok: false, reason: "not base64" };
  const bytes = new Uint8Array(Buffer.from(wireBase64, "base64"));
  if (bytes.length === 0 || bytes.length > MAX_WIRE) return { ok: false, reason: "size" };
  const count = shortVec(bytes, 0);
  if (!count || count.value < 1 || count.value > 16) return { ok: false, reason: "signatures" };
  const signaturesAt = count.size;
  const messageAt = signaturesAt + count.value * 64;
  if (messageAt >= bytes.length) return { ok: false, reason: "short" };
  const message = bytes.subarray(messageAt);
  const versioned = (message[0]! & 0x80) !== 0;
  if (versioned && (message[0]! & 0x7f) !== 0) return { ok: false, reason: "version" };
  const headerAt = versioned ? 1 : 0;
  const required = message[headerAt];
  if (required === undefined || required !== count.value) return { ok: false, reason: "header" };
  const accounts = shortVec(message, headerAt + 3);
  if (!accounts || accounts.value < 1) return { ok: false, reason: "accounts" };
  const payerAt = headerAt + 3 + accounts.size;
  if (payerAt + 32 > message.length) return { ok: false, reason: "short" };
  const payer = message.subarray(payerAt, payerAt + 32);
  const signature = bytes.subarray(signaturesAt, signaturesAt + 64);
  let valid = false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(payer)]), format: "der", type: "spki" });
    valid = verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature" };
  const base58 = getBase58Decoder();
  return { ok: true, signature: base58.decode(signature), feePayer: base58.decode(payer) };
}
