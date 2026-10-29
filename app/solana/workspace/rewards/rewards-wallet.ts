/**
 * Which wallet the Rewards pages are about, and the one thing they may ask of it.
 *
 * The proof that a wallet is the person's is the sign-in they already made (SIWS): the server remembers it for the
 * whole session and every page reads that one fact (`lib/account/wallet-proof-store.client.ts`). So Rewards never asks
 * on its own — no second «Connect», no «Confirm wallet»:
 *
 *   - a wallet signed in here opens Rewards at once, even before the browser's wallet has reconnected after a reload
 *     (the session names the address; the server is still the judge of every read);
 *   - a connected wallet that has never signed in sees the sign-in — the same one signature as in the header, made
 *     once and remembered — and nothing else;
 *   - nobody and no wallet: the wallet choice;
 *   - while the answer is on its way: a quiet «checking», never a prompt.
 *
 * A read the server refused (`401`, or a proven read answered without the wallet's own part) is never taken on its
 * own word: the shared fact is asked again first (`refusalVerdict`). If the sign-in is gone, the fact says so and the
 * page offers the sign-in. If the fact still proves the address — a store that blinked, a read that crossed a sign-in —
 * the page reads once more; only the same proof refused twice within a minute is remembered, so the page stops asking
 * the server with it. A new sign-in is a new proof and opens the page again.
 */

export type RewardsWalletFact = Readonly<{
  status: "unknown" | "known" | "down";
  provenAddress: string | null;
  expiresAt: string | null;
}>;

export type RewardsWallet =
  | Readonly<{ gate: "connect"; address: null }>
  | Readonly<{ gate: "checking"; address: string | null }>
  | Readonly<{ gate: "signin"; address: string }>
  | Readonly<{ gate: "open"; address: string }>;

/** The proof a refused read is remembered against: the address and the session that signed for it. */
export function proofKey(address: string, fact: RewardsWalletFact): string {
  return `${address}|${fact.expiresAt ?? ""}`;
}

export function rewardsWallet(connected: string | null, fact: RewardsWalletFact, refused: string | null): RewardsWallet {
  const address = connected ?? fact.provenAddress;
  if (address === null) return fact.status === "known" ? { gate: "connect", address: null } : { gate: "checking", address: null };
  if (fact.provenAddress === address && refused !== proofKey(address, fact)) return { gate: "open", address };
  /* A remembered sign-in the server refused, with no wallet in the browser to sign again: the wallet choice. */
  if (connected === null) return fact.status === "known" ? { gate: "connect", address: null } : { gate: "checking", address: null };
  if (fact.status !== "known") return { gate: "checking", address };
  return { gate: "signin", address };
}

/** Two refusals of the same proof this close together are a refusal, not a blink. */
export const REFUSAL_WINDOW_MS = 60_000;

export type RefusalVerdict =
  /** The fact no longer proves the address: the gate follows it (sign-in, or the wallet choice). */
  | "gone"
  /** The fact could not be read: say «checking» or «unavailable», never ask for a signature. */
  | "unknown"
  /** The fact still proves it and this is the first refusal: read once more. */
  | "retry"
  /** The same proof refused twice: remember it and offer the sign-in. */
  | "refused";

/**
 * What a refused read means, from the fact asked again after it. `strikes` are the earlier refusals of this same proof
 * (their times, ms); `count: false` is for a read whose empty answer may be a read failure rather than a refusal (the
 * season's own rows), which never closes the page.
 */
export function refusalVerdict(address: string, fresh: RewardsWalletFact, strikes: readonly number[], now: number, count = true): RefusalVerdict {
  if (fresh.status !== "known") return "unknown";
  if (fresh.provenAddress !== address) return "gone";
  if (!count) return "unknown";
  return strikes.some((at) => now - at < REFUSAL_WINDOW_MS) ? "refused" : "retry";
}
