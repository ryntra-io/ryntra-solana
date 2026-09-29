import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/**
 * One pot, many people — and the row that stops it being promised twice.
 *
 * ## The defect this exists to close
 *
 * The first version of Rewards computed `Available` as
 * `min(what this wallet is owed, the whole treasury balance)`. Per wallet that
 * is correct and it looks correct in every single-user test. Across wallets it
 * is a double promise: with $50 in the treasury and two people owed $40 each,
 * both were shown $40 and the sum of what the product offered was $80. The
 * per-wallet claim lock was real and did its job — one wallet cannot claim
 * twice — but nothing anywhere reserved money *between* wallets, because
 * nothing anywhere knew about more than one wallet at a time.
 *
 * So the pot needs a ledger of its own, and it is deliberately **one row**.
 * Every open claim's hold lives in it, `compareAndSet` serializes them, and a
 * hold is only granted when the whole set still fits inside the balance that
 * was actually read off the chain. Two people cannot reserve the same ten
 * dollars because the second one's write sees the first one's hold.
 *
 * A single contended row is the obvious cost. It is the right cost here: claims
 * are rare, the retry budget is bounded, and losing the race means being told
 * to try again rather than being paid from money somebody else already has.
 *
 * ## Why holds are a list rather than a running total
 *
 * A total drifts. Add-then-crash, or a release applied twice, and the number
 * silently stops describing anything — and it is the number that decides
 * whether somebody gets paid. A list keyed by claim makes every operation
 * idempotent: releasing a hold that is not there does nothing, and holding a
 * claim that already holds does nothing. The total is derived, so it cannot
 * disagree with the holds it is a total of.
 *
 * ## The settling window, and why a paid hold does not vanish
 *
 * A payout is accepted by an RPC before the balance read reflects it. Drop the
 * hold at that moment and `free` jumps back up by an amount that has already
 * left, so for a second or two the product could offer money that is gone. A
 * consumed hold therefore becomes `SETTLING` and keeps counting against `free`
 * for {@link SETTLE_WINDOW_MS}, which is far longer than Solana takes to
 * confirm and short enough that a reserve is never held hostage by it.
 */

const SETTLE_WINDOW_MS = 2 * 60_000;

/** Somewhere between "plenty" and "something has gone wrong". */
const MAX_OPEN_HOLDS = 200;

const RESERVE_KEY = "solana:mainnet";
const COLLECTION = "rewardReserve" as const;

