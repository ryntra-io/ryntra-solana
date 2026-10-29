/**
 * "In the pool or just holding": what a deposit would be worth after the price
 * moves, against the same two tokens kept in the wallet — before any fee the
 * pool earns. The difference is what fees must cover to break even; the page
 * shows that sum and never a projected income, because what a pool earns
 * depends on trades nobody has made yet.
 *
 * Prices are Y per one X; values come out in Y. Floats are fine here: this is
 * a picture for reading, never a sum a transaction is sized from.
 *
 * Two shapes, as the venues hold liquidity:
 * - DLMM bins. Each bin trades at its own price and holds one token on each
 *   side of the price: as the price rises through a bin, its X is sold for Y
 *   at that bin's price; as it falls, its Y buys X. A spot deposit puts an
 *   equal value at today's price in every bin, the active bin half in each token.
 * - A constant-product range [min, max] (DAMM v2): the usual concentrated
 *   liquidity curve; no bounds is the plain curve.
 *
 * Pure.
 */

export type SimulationResult = Readonly<{
  /** The two tokens kept in the wallet, valued at the new price. */
  hold: number;
  /** The position at the new price, before fees. */
  pool: number;
  /** pool − hold: negative is what fees must cover to break even. */
  difference: number;
  /** difference over hold, percent. */
  differencePct: number;
  /** Fees needed to break even with holding; 0 when the pool is ahead. */
  breakEvenFees: number;
  /** The new price is inside the position: it keeps earning. */
  inRange: boolean;
  /** What the position holds at the new price, in X and in Y. */
  holds: Readonly<{ x: number; y: number }>;
}>;

const result = (hold: number, x: number, y: number, price: number, inRange: boolean): SimulationResult => {
  const pool = x * price + y;
  const difference = pool - hold;
  return {
    hold,
    pool,
    difference,
    differencePct: hold > 0 ? (difference / hold) * 100 : 0,
    breakEvenFees: difference < 0 ? -difference : 0,
    inRange,
    holds: { x, y },
  };
};

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

export type BinsInput = Readonly<{
  /** The pool's bin step, basis points. */
  binStepBps: number;
  /** The price now: the active bin's. */
  price: number;
  /** The price the person tries. */
  nextPrice: number;
  /** Bins below and above the active one, each ≥ 0. */
  below: number;
  above: number;
  /** The deposit's value in Y at the price now. */
  value: number;
}>;

/** A spot deposit spread over bins around the price, walked to a new price bin by bin. */
export function simulateBins(input: BinsInput): SimulationResult | null {
  const { binStepBps, price, nextPrice, value } = input;
  const below = Math.floor(input.below);
  const above = Math.floor(input.above);
  if (!positive(binStepBps) || !positive(price) || !positive(nextPrice) || !positive(value) || below < 0 || above < 0) return null;
  const step = 1 + binStepBps / 10_000;
  const bins = below + above + 1;
  const perBin = value / bins;
  let x0 = 0;
  let y0 = 0;
  let x = 0;
  let y = 0;
  for (let i = -below; i <= above; i += 1) {
    const binPrice = price * step ** i;
    if (i === 0) {
      /* The active bin: half in each token; the price leaving it either way converts the rest. */
      const half = perBin / 2;
      x0 += half / price;
      y0 += half;
      if (nextPrice > binPrice) y += perBin;
      else if (nextPrice < binPrice) x += perBin / binPrice;
      else {
        x += half / price;
        y += half;
      }
    } else if (i > 0) {
      /* Equal value at the price now: the same deposit a person sizes in money, not in each bin's own price. */
      const units = perBin / price;
      x0 += units;
      if (nextPrice >= binPrice) y += units * binPrice;
      else x += units;
    } else {
      y0 += perBin;
      if (nextPrice <= binPrice) x += perBin / binPrice;
      else y += perBin;
    }
  }
  const low = price * step ** -below;
  const high = price * step ** above;
  return result(x0 * nextPrice + y0, x, y, nextPrice, nextPrice >= low && nextPrice <= high);
}

export type RangeInput = Readonly<{
  /** Lower and upper bound of the range; null — no bound (the plain curve). */
  min: number | null;
  max: number | null;
  price: number;
  nextPrice: number;
  value: number;
}>;

/** Token amounts per unit of liquidity at a price, for the range [a, b] in square-root prices. */
const amounts = (sqrtP: number, sqrtA: number, sqrtB: number): Readonly<{ x: number; y: number }> => {
  const s = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
  return { x: Number.isFinite(sqrtB) ? 1 / s - 1 / sqrtB : 1 / s, y: s - sqrtA };
};

/** A deposit on a constant-product range, moved to a new price. */
export function simulateRange(input: RangeInput): SimulationResult | null {
  const { price, nextPrice, value } = input;
  if (!positive(price) || !positive(nextPrice) || !positive(value)) return null;
  const min = input.min !== null && input.min > 0 ? input.min : 0;
  const max = input.max !== null && Number.isFinite(input.max) ? input.max : Infinity;
  if (min >= max) return null;
  const sqrtA = Math.sqrt(min);
  const sqrtB = Math.sqrt(max);
  const now = amounts(Math.sqrt(price), sqrtA, sqrtB);
  const perLiquidity = now.x * price + now.y;
  if (!positive(perLiquidity)) return null;
  const liquidity = value / perLiquidity;
  const then = amounts(Math.sqrt(nextPrice), sqrtA, sqrtB);
  const hold = liquidity * (now.x * nextPrice + now.y);
  return result(hold, liquidity * then.x, liquidity * then.y, nextPrice, nextPrice >= min && nextPrice <= max);
}

