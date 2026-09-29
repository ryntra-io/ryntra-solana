import assert from "node:assert/strict";
import test from "node:test";
import { getAddressDecoder } from "@solana/kit";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";

import { SIWS_CHAIN, SIWS_STATEMENT, SIWS_TTL_MS, buildSiwsInput, parseSiwsMessage, siwsMessageText, verifySiws } from "./siws.ts";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const NONCE = "AbCdEfGh12345678XyZ0abcd";

async function keypair() {
  const priv = utils.randomPrivateKey();
  const pub = await getPublicKeyAsync(priv);
  const address = getAddressDecoder().decode(pub);
  return { priv, pub, address: String(address) };
}

function encode(text) {
  return new TextEncoder().encode(text);
}

test("the server-built message follows the Sign In With Solana grammar and round-trips through the parser", async () => {
  const { address } = await keypair();
  const input = buildSiwsInput({ domain: "ryntra.io", uri: "https://ryntra.io", address, nonce: NONCE, now: NOW });
  const text = siwsMessageText(input);
  assert.ok(text.startsWith(`ryntra.io wants you to sign in with your Solana account:\n${address}\n\n${SIWS_STATEMENT}\n\nURI: https://ryntra.io\nVersion: 1\nChain ID: ${SIWS_CHAIN}\nNonce: ${NONCE}\nIssued At: 2026-09-06T12:00:00.000Z\nExpiration Time: 2026-09-06T12:05:00.000Z`));
  const parsed = parseSiwsMessage(text);
  assert.deepEqual(parsed, {
    domain: "ryntra.io",
    address,
    statement: SIWS_STATEMENT,
    uri: "https://ryntra.io",
    version: "1",
    chainId: SIWS_CHAIN,
    nonce: NONCE,
    issuedAt: "2026-09-06T12:00:00.000Z",
    expirationTime: new Date(NOW + SIWS_TTL_MS).toISOString(),
    notBefore: null,
    requestId: null,
    resources: null,
  });
});

test("a genuine signature over the issued message verifies; every bound is checked first", async () => {
  const { priv, address } = await keypair();
  const input = buildSiwsInput({ domain: "ryntra.io", uri: "https://ryntra.io", address, nonce: NONCE, now: NOW });
  const message = encode(siwsMessageText(input));
  const signature = await signAsync(message, priv);
  const expected = { domain: "ryntra.io", uri: "https://ryntra.io", nonce: NONCE, address };

  assert.deepEqual(await verifySiws({ signedMessage: message, signature, expected, now: NOW + 1_000 }), { ok: true, address });

  const cases = [
    ["domain", { ...expected, domain: "evil.example" }, NOW],
    ["uri", { ...expected, uri: "https://evil.example" }, NOW],
    ["nonce", { ...expected, nonce: "ZzYyXxWw98765432AbCd0000" }, NOW],
    ["address", { ...expected, address: (await keypair()).address }, NOW],
    ["expired", expected, NOW + SIWS_TTL_MS + 5_000],
  ];
  for (const [reason, exp, now] of cases) {
    const result = await verifySiws({ signedMessage: message, signature, expected: exp, now });
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }
});

test("customer sign-in and account linking are separately consented purposes in either locale", async () => {
  const { priv, address } = await keypair();
  for (const locale of ["en", "uk"]) {
    const input = buildSiwsInput({ domain: "ryntra.io", uri: "https://ryntra.io", address, nonce: NONCE, now: NOW, action: "signin", locale });
    assert.notEqual(input.statement, SIWS_STATEMENT);
    const message = encode(siwsMessageText(input));
    const signature = await signAsync(message, priv);
    const expected = { domain: "ryntra.io", uri: "https://ryntra.io", nonce: NONCE, address, action: "signin", locale };
    assert.equal((await verifySiws({ signedMessage: message, signature, expected, now: NOW })).ok, true);
    assert.equal((await verifySiws({ signedMessage: message, signature, expected: { ...expected, action: "link" }, now: NOW })).ok, false);
    assert.equal((await verifySiws({ signedMessage: message, signature, expected: { ...expected, locale: locale === "uk" ? "en" : "uk" }, now: NOW })).ok, false);
  }
});

test("a tampered message, a foreign key or a lowercased address fails on the signature or the address bound", async () => {
  const { priv, address } = await keypair();
  const input = buildSiwsInput({ domain: "ryntra.io", uri: "https://ryntra.io", address, nonce: NONCE, now: NOW });
  const text = siwsMessageText(input);
  const signature = await signAsync(encode(text), priv);
  const expected = { domain: "ryntra.io", uri: "https://ryntra.io", nonce: NONCE, address };

  /* Same text signed by another key. */
  const other = await keypair();
  const foreign = await signAsync(encode(text), other.priv);
  assert.equal((await verifySiws({ signedMessage: encode(text), signature: foreign, expected, now: NOW })).reason, "signature");

  /* A changed statement is a different message and a different signature. */
  const tampered = encode(text.replace(SIWS_STATEMENT, "Approve this transfer."));
  const tamperedResult = await verifySiws({ signedMessage: tampered, signature, expected, now: NOW });
  assert.equal(tamperedResult.ok, false);
  assert.ok(["statement", "signature"].includes(tamperedResult.reason));

  /* Solana addresses are case-sensitive: a lowercased spelling is not the same key. */
  const lowered = encode(text.replace(address, address.toLowerCase()));
  assert.equal((await verifySiws({ signedMessage: lowered, signature, expected, now: NOW })).reason, "address");

  /* Extra fields a wallet was not asked for are refused rather than ignored. */
  const withResources = encode(text + "\nResources:\n- https://evil.example/claim");
  assert.equal((await verifySiws({ signedMessage: withResources, signature, expected, now: NOW })).reason, "extra_fields");

  /* A wrong-length signature never reaches the curve. */
  assert.equal((await verifySiws({ signedMessage: encode(text), signature: signature.slice(0, 63), expected, now: NOW })).reason, "signature");
});

test("the parser refuses garbage and oversized input", () => {
  assert.equal(parseSiwsMessage("hello"), null);
  assert.equal(parseSiwsMessage("x".repeat(5_000)), null);
  assert.equal(parseSiwsMessage("ryntra.io wants you to sign in with your Solana account:\n"), null);
});
