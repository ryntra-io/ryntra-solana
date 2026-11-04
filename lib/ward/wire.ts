/**
 * Reading what was pasted as a Solana transaction: canonical base64 of a wire transaction (signed or not), or of a
 * bare message. Legacy and v0 messages are read; anything else is refused by name rather than half-read.
 *
 * The check never needs a signature and never sees a key: signatures, where the bytes carry any, are only counted.
 */

import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

/** A transaction over this many bytes cannot be sent on Solana, so it is not a transaction to check. */
export const MAX_WIRE_BYTES = 1_232;

export type WireInstruction = Readonly<{
  programIndex: number;
  accountIndices: readonly number[];
  data: Uint8Array;
}>;

export type WireLookup = Readonly<{ table: string; writable: readonly number[]; readonly: readonly number[] }>;

export type WireMessage = Readonly<{
  version: "legacy" | 0;
  header: Readonly<{ signers: number; readonlySigners: number; readonlyNonSigners: number }>;
  staticAccounts: readonly string[];
  /** The blockhash, or — under a durable nonce — the nonce's value. */
  lifetime: string;
  instructions: readonly WireInstruction[];
  lookups: readonly WireLookup[];
  /** Signatures the bytes already carry (non-zero), out of the signers the message needs. */
  signed: number;
  /** The bytes as they would go to a simulation: always a full wire transaction. */
  wireBase64: string;
}>;

export type WireRead = Readonly<{ ok: true; message: WireMessage }> | Readonly<{ ok: false; why: string }>;

export function decodeBase64(value: string): Uint8Array | null {
  const text = value.replace(/\s+/g, "");
  if (text.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const bytes = Buffer.from(text, "base64");
  /* Node tolerates malformed tails; re-encoding proves the text was the bytes. */
  if (bytes.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "")) return null;
  return new Uint8Array(bytes);
}

type Compiled = Readonly<{
  version: unknown;
  header: Readonly<{ numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number }>;
  staticAccounts: readonly string[];
  lifetimeToken: string;
  instructions: readonly Readonly<{ programAddressIndex: number; accountIndices?: readonly number[]; data?: Uint8Array }>[];
  addressTableLookups?: readonly Readonly<{ lookupTableAddress: string; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] }>[];
}>;

