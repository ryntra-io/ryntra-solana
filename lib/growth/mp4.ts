/**
 * A video file of one H.264 track — the moving trade card, as X takes it.
 *
 * The browser's own encoder (WebCodecs, `avc: { format: "avc" }`) gives the
 * frames already compressed, each with its length prefixes, and the decoder's
 * setup (`decoderConfig.description`, the avcC record). What is left is the
 * box around them: an ISO BMFF file with the index first (so a player — and
 * X — can start before the end arrives) and the frames after it, all in one
 * chunk. No composition offsets are written, so the frames must come in the
 * order they show: the film's encoder refuses any profile that reorders them
 * (B-frames) and falls back to the next, down to Baseline, which never does.
 *
 * Pure and client-safe: bytes in, bytes out.
 */

export type Mp4Sample = Readonly<{
  /** The compressed frame, length-prefixed NAL units as the encoder gives them. */
  data: Uint8Array;
  /** A frame that decodes on its own. The first must be one. */
  key: boolean;
}>;

export type Mp4Track = Readonly<{
  width: number;
  height: number;
  /** Frames per second; every frame lasts the same. */
  fps: number;
  /** The avcC record — `decoderConfig.description` of the encoder's first output. */
  avcC: Uint8Array;
  samples: readonly Mp4Sample[];
}>;

const MEDIA_TIMESCALE_PER_FRAME = 1000;
const MOVIE_TIMESCALE = 1000;

class Writer {
  private parts: Uint8Array[] = [];
  size = 0;

  bytes(data: Uint8Array | readonly number[]): this {
    const part = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.parts.push(part);
    this.size += part.byteLength;
    return this;
  }

  u8(value: number): this {
    return this.bytes([value & 0xff]);
  }

  u16(value: number): this {
    return this.bytes([(value >>> 8) & 0xff, value & 0xff]);
  }

