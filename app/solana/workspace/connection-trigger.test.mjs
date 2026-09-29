import assert from "node:assert/strict";
import test from "node:test";

import { openSolanaConnection } from "./connection-trigger.client.ts";

test("an in-page Connect action focuses the real shell trigger before opening it", () => {
  const events = [];
  let resolveCount = 0;
  const opened = openSolanaConnection(
    () => {
      resolveCount += 1;
      return resolveCount === 1
        ? { focus: () => events.push("focus-old"), click: () => events.push("click") }
        : { focus: () => events.push("focus-current"), click: () => events.push("unexpected-click") };
    },
    (task) => task(),
  );
  assert.equal(opened, true);
  assert.deepEqual(events, ["focus-old", "click", "focus-current"]);
});

test("a missing shell trigger is a bounded no-op", () => {
  assert.equal(openSolanaConnection(() => null), false);
});
