/**
 * An autopay's schedule: to whom, how much, how often, until when. The
 * person picks every number; Ryntra sets no ceiling on money (decision 108). The bounds below are technical: a payment
 * the network's rent would swallow is not one, a term is counted in whole periods, and every number fits a u64 on chain.
 *
 * Time is cut into windows: window `k` is `[startAt + k·period, startAt + (k+1)·period)`, `k` from 0 to `count − 1`.
 * Each window holds one payment at most — the chain's spending limit holds exactly that (`./policy.ts`), and the
 * executor asks for one payment per window and never two (`./signer.server.ts`, the store's claim). A window the
 * executor missed is missed: the next window never carries two payments, and what stayed in the vault comes back to the
 * person at the end or at «Stop».
 *
 * Pure — the screen, the server and the tests share it. Seconds are Unix seconds as bigint, as the chain keeps them.
 */

export const AUTOPAY_EVERY = ["day", "week", "month"] as const;
export type AutopayEvery = (typeof AUTOPAY_EVERY)[number];

/** A period in seconds. A month is thirty days — the same span every time, as the chain counts it. */
export const PERIOD_SECONDS: Readonly<Record<AutopayEvery, bigint>> = { day: 86_400n, week: 604_800n, month: 2_592_000n };

export const AUTOPAY_COINS = ["SOL", "USDC"] as const;
export type AutopayCoin = (typeof AUTOPAY_COINS)[number];

/** A coin's decimals. */
export const COIN_DECIMALS: Readonly<Record<AutopayCoin, number>> = { SOL: 9, USDC: 6 };

/**
 * The least payment. SOL: 0.001 — the vault keeps native SOL, and an account under the network's rent minimum
 * (0.00089 SOL for an empty one) is refused by the network, so each balance between payments stays above it. USDC: one
 * cent.
 */
export const PAYMENT_MIN: Readonly<Record<AutopayCoin, bigint>> = { SOL: 1_000_000n, USDC: 10_000n };

/** The most payments one autopay makes: a daily payment for a little over a year, a monthly one for 33 years. */
export const COUNT_MAX = 400;

/** The longest term, in days — a bound on the date the chain keeps (the same as an agent's budget), not on money. */
export const TERM_DAYS_MAX = 3650;

/** SOL the person gives the executor for its network fee, per payment: the base fee and a capped priority. */
export const NETWORK_PER_PAYMENT = 10_000n;

const U64_MAX = 2n ** 64n - 1n;

export type AutopaySchedule = Readonly<{
  coin: AutopayCoin;
  /** One payment, in the coin's base units. */
  amount: bigint;
  every: AutopayEvery;
  /** How many payments, 1 to `COUNT_MAX`. */
  count: number;
  /** The first payment's moment, Unix seconds. */
  startAt: bigint;
}>;

export type ScheduleIssue = "coin" | "amount" | "every" | "count" | "start" | "term" | "tooLarge";

/** The first thing wrong with a schedule; null when the engine takes it. `nowSeconds` — the chain's time. */
export function scheduleIssue(schedule: AutopaySchedule, nowSeconds: bigint): ScheduleIssue | null {
  if (!(AUTOPAY_COINS as readonly string[]).includes(schedule.coin)) return "coin";
  if (!(AUTOPAY_EVERY as readonly string[]).includes(schedule.every)) return "every";
  if (typeof schedule.amount !== "bigint" || schedule.amount < PAYMENT_MIN[schedule.coin]) return "amount";
  if (!Number.isInteger(schedule.count) || schedule.count < 1 || schedule.count > COUNT_MAX) return "count";
  /* A start a little in the past is the moment the wallet signs; a start long ago is not a schedule. */
  if (schedule.startAt < nowSeconds - 3_600n) return "start";
  if (endsAt(schedule) - nowSeconds > BigInt(TERM_DAYS_MAX) * 86_400n) return "term";
  if (schedule.amount > U64_MAX || totalOf(schedule) > U64_MAX) return "tooLarge";
  return null;
}

const ISSUES: Readonly<Record<ScheduleIssue, string>> = {
  coin: "an autopay pays SOL or USDC",
  amount: "a payment is at least 0.001 SOL or 0.01 USDC",
  every: "an autopay pays every day, week or month",
  count: `an autopay makes 1 to ${COUNT_MAX} payments`,
  start: "the first payment is now or later",
  term: `an autopay ends within ${TERM_DAYS_MAX} days`,
  tooLarge: "the total is more than a token account holds",
};

