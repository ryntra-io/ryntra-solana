import type { GuardStore } from "../guard/store.ts";
import {
  commitSolanaCanarySpend,
  markSolanaCanarySubmitUnknown,
  releaseSolanaCanaryOnProvenFailure,
  releaseSolanaCanaryReservation,
  reserveSolanaCanaryIntent,
} from "./canary-ledger.ts";
import {
  SolanaCanaryIntentSchema,
  type SolanaCanaryPolicy,
  type SolanaCanaryVerdict,
} from "./canary-policy.ts";

/**
 * The bridge's half of the owner-canary budget: what a CCTP burn takes out of
 * the ledger, and what it puts back.
 *
 * Two rules shape everything here.
 *
 * **The budget is debited only inside the envelope.** A verdict whose scope is
 * `OUTSIDE_ENVELOPE` describes somebody moving their own money through a
 * shipped product; the owner-canary ledger accounts a bounded twenty-dollar
 * experiment and has nothing to say about it. Charging every transfer against
 * that ceiling is not caution, it is a product that stops working after the
 * twentieth dollar — the swap route learned this and wrote the reason down.
 * So the scope on the reviewed verdict is the switch, and it is the same
 * signed scope the receipt carries.
 *
 * **An ambiguous outcome never books a spend.** The reservation is taken
 * before the single broadcast and settled only by something read back from a
 * chain: committed when the burn confirmed clean, released when it provably
 * never left or provably reverted, and otherwise left exactly where it is.
 * Held exposure is the honest answer to "we do not know yet" — it overstates
 * what has been spent, which is the safe direction to be wrong in, and it is
 * never released for an automatic retry.
 */

export type CctpCanaryExposure =
  | Readonly<{
      kind: "OUT_OF_SCOPE";
      detail: string;
    }>
  | Readonly<{
      kind: "CLAIMED";
      idempotencyKey: string;
      principalUsdMicros: string;
      usdMicros: string;
    }>
  | Readonly<{
      kind: "ALREADY_CLAIMED";
      idempotencyKey: string;
      state: "RESERVED" | "SUBMITTED_UNKNOWN" | "COMMITTED" | "RELEASED";
      signature: string | null;
    }>
  | Readonly<{
      kind: "REFUSED";
      code: string;
      reason: string;
    }>;

export type CctpCanaryOutcome =
  | Readonly<{ kind: "CONFIRMED_CLEAN"; signature: string }>
  | Readonly<{ kind: "CONFIRMED_REVERTED"; signature: string }>
  | Readonly<{ kind: "NEVER_SUBMITTED" }>
  | Readonly<{ kind: "UNDETERMINED" }>;

export type CctpCanarySettlement = Readonly<{
  /** What the ledger was asked to do, in the language the response prints. */
  action: "COMMITTED" | "RELEASED" | "HELD" | "NONE";
  detail: string;
  failure: string | null;
}>;

/** Exported so a caller that never opened an exposure can say the same thing
    rather than inventing a second wording for it. */
export const CCTP_CANARY_NOT_IN_SCOPE: CctpCanarySettlement = {
  action: "NONE",
  detail:
    "This transfer is outside the owner-canary envelope, so the canary budget was neither reserved nor charged.",
  failure: null,
};

/**
 * Whether the owner-canary policy is needed at all for this transfer.
 *
 * Asked before the policy is resolved, not after. The policy is read from the
 * founder's own environment, and resolving it can fail — a malformed allowlist,
 * a bad state word. Resolving it unconditionally therefore made his experiment
 * configuration a precondition for a stranger's bridge, which is the thing
 * `RYN-SOL-MONEY-FLOWS-001C` exists to end: the canary is an internal
 * instrument and may not decide an ordinary action.
 *
 * Outside the envelope no budget is taken, no reservation is written and no
 * ceiling applies, so there is nothing for a policy to say. Inside it, the
 * policy carries the ceiling that protects the founder from his own instrument,
 * and an unreadable one must still refuse.
 */
