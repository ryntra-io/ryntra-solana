/**
 * A Solana RPC answered from accounts in hand: the one transport behind the venue's tests and its rehearsal.
 *
 * The venue and the SDK read through a real `Connection`; here its JSON-RPC transport is replaced by a function that
 * answers from a **source** of accounts and nothing else — a snapshot frozen in a fixture (`snapshotSource`, the
 * tests), or a local SVM that also executes (`scripts/launch-qa/dlmm-pro-svm.mjs`, the rehearsal). So the tests run the
 * real decoding, quoting and building on recorded state with no network, and the rehearsal's reads go through the same
 * answers a node would give.
 *
 * A method the kit does not know fails loudly with its name, so nothing passes on an answer it did not have. An
 * indexed request — `getProgramAccounts`, `getTokenAccountsByOwner` — is answered from the addresses the source lists:
 * a source lists what it has seen, which for a snapshot is everything.
 *
 * Nothing here reaches a network.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

import { Connection, PublicKey } from "@solana/web3.js";
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

const base58 = getBase58Decoder();
const fromBase58 = getBase58Encoder();
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
/**
 * Lamports of rent for an account of `size` bytes, as mainnet charged on 14.11.2026: 5 080 a byte with 128 bytes of
 * overhead (its Rent sysvar; the 6 960 older documents quote is no longer the rate). A source that executes answers
 * with its own.
 */
export const rentOf = (size) => (size + 128) * 5_080;

/** Bytes as base58, and back. */
export const toBase58 = (bytes) => base58.decode(Uint8Array.from(bytes));
export const bytesOfBase58 = (text) => Buffer.from(fromBase58.encode(text));

const encodeAccount = (account, slice) => {
  if (!account) return null;
  const all = Buffer.from(account.data);
  const data = slice ? all.subarray(slice.offset, slice.offset + slice.length) : all;
  return { lamports: account.lamports, owner: account.owner, data: [data.toString("base64"), "base64"], executable: Boolean(account.executable), rentEpoch: 0, space: all.length };
};

function matches(account, filters = []) {
  for (const filter of filters) {
    if (filter.dataSize !== undefined && account.data.length !== filter.dataSize) return false;
    if (filter.memcmp) {
      const want = filter.memcmp.encoding === "base64" ? Buffer.from(filter.memcmp.bytes, "base64") : bytesOfBase58(filter.memcmp.bytes);
      if (!Buffer.from(account.data).subarray(filter.memcmp.offset, filter.memcmp.offset + want.length).equals(want)) return false;
    }
  }
  return true;
}

/**
 * A `Connection` whose every request is answered from `source`:
 *
 * - `account(address)` → `{ owner, lamports, data, executable }` or null;
 * - `addresses()` → the addresses an indexed request may be answered from;
 * - `clock()` → `{ slot, unix, epoch }`;
 * - optionally `blockhash()`, `send(bytes, options)`, `simulate(bytes, options)`, `transaction(signature)` and
 *   `status(signature)` — a source that executes.
 */
