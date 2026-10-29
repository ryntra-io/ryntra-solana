/**
 * Issuer-power badges: can somebody still mint more of this token, or freeze a holder's balance?
 *
 * Each authority is read from every source that states it — Jupiter's token audit, Meteora's pool record (freeze only),
 * and, when the caller has one, the mint account read from a Solana RPC (for example through
 * `@ryntra/solana-evidence-sdk`'s `inspectSolanaMint`). The badge is what the reads say together:
 *
 * - all reads agree → that state (`revoked` or `active`);
 * - reads disagree → `disputed`, shown as a caution, never as the kinder of the two;
 * - nothing stated it → `not_measured`, never «revoked».
 *
 * A badge states a fact about the mint. It is not a safety verdict, and this module has no word for one.
 *
 * Pure: no network, no clock.
 */

import type { SourceId } from "./contract.ts";

export const AUTHORITIES = ["mint", "freeze"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export type AuthorityRead = Readonly<{
  authority: Authority;
  source: SourceId;
  url: string;
  observedAt: string;
  state: "revoked" | "active" | "not_measured";
}>;

export type BadgeState = "revoked" | "active" | "disputed" | "not_measured";

export type IssuerBadge = Readonly<{
  authority: Authority;
  state: BadgeState;
  reads: readonly AuthorityRead[];
}>;

export type IssuerBadges = Readonly<{ mint: IssuerBadge; freeze: IssuerBadge }>;

export function judgeAuthority(authority: Authority, reads: readonly AuthorityRead[]): IssuerBadge {
  const own = reads.filter((read) => read.authority === authority);
  const stated = new Set(own.filter((read) => read.state !== "not_measured").map((read) => read.state));
  const state: BadgeState = stated.size === 0 ? "not_measured" : stated.size > 1 ? "disputed" : (stated.values().next().value as "revoked" | "active");
  return { authority, state, reads: own };
}

export function judgeBadges(reads: readonly AuthorityRead[]): IssuerBadges {
  return { mint: judgeAuthority("mint", reads), freeze: judgeAuthority("freeze", reads) };
}

/**
 * The mint account as an RPC read states it — the authority's address, or null when the slot is empty. Pass the
 * addresses exactly as read; `undefined` means the read did not cover that slot.
 */
export function authorityReadsFromChain(
  chain: Readonly<{ mintAuthority?: string | null; freezeAuthority?: string | null; observedAt: string; url: string }>,
): AuthorityRead[] {
  const one = (authority: Authority, slot: string | null | undefined): AuthorityRead => ({
    authority,
    source: "solana-rpc",
    url: chain.url,
    observedAt: chain.observedAt,
    state: slot === undefined ? "not_measured" : slot === null || slot === "" ? "revoked" : "active",
  });
  return [one("mint", chain.mintAuthority), one("freeze", chain.freezeAuthority)];
}
