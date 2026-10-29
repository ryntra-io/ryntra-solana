import { GHOST_STRIDE } from '../run/sim.ts';
import { ByteReader, ByteWriter } from './bytes.ts';

/**
 * A run's ghost, small enough for a link. The run records one row (distance along the course, across, up, dash)
 * per 60 Hz tick; the link keeps distance to 3 cm and position to 1.5 cm as differences of differences — a steady
 * flight is a string of zeros, which deflate turns into almost nothing, so every tick costs only a little more than
 * every third and the ghost replays exactly — and the dash as the ticks where it turns on or off. A step above one
 * keeps every n-th row and draws the straight line between them.
 */

const Q_S = 32;
const Q_POS = 64;
export const GHOST_STEP = 1;
/** Two minutes of ticks: the run itself stops recording there. */
export const MAX_GHOST_ROWS = 60 * 120;
/** No course is wider or taller than this; anything beyond is not a ghost of ours. */
const MAX_OFFSET = 60;

function sampleTicks(rows: number, step: number): number[] {
  const ticks: number[] = [];
  for (let t = 0; t < rows; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== rows - 1) ticks.push(rows - 1);
  return ticks;
}

export function writeGhost(w: ByteWriter, ghost: Float32Array, step = GHOST_STEP) {
  const rows = Math.floor(ghost.length / GHOST_STRIDE);
  if (rows < 2 || rows > MAX_GHOST_ROWS) throw new RangeError('not a ghost');
  w.varint(rows).u8(step);
  const ticks = sampleTicks(rows, step);
  for (const [channel, q] of [
    [0, Q_S],
    [1, Q_POS],
    [2, Q_POS],
  ] as const) {
    let prev = 0;
    let prevDelta = 0;
    for (const t of ticks) {
      const v = Math.round(ghost[t * GHOST_STRIDE + channel]! * q);
      const delta = v - prev;
      w.svarint(delta - prevDelta);
      prevDelta = delta;
      prev = v;
    }
  }
  const toggles: number[] = [];
  let dashing = false;
  for (let t = 0; t < rows; t += 1) {
    const now = ghost[t * GHOST_STRIDE + 3]! > 0.5;
    if (now !== dashing) toggles.push(t);
    dashing = now;
  }
  w.varint(toggles.length);
  let last = 0;
  for (const t of toggles) {
    w.varint(t - last);
    last = t;
  }
}

export function readGhost(r: ByteReader): Float32Array {
  const rows = r.varint();
  const step = r.u8();
  if (rows < 2 || rows > MAX_GHOST_ROWS || step < 1 || step > 30) throw new RangeError('not a ghost');
  const ticks = sampleTicks(rows, step);
  const values = [0, 1, 2].map(() => new Float64Array(ticks.length));
  [Q_S, Q_POS, Q_POS].forEach((q, channel) => {
    let prev = 0;
    let delta = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      delta += r.svarint();
      prev += delta;
      values[channel]![i] = prev / q;
    }
  });
  const out = new Float32Array(rows * GHOST_STRIDE);
  for (let i = 0; i < ticks.length - 1; i += 1) {
    const a = ticks[i]!;
    const b = ticks[i + 1]!;
    for (let t = a; t <= b; t += 1) {
      const f = (t - a) / (b - a);
      for (let channel = 0; channel < 3; channel += 1) {
        const v = values[channel]!;
        out[t * GHOST_STRIDE + channel] = v[i]! + (v[i + 1]! - v[i]!) * f;
      }
    }
  }
  const count = r.varint();
  if (count > rows) throw new RangeError('not a ghost');
  let at = 0;
  let dashing = false;
  let from = 0;
  const fill = (to: number) => {
    if (dashing) for (let t = from; t < to; t += 1) out[t * GHOST_STRIDE + 3] = 1;
  };
  for (let k = 0; k < count; k += 1) {
    at += r.varint();
    if (at >= rows) throw new RangeError('not a ghost');
    fill(at);
    dashing = !dashing;
    from = at;
  }
  fill(rows);
  for (let t = 0; t < rows; t += 1) {
    const i = t * GHOST_STRIDE;
    if (!Number.isFinite(out[i]!) || Math.abs(out[i + 1]!) > MAX_OFFSET || Math.abs(out[i + 2]!) > MAX_OFFSET) throw new RangeError('not a ghost');
  }
  return out;
}

export function encodeGhost(ghost: Float32Array, step = GHOST_STEP): Uint8Array {
  const w = new ByteWriter();
  writeGhost(w, ghost, step);
  return w.done();
}

export function decodeGhost(bytes: Uint8Array): Float32Array {
  return readGhost(new ByteReader(bytes));
}
