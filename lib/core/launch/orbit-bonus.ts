/**
 * Orbit Bonus (MC-3, decision 68): a mission's crew is paid a part of what Ryntra has already received from that very
 * mission, for keeping its market alive through the checks of days 7, 30 and 90. It adds nothing to what a trade pays:
 * it is Ryntra's own share, given back, inside one ceiling of every payout of a launch — at most 70 % of what Ryntra
 * received. The crew's bonus 20 %,
 * the trader's cashback 30 %, the friend 15 %, the creator's partner 5 % — together 70 %.
 *
 * SOL-L3's check (`survival-stats.ts`) with the crew's own wallets also
 * excluded — a trade by the crew proves nothing; the market in orbit by the check; checks settled in order, a lost one
 * ends the course. Received is only what is on Ryntra's own account by the check — a partner's share still in the pool
 * counts once claimed. The amounts are cumulative, so a check settled twice pays nothing twice.
 *
 * Pure and client-safe. Accrual and payment are the Growth line's; nothing here pays, signs or reads a ledger.
 */

import { SURVIVAL_HORIZONS_DAYS, survivalWindow, windowOutcome, type SurvivalHorizon, type SurvivalTrade } from "./survival-stats.ts";

/** Every payout of a launch's trades and pools together, in basis points of what Ryntra received from them. */
export const LAUNCH_PAYOUT_CEILING_BPS = 7_000;

/** The operator's rates of 25.10 inside the ceiling, in basis points of what Ryntra received. */
export const LAUNCH_PAYOUT_RATES_BPS = { crewBonus: 2_000, cashback: 3_000, friend: 1_500, creatorPartner: 500 } as const;

export const ORBIT_BONUS_BPS = LAUNCH_PAYOUT_RATES_BPS.crewBonus;

/**
 * The bonus is accrued on mainnet: false until the Growth line accrues it, the lawyer has answered and the operator has said
 * so. While false, no page names its rate — the home page's crew card stays NEXT without numbers.
 */
export const ORBIT_BONUS_LIVE = false;

const BPS = 10_000n;
const DAY = 86_400;
/** A crew is its creator and up to four people (MC-2): the vault's rows. */
const CREW_ROWS_MAX = 5;

if (Object.values(LAUNCH_PAYOUT_RATES_BPS).reduce((sum, bps) => sum + bps, 0) > LAUNCH_PAYOUT_CEILING_BPS) {
  throw new Error("The rates of a launch's payouts add up past their ceiling of what Ryntra received.");
}

/* ---------------------------------------------------------------- the checks */

/**
 * One check as the bonus reads it: `waiting` — its week is not over, or not read whole yet; `passed` — the market lived
 * and was in orbit; `not-in-orbit` — it lived on its curve: nothing is paid at it, what it would have paid waits for
 * the next check passed in orbit; `lost` — signal lost: the course ends.
 */
export type BonusCheckState = "waiting" | "passed" | "not-in-orbit" | "lost";

export type BonusCheck = Readonly<{ days: SurvivalHorizon; state: BonusCheckState; proof: Readonly<{ signature: string; at: number }> | null }>;

/** The wallets whose trades prove nothing for the bonus: the creator, every member of the crew and Ryntra's own. */
export function bonusExcluded(creator: string, crew: readonly Readonly<{ wallet: string }>[], ryntraWallets: Iterable<string>): ReadonlySet<string> {
  return new Set([creator, ...crew.map((row) => row.wallet), ...ryntraWallets]);
}

/**
 * One check for the bonus from a read of its own week (`windowTrades`, as SOL-L3 reads it) — SOL-L3's definition with
 * `excluded` from `bonusExcluded`. `orbitAt`: when the curve migrated to its DAMM v2 pool, unix seconds; null while not.
 */
export function bonusCheck(
  args: Readonly<{ days: SurvivalHorizon; launchedAt: number; orbitAt: number | null; read: Readonly<{ trades: readonly SurvivalTrade[]; complete: boolean }>; excluded: ReadonlySet<string>; now: number }>,
): BonusCheck {
  const window = survivalWindow(args.launchedAt, args.days);
  if (window.to > args.now) return { days: args.days, state: "waiting", proof: null };
  const outcome = windowOutcome(args.days, args.read, args.launchedAt, args.excluded);
  if (outcome.state === "quiet") return { days: args.days, state: "lost", proof: null };
  if (outcome.state !== "alive") return { days: args.days, state: "waiting", proof: null };
  const inOrbit = args.orbitAt !== null && args.orbitAt < window.to;
  return { days: args.days, state: inOrbit ? "passed" : "not-in-orbit", proof: outcome.proof };
}

