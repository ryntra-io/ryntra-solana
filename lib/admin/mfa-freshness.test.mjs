/*
 * `aal2` is a level, not a moment. These are the cases where treating the two
 * as the same thing gave a stale browser the standing of a fresh code.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MFA_FRESH_S, mfaIsFresh, totpVerifiedAtMs } from "./mfa-freshness.ts";

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const secondsAgo = (n) => Math.floor((NOW - n * 1000) / 1000);

test("the second factor's own timestamp is read, not the session's level", () => {
  const methods = [
    { method: "password", timestamp: secondsAgo(9 * 3600) },
    { method: "totp", timestamp: secondsAgo(120) },
  ];
  assert.equal(totpVerifiedAtMs(methods), (secondsAgo(120)) * 1000);
  assert.equal(mfaIsFresh(totpVerifiedAtMs(methods), NOW), true);
});

test("a session that has been aal2 since this morning is not a fresh second factor", () => {
  /* The exact failure: a browser left open overnight re-opens an admin session
     and, because it is still aal2, the row used to be stamped as verified now.
     Every sensitive action then ran without anybody typing a code. */
  const stale = [{ method: "totp", timestamp: secondsAgo(9 * 3600) }];
  assert.equal(mfaIsFresh(totpVerifiedAtMs(stale), NOW), false);
});

test("the window is exactly MFA_FRESH_S, and its edge belongs to the fresh side", () => {
  const atEdge = NOW - MFA_FRESH_S * 1000;
  assert.equal(mfaIsFresh(atEdge, NOW), true);
  assert.equal(mfaIsFresh(atEdge - 1, NOW), false);
});

test("a password-only session has no second factor to be fresh", () => {
  assert.equal(totpVerifiedAtMs([{ method: "password", timestamp: secondsAgo(5) }]), null);
  assert.equal(totpVerifiedAtMs([]), null);
  assert.equal(totpVerifiedAtMs(undefined), null);
  assert.equal(totpVerifiedAtMs(null), null);
  assert.equal(mfaIsFresh(null, NOW), false);
});

test("nonsense timestamps are dropped rather than read as now", () => {
  assert.equal(totpVerifiedAtMs([{ method: "totp", timestamp: Number.NaN }]), null);
  assert.equal(totpVerifiedAtMs([{ method: "totp", timestamp: "recently" }]), null);
  /* A clock ahead of the server does not make a factor fresh forever. */
  assert.equal(mfaIsFresh(NOW + 60_000, NOW), false);
});

test("the most recent of several factors is the one that counts", () => {
  const methods = [
    { method: "totp", timestamp: secondsAgo(3 * 3600) },
    { method: "mfa/totp", timestamp: secondsAgo(30) },
  ];
  assert.equal(mfaIsFresh(totpVerifiedAtMs(methods), NOW), true);
});
