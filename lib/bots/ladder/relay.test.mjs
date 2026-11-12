// Run from repo root: node --test lib/bots/ladder/relay.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
test("review 9.11: «already processed» is not a refusal — the transaction is on the chain", async () => {
  const { nodeRefused } = await import("./relay.server.ts");
  assert.equal(nodeRefused(new Error("Transaction simulation failed: This transaction has already been processed")), false);
  assert.equal(nodeRefused(new Error("Transaction simulation failed: Blockhash not found")), true);
});
