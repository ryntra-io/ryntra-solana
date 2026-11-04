/*
 * Constructed markets for the weather's and the backtest's tests: hourly bars, a seeded generator, so a test reads the
 * same candles every run. Not market data — shapes a reading must tell apart.
 */

const HOUR = 3_600_000;
export const START = Date.parse("2026-09-01T00:00:00.000Z");

/** Mulberry32: a small seeded generator. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Bars from a path of closes: each opens at the last close, its wicks a little beyond both. */
export function fromCloses(closes, wick = 0.002, seed = 7) {
  const random = seeded(seed);
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const h = Math.max(o, c) * (1 + wick * random());
    const l = Math.min(o, c) * (1 - wick * random());
    return { t: START + i * HOUR, o, h, l, c };
  });
}

export function trendCandles(direction, bars = 300) {
  const random = seeded(11);
  const step = direction === "up" ? 0.004 : -0.004;
  const closes = [];
  let price = 200;
  for (let i = 0; i < bars; i += 1) {
    price *= 1 + step + (random() - 0.5) * 0.004;
    closes.push(price);
  }
  return fromCloses(closes);
}

/** A quick wave of ±1 % around 200 with as much noise again: no leg lasts long enough to be a trend. */
export function rangeCandles(bars = 300) {
  const random = seeded(23);
  const closes = Array.from({ length: bars }, (_, i) => 200 * (1 + 0.01 * Math.sin((2 * Math.PI * i) / 10) + (random() - 0.5) * 0.02));
  return fromCloses(closes, 0.004);
}

/** Calm, then the last fifty bars swing hard both ways without a direction. */
export function chopCandles(bars = 300) {
  const random = seeded(31);
  const closes = [];
  let price = 200;
  for (let i = 0; i < bars; i += 1) {
    const late = i >= bars - 50;
    price = late ? 200 * (1 + (i % 2 === 0 ? 1 : -1) * (0.03 + 0.03 * random())) : 200 * (1 + (random() - 0.5) * 0.004);
    closes.push(price);
  }
  return fromCloses(closes, 0.004);
}

/** A straight line between two prices, for the simulation's exact cases. */
export function linePath(from, to, bars) {
  return fromCloses(Array.from({ length: bars }, (_, i) => from + ((to - from) * i) / (bars - 1)), 0);
}
