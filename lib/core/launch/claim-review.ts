/**
 * «Забрати все» — the Review of everything the creator's side of a launch holds, before one signature (SOL-L12): each
 * pocket by name, what it holds, whether this claim takes it and in which of the transactions the wallet signs, and
 * why not when it does not.
 *
 * The pockets:
 * - **curve** — the creator's part of the curve's trading fee;
 * - **graduation** — the creator's part of the fee taken at the move to the DEX;
 * - **surplus** — the creator's part of what the last purchase raised above the threshold (Meteora's
 *   `getSurplusBreakdown`: 80 % of it to the partner and the creator, the creator's by its trading share);
 * - **lp** — the fees of the creator role's position in the DAMM v2 pool, locked for ever at the move; the position is
 *   an NFT, and whoever holds the NFT takes its fees — a position sent away (Meteora's «Send Position») stays locked
 *   and is no longer the creator's to claim from;
 * - **leftover** — the curve's base tokens left after the move: the config's leftover receiver takes them, never the
 *   creator through Ryntra;
 * - **transferFee** — a Token-2022 transfer fee withheld on the launched token: no launch through Ryntra has one yet
 *   (Quick Launch passes no fee field); collecting it is SOL-L10's, and this pocket only says whether there is one.
 *
 * Pure and client-safe: the figures are the chain's, read by the caller.
 */

import { FEE_SOURCES, creatorEarnings, creatorSurplusRaw, type CreatorFeesRead, type FeeSource } from "./creator-earnings.ts";

export const CLAIM_POCKETS = ["curve", "graduation", "surplus", "lp", "leftover", "transferFee"] as const;
export type ClaimPocketId = (typeof CLAIM_POCKETS)[number];

/**
 * - `IN_CLAIM` — this claim takes it, in transaction `transaction`;
 * - `EMPTY` — nothing in it now (never anything, or already taken);
 * - `BEFORE_DEX` — it fills only once the curve is full or the token is on the DEX;
 * - `WAITING` — it holds something this claim does not take now (a position not read, a vault that refuses it);
 * - `CLOSED` — it holds something Ryntra does not take on this network until the operator's switch (SOL-L1d's claims);
 * - `NOT_YOURS` — another wallet takes it (`holder`);
 * - `NONE` — the token has no such pocket;
 * - `LATER` — the pocket exists and is collected on its own, not by this claim (SOL-L10's harvest and withdraw);
 * - `UNREAD` — the chain was not read for it now; nothing is said.
 */
export const CLAIM_POCKET_STATES = ["IN_CLAIM", "EMPTY", "BEFORE_DEX", "WAITING", "CLOSED", "NOT_YOURS", "NONE", "LATER", "UNREAD"] as const;
export type ClaimPocketState = (typeof CLAIM_POCKET_STATES)[number];

export type ClaimPocket = Readonly<{
  pocket: ClaimPocketId;
  state: ClaimPocketState;
  /** What the pocket holds for the creator's side, raw — in the pair currency, or for `transferFee` in the token; null when not a figure here. */
  amountRaw: string | null;
  /** 1-based: the transaction of this claim that takes it; null when this claim does not. */
  transaction: number | null;
  /** Who takes it instead, for `NOT_YOURS`. */
  holder: string | null;
}>;

export type ClaimPlanTransaction = Readonly<{ index: number; sources: readonly FeeSource[]; payout: boolean }>;

export type ClaimReviewInput = Readonly<{
  read: CreatorFeesRead;
  migrated: boolean;
  wallet: string;
  /** Whether SOL-L1d's claims are open here: closed, the surplus is not taken through Ryntra. */
  claimsOpen: boolean;
  /** The transactions this claim would be, each with the sources it takes; empty — nothing to take now. */
  transactions: readonly Readonly<{ sources: readonly FeeSource[] }>[];
  /** Whether the role is a vault sharing the fees: its last transaction pays the wallet its share. */
  shared: boolean;
  /** The current holder of the role's exit position NFT: undefined — no position; null — not read. */
  positionHolder: string | null | undefined;
  /** The config's leftover receiver and whether the leftover was withdrawn; null — not read. */
  leftover: Readonly<{ receiver: string; withdrawn: boolean }> | null;
  /** The launched token's transfer fee: absent, present, or not read. */
  transferFee: "NONE" | "PRESENT" | null;
}>;

const pocket = (id: ClaimPocketId, state: ClaimPocketState, amountRaw: string | null = null, transaction: number | null = null, holder: string | null = null): ClaimPocket => ({ pocket: id, state, amountRaw, transaction, holder });

/** The claim's transactions as the Review lists them: 1-based, each with what it takes; a shared vault's payout last. */
export function claimPlanTransactions(input: Pick<ClaimReviewInput, "transactions" | "shared">): ClaimPlanTransaction[] {
  return input.transactions.map((tx, index) => ({ index: index + 1, sources: FEE_SOURCES.filter((source) => tx.sources.includes(source)), payout: input.shared && index === input.transactions.length - 1 }));
}

