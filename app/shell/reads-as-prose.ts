/**
 * Is this value a word, or a recorded machine string?
 *
 * `Metric` and `KeyValue` set every value in the mono face with tabular
 * numerals, because most of what they carry is a block height, a chain id, a
 * hash or an amount. Most is not all. The same two components also render the
 * *answer* to a question — `Так`, `Невідомо`, `Ні — testnet`, a testnet's name,
 * `4 з 5` — and a sentence in the machine face is the single largest reason the
 * workspace reads as a console.
 *
 * `4 з 5` is the case that proves it is not cosmetic. Set in a monospace face
 * with `tabular-nums`, the Cyrillic `з` takes a digit's advance width and a
 * digit's shape, and the network pulse reported its reachable endpoints as
 * **`4 3 5`**. A reader has no way to tell that is not three numbers.
 *
 * Marking seventy-five call sites by hand would have been the explicit fix and
 * would have drifted the first time somebody added the seventy-sixth. The
 * shape of the value is knowable, so this decides it once:
 *
 *   - anything starting `0x` is an address or a hash;
 *   - anything with a dotted host in it is a URL or an endpoint;
 *   - **any Cyrillic at all is copy** — no identifier in this product is
 *     written in Cyrillic, in any locale;
 *   - a Latin run of three or more letters is a word, unless the whole value
 *     is an upper-case token — `USDC`, `HTTP 403`, `1.000000 USDC` — which is a
 *     ticker, a code or an amount and keeps the machine face.
 *
 * `162 ms` stays mono: `ms` is two letters, and a unit is not a word.
 *
 * Everything this returns `true` for takes the reading face and, in the wide
 * two-column layout, a left edge — a sentence right-aligned against a ragged
 * column is the other half of the same defect.
 */
export function readsAsProse(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  /* An address, a hash, or anything hex-prefixed. */
  if (/^0x/i.test(text)) return false;
  /* A host, a domain or a URL — `api.mainnet-beta.solana.com`, `solscan.io`. */
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(text)) return false;
  /* Cyrillic is always copy. */
  if (/[Ѐ-ӿ]/.test(text)) return true;
  /* An upper-case token, a code or an amount: `USDC`, `HTTP 403`, `1.00 USDC`. */
  if (/^[A-Z0-9\s.,/:()·—–-]+$/.test(text)) return false;
  /* A Latin word of three letters or more. */
  return /[A-Za-z]{3,}/.test(text);
}
