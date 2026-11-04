/**
 * CITY-162 — the `env` adapter: the key in the deployment's environment, as Launch has always held it
 * (`RYNTRA_LAUNCH_POOL_PAYER_SECRET`, `RYNTRA_LAUNCH_EXECUTOR_SECRET`: a JSON array of 64 numbers, or the base58 string
 * a wallet exports). It stays the fallback until the operator switches to `kms`, and it is the rollback after.
 *
 * The key is read once into a private key object; the parsed bytes are wiped, nothing of the key is ever returned, and
 * only its public address goes out.
 */

import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";

import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

import type { KeySigner } from "./signer.server.ts";

/** PKCS#8 header of a raw 32-byte ed25519 seed. */
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

export type EnvKey = Readonly<{ address: string; signer: KeySigner }>;

/** The key as configured, or null for anything that is not a whole ed25519 keypair (its public half must match its seed). */
export function envKey(raw: string | undefined): EnvKey | null {
  const text = raw?.trim();
  if (!text) return null;
  let bytes: Uint8Array | null = null;
  try {
    const parsed = text.startsWith("[") ? (JSON.parse(text) as unknown) : Array.from(getBase58Encoder().encode(text));
    if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) return null;
    bytes = Uint8Array.from(parsed as number[]);
    const privateKey: KeyObject = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, Buffer.from(bytes.subarray(0, 32))]), format: "der", type: "pkcs8" });
    const derived = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" })).subarray(-32);
    if (!derived.equals(Buffer.from(bytes.subarray(32, 64)))) return null;
    const address = getBase58Decoder().decode(derived);
    return {
      address,
      signer: {
        mode: "env",
        keyRef: null,
        sign: async (message) => Uint8Array.from(sign(null, Buffer.from(message), privateKey)),
      },
    };
  } catch {
    return null;
  } finally {
    bytes?.fill(0);
  }
}
