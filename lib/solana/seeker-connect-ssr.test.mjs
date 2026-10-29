import assert from "node:assert/strict";
import test from "node:test";

/**
 * Under server rendering there is no `window`, and the wallet client and the
 * Seeker registration must import and answer without one (SKR-1): no wallet,
 * nothing registered, nothing thrown.
 */

test("the wallet client imports and finds nothing without a window", async () => {
  assert.equal(typeof window, "undefined");
  const wallet = await import("./wallet.client.ts");
  assert.deepEqual(wallet.detectWallets(), []);
  const unsubscribe = wallet.subscribeWallets(() => undefined);
  unsubscribe();
  const { registerSeekerConnectOnce } = await import("./seeker-connect.client.ts");
  assert.equal(await registerSeekerConnectOnce(), false);
});
