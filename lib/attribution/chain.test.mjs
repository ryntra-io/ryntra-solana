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
