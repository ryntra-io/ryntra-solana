/**
 * The bounds a person signs once for an agent that moves the range of a position it looks after.
 *
 * The agent moves a range only inside these bounds; outside them it does nothing — it waits, and says why:
 *
 * - **how narrow and how wide** — half the range's width, basis points of the price either way. The agent's narrowest
 *   range is the narrowest the person allowed, its widest the widest; nothing between is chosen outside them;
 * - **how often** — at least `minIntervalMs` between two moves, at most `maxShiftsPerDay` in any 24 hours;
 * - **what a move may cost** — the network, the priority and the rent the agent puts up for a new range, lamports, per
 *   move and per 24 hours. The agent pays them; the bound keeps a churning agent from burning them;
 * - **what a move may put back from the person's wallet** — of each of the pool's two coins, raw, per move and per 24
 *   hours. Zero on both coins is a keeper that only takes out: liquidity goes to the person's wallet, and putting it
 *   back is the person's own tap. Anything above zero is the person's spending approval on her own accounts — the
 *   token program holds its total, Ryntra's signer holds the per-move and per-day bounds (`keeperTermsOf` says which is
 *   which before the signature).
 *
 * What a move takes out of the pool is paid by the program into the person's own accounts only — whoever signs. That
 * is the program's rule, not a bound of this file: nothing here can widen it.
 *
 * Pure: no I/O, no clock, no environment.
 */

/** The narrowest half-width a person may allow: a tenth of a percent either way. */
export const RANGE_MIN_HALF_WIDTH_BPS = 10;
/** The widest: half the price either way. */
export const RANGE_MAX_HALF_WIDTH_BPS = 5_000;
/** The least time between two moves a person may allow. */
export const RANGE_MIN_INTERVAL_MS = 15 * 60_000;
/** The most moves in 24 hours a person may allow. */
export const RANGE_MAX_SHIFTS_PER_DAY = 24;

const DAY_MS = 86_400_000;

export type RawPair = Readonly<{ xRaw: string; yRaw: string }>;

export type RangeLimits = Readonly<{
  /** The narrowest range: half its width, basis points of the price either way. */
  narrowestBps: number;
  /** The widest range, the same way. */
  widestBps: number;
  /** At least this long between two moves, ms. */
  minIntervalMs: number;
  /** At most this many moves in any 24 hours. */
  maxShiftsPerDay: number;
  /** The most one move may cost the agent — network, priority, rent it puts up — lamports. */
  maxCostPerShiftLamports: number;
  /** The most the moves of any 24 hours may cost together, lamports. */
  maxCostPerDayLamports: number;
  /** The most one move may put back into the pool from the person's wallet, per coin, raw. */
  maxPutBackPerShift: RawPair;
  /** The most the moves of any 24 hours may put back together, per coin, raw. */
  maxPutBackPerDay: RawPair;
}>;

/** One move the agent made, as its book keeps it. Public data only. */
export type ShiftRecord = Readonly<{ at: number; costLamports: number; putBackXRaw: string; putBackYRaw: string }>;

/** A move the agent is about to make: the range it lays and what it costs. */
export type ShiftPlan = Readonly<{ halfWidthBps: number; costLamports: number; putBackXRaw: string; putBackYRaw: string }>;

/** Why a move is not made now — each a bound the person signed. */
export type ShiftRefusal = "too-narrow" | "too-wide" | "too-soon" | "too-many" | "cost-per-shift" | "cost-per-day" | "put-back-per-shift" | "put-back-per-day" | "bad-plan";

/** The keeper a person's bounds make: `pull` puts nothing back (it only takes out to the wallet), `shift` moves the money itself. */
export type KeeperMode = "pull" | "shift";