export function cctpCanaryExposureNeeded(verdict: SolanaCanaryVerdict): boolean {
  return verdict.scope.status === "INSIDE_ENVELOPE";
}

/**
 * Take the reservation for one reviewed CCTP burn, before the caller may
 * broadcast anything.
 *
 * The reviewed verdict is re-derived by `reserveSolanaCanaryIntent` from the
 * durable policy and the durable ledger; if the policy or the intent moved
 * between Review and now, the two digests disagree and the reservation is
 * given back rather than spent on a transfer the owner did not read.
 */
export async function openCctpCanaryExposure(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  canaryIntent: unknown;
  canaryVerdict: SolanaCanaryVerdict;
  now?: Date;
}): Promise<CctpCanaryExposure> {
  if (args.canaryVerdict.scope.status !== "INSIDE_ENVELOPE") {
    return {
      kind: "OUT_OF_SCOPE",
      detail:
        "The reviewed verdict places this transfer outside the owner-canary envelope, so it does not consume the canary budget.",
    };
  }

  const intent = SolanaCanaryIntentSchema.safeParse(args.canaryIntent);
  if (!intent.success) {
    return {
      kind: "REFUSED",
      code: "CANARY_INTENT_UNREADABLE",
      reason:
        "The reviewed bundle carries an owner-canary verdict without a readable canary intent, so no exposure can be recorded against it.",
    };
  }

  const now = args.now ?? new Date();
  const reserved = await reserveSolanaCanaryIntent({
    store: args.store,
    policy: args.policy,
    intent: intent.data,
    now,
  });

  if (!reserved.ok) {
    if (reserved.code === "DUPLICATE_INTENT") {
      /* This exact intent revision already has durable exposure. Whatever it
         is, it belongs to the earlier attempt: the burn boundary owns the
         duplicate answer and this row must not be touched again. */
      return {
        kind: "ALREADY_CLAIMED",
        idempotencyKey: reserved.record.idempotencyKey,
        state: reserved.record.state,
        signature: reserved.record.signature,
      };
    }
    return { kind: "REFUSED", code: `CANARY_${reserved.code}`, reason: reserved.reason };
  }

  if (
    reserved.verdict.policyDigest !== args.canaryVerdict.policyDigest ||
    reserved.verdict.intentDigest !== args.canaryVerdict.intentDigest
  ) {
    const released = await releaseSolanaCanaryReservation({
      store: args.store,
      policy: args.policy,
      idempotencyKey: reserved.record.idempotencyKey,
      at: now.toISOString(),
    });
    return {
      kind: "REFUSED",
      code: "CANARY_POLICY_CHANGED",
      reason: released.ok
        ? "The owner-canary policy or intent changed after this bridge Review. Build and review a fresh transfer."
        : `The owner-canary policy changed after Review and the reservation could not be given back: ${released.reason}`,
    };
  }

  return {
    kind: "CLAIMED",
    idempotencyKey: reserved.record.idempotencyKey,
    principalUsdMicros: reserved.record.principalUsdMicros,
    usdMicros: reserved.record.usdMicros,
  };
}

/**
 * Record the locally verified signature as submitted-unknown, immediately
 * before the one broadcast. After this returns, no failure releases the
 * exposure except a proof read back from a chain.
 */
export async function markCctpCanarySubmitted(args: {
  store: GuardStore;
  exposure: CctpCanaryExposure;
  signature: string;
}): Promise<void> {
  if (args.exposure.kind !== "CLAIMED") return;
  const marked = await markSolanaCanarySubmitUnknown({
    store: args.store,
    idempotencyKey: args.exposure.idempotencyKey,
    signature: args.signature,
  });
  if (!marked.ok) {
    throw new Error(`The durable canary submit marker failed: ${marked.reason}`);
  }
}

