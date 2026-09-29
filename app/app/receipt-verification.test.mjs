import assert from "node:assert/strict";
import test from "node:test";
import { verifyReceiptCandidates } from "./receipt-verification.client.ts";

const row = (hash) => ({ wallet: "synthetic-owner", storedAt: "2026-09-29T00:00:00.000Z", receipt: { contentHash: hash } });
const valid = { integrity: { valid: true }, issuer: { verdict: "SIGNATURE_VALID" } };

test("no receipt candidates load no verification client", async () => {
  let loaded = 0;
  const result = await verifyReceiptCandidates([], () => true, async () => { loaded++; throw new Error("must stay unloaded"); });
  assert.equal(loaded, 0); assert.deepEqual([...result], []);
});

test("a failed verification chunk leaves every candidate unverified", async () => {
  assert.deepEqual([...await verifyReceiptCandidates([row("a")], () => true, async () => { throw new Error("chunk unavailable"); })], []);
});

test("wallet or route cleanup during loading sends no stale verification request", async () => {
  let active = true; let release; let calls = 0;
  const loadedClient = new Promise(resolve => { release = resolve; });
  const pending = verifyReceiptCandidates([row("a")], () => active, () => loadedClient);
  active = false; release({ verifyArtifact: async () => { calls++; return valid; } });
  assert.deepEqual([...await pending], []); assert.equal(calls, 0);
});

test("cleanup during verification cannot return promotion evidence", async () => {
  let active = true;
  const result = await verifyReceiptCandidates([row("a")], () => active, async () => ({ verifyArtifact: async () => { active = false; return valid; } }));
  assert.deepEqual([...result], []);
});

test("only integrity-valid issuer-signed receipts qualify, and a failed row does not promote", async () => {
  const result = await verifyReceiptCandidates([row("valid"), row("bad-integrity"), row("bad-issuer"), row("failed")], () => true, async () => ({
    verifyArtifact: async receipt => {
      if (receipt.contentHash === "failed") throw new Error("request failed");
      if (receipt.contentHash === "bad-integrity") return { ...valid, integrity: { valid: false } };
      if (receipt.contentHash === "bad-issuer") return { ...valid, issuer: { verdict: "SIGNATURE_INVALID" } };
      return valid;
    },
  }));
  assert.deepEqual([...result], ["valid"]);
});
