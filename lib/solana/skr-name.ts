/**
 * `.skr` names in the words both sides use (SKR-4) — pure, no RPC, safe in a browser and on the server.
 *
 * A Seeker owner's `.skr` name (AllDomains, Solana Mobile's `@solana-mobile/skr-domain`) stands where a shortened
 * address used to: in the wallet, in «Надіслати», in the Portfolio and on a receipt. The reads themselves live on the
 * server (`skr.server.ts`); this file decides only what counts as a name and what counts as a look-alike address.
 *
 * Narrower than the package on purpose. `normalizeSkrName` accepts any label without a dot, emoji and Cyrillic
 * included; a person typing a recipient here can reach a name only in plain ASCII letters, digits, `-` and `_`, so a
 * homograph — `аlice.skr` with a Cyrillic «а» — is never read as `alice.skr` and never resolved at all.
 */

/** A `.skr` name as typed: one label of ASCII letters, digits, `-` and `_`, then `.skr`. */
const SKR_LABEL = /^[a-z0-9_-]{1,63}$/;
const SKR_SUFFIX = ".skr";

/** The name in its one form (`alice.skr`), or `null` when what was typed is not a `.skr` name. */
export function skrNameOf(input: string): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (!value.endsWith(SKR_SUFFIX)) return null;
  const label = value.slice(0, -SKR_SUFFIX.length);
  return SKR_LABEL.test(label) ? `${label}${SKR_SUFFIX}` : null;
}

/** A name the server answered — kept only when it is still a name in this file's sense. */
export function shownSkrName(value: unknown): string | null {
  return typeof value === "string" ? skrNameOf(value) : null;
}

/** The edges an address-poisoning look-alike copies (SEC-2, the phone's `recipients.ts`). */
const EDGE = 4;

/**
 * A known address this one imitates: the same first and last four characters, another middle — the trick a history of
 * transfers invites, and the one a name makes easier to miss, because the eye reads the name and skips the address.
 * `null` when it imitates none. The phone's rule, the same edges (`apps/mobile/src/features/money/recipients.ts`).
 */
export function lookalikeOf(known: readonly string[], address: string): string | null {
  if (address.length <= EDGE * 2) return null;
  const head = address.slice(0, EDGE);
  const tail = address.slice(-EDGE);
  return known.find((entry) => entry !== address && entry.slice(0, EDGE) === head && entry.slice(-EDGE) === tail) ?? null;
}

/** A whole address in groups of four, as the eye checks it against what it expected — Review shows every character. */
export function addressGroups(value: string): readonly string[] {
  return value.match(/.{1,4}/g) ?? [];
}
