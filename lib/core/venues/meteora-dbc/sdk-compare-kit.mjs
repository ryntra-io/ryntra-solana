/**
 * The comparison kit of SOL-L9: account bytes from a decoded snapshot, and a connection that answers only from them.
 * Used by `./sdk-compare.test.mjs` and by `scripts/launch-qa/dbc-sdk-fixtures.mjs`, which writes the fixture.
 *
 * Nothing here reaches a network: an account the fixture does not hold reads as absent, and any request the kit does
 * not know throws with its name, so a build never silently depends on a live node.
 */

import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const UNSIGNED = new Set(["u8", "u16", "u32", "i8", "i16", "i32"]);
const WIDE = new Set(["u64", "u128", "i64", "i128"]);
const camel = (name) => name.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

/**
 * A decoded account's plain JSON (numbers as strings, keys as base58, padding left out) back into the shape the
 * IDL's coder encodes: each field by its IDL type, a field the snapshot left out — padding — as zeros.
 */
export function typedFromPlain(idl, typeName, plain) {
  const types = new Map(idl.types.map((entry) => [entry.name, entry.type]));
  const walk = (type, value) => {
    if (typeof type === "string") {
      if (UNSIGNED.has(type)) return Number(value ?? 0);
      if (WIDE.has(type)) return new BN(String(value ?? "0"));
      if (type === "bool") return Boolean(value);
      if (type === "pubkey") return new PublicKey(value ?? PublicKey.default);
      throw new Error(`No mapping for the IDL type ${type}.`);
    }
    if (type.option) return value === null || value === undefined ? null : walk(type.option, value);
    if (type.vec) return (Array.isArray(value) ? value : []).map((inner) => walk(type.vec, inner));
    if (type.array) {
      const [inner, length] = type.array;
      return Array.from({ length }, (_, index) => walk(inner, Array.isArray(value) ? value[index] : undefined));
    }
    if (type.defined) return walk(types.get(type.defined.name), value);
    /* The raw IDL coder names fields as the IDL does (snake case); the snapshot, as the SDK's program does (camel case). */
    if (type.kind === "struct") return Object.fromEntries(type.fields.map((field) => [field.name, walk(field.type, value?.[camel(field.name)])]));
    throw new Error(`No mapping for the IDL type ${JSON.stringify(type)}.`);
  };
  return walk({ defined: { name: typeName } }, plain);
}

/** An account's bytes for the IDL's account `name`, from the snapshot's plain JSON. */
export function encodeAccount(idl, name, plain) {
  const coder = new BorshAccountsCoder(idl);
  const typed = typedFromPlain(idl, name, plain);
  /* Anchor's own `encode` writes into a thousand bytes; a config is larger, so its layout writes into its full size. */
  const layout = coder.accountLayouts.get(name);
  if (!layout) throw new Error(`Unknown account: ${name}`);
  const body = Buffer.alloc(coder.size(name));
  const length = layout.layout.encode(typed, body);
  return Buffer.concat([coder.accountDiscriminator(name), body.subarray(0, length)]);
}

/** A plain SPL or Token-2022 mint account: no authorities, the supply and decimals given, initialized. */
export function mintAccount(supplyRaw, decimals) {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(BigInt(supplyRaw), 36);
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45);
  return data;
}

/**
 * A connection that answers from `accounts` ({ address: { owner, lamports, data: Buffer } }) and nothing else. It
 * records every request it was asked, so a test can say which reads a build made.
 */
export function fixtureConnection(accounts, options = {}) {
  const asked = [];
  const info = (key) => {
    const entry = accounts[new PublicKey(key).toBase58()];
    if (!entry) return null;
    return { owner: new PublicKey(entry.owner), lamports: entry.lamports ?? 1_000_000_000, data: Buffer.from(entry.data), executable: false, rentEpoch: 0 };
  };
  const slot = options.slot ?? 400_000_000;
  const known = {
    rpcEndpoint: "fixture://sol-l9",
    commitment: "confirmed",
    async getAccountInfo(key) {
      asked.push(["getAccountInfo", new PublicKey(key).toBase58()]);
      return info(key);
    },
    async getAccountInfoAndContext(key) {
      asked.push(["getAccountInfoAndContext", new PublicKey(key).toBase58()]);
      return { context: { slot }, value: info(key) };
    },
    async getMultipleAccountsInfo(keys) {
      asked.push(["getMultipleAccountsInfo", keys.map((key) => new PublicKey(key).toBase58()).join(",")]);
      return keys.map(info);
    },
    async getMultipleAccountsInfoAndContext(keys) {
      asked.push(["getMultipleAccountsInfoAndContext", keys.map((key) => new PublicKey(key).toBase58()).join(",")]);
      return { context: { slot }, value: keys.map(info) };
    },
    async getLatestBlockhash() {
      asked.push(["getLatestBlockhash"]);
      return { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 };
    },
    async getSlot() {
      asked.push(["getSlot"]);
      return slot;
    },
    async getEpochInfo() {
      asked.push(["getEpochInfo"]);
      return { epoch: options.epoch ?? 900, slotIndex: 0, slotsInEpoch: 432_000, absoluteSlot: slot, blockHeight: slot, transactionCount: 0 };
    },
    async getMinimumBalanceForRentExemption(size) {
      asked.push(["getMinimumBalanceForRentExemption", String(size)]);
      return (size + 128) * 6_960;
    },
  };
  const connection = new Proxy(known, {
    get(target, property) {
      if (property in target) return target[property];
      /* No raw JSON-RPC: a transaction is read through `getTransaction`, as a fake connection is (`getTransactionAnyVersion`). */
      if (property === "then" || property === "_rpcRequest" || typeof property === "symbol") return undefined;
      return () => {
        throw new Error(`The fixture connection does not answer ${String(property)}.`);
      };
    },
  });
  return { connection, asked };
}

/** An instruction as plain data: its program, its accounts with their roles, and its bytes. */
export const plainInstruction = (ix) => ({
  program: ix.programId.toBase58(),
  keys: ix.keys.map((key) => `${key.pubkey.toBase58()}:${key.isSigner ? "s" : "-"}${key.isWritable ? "w" : "-"}`),
  data: Buffer.from(ix.data).toString("hex"),
});

/** A value with every BN and key as a string, for a deep comparison across two SDK copies' classes. */
export function plainValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (BN.isBN(value) || value?.constructor?.name === "BN") return value.toString();
  if (value instanceof PublicKey || (typeof value?.toBase58 === "function" && value?._bn)) return value.toBase58();
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plainValue(inner)]));
  return value;
}
