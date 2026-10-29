import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Connection } from "@solana/web3.js";

import { getTransactionAnyVersion, transactionResponseOf } from "./v1-tx.ts";

/* A mainnet v1 transaction as a node answers it (MC-1, 25.10): inner instructions and token balances included. */
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/tx-v1-mainnet.json", import.meta.url), "utf8"));

/** A connection whose JSON-RPC is a table: what it was asked, and the one answer it gives. */
function nodeAnswering(body) {
  const connection = new Connection("http://node.invalid", "confirmed");
  const asked = [];
  connection._rpcRequest = async (method, args) => {
    asked.push({ method, args });
    return body;
  };
  return { connection, asked };
}

test("a v1 transaction reads in web3.js's own shape: keys, signers, instructions, the chain's record", async () => {
  const { connection, asked } = nodeAnswering({ jsonrpc: "2.0", id: 1, result: FIXTURE.result });
  const tx = await getTransactionAnyVersion(connection, FIXTURE.signature);
  assert.equal(asked[0].method, "getTransaction");
  assert.deepEqual(asked[0].args[1], { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 1 });
  assert.equal(tx.version, 1);
  assert.equal(tx.slot, FIXTURE.result.slot);
  assert.equal(tx.blockTime, FIXTURE.result.blockTime);
  const raw = FIXTURE.result.transaction.message;
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  assert.deepEqual(Array.from({ length: keys.length }, (_, at) => keys.get(at).toBase58()), raw.accountKeys);
  assert.equal(message.header.numRequiredSignatures, raw.header.numRequiredSignatures);
  assert.deepEqual(
    message.compiledInstructions.map((ix) => [ix.programIdIndex, [...ix.accountKeyIndexes]]),
    raw.instructions.map((ix) => [ix.programIdIndex, ix.accounts]),
  );
  /* Writable and signer flags come from the header, as on v0. */
  const signers = raw.header.numRequiredSignatures;
  assert.equal(message.isAccountSigner(0), true);
  assert.equal(message.isAccountSigner(signers), false);
  assert.equal(message.isAccountWritable(0), true);
  assert.equal(message.isAccountWritable(raw.accountKeys.length - 1), raw.header.numReadonlyUnsignedAccounts === 0);
  assert.deepEqual(tx.meta.innerInstructions, FIXTURE.result.meta.innerInstructions);
  assert.deepEqual(tx.meta.postTokenBalances, FIXTURE.result.meta.postTokenBalances);
  assert.deepEqual(tx.meta.preBalances, FIXTURE.result.meta.preBalances);
  assert.equal(tx.meta.err, null);
  assert.deepEqual(tx.transaction.signatures, [FIXTURE.signature]);
});

test("an instruction's data is its bytes, not its base58", () => {
  const tx = transactionResponseOf(FIXTURE.result);
  const first = tx.transaction.message.compiledInstructions[0];
  assert.ok(first.data instanceof Uint8Array);
  assert.ok(first.data.length < FIXTURE.result.transaction.message.instructions[0].data.length);
});

test("a v0 answer keeps its lookup tables and loaded keys", () => {
  const LOOKUP = "AddressLookupTab1e1111111111111111111111111";
  const LOADED = "SysvarRent111111111111111111111111111111111";
  const answer = {
    ...FIXTURE.result,
    version: 0,
    meta: { ...FIXTURE.result.meta, loadedAddresses: { writable: [], readonly: [LOADED] } },
    transaction: { ...FIXTURE.result.transaction, message: { ...FIXTURE.result.transaction.message, addressTableLookups: [{ accountKey: LOOKUP, writableIndexes: [], readonlyIndexes: [3] }] } },
  };
  const tx = transactionResponseOf(answer);
  assert.equal(tx.version, 0);
  assert.equal(tx.transaction.message.addressTableLookups[0].accountKey.toBase58(), LOOKUP);
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  assert.equal(keys.get(keys.length - 1).toBase58(), LOADED);
});

test("a version it does not know, or v1 naming lookup tables, is refused — never read as another", () => {
  assert.throws(() => transactionResponseOf({ ...FIXTURE.result, version: 2 }), /version 2/);
  const withLookups = { ...FIXTURE.result, transaction: { ...FIXTURE.result.transaction, message: { ...FIXTURE.result.transaction.message, addressTableLookups: [{ accountKey: "AddressLookupTab1e1111111111111111111111111", writableIndexes: [0], readonlyIndexes: [] }] } } };
  assert.throws(() => transactionResponseOf(withLookups), /lookup tables/);
});

test("a node that does not keep it is null; a refusal throws with the node's words", async () => {
  assert.equal(await getTransactionAnyVersion(nodeAnswering({ jsonrpc: "2.0", id: 1, result: null }).connection, FIXTURE.signature), null);
  const refused = nodeAnswering({ jsonrpc: "2.0", id: 1, error: { code: -32009, message: "Slot skipped" } }).connection;
  await assert.rejects(getTransactionAnyVersion(refused, FIXTURE.signature), /Slot skipped/);
});

test("a fake connection without JSON-RPC is asked as before", async () => {
  const asked = [];
  const fake = { getTransaction: async (signature, options) => (asked.push(options), null) };
  assert.equal(await getTransactionAnyVersion(fake, FIXTURE.signature, { commitment: "finalized" }), null);
  assert.deepEqual(asked, [{ commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
});

test("the Send lane's reader (receipts, /pay) asks for version 1 and reads a v1 transfer", async () => {
  const { observeTransfer } = await import("./observe.ts");
  const asked = [];
  const handle = {
    network: "mainnet",
    endpoints: [{ role: "primary", host: "solana.example" }],
    timeoutMs: 10,
    retries: 0,
    answered: () => ({ role: "primary", host: "solana.example" }),
    host: () => "solana.example",
    rpc: { getTransaction: (signature, options) => (asked.push(options), { send: async () => FIXTURE.result }) },
  };
  const read = await observeTransfer(handle, FIXTURE.signature);
  assert.equal(asked[0].maxSupportedTransactionVersion, 1);
  assert.equal(read.ok, true, read.reason);
  assert.equal(read.postTokenAccounts.length, FIXTURE.result.meta.postTokenBalances.length);
});