/* ---------------------------------------------------------------- the amounts */

/** A row of the crew as the Dynamic Fee Sharing vault pays it: a wallet and its part, basis points of 10 000. */
export type CrewRow = Readonly<{ wallet: string; bps: number }>;

/** The crew's rows, checked: one to five distinct wallets with whole, positive parts that make 10 000. */
export function checkedCrew(crew: readonly CrewRow[]): readonly CrewRow[] {
  if (crew.length === 0 || crew.length > CREW_ROWS_MAX) throw new Error("A crew is one to five wallets.");
  if (new Set(crew.map((row) => row.wallet)).size !== crew.length) throw new Error("A wallet stands once in a crew.");
  if (crew.some((row) => !Number.isInteger(row.bps) || row.bps <= 0)) throw new Error("Each part of a crew is a whole, positive number of basis points.");
  if (crew.reduce((sum, row) => sum + row.bps, 0) !== 10_000) throw new Error("A crew's parts make 10 000 basis points.");
  return crew;
}

function nonNegative(value: bigint, what: string): bigint {
  if (value < 0n) throw new Error(`${what} is never below zero.`);
  return value;
}

/** What is left under the ceiling for any further payout from a mission, raw units of the pair: never below zero. */
export function payoutRoomRaw(receivedRaw: bigint, paidRaw: bigint): bigint {
  const room = (nonNegative(receivedRaw, "What Ryntra received") * BigInt(LAUNCH_PAYOUT_CEILING_BPS)) / BPS - nonNegative(paidRaw, "What was paid out");
  return room > 0n ? room : 0n;
}

/**
 * The crew's whole bonus so far: 20 % of what Ryntra received from the mission, and never more than the ceiling leaves
 * once every other payout from the same mission is counted (cashback, friends, «First $10 back», the creator's partner).
 * The rates make 70 % exactly, so the ceiling binds only when another payout is outside its own rate.
 */
export function orbitBonusEntitlementRaw(receivedRaw: bigint, otherPayoutsRaw: bigint): Readonly<{ raw: bigint; capped: boolean }> {
  const rate = (nonNegative(receivedRaw, "What Ryntra received") * BigInt(ORBIT_BONUS_BPS)) / BPS;
  const room = payoutRoomRaw(receivedRaw, otherPayoutsRaw);
  return rate <= room ? { raw: rate, capped: false } : { raw: room, capped: true };
}

export type BonusPart = Readonly<{ wallet: string; raw: bigint }>;

export type BonusTranche = Readonly<{
  /** The crew's whole bonus so far, and whether the ceiling cut it. */
  entitlementRaw: bigint;
  capped: boolean;
  /** What each row is due now: its part of the whole, rounded down, less what it was already paid; never below zero. */
  parts: readonly BonusPart[];
  dueRaw: bigint;
}>;

/**
 * The tranche of a check passed. `receivedRaw` — Ryntra's receipts from this mission on its own account by the check's
 * moment (`launch + N days`); `otherPayoutsRaw` — every other payout accrued from those receipts; `paidRaw` — the bonus
 * each wallet was already accrued at earlier checks. Cumulative: settling the same check again is due nothing, a crew
 * row is never asked to give back, and the dust of rounding stays with Ryntra.
 */
export function orbitBonusTranche(
  args: Readonly<{ receivedRaw: bigint; otherPayoutsRaw: bigint; crew: readonly CrewRow[]; paidRaw?: ReadonlyMap<string, bigint> }>,
): BonusTranche {
  const crew = checkedCrew(args.crew);
  const { raw: entitlementRaw, capped } = orbitBonusEntitlementRaw(args.receivedRaw, args.otherPayoutsRaw);
  const parts = crew.map((row) => {
    const share = (entitlementRaw * BigInt(row.bps)) / BPS;
    const paid = nonNegative(args.paidRaw?.get(row.wallet) ?? 0n, "A bonus paid");
    return { wallet: row.wallet, raw: share > paid ? share - paid : 0n };
  });
  return { entitlementRaw, capped, parts, dueRaw: parts.reduce((sum, part) => sum + part.raw, 0n) };
}

