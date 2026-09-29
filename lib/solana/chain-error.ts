/**
 * A transaction error, as a string.
 *
 * `JSON.stringify` alone throws on this: the RPC layer decodes chain integers
 * as `BigInt`, and a plain-looking `{ InstructionError: [1, { Custom: 1 }] }`
 * carries them. Losing the whole read to a serialization error while reporting
 * *why a transaction failed* is the worst possible place for it — a signature
 * status read that threw here was taken for an unavailable operator, and a
 * swap that had landed and failed stayed "not yet known" for as long as anyone
 * asked, with its wallet locked behind it. Bigints render as their digits.
 */
export function describeChainError(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)) ?? "unknown";
  } catch {
    return String(value);
  }
}
