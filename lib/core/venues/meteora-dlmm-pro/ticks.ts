/**
 * Prices and ticks of a DLMM Pro pool, as plain arithmetic.
 *
 * A pool's price is token Y atoms per token X atom, kept as a square root in Q64.64. Tick `i` is the price 1.0001^i;
 * a pool uses the ticks that are multiples of its tick spacing. What the program rounds — which tick a price falls on
 * — is the SDK's own `tickIdFromSqrtPrice`; here are only the conversions a caller needs before it has a pool: a
 * price a person names to a square-root price, a square-root price to a number to show, and a tick aligned to a
 * spacing.
 *
 * Pure: no I/O, no clock, no SDK.
 */

export const MIN_TICK_ID = -443_636;
export const MAX_TICK_ID = 443_636;
export const MAX_TICK_SPACING = 256;
/** A position holds at most this many ranges; a limit order at most `MAX_ORDER_TICKS` prices. */
export const MAX_POSITION_RANGES = 45;
export const MAX_ORDER_TICKS = 25;
/** A tick array holds this many ticks of the pool's spacing. */
export const TICKS_PER_ARRAY = 128;

const Q64 = 1n << 64n;

/** The integer square root, rounded down. */
export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("The square root of a negative number.");
  if (value < 2n) return value;
  let low = 1n << BigInt((value.toString(2).length - 1) >> 1);
  let high = low << 1n;
  while (low < high) {
    const middle = (low + high + 1n) >> 1n;
    if (middle * middle <= value) low = middle;
    else high = middle - 1n;
  }
  return low;
}

/**
 * The square-root price, Q64.64, of a price a person names — token Y per token X in whole tokens, as a plain decimal
 * string (`"0.000005"`, never an exponent) — rounded down.
 */
export function sqrtPriceX64OfPrice(price: string, decimalsX: number, decimalsY: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!match) throw new Error(`A price is a plain decimal number, not "${price}".`);
  const fraction = match[2] ?? "";
  let numerator = BigInt(match[1]! + fraction);
  let denominator = 10n ** BigInt(fraction.length);
  /* Whole tokens to atoms: Y atoms per X atom is the price times 10^(decimalsY − decimalsX). */
  if (decimalsY >= decimalsX) numerator *= 10n ** BigInt(decimalsY - decimalsX);
  else denominator *= 10n ** BigInt(decimalsX - decimalsY);
  if (numerator === 0n) throw new Error("A price is above zero.");
  return isqrt((numerator << 128n) / denominator);
}

/** A square-root price, Q64.64, as token Y per token X in whole tokens — a number to show, never to compute with. */
export function priceOfSqrtX64(sqrtPrice: bigint | string, decimalsX: number, decimalsY: number): number {
  const ratio = Number(BigInt(sqrtPrice)) / Number(Q64);
  return ratio * ratio * 10 ** (decimalsX - decimalsY);
}

/** The multiple of `tickSpacing` at or below `tickId` — the program's own alignment. */
export function alignTickDown(tickId: number, tickSpacing: number): number {
  return Math.floor(tickId / tickSpacing) * tickSpacing;
}

/** Whether a pool of this spacing can use the tick. */
export function isUsableTick(tickId: number, tickSpacing: number): boolean {
  return Number.isInteger(tickSpacing) && tickSpacing >= 1 && tickSpacing <= MAX_TICK_SPACING && Number.isInteger(tickId) && tickId >= MIN_TICK_ID && tickId <= MAX_TICK_ID && tickId % tickSpacing === 0;
}

/** The index of the tick array that holds a tick: the tick over the spacing, over 128, each rounded down. */
export function tickArrayIndexOf(tickId: number, tickSpacing: number): number {
  return Math.floor(Math.floor(tickId / tickSpacing) / TICKS_PER_ARRAY);
}

/**
 * How many new ticks one instruction may add to one tick array: the program grows an account by at most 10 240 bytes
 * in an instruction — 64 ticks, 53 on a pool with liquidity mining (its ticks are longer), one fewer when the same
 * instruction also creates the array.
 */
export function newTicksPerInstruction(liquidityMining: boolean): number {
  return liquidityMining ? 52 : 63;
}

/**
 * Ranges split so that no one instruction adds more new ticks to one tick array than the program lets it: the first
 * group opens the position, each next one widens it. `existing` are the ticks the pool already has, which cost no
 * growth. Order is kept — a position's slots are its ranges in the order they were given.
 */
export function splitRangesForGrowth(
  ranges: readonly Readonly<{ tickLowerId: number; tickUpperId: number }>[],
  tickSpacing: number,
  liquidityMining: boolean,
  existing: ReadonlySet<number> = new Set(),
): readonly (readonly Readonly<{ tickLowerId: number; tickUpperId: number }>[])[] {
  const limit = newTicksPerInstruction(liquidityMining);
  const known = new Set(existing);
  const groups: Readonly<{ tickLowerId: number; tickUpperId: number }>[][] = [];
  let group: Readonly<{ tickLowerId: number; tickUpperId: number }>[] = [];
  let perArray = new Map<number, number>();
  for (const range of ranges) {
    const fresh = [...new Set([range.tickLowerId, range.tickUpperId])].filter((tick) => !known.has(tick));
    const wants = new Map<number, number>();
    for (const tick of fresh) wants.set(tickArrayIndexOf(tick, tickSpacing), (wants.get(tickArrayIndexOf(tick, tickSpacing)) ?? 0) + 1);
    const overflows = [...wants].some(([index, count]) => (perArray.get(index) ?? 0) + count > limit);
    if (overflows && group.length > 0) {
      groups.push(group);
      group = [];
      perArray = new Map();
    }
    group.push(range);
    for (const [index, count] of wants) perArray.set(index, (perArray.get(index) ?? 0) + count);
    for (const tick of fresh) known.add(tick);
  }
  if (group.length > 0) groups.push(group);
  return groups;
}