/* ---------------------------------------------------------------- the course */

/** A check as the Growth line hands it to the course: its state and the mission's figures by its moment. */
export type CourseCheck = Readonly<{ days: SurvivalHorizon; state: BonusCheckState; receivedRaw: bigint; otherPayoutsRaw: bigint }>;

export type CourseStep = Readonly<{
  days: SurvivalHorizon;
  /** `settled` — a tranche was worked out (it may be zero); `rolled` — lived on the curve, nothing now; `waiting`; `lost`;
   * `closed` — after a lost check, or after one still waiting: a later check is never settled before an earlier one. */
  step: "settled" | "rolled" | "waiting" | "lost" | "closed";
  parts: readonly BonusPart[];
  dueRaw: bigint;
}>;

export type BonusCourse = Readonly<{
  steps: readonly CourseStep[];
  paidRaw: bigint;
  /** The course is over: Day 90 decided, or a signal lost. */
  ended: boolean;
  /**
   * What the crew would have had and will not: on a lost signal, or a Day 90 lived off orbit, the bonus so far less what
   * was paid — for the season's prize fund (`SPEC.md`), which is MC-4's and the Growth line's; until it exists, unpaid.
   */
  forfeitRaw: bigint;
}>;

/**
 * The whole course of a mission's bonus over its three checks, in order: each passed check pays its tranche, a check
 * lived on the curve rolls its part on to the next one passed in orbit, a lost check ends the course. A worked example
 * of `orbitBonusTranche` for the Growth line and for the tests — the ledger is the Growth line's.
 */
export function orbitBonusCourse(checks: readonly CourseCheck[], crew: readonly CrewRow[]): BonusCourse {
  const rows = checkedCrew(crew);
  const ordered = SURVIVAL_HORIZONS_DAYS.map((days) => checks.find((check) => check.days === days) ?? { days, state: "waiting" as const, receivedRaw: 0n, otherPayoutsRaw: 0n });
  const paid = new Map<string, bigint>();
  const total = () => [...paid.values()].reduce((sum, raw) => sum + raw, 0n);
  const steps: CourseStep[] = [];
  let open = true;
  let ended = false;
  let forfeitRaw = 0n;
  for (const check of ordered) {
    if (!open) {
      steps.push({ days: check.days, step: "closed", parts: [], dueRaw: 0n });
      continue;
    }
    if (check.state === "waiting") {
      steps.push({ days: check.days, step: "waiting", parts: [], dueRaw: 0n });
      open = false;
      continue;
    }
    const forfeit = () => {
      const { raw } = orbitBonusEntitlementRaw(check.receivedRaw, check.otherPayoutsRaw);
      return raw > total() ? raw - total() : 0n;
    };
    if (check.state === "lost") {
      forfeitRaw = forfeit();
      steps.push({ days: check.days, step: "lost", parts: [], dueRaw: 0n });
      open = false;
      ended = true;
      continue;
    }
    if (check.state === "not-in-orbit") {
      steps.push({ days: check.days, step: "rolled", parts: [], dueRaw: 0n });
      if (check.days === 90) {
        forfeitRaw = forfeit();
        ended = true;
      }
      continue;
    }
    const tranche = orbitBonusTranche({ receivedRaw: check.receivedRaw, otherPayoutsRaw: check.otherPayoutsRaw, crew: rows, paidRaw: paid });
    for (const part of tranche.parts) paid.set(part.wallet, (paid.get(part.wallet) ?? 0n) + part.raw);
    steps.push({ days: check.days, step: "settled", parts: tranche.parts, dueRaw: tranche.dueRaw });
    if (check.days === 90) ended = true;
  }
  return { steps, paidRaw: total(), ended, forfeitRaw };
}

/** The moment a check's figures are cut at, unix seconds: the end of its week, `launch + N days`. */
export function bonusCutAt(launchedAt: number, days: SurvivalHorizon): number {
  return launchedAt + days * DAY;
}
