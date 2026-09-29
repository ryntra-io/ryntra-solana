import assert from "node:assert/strict";
import test from "node:test";

import { effectiveValidUntil, evaluateFreshness } from "./freshness.ts";

const observedAt = "2026-08-22T10:00:00.000Z";

test("the earlier explicit or max-age boundary wins", () => {
  assert.equal(
    effectiveValidUntil({
      observedAt,
      validUntil: "2026-08-22T10:02:00.000Z",
      policy: { maxAgeSeconds: 60 },
    }),
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(
    effectiveValidUntil({
      observedAt,
      validUntil: "2026-08-22T10:00:30.000Z",
      policy: { maxAgeSeconds: 60 },
    }),
    "2026-08-22T10:00:30.000Z",
  );
});

test("validUntil null uses max age and never means forever", () => {
  assert.equal(
    effectiveValidUntil({ observedAt, validUntil: null, policy: { maxAgeSeconds: 60 } }),
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(
    effectiveValidUntil({ observedAt, validUntil: null, policy: { maxAgeSeconds: null } }),
    null,
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt,
      validUntil: null,
      policy: { maxAgeSeconds: null },
      asOf: observedAt,
    }),
    { state: "STALE", effectiveValidUntil: null, reason: "FRESHNESS_BOUNDARY_UNKNOWN" },
  );
});

test("freshness is current exactly at the boundary and stale one millisecond later", () => {
  const input = { observedAt, validUntil: null, policy: { maxAgeSeconds: 60 } };
  assert.deepEqual(evaluateFreshness({ ...input, asOf: "2026-08-22T10:01:00.000Z" }), {
    state: "CURRENT",
    effectiveValidUntil: "2026-08-22T10:01:00.000Z",
  });
  assert.deepEqual(evaluateFreshness({ ...input, asOf: "2026-08-22T10:01:00.001Z" }), {
    state: "STALE",
    effectiveValidUntil: "2026-08-22T10:01:00.000Z",
    reason: "EXPIRED",
  });
});

test("future observations and inverted validity windows fail closed", () => {
  assert.deepEqual(
    evaluateFreshness({
      observedAt: "2026-08-22T10:00:00.001Z",
      validUntil: null,
      policy: { maxAgeSeconds: 60 },
      asOf: observedAt,
    }),
    { state: "INVALID", code: "FUTURE_OBSERVATION" },
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt,
      validUntil: "2026-08-22T09:59:59.999Z",
      policy: { maxAgeSeconds: 60 },
      asOf: observedAt,
    }),
    { state: "INVALID", code: "INVALID_VALIDITY_WINDOW" },
  );
});

test("invalid timestamps and max age are rejected rather than normalized", () => {
  assert.deepEqual(
    evaluateFreshness({
      observedAt: "not-a-time",
      validUntil: null,
      policy: { maxAgeSeconds: 60 },
      asOf: observedAt,
    }),
    { state: "INVALID", code: "INVALID_TIME" },
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt,
      validUntil: null,
      policy: { maxAgeSeconds: -1 },
      asOf: observedAt,
    }),
    { state: "INVALID", code: "INVALID_MAX_AGE" },
  );
});

test("freshness timestamps require an explicit UTC or numeric offset", () => {
  assert.deepEqual(
    evaluateFreshness({
      observedAt: "2026-08-22T10:00:00",
      validUntil: null,
      policy: { maxAgeSeconds: 60 },
      asOf: "2026-08-22T10:00:30.000Z",
    }),
    { state: "INVALID", code: "INVALID_TIME" },
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt,
      validUntil: "2026-08-22T10:01:00",
      policy: { maxAgeSeconds: 60 },
      asOf: "2026-08-22T10:00:30.000Z",
    }),
    { state: "INVALID", code: "INVALID_TIME" },
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt,
      validUntil: null,
      policy: { maxAgeSeconds: 60 },
      asOf: "2026-08-22T10:00:30",
    }),
    { state: "INVALID", code: "INVALID_TIME" },
  );
  assert.deepEqual(
    evaluateFreshness({
      observedAt: "2026-08-22T13:00:00+03:00",
      validUntil: null,
      policy: { maxAgeSeconds: 60 },
      asOf: "2026-08-22T10:00:30.000Z",
    }),
    {
      state: "CURRENT",
      effectiveValidUntil: "2026-08-22T10:01:00.000Z",
    },
  );
});
