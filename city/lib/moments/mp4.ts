/**
 * One H.264 track in an MP4 file, the way X takes a video: the index (`moov`) before the frames (`mdat`), so a
 * player starts before the file has arrived, no sound.
 *
 * The browser's encoder (WebCodecs with `avc: { format: 'avc' }`) hands over each frame already compressed and the
 * decoder setup (the avcC record); this file only boxes them. Each frame lasts until the next one starts, so a
 * device that films fewer than 30 frames a second still plays back at the speed it happened. No composition offsets
 * are written, so frames must come in the order they show — the recorder refuses an encoder that reorders them.
 */

/** `at`: when the frame shows, in microseconds; only the differences matter. */
export type Mp4Frame = { data: Uint8Array; key: boolean; at: number };
/** `fps`: the nominal rate, which also gives the last frame its length. */
export type Mp4Video = { width: number; height: number; fps: number; avcC: Uint8Array; frames: readonly Mp4Frame[] };

/** The track's clock runs at fps × 1000 ticks a second, so a frame on the nominal grid lasts a round 1000. */
const TICKS_PER_FRAME = 1000;
const MOVIE_SCALE = 1000;

/** Each frame's length in track ticks: up to the next frame, the last one a nominal frame; never zero. */
export function frameTicks(v: Pick<Mp4Video, 'fps' | 'frames'>): number[] {
  const scale = v.fps * TICKS_PER_FRAME;
  return v.frames.map((f, i) => {
    const next = v.frames[i + 1];
    return next ? Math.max(1, Math.round(((next.at - f.at) * scale) / 1e6)) : TICKS_PER_FRAME;
  });
}

/** Runs of equal lengths, the way the time-to-sample box lists them. */
function runs(ticks: readonly number[]): [count: number, delta: number][] {
  const out: [number, number][] = [];
  for (const t of ticks) {
    const last = out[out.length - 1];
    if (last && last[1] === t) last[0] += 1;
    else out.push([1, t]);
  }
  return out;
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);

type Part = Uint8Array | number[];

function join(parts: readonly Part[]): Uint8Array {
  const size = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function box(type: string, ...body: Part[]): Uint8Array {
  const inner = join(body);
  return join([u32(8 + inner.length), ascii(type), inner]);
}

function full(type: string, version: number, flags: number, ...body: Part[]): Uint8Array {
  return box(type, [version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff], ...body);
}

/** The unit transform every movie and track carries. */
const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

function sampleTable(v: Mp4Video, ticks: readonly number[], offset: number): Uint8Array {
  const n = v.frames.length;
  const timing = runs(ticks);
  const entry = box(
    'avc1',
    zeros(6),
    u16(1),
    zeros(16),
    u16(v.width),
    u16(v.height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    zeros(32),
    u16(0x18),
    u16(0xffff),
    box('avcC', v.avcC),
  );
  const keys = v.frames.flatMap((f, i) => (f.key ? [i + 1] : []));
  return box(
    'stbl',
    full('stsd', 0, 0, u32(1), entry),
    full('stts', 0, 0, u32(timing.length), timing.flatMap(([count, delta]) => [...u32(count), ...u32(delta)])),
    full('stss', 0, 0, u32(keys.length), keys.flatMap(u32)),
    full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), v.frames.flatMap((f) => u32(f.data.length))),
    full('stco', 0, 0, u32(1), u32(offset)),
  );
}

function movie(v: Mp4Video, offset: number): Uint8Array {
  const ticks = frameTicks(v);
  const total = ticks.reduce((sum, t) => sum + t, 0);
  const ms = Math.round((total * MOVIE_SCALE) / (v.fps * TICKS_PER_FRAME));
  // "und": three letters of five bits each, counted from 0x60.
  const und = ((0x75 - 0x60) << 10) | ((0x6e - 0x60) << 5) | (0x64 - 0x60);
  const media = box(
    'mdia',
    full('mdhd', 0, 0, u32(0), u32(0), u32(v.fps * TICKS_PER_FRAME), u32(total), u16(und), u16(0)),
    full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('City clip'), [0]),
    box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), sampleTable(v, ticks, offset)),
  );
  const track = box(
    'trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(v.width * 0x10000), u32(v.height * 0x10000)),
    media,
  );
  return box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_SCALE), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)), track);
}

export function muxMp4(v: Mp4Video): Uint8Array {
  if (!v.frames.length) throw new Error('no frames');
  if (!v.frames[0]!.key) throw new Error('the first frame must be a key frame');
  if (v.width % 2 || v.height % 2 || v.width <= 0 || v.height <= 0) throw new Error('bad size');
  if (!(v.fps > 0 && Number.isInteger(v.fps))) throw new Error('bad frame rate');
  if (v.frames.some((f, i) => i > 0 && f.at <= v.frames[i - 1]!.at)) throw new Error('frames out of order');
  const head = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const payload = v.frames.reduce((sum, f) => sum + f.data.length, 0);
  // The index's size does not depend on the offset it holds: measure it once, then write it with the real offset.
  const indexSize = movie(v, 0).length;
  const index = movie(v, head.length + indexSize + 8);
  return join([head, index, u32(8 + payload), ascii('mdat'), ...v.frames.map((f) => f.data)]);
}
