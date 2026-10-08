import assert from "node:assert/strict";
import test from "node:test";

import { muxAvcMp4 } from "./mp4.ts";

/** Boxes of `bytes` from `start` to `end`: type, where its body starts, where it ends. */
function boxes(bytes, start = 0, end = bytes.byteLength) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = [];
  for (let at = start; at < end; ) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    found.push({ type, body: at + 8, end: at + size });
    assert.ok(size >= 8, `${type} has a size`);
    at += size;
  }
  assert.equal(found.at(-1).end, end, "the boxes fill their parent exactly");
  return found;
}

function child(bytes, parent, path) {
  let current = parent;
  for (const type of path) {
    const skip = type === "stsd" ? 0 : 0;
    const inner = boxes(bytes, current.body + skip, current.end);
    current = inner.find((entry) => entry.type === type);
    assert.ok(current, `${type} is there`);
  }
  return current;
}

const frame = (n, size) => Uint8Array.from({ length: size }, (_, i) => (n * 17 + i) % 256);
const AVCC = Uint8Array.from([1, 0x42, 0xe0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xe0, 0x28, 1, 0, 2, 0x68, 0xce]);

test("an mp4 of H.264 frames: ftyp, the index, then the frames, each where the index says", () => {
  const samples = [
    { data: frame(0, 900), key: true },
    { data: frame(1, 120), key: false },
    { data: frame(2, 80), key: false },
    { data: frame(3, 700), key: true },
    { data: frame(4, 60), key: false },
  ];
  const file = muxAvcMp4({ width: 1600, height: 840, fps: 30, avcC: AVCC, samples });
  const top = boxes(file);
  assert.deepEqual(top.map((entry) => entry.type), ["ftyp", "moov", "mdat"], "the index comes before the frames");
  const view = new DataView(file.buffer);

  const moov = top[1];
  const mvhd = child(file, moov, ["mvhd"]);
  assert.equal(view.getUint32(mvhd.body + 4 + 8), 1000, "movie timescale");
  assert.equal(view.getUint32(mvhd.body + 4 + 12), 167, "5 frames at 30 fps ≈ 167 ms");

  const tkhd = child(file, moov, ["trak", "tkhd"]);
  assert.equal(view.getUint32(tkhd.end - 8) / 0x10000, 1600);
  assert.equal(view.getUint32(tkhd.end - 4) / 0x10000, 840);

  const mdhd = child(file, moov, ["trak", "mdia", "mdhd"]);
  assert.equal(view.getUint32(mdhd.body + 4 + 8), 30_000, "media timescale");
  assert.equal(view.getUint32(mdhd.body + 4 + 12), 5_000, "five frames of 1000 ticks");

  const stbl = child(file, moov, ["trak", "mdia", "minf", "stbl"]);
  const inStbl = boxes(file, stbl.body, stbl.end).map((entry) => entry.type);
  assert.deepEqual(inStbl, ["stsd", "stts", "stss", "stsc", "stsz", "stco"]);

  const stsd = child(file, stbl, ["stsd"]);
  const avc1 = boxes(file, stsd.body + 8, stsd.end)[0];
  assert.equal(avc1.type, "avc1");
  assert.equal(view.getUint16(avc1.body + 24), 1600, "avc1 width");
  assert.equal(view.getUint16(avc1.body + 26), 840, "avc1 height");
  const avcC = boxes(file, avc1.body + 78, avc1.end)[0];
  assert.equal(avcC.type, "avcC");
  assert.deepEqual([...file.subarray(avcC.body, avcC.end)], [...AVCC], "the encoder's record, as given");

  const stss = child(file, stbl, ["stss"]);
  assert.equal(view.getUint32(stss.body + 4), 2);
  assert.deepEqual([view.getUint32(stss.body + 8), view.getUint32(stss.body + 12)], [1, 4], "key frames, counted from one");

  const stsz = child(file, stbl, ["stsz"]);
  assert.equal(view.getUint32(stsz.body + 8), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => view.getUint32(stsz.body + 12 + i * 4)), [900, 120, 80, 700, 60]);

  const stco = child(file, stbl, ["stco"]);
  const offset = view.getUint32(stco.body + 8);
  const mdat = top[2];
  assert.equal(offset, mdat.body, "the chunk starts where the frames do");
  let at = offset;
  for (const sample of samples) {
    assert.deepEqual([...file.subarray(at, at + sample.data.byteLength)], [...sample.data]);
    at += sample.data.byteLength;
  }
  assert.equal(at, file.byteLength);
});

test("an mp4 refuses what no player would open", () => {
  const avcC = AVCC;
  assert.throws(() => muxAvcMp4({ width: 1600, height: 840, fps: 30, avcC, samples: [] }), /no frames/);
  assert.throws(() => muxAvcMp4({ width: 1600, height: 840, fps: 30, avcC, samples: [{ data: frame(0, 10), key: false }] }), /key frame/);
  assert.throws(() => muxAvcMp4({ width: 1601, height: 840, fps: 30, avcC, samples: [{ data: frame(0, 10), key: true }] }), /odd size/);
});
