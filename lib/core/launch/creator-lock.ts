/**
 * The creator's lock — «Творець заблокував свою покупку».
 *
 * A creator who wants holders to see that they will not dump can put the
 * tokens of their first purchase under a lock right after the launch: nothing
 * can be taken out before the cliff, then a share unlocks every day until the
 * end. The lock is Met Lock's vesting escrow on chain, made so that no one —
 * not the creator, not the recipient, not Ryntra — can cancel it or send it
 * elsewhere; the mark on the token page names the escrow, and anyone can read
 * it there.
 *
 * Pure and client-safe: the schedules a creator picks from and the arithmetic
 * of one; the escrow itself is built by `../venues/meteora-dbc/creator-lock.server.ts`.
 */

export const CREATOR_LOCK_IDS = ["1m-3m", "3m-6m", "6m-12m"] as const;
export type CreatorLockId = (typeof CREATOR_LOCK_IDS)[number];

const DAY = 24 * 60 * 60;

/** A schedule: nothing unlocks for `cliffDays`, then an equal share each day for `vestDays`. */
export type CreatorLockSchedule = Readonly<{ id: CreatorLockId; cliffDays: number; vestDays: number }>;

export const CREATOR_LOCK_SCHEDULES: Readonly<Record<CreatorLockId, CreatorLockSchedule>> = Object.freeze({
  "1m-3m": { id: "1m-3m", cliffDays: 30, vestDays: 90 },
  "3m-6m": { id: "3m-6m", cliffDays: 90, vestDays: 180 },
  "6m-12m": { id: "6m-12m", cliffDays: 180, vestDays: 365 },
});

export function creatorLockSchedule(id: string): CreatorLockSchedule | null {
  return (CREATOR_LOCK_IDS as readonly string[]).includes(id) ? CREATOR_LOCK_SCHEDULES[id as CreatorLockId] : null;
}

/** Met Lock's own numbers: nobody may cancel the escrow or change who receives it. */
export const MET_LOCK_NOBODY = 0;

/** The escrow's fields for an amount and a schedule from a start second: a daily share, and the remainder at the cliff. */
export function creatorLockTerms(amountRaw: bigint, schedule: CreatorLockSchedule, startSeconds: number) {
  if (amountRaw <= 0n) throw new Error("A lock needs tokens to lock.");
  const periods = BigInt(schedule.vestDays);
  const perPeriod = amountRaw / periods;
  return {
    vestingStartTime: startSeconds,
    cliffTime: startSeconds + schedule.cliffDays * DAY,
    frequency: DAY,
    numberOfPeriod: schedule.vestDays,
    amountPerPeriod: perPeriod,
    /* What does not divide evenly unlocks at the cliff, so the whole purchase is in the escrow. */
    cliffUnlockAmount: amountRaw - perPeriod * periods,
    endTime: startSeconds + (schedule.cliffDays + schedule.vestDays) * DAY,
    updateRecipientMode: MET_LOCK_NOBODY,
    cancelMode: MET_LOCK_NOBODY,
  } as const;
}