/** A compact-u16 length prefix, as a wire transaction writes its signature count. */
function compactU16(length: number): Uint8Array {
  const out: number[] = [];
  let rest = length;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function fromCompiled(compiled: Compiled, signed: number, wire: Uint8Array): WireRead {
  const version = compiled.version;
  if (version !== "legacy" && version !== 0) return { ok: false, why: `Message version ${String(version)} is not read by this check.` };
  if (compiled.instructions.length === 0) return { ok: false, why: "The transaction carries no instructions." };
  const accounts = compiled.staticAccounts.map(String);
  const lookups = (compiled.addressTableLookups ?? []).map((lookup) => ({
    table: String(lookup.lookupTableAddress),
    writable: [...lookup.writableIndexes],
    readonly: [...lookup.readonlyIndexes],
  }));
  const total = accounts.length + lookups.reduce((sum, lookup) => sum + lookup.writable.length + lookup.readonly.length, 0);
  for (const instruction of compiled.instructions) {
    if (instruction.programAddressIndex >= accounts.length) return { ok: false, why: "An instruction names a program outside the message's own accounts." };
    if ((instruction.accountIndices ?? []).some((index) => index >= total)) return { ok: false, why: "An instruction names an account the message does not carry." };
  }
  return {
    ok: true,
    message: {
      version,
      header: {
        signers: compiled.header.numSignerAccounts,
        readonlySigners: compiled.header.numReadonlySignerAccounts,
        readonlyNonSigners: compiled.header.numReadonlyNonSignerAccounts,
      },
      staticAccounts: accounts,
      lifetime: String(compiled.lifetimeToken),
      instructions: compiled.instructions.map((instruction) => ({
        programIndex: instruction.programAddressIndex,
        accountIndices: [...(instruction.accountIndices ?? [])],
        data: instruction.data ? new Uint8Array(instruction.data) : new Uint8Array(0),
      })),
      lookups,
      signed,
      wireBase64: Buffer.from(wire).toString("base64"),
    },
  };
}

/**
 * Read pasted base64 as a wire transaction, or — where it is not one — as a bare message, which is then wrapped with
 * empty signatures so it can be simulated as the transaction it describes.
 */
export function readWire(base64: string): WireRead {
  const bytes = decodeBase64(base64);
  if (!bytes) return { ok: false, why: "This is not canonical base64." };
  if (bytes.byteLength > MAX_WIRE_BYTES + 64 * 65) return { ok: false, why: `This is larger than any Solana transaction (${MAX_WIRE_BYTES} bytes).` };
  try {
    const decoded = getTransactionDecoder().decode(bytes) as unknown as Readonly<{
      messageBytes: Uint8Array;
      signatures: Readonly<Record<string, Uint8Array | null>>;
    }>;
    const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as unknown as Compiled;
    const signed = Object.values(decoded.signatures).filter((signature) => signature && signature.some((byte) => byte !== 0)).length;
    if (bytes.byteLength > MAX_WIRE_BYTES) return { ok: false, why: `This is larger than any Solana transaction (${MAX_WIRE_BYTES} bytes).` };
    return fromCompiled(compiled, signed, bytes);
  } catch {
    /* Not a wire transaction: perhaps the message alone. */
  }
  try {
    const compiled = getCompiledTransactionMessageDecoder().decode(bytes) as unknown as Compiled;
    const count = compiled.header.numSignerAccounts;
    const wire = new Uint8Array([...compactU16(count), ...new Uint8Array(64 * count), ...bytes]);
    if (wire.byteLength > MAX_WIRE_BYTES) return { ok: false, why: `This is larger than any Solana transaction (${MAX_WIRE_BYTES} bytes).` };
    return fromCompiled(compiled, 0, wire);
  } catch {
    return { ok: false, why: "These bytes do not read as a Solana transaction or message." };
  }
}

/** Whether the account at a message index may be written, by the header's own arithmetic. */
export function isWritableIndex(message: WireMessage, index: number): boolean {
  const statics = message.staticAccounts.length;
  if (index < statics) {
    const { signers, readonlySigners, readonlyNonSigners } = message.header;
    if (index < signers) return index < signers - readonlySigners;
    return index < statics - readonlyNonSigners;
  }
  let at = statics;
  for (const lookup of message.lookups) {
    if (index < at + lookup.writable.length) return true;
    at += lookup.writable.length;
  }
  return false;
}

/** The message's signers, in order. The first pays the fee. */
export function signersOf(message: WireMessage): readonly string[] {
  return message.staticAccounts.slice(0, message.header.signers);
}

/**
 * Every account key in the order instructions index them: the static keys, then each table's writable keys, then each
 * table's read-only keys. `tables` maps a lookup table to its addresses; a table not read leaves its keys `null`.
 */
export function accountKeysOf(message: WireMessage, tables: ReadonlyMap<string, readonly string[]>): readonly (string | null)[] {
  const keys: (string | null)[] = [...message.staticAccounts];
  for (const lookup of message.lookups) {
    const table = tables.get(lookup.table);
    for (const index of lookup.writable) keys.push(table?.[index] ?? null);
  }
  for (const lookup of message.lookups) {
    const table = tables.get(lookup.table);
    for (const index of lookup.readonly) keys.push(table?.[index] ?? null);
  }
  return keys;
}

/** The addresses an address lookup table holds: a 56-byte header, then 32 bytes per address. */
export function decodeLookupTable(data: Uint8Array, encode: (bytes: Uint8Array) => string): readonly string[] | null {
  const HEADER = 56;
  if (data.length < HEADER || (data.length - HEADER) % 32 !== 0) return null;
  const out: string[] = [];
  for (let at = HEADER; at < data.length; at += 32) out.push(encode(data.subarray(at, at + 32)));
  return out;
}
