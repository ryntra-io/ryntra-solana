/**
 * The digest of an intent's frozen fields (CITY-161): SHA-256 over their canonical JSON — keys sorted at every level,
 * no whitespace — in lower-case hex. The same body always gives the same digest wherever it is computed, and any change
 * to a coin, an amount, a side, a recipient, a deadline or the origin gives another.
 *
 * Kept beside the record and recomputed on every read: a stored body that no longer matches its digest is refused.
 * Every step after the first read (claim, release, receipt) carries the digest the sheet was shown, so the person can
 * only ever act on exactly what they saw.
 */

import { createHash } from "node:crypto";

import type { IntentBody } from "./model.ts";

/** JSON with every object's keys in code-point order and no whitespace. Only plain data is expected. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: ${typeof value} is not plain data`);
}

export function intentDigest(body: IntentBody): string {
  return createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

/** Whether the stored body still is the one its digest was made of. */
export function digestHolds(record: Readonly<{ body: IntentBody; digest: string }>): boolean {
  try {
    return intentDigest(record.body) === record.digest;
  } catch {
    return false;
  }
}
