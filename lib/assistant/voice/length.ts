/**
 * AI-08 — a recording's own length, read from it before anything is paid:
 * the browser's `seconds` is its word, and the provider bills what it hears.
 * Every container says a length, and a sender can write any number there —
 * so the length is the most of what the container declares and what its
 * audio adds up to as a decoder plays it: the Opus packets' own frame
 * durations (WebM — Chrome, Edge; Ogg — Firefox), the AAC frames — 1 024
 * samples each at the track's own rate (MP4 — Safari). The reading fails
 * closed: one audio track of the codec a browser records, read to its last
 * byte, or `null` — and such a recording is not sent to be heard.
 */

/* ------------------------------------------------------------ Opus */

/** Milliseconds of one Opus packet from its TOC byte (RFC 6716 §3.1); 0 when it is not a packet. */
export function opusPacketMs(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0]!;
  const config = toc >> 3;
  const frame = config < 12 ? [10, 20, 40, 60][config % 4]! : config < 16 ? [10, 20][config % 2]! : [2.5, 5, 10, 20][config % 4]!;
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet.length > 1 ? packet[1]! & 0x3f : 0) : 2;
  return frame * frames;
}

/* ------------------------------------------------------------ WebM */

/** An EBML variable-length integer at `at`: its value (the marker bit removed unless `raw`) and its width; `unknown` for a size of all ones. */
function vint(bytes: Uint8Array, at: number, raw = false): { value: number; width: number; unknown: boolean } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let width = 1;
  while (width <= 8 && (first & (0x80 >> (width - 1))) === 0) width += 1;
  if (width > 8 || at + width > bytes.length) return null;
  let value = raw ? first : first & (0xff >> width);
  let ones = (first & (0xff >> width)) === 0xff >> width;
  for (let i = 1; i < width; i += 1) {
    value = value * 256 + bytes[at + i]!;
    if (bytes[at + i] !== 0xff) ones = false;
  }
  return { value, width, unknown: !raw && ones };
}

const uint = (bytes: Uint8Array, at: number, size: number): number => {
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + bytes[at + i]!;
  return value;
};

const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const CONTENT_ENCODINGS = 0x6d80;
const CODEC_ID = 0x86;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
/* Containers walked into: their children are read in place (a recorder writes the segment and its clusters with an unknown size). */
const CONTAINERS = new Set([SEGMENT, CLUSTER, INFO, TRACKS, TRACK_ENTRY, BLOCK_GROUP]);
/* The only elements that may be of unknown size. */
const OPEN_ENDED = new Set([SEGMENT, CLUSTER]);

/**
 * The length of a WebM recording in seconds: the most of the segment's
 * declared duration, the span of its blocks' times and the Opus packets' own
 * durations added up. `null` unless the bytes are read to their end, hold
 * exactly one track and that track is Opus; a laced block (several packets in
 * one — no browser's recorder writes one) is not read either.
 */
