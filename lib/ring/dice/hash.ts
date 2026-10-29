import { createHash } from "node:crypto";

/**
 * Hashing shared by commitments, the dice stream and log digests (CITY-69). SHA-256 from `node:crypto`; strings are
 * hashed as UTF-8, results are lowercase hex, so anyone with a log derives the same bytes.
 */

/** 32 bytes as 64 lowercase hex characters: the format of seeds, commitments and beacon randomness. */
export const HEX32 = /^[0-9a-f]{64}$/;

/** SHA-256 of the parts in order, as raw bytes. */
export function sha256(...parts: readonly (string | Uint8Array)[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

/** SHA-256 as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

/** Bytes of an even-length hex string; throws on anything else, so a bad key never hashes as something shorter. */
export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new RangeError("expected an even number of hex characters");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** JSON with object keys sorted, so equal values always serialize to the same bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
    return sorted;
  }
  return value;
}
