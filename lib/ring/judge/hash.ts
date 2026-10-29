/**
 * Hashing for the Ring's judge (CITY-68): one canonical form of a JSON value and its SHA-256, so the judge, a replay on
 * anyone's machine and a memo on Solana all name the same bytes.
 *
 * Canonical JSON is `JSON.stringify` with object keys sorted (by UTF-16 code units, as `Array.prototype.sort` does) and
 * nothing that JSON cannot carry: `NaN`, `Infinity`, a bigint, a function, a symbol, a class instance (a `Date`, a
 * `Map`), `undefined` in an array or at the root, or a string with a lone UTF-16 surrogate throws instead of quietly
 * becoming `null`, `{}` or U+FFFD — a value that cannot be written down exactly has no hash. An object key whose value is `undefined` is left out, as JSON does, so an
 * unset optional field and a missing one hash the same.
 *
 * Pure: no store, no clock, no network.
 */

import { createHash } from "node:crypto";

/** 32 bytes as 64 lowercase hex characters: every hash the judge writes. */
export const HEX32 = /^[0-9a-f]{64}$/;

export const isHex32 = (value: unknown): value is string => typeof value === "string" && HEX32.test(value);

/** A lone surrogate: UTF-8 cannot hold it, so two different strings would hash the same. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when a string is well-formed UTF-16: it has exactly one UTF-8 form. */
export const isWellFormed = (value: string): boolean => !LONE_SURROGATE.test(value);

/** The string with every lone surrogate replaced by U+FFFD: for text the judge writes, never for what it hashes. */
export const toWellFormed = (value: string): string => value.replace(new RegExp(LONE_SURROGATE.source, "g"), String.fromCharCode(0xfffd));

/** SHA-256 as lowercase hex; a string is hashed as UTF-8 and must be well-formed. */
export function sha256Hex(data: string | Uint8Array): string {
  if (typeof data === "string" && !isWellFormed(data)) throw new TypeError("not well-formed UTF-16: a lone surrogate");
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with object keys sorted, so equal values always serialize to the same bytes. Throws on what JSON cannot hold. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value, ""));
}

/** SHA-256 of a value's canonical JSON. */
export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function canonical(value: unknown, path: string): unknown {
  if (typeof value === "string") {
    if (!isWellFormed(value)) throw new TypeError(`not JSON at ${path || "the root"}: a lone surrogate`);
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`not JSON at ${path || "the root"}: ${value}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => canonical(item, `${path}[${i}]`));
  if (typeof value === "object" && isPlain(value)) {
    const record = value as Record<string, unknown>;
    // A null prototype keeps a `__proto__` key an ordinary key.
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record).sort()) {
      if (!isWellFormed(key)) throw new TypeError(`not JSON at ${path || "the root"}: a key with a lone surrogate`);
      if (record[key] !== undefined) sorted[key] = canonical(record[key], path ? `${path}.${key}` : key);
    }
    return sorted;
  }
  throw new TypeError(`not JSON at ${path || "the root"}: ${typeof value}`);
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type Difference = { path: string; expected: unknown; found: unknown };

/** The first place, in key order, where two JSON values differ; `null` when they are equal. */
export function firstDifference(expected: unknown, found: unknown, path = ""): Difference | null {
  if (expected === found) return null;
  if (Array.isArray(expected) && Array.isArray(found)) {
    for (let i = 0; i < Math.max(expected.length, found.length); i += 1) {
      const diff = firstDifference(expected[i], found[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isRecord(expected) && isRecord(found)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(found)])].sort();
    for (const key of keys) {
      const diff = firstDifference(expected[key], found[key], path ? `${path}.${key}` : key);
      if (diff) return diff;
    }
    return null;
  }
  return { path, expected, found };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
