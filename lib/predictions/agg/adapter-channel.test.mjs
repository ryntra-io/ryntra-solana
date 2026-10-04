import assert from "node:assert/strict";
import test from "node:test";

import { createAggClient } from "@agg-build/sdk";

import { serverAggClient } from "./adapter.ts";

/*
 * Found 2026-09-23: the SDK opens a BroadcastChannel for
 * every client — cross-tab sync in a browser. On the server every client
 * lives in one process, so a per-request client outlived its request, and one
 * wallet's sign-out reached every other wallet's client alive at that moment.
 * The server's clients close that channel at birth.
 */
const OPTIONS = { baseUrl: "http://127.0.0.1:9", appId: "channel-test", persistSession: false };
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test("the SDK's own clients pass one wallet's sign-out to another in the same process — the defect, shown", async () => {
  const a = createAggClient(OPTIONS);
  const b = createAggClient(OPTIONS);
  try {
    a.setAccessToken("token-of-wallet-a");
    b.setAccessToken("token-of-wallet-b");
    a.clearAccessToken();
    await tick();
    assert.equal(b.isAuthenticated, false, "wallet B's client lost its session because wallet A signed out");
  } finally {
    a.destroy();
    b.destroy();
  }
});

test("a server client keeps no channel: another wallet's sign-out leaves its session alone, and nothing holds it past its request", async () => {
  const a = serverAggClient(OPTIONS);
  const b = serverAggClient(OPTIONS);
  a.setAccessToken("token-of-wallet-a");
  b.setAccessToken("token-of-wallet-b");
  a.clearAccessToken();
  await tick();
  assert.equal(b.isAuthenticated, true, "wallet B's session stands");
  assert.equal(a.authChannel ?? null, null, "no channel was left open");
  assert.equal(b.authChannel ?? null, null);
  assert.equal(typeof b.buildSiwsMessage({ address: "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY", chainId: "mainnet", nonce: "N0NCE", domain: "ryntra.io", uri: "https://ryntra.io" }), "string", "the client still does its work");
});