const RAW = /^(0|[1-9]\d{0,19})$/;
const MAX_U64 = (1n << 64n) - 1n;
const isRaw = (value: unknown): value is string => typeof value === "string" && RAW.test(value) && BigInt(value) <= MAX_U64;
const isCount = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/** Why the bounds are not ones the agent works within; null when they are. */
export function rangeLimitsRefusal(limits: RangeLimits): string | null {
  if (!isCount(limits.narrowestBps, RANGE_MIN_HALF_WIDTH_BPS, RANGE_MAX_HALF_WIDTH_BPS)) return `the narrowest range is ${RANGE_MIN_HALF_WIDTH_BPS} to ${RANGE_MAX_HALF_WIDTH_BPS} bps either way`;
  if (!isCount(limits.widestBps, RANGE_MIN_HALF_WIDTH_BPS, RANGE_MAX_HALF_WIDTH_BPS)) return `the widest range is ${RANGE_MIN_HALF_WIDTH_BPS} to ${RANGE_MAX_HALF_WIDTH_BPS} bps either way`;
  if (limits.narrowestBps > limits.widestBps) return "the narrowest range is not wider than the widest";
  if (!isCount(limits.minIntervalMs, RANGE_MIN_INTERVAL_MS, DAY_MS)) return "the time between two moves is a quarter of an hour to a day";
  if (!isCount(limits.maxShiftsPerDay, 1, RANGE_MAX_SHIFTS_PER_DAY)) return `a day holds 1 to ${RANGE_MAX_SHIFTS_PER_DAY} moves`;
  if (!isCount(limits.maxCostPerShiftLamports, 1, Number.MAX_SAFE_INTEGER) || !isCount(limits.maxCostPerDayLamports, 1, Number.MAX_SAFE_INTEGER)) return "what a move costs is bounded by a whole number of lamports";
  if (limits.maxCostPerDayLamports < limits.maxCostPerShiftLamports) return "a day's cost bound is not below one move's";
  const shift = limits.maxPutBackPerShift;
  const day = limits.maxPutBackPerDay;
  if (!isRaw(shift?.xRaw) || !isRaw(shift?.yRaw) || !isRaw(day?.xRaw) || !isRaw(day?.yRaw)) return "what a move puts back is a raw amount of each coin";
  if (BigInt(day.xRaw) < BigInt(shift.xRaw) || BigInt(day.yRaw) < BigInt(shift.yRaw)) return "a day's put-back bound is not below one move's";
  return null;
}

/** The keeper the bounds make: nothing put back on either coin — it only takes out. */
export function keeperModeOf(limits: Pick<RangeLimits, "maxPutBackPerShift">): KeeperMode {
  return BigInt(limits.maxPutBackPerShift.xRaw) === 0n && BigInt(limits.maxPutBackPerShift.yRaw) === 0n ? "pull" : "shift";
}

/** The moves of the 24 hours up to `now`. */
const dayOf = (history: readonly ShiftRecord[], now: number) => history.filter((entry) => entry.at <= now && now - entry.at < DAY_MS);

/** Whether a move may be made now at all — the time since the last and the count of the day; null when it may. */
export function shiftTimingRefusal(limits: Pick<RangeLimits, "minIntervalMs" | "maxShiftsPerDay">, history: readonly ShiftRecord[], now: number): "too-soon" | "too-many" | null {
  const last = history.reduce<number | null>((latest, entry) => (entry.at <= now && (latest === null || entry.at > latest) ? entry.at : latest), null);
  if (last !== null && now - last < limits.minIntervalMs) return "too-soon";
  if (dayOf(history, now).length >= limits.maxShiftsPerDay) return "too-many";
  return null;
}

/** Whether a half-width is one the person allowed. */
export function widthRefusal(limits: Pick<RangeLimits, "narrowestBps" | "widestBps">, halfWidthBps: number): "too-narrow" | "too-wide" | null {
  if (halfWidthBps < limits.narrowestBps) return "too-narrow";
  if (halfWidthBps > limits.widestBps) return "too-wide";
  return null;
}

