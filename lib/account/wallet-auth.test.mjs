import assert from "node:assert/strict";
import test from "node:test";
import { clearWalletAccount, postWalletProof, walletAuthGeneration } from "./wallet-auth.client.ts";

test("wallet cleanup waits for an older credential response and discards a cancelled signature", async () => {
  const original = globalThis.fetch;
  let finish;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    if (options.method === "POST") await new Promise((resolve) => { finish = resolve; });
    return new Response('{"ok":true}');
  };
  try {
    const version = walletAuthGeneration();
    const old = postWalletProof({ address: "wallet-a" }, version);
    await Promise.resolve();
    const cleanup = clearWalletAccount();
    const cancelled = postWalletProof({ address: "wallet-a" }, version);
    assert.deepEqual(calls, ["POST"]);
    finish();
    await old;
    assert.equal((await cleanup).ok, true);
    assert.equal(await cancelled, null);
    assert.deepEqual(calls, ["POST", "DELETE"]);
  } finally { globalThis.fetch = original; }
});

/* SOL-W2: a moment's other address never clears the wallet's proof; a change that holds clears it once; a sign-in
   that starts during the wait settles it first, so the clear neither cancels that sign-in nor deletes its session. */
test("a change of wallet clears the proof only once it holds, and a sign-in meanwhile settles it first", async () => {
  const { clearWalletAccountSoon, settleWalletChange } = await import("./wallet-auth.client.ts");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return new Response('{"ok":true}');
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    /* A → B → A within the moment: the wait is cancelled, nothing is cleared. */
    const acted = [];
    const cancel = clearWalletAccountSoon(40, (settled) => acted.push(settled));
    await wait(10);
    cancel();
    await wait(60);
    assert.deepEqual(calls, []);
    assert.deepEqual(acted, []);

    /* A → B that holds: cleared once, by the wait. */
    clearWalletAccountSoon(30, (settled, done) => { acted.push(settled); void done; });
    await wait(60);
    assert.deepEqual(acted, [false]);
    assert.deepEqual(calls, ["DELETE"]);
    settleWalletChange();
    assert.deepEqual(calls, ["DELETE"], "nothing left to settle");

    /* A sign-in starts during the wait: the clear runs first, the sign-in's generation is read after it, its POST
       goes through, and the wait never fires afterwards to delete the new session. */
    calls.length = 0;
    acted.length = 0;
    clearWalletAccountSoon(40, (settled) => acted.push(settled));
    settleWalletChange();
    const generation = walletAuthGeneration();
    const signedIn = await postWalletProof({ address: "wallet-b" }, generation);
    assert.ok(signedIn, "the sign-in that settled the change is not cancelled");
    await wait(70);
    assert.deepEqual(acted, [true]);
    assert.deepEqual(calls, ["DELETE", "POST"], "cleared before the sign-in, never after it");
  } finally { globalThis.fetch = original; }
});
