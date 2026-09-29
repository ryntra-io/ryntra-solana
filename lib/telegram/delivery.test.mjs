import assert from "node:assert/strict";
import test from "node:test";

import { classifyTelegramSend, deliveryStateFrom, errorClassFrom } from "./delivery.ts";

test("a successful send is SENT with no error class", () => {
  const result = classifyTelegramSend({ ok: true });
  assert.deepEqual(result, { kind: "sent" });
  assert.equal(deliveryStateFrom(result.kind), "SENT");
  assert.equal(errorClassFrom(result.kind), null);
});

test("403 is blocked, not a fake read", () => {
  const result = classifyTelegramSend({ ok: false, error_code: 403 });
  assert.deepEqual(result, { kind: "blocked" });
  assert.equal(deliveryStateFrom("blocked"), "BLOCKED");
});

test("429 carries retry_after and is capped", () => {
  const result = classifyTelegramSend({
    ok: false,
    error_code: 429,
    parameters: { retry_after: 12 },
  });
  assert.deepEqual(result, { kind: "retry", retryAfterSec: 12 });
  const capped = classifyTelegramSend({
    ok: false,
    error_code: 429,
    parameters: { retry_after: 99_999 },
  });
  assert.equal(capped.kind, "retry");
  if (capped.kind === "retry") assert.equal(capped.retryAfterSec, 3600);
});

test("any other failure is FAILED", () => {
  assert.deepEqual(classifyTelegramSend({ ok: false, error_code: 500 }), { kind: "failed" });
});
