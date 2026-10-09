import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  ensureWalletFact,
  forgetWalletFact,
  proofActionFor,
  proofStatusFor,
  resetWalletFactForTests,
  revalidateWalletFact,
  seedWalletFact,
  setWalletFact,
  subscribeWalletFact,
  walletFact,
} from "./wallet-proof-store.client.ts";

/**
 * One signature per visit; every page reads one answer; a store that blinks
 * is «checking», never «not confirmed» and never «signed out».
 */

const A = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const B = "11111111111111111111111111111111";
const original = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = original;
  resetWalletFactForTests();
});

function answer(status, body) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("the server's seed is known before any page asks, and a wallet sign-in proves its own address", () => {
  seedWalletFact({ signedIn: true, walletAddress: A, provenAddress: A, checking: false }, 100);
  assert.equal(proofStatusFor(walletFact(), A), "proven");
  assert.equal(proofActionFor(walletFact(), A), "none", "a proven address asks for no signature");
  assert.equal(proofStatusFor(walletFact(), B), "unproven");
  assert.equal(proofStatusFor(walletFact(), null), "idle");
});

test("before the server has answered a page says «checking», never «not confirmed»", () => {
  assert.equal(proofStatusFor(walletFact(), A), "checking");
});

test("one read serves every caller at once", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ signedIn: true, walletAddress: A, proof: { address: A, expiresAt: "2026-11-07T00:00:00Z" } }));
  };
  await Promise.all([revalidateWalletFact(), revalidateWalletFact(), revalidateWalletFact()]);
  assert.equal(calls, 1);
  assert.equal(proofStatusFor(walletFact(), A), "proven");
  assert.equal(walletFact().expiresAt, "2026-11-07T00:00:00Z");
});

test("a 503 keeps the session and the proof, and reads as «checking» for an unknown one — 503 is not 401", async () => {
  seedWalletFact({ signedIn: true, walletAddress: A, provenAddress: A, checking: false }, 100);
  globalThis.fetch = answer(503, { checking: true });
  await revalidateWalletFact();
  assert.equal(walletFact().status, "down");
  assert.equal(walletFact().signedIn, true, "a store that blinked signs nobody out");
  assert.equal(proofStatusFor(walletFact(), A), "proven", "the proven address stays proven");
  assert.equal(proofStatusFor(walletFact(), B), "checking", "an address the store cannot answer for is checking");
});

test("a dropped request is the same as a 503", async () => {
  globalThis.fetch = async () => { throw new TypeError("network"); };
  await revalidateWalletFact();
  assert.equal(proofStatusFor(walletFact(), A), "checking");
});

test("a 200 that says signed out is the only «not confirmed»", async () => {
  globalThis.fetch = answer(200, { signedIn: false, walletAddress: null, proof: null });
  await revalidateWalletFact();
  assert.equal(proofStatusFor(walletFact(), A), "unproven");
  assert.equal(proofActionFor(walletFact(), A), "signin", "somebody with no account signs in once, not proves per page");
});

test("a person signed in by another door proves the wallet without leaving the account", () => {
  seedWalletFact({ signedIn: true, walletAddress: null, provenAddress: null, checking: false }, 100);
  assert.equal(proofActionFor(walletFact(), A), "prove");
});

test("a signature anywhere is the answer everywhere, and every subscriber hears it", () => {
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 100);
  let heard = 0;
  const off = subscribeWalletFact(() => { heard += 1; });
  setWalletFact({ signedIn: true, walletAddress: A, provenAddress: A });
  off();
  assert.equal(heard, 1);
  assert.equal(proofStatusFor(walletFact(), A), "proven");
  forgetWalletFact();
  assert.equal(proofStatusFor(walletFact(), A), "unproven");
});

test("an older seed never overwrites a fresher answer", async () => {
  globalThis.fetch = answer(200, { signedIn: true, walletAddress: A, proof: { address: A, expiresAt: null } });
  await revalidateWalletFact();
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 1);
  assert.equal(walletFact().signedIn, true, "a render older than the answer is ignored");
  assert.equal(proofStatusFor(walletFact(), A), "proven");
});

test("a fresh answer is not re-read; an unknown one is", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ signedIn: false, proof: null })); };
  ensureWalletFact();
  await revalidateWalletFact();
  ensureWalletFact();
  assert.equal(calls, 1);
});

test("a read that left before a signature never overwrites it, and a read is never re-broadcast", async () => {
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 100);
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ signedIn: false, proof: null, at: 50 }))); });
  const read = revalidateWalletFact();
  setWalletFact({ signedIn: true, walletAddress: A, provenAddress: A });
  release();
  await read;
  assert.equal(proofStatusFor(walletFact(), A), "proven", "the signature made meanwhile stands");
});

test("a newer server render replaces the answer; the server's clock orders them", async () => {
  globalThis.fetch = answer(200, { signedIn: true, walletAddress: A, proof: { address: A, expiresAt: null }, at: 500 });
  await revalidateWalletFact();
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 400);
  assert.equal(walletFact().signedIn, true);
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 900);
  assert.equal(walletFact().signedIn, false);
});

test("a guest's failed read keeps what was known: signed out, not «checking» forever", async () => {
  seedWalletFact({ signedIn: false, walletAddress: null, provenAddress: null, checking: false }, 100);
  globalThis.fetch = async () => { throw new TypeError("network"); };
  await revalidateWalletFact();
  assert.equal(walletFact().status, "down");
  assert.equal(walletFact().signedIn, false);
  assert.ok(walletFact().at > 0, "an answer was known before the blink");
});