/** Whether a built move is one the person's bounds let the agent sign now; null when it is. */
export function shiftRefusal(limits: RangeLimits, plan: ShiftPlan, history: readonly ShiftRecord[], now: number): ShiftRefusal | null {
  if (!Number.isFinite(plan.halfWidthBps) || !isCount(plan.costLamports, 0, Number.MAX_SAFE_INTEGER) || !isRaw(plan.putBackXRaw) || !isRaw(plan.putBackYRaw)) return "bad-plan";
  const width = widthRefusal(limits, plan.halfWidthBps);
  if (width) return width;
  const timing = shiftTimingRefusal(limits, history, now);
  if (timing) return timing;
  if (plan.costLamports > limits.maxCostPerShiftLamports) return "cost-per-shift";
  const day = dayOf(history, now);
  if (day.reduce((sum, entry) => sum + entry.costLamports, 0) + plan.costLamports > limits.maxCostPerDayLamports) return "cost-per-day";
  const x = BigInt(plan.putBackXRaw);
  const y = BigInt(plan.putBackYRaw);
  if (x > BigInt(limits.maxPutBackPerShift.xRaw) || y > BigInt(limits.maxPutBackPerShift.yRaw)) return "put-back-per-shift";
  const dayX = day.reduce((sum, entry) => sum + BigInt(entry.putBackXRaw), 0n);
  const dayY = day.reduce((sum, entry) => sum + BigInt(entry.putBackYRaw), 0n);
  if (dayX + x > BigInt(limits.maxPutBackPerDay.xRaw) || dayY + y > BigInt(limits.maxPutBackPerDay.yRaw)) return "put-back-per-day";
  return null;
}

/* ------------------------------------------------------------------ a range as the keeper reads it */

export type LiveRange = Readonly<{ centerPrice: number; halfWidthBps: number; lowerPrice: number; upperPrice: number }>;

/** A range of prices as its centre — the geometric middle — and its half-width in basis points; null for no range. */
export function liveRangeOf(lowerPrice: number, upperPrice: number): LiveRange | null {
  if (!(lowerPrice > 0) || !(upperPrice > lowerPrice) || !Number.isFinite(upperPrice)) return null;
  const ratio = Math.sqrt(upperPrice / lowerPrice);
  return { centerPrice: lowerPrice * ratio, halfWidthBps: Math.round((ratio - 1) * 10_000), lowerPrice, upperPrice };
}

/** The ends of a range of `halfWidthBps` around `centerPrice`: the same ratio above and below. */
export function rangeAround(centerPrice: number, halfWidthBps: number): Readonly<{ lowerPrice: number; upperPrice: number }> {
  const ratio = 1 + halfWidthBps / 10_000;
  return { lowerPrice: centerPrice / ratio, upperPrice: centerPrice * ratio };
}

/* ------------------------------------------------------------------ what the person reads before the signature */

/** Who holds a bound: the program itself (nothing the agent's key does gets past it) or Ryntra's signer (the key's second lock). */
export type HeldBy = "program" | "token-program" | "ryntra-signer";

export type KeeperTerms = Readonly<{
  mode: KeeperMode;
  /** What the agent may do with the position, each with who holds it. */
  may: readonly Readonly<{ what: "collect-fees" | "take-out-to-wallet" | "move-range" | "put-back-from-wallet"; heldBy: HeldBy }>[];
  /** What it may not — and who holds that. */
  mayNot: readonly Readonly<{ what: "pay-anyone-but-the-owner" | "lock-or-close" | "trade" | "range-outside-bounds" | "put-back-over-bounds"; heldBy: HeldBy }>[];
  /** The person's spending approval on her own accounts, raw, per coin: the token program holds its total. Null for a keeper that only takes out. */
  approval: RawPair | null;
  /** Of that approval, the one risk the program does not hold: the agent's key could spend it outside the pool. Ryntra's signer never signs that. */
  approvalOutsideThePool: boolean;
  narrowestBps: number;
  widestBps: number;
  maxShiftsPerDay: number;
}>;

