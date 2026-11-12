import assert from "node:assert/strict";
import test from "node:test";

import { Connection, Keypair } from "@solana/web3.js";

import { createLaunchMarketReader } from "./market.server.ts";

/*
 * CITY-245: a launch's trade list finds its signatures through Helius's scan where there is one, and pages the node as
 * before when the scan fails or is absent. The transactions are read and decoded here either way.
 */

const TOKEN = Keypair.generate().publicKey.toBase58();
const CURVE = Keypair.generate().publicKey.toBase58();
const sig = (n) => `${"4".repeat(80)}${String(n).padStart(8, "2")}`.replace(/0/gu, "2");
const CREATION = sig(0);

function node() {
  const connection = new Connection("http://127.0.0.1:9");
  const asked = { lists: [], transactions: [] };
  connection.getSignaturesForAddress = async (address, options) => {
    asked.lists.push({ address: address.toBase58(), ...options });
    return [{ signature: sig(7), slot: 7, err: null, memo: null, blockTime: 1_790_000_007 }, { signature: CREATION, slot: 1, err: null, memo: null, blockTime: 1_790_000_001 }];
  };
  /* No transaction is known: each decode is a gap, so the test sees which signatures were asked. */
  connection._rpcRequest = async (method, params) => {
    asked.transactions.push(params[0]);
    return { result: null };
  };
  return { connection, asked };
}

const PROGRAMS = { programs: [{ programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", scope: "transaction" }, { programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", scope: "transaction" }] };
const market = { curve: { pool: CURVE, creator: Keypair.generate().publicKey.toBase58() }, graduated: null };

function scanOf(answer) {
  const asked = [];
  return {
    asked,
    scan: {
      host: "mainnet.helius-rpc.com",
      async signatures(query) {
        asked.push(query);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

test("the trade list takes its signatures from the scan, filtered to the curve's and the pool's programs, and never pages the node", async () => {
  const { connection, asked } = node();
  const entries = [sig(9), sig(8), CREATION].map((signature, index) => ({ signature, slot: 9 - index, blockTime: 1_790_000_009 - index, err: null, memo: null }));
  const { scan, asked: scanned } = scanOf({ entries, whole: true, calls: 1, scanned: 3, credits: 11 });
  const reader = createLaunchMarketReader(connection, { scan });
  const history = await reader.trades({ token: TOKEN, state: market, creationSignature: CREATION, limit: 300, budgetMs: 500 });
  assert.equal(asked.lists.length, 0, "the node's signature list is not asked");
  assert.equal(scanned.length, 1);
  const { until, ...asked1 } = scanned[0];
  assert.deepEqual(asked1, { address: CURVE, match: PROGRAMS, before: undefined, limit: 300 });
  assert.ok(until > Date.now() - 1_000 && until <= Date.now() + 250, "the listing has half the read's budget");
  assert.deepEqual(new Set(asked.transactions), new Set([CREATION, sig(9), sig(8)]));
  assert.equal(asked.transactions[0], CREATION, "the creation is read first");
  assert.equal(history.gaps.length, 3);
});

test("a scan that fails leaves the list to the node, as before", async () => {
  const { connection, asked } = node();
  const { scan, asked: scanned } = scanOf(new Error("HTTP 503"));
  const reader = createLaunchMarketReader(connection, { scan });
  await reader.trades({ token: TOKEN, state: market, creationSignature: CREATION, limit: 300, budgetMs: 500 });
  assert.equal(scanned.length, 1);
  assert.deepEqual(asked.lists, [{ address: CURVE, limit: 300 }]);
  assert.deepEqual(new Set(asked.transactions), new Set([CREATION, sig(7)]));
});

test("without a scan — devnet, another provider — the node is paged exactly as before", async () => {
  const { connection, asked } = node();
  const reader = createLaunchMarketReader(connection, {});
  await reader.trades({ token: TOKEN, state: market, creationSignature: CREATION, limit: 300, budgetMs: 500 });
  assert.deepEqual(asked.lists, [{ address: CURVE, limit: 300 }]);
});

test("a short list from the scan is the account's whole history: a wallet's own trades read whole", async () => {
  const { connection } = node();
  const account = Keypair.generate().publicKey.toBase58();
  const { scan, asked } = scanOf({ entries: [{ signature: sig(5), slot: 5, blockTime: 1_790_000_005, err: null, memo: null }], whole: true, calls: 1, scanned: 1, credits: 10 });
  const reader = createLaunchMarketReader(connection, { scan });
  const read = await reader.accountTrades({ token: TOKEN, state: market, accounts: [account], since: 1_790_000_000, budgetMs: 300 });
  assert.equal(asked[0].address, account);
  assert.deepEqual(asked[0].match, { ...PROGRAMS, mints: [{ mint: TOKEN, scope: "transaction" }] }, "the programs ran and this token moved");
  assert.deepEqual(asked[0].time, { gte: 1_790_000_000 }, "the wallet's window, not its whole history");
  /* The page is whole (short, from the scan); only the transaction's own read is missing. */
  assert.equal(read.complete, false);
  const none = scanOf({ entries: [], whole: true, calls: 1, scanned: 0, credits: 10 });
  const empty = await createLaunchMarketReader(connection, { scan: none.scan }).accountTrades({ token: TOKEN, state: market, accounts: [account], since: 1_790_000_100, budgetMs: 300 });
  assert.equal(empty.complete, true, "an account the token never moved through is whole with no trades");
  assert.deepEqual(empty.trades, []);
});

test("a window of the market follows the scan's pages back past its start, by the signature before", async () => {
  const { connection } = node();
  const page = (from, count, time) => Array.from({ length: count }, (_, i) => ({ signature: sig(from + i), slot: 10_000 - from - i, blockTime: time - i, err: null, memo: null }));
  const answers = [
    { entries: page(100, 1_000, 1_790_010_000), whole: false },
    { entries: page(2_000, 3, 1_789_000_000), whole: true },
  ];
  const asked = [];
  const scan = { host: "mainnet.helius-rpc.com", signatures: async (query) => (asked.push(query), answers[asked.length - 1]) };
  await createLaunchMarketReader(connection, { scan }).windowTrades({ token: TOKEN, state: market, from: 1_789_500_000, to: 1_790_100_000, budgetMs: 200 });
  assert.equal(asked.length, 2);
  assert.equal(asked[1].before, sig(1_099));
  assert.equal(asked[1].limit, 1_000);
});
