import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  AGENT_AUTHORIZATION_PRIMARY_TYPE,
  AGENT_AUTHORIZATION_TYPES,
  buildAgentAuthorizationChallenge,
  verifyAgentAuthorization,
} from "./authorization.ts";

const CHAIN_ID = 97;
const NOW = new Date("2026-08-17T12:00:00.000Z");
const LATER = "2026-08-17T13:00:00.000Z";
const CONTENT = `0x${"a".repeat(64)}`;

/* A throwaway account, generated from a fixed non-secret test vector. It exists
   only so this file can produce a real signature; no wallet holds it and it
   never leaves the test. */
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);

function nonceClaimer() {
  const store = createMemoryGuardStore().collection("agentIdempotency");
  return (nonce) => store.insertIfAbsent(`nonce:${nonce}`, { nonce });
}

async function signed(overrides = {}) {
  const proof = {
    subjectRef: account.address,
    contentHash: CONTENT,
    nonce: "nonce-0000001",
    expiresAt: LATER,
    ...overrides,
  };
  const challenge = buildAgentAuthorizationChallenge({
    contentHash: proof.contentHash,
    subject: proof.subjectRef,
    nonce: proof.nonce,
    expiresAt: new Date(proof.expiresAt),
    chainId: CHAIN_ID,
  });
  const signature = await account.signTypedData({
    domain: { ...challenge.domain },
    types: challenge.types,
    primaryType: challenge.primaryType,
    message: { ...challenge.message },
  });
  return { ...proof, signature };
}

test("the wallet is shown readable fields, not a hex blob", () => {
  /* The reason this is EIP-712 and not a personal_sign over a digest: a person
     approving an action must be able to read what they are approving. */
  const challenge = buildAgentAuthorizationChallenge({
    contentHash: CONTENT,
    subject: account.address,
    nonce: "nonce-0000001",
    expiresAt: new Date(LATER),
    chainId: CHAIN_ID,
  });
  assert.equal(challenge.primaryType, AGENT_AUTHORIZATION_PRIMARY_TYPE);
  assert.deepEqual(
    AGENT_AUTHORIZATION_TYPES.AgentAuthorization.map((field) => field.name),
    ["contentHash", "subject", "nonce", "expiresAt"],
  );
  assert.equal(challenge.domain.chainId, CHAIN_ID);
  assert.equal(challenge.message.contentHash, CONTENT);
});

test("a real wallet signature over the exact artifact is accepted", async () => {
  const proof = await signed();
  const result = await verifyAgentAuthorization({
    proof,
    contentHash: CONTENT,
    chainId: CHAIN_ID,
    claimNonce: nonceClaimer(),
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.subject.toLowerCase(), account.address.toLowerCase());
});

test("an expired authorization is refused", async () => {
  const proof = await signed({ expiresAt: "2026-08-17T11:00:00.000Z" });
  const result = await verifyAgentAuthorization({
    proof,
    contentHash: CONTENT,
    chainId: CHAIN_ID,
    claimNonce: nonceClaimer(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "AUTHORIZATION_EXPIRED");
});

test("a proof over a different artifact is refused", async () => {
  const proof = await signed();
  const result = await verifyAgentAuthorization({
    proof,
    contentHash: `0x${"b".repeat(64)}`,
    chainId: CHAIN_ID,
    claimNonce: nonceClaimer(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "AUTHORIZATION_CONTENT_MISMATCH");
});

test("a signature that does not recover to the declared subject is refused", async () => {
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const proof = { ...(await signed()), subjectRef: other.address };
  const result = await verifyAgentAuthorization({
    proof,
    contentHash: CONTENT,
    chainId: CHAIN_ID,
    claimNonce: nonceClaimer(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "AUTHORIZATION_SIGNER_MISMATCH");
});

test("a replayed nonce is refused, and the claim is atomic rather than a check", async () => {
  const proof = await signed();
  const claimNonce = nonceClaimer();
  const args = { proof, contentHash: CONTENT, chainId: CHAIN_ID, claimNonce, now: NOW };

  const first = await verifyAgentAuthorization(args);
  assert.equal(first.ok, true);

  const second = await verifyAgentAuthorization(args);
  assert.equal(second.ok, false);
  assert.equal(second.reasonCode, "AUTHORIZATION_NONCE_REPLAYED");

  /* Simultaneous submissions of the same signature: read-then-write would let
     both through, because both would see the nonce free. */
  const fresh = { ...args, proof: await signed({ nonce: "nonce-0000002" }), claimNonce: nonceClaimer() };
  const racing = await Promise.all(Array.from({ length: 6 }, () => verifyAgentAuthorization(fresh)));
  assert.equal(racing.filter((result) => result.ok).length, 1, "more than one writer claimed the same nonce");
});

test("a failing proof does not burn its nonce", async () => {
  /* Otherwise one bad submission locks out the good one that follows it. */
  let claims = 0;
  const claimNonce = async () => {
    claims += 1;
    return true;
  };
  const proof = await signed({ expiresAt: "2026-08-17T11:00:00.000Z" });
  await verifyAgentAuthorization({ proof, contentHash: CONTENT, chainId: CHAIN_ID, claimNonce, now: NOW });
  assert.equal(claims, 0, "an expired proof consumed a nonce");
});

test("Ryntra never produces an authorization", async () => {
  /* The product's central claim, asserted over the source rather than
     promised. This module builds the structure and checks what comes back; the
     private key stays in the wallet and only 65 bytes of signature arrive. */
  const source = readFileSync("lib/agent-control/authorization.ts", "utf8");
  assert.ok(!/signTypedData|privateKey|PrivateKey|mnemonic|Wallet\(/.test(source), "this module can sign");
  assert.match(source, /verifyTypedData/);
});
