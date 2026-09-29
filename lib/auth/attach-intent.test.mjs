/*
 * The owner's bootstrap is two steps, and the second one only acts on the
 * world the first one described. These are the ways that used to be possible
 * when it was a single unnamed button press.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachIntentMatches, issueAttachIntent, readAttachIntent } from "./attach-intent.ts";

process.env.BETA_TOKEN_SECRET ??= "test-secret-value-at-least-16";

const LIVE = {
  purpose: "admin_bootstrap",
  context: "s-admin-1",
  accountId: "11111111-1111-4111-8111-111111111111",
  subject: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

test("an intent describes exactly one admin session, one account and one identity", () => {
  const issued = issueAttachIntent(LIVE);
  assert.ok(issued);
  const read = readAttachIntent(issued.value);
  assert.deepEqual({ purpose: read.purpose, context: read.context, accountId: read.accountId, subject: read.subject }, LIVE);
  assert.equal(attachIntentMatches(read, LIVE), true);
});

test("a different identity signed in meanwhile does not inherit the confirmation", () => {
  /* Somebody signs in as another user in a second tab between the two steps.
     The confirmation the owner read named the first user; it must not bind the
     second. */
  const issued = issueAttachIntent(LIVE);
  const read = readAttachIntent(issued.value);
  assert.equal(attachIntentMatches(read, { ...LIVE, subject: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), false);
});

test("a different admin session cannot spend somebody else's confirmation", () => {
  const issued = issueAttachIntent(LIVE);
  const read = readAttachIntent(issued.value);
  assert.equal(attachIntentMatches(read, { ...LIVE, context: "s-admin-2" }), false);
  assert.equal(attachIntentMatches(read, { ...LIVE, accountId: "22222222-2222-4222-8222-222222222222" }), false);
});

test("a tampered or foreign-signed intent is not readable at all", () => {
  const issued = issueAttachIntent(LIVE);
  const [payload, sig] = issued.value.split(".");
  assert.equal(readAttachIntent(`${payload}.${"A".repeat(sig.length)}`), null);
  assert.equal(readAttachIntent(`${payload}x.${sig}`), null);
  assert.equal(readAttachIntent(""), null);
  assert.equal(readAttachIntent(null), null);
  assert.equal(attachIntentMatches(null, LIVE), false);
});

test("an intent expires, so a captured one cannot be replayed later", () => {
  const now = Date.now();
  const issued = issueAttachIntent(LIVE, now);
  assert.ok(readAttachIntent(issued.value, now + 4 * 60_000));
  assert.equal(readAttachIntent(issued.value, now + 6 * 60_000), null);
  /* Nor can one be minted with a future timestamp to buy more life. */
  const ahead = issueAttachIntent(LIVE, now + 10 * 60_000);
  assert.equal(readAttachIntent(ahead.value, now), null);
});

test("a signup instruction cannot be spent as an admin bootstrap, or the other way round", () => {
  /* The two purposes have different authorities behind them. A cookie left by
     a signup must not satisfy the operator bind, and the operator's own
     confirmation must not attach an address it never named. */
  const signup = { purpose: "email_signup", context: "s-customer-1", accountId: LIVE.accountId, subject: "person@example.test" };
  const read = readAttachIntent(issueAttachIntent(signup).value);
  assert.equal(attachIntentMatches(read, { ...signup, purpose: "admin_bootstrap" }), false);
  assert.equal(attachIntentMatches(read, signup), true);
  /* The address is compared without case, because mailboxes are. */
  assert.equal(attachIntentMatches(read, { ...signup, subject: "Person@Example.test" }), true);
  assert.equal(attachIntentMatches(read, { ...signup, subject: "other@example.test" }), false);
});

test("a signup instruction outlives the walk to a mailbox, and not the day", () => {
  const now = Date.now();
  const signup = { purpose: "email_signup", context: "s-customer-1", accountId: LIVE.accountId, subject: "person@example.test" };
  const issued = issueAttachIntent(signup, now);
  assert.ok(readAttachIntent(issued.value, now + 55 * 60_000), "still valid after 55 minutes");
  assert.equal(readAttachIntent(issued.value, now + 61 * 60_000), null, "not after an hour");
  /* The admin confirmation is read on screen and confirmed at once, so it
     lives minutes, not an hour. */
  const admin = issueAttachIntent(LIVE, now);
  assert.equal(readAttachIntent(admin.value, now + 6 * 60_000), null);
});

test("without a signing secret no intent is issued, so the step cannot be skipped", () => {
  const kept = process.env.BETA_TOKEN_SECRET;
  process.env.BETA_TOKEN_SECRET = "";
  try {
    assert.equal(issueAttachIntent(LIVE), null);
    assert.equal(readAttachIntent("anything.at.all"), null);
  } finally {
    process.env.BETA_TOKEN_SECRET = kept;
  }
});
