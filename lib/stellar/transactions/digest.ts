import { canonicalJson } from "../../guard/canonical-json.ts";

/**
 * The same hash, computed where the receipt is finalized.
 *
 * A Stellar lifecycle ends in a browser: the wallet is there, the signature is
 * there, and so is the person the receipt is for. Finalizing on a server would
 * mean the signed transaction and the receipt body travelling to Ryntra to be
 * hashed — which is precisely the dependency a receipt exists to remove. So the
 * digest is Web Crypto, asynchronous, and produces byte-identical output to the
 * Guard kernel's `hashCanonical`.
 *
 * `crypto.subtle` is present in every browser this product supports and in Node
 * 18 and later, so the test can hold both hashers side by side and assert they
 * agree. That assertion is the whole reason this file is allowed to exist.
 */

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashCanonicalAsync(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    /* A thrown error rather than a weaker fallback. A receipt hashed by
       something that is not SHA-256 would verify against nothing, and a receipt
       that cannot be verified is worse than an absent one — it looks like
       proof. */
    throw new Error(
      "Web Crypto is unavailable, so this receipt cannot be hashed. A receipt is only a receipt if its hash can be recomputed.",
    );
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return `0x${hex(await subtle.digest("SHA-256", bytes))}`;
}
