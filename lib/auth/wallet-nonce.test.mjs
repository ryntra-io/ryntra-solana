// Run from repo root: node --test lib/auth/wallet-nonce.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* The module reads the secret at call time, so the environment is set before it
   is imported and the tests below can also take it away again. */
process.env.BETA_TOKEN_SECRET = "test-secret-for-nonce-tests-only";

const { NONCE_LEN, issueWalletNonce, walletNonceIssuedHere } = await import("./wallet-nonce.ts");

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("a nonce satisfies both grammars it has to live in at once", () => {
  const nonce = issueWalletNonce();
  assert.equal(nonce.length, 24);
  assert.equal(NONCE_LEN, 24);
  /* EIP-4361 requires alphanumeric; `beta_consume_login_nonce` requires
     `^[A-Za-z0-9_-]{24}$`. Base62 at length 24 is the intersection, so the same
     string goes to the wallet and to the database without translation. */
  assert.match(nonce, /^[a-zA-Z0-9]{8,}$/, "EIP-4361 requires an alphanumeric nonce");
  assert.match(nonce, /^[A-Za-z0-9_-]{24}$/, "the applied RPC requires exactly this shape");
});

test("the server recognises its own nonce and refuses everything else", () => {
  const nonce = issueWalletNonce();
  assert.equal(walletNonceIssuedHere(nonce), true);

  /*
   * The property that single-use alone does not give.
   *
   * `beta_consume_login_nonce` records consumption, not issuance: it accepts
   * any well-formed 24-character string and returns true the first time it sees
   * one. An attacker who invents a nonce, builds a message around it and signs
   * it would be on first use and therefore accepted. The tag is what makes an
   * invented nonce fail before the database is ever asked.
   */
  assert.equal(walletNonceIssuedHere("abcdefghij0123456789klmn"), false, "an invented nonce must not pass");
  assert.equal(walletNonceIssuedHere("A".repeat(24)), false);

  // A tampered tag fails even though the random half is genuine.
  const flipped = nonce.slice(0, 12) + (nonce[12] === "A" ? "B" : "A") + nonce.slice(13);
  assert.equal(walletNonceIssuedHere(flipped), false, "a rewritten tag must not pass");

  // A genuine tag on a different random half fails too.
  const other = issueWalletNonce();
  assert.equal(walletNonceIssuedHere(other.slice(0, 12) + nonce.slice(12)), false);
});

test("shape is checked before the tag, and nothing throws on rubbish", () => {
  for (const junk of [
    "",
    null,
    undefined,
    42,
    {},
    [],
    "short",
    "a".repeat(23),
    "a".repeat(25),
    "a".repeat(12) + "!!!!!!!!!!!!",
    "../../etc/passwd........",
    "abcdefghij_-0123456789kl", // valid for the RPC, invalid for EIP-4361
  ]) {
    assert.equal(walletNonceIssuedHere(junk), false, `${JSON.stringify(junk)} must not pass`);
  }
});

test("a wallet nonce cannot change purpose, locale or the account being linked", () => {
  const context = "solana:link:uk:account-a:session-a";
  const nonce = issueWalletNonce(context);
  assert.equal(walletNonceIssuedHere(nonce, context), true);
  for (const changed of [undefined, "solana:signin:uk", "solana:link:en:account-a:session-a", "solana:link:uk:account-b:session-a", "solana:link:uk:account-a:session-b"]) {
    assert.equal(walletNonceIssuedHere(nonce, changed), false);
  }
});

test("nonces do not repeat", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(issueWalletNonce());
  assert.equal(seen.size, 500, "every nonce must be distinct");
});

test("a nonce minted under one secret is not honoured under another", async () => {
  const nonce = issueWalletNonce();
  const original = process.env.BETA_TOKEN_SECRET;
  try {
    process.env.BETA_TOKEN_SECRET = "a-different-secret";
    assert.equal(walletNonceIssuedHere(nonce), false, "rotating the secret must invalidate nonces");
  } finally {
    process.env.BETA_TOKEN_SECRET = original;
  }
  assert.equal(walletNonceIssuedHere(nonce), true, "and restoring it must restore them");
});

test("no secret means no nonce, never an unverifiable one", () => {
  const original = process.env.BETA_TOKEN_SECRET;
  try {
    delete process.env.BETA_TOKEN_SECRET;
    assert.equal(issueWalletNonce(), null, "a nonce nobody can verify is the hole this closes");
    assert.equal(walletNonceIssuedHere("a".repeat(24)), false);
  } finally {
    process.env.BETA_TOKEN_SECRET = original;
  }
});

test("the tag comparison is constant-time and domain-separated", () => {
  const source = read("lib/auth/wallet-nonce.ts");
  /* An early-return string compare leaks the tag one character at a time to
     anyone willing to measure the difference. */
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, " "), /given === expected|nonce\.slice\(12\) ===/);
  /* Domain separation, so this HMAC can never collide with the session token's
     over the same secret. */
  assert.match(source, /const TAG_PREFIX = "siwe-nonce:";/);
  assert.match(source, /createHmac\("sha256", key\)\.update\(TAG_PREFIX \+ random\)/);
});
