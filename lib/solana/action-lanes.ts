/**
 * The lanes and outcomes a wallet action can carry — the one list, in the one
 * place a browser bundle may read it from.
 *
 * `action-ledger.ts` owns the ledger, but it also reaches the Guard store, so a
 * client module can only take types from it. That is how the list came to be
 * copied by hand into the wallet read model, and how the copy went stale twice:
 * on 2026-09-07 the first `RECEIVE` row turned every Activity, Home and
 * Portfolio read of that wallet into "could not be loaded", and on 2026-09-08
 * the founder's first `CROSS_SWAP` row did it again, minutes after the swap
 * itself settled correctly on both chains.
 *
 * Nothing here imports anything. A new lane is added once, here, and both the
 * server ledger and the browser decoder move with it.
 */

export const SOLANA_ACTION_LANES = ["SEND", "SWAP", "BRIDGE", "RECEIVE", "CROSS_SWAP"] as const;
export type SolanaActionLane = (typeof SOLANA_ACTION_LANES)[number];

export const SOLANA_ACTION_OUTCOMES = ["IN_FLIGHT", "DONE", "FAILED", "NEEDS_YOU"] as const;
export type SolanaActionOutcome = (typeof SOLANA_ACTION_OUTCOMES)[number];

/** Where a row that crossed a boundary ended up. */
export const SOLANA_ACTION_DESTINATIONS = ["SOLANA", "BASE", "ETHEREUM", "ROBINHOOD"] as const;
export type SolanaActionDestination = (typeof SOLANA_ACTION_DESTINATIONS)[number];

/**
 * Where a cross-chain swap went, in the words a person reads.
 *
 * Keyed rather than chained, and here rather than in two components: History
 * and Home each carried their own ladder of ternaries ending in `null`, so the
 * fourth destination fell out of both and the founder's first Robinhood Chain
 * swap read "Swapped across chains 0.05 SOL" — no asset received, no chain, no
 * hint of where the money had gone.
 */
export function crossSwapTarget(
  destination: SolanaActionDestination | null,
  text: (value: string) => string,
): string | null {
  if (destination === null) return null;
  const words: Record<SolanaActionDestination, string> = {
    SOLANA: "to Solana",
    BASE: "to Base",
    ETHEREUM: "to Ethereum",
    ROBINHOOD: "to Robinhood Chain",
  };
  return text(words[destination]);
}

export function isSolanaActionLane(value: unknown): value is SolanaActionLane {
  return typeof value === "string" && (SOLANA_ACTION_LANES as readonly string[]).includes(value);
}

export function isSolanaActionOutcome(value: unknown): value is SolanaActionOutcome {
  return typeof value === "string" && (SOLANA_ACTION_OUTCOMES as readonly string[]).includes(value);
}