/** Why the schedule is not one the engine takes, in its words; null when it is. */
export function scheduleRefusal(schedule: AutopaySchedule, nowSeconds: bigint): string | null {
  const issue = scheduleIssue(schedule, nowSeconds);
  return issue ? ISSUES[issue] : null;
}

/** The period of a schedule, in seconds. */
export const periodOf = (schedule: Pick<AutopaySchedule, "every">): bigint => PERIOD_SECONDS[schedule.every];

/** The moment window `k` opens — when its payment is due. */
export const dueAt = (schedule: Pick<AutopaySchedule, "every" | "startAt">, k: number): bigint => schedule.startAt + BigInt(k) * periodOf(schedule);

/** The moment the last window closes: after it nothing moves, and the policy is gone on chain. */
export const endsAt = (schedule: Pick<AutopaySchedule, "every" | "startAt" | "count">): bigint => dueAt(schedule, schedule.count);

/** The last payment's moment. */
export const lastDueAt = (schedule: Pick<AutopaySchedule, "every" | "startAt" | "count">): bigint => dueAt(schedule, schedule.count - 1);

/** What the signature moves into the autopay's vault: every payment of the schedule, no more. */
export const totalOf = (schedule: Pick<AutopaySchedule, "amount" | "count">): bigint => schedule.amount * BigInt(schedule.count);

/** SOL the signature gives the executor for its network fees: a fixed share per payment. */
export const networkOf = (schedule: Pick<AutopaySchedule, "count">): bigint => NETWORK_PER_PAYMENT * BigInt(schedule.count);

/**
 * How many payments an end date makes: every window that opens on or before `untilSeconds`, at least one, at most
 * `COUNT_MAX`.
 */
export function countUntil(schedule: Pick<AutopaySchedule, "every" | "startAt">, untilSeconds: bigint): number {
  if (untilSeconds <= schedule.startAt) return 1;
  const windows = (untilSeconds - schedule.startAt) / periodOf(schedule) + 1n;
  return Number(windows > BigInt(COUNT_MAX) ? BigInt(COUNT_MAX) : windows);
}

/** The window `nowSeconds` falls in; null before the first or after the last. */
export function windowAt(schedule: Pick<AutopaySchedule, "every" | "startAt" | "count">, nowSeconds: bigint): number | null {
  if (nowSeconds < schedule.startAt || nowSeconds >= endsAt(schedule)) return null;
  return Number((nowSeconds - schedule.startAt) / periodOf(schedule));
}

/** Where a schedule stands at a moment, given the windows already paid or tried. */
export type Standing =
  | Readonly<{ kind: "due"; window: number }>
  | Readonly<{ kind: "wait"; at: bigint }>
  | Readonly<{ kind: "ended" }>;

/**
 * What the executor does now: pay the window it is in, unless that window has had its payment (or its try); else wait
 * for the next window; after the last one, nothing — the autopay has ended.
 */
export function standingAt(schedule: Pick<AutopaySchedule, "every" | "startAt" | "count">, nowSeconds: bigint, done: ReadonlySet<number>): Standing {
  if (nowSeconds >= endsAt(schedule)) return { kind: "ended" };
  if (nowSeconds < schedule.startAt) return { kind: "wait", at: schedule.startAt };
  const window = windowAt(schedule, nowSeconds)!;
  if (!done.has(window)) return { kind: "due", window };
  return window + 1 < schedule.count ? { kind: "wait", at: dueAt(schedule, window + 1) } : { kind: "ended" };
}

/** The windows before `window` that had neither payment nor try: the ones the executor missed. */
export function missedBefore(window: number, done: ReadonlySet<number>): readonly number[] {
  const missed: number[] = [];
  for (let k = 0; k < window; k += 1) if (!done.has(k)) missed.push(k);
  return missed;
}

/** A decimal the person typed as base units of the coin; null when it is not one (more places than the coin has are refused, never rounded). */
export function amountOf(typed: string, coin: AutopayCoin): bigint | null {
  const plain = typeof typed === "string" ? typed.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const [whole = "0", part = ""] = plain.split(".");
  const decimals = COIN_DECIMALS[coin];
  if (part.length > decimals) return null;
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, "0") || "0");
  return raw > 0n ? raw : null;
}

/** Base units as the eye reads them: no trailing zeros, at most the coin's places. */
export function formatAmount(raw: bigint, coin: AutopayCoin): string {
  const decimals = COIN_DECIMALS[coin];
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const part = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return part ? `${whole}.${part}` : whole.toString();
}