/**
 * Pick an exposure back up in a later request, so a two-step source lane can
 * settle the reservation its first step took.
 *
 * A Solana burn is one request: reserve, broadcast, settle. An EVM burn cannot
 * be — the wallet signs and sends in the same call, so the reservation is taken
 * in the request that arms the wallet and the outcome is only known in the one
 * that reports the transaction. Without this the reservation would be held for
 * ever on a burn that visibly confirmed, which overstates the owner's spend and
 * eventually stops his own instrument working.
 *
 * It converts nothing and grants nothing. `openCctpCanaryExposure` is still what
 * establishes that a row exists and what its key is; this only says that a row
 * in a pre-settlement state may be settled by the caller that already holds the
 * matching durable burn claim. A row already committed or released is returned
 * unchanged, because settling twice is exactly the double-count this avoids.
 */
export function resumeCctpCanaryExposure(
  idempotencyKey: string | null,
  amounts?: Readonly<{ principalUsdMicros: string; usdMicros: string }>,
): CctpCanaryExposure {
  if (!idempotencyKey) {
    return {
      kind: "OUT_OF_SCOPE",
      detail: "This transfer took no owner-canary reservation, so there is nothing to settle.",
    };
  }
  return {
    kind: "CLAIMED",
    idempotencyKey,
    /* The amounts appear only in the sentence a committed settlement returns.
       They are the figures the reservation was taken with, carried forward by
       the caller that took it — never re-derived here, because a number this
       module invented would read exactly like one it had measured. */
    principalUsdMicros: amounts?.principalUsdMicros ?? "0",
    usdMicros: amounts?.usdMicros ?? "0",
  };
}

/** Settle the reservation against what the chains actually said. */
export async function settleCctpCanaryExposure(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  exposure: CctpCanaryExposure;
  outcome: CctpCanaryOutcome;
  at?: string;
}): Promise<CctpCanarySettlement> {
  if (args.exposure.kind === "OUT_OF_SCOPE") return CCTP_CANARY_NOT_IN_SCOPE;
  if (args.exposure.kind !== "CLAIMED") {
    return {
      action: "NONE",
      detail:
        "This attempt never took a fresh canary reservation, so it settles nothing. The exposure belongs to the attempt that took it.",
      failure: null,
    };
  }

  const common = {
    store: args.store,
    policy: args.policy,
    idempotencyKey: args.exposure.idempotencyKey,
    at: args.at,
  };

  if (args.outcome.kind === "CONFIRMED_CLEAN") {
    const committed = await commitSolanaCanarySpend({ ...common, signature: args.outcome.signature });
    return committed.ok
      ? {
          action: "COMMITTED",
          detail: `The confirmed burn charged ${args.exposure.usdMicros} USD micros to the owner-canary CCTP budget.`,
          failure: null,
        }
      : {
          action: "HELD",
          detail:
            "The burn confirmed but the canary spend could not be committed, so the exposure stays reserved rather than disappearing.",
          failure: committed.reason,
        };
  }

  if (args.outcome.kind === "CONFIRMED_REVERTED") {
    const released = await releaseSolanaCanaryOnProvenFailure({ ...common, signature: args.outcome.signature });
    return released.ok
      ? {
          action: "RELEASED",
          detail:
            "The burn landed with an error, so nothing left the wallet and the reservation was given back to the canary budget.",
          failure: null,
        }
      : {
          action: "HELD",
          detail: "The reverted burn's reservation could not be given back, so it stays recorded as exposure.",
          failure: released.reason,
        };
  }

  if (args.outcome.kind === "NEVER_SUBMITTED") {
    const released = await releaseSolanaCanaryReservation(common);
    return released.ok
      ? {
          action: "RELEASED",
          detail: "Nothing was broadcast, so the reservation was given back to the canary budget.",
          failure: null,
        }
      : {
          action: "HELD",
          detail: "The unsubmitted reservation could not be given back, so it stays recorded as exposure.",
          failure: released.reason,
        };
  }

  return {
    action: "HELD",
    detail:
      "Whether this burn landed is not yet known, so its exposure stays reserved. It is never released for an automatic retry, and it is never counted as a spend.",
    failure: null,
  };
}
