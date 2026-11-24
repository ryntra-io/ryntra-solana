/**
 * The server's check of a set's signature: the author's wallet signed the save's text (`setSaveText`, UTF-8)
 * as a message with its own `signMessage`, and the signature is that wallet's Ed25519 signature over exactly those bytes,
 * checked with node's own crypto. No key is held or made here — only a public key read from the address.
 *
 * The signature is base64 (88 characters) or base58 (64 bytes), the two ways wallets hand it over.
 */

import { createPublicKey, verify } from "node:crypto";
import { getAddressEncoder, getBase58Encoder } from "@solana/kit";

/** The DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the 32 raw bytes follow. */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const BASE64 = /^[A-Za-z0-9+/]{86}==$/;

/** The 64 bytes of a signature as wallets hand it over, or null when it reads as neither form. */
export function setSignatureBytes(text: string): Uint8Array | null {
  try {
    const bytes = BASE64.test(text) ? Buffer.from(text, "base64") : BASE58.test(text) ? getBase58Encoder().encode(text) : null;
    return bytes && bytes.length === 64 ? Uint8Array.from(bytes) : null;
  } catch {
    return null;
  }
}

/** True when `signature` is `author`'s Ed25519 signature over `text`. Never throws. */
export function verifySetSignature(text: string, author: string, signature: string): boolean {
  try {
    const signed = setSignatureBytes(signature);
    if (!signed) return false;
    const raw = getAddressEncoder().encode(author as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0]);
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(raw)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(text, "utf8"), key, Buffer.from(signed));
  } catch {
    return false;
  }
}
