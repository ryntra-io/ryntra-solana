// Run from repo root: node --test "city/lib/moments/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameTicks, muxMp4 } from './mp4.ts';

/** Reads the boxes of an MP4 the way a player does: size, four letters, body. */
function boxes(bytes, from = 0, to = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let at = from; at < to; ) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= to, `box ${type} fits its parent`);
    out.push({ type, at, size, body: at + 8 });
    at += size;
  }
  return out;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl']);

function find(bytes, path) {
  let list = boxes(bytes);
  let box = null;
  for (const type of path) {
    box = list.find((b) => b.type === type);
    assert.ok(box, `${path.join('/')} has ${type}`);
    if (CONTAINERS.has(type)) list = boxes(bytes, box.body, box.at + box.size);
  }
  return box;
}

const u32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);

const AVCC = Uint8Array.from([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xeb, 0xe3, 0xcb]);
const frame = (n, key, at) => ({ data: Uint8Array.from({ length: n }, (_, i) => (i + n) % 251), key, at });

test('the index comes before the frames, and its chunk offset points at the first frame', () => {
  const frames = [frame(500, true, 0), frame(120, false, 33_333), frame(90, false, 66_667), frame(400, true, 1_000_000)];
  const mp4 = muxMp4({ width: 720, height: 1280, fps: 30, avcC: AVCC, frames });
  assert.deepEqual(
    boxes(mp4).map((b) => b.type),
    ['ftyp', 'moov', 'mdat'],
  );
  const stco = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco']);
  const offset = u32(mp4, stco.body + 8);
  assert.deepEqual(mp4.subarray(offset, offset + 500), frames[0].data, 'the first frame starts where the index says');
  const mdat = boxes(mp4).find((b) => b.type === 'mdat');
  assert.equal(mdat.size, 8 + 500 + 120 + 90 + 400);
  assert.equal(mdat.body, offset);
});

test('the sample table lists every size, the key frames and how long each frame lasts', () => {
  const frames = [frame(10, true, 0), frame(11, false, 33_333), frame(12, false, 166_667), frame(13, true, 200_000)];
  const mp4 = muxMp4({ width: 720, height: 1280, fps: 30, avcC: AVCC, frames });
  const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
  const stsz = find(mp4, [...stbl, 'stsz']);
  assert.equal(u32(mp4, stsz.body + 8), 4);
  assert.deepEqual([0, 1, 2, 3].map((i) => u32(mp4, stsz.body + 12 + i * 4)), [10, 11, 12, 13]);
  const stss = find(mp4, [...stbl, 'stss']);
  assert.deepEqual([u32(mp4, stss.body + 4), u32(mp4, stss.body + 8), u32(mp4, stss.body + 12)], [2, 1, 4]);
  // 1000 ticks a frame at 30 a second: a frame, four frames (a skipped stretch), a frame, and the last one.
  assert.deepEqual(frameTicks({ fps: 30, frames }), [1000, 4000, 1000, 1000]);
  const stts = find(mp4, [...stbl, 'stts']);
  const runs = u32(mp4, stts.body + 4);
  const entries = Array.from({ length: runs }, (_, i) => [u32(mp4, stts.body + 8 + i * 8), u32(mp4, stts.body + 12 + i * 8)]);
  assert.deepEqual(entries, [
    [1, 1000],
    [1, 4000],
    [2, 1000],
  ]);
  const mdhd = find(mp4, ['moov', 'trak', 'mdia', 'mdhd']);
  assert.deepEqual([u32(mp4, mdhd.body + 12), u32(mp4, mdhd.body + 16)], [30_000, 7000], 'timescale and length in ticks');
  const mvhd = find(mp4, ['moov', 'mvhd']);
  assert.equal(u32(mp4, mvhd.body + 16), 233, 'seven frames of 1/30 s, in milliseconds');
});

test('the sample entry carries the size and the encoder\'s decoder setup unchanged', () => {
  const mp4 = muxMp4({ width: 720, height: 1280, fps: 30, avcC: AVCC, frames: [frame(5, true, 0)] });
  const stsd = find(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  const entry = stsd.body + 8;
  assert.equal(String.fromCharCode(...mp4.subarray(entry + 4, entry + 8)), 'avc1');
  const dims = new DataView(mp4.buffer).getUint32(entry + 8 + 24);
  assert.deepEqual([dims >>> 16, dims & 0xffff], [720, 1280]);
  const avcC = boxes(mp4, entry + 8 + 78, entry + u32(mp4, entry))[0];
  assert.equal(avcC.type, 'avcC');
  assert.deepEqual(mp4.subarray(avcC.body, avcC.at + avcC.size), AVCC);
  const tkhd = find(mp4, ['moov', 'trak', 'tkhd']);
  assert.deepEqual([u32(mp4, tkhd.body + 76) / 65536, u32(mp4, tkhd.body + 80) / 65536], [720, 1280]);
});

test('a file that a player could not start is refused', () => {
  const base = { width: 720, height: 1280, fps: 30, avcC: AVCC };
  assert.throws(() => muxMp4({ ...base, frames: [] }), /no frames/);
  assert.throws(() => muxMp4({ ...base, frames: [frame(5, false, 0)] }), /key frame/);
  assert.throws(() => muxMp4({ ...base, width: 721, frames: [frame(5, true, 0)] }), /size/);
  assert.throws(() => muxMp4({ ...base, frames: [frame(5, true, 10), frame(5, false, 10)] }), /order/);
});
