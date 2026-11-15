/**
 * A DLMM Pro pool's fee, as plain numbers.
 *
 * The fee of a swap is two parts over a denominator of a billion, capped at 99 %:
 *
 * - the **base fee** — fixed, or a schedule that falls from a cliff: by time since the pool opened, or by how far the
 *   price has risen above the pool's first price (the «market cap» scheduler, the anti-sniper fee that comes back when
 *   the price falls back). The pool keeps it as a mode and 31 bytes; `decodeBaseFee` reads them by the layout the
 *   program documents, and `basePeriodOf` says which step of the schedule a moment and a price are on;
 * - the **dynamic fee** — a fee from volatility: how many ten-thousandths of a tick the price stands away from a
 *   reference the pool keeps, squared, times the pool's control. `variableFeeNumeratorNow` is the program's own
 *   arithmetic for the swap that would land now (`update_references`, then `update_volatility_accumulator`), which the
 *   SDK computes inside its quote and does not export.
 *
 * What the base fee is *now* is the SDK's own `getBaseFeeNumerator` (its exponent is a Q64 power no caller should
 * re-derive): `./pools.server.ts` asks it and adds the dynamic part from here. `./fee.test.mjs` and
 * `./sdk-compare.test.mjs` hold this file to the SDK and to the quotes it gives.
 *
 * Pure: no I/O, no clock, no SDK. Amounts are `bigint`.
 */

export const FEE_DENOMINATOR = 1_000_000_000n;
/** 99 % — the most a swap's fee can be. */
export const MAX_FEE_NUMERATOR = 990_000_000n;
/** 0.01 % — the least a base fee, or a schedule's last step, can be. */
export const MIN_FEE_NUMERATOR = 100_000n;
export const MAX_BASIS_POINT = 10_000n;
/** A dynamic fee's reference older than this many seconds starts again. */
export const MAX_REFERENCE_AGE_SECONDS = 3_600n;

const U128_MAX = (1n << 128n) - 1n;

export const BASE_FEE_MODES = ["fixed", "timeLinear", "timeExponential", "marketCapLinear", "marketCapExponential"] as const;
export type BaseFeeMode = (typeof BASE_FEE_MODES)[number];

export type BaseFeeSchedule =
  | Readonly<{ kind: "fixed"; mode: "fixed"; cliffNumerator: bigint }>
  | Readonly<{
      kind: "time";
      mode: "timeLinear" | "timeExponential";
      cliffNumerator: bigint;
      /** Slots or seconds — the pool's activation unit — one step lasts. */
      periodFrequency: bigint;
      /** Linear: the numerator taken off per step. Exponential: basis points taken off per step. */
      reductionFactor: bigint;
      periods: number;
    }>
  | Readonly<{
      kind: "marketCap";
      mode: "marketCapLinear" | "marketCapExponential";
      cliffNumerator: bigint;
      reductionFactor: bigint;
      /** How far the square-root price must rise above the pool's first, in basis points, for one step. */
      sqrtPriceStepBps: number;
      /** Slots or seconds after the pool opens when the fee settles whatever the price. */
      expirationDuration: number;
      periods: number;
    }>;

const u64At = (data: Uint8Array, offset: number): bigint => Buffer.from(data.buffer, data.byteOffset + offset, 8).readBigUInt64LE(0);
const u32At = (data: Uint8Array, offset: number): number => Buffer.from(data.buffer, data.byteOffset + offset, 4).readUInt32LE(0);
const u16At = (data: Uint8Array, offset: number): number => Buffer.from(data.buffer, data.byteOffset + offset, 2).readUInt16LE(0);

