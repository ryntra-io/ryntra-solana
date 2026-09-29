// Run from repo root: node --test lib/auth/siwe.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { SIWE_STATEMENT, SIWE_TTL_MS, buildSiweMessage, verifySiwe } from "./siwe.ts";

/*
 * Real signatures, not fixtures of them.
 *
 * Every message below is signed by an actual secp256k1 key at test time, so
 * these assertions exercise the same recovery path production does. A test that
 * stubs the cryptography proves the wrapper compiles; this one proves the
 * wrapper rejects things.
 */
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const account = privateKeyToAccount(KEY);
const other = privateKeyToAccount(OTHER_KEY);

const NOW = Date.parse("2026-08-12T12:00:00.000Z");
const DOMAIN = "ryntra.io";
const URI = "https://ryntra.io";
const NONCE = "abcdefghij0123456789klmn";
const CHAINS = [1, 5042002];

const base = {
  expectedDomain: DOMAIN,
  expectedUri: URI,
  expectedNonce: NONCE,
  allowedChainIds: CHAINS,
  now: NOW,
};

async function signed(message, signer = account) {
  return { message, signature: await signer.signMessage({ message }) };
}

/** A well-formed login message with any field overridden. */
function message(overrides = {}) {
  return createSiweMessage({
    domain: DOMAIN,
    address: account.address,
    statement: SIWE_STATEMENT,
    uri: URI,
    version: "1",
    chainId: 1,
    nonce: NONCE,
    issuedAt: new Date(NOW),
    expirationTime: new Date(NOW + SIWE_TTL_MS),
    ...overrides,
  });
}

test("a message the server built, signed by its address, verifies", async () => {
  const { message: m, signature } = await signed(
    buildSiweMessage({
      domain: DOMAIN,
      uri: URI,
      address: account.address,
      chainId: 5042002,
      nonce: NONCE,
      now: NOW,
    }),
  );
  const result = await verifySiwe({ ...base, message: m, signature });
  assert.equal(result.ok, true);
  assert.equal(result.address.toLowerCase(), account.address.toLowerCase());
  assert.equal(result.chainId, 5042002);
});

test("the server builds the message, so the statement and window are not the client's to choose", async () => {
  const built = buildSiweMessage({
    domain: DOMAIN,
    uri: URI,
    address: account.address,
    chainId: 1,
    nonce: NONCE,
    now: NOW,
  });
  assert.ok(built.includes(SIWE_STATEMENT), "the pinned statement must be in the message");
  assert.ok(built.includes(`Nonce: ${NONCE}`));
  assert.ok(built.includes("Version: 1"));
  /* The window is exactly one TTL — not a value the caller passed in. */
  assert.ok(built.includes(new Date(NOW + SIWE_TTL_MS).toISOString()));
  assert.ok(SIWE_TTL_MS <= 5 * 60 * 1000, "a login window longer than five minutes is a credential");
});

test("a signature harvested on another site cannot sign anyone in here", async () => {
  /*
   * The single most important check in the module. The attacker's site produces
   * a perfectly valid signature over a perfectly well-formed message — its own
   * domain and uri are simply not ours.
   */
  const { message: m, signature } = await signed(
    message({ domain: "evil.example", uri: "https://evil.example" }),
  );
  const result = await verifySiwe({ ...base, message: m, signature });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "domain_mismatch");

  // And the same message with only the uri swapped is refused on that field.
  const swapped = await signed(message({ uri: "https://evil.example" }));
  const second = await verifySiwe({ ...base, message: swapped.message, signature: swapped.signature });
  assert.equal(second.reason, "uri_mismatch");
});

test("a signature farmed under someone else's prompt is refused on the statement", async () => {
  /* The wallet shows the statement to the human. If it is not our sentence, the
     human was not agreeing to sign in to Ryntra. */
  const { message: m, signature } = await signed(
    message({ statement: "Approve this collection listing" }),
  );
  const result = await verifySiwe({ ...base, message: m, signature });
  assert.equal(result.reason, "statement_mismatch");
});

test("a nonce from another login attempt does not carry over", async () => {
  const { message: m, signature } = await signed(message({ nonce: "zzzzzzzzzzzzzzzzzzzzzzzz" }));
  const result = await verifySiwe({ ...base, message: m, signature });
  assert.equal(result.reason, "nonce_mismatch");
});

test("a chain the product does not accept is refused, and an empty allowlist accepts nothing", async () => {
  const { message: m, signature } = await signed(message({ chainId: 137 }));
  assert.equal((await verifySiwe({ ...base, message: m, signature })).reason, "chain_not_allowed");

  /* Fail-closed by construction: a caller that forgets to configure chains gets
     no logins, never all of them. */
  const good = await signed(message());
  const closed = await verifySiwe({ ...base, ...good, allowedChainIds: [] });
  assert.equal(closed.reason, "chain_not_allowed");
});

