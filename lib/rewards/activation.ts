/**
 * When Rewards started, and why that is one server-side value.
 *
 * Fees collected before Rewards ship
 * create no obligation to anybody, and that the moment accrual begins is set
 * explicitly at launch rather than backdated.
 *
 * **It is read on the server and never sent to a browser as a rule to enforce.**
 * A date compiled into client code is a date somebody can move by changing
 * their clock; a date in an environment variable is an operator decision with
 * one place to look. The variable is also the reason there is no migration to
 * write: nothing exists to import, because before this instant there are no
 * reward rows at all.
 *
 * Unset means **closed**. A deployment that has not been told when Rewards
 * began accrues nothing, which is the correct direction for a money feature to
 * fail in: the alternative default would quietly accrue against every fee ever
 * collected the first time this code reached production.
 */

const VARIABLE = "RYNTRA_REWARDS_ACTIVATION_AT";

export type RewardsActivation =
  | Readonly<{ state: "OPEN"; at: string; epochMs: number }>
  | Readonly<{ state: "CLOSED"; reason: string }>;

/**
 * The configured activation instant, or the reason there is none.
 *
 * A malformed value is `CLOSED` rather than ignored. An operator who typed
 * `2026-09-10` without a timezone has expressed an intention this module cannot
 * safely guess at — midnight in which place? — and guessing would decide
 * whether a day of real fees is owed to people.
 */
export function rewardsActivation(env: NodeJS.ProcessEnv = process.env): RewardsActivation {
  const raw = (env[VARIABLE] ?? "").trim();
  if (!raw) {
    return { state: "CLOSED", reason: `${VARIABLE} is not set, so Rewards has not started and nothing accrues.` };
  }
  if (!/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(raw)) {
    return {
      state: "CLOSED",
      reason: `${VARIABLE} must be a timezone-qualified instant such as 2026-09-11T00:00:00Z; it reads ${JSON.stringify(raw)}.`,
    };
  }
  const epochMs = Date.parse(raw);
  if (!Number.isFinite(epochMs)) {
    return { state: "CLOSED", reason: `${VARIABLE} is not a readable instant: ${JSON.stringify(raw)}.` };
  }
  return { state: "OPEN", at: new Date(epochMs).toISOString(), epochMs };
}

/** Have rewards started at `now`: an activation instant that is set and already passed. One rule for every page. */
export function rewardsStartedAt(now: string | number, env: NodeJS.ProcessEnv = process.env): boolean {
  const activation = rewardsActivation(env);
  const at = typeof now === "number" ? now : Date.parse(now);
  return activation.state === "OPEN" && activation.epochMs <= at;
}

/**
 * Is an operation that settled at this moment eligible?
 *
 * Strictly after, not on or after. The boundary instant itself belongs to the
 * side that owes nothing, which is the same direction every other decision here
 * fails in.
 */
export function eligibleForRewards(
  settledAt: string,
  activation: RewardsActivation = rewardsActivation(),
): boolean {
  if (activation.state !== "OPEN") return false;
  const settled = Date.parse(settledAt);
  if (!Number.isFinite(settled)) return false;
  return settled > activation.epochMs;
}