/** The price a move of `percent` lands on: −100 % and below have no price. */
export function movedPrice(price: number, percent: number): number | null {
  if (!positive(price) || !Number.isFinite(percent) || percent <= -100) return null;
  return price * (1 + percent / 100);
}

/** How far `bins` bins reach from the price, percent: up and down differ, because each bin is a step of a ratio. */
export function binsSpanPct(binStepBps: number, bins: number): Readonly<{ up: number; down: number }> {
  const step = 1 + binStepBps / 10_000;
  return { up: (step ** bins - 1) * 100, down: (1 - step ** -bins) * 100 };
}

/* ------------------------------------------------------------------ net of an LP position (SOL-2b) */

/** The standard normal's distribution function (Abramowitz–Stegun 7.1.26: within 1.5e-7, plenty for a picture). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * The share of `days` the price spends inside a range, on average, when it wanders without a trend at a daily
 * volatility: at each moment, the chance the log-price has moved less than the range's reach either way. `down` and
 * `up` are the reach in percent; null — no bound on that side.
 */
export function timeInRange(down: number | null, up: number | null, volatilityPct: number, days: number): number {
  if (down === null && up === null) return 1;
  if (!positive(volatilityPct) || !positive(days)) return 1;
  const low = down === null ? Infinity : down >= 100 ? Infinity : -Math.log(1 - down / 100);
  const high = up === null ? Infinity : Math.log(1 + Math.max(up, 0) / 100);
  const sigma = volatilityPct / 100;
  const STEPS = 40;
  let sum = 0;
  for (let i = 0; i < STEPS; i += 1) {
    const spread = sigma * Math.sqrt(((i + 0.5) / STEPS) * days);
    sum += normalCdf(high / spread) - normalCdf(-low / spread);
  }
  return sum / STEPS;
}

export type NetInput = Readonly<{
  /** The deposit, USD. */
  depositUsd: number;
  /** The pool's value, USD, before the deposit. */
  tvlUsd: number;
  /** What trades through the pool in a day, USD — the person's assumption, the past day's by default. */
  volumeUsdPerDay: number;
  /** The fee a trade pays, percent. */
  feePct: number;
  /** The pool's share of that fee that the protocol keeps, percent. */
  protocolSharePct: number;
  /** The price's typical daily move, percent. */
  volatilityPct: number;
  days: number;
  /** The network's fees to enter and to leave, USD. */
  gasUsd: number;
  /** What Ryntra takes when the position is entered, percent of the deposit. */
  ryntraEntryPct: number;
  /** The range's reach from the price, percent; null — no bound. */
  down: number | null;
  up: number | null;
  /** The position against holding after a price move of `percent`, USD, before fees (from `simulateBins`/`simulateRange`). */
  divergenceAt: (percent: number) => number | null;
}>;

export type NetScenario = Readonly<{
  /** The price's move over the period, percent. */
  movePct: number;
  divergence: number;
  /** fees − divergence loss − gas − Ryntra's entry share. */
  net: number;
}>;

export type NetResult = Readonly<{
  /** The deposit's share of the pool. */
  share: number;
  /** Of the period, the share the price stays inside the range, on average. */
  inRange: number;
  /** Fees the position would take over the period, USD — under the assumptions, never a promise. */
  fees: number;
  gas: number;
  ryntraEntry: number;
  /** A typical move down, no move, and a typical move up over the period. */
  scenarios: readonly [NetScenario, NetScenario, NetScenario];
}>;

/**
 * «Чистий дохід LP» under the person's own assumptions: fees as the deposit's share of the pool's trading, while the
 * price stays in the range; less what a typical move of the price takes against holding, the network's fees and
 * Ryntra's entry share. A share of the pool by TVL is the plain, cautious assumption: a narrow range usually takes a
 * larger share while the price is in it, and this does not count that — only that it earns nothing once the price
 * leaves (the time in range). Three outcomes, not one figure: what a pool earns depends on trades nobody has made yet.
 */
export function simulateNet(input: NetInput): NetResult | null {
  const { depositUsd, tvlUsd, volumeUsdPerDay, feePct, protocolSharePct, volatilityPct, days, gasUsd, ryntraEntryPct } = input;
  if (!positive(depositUsd) || !positive(days) || !Number.isFinite(tvlUsd) || tvlUsd < 0) return null;
  if (![volumeUsdPerDay, feePct, protocolSharePct, volatilityPct, gasUsd, ryntraEntryPct].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const share = depositUsd / (tvlUsd + depositUsd);
  const inRange = timeInRange(input.down, input.up, volatilityPct, days);
  const lpFee = (feePct / 100) * (1 - Math.min(protocolSharePct, 100) / 100);
  const fees = volumeUsdPerDay * lpFee * share * days * inRange;
  const ryntraEntry = depositUsd * (ryntraEntryPct / 100);
  const typical = (volatilityPct / 100) * Math.sqrt(days);
  const scenario = (movePct: number): NetScenario | null => {
    const divergence = movePct === 0 ? 0 : input.divergenceAt(movePct);
    if (divergence === null || !Number.isFinite(divergence)) return null;
    return { movePct, divergence, net: fees + divergence - gasUsd - ryntraEntry };
  };
  const down = scenario((Math.exp(-typical) - 1) * 100);
  const still = scenario(0);
  const up = scenario((Math.exp(typical) - 1) * 100);
  if (!down || !still || !up) return null;
  return { share, inRange, fees, gas: gasUsd, ryntraEntry, scenarios: [down, still, up] };
}