test("an unexpiring or over-long login message is refused rather than obeyed", async () => {
  const forever = await signed(message({ expirationTime: undefined }));
  assert.equal((await verifySiwe({ ...base, ...forever })).reason, "no_expiry");

  const year = await signed(
    message({ expirationTime: new Date(NOW + 365 * 24 * 3600 * 1000) }),
  );
  assert.equal((await verifySiwe({ ...base, ...year })).reason, "window_too_long");

  /*
   * Omitting `Issued At` must not buy a longer life than declaring it.
   *
   * The first version of this module fell back to measuring the expiry against
   * `now` when the field was absent, which held an omitting message to a
   * *weaker* rule than a declaring one — the omission bought a longer life.
   * `Issued At` is mandatory in EIP-4361, so it is mandatory here.
   *
   * Two independent refusals catch it, which is why the assertion below names
   * the outcome rather than one reason. EIP-4361's grammar is positional, so
   * dropping the mandatory line costs the message every field after
   * `statement`: viem's parser returns domain, address and statement and
   * nothing else, and the uri check fires first. The `no_issued_at` guard sits
   * behind that for the case where a message parses whole and still omits the
   * field.
   */
  const withoutIssuedAt = message()
    .split("\n")
    .filter((line) => !line.startsWith("Issued At:"))
    .join("\n");
  const handBuilt = await signed(withoutIssuedAt);
  const stripped = await verifySiwe({ ...base, ...handBuilt });
  assert.equal(stripped.ok, false, "a message missing a mandatory field must not verify");
  assert.ok(
    ["uri_mismatch", "no_issued_at"].includes(stripped.reason),
    `unexpected reason: ${stripped.reason}`,
  );
  // The inner guard exists rather than being implied by the parser's behaviour.
  const source = readFileSync(new URL("./siwe.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!fields\.issuedAt\) return \{ ok: false, reason: "no_issued_at" \};/);
});

test("an expired message stays expired, and one from the future is not accepted early", async () => {
  const m = await signed(message());
  const late = await verifySiwe({ ...base, ...m, now: NOW + SIWE_TTL_MS + 1 });
  assert.equal(late.reason, "expired");

  const ahead = await signed(
    message({ issuedAt: new Date(NOW + 10 * 60 * 1000), expirationTime: new Date(NOW + 11 * 60 * 1000) }),
  );
  assert.equal((await verifySiwe({ ...base, ...ahead })).reason, "issued_in_future");

  /* A small client clock lead is tolerated in one direction only — otherwise
     every browser thirty seconds fast could never sign in. */
  const skewed = await signed(
    message({ issuedAt: new Date(NOW + 30_000), expirationTime: new Date(NOW + 30_000 + SIWE_TTL_MS) }),
  );
  assert.equal((await verifySiwe({ ...base, ...skewed })).ok, true);

  const notYet = await signed(message({ notBefore: new Date(NOW + 60_000) }));
  assert.equal((await verifySiwe({ ...base, ...notYet })).reason, "not_yet_valid");
});

test("the signature has to be over this message, by this address", async () => {
  // Right message, wrong signer.
  const m = message();
  const wrongSigner = await signed(m, other);
  assert.equal((await verifySiwe({ ...base, message: m, signature: wrongSigner.signature })).reason, "bad_signature");

  // Right signer, message altered after signing.
  const good = await signed(m);
  const tampered = good.message.replace(account.address, other.address);
  assert.equal(
    (await verifySiwe({ ...base, message: tampered, signature: good.signature })).ok,
    false,
    "a message edited after signing must not verify",
  );

  // Garbage in, a refusal out — never a throw.
  for (const junk of ["", "not a siwe message", "\n\n", "Version: 1"]) {
    const result = await verifySiwe({ ...base, message: junk, signature: good.signature });
    assert.equal(result.ok, false, `"${junk}" must not verify`);
  }
});

test("re-verifying a known account refuses a different address", async () => {
  const m = await signed(message());
  const ok = await verifySiwe({ ...base, ...m, expectedAddress: account.address });
  assert.equal(ok.ok, true);

  const mismatch = await verifySiwe({ ...base, ...m, expectedAddress: other.address });
  assert.equal(mismatch.reason, "address_mismatch");
});

test("a smart account is not silently accepted without the client that could check it", async () => {
  /*
   * EIP-1271 needs an on-chain `isValidSignature` call. Without a public client
   * that branch cannot run, and the module must fail closed on it rather than
   * fall through to a pass. Simulated here with a signature that recovers to
   * nobody: the EOA path cannot settle it and there is no client for the
   * contract path, so the only correct answer is a refusal.
   */
  const m = message();
  const notASignature = `0x${"11".repeat(65)}`;
  const result = await verifySiwe({ ...base, message: m, signature: notASignature });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad_signature");
});

test("the identity core mints nothing and reads no account", () => {
  /*
   * The boundary that makes this module safe to land before the schema can hold
   * a wallet account. It proves control of an address. It does not create a
   * session, set a cookie, or resolve anything in the database — and it must
   * not start doing so by accident in a later edit.
   *
   * `beta_users.telegram_id` is `bigint unique not null`, so no account exists
   * without Telegram; and `beta_users.wallet_address` is an unverified watch
   * address a user pastes to look at, so treating it as an identity would let
   * anyone sign in as any account that had ever watched their address.
   */
  const source = readFileSync(new URL("./siwe.ts", import.meta.url), "utf8");
  for (const forbidden of [/cookies\(/, /getSession/, /issueSession/, /setHeader/, /supabase/i, /rpc\(/, /beta_users/]) {
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, " "),
      forbidden,
      `the identity core must not reach for ${forbidden}`,
    );
  }
});
