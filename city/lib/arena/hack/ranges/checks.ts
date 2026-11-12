/**
 * An order's checks, as the store keeps them (CITY-238; `../sandbox/game.ts` — «the order brings its own checks»).
 *
 * A check is a named property of the protocol that must keep holding in the copy. The sandbox takes it as code that
 * only reads the copy (`Invariant`); a store cannot keep code, and code a protocol hands in would run on the machine
 * that decides findings. So a check is kept as **data** — one of a few kinds that read one account of the copy — and
 * becomes an `Invariant` only here, the same way on the server and on the machine with no network:
 *
 *   bytes-equal        — a slice of an account's data is exactly these bytes (an authority, a flag, a config field);
 *   u64-at-least       — a little-endian u64 at an offset of an account's data is at least this much (a token
 *                        account's amount, a counter, a supply);
 *   lamports-at-least  — an account holds at least this many lamports (a treasury).
 *
 * An account that is gone, or shorter than the slice, does not hold the property. A check never writes and never
 * reaches out: it gets a `read` and nothing else.
 *
 * Pure: no store, no clock, no network.
 */

import type { AccountState, Invariant } from "../sandbox/index.ts";
import { isAddress, isName } from "../scope.ts";

export type CheckSpec =
  | { readonly kind: "bytes-equal"; readonly id: string; readonly version: string; readonly address: string; readonly offset: number; readonly hex: string }
  | { readonly kind: "u64-at-least"; readonly id: string; readonly version: string; readonly address: string; readonly offset: number; readonly min: string }
  | { readonly kind: "lamports-at-least"; readonly id: string; readonly version: string; readonly address: string; readonly min: string };

/** The most checks an order keeps, and the longest slice a `bytes-equal` compares. */
export const CHECKS_MAX = 16;
export const SLICE_MAX_BYTES = 1_024;

const HEX = /^(?:[0-9a-f]{2})+$/;
const U64 = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 18_446_744_073_709_551_615n;
const isOffset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10 * 1_048_576;
const isU64 = (value: unknown): value is string => typeof value === "string" && U64.test(value) && BigInt(value) <= U64_MAX;
const keysOf = (value: object): string => Object.keys(value).sort().join(",");

/** What is wrong with a check as kept; `null` when it can be read. */
export function checkSpecIssue(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "a check is an object";
  const c = value as Record<string, unknown>;
  if (!isName(c.id) || !isName(c.version)) return "a check needs an id and a version";
  if (!isAddress(c.address)) return `check ${c.id}: address is a base58 account`;
  switch (c.kind) {
    case "bytes-equal":
      if (keysOf(c) !== "address,hex,id,kind,offset,version") return `check ${c.id}: { kind, id, version, address, offset, hex }`;
      if (!isOffset(c.offset)) return `check ${c.id}: offset is a whole number`;
      if (typeof c.hex !== "string" || !HEX.test(c.hex) || c.hex.length > SLICE_MAX_BYTES * 2) return `check ${c.id}: hex is 1…${SLICE_MAX_BYTES} bytes of lowercase hex`;
      return null;
    case "u64-at-least":
      if (keysOf(c) !== "address,id,kind,min,offset,version") return `check ${c.id}: { kind, id, version, address, offset, min }`;
      if (!isOffset(c.offset)) return `check ${c.id}: offset is a whole number`;
      if (!isU64(c.min)) return `check ${c.id}: min is a decimal u64`;
      return null;
    case "lamports-at-least":
      if (keysOf(c) !== "address,id,kind,min,version") return `check ${c.id}: { kind, id, version, address, min }`;
      if (!isU64(c.min)) return `check ${c.id}: min is a decimal u64`;
      return null;
    default:
      return `check ${String(c.id)}: kind is bytes-equal, u64-at-least or lamports-at-least`;
  }
}

/** What is wrong with an order's list of checks; `null` when every one reads and no id is used twice. */
export function checksIssue(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHECKS_MAX) return `checks: 1…${CHECKS_MAX}`;
  const seen = new Set<string>();
  for (const check of value) {
    const issue = checkSpecIssue(check);
    if (issue) return issue;
    const key = `${(check as CheckSpec).id}@${(check as CheckSpec).version}`;
    if (seen.has(key)) return `check ${key} is listed twice`;
    seen.add(key);
  }
  return null;
}

function u64At(data: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > data.length) return null;
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
}

/** The check as the sandbox runs it: code that only reads the copy. Assumes `checkSpecIssue` passed. */
export function invariantOf(spec: CheckSpec): Invariant {
  const holds = (read: (address: string) => AccountState | null): boolean => {
    const account = read(spec.address);
    if (!account) return false;
    if (spec.kind === "lamports-at-least") return account.lamports >= BigInt(spec.min);
    if (spec.kind === "u64-at-least") {
      const value = u64At(account.data, spec.offset);
      return value !== null && value >= BigInt(spec.min);
    }
    const want = Buffer.from(spec.hex, "hex");
    if (spec.offset + want.length > account.data.length) return false;
    return Buffer.from(account.data.subarray(spec.offset, spec.offset + want.length)).equals(want);
  };
  return { id: spec.id, version: spec.version, holds };
}

/** An order's checks as the sandbox takes them. Throws `TypeError` for a list that does not read. */
export function invariantsOf(specs: readonly CheckSpec[]): Invariant[] {
  const issue = checksIssue(specs);
  if (issue) throw new TypeError(issue);
  return specs.map(invariantOf);
}
