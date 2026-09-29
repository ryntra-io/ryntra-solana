import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createFileGuardStore, createMemoryGuardStore } from "../guard/store.ts";
import {
  markSendSubmittedUnknown,
  readSendAttempt,
  reserveSendAttempt,
  transitionSendAttempt,
} from "./send-attempt.ts";

/**
 * Submit exactly once, and never twice.
 *
 * The in-process guard this replaces was correct on one warm instance and
 * meaningless the moment there were two: each had its own memory, so a
 * retried request could reach a second broadcast of bytes that were already
 * on the network. What makes "once" true is a durable record that crosses
 * the boundary before the network call, and no path at all that clears it
 * afterwards.
 */

const SIGNATURE = "3".repeat(88);
const OTHER_SIGNATURE = "4".repeat(88);
const MESSAGE_DIGEST = `0x${"a".repeat(64)}`;
const OTHER_DIGEST = `0x${"b".repeat(64)}`;
const REVIEW_DIGEST = `0x${"c".repeat(64)}`;
const NOW = "2026-08-29T12:00:00.000Z";

function attempt(overrides = {}) {
  return {
    network: "mainnet",
    signature: SIGNATURE,
    messageDigest: MESSAGE_DIGEST,
    reviewDigest: REVIEW_DIGEST,
    at: NOW,
    ...overrides,
  };
}

test("the first reserve wins and the record starts RESERVED", async () => {
  const store = createMemoryGuardStore();
  const reserved = await reserveSendAttempt({ store, ...attempt() });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.record.state, "RESERVED");
  assert.equal(reserved.record.signature, SIGNATURE);

  const read = await readSendAttempt({ store, network: "mainnet", signature: SIGNATURE });
  assert.equal(read.ok, true);
  assert.equal(read.record.state, "RESERVED");
});

test("an identical duplicate returns the same record instead of a second reservation", async () => {
  const store = createMemoryGuardStore();
  const first = await reserveSendAttempt({ store, ...attempt() });
  const second = await reserveSendAttempt({ store, ...attempt() });
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.record.reservedAt, first.record.reservedAt);
});

test("the same signature with a different message is refused, never overwritten", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });
  const conflicting = await reserveSendAttempt({
    store,
    ...attempt({ messageDigest: OTHER_DIGEST }),
  });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, "SEND_ATTEMPT_CONFLICT");
});

test("the submit boundary is crossed once, and never uncrossed", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });

  const marked = await markSendSubmittedUnknown({ store, network: "mainnet", signature: SIGNATURE });
  assert.equal(marked.ok, true);
  assert.equal(marked.record.state, "SUBMITTED_UNKNOWN");

  /* Marking again is idempotent — a retried request must not fail here — but
     it also must not produce a second broadcast, which is why the caller asks
     this before its one network call and treats a crossed boundary as final. */
  const again = await markSendSubmittedUnknown({ store, network: "mainnet", signature: SIGNATURE });
  assert.equal(again.ok, true);
  assert.equal(again.record.state, "SUBMITTED_UNKNOWN");

  /* No transition returns a submitted attempt to a releasable one. */
  const released = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature: SIGNATURE,
    to: "EXPIRED_BEFORE_SUBMIT",
    at: NOW,
  });
  assert.equal(released.ok, false);
  assert.equal(released.code, "SEND_ATTEMPT_TRANSITION_REFUSED");
});

test("an unsubmitted attempt may expire, and a submitted one settles forward only", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });
  const expired = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature: SIGNATURE,
    to: "EXPIRED_BEFORE_SUBMIT",
    at: NOW,
  });
  assert.equal(expired.ok, true);

  const other = createMemoryGuardStore();
  await reserveSendAttempt({ store: other, ...attempt() });
  await markSendSubmittedUnknown({ store: other, network: "mainnet", signature: SIGNATURE });
  for (const to of ["CONFIRMED", "FINALIZED", "RECEIPTED"]) {
    const moved = await transitionSendAttempt({
      store: other,
      network: "mainnet",
      signature: SIGNATURE,
      to,
      at: NOW,
    });
    assert.equal(moved.ok, true, `${to} must be reachable after submit`);
  }
});