/** The base fee a pool keeps — its mode byte and its 31 bytes — as a schedule. Throws on a mode the release does not have. */
export function decodeBaseFee(modeByte: number, raw: ArrayLike<number>): BaseFeeSchedule {
  const mode = BASE_FEE_MODES[modeByte];
  if (!mode) throw new Error(`Unknown base fee mode ${modeByte}.`);
  if (raw.length !== 31) throw new Error(`A base fee is 31 bytes, not ${raw.length}.`);
  const data = Uint8Array.from(raw);
  const cliffNumerator = u64At(data, 0);
  if (mode === "fixed") return { kind: "fixed", mode, cliffNumerator };
  if (mode === "timeLinear" || mode === "timeExponential") {
    return { kind: "time", mode, cliffNumerator, periodFrequency: u64At(data, 8), reductionFactor: u64At(data, 16), periods: u16At(data, 24) };
  }
  return { kind: "marketCap", mode, cliffNumerator, reductionFactor: u64At(data, 8), sqrtPriceStepBps: u32At(data, 16), expirationDuration: u32At(data, 20), periods: u16At(data, 24) };
}

/**
 * Which step of its schedule a pool is on: zero is the cliff, `periods` the settled fee. Before the pool opens the
 * program reads the settled fee, so the whitelisted wallet's first swap is not charged the anti-sniper cliff; a market
 * cap schedule settles for good once its time runs out, and is back at the cliff whenever the price is at or below the
 * pool's first price.
 */
export function basePeriodOf(
  schedule: BaseFeeSchedule,
  at: Readonly<{ point: bigint; activationPoint: bigint; initSqrtPrice: bigint; sqrtPrice: bigint }>,
): number {
  if (schedule.kind === "fixed") return 0;
  if (at.point < at.activationPoint) return schedule.periods;
  if (schedule.kind === "time") {
    if (schedule.periodFrequency === 0n) return schedule.periods;
    const passed = (at.point - at.activationPoint) / schedule.periodFrequency;
    return passed > BigInt(schedule.periods) ? schedule.periods : Number(passed);
  }
  if (at.point > at.activationPoint + BigInt(schedule.expirationDuration)) return schedule.periods;
  if (at.sqrtPrice <= at.initSqrtPrice || at.initSqrtPrice === 0n || schedule.sqrtPriceStepBps === 0) return 0;
  const passed = ((at.sqrtPrice - at.initSqrtPrice) * MAX_BASIS_POINT) / at.initSqrtPrice / BigInt(schedule.sqrtPriceStepBps);
  return passed > BigInt(schedule.periods) ? schedule.periods : Number(passed);
}

/**
 * The square-root price at which a market cap schedule reaches step `period`: the lowest price that reads as that
 * step. Null for any other schedule.
 */
export function sqrtPriceOfPeriod(schedule: BaseFeeSchedule, initSqrtPrice: bigint, period: number): bigint | null {
  if (schedule.kind !== "marketCap") return null;
  const steps = BigInt(period) * BigInt(schedule.sqrtPriceStepBps);
  /* The least s with floor((s - init) * 10000 / init) >= steps. */
  const lift = (steps * initSqrtPrice + MAX_BASIS_POINT - 1n) / MAX_BASIS_POINT;
  return initSqrtPrice + lift;
}

export type DynamicFeeConfig = Readonly<{
  /** False: the pool has no dynamic fee, and the variable part is always zero. */
  initialized: boolean;
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
}>;

export type VariableFeeState = Readonly<{
  sqrtPriceReference: bigint;
  lastSignificantSwapTimestamp: bigint;
  lastReferenceTimestamp: bigint;
  volatilityAccumulator: number;
  volatilityReference: number;
}>;

/** The program's tick distance between two square-root prices: `higher × 20 000 / lower − 20 000`, never below zero. */
function deltaTick(sqrtPriceA: bigint, sqrtPriceB: bigint): bigint {
  const [upper, lower] = sqrtPriceA > sqrtPriceB ? [sqrtPriceA, sqrtPriceB] : [sqrtPriceB, sqrtPriceA];
  if (lower === 0n) throw new Error("A square-root price is zero.");
  let product = upper * (MAX_BASIS_POINT * 2n);
  if (product > U128_MAX) product = U128_MAX;
  const delta = product / lower - MAX_BASIS_POINT * 2n;
  return delta < 0n ? 0n : delta;
}

/** The variable fee's numerator at a volatility: `control × volatility² / 10¹¹`, rounded up. */
export function variableFeeNumeratorOf(variableFeeControl: number, volatilityAccumulator: number): bigint {
  const square = BigInt(volatilityAccumulator) * BigInt(volatilityAccumulator);
  return (BigInt(variableFeeControl) * square + 99_999_999_999n) / 100_000_000_000n;
}

