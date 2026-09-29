// Run from repo root: node --test lib/chart/indicators/calc.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sma,
  ema,
  wma,
  bollinger,
  vwap,
  rsi,
  macd,
  atr,
  volumeHistogram,
  hasVolume,
} from "./calc.ts";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

/** Build a candle. Defaults: open=close, high/low tight around body. */
function mk(time, c, extra = {}) {
  const open = extra.open ?? c;
  return {
    time,
    open,
    high: extra.high ?? Math.max(open, c),
    low: extra.low ?? Math.min(open, c),
    close: c,
    volume: extra.volume,
  };
}

const fromCloses = (closes, t0 = 1000, step = 60) =>
  closes.map((c, i) => mk(t0 + i * step, c));

// Hand-computed 10-candle fixture used by SMA/EMA/WMA tests.
const CLOSES10 = [10, 11, 13, 12, 14, 16, 15, 17, 18, 20];
const C10 = fromCloses(CLOSES10);

test("sma: exact rolling values, times aligned to candles", () => {
  const out = sma(C10, 3);
  assert.equal(out.length, 8);
  const expected = [34 / 3, 12, 13, 14, 15, 16, 50 / 3, 55 / 3];
  out.forEach((p, i) => {
    assert.equal(p.time, C10[i + 2].time);
    close(p.value, expected[i]);
  });
});

test("ema: SMA seed then k=2/(period+1), exact hand-derived values", () => {
  const out = ema(C10, 3);
  assert.equal(out.length, 8);
  // seed = (10+11+13)/3, then each = 0.5*close + 0.5*prev
  const expected = [34 / 3, 35 / 3, 77 / 6, 173 / 12, 353 / 24, 761 / 48, 1625 / 96, 3545 / 192];
  out.forEach((p, i) => {
    assert.equal(p.time, C10[i + 2].time);
    close(p.value, expected[i]);
  });
});

test("ema seed equals SMA of first N closes", () => {
  for (const period of [2, 3, 5, 10]) {
    const e = ema(C10, period);
    const s = sma(C10, period);
    assert.equal(e[0].time, s[0].time);
    close(e[0].value, s[0].value);
  }
});

test("wma: linear weights", () => {
  const out = wma(fromCloses([1, 2, 3]), 3);
  assert.equal(out.length, 1);
  close(out[0].value, (1 * 1 + 2 * 2 + 3 * 3) / 6); // 7/3
});

test("rsi-14: hand-derived Wilder values", () => {
  // 15 closes alternating +1/-1 (7 gains, 7 losses of 1) -> avgGain=avgLoss=0.5 -> RSI 50.
  // 16th close +2: avgGain=(0.5*13+2)/14, avgLoss=(0.5*13)/14 -> RS=17/13 -> RSI=170/3.
  const closes = [100];
  for (let i = 0; i < 14; i++) closes.push(closes[closes.length - 1] + (i % 2 === 0 ? 1 : -1));
  closes.push(closes[closes.length - 1] + 2);
  const c = fromCloses(closes);
  const out = rsi(c, 14);
  assert.equal(out.length, 2);
  assert.equal(out[0].time, c[14].time);
  close(out[0].value, 50);
  close(out[1].value, 170 / 3);
});

test("rsi: monotonic rising series pins at 100", () => {
  const c = fromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));
  const out = rsi(c, 14);
  assert.equal(out.length, 6);
  for (const p of out) close(p.value, 100);
});

test("macd: hist = macd - signal pointwise, aligned to signal availability", () => {
  // Deterministic pseudo-random walk, 60 bars.
  const closes = [];
  let v = 100;
  for (let i = 0; i < 60; i++) {
    v += Math.sin(i * 1.7) * 2 + (i % 5) - 2;
    closes.push(v);
  }
  const c = fromCloses(closes);
  const { macd: m, signal: s, hist: h } = macd(c, 12, 26, 9);
  assert.equal(m.length, 60 - 26 + 1);
  assert.equal(m[0].time, c[25].time);
  assert.equal(s.length, m.length - 9 + 1);
  assert.equal(h.length, s.length);
  const bySlice = m.slice(m.length - s.length);
  h.forEach((p, i) => {
    assert.equal(p.time, s[i].time);
    assert.equal(bySlice[i].time, s[i].time);
    close(p.value, bySlice[i].value - s[i].value);
  });
});

