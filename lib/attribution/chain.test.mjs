// Run from repo root: node --test lib/attribution/chain.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { associatedTokenAccount, feeIdentitiesToRead, readAttributionFromChain, resetAttributionMemory, within } from "./chain.server.ts";

const REFERRAL = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";

test("a fee wallet is read by its canonical accounts: the derivation gives the referral account's own token accounts", async () => {
  assert.equal(await associatedTokenAccount(REFERRAL, "So11111111111111111111111111111111111111112"), "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY");
  assert.equal(await associatedTokenAccount(REFERRAL, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "55p9Zk8tzq6YhnPgopW5X1sX5kHX1v1zuRiQNwqa5hYH");
});

test("the deployment's referral account is read under the published id only when it is the published one", () => {
  const registry = [{ id: "solana-jupiter-referral", address: REFERRAL, kind: "JUPITER_REFERRAL_ACCOUNT", endSlot: null }];
  assert.deepEqual(feeIdentitiesToRead(REFERRAL, registry).map((owner) => owner.id), ["solana-jupiter-referral"]);
  assert.deepEqual(feeIdentitiesToRead(null, registry).map((owner) => [owner.id, owner.address]), [["solana-jupiter-referral", REFERRAL]], "no deployment account: the published one");
  const other = "Other11111111111111111111111111111111111111";
  assert.deepEqual(feeIdentitiesToRead(other, registry).map((owner) => owner.id), ["solana-jupiter-referral-deployment"], "another account never lends its start to the published row");
});

test("within answers the promise, or the fallback once the time is spent", async () => {
  assert.equal(await within(Promise.resolve(1), 1000, "late"), 1);
  assert.equal(await within(new Promise(() => {}), 20, "late"), "late");
  assert.equal(await within(Promise.resolve(1), 0, "late"), "late", "no time left: nothing is waited for");
});

/** A chain whose transactions answer only for the first `answering` signatures; the rest never answer. */
function stubChain(answering) {
  const signatures = Array.from({ length: 8 }, (_, index) => ({ signature: `sig${index}`, slot: 100 + index, blockTime: 1_700_000_000 + index, err: null }));
  const account = { pubkey: "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY", account: { data: { parsed: { info: { mint: "So11111111111111111111111111111111111111112", tokenAmount: { amount: "0", decimals: 9 } } } } } };
  let tokenCalls = 0;
  return async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
    if (method === "getTokenAccountsByOwner") return answer({ value: tokenCalls++ % 2 === 0 ? [account] : [] });
    if (method === "getSignaturesForAddress") return answer(signatures);
    if (method === "getTransaction") {
      const index = signatures.findIndex((entry) => entry.signature === params[0]);
      if (index >= answering) return new Promise(() => {});
      return answer({ slot: 100 + index, blockTime: 1_700_000_000 + index, meta: { err: null, preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [] }, transaction: { message: { accountKeys: [{ pubkey: "Taker111111111111111111111111111111111111111", signer: true }] } } });
    }
    return answer(null);
  };
}

test("a transaction that never answers is not waited for past the hard stop: the read answers partial, never complete", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    resetAttributionMemory();
  });
  resetAttributionMemory();
  globalThis.fetch = stubChain(4);
  const began = Date.now();
  const read = await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [], deadlineMs: 60_000, hardStopMs: 3_000 });
  assert.ok(Date.now() - began < 10_000, "the read returns at the hard stop, not after the endpoints' timeouts");
  assert.equal(read.ok, true);
  assert.equal(read.coverage.transactionsRead, 4);
  assert.equal(read.coverage.transactionsMissing, 4);
  assert.equal(read.coverage.truncated, true);
  assert.equal(read.coverage.complete, false);
});

test("a read whose time runs out before any transaction answers says so", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    resetAttributionMemory();
  });
  resetAttributionMemory();
  globalThis.fetch = stubChain(0);
  const read = await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [], deadlineMs: 60_000, hardStopMs: 2_000 });
  assert.equal(read.ok, false);
  assert.equal(read.code, "UNREADABLE");
  assert.match(read.reason, /time ran out/);
});

/* CITY-245: where the primary node is Helius on mainnet, each fee account's signatures come from its scan first. */

const SCAN_KEY = "0123abcd-4567-89ef-0123-456789abcdef";
const scanSig = (n) => `${"3".repeat(84)}${n + 1}`;