/**
 * The volatility a swap landing at `now` (unix seconds — the dynamic fee always counts in seconds) starts with, and its
 * variable fee: the references move first — reset when older than an hour, kept inside the filter period, decayed
 * between the filter and the decay periods, forgotten after — and the accumulator is the distance of the pool's price
 * from the reference on top of what was remembered, capped.
 */
export function variableFeeNow(
  config: DynamicFeeConfig,
  state: VariableFeeState,
  sqrtPrice: bigint,
  now: bigint,
): Readonly<{ numerator: bigint; volatilityAccumulator: number; volatilityReference: number; sqrtPriceReference: bigint }> {
  if (!config.initialized) return { numerator: 0n, volatilityAccumulator: 0, volatilityReference: 0, sqrtPriceReference: state.sqrtPriceReference };
  let sqrtPriceReference = state.sqrtPriceReference;
  let volatilityReference = state.volatilityReference;
  const since = (earlier: bigint) => (now > earlier ? now - earlier : 0n);
  if (since(state.lastReferenceTimestamp) > MAX_REFERENCE_AGE_SECONDS) {
    sqrtPriceReference = sqrtPrice;
    volatilityReference = 0;
  } else {
    const latest = state.lastReferenceTimestamp > state.lastSignificantSwapTimestamp ? state.lastReferenceTimestamp : state.lastSignificantSwapTimestamp;
    const elapsed = since(latest);
    if (elapsed >= BigInt(config.filterPeriod)) {
      sqrtPriceReference = sqrtPrice;
      volatilityReference = elapsed < BigInt(config.decayPeriod) ? Number((BigInt(state.volatilityAccumulator) * BigInt(config.reductionFactor)) / MAX_BASIS_POINT) : 0;
    }
  }
  const raw = deltaTick(sqrtPrice, sqrtPriceReference) * MAX_BASIS_POINT + BigInt(volatilityReference);
  const volatilityAccumulator = raw > BigInt(config.maxVolatilityAccumulator) ? config.maxVolatilityAccumulator : Number(raw);
  return { numerator: variableFeeNumeratorOf(config.variableFeeControl, volatilityAccumulator), volatilityAccumulator, volatilityReference, sqrtPriceReference };
}

/** The most a pool's variable fee can be: at the accumulator's cap. */
export function variableFeeCeiling(config: DynamicFeeConfig): bigint {
  return config.initialized ? variableFeeNumeratorOf(config.variableFeeControl, config.maxVolatilityAccumulator) : 0n;
}

/** Base and variable together, capped at 99 %. */
export function totalFeeNumerator(baseNumerator: bigint, variableNumerator: bigint): bigint {
  const total = baseNumerator + variableNumerator;
  return total > MAX_FEE_NUMERATOR ? MAX_FEE_NUMERATOR : total;
}

/** A numerator in basis points, to two decimals: 10 000 000 → 100 (1 %). */
export function feeBpsOf(numerator: bigint): number {
  return Number((numerator * 1_000_000n) / FEE_DENOMINATOR) / 100;
}

/**
 * Who gets a swap's fee, as the program's constants say (Meteora's rule, not Ryntra's): of what liquidity filled, the
 * protocol takes 10 % (20 % in a launch pool); of what limit orders filled, half. A referral token account passed with
 * the swap is paid a fifth of the protocol's rate on liquidity taken over the swap's whole fee — the orders' part too,
 * so 4 % of the fee in a launch pool and 2 % elsewhere — out of the protocol's share; and a pool's partner —
 * dynamic-config pools only — its share of the rest. `./fee.test.mjs` holds each number to the SDK's own.
 */
export const FEE_SHARES = Object.freeze({
  protocolOfLiquidityBps: 1_000,
  protocolOfLiquidityLaunchBps: 2_000,
  protocolOfOrdersBps: 5_000,
  referralOfProtocolBps: 2_000,
  /** A referral wallet named on a limit order takes this share of the maker's fee when the order is collected. */
  referralOfOrderFeeBps: 2_000,
  partnerOfProtocolCeilingBps: 5_000,
});