test("atr: gap fixture with Wilder smoothing", () => {
  const c = [
    mk(1000, 11, { open: 11, high: 12, low: 10 }), // TR = 2
    mk(1060, 14, { open: 14, high: 15, low: 13 }), // TR = max(2, |15-11|, |13-11|) = 4
    mk(1120, 8, { open: 8, high: 9, low: 7 }), //     TR = max(2, |9-14|, |7-14|) = 7
  ];
  const out = atr(c, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].time, 1060);
  close(out[0].value, 3); // (2+4)/2
  close(out[1].value, 5); // (3*1+7)/2
});

test("bollinger: population std dev (not sample)", () => {
  // Classic set: mean 5, population sd exactly 2 (sample sd would be ~2.138).
  const c = fromCloses([2, 4, 4, 4, 5, 5, 7, 9]);
  const { basis, upper, lower } = bollinger(c, 8, 2);
  assert.equal(basis.length, 1);
  close(basis[0].value, 5);
  close(upper[0].value, 9);
  close(lower[0].value, 1);
});

test("vwap: resets at UTC day boundary", () => {
  const c = [
    mk(0, 10, { high: 10, low: 10, volume: 100 }),
    mk(3600, 20, { high: 20, low: 20, volume: 100 }),
    mk(86400, 30, { high: 30, low: 30, volume: 50 }),
    mk(90000, 10, { high: 10, low: 10, volume: 150 }),
  ];
  const out = vwap(c);
  assert.equal(out.length, 4);
  close(out[0].value, 10);
  close(out[1].value, 15); // (10*100+20*100)/200
  close(out[2].value, 30); // day 2 reset: not blended with day 1
  close(out[3].value, 15); // (30*50+10*150)/200
  out.forEach((p, i) => assert.equal(p.time, c[i].time));
});

test("vwap: [] when all volumes are 0/undefined", () => {
  assert.deepEqual(vwap(fromCloses([1, 2, 3])), []);
  assert.deepEqual(vwap([mk(0, 5, { volume: 0 }), mk(60, 6, { volume: 0 })]), []);
});

test("volumeHistogram: colors by candle direction, [] without volume", () => {
  const c = [
    mk(0, 12, { open: 10, volume: 5 }), // up
    mk(60, 8, { open: 10, volume: 7 }), // down
    mk(120, 10, { open: 10, volume: 3 }), // doji counts as up
  ];
  const out = volumeHistogram(c, "UP", "DOWN");
  assert.deepEqual(
    out.map((p) => [p.value, p.color]),
    [
      [5, "UP"],
      [7, "DOWN"],
      [3, "UP"],
    ],
  );
  assert.deepEqual(volumeHistogram(fromCloses([1, 2]), "UP", "DOWN"), []);
});

test("hasVolume: positive finite volume required", () => {
  assert.equal(hasVolume(fromCloses([1, 2])), false);
  assert.equal(hasVolume([mk(0, 1, { volume: 0 })]), false);
  assert.equal(hasVolume([mk(0, 1, { volume: Infinity })]), false);
  assert.equal(hasVolume([mk(0, 1, { volume: 0 }), mk(60, 1, { volume: 2 })]), true);
});

test("warm-up: every fn returns [] for too-short input", () => {
  const two = fromCloses([1, 2]);
  assert.deepEqual(sma(two, 3), []);
  assert.deepEqual(ema(two, 3), []);
  assert.deepEqual(wma(two, 3), []);
  const bb = bollinger(fromCloses([1, 2, 3]), 20, 2);
  assert.deepEqual([bb.basis, bb.upper, bb.lower], [[], [], []]);
  assert.deepEqual(rsi(fromCloses([1, 2, 3])), []);
  const m = macd(fromCloses([1, 2, 3, 4, 5]));
  assert.deepEqual([m.macd, m.signal, m.hist], [[], [], []]);
  assert.deepEqual(atr([mk(0, 1)], 14), []);
  // rsi needs period+1 candles (period changes)
  assert.deepEqual(rsi(fromCloses(Array.from({ length: 14 }, (_, i) => i)), 14), []);
});

test("macd: signal empty when macd points < signal period", () => {
  // 27 candles -> 2 macd points < 9 signal period
  const c = fromCloses(Array.from({ length: 27 }, (_, i) => 100 + Math.sin(i)));
  const m = macd(c, 12, 26, 9);
  assert.equal(m.macd.length, 2);
  assert.deepEqual(m.signal, []);
  assert.deepEqual(m.hist, []);
});