export function rpcConnection(source) {
  const asked = [];
  const context = () => ({ slot: Number(source.clock().slot) });
  const account = (address) => source.account(address);
  const owned = (program, filters, slice) =>
    source
      .addresses()
      .map((address) => ({ address, account: account(address) }))
      .filter((entry) => entry.account && entry.account.owner === program && matches(entry.account, filters))
      .map((entry) => ({ pubkey: entry.address, account: encodeAccount(entry.account, slice) }));

  const answer = (method, params = []) => {
    asked.push(method);
    switch (method) {
      case "getAccountInfo":
        return { context: context(), value: encodeAccount(account(params[0]), params[1]?.dataSlice) };
      case "getMultipleAccounts":
        return { context: context(), value: params[0].map((address) => encodeAccount(account(address), params[1]?.dataSlice)) };
      case "getBalance":
        return { context: context(), value: account(params[0])?.lamports ?? 0 };
      case "getMinimumBalanceForRentExemption":
        return source.rent ? source.rent(params[0]) : rentOf(params[0]);
      case "getLatestBlockhash":
        return { context: context(), value: source.blockhash ? source.blockhash() : { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: Number(source.clock().slot) + 150 } };
      case "getSlot":
      case "getBlockHeight":
        return Number(source.clock().slot);
      case "getBlockTime":
        return Number(source.clock().unix);
      case "getEpochInfo":
        return { epoch: Number(source.clock().epoch), slotIndex: 0, slotsInEpoch: 432_000, absoluteSlot: Number(source.clock().slot), blockHeight: Number(source.clock().slot), transactionCount: 0 };
      case "getGenesisHash":
        return "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
      case "getRecentPrioritizationFees":
        return [];
      case "getProgramAccounts": {
        const list = owned(params[0], params[1]?.filters, params[1]?.dataSlice);
        return params[1]?.withContext ? { context: context(), value: list } : list;
      }
      case "getTokenAccountsByOwner": {
        const owner = bytesOfBase58(params[0]);
        const mint = params[1]?.mint ? bytesOfBase58(params[1].mint) : null;
        const programs = params[1]?.programId ? [params[1].programId] : TOKEN_PROGRAMS;
        const value = programs.flatMap((program) =>
          owned(program, [{ memcmp: { offset: 32, bytes: params[0] } }]).filter((entry) => {
            const data = Buffer.from(entry.account.data[0], "base64");
            return data.length >= 72 && data.subarray(32, 64).equals(owner) && (!mint || data.subarray(0, 32).equals(mint));
          }),
        );
        return { context: context(), value };
      }
      case "sendTransaction":
        if (!source.send) break;
        return source.send(Buffer.from(params[0], params[1]?.encoding === "base64" ? "base64" : undefined), params[1] ?? {});
      case "simulateTransaction":
        if (!source.simulate) break;
        return { context: context(), value: source.simulate(Buffer.from(params[0], "base64"), params[1] ?? {}) };
      case "getTransaction":
        if (!source.transaction) break;
        return source.transaction(params[0]);
      case "getSignatureStatuses":
        if (!source.status) break;
        return { context: context(), value: params[0].map((signature) => source.status(signature)) };
      default:
        break;
    }
    throw Object.assign(new Error(`The fixture connection does not answer ${method}.`), { rpcCode: -32601 });
  };

  const respond = (request) => {
    try {
      return { jsonrpc: "2.0", id: request.id, result: answer(request.method, request.params ?? []) };
    } catch (error) {
      return { jsonrpc: "2.0", id: request.id, error: { code: error.rpcCode ?? -32603, message: error.message, ...(error.rpcData ? { data: error.rpcData } : {}) } };
    }
  };
  const fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = Array.isArray(body) ? body.map(respond) : respond(body);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  /* The endpoint is never dialled: every request is answered before it leaves. */
  const connection = new Connection("http://127.0.0.1:9", { commitment: "confirmed", fetch, disableRetryOnRateLimit: true });
  return Object.assign(connection, { asked });
}

/**
 * A source over a snapshot: `{ clock: { slot, unix, epoch }, accounts: { address: { owner, lamports, data (base64) } }, transactions? }`.
 * A snapshot executes nothing: a simulation is answered only where the caller says what the node would say
 * (`simulate(bytes) → { err, logs }`), and fails loudly otherwise.
 */
export function snapshotSource(snapshot, transactions = {}, simulate = null) {
  const accounts = new Map(Object.entries(snapshot.accounts).map(([address, entry]) => [address, { owner: entry.owner, lamports: entry.lamports, executable: false, data: Buffer.from(entry.data, "base64") }]));
  return {
    account: (address) => accounts.get(address) ?? null,
    addresses: () => [...accounts.keys()],
    clock: () => ({ slot: BigInt(snapshot.clock.slot), unix: BigInt(snapshot.clock.unix), epoch: BigInt(snapshot.clock.epoch) }),
    transaction: (signature) => transactions[signature] ?? null,
    ...(simulate ? { simulate } : {}),
  };
}

/** The Clock sysvar's bytes for a clock: slot, epoch start, epoch, leader schedule epoch, unix timestamp. */
export function clockAccount(clock) {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(BigInt(clock.slot), 0);
  data.writeBigInt64LE(BigInt(clock.unix), 8);
  data.writeBigUInt64LE(BigInt(clock.epoch), 16);
  data.writeBigUInt64LE(BigInt(clock.epoch) + 1n, 24);
  data.writeBigInt64LE(BigInt(clock.unix), 32);
  return { owner: "Sysvar1111111111111111111111111111111111111", lamports: rentOf(40), executable: false, data };
}

export const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";

/** A fixture file — JSON, gzipped — read and written. */
export const readFixture = (url) => JSON.parse(gunzipSync(readFileSync(url)).toString("utf8"));
export const writeFixture = (path, value) => writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }));