  u32(value: number): this {
    return this.bytes([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
  }

  zeros(count: number): this {
    return this.bytes(new Uint8Array(count));
  }

  ascii(text: string): this {
    return this.bytes(Array.from(text, (char) => char.charCodeAt(0)));
  }

  join(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  }
}

/** A box: its size, its four letters, its body. */
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const inner = body.reduce((sum, part) => sum + part.byteLength, 0);
  const w = new Writer().u32(8 + inner).ascii(type);
  for (const part of body) w.bytes(part);
  return w.join();
}

/** A full box: a box whose body starts with a version and flags. */
function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  return box(type, new Writer().u8(version).bytes([(flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]).bytes(body).join());
}

/** The identity transform every track and movie carries. */
const MATRIX = new Writer().u32(0x00010000).u32(0).u32(0).u32(0).u32(0x00010000).u32(0).u32(0).u32(0).u32(0x40000000).join();

function ftyp(): Uint8Array {
  return box("ftyp", new Writer().ascii("isom").u32(0x200).ascii("isom").ascii("iso2").ascii("avc1").ascii("mp41").join());
}

function mvhd(durationMs: number): Uint8Array {
  return fullBox(
    "mvhd",
    0,
    0,
    new Writer().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(durationMs).u32(0x00010000).u16(0x0100).zeros(10).bytes(MATRIX).zeros(24).u32(2).join(),
  );
}

function tkhd(track: Mp4Track, durationMs: number): Uint8Array {
  return fullBox(
    "tkhd",
    0,
    0x000003,
    new Writer().u32(0).u32(0).u32(1).u32(0).u32(durationMs).zeros(8).u16(0).u16(0).u16(0).u16(0).bytes(MATRIX).u32(track.width * 0x10000).u32(track.height * 0x10000).join(),
  );
}

function mdhd(timescale: number, duration: number): Uint8Array {
  /* «und»: three letters, five bits each, minus 0x60. */
  const und = (("u".charCodeAt(0) - 0x60) << 10) | (("n".charCodeAt(0) - 0x60) << 5) | ("d".charCodeAt(0) - 0x60);
  return fullBox("mdhd", 0, 0, new Writer().u32(0).u32(0).u32(timescale).u32(duration).u16(und).u16(0).join());
}

function hdlr(): Uint8Array {
  return fullBox("hdlr", 0, 0, new Writer().u32(0).ascii("vide").zeros(12).ascii("VideoHandler").u8(0).join());
}

function avc1(track: Mp4Track): Uint8Array {
  const body = new Writer()
    .zeros(6)
    .u16(1) /* data reference index */
    .u16(0)
    .u16(0)
    .zeros(12)
    .u16(track.width)
    .u16(track.height)
    .u32(0x00480000)
    .u32(0x00480000)
    .u32(0)
    .u16(1) /* frames per sample */
    .zeros(32) /* compressor name */
    .u16(0x0018)
    .u16(0xffff)
    .bytes(box("avcC", track.avcC))
    .join();
  return box("avc1", body);
}

function stbl(track: Mp4Track, chunkOffset: number): Uint8Array {
  const count = track.samples.length;
  const stsd = fullBox("stsd", 0, 0, new Writer().u32(1).bytes(avc1(track)).join());
  const stts = fullBox("stts", 0, 0, new Writer().u32(1).u32(count).u32(MEDIA_TIMESCALE_PER_FRAME).join());
  const keys = track.samples.flatMap((sample, index) => (sample.key ? [index + 1] : []));
  const stssBody = new Writer().u32(keys.length);
  for (const key of keys) stssBody.u32(key);
  const stss = fullBox("stss", 0, 0, stssBody.join());
  const stsc = fullBox("stsc", 0, 0, new Writer().u32(1).u32(1).u32(count).u32(1).join());
  const stszBody = new Writer().u32(0).u32(count);
  for (const sample of track.samples) stszBody.u32(sample.data.byteLength);
  const stsz = fullBox("stsz", 0, 0, stszBody.join());
  const stco = fullBox("stco", 0, 0, new Writer().u32(1).u32(chunkOffset).join());
  return box("stbl", stsd, stts, stss, stsc, stsz, stco);
}

function moov(track: Mp4Track, chunkOffset: number): Uint8Array {
  const timescale = track.fps * MEDIA_TIMESCALE_PER_FRAME;
  const mediaDuration = track.samples.length * MEDIA_TIMESCALE_PER_FRAME;
  const durationMs = Math.round((track.samples.length * MOVIE_TIMESCALE) / track.fps);
  const vmhd = fullBox("vmhd", 0, 1, new Writer().u16(0).zeros(6).join());
  const dref = fullBox("dref", 0, 0, new Writer().u32(1).bytes(fullBox("url ", 0, 1, new Uint8Array(0))).join());
  const minf = box("minf", vmhd, box("dinf", dref), stbl(track, chunkOffset));
  const mdia = box("mdia", mdhd(timescale, mediaDuration), hdlr(), minf);
  return box("moov", mvhd(durationMs), box("trak", tkhd(track, durationMs), mdia));
}

/** The whole file: `ftyp`, `moov` (the index), `mdat` (the frames). */
export function muxAvcMp4(track: Mp4Track): Uint8Array {
  if (track.samples.length === 0) throw new Error("no frames");
  if (!track.samples[0].key) throw new Error("the first frame must be a key frame");
  if (track.width % 2 !== 0 || track.height % 2 !== 0) throw new Error("odd size");
  const head = ftyp();
  const frames = track.samples.reduce((sum, sample) => sum + sample.data.byteLength, 0);
  /* The index's size does not depend on the offset it carries, so measure it once with a stand-in. */
  const indexSize = moov(track, 0).byteLength;
  const index = moov(track, head.byteLength + indexSize + 8);
  const out = new Writer().bytes(head).bytes(index).u32(8 + frames).ascii("mdat");
  for (const sample of track.samples) out.bytes(sample.data);
  return out.join();
}