/** A Helius node: the scan answers `scanStatus` (200 with the signatures by default), the JSON-RPC as `stubChain`. */
function heliusChain({ scanStatus = 200, balance = "0" } = {}) {
  const asked = { scans: [], lists: 0 };
  const signatures = [0, 1, 2].map((n) => ({ signature: scanSig(n), slot: 200 + n, transactionIndex: 0, blockTime: 1_700_000_100 + n }));
  const account = { pubkey: "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY", account: { data: { parsed: { info: { mint: "So11111111111111111111111111111111111111112", tokenAmount: { amount: balance, decimals: 9 } } } } } };
  let tokenCalls = 0;
  const fetch = async (url, init) => {
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).includes("/v1/parsed-events/scan")) {
      asked.scans.push(JSON.parse(init.body));
      if (scanStatus !== 200) return new Response("{}", { status: scanStatus });
      return new Response(JSON.stringify({ data: signatures, scan: { stoppedOn: "windowEnd", scannedTransactions: 3, creditsCharged: 11 } }), { status: 200 });
    }
    const { method, params } = JSON.parse(init.body);
    if (method === "getTokenAccountsByOwner") return answer({ value: tokenCalls++ % 2 === 0 ? [account] : [] });
    if (method === "getSignaturesForAddress") {
      asked.lists += 1;
      return answer(signatures.map(({ signature, slot, blockTime }) => ({ signature, slot, blockTime, err: null })));
    }
    if (method === "getTransaction") {
      const index = signatures.findIndex((entry) => entry.signature === params[0]);
      return answer({ slot: 200 + index, blockTime: 1_700_000_100 + index, meta: { err: null, preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [] }, transaction: { message: { accountKeys: [{ pubkey: "Taker111111111111111111111111111111111111111", signer: true }] } } });
    }
    return answer(null);
  };
  return { fetch, asked };
}

let nodes = 0;
function onHelius(t, chain) {
  const original = globalThis.fetch;
  const node = process.env.RYNTRA_SOLANA_RPC_MAINNET;
  t.after(() => {
    globalThis.fetch = original;
    if (node === undefined) delete process.env.RYNTRA_SOLANA_RPC_MAINNET;
    else process.env.RYNTRA_SOLANA_RPC_MAINNET = node;
    resetAttributionMemory();
  });
  resetAttributionMemory();
  /* A node of its own per test: a scan that failed in one test rests, and must not rest in the next. */
  process.env.RYNTRA_SOLANA_RPC_MAINNET = `https://mainnet.helius-rpc.com/?api-key=${SCAN_KEY}${(nodes += 1)}`;
  globalThis.fetch = chain.fetch;
}

test("the fee accounts' history comes from the scan: one request per account, by its mint, failed ones too, no paging", async (t) => {
  const chain = heliusChain();
  onHelius(t, chain);
  const read = await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [] });
  assert.equal(read.ok, true);
  assert.equal(chain.asked.lists, 0, "no endpoint's signature list is paged");
  assert.equal(chain.asked.scans.length, 1);
  assert.deepEqual(chain.asked.scans[0].match, { mints: [{ mint: "So11111111111111111111111111111111111111112", scope: "address" }] });
  assert.equal(chain.asked.scans[0].address, "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY");
  assert.equal(chain.asked.scans[0].status, "any");
  assert.equal(chain.asked.scans[0].returnShape, "signatures");
  assert.equal(read.coverage.signaturesSeen, 3);
  assert.equal(read.coverage.transactionsRead, 3);
  assert.equal(read.coverage.complete, true);
  assert.ok(read.sources.includes("mainnet.helius-rpc.com"));
  assert.ok(!JSON.stringify(read).includes(SCAN_KEY), "the key is never in what the read says");
});

test("a scan that fails leaves the history to the endpoints' union, with the same figures", async (t) => {
  const chain = heliusChain({ scanStatus: 503 });
  onHelius(t, chain);
  const read = await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [] });
  assert.equal(read.ok, true);
  assert.equal(chain.asked.scans.length, 1);
  assert.ok(chain.asked.lists >= 1, "the endpoints are paged");
  assert.equal(read.coverage.signaturesSeen, 3);
  assert.equal(read.coverage.complete, true);
});

test("a scan whose history the balances do not confirm is read again from the endpoints at once, and not asked again", async (t) => {
  const chain = heliusChain({ balance: "5" });
  onHelius(t, chain);
  const first = await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [] });
  assert.equal(first.ok, true);
  assert.equal(first.coverage.complete, false, "the balances decide, as before");
  assert.ok(chain.asked.lists >= 1, "the same read paged the endpoints");
  const lists = chain.asked.lists;
  await readAttributionFromChain({ referralAccount: REFERRAL, feeWallets: [] });
  assert.equal(chain.asked.scans.length, 1, "the scan is not asked again in this process");
  assert.ok(chain.asked.lists > lists);
});