/**
 * What the agent may and may not do, and who holds each — the data of the one line before the signature, the details
 * behind its «i». `approval` — the spending approval the person signs with it (a keeper that puts back needs one).
 */
export function keeperTermsOf(limits: RangeLimits, approval: RawPair | null): KeeperTerms {
  const mode = keeperModeOf(limits);
  const shifts = mode === "shift";
  return {
    mode,
    may: [
      { what: "collect-fees", heldBy: "program" },
      { what: "take-out-to-wallet", heldBy: "program" },
      ...(shifts ? ([{ what: "move-range", heldBy: "ryntra-signer" }, { what: "put-back-from-wallet", heldBy: "token-program" }] as const) : []),
    ],
    mayNot: [
      { what: "pay-anyone-but-the-owner", heldBy: "program" },
      { what: "lock-or-close", heldBy: "program" },
      { what: "trade", heldBy: "program" },
      { what: "range-outside-bounds", heldBy: "ryntra-signer" },
      ...(shifts ? ([{ what: "put-back-over-bounds", heldBy: "ryntra-signer" }] as const) : []),
    ],
    approval: shifts ? approval : null,
    approvalOutsideThePool: shifts && approval !== null && (BigInt(approval.xRaw) > 0n || BigInt(approval.yRaw) > 0n),
    narrowestBps: limits.narrowestBps,
    widestBps: limits.widestBps,
    maxShiftsPerDay: limits.maxShiftsPerDay,
  };
}

export type CoinWords = Readonly<{ symbol: string; decimals: number }>;

/** A raw amount as a person reads it: whole coins, no trailing zeros. */
export function wholeOf(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${value / unit}.${fraction}` : `${value / unit}`;
}

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/**
 * The one line before the signature — what the agent does, that the money goes only to the person, and, for a keeper
 * that puts back, that the bound on her approval is Ryntra's to hold, not the program's — in the person's language.
 * The details, and who holds each bound, live behind its «i» (`keeperTermsOf`).
 */
export function keeperLine(terms: KeeperTerms, coins: Readonly<{ x: CoinWords; y: CoinWords }>, lang: "en" | "uk"): string {
  const narrow = pct(terms.narrowestBps);
  const wide = pct(terms.widestBps);
  /* A keeper that only takes out lays no range: what it does is take out a range narrower than the night's. */
  if (terms.mode === "pull") {
    return lang === "uk"
      ? `Перед закриттям біржі (коли діапазон вужчий за ±${wide}) і перед дивідендами агент виводить гроші лише на твій гаманець. Покласти назад — твій дотик. Зупинити — будь-коли.`
      : `Before the close (where the range is narrower than ±${wide}) and before dividends, the agent takes the money out — only to your wallet. Putting it back is your tap. Stop any time.`;
  }
  const approval = terms.approval ?? { xRaw: "0", yRaw: "0" };
  const allowed = `${wholeOf(approval.xRaw, coins.x.decimals)} ${coins.x.symbol} · ${wholeOf(approval.yRaw, coins.y.decimals)} ${coins.y.symbol}`;
  return lang === "uk"
    ? `Агент тримає ±${narrow} біля ціни, поки біржа відкрита, і ±${wide}, коли закрита, — до ${terms.maxShiftsPerDay} зсувів на добу. Знімає лише на твій гаманець; з гаманця кладе назад у цей пул не більше ${allowed} — цю межу тримає Ryntra. Зупинити — будь-коли.`
    : `The agent keeps ±${narrow} around the price while the exchange is open and ±${wide} while it is closed — at most ${terms.maxShiftsPerDay} moves a day. It takes out only to your wallet; from it, it puts back into this pool no more than ${allowed} — Ryntra holds that bound. Stop any time.`;
}
