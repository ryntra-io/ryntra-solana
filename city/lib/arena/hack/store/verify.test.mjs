// Run from repo root: node --test city/lib/arena/hack/store/verify.test.mjs
/*
 * CITY-226: the server's check of the protocol owner's permission — a real Ed25519 wallet key made for the test signs
 * the grant's canonical text as a wallet's `signMessage` does; the check takes the signature in base58 or base64, and
 * refuses another signer, another body, a cut signature and anything it cannot read. Then the whole library check
 * (`checkGrant`) on top of it.
 */
import { hack, makeOrder } from "../fixtures.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";

const { walletVerifier, signatureBytes } = await import("./verify.ts");

/** A wallet made for the test: its address and a signer of messages, as a wallet's `signMessage` signs. */
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: getAddressDecoder().decode(raw), signMessage: (text) => sign(null, Buffer.from(text, "utf8"), privateKey) };
}

const owner = wallet();
const order = makeOrder({ protocol: owner.address, status: "open" });
const body = {
  format: hack.GRANT_FORMAT,
  order: order.id,
  protocol: owner.address,
  target: order.target,
  scope: order.scope,
  opensAt: order.opensAt,
  closesAt: order.closesAt,
  nonce: "nonce-1",
};
const signed = owner.signMessage(hack.grantText(body));
const base58 = getBase58Decoder().decode(signed);
const base64 = Buffer.from(signed).toString("base64");

test("the owner's signature over the grant's canonical text passes, in base58 and in base64", () => {
  assert.equal(walletVerifier(body, { signer: owner.address, signature: base58 }), true);
  assert.equal(walletVerifier(body, { signer: owner.address, signature: base64 }), true);
});

test("another signer, another body, a cut or unreadable signature: refused, never thrown", () => {
  const stranger = wallet();
  assert.equal(walletVerifier(body, { signer: stranger.address, signature: base58 }), false, "another wallet's key");
  assert.equal(walletVerifier({ ...body, closesAt: body.closesAt + 1 }, { signer: owner.address, signature: base58 }), false, "a longer window");
  assert.equal(walletVerifier({ ...body, scope: { ...body.scope, instructions: [] } }, { signer: owner.address, signature: base58 }), false, "a wider scope");
  const theirs = getBase58Decoder().decode(stranger.signMessage(hack.grantText(body)));
  assert.equal(walletVerifier(body, { signer: owner.address, signature: theirs }), false, "a stranger's signature named as the owner's");
  assert.equal(walletVerifier(body, { signer: owner.address, signature: base64.slice(0, 40) }), false);
  assert.equal(walletVerifier(body, { signer: owner.address, signature: "not a signature" }), false);
  assert.equal(walletVerifier(body, { signer: "not-an-address", signature: base58 }), false);
  assert.equal(walletVerifier(body, null), false);
  assert.equal(walletVerifier(body, { signer: owner.address }), false);
});

test("a signature reads as its 64 bytes in either form, and as nothing otherwise", () => {
  assert.deepEqual(signatureBytes(base58), Uint8Array.from(signed));
  assert.deepEqual(signatureBytes(base64), Uint8Array.from(signed));
  assert.equal(signatureBytes(getBase58Decoder().decode(new Uint8Array(32).fill(7))), null, "32 bytes is not a signature");
  assert.equal(signatureBytes(""), null);
  assert.equal(signatureBytes("0OIl".repeat(20)), null, "not base58");
});

test("the library's whole check of the grant, on the server's verifier", () => {
  const grant = { ...body, signature: { signer: owner.address, signature: base58 } };
  const expect = { order: order.id, protocol: owner.address, scopeHash: hack.scopeHash(order.scope), opensAt: order.opensAt, closesAt: order.closesAt };
  assert.deepEqual(hack.checkGrant(grant, expect, walletVerifier), []);
  const forged = { ...grant, nonce: "nonce-2" };
  assert.deepEqual(hack.checkGrant(forged, expect, walletVerifier).map((i) => i.code), ["NO_PERMISSION"]);
});
