/**
 * Ryntra's own list of addresses known to drain wallets on Solana — the open register the research asks for
 * (`docs/research/ryntra-system-2026-10-31/`, «Відкриті дані»). An entry stands only with its source: an incident
 * report, an on-chain trace a person can follow, a date. Nothing is added from memory or rumour, and an address
 * leaves the list the day its source is withdrawn.
 *
 * The list ships empty: no address has yet been verified to the bar above. The check says so in its own words (how
 * many addresses it compared against) rather than letting an empty list read as a clean result. Beside it, every
 * recipient is also asked of the security source the engine already reads (`/api/v1/research/address-evidence`),
 * and compared for a look-alike against the signer, the declared recipient and any addresses the caller knows.
 */

export type ThreatEntry = Readonly<{
  address: string;
  kind: "drainer" | "poisoner" | "phishing";
  /** Where a person can verify it. */
  source: string;
  addedAt: string;
}>;

export const THREATS: readonly ThreatEntry[] = [];

export function threatOf(address: string, list: readonly ThreatEntry[] = THREATS): ThreatEntry | null {
  return list.find((entry) => entry.address === address) ?? null;
}

/**
 * Whether `candidate` looks like `known` without being it — the shape of address poisoning: a wallet ground to share
 * the first and last characters a person checks by eye. Seven characters between both ends, at least three at each,
 * is the line drawn here: two unrelated addresses meet it about once in 58⁷ (two trillion).
 */
export function looksLike(candidate: string, known: string): boolean {
  if (candidate === known) return false;
  let head = 0;
  while (head < candidate.length && head < known.length && candidate[head] === known[head]) head += 1;
  let tail = 0;
  while (tail < candidate.length - head && tail < known.length - head && candidate[candidate.length - 1 - tail] === known[known.length - 1 - tail]) tail += 1;
  return head >= 3 && tail >= 3 && head + tail >= 7;
}
