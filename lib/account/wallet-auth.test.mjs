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