/** Every pocket, in the Review's order, with what this claim does about it. */
export function claimPockets(input: ClaimReviewInput): ClaimPocket[] {
  const closedSurplus = !input.claimsOpen;
  /* Closed, the surplus is not counted as the wallet's to take — but the Review still says it is there. */
  const counted = closedSurplus ? { ...input.read, surplus: { ...input.read.surplus, full: false } } : input.read;
  const role = creatorEarnings(counted, input.wallet).role;
  const inTx = (source: FeeSource) => {
    const at = input.transactions.findIndex((tx) => tx.sources.includes(source));
    return at < 0 ? null : at + 1;
  };
  const roleOwner = input.read.roleOwner;
  const sourcePocket = (source: FeeSource): ClaimPocket => {
    if (source === "surplus" && closedSurplus) {
      const held = input.read.surplus.withdrawn ? 0n : creatorSurplusRaw(input.read.surplus);
      if (held > 0n) return pocket("surplus", "CLOSED", held.toString());
    }
    const amount = BigInt(role[source].unclaimedRaw);
    const tx = inTx(source);
    /* The NFT is with another wallet: its fees are that wallet's. A claim that still names the position is said here, and
       the Review is not signable (`claimBlockedBy`) — the program would refuse the whole transaction. */
    if (source === "lp" && input.migrated && input.positionHolder && input.positionHolder !== roleOwner) return pocket("lp", "NOT_YOURS", amount.toString(), tx, input.positionHolder);
    if (tx !== null && amount > 0n) return pocket(source, "IN_CLAIM", amount.toString(), tx);
    /* After the DEX the role always has an exit position: none found (sent away before this read, or not read) is said as
       not read, never as an empty pocket. */
    if (source === "lp" && input.migrated && input.positionHolder === null) return pocket("lp", "UNREAD", amount > 0n ? amount.toString() : null);
    if (amount > 0n) return pocket(source, "WAITING", amount.toString());
    if (!input.migrated && (source === "graduation" || source === "lp")) return pocket(source, "BEFORE_DEX", "0");
    if (source === "surplus" && !input.read.surplus.full) return pocket(source, "BEFORE_DEX", "0");
    return pocket(source, "EMPTY", "0");
  };
  const leftover = (): ClaimPocket => {
    if (!input.migrated) return pocket("leftover", "BEFORE_DEX");
    if (!input.leftover) return pocket("leftover", "UNREAD");
    if (input.leftover.withdrawn) return pocket("leftover", "EMPTY");
    if (input.leftover.receiver !== input.wallet) return pocket("leftover", "NOT_YOURS", null, null, input.leftover.receiver);
    return pocket("leftover", "WAITING");
  };
  const transferFee = (): ClaimPocket => (input.transferFee === null ? pocket("transferFee", "UNREAD") : pocket("transferFee", input.transferFee === "NONE" ? "NONE" : "LATER"));
  return [sourcePocket("curve"), sourcePocket("graduation"), sourcePocket("surplus"), sourcePocket("lp"), leftover(), transferFee()];
}

/**
 * Why this claim must not be signed as built, or null: `POSITION_MOVED` — a transaction takes the locked position's fees
 * while its NFT is with another wallet; the position's program refuses the claim, and every pocket in that transaction
 * with it.
 */
export function claimBlockedBy(pockets: readonly ClaimPocket[]): "POSITION_MOVED" | null {
  return pockets.some((entry) => entry.pocket === "lp" && entry.state === "NOT_YOURS" && entry.transaction !== null) ? "POSITION_MOVED" : null;
}

/**
 * The creator role's exit position as an NFT: who holds it now and how much of it is locked for ever. Locked for ever
 * stays locked whoever holds the NFT — sending the position moves its fees to the new holder, never its liquidity out.
 */
export function positionLockOf(liquidity: Readonly<{ unlocked: string; vested: string; permanent: string }>): Readonly<{ permanentBps: number; forever: boolean }> {
  const unlocked = BigInt(liquidity.unlocked);
  const vested = BigInt(liquidity.vested);
  const permanent = BigInt(liquidity.permanent);
  const total = unlocked + vested + permanent;
  if (total === 0n) return { permanentBps: 0, forever: false };
  return { permanentBps: Number((permanent * 10_000n) / total), forever: unlocked === 0n && vested === 0n };
}

/** Whose the position's NFT is, in the Review's words: the wallet's, the vault's sharing the fees, or someone else's. */
export function positionHolderRole(holder: string | null, args: Readonly<{ wallet: string; roleOwner: string; shared: boolean }>): "YOU" | "VAULT" | "OTHER" | "UNREAD" {
  if (holder === null) return "UNREAD";
  if (holder === args.wallet) return "YOU";
  if (args.shared && holder === args.roleOwner) return "VAULT";
  return "OTHER";
}

/**
 * Whether the claim handed to sign is the claim the Review showed: as many transactions, and the same sources taken.
 * Anything else — a pocket filled or emptied between the two reads — is shown again before a wallet is asked.
 */
export function buildMatchesReview(review: Readonly<{ transactions: readonly Readonly<{ sources: readonly FeeSource[] }>[] }>, build: Readonly<{ unsignedWireBase64: readonly string[]; sources: readonly FeeSource[] }>): boolean {
  if (review.transactions.length !== build.unsignedWireBase64.length) return false;
  const shown = new Set(review.transactions.flatMap((tx) => tx.sources));
  const built = new Set(build.sources);
  return shown.size === built.size && [...shown].every((source) => built.has(source));
}
