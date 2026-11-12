/**
 * The server's check of the protocol owner's permission (CITY-226) — the `PermissionVerifier` the library takes from
 * outside (`../permission.ts`). The owner's wallet signs the grant's canonical text (`grantText(body)`, UTF-8) as a
 * message — the wallet's own `signMessage`, the one screen a page cannot paint over — and the server checks that the
 * signature is the signer's Ed25519 signature over exactly those bytes, with node's own crypto.
 *
 * The signer is the wallet's address (base58, 32 bytes); the signature is base58 (64 bytes) or base64 (88 characters),
 * the two ways wallets hand it over. No key is held or made here — only a public key read from the address.
 */

import { createPublicKey, verify } from "node:crypto";
import { getAddressEncoder, getBase58Encoder } from "@solana/kit";

import { grantText, type GrantBody, type GrantSignature, type PermissionVerifier } from "../permission.ts";

/** The DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the 32 raw bytes follow. */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const BASE64 = /^[A-Za-z0-9+/]{86}==$/;

/** The 64 bytes of a signature as wallets hand it over, or `null` when it reads as neither form. */
export function signatureBytes(text: string): Uint8Array | null {
  try {
    const bytes = BASE64.test(text) ? Buffer.from(text, "base64") : BASE58.test(text) ? getBase58Encoder().encode(text) : null;
    return bytes && bytes.length === 64 ? Uint8Array.from(bytes) : null;
  } catch {
    return null;
  }
}

/** True when `signature` is the signer's Ed25519 signature over the grant's canonical text. Never throws. */
export const walletVerifier: PermissionVerifier = (body: GrantBody, signature: GrantSignature): boolean => {
  try {
    if (!signature || typeof signature.signer !== "string" || typeof signature.signature !== "string") return false;
    const signed = signatureBytes(signature.signature);
    if (!signed) return false;
    const raw = getAddressEncoder().encode(signature.signer as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0]);
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(raw)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(grantText(body), "utf8"), key, Buffer.from(signed));
  } catch {
    return false;
  }
};
