// Run from repo root: node --test lib/intents/signed.test.mjs
//
// The mark's proof (CITY-161): the wallet's signed bytes say who pays and carry that payer's ed25519 signature over the
// exact message. Checked with the swap routes' golden order, signed by its test-only key.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { signWire, STRANGER_PRIVATE_KEY_PKCS8, TAKER } from "../../app/api/solana/swap/golden/fixtures.mjs";
import { readSignedBy } from "./signed.ts";

const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const ORDER = golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body;
const EXECUTED = golden["execute: exact bytes through Jupiter settle MATCHED with a Receipt"].steps.at(-1).body;

test("the taker's signed order reads as paid and signed by the taker, with the signature the chain will name", () => {
  const read = readSignedBy(signWire(ORDER.order.transactionBase64).wire);
  assert.deepEqual(read, { ok: true, signature: EXECUTED.signature, feePayer: TAKER });
});

test("unsigned bytes, bytes changed after signing, another key's signature, and noise mark nothing", () => {
  assert.equal(readSignedBy(ORDER.order.transactionBase64).ok, false);
  const signed = Buffer.from(signWire(ORDER.order.transactionBase64).wire, "base64");
  const changed = Buffer.from(signed);
  changed[changed.length - 1] ^= 0x01;
  assert.equal(readSignedBy(changed.toString("base64")).ok, false);
  assert.equal(readSignedBy(signWire(ORDER.order.transactionBase64, STRANGER_PRIVATE_KEY_PKCS8).wire).ok, false);
  for (const noise of ["", "AQAB", "not base64!", "A".repeat(3_000)]) assert.equal(readSignedBy(noise).ok, false, noise.slice(0, 10));
});