test("replaying recovery after EXPIRED_AFTER_SUBMIT stays terminal and succeeds", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });
  await markSendSubmittedUnknown({ store, network: "mainnet", signature: SIGNATURE });

  const first = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature: SIGNATURE,
    to: "EXPIRED_AFTER_SUBMIT",
    at: NOW,
  });
  assert.equal(first.ok, true);
  assert.equal(first.record.state, "EXPIRED_AFTER_SUBMIT");

  /* A browser may repeat the read after the server has already closed the
     landing window. Recovery is read-only and idempotent: the same terminal
     fact must be returned, not turned into a transition refusal that locks the
     next order behind another Recover button. */
  const replay = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature: SIGNATURE,
    to: "EXPIRED_AFTER_SUBMIT",
    at: "2026-08-29T12:00:01.000Z",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.record.state, "EXPIRED_AFTER_SUBMIT");
});

test("two concurrent reserves of the same signature produce exactly one winner", async () => {
  const store = createMemoryGuardStore();
  const [left, right] = await Promise.all([
    reserveSendAttempt({ store, ...attempt() }),
    reserveSendAttempt({ store, ...attempt() }),
  ]);
  assert.equal(left.ok && right.ok, true);
  const duplicates = [left, right].filter((result) => result.duplicate === true);
  assert.equal(duplicates.length, 1, "exactly one of the two must be the duplicate");
});

test("the same signature on another network is a different attempt", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });
  const devnet = await reserveSendAttempt({ store, ...attempt({ network: "devnet" }) });
  assert.equal(devnet.ok, true);
  assert.equal(devnet.duplicate, undefined);
});

test("a cold reopen preserves the crossed boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ryntra-send-attempt-"));
  try {
    const first = createFileGuardStore({ directory });
    await reserveSendAttempt({ store: first, ...attempt() });
    await markSendSubmittedUnknown({ store: first, network: "mainnet", signature: SIGNATURE });

    /* A new process, the same directory. This is the case the in-process
       guard could not answer at all. */
    const second = createFileGuardStore({ directory });
    const read = await readSendAttempt({ store: second, network: "mainnet", signature: SIGNATURE });
    assert.equal(read.ok, true);
    assert.equal(read.record.state, "SUBMITTED_UNKNOWN");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unknown signature reads as absent rather than as safe to submit", async () => {
  const store = createMemoryGuardStore();
  const read = await readSendAttempt({ store, network: "mainnet", signature: OTHER_SIGNATURE });
  assert.equal(read.ok, false);
  assert.equal(read.code, "SEND_ATTEMPT_ABSENT");
});

test("a malformed stored record is UNAVAILABLE, never treated as a fresh attempt", async () => {
  const store = createMemoryGuardStore();
  await store
    .collection("solanaSendAttempts")
    .set(`mainnet:${SIGNATURE}`, { not: "a send attempt" });
  const read = await readSendAttempt({ store, network: "mainnet", signature: SIGNATURE });
  assert.equal(read.ok, false);
  assert.equal(read.code, "SEND_ATTEMPT_UNAVAILABLE");

  /* And a reserve over corrupt state refuses rather than clobbering it: the
     record it cannot read might be a crossed submit boundary. */
  const reserved = await reserveSendAttempt({ store, ...attempt() });
  assert.equal(reserved.ok, false);
  assert.equal(reserved.code, "SEND_ATTEMPT_UNAVAILABLE");
});

test("the record stores hashes and state, never signed wire bytes or token names", async () => {
  const store = createMemoryGuardStore();
  await reserveSendAttempt({ store, ...attempt() });
  const stored = await store.collection("solanaSendAttempts").get(`mainnet:${SIGNATURE}`);
  const serialized = JSON.stringify(stored);
  assert.ok(!/wire|base64|secret|mnemonic/i.test(serialized));
  assert.deepEqual(
    Object.keys(stored).sort(),
    [
      "messageDigest",
      "network",
      "receiptHash",
      "reservedAt",
      "reviewDigest",
      "signature",
      "state",
      "updatedAt",
      "version",
    ],
  );
});
