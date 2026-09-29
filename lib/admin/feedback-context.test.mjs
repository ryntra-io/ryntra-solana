import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  feedbackContextView,
  inboxCategoryFor,
  isFeedbackTopic,
  listFeedbackContexts,
  readFeedbackContext,
  recordFeedbackContext,
  sanitizeFeedbackContact,
} from "./feedback-context.ts";
import { moneyAttention } from "./money-signals.server.ts";

const WALLET = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const ID = "3f2b7d5e-9c1a-4e7b-8f0d-1a2b3c4d5e6f";

test("a question is `other` to the inbox and a question to the operator", () => {
  assert.equal(inboxCategoryFor("question"), "other");
  assert.equal(inboxCategoryFor("bug"), "bug");
  assert.equal(inboxCategoryFor("idea"), "idea");
  assert.equal(inboxCategoryFor("security"), "security");
  assert.equal(isFeedbackTopic("question"), true);
  assert.equal(isFeedbackTopic("other"), false, "the inbox word is not a topic a person chooses");
});

test("a contact is kept as typed within bounds, never invented", () => {
  assert.equal(sanitizeFeedbackContact("  @qa_tester "), "@qa_tester");
  assert.equal(sanitizeFeedbackContact("a"), null);
  assert.equal(sanitizeFeedbackContact("x".repeat(121)), null);
  assert.equal(sanitizeFeedbackContact(42), null);
});

test("the context is written once by thread id, read back masked, and absent reads as null", async () => {
  const store = createMemoryGuardStore();
  const context = {
    schema: "ryntra.feedback-context", schemaVersion: "1.0.0", id: ID, publicRef: "RYN-FB-3F2B7D5E", topic: "bug",
    wallet: WALLET, proven: true, contact: "@qa_tester", route: "/app/swap", locale: "uk", createdAt: "2026-09-11T12:00:00.000Z",
  };
  assert.equal(await recordFeedbackContext(store, context), true);
  assert.equal(await recordFeedbackContext(store, context), false, "a second write inserts nothing");
  const read = await readFeedbackContext(store, ID);
  assert.equal(read.wallet, WALLET);
  const view = feedbackContextView(read);
  assert.deepEqual(view, { topic: "bug", wallet: WALLET, walletMasked: "6dNV…XbLp", proven: true, contact: "@qa_tester", route: "/app/swap" });
  assert.equal(feedbackContextView(null), null);
  assert.equal((await listFeedbackContexts(store)).size, 1);
  assert.equal(await readFeedbackContext(store, "00000000-0000-4000-8000-000000000000"), null);
  assert.equal(await recordFeedbackContext(store, { ...context, wallet: "not-a-wallet" }), false, "a malformed wallet is refused, not stored");
});

test("the money's attention rows name what is wrong and stay silent when nothing is", () => {
  const ok = { ok: true, latencyMs: 1 };
  const quiet = moneyAttention({ health: { status: "measured", failed7d: 0, stuck: 0, done24h: 3, oldestStuckAt: null }, treasury: ok, referral: ok, relayKeyPresent: true });
  assert.deepEqual(quiet, []);
  const loud = moneyAttention({
    health: { status: "measured", failed7d: 2, stuck: 1, done24h: 0, oldestStuckAt: "2026-09-11T00:00:00.000Z" },
    treasury: { ok: false, latencyMs: null, state: "UNCONFIGURED", reason: "no_treasury" },
    referral: { ok: false, latencyMs: 5, state: "UNAVAILABLE", reason: "account_missing" },
    relayKeyPresent: false,
  });
  assert.deepEqual(loud.map((item) => [item.id, item.tone]), [
    ["operations_stuck", "risk"],
    ["operations_failed", "warn"],
    ["treasury", "risk"],
    ["jupiter_referral", "risk"],
    ["relay_key", "muted"],
  ]);
  const empty = moneyAttention({ health: { status: "unavailable", failed7d: 0, stuck: 0, done24h: 0, oldestStuckAt: null }, treasury: { ok: true, latencyMs: 1, state: "DEGRADED", reason: "treasury_empty" }, referral: ok, relayKeyPresent: true });
  assert.deepEqual(empty.map((item) => item.id), ["ledger_unavailable", "treasury_empty"]);
});