export function webmSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || uint(bytes, 0, 4) !== 0x1a45dfa3) return null;
  let scale = 1_000_000;
  let duration = 0;
  let cluster: number | null = null;
  let first: number | null = null;
  let latest: number | null = null;
  let played = 0;
  let blocks = 0;
  let tracks = 0;
  const codecs: string[] = [];
  let at = 0;
  while (at < bytes.length) {
    const id = vint(bytes, at, true);
    if (!id) return null;
    /* A track whose blocks are stored compressed or with stripped headers plays more than its stored bytes say: not read. */
    if (id.value === CONTENT_ENCODINGS) return null;
    const size = vint(bytes, at + id.width);
    if (!size) return null;
    const body = at + id.width + size.width;
    if (CONTAINERS.has(id.value)) {
      if (size.unknown && !OPEN_ENDED.has(id.value)) return null;
      if (id.value === TRACK_ENTRY) tracks += 1;
      at = body;
      continue;
    }
    if (size.unknown) return null;
    const end = body + size.value;
    if (end > bytes.length) return null;
    if (id.value === TIMECODE_SCALE && size.value >= 1 && size.value <= 8) scale = uint(bytes, body, size.value);
    else if (id.value === CODEC_ID) codecs.push(new TextDecoder().decode(bytes.subarray(body, end)).replace(/\0+$/, ""));
    else if (id.value === DURATION && (size.value === 4 || size.value === 8)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + body, size.value);
      const value = size.value === 4 ? view.getFloat32(0) : view.getFloat64(0);
      if (Number.isFinite(value) && value > 0) duration = value;
    } else if (id.value === CLUSTER_TIMECODE && size.value >= 1 && size.value <= 8) cluster = uint(bytes, body, size.value);
    else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = vint(bytes, body);
      if (!track || body + track.width + 3 > end) return null;
      const head = body + track.width;
      if ((bytes[head + 2]! & 0x06) !== 0) return null;
      blocks += 1;
      played += opusPacketMs(bytes.subarray(head + 3, end));
      if (cluster !== null) {
        const time = cluster + new DataView(bytes.buffer, bytes.byteOffset + head, 2).getInt16(0);
        first = first === null ? time : Math.min(first, time);
        latest = latest === null ? time : Math.max(latest, time);
      }
    }
    at = end;
  }
  if (!(scale > 0) || blocks === 0 || tracks !== 1 || codecs.length !== 1 || codecs[0] !== "A_OPUS") return null;
  const span = first !== null && latest !== null ? latest - first : 0;
  return Math.max((duration * scale) / 1e9, (span * scale) / 1e9, played / 1_000);
}

/* ------------------------------------------------------------ Ogg */

/**
 * The length of an Ogg Opus recording in seconds: the most of the granules'
 * span (48 kHz) and the packets' own durations added up. `null` unless it is
 * one Opus stream (its first packet `OpusHead`, no page of another stream, no
 * second beginning) read to its last byte.
 */
export function oggOpusSeconds(bytes: Uint8Array): number | null {
  const isPage = (at: number) => bytes[at] === 0x4f && bytes[at + 1] === 0x67 && bytes[at + 2] === 0x67 && bytes[at + 3] === 0x53;
  if (bytes.length < 27 || !isPage(0)) return null;
  const serialAt = (at: number) => (bytes[at + 14]! | (bytes[at + 15]! << 8) | (bytes[at + 16]! << 16) | (bytes[at + 17]! << 24)) >>> 0;
  const serial = serialAt(0);
  let granule = 0;
  let packets = 0;
  let played = 0;
  let pending: number[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 27 > bytes.length || !isPage(at) || serialAt(at) !== serial) return null;
    /* A second beginning of a stream is a chained recording. */
    if (at > 0 && (bytes[at + 5]! & 0x02) !== 0) return null;
    let value = 0;
    for (let i = 7; i >= 0; i -= 1) value = value * 256 + bytes[at + 6 + i]!;
    if (value !== 2 ** 64 - 1 && value < 2 ** 53) granule = Math.max(granule, value);
    const segments = bytes[at + 26]!;
    const table = at + 27;
    let data = table + segments;
    if (data > bytes.length) return null;
    for (let i = 0; i < segments; i += 1) {
      const length = bytes[table + i]!;
      if (data + length > bytes.length) return null;
      for (let k = 0; k < length && pending.length < 8; k += 1) pending.push(bytes[data + k]!);
      data += length;
      if (length < 255) {
        packets += 1;
        const packet = Uint8Array.from(pending);
        if (packets === 1 && new TextDecoder().decode(packet) !== "OpusHead") return null;
        /* The first two packets are OpusHead and OpusTags; every other is audio. */
        if (packets > 2) played += opusPacketMs(packet);
        pending = [];
      }
    }
    at = data;
  }
  if (packets < 3) return null;
  return Math.max(granule / 48_000, played / 1_000);
}

/* ------------------------------------------------------------ MP4 */

type Box = { type: string; body: number; end: number };

function boxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (at + 8 > to) return null;
    let size = uint(bytes, at, 4);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      size = uint(bytes, at + 8, 8);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return null;
    out.push({ type, body, end: at + size });
    at += size;
  }
  return out;
}

const children = (bytes: Uint8Array, box: Box | undefined, type: string): Box[] => (box ? (boxes(bytes, box.body, box.end) ?? []).filter((entry) => entry.type === type) : []);
const child = (bytes: Uint8Array, box: Box | undefined, type: string): Box | undefined => children(bytes, box, type)[0];

const AAC_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350] as const;

/** A descriptor of `esds` (ISO 14496-1): its tag, where its body starts and ends — the length in up to four 7-bit bytes. */
function descriptor(bytes: Uint8Array, at: number, end: number): { tag: number; body: number; end: number } | null {
  if (at >= end) return null;
  const tag = bytes[at]!;
  let length = 0;
  let cursor = at + 1;
  for (let i = 0; i < 4; i += 1) {
    if (cursor >= end) return null;
    const byte = bytes[cursor]!;
    cursor += 1;
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return cursor + length <= end ? { tag, body: cursor, end: cursor + length } : null;
}

/** The AAC AudioSpecificConfig of an `mp4a` entry: the object type and the sampling rate a decoder plays at; `null` when it is not there. */
function aacConfig(bytes: Uint8Array, entry: Box): { objectType: number; rate: number } | null {
  const inside = boxes(bytes, entry.body + 28, entry.end);
  /* One config, and nowhere else for a decoder to find another (`wave`, a second `esds`). */
  if (!inside || inside.some((box) => box.type === "wave") || inside.filter((box) => box.type === "esds").length !== 1) return null;
  const esds = inside.find((box) => box.type === "esds")!;
  const es = descriptor(bytes, esds.body + 4, esds.end);
  if (!es || es.tag !== 0x03) return null;
  /* A browser writes no dependency, URL or OCR fields: with any of them set, a decoder and this reader could read different configs. */
  if (bytes[es.body + 2] !== 0) return null;
  let at = es.body + 3;
  const decoder = descriptor(bytes, at, es.end);
  if (!decoder || decoder.tag !== 0x04 || bytes[decoder.body] !== 0x40) return null;
  at = decoder.body + 13;
  const specific = descriptor(bytes, at, decoder.end);
  if (!specific || specific.tag !== 0x05 || specific.end - specific.body < 2) return null;
  /* 5 bits of object type, 4 of the rate's index, or 24 bits of rate after the index 15. */
  const b = (i: number) => (specific.body + i < specific.end ? bytes[specific.body + i]! : 0);
  const objectType = b(0) >> 3;
  const index = ((b(0) & 0x07) << 1) | (b(1) >> 7);
  const rate = index === 15 ? ((b(1) & 0x7f) << 17) | (b(2) << 9) | (b(3) << 1) | (b(4) >> 7) : (AAC_RATES[index] ?? 0);
  return rate > 0 ? { objectType, rate } : null;
}

/**
 * The length of an MP4 recording in seconds: the most of the movie header's
 * duration, the sample table's and the fragments' run durations — and the
 * AAC frames it holds, 1 024 samples each at the sample entry's own rate,
 * which no table can shorten. `null` unless the whole file is boxes, with one
 * track whose sample entry is `mp4a`.
 */
export function mp4Seconds(bytes: Uint8Array): number | null {
  const top = boxes(bytes, 0, bytes.length);
  const moov = top?.find((box) => box.type === "moov");
  if (!top || !moov) return null;
  const traks = children(bytes, moov, "trak");
  if (traks.length !== 1) return null;
  const mdia = child(bytes, traks[0], "mdia");
  const mdhd = child(bytes, mdia, "mdhd");
  const stbl = child(bytes, child(bytes, mdia, "minf"), "stbl");
  const stsd = child(bytes, stbl, "stsd");
  if (!mdhd || !stsd || stsd.body + 8 > stsd.end) return null;
  const entries = boxes(bytes, stsd.body + 8, stsd.end);
  if (!entries || entries.length !== 1 || entries[0]!.type !== "mp4a" || entries[0]!.body + 28 > entries[0]!.end) return null;
  /* The audio sample entry: 6 reserved, the data reference, 8 reserved, channels, sample size, 4 more, then the rate in 16.16. */
  const entryRate = uint(bytes, entries[0]!.body + 24, 2);
  /* The decoder's rate is the AAC config's, inside `esds`: AAC-LC only, and the lower of the two rates counts. */
  const config = aacConfig(bytes, entries[0]!);
  if (!config || config.objectType !== 2 || !(entryRate > 0)) return null;
  const rate = Math.min(entryRate, config.rate);
  const v1 = bytes[mdhd.body] === 1;
  const scale = uint(bytes, mdhd.body + (v1 ? 20 : 12), 4);
  if (!(scale > 0)) return null;
  let declared = 0;
  const mvhd = child(bytes, moov, "mvhd");
  if (mvhd) {
    const m1 = bytes[mvhd.body] === 1;
    const movieScale = uint(bytes, mvhd.body + (m1 ? 20 : 12), 4);
    const duration = uint(bytes, mvhd.body + (m1 ? 24 : 16), m1 ? 8 : 4);
    if (movieScale > 0 && duration !== 0xffffffff) declared = duration / movieScale;
  }
  let frames = 0;
  let timed = 0;
  const stsz = child(bytes, stbl, "stsz");
  if (stsz && stsz.body + 12 <= stsz.end) frames += uint(bytes, stsz.body + 8, 4);
  const stts = child(bytes, stbl, "stts");
  if (stts) {
    const count = uint(bytes, stts.body + 4, 4);
    if (stts.body + 8 + count * 8 > stts.end) return null;
    for (let i = 0; i < count; i += 1) timed += uint(bytes, stts.body + 8 + i * 8, 4) * uint(bytes, stts.body + 12 + i * 8, 4);
  }
  const trex = child(bytes, child(bytes, moov, "mvex"), "trex");
  const trexDuration = trex ? uint(bytes, trex.body + 12, 4) : 0;
  for (const moof of top.filter((box) => box.type === "moof")) {
    for (const traf of children(bytes, moof, "traf")) {
      const parts = boxes(bytes, traf.body, traf.end);
      if (!parts) return null;
      const tfhd = parts.find((box) => box.type === "tfhd");
      let fallback = trexDuration;
      if (tfhd) {
        const flags = uint(bytes, tfhd.body + 1, 3);
        let at = tfhd.body + 8;
        if (flags & 0x01) at += 8;
        if (flags & 0x02) at += 4;
        if (flags & 0x08) fallback = uint(bytes, at, 4);
      }
      for (const trun of parts.filter((box) => box.type === "trun")) {
        const flags = uint(bytes, trun.body + 1, 3);
        const count = uint(bytes, trun.body + 4, 4);
        let at = trun.body + 8;
        if (flags & 0x01) at += 4;
        if (flags & 0x04) at += 4;
        const stride = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
        if (at + count * stride > trun.end) return null;
        frames += count;
        for (let i = 0; i < count; i += 1) {
          timed += flags & 0x100 ? uint(bytes, at, 4) : fallback;
          at += stride;
        }
      }
    }
  }
  const seconds = Math.max(declared, timed / scale, (frames * 1_024) / rate);
  return seconds > 0 ? seconds : null;
}

/* ------------------------------------------------------------ any */

/** The recording's own length by its type, or `null` when it does not say. */
export function recordingSeconds(bytes: Uint8Array, mime: string): number | null {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if (type === "audio/webm") return webmSeconds(bytes);
  if (type === "audio/ogg") return oggOpusSeconds(bytes);
  if (type === "audio/mp4" || type === "audio/x-m4a") return mp4Seconds(bytes);
  return null;
}
