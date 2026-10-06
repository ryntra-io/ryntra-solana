/**
 * The creator's fees shared — «Спільнота» splits them by a rule written at launch.
 *
 * A community launch can share what the creator earns — the curve's creator
 * share, the creator's part of the graduation fee and the fees of the
 * creator's locked LP — between the creator and up to four more wallets: the
 * community's treasury, a co-founder, a moderator. Meteora's Dynamic Fee
 * Sharing holds the creator's role for the token and pays each wallet its
 * share; the shares are written once, when the vault is made, and no one —
 * not the creator, not Ryntra — can change them afterwards (the program has no
 * instruction for it).
 *
 * Pure and client-safe: the rule a form checks and the server checks again,
 * and the arithmetic of one share. The vault itself is built by
 * `../venues/meteora-dbc/fee-sharing.server.ts`.
 */

/** The program's own bounds: two to five wallets, each with a share above zero. */
export const FEE_SHARE_MIN_RECIPIENTS = 2;
export const FEE_SHARE_MAX_RECIPIENTS = 5;
/** Shares are whole basis points of the creator's fees, adding up to all of them. */
export const FEE_SHARE_TOTAL_BPS = 10_000;
/** The least share a wallet takes: one per cent, so no row is there only to fill a slot. */
export const FEE_SHARE_MIN_BPS = 100;

export type FeeShare = Readonly<{ address: string; bps: number }>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type FeeShareProblem =
  | "TOO_FEW"
  | "TOO_MANY"
  | "NOT_AN_ADDRESS"
  | "REPEATED"
  | "CREATOR_MISSING"
  | "SHARE_TOO_SMALL"
  | "SHARE_NOT_WHOLE"
  | "NOT_ALL";

/**
 * What breaks the rule, each once: the creator among two to five distinct
 * wallets, each share whole basis points of at least one per cent, all of them
 * adding up to the creator's whole fee. Empty when the split holds.
 */
export function feeShareProblems(creator: string, shares: readonly FeeShare[]): readonly FeeShareProblem[] {
  const problems = new Set<FeeShareProblem>();
  if (shares.length < FEE_SHARE_MIN_RECIPIENTS) problems.add("TOO_FEW");
  if (shares.length > FEE_SHARE_MAX_RECIPIENTS) problems.add("TOO_MANY");
  const seen = new Set<string>();
  let total = 0;
  for (const share of shares) {
    if (!BASE58.test(share.address)) problems.add("NOT_AN_ADDRESS");
    if (seen.has(share.address)) problems.add("REPEATED");
    seen.add(share.address);
    if (!Number.isInteger(share.bps)) problems.add("SHARE_NOT_WHOLE");
    else if (share.bps < FEE_SHARE_MIN_BPS) problems.add("SHARE_TOO_SMALL");
    total += share.bps;
  }
  if (!seen.has(creator)) problems.add("CREATOR_MISSING");
  if (shares.length >= FEE_SHARE_MIN_RECIPIENTS && total !== FEE_SHARE_TOTAL_BPS) problems.add("NOT_ALL");
  return [...problems];
}

/**
 * The split a form sends: the creator keeps what the others do not take. The
 * others come first as typed; the creator's row is added, never typed.
 */
export function withCreatorShare(creator: string, others: readonly FeeShare[]): readonly FeeShare[] {
  const given = others.reduce((total, share) => total + (Number.isFinite(share.bps) ? share.bps : 0), 0);
  return [{ address: creator, bps: FEE_SHARE_TOTAL_BPS - given }, ...others];
}

/** One wallet's part of an amount by its share of the total — rounded down, as the program pays it. */
export function partOf(amountRaw: bigint, share: number, totalShare: number): bigint {
  if (totalShare <= 0 || share <= 0) return 0n;
  return (amountRaw * BigInt(share)) / BigInt(totalShare);
}
