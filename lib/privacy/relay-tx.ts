/**
 * The programs a signed transaction calls, read from its bytes — for the relay's mainnet rule that `sendTransaction`
 * carries the ring's own transactions only (`relay-strict.ts`).
 *
 * Three wire shapes, as the SDK's own codec writes them (`@solana/kit` 8 inside `public/privacy/spr-*.mjs`):
 * - legacy and version 0 — the signatures first (a compact count, 64 bytes each), then the message;
 * - version 1 — the message first (`0x81`, the header, the config mask, the lifetime, the counts, the accounts, the
 *   config values, the instruction headers and payloads), its signatures after. The ring's transactions are version 1.
 *
 * Only the top-level instructions are read: what a program calls from inside is that program's business. A program is
 * always one of the message's own accounts — never one from a lookup table, which the runtime refuses anyway. Anything
 * this reader is not sure of — a short or long byte string, an unknown version or config bit, an index past the
 * accounts, a transaction without a signature — is null, and the relay refuses it. Pure: bytes in, a list or null out.
 */

export type TopInstruction = Readonly<{ program: string; data: Uint8Array }>;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bytes as base58 — a Solana address from its 32 bytes. */
export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

class Reader {
  private at = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get done(): boolean {
    return this.at === this.bytes.length;
  }
  peek(): number {
    if (this.at >= this.bytes.length) throw new RangeError('short');
    return this.bytes[this.at];
  }
  u8(): number {
    const value = this.peek();
    this.at += 1;
    return value;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  take(length: number): Uint8Array {
    if (length < 0 || this.at + length > this.bytes.length) throw new RangeError('short');
    const out = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }
  /** Solana's short vector length: seven bits a byte, at most three bytes, no wasted byte. */
  compact(): number {
    let value = 0;
    for (let i = 0; i < 3; i += 1) {
      const byte = this.u8();
      value |= (byte & 0x7f) << (7 * i);
      if ((byte & 0x80) === 0) {
        if (i > 0 && byte === 0) throw new RangeError('padded');
        if (value > 0xffff) throw new RangeError('long');
        return value;
      }
    }
    throw new RangeError('long');
  }
}

const SIGNATURE_BYTES = 64;
const ADDRESS_BYTES = 32;

/* Version 1's config mask (the codec's `configMask`): the priority fee takes both low bits and a u64; the compute
   unit limit, the loaded accounts' size limit and the heap size a bit and a u32 each. Any other bit is unknown. */
const CONFIG_FEE = 0b11;
const CONFIG_U32_BITS = [0b100, 0b1000, 0b1_0000] as const;
const CONFIG_KNOWN = 0b1_1111;

function signaturesFirst(reader: Reader): TopInstruction[] {
  const signatures = reader.compact();
  if (signatures === 0) throw new RangeError('unsigned');
  reader.take(signatures * SIGNATURE_BYTES);
  let version: 'legacy' | 0 = 'legacy';
  if (reader.peek() & 0x80) {
    if ((reader.u8() & 0x7f) !== 0) throw new RangeError('version');
    version = 0;
  }
  if (reader.u8() !== signatures) throw new RangeError('signers');
  reader.u8();
  reader.u8();
  const keys: Uint8Array[] = [];
  for (let n = reader.compact(); n > 0; n -= 1) keys.push(reader.take(ADDRESS_BYTES));
  reader.take(ADDRESS_BYTES);
  const out: TopInstruction[] = [];
  for (let n = reader.compact(); n > 0; n -= 1) {
    const index = reader.u8();
    reader.take(reader.compact());
    const data = reader.take(reader.compact());
    if (index >= keys.length) throw new RangeError('program');
    out.push({ program: base58(keys[index]), data });
  }
  if (version === 0) {
    for (let n = reader.compact(); n > 0; n -= 1) {
      reader.take(ADDRESS_BYTES);
      reader.take(reader.compact());
      reader.take(reader.compact());
    }
  }
  return out;
}

function messageFirst(reader: Reader): TopInstruction[] {
  reader.u8();
  const signatures = reader.u8();
  if (signatures === 0) throw new RangeError('unsigned');
  reader.u8();
  reader.u8();
  const mask = reader.u32();
  if (mask & ~CONFIG_KNOWN) throw new RangeError('config');
  const fee = mask & CONFIG_FEE;
  if (fee !== 0 && fee !== CONFIG_FEE) throw new RangeError('config');
  reader.take(ADDRESS_BYTES);
  const count = reader.u8();
  const keys: Uint8Array[] = [];
  for (let n = reader.u8(); n > 0; n -= 1) keys.push(reader.take(ADDRESS_BYTES));
  if (fee) reader.take(8);
  for (const bit of CONFIG_U32_BITS) if (mask & bit) reader.take(4);
  const heads: { index: number; accounts: number; bytes: number }[] = [];
  for (let n = 0; n < count; n += 1) heads.push({ index: reader.u8(), accounts: reader.u8(), bytes: reader.u16() });
  const out: TopInstruction[] = [];
  for (const head of heads) {
    reader.take(head.accounts);
    const data = reader.take(head.bytes);
    if (head.index >= keys.length) throw new RangeError('program');
    out.push({ program: base58(keys[head.index]), data });
  }
  reader.take(signatures * SIGNATURE_BYTES);
  return out;
}

/** The top-level instructions of a signed wire transaction, in order; null when the bytes are not one this reads. */
export function topInstructions(wire: Uint8Array): readonly TopInstruction[] | null {
  if (!(wire instanceof Uint8Array) || wire.length === 0) return null;
  const reader = new Reader(wire);
  try {
    const first = wire[0];
    let out: TopInstruction[];
    if ((first & 0x80) === 0) out = signaturesFirst(reader);
    else if ((first & 0x7f) === 1) out = messageFirst(reader);
    else return null;
    return reader.done ? out : null;
  } catch {
    return null;
  }
}
