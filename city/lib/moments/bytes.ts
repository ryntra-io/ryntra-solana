/**
 * The few byte tools a challenge link needs: a growing writer and a bounds-checked reader (fixed numbers, varints,
 * zigzag varints), base64url for the address bar, and raw deflate through the browser's own streams.
 * Everything a link carries is untrusted: the reader throws on any read past the end, and inflate stops at a cap.
 */

export class ByteWriter {
  private buf = new Uint8Array(256);
  private len = 0;

  private room(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): this {
    this.room(1);
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    return this.u8(v >>> 8).u8(v);
  }

  u32(v: number): this {
    return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }

  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }

  f32(v: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, v);
    return this.bytes(new Uint8Array(view.buffer));
  }

  f64(v: number): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, v);
    return this.bytes(new Uint8Array(view.buffer));
  }

  /** An unsigned integer in 7-bit groups, small numbers in one byte. */
  varint(v: number): this {
    let n = Math.max(0, Math.floor(v));
    while (n >= 0x80) {
      this.u8((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    return this.u8(n);
  }

  /** A signed integer folded so that small magnitudes of either sign stay small. */
  svarint(v: number): this {
    const n = Math.round(v);
    return this.varint(n >= 0 ? n * 2 : -n * 2 - 1);
  }

  /** Text as UTF-8 with its length first. */
  text(s: string): this {
    const bytes = new TextEncoder().encode(s);
    return this.varint(bytes.length).bytes(bytes);
  }

  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export class ByteReader {
  readonly buf: Uint8Array;
  private at = 0;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get left(): number {
    return this.buf.length - this.at;
  }

  private need(n: number) {
    if (this.at + n > this.buf.length) throw new RangeError('link data ends early');
  }

  u8(): number {
    this.need(1);
    return this.buf[this.at++]!;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) >>> 0) + ((this.u8() << 16) | (this.u8() << 8) | this.u8());
  }

  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  f32(): number {
    return new DataView(this.take(4).slice().buffer).getFloat32(0);
  }

  f64(): number {
    return new DataView(this.take(8).slice().buffer).getFloat64(0);
  }

  varint(): number {
    let n = 0;
    let scale = 1;
    for (let i = 0; i < 8; i += 1) {
      const b = this.u8();
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
    }
    throw new RangeError('varint too long');
  }

  svarint(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  text(max: number): string {
    const n = this.varint();
    if (n > max) throw new RangeError('text too long');
    return new TextDecoder().decode(this.take(n));
  }

  take(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}

/** Bytes as URL-safe base64 without padding: letters, digits, '-' and '_' only. */
export function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pump(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new RangeError('link data too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function through(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, max: number): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  return pump(source.pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>), max);
}

export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('deflate-raw'), 1 << 20);
}

/** Inflates at most `max` bytes, so a crafted link cannot make the page swallow megabytes. */
export function inflate(bytes: Uint8Array, max = 64 * 1024): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('deflate-raw'), max);
}