export const RewardHoldSchema = z
  .object({
    claimId: z.string().min(1).max(80),
    wallet: z.string().min(32).max(64),
    usdMicros: z.string().regex(/^[1-9][0-9]*$/),
    /**
     * `HELD` — a claim is running and this money is spoken for.
     * `SETTLING` — the payout left and the chain has not caught up yet. Still
     * counted, for the reason in the module note above.
     */
    state: z.enum(["HELD", "SETTLING"]),
    at: z.string().datetime({ offset: true }),
    /** When a `SETTLING` hold stops counting. Null while `HELD`. */
    settledAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type RewardHold = z.output<typeof RewardHoldSchema>;

export const RewardReserveLedgerSchema = z
  .object({
    holds: z.array(RewardHoldSchema).max(MAX_OPEN_HOLDS),
    updatedAt: z.string().datetime({ offset: true }),
    version: z.number().int().min(0),
  })
  .strict();

export type RewardReserveLedger = z.output<typeof RewardReserveLedgerSchema>;

const EMPTY: RewardReserveLedger = { holds: [], updatedAt: "1970-01-01T00:00:00.000Z", version: 0 };

/** Holds that still count against the pot at this moment. */
function live(ledger: RewardReserveLedger, now: string): readonly RewardHold[] {
  const at = Date.parse(now);
  return ledger.holds.filter((hold) => {
    if (hold.state === "HELD") return true;
    if (!hold.settledAt) return true;
    const settled = Date.parse(hold.settledAt);
    return !Number.isFinite(settled) || at - settled < SETTLE_WINDOW_MS;
  });
}

/** What the open and settling claims add up to. Derived, never stored. */
export function heldUsdMicros(ledger: RewardReserveLedger | null, now: string): bigint {
  if (!ledger) return 0n;
  return live(ledger, now).reduce((sum, hold) => sum + BigInt(hold.usdMicros), 0n);
}

/**
 * What is left of the pot for whoever asks next.
 *
 * Floored at zero: a treasury that has been drained below its outstanding holds
 * — a manual withdrawal, say — is a reason to offer nobody anything, not a
 * reason to report a negative amount somewhere it will be subtracted again.
 */
export function freeReserveUsdMicros(
  args: Readonly<{ treasuryUsdMicros: bigint; ledger: RewardReserveLedger | null; now: string }>,
): bigint {
  const free = args.treasuryUsdMicros - heldUsdMicros(args.ledger, args.now);
  return free > 0n ? free : 0n;
}

export async function readReserveLedger(store: GuardStore): Promise<RewardReserveLedger | null> {
  return (await store.versioned<RewardReserveLedger>(COLLECTION).get(RESERVE_KEY)) ?? null;
}

export type HoldResult =
  | Readonly<{ ok: true; hold: RewardHold; freeAfterUsdMicros: bigint }>
  | Readonly<{ ok: false; code: "INSUFFICIENT_RESERVE" | "TOO_MANY_HOLDS"; freeUsdMicros: bigint; reason: string }>;

/**
 * Take money out of the shared pot for one claim, or refuse.
 *
 * `treasuryUsdMicros` is passed in rather than read here because it is a chain
 * fact with its own failure modes, and because the caller must have read it
 * immediately before — a hold granted against a balance from a minute ago is a
 * hold granted against a number that may no longer exist.
 *
 * Holding twice for the same claim is not an error and does not double-count:
 * the existing hold is returned. That is what makes a retried request safe.
 */
export async function holdReserve(
  store: GuardStore,
  args: Readonly<{ claimId: string; wallet: string; usdMicros: bigint; treasuryUsdMicros: bigint; now: string }>,
): Promise<HoldResult> {
  if (args.usdMicros <= 0n) throw new Error("A reserve hold must be for a positive amount.");
  const reserve = store.versioned<RewardReserveLedger>(COLLECTION);
  return withBoundedCasRetry<HoldResult>(async () => {
    const current = (await reserve.get(RESERVE_KEY)) ?? null;
    const ledger = current ?? EMPTY;

    const existing = ledger.holds.find((hold) => hold.claimId === args.claimId);
    if (existing) {
      return {
        ok: true,
        hold: existing,
        freeAfterUsdMicros: freeReserveUsdMicros({ treasuryUsdMicros: args.treasuryUsdMicros, ledger, now: args.now }),
      };
    }

    /* Expired settling holds are dropped on the way past, so the row stays the
       size of what is actually open rather than of everything that ever was. */
    const kept = [...live(ledger, args.now)];
    const free = args.treasuryUsdMicros - kept.reduce((sum, hold) => sum + BigInt(hold.usdMicros), 0n);
    if (free < args.usdMicros) {
      return {
        ok: false,
        code: "INSUFFICIENT_RESERVE",
        freeUsdMicros: free > 0n ? free : 0n,
        reason: "The Rewards treasury does not have this amount free right now.",
      };
    }
    if (kept.length >= MAX_OPEN_HOLDS) {
      return {
        ok: false,
        code: "TOO_MANY_HOLDS",
        freeUsdMicros: free,
        reason: `More than ${MAX_OPEN_HOLDS} claims are open at once; nothing new is reserved until they resolve.`,
      };
    }

    const hold: RewardHold = RewardHoldSchema.parse({
      claimId: args.claimId,
      wallet: args.wallet,
      usdMicros: args.usdMicros.toString(),
      state: "HELD",
      at: args.now,
      settledAt: null,
    });
    const next = RewardReserveLedgerSchema.parse({
      holds: [...kept, hold],
      updatedAt: args.now,
      version: ledger.version + 1,
    });
    const written = await reserve.compareAndSet(RESERVE_KEY, current ? current.version : null, next);
    return written
      ? { ok: true, hold, freeAfterUsdMicros: free - args.usdMicros }
      : false;
  });
}

/**
 * Give the money back, because the payout definitely did not happen.
 *
 * Only ever called where nothing left the treasury: a build that failed, a
 * broadcast the chain refused, a reserve that could not be granted after the
 * claim slot was already taken. Never on an unknown outcome — that is the whole
 * point of the distinction, and calling it there would free money that may
 * already be gone.
 */
export async function releaseReserve(store: GuardStore, claimId: string, now: string): Promise<boolean> {
  return dropHold(store, claimId, now, "RELEASE");
}

/**
 * The money left. The hold becomes `SETTLING` rather than disappearing, so the
 * pot does not briefly appear to hold an amount that is already on its way out.
 */
export async function consumeReserve(store: GuardStore, claimId: string, now: string): Promise<boolean> {
  return dropHold(store, claimId, now, "CONSUME");
}

async function dropHold(
  store: GuardStore,
  claimId: string,
  now: string,
  mode: "RELEASE" | "CONSUME",
): Promise<boolean> {
  const reserve = store.versioned<RewardReserveLedger>(COLLECTION);
  return withBoundedCasRetry<boolean>(async () => {
    const current = await reserve.get(RESERVE_KEY);
    if (!current) return true;
    const found = current.holds.find((hold) => hold.claimId === claimId);
    /* Idempotent by construction: a hold that is not there needs no write, and
       a second release of the same claim is a no-op rather than a correction. */
    if (!found) return true;
    if (mode === "CONSUME" && found.state === "SETTLING") return true;
    const holds = live(current, now)
      .filter((hold) => hold.claimId !== claimId)
      .concat(
        mode === "CONSUME"
          ? [RewardHoldSchema.parse({ ...found, state: "SETTLING", settledAt: now })]
          : [],
      );
    const next = RewardReserveLedgerSchema.parse({ holds, updatedAt: now, version: current.version + 1 });
    const written = await reserve.compareAndSet(RESERVE_KEY, current.version, next);
    return written ? true : false;
  });
}

/** An operator's view of the pot. Never rendered to a customer. */
export function describeReserve(
  args: Readonly<{ treasuryUsdMicros: bigint; ledger: RewardReserveLedger | null; now: string }>,
): string {
  const held = heldUsdMicros(args.ledger, args.now);
  const open = args.ledger ? live(args.ledger, args.now).length : 0;
  return `treasury ${args.treasuryUsdMicros}, held ${held} across ${open} hold(s), free ${freeReserveUsdMicros(args)}`;
}

export { SETTLE_WINDOW_MS, MAX_OPEN_HOLDS };
