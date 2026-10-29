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

test("in the app's frame a page's Connect opens the frame's own wallet trigger, and the frame keeps the focus", async () => {
  const { findSolanaConnectionTrigger, SOLANA_WALLET_TRIGGER_ID } = await import("./connection-trigger.client.ts");
  const frame = { focus() {}, click() {} };
  const legacy = { focus() {}, click() {} };
  const asked = [];
  const doc = (byId, bySelector) => ({
    getElementById: (id) => (asked.push(`id:${id}`), byId),
    querySelector: (selector) => (asked.push(`sel:${selector}`), bySelector),
  });
  assert.deepEqual(findSolanaConnectionTrigger(doc(frame, legacy)), { trigger: frame, refocus: false });
  assert.equal(asked[0], `id:${SOLANA_WALLET_TRIGGER_ID}`);
  /* the old shell's control still answers where the frame's is absent */
  assert.deepEqual(findSolanaConnectionTrigger(doc(null, legacy)), { trigger: legacy, refocus: true });
  assert.equal(findSolanaConnectionTrigger(doc(null, null)), null);
});

test("the frame renders the trigger under the same id the pages look for", async () => {
  const { readFileSync } = await import("node:fs");
  const shell = readFileSync(new URL("../../app/product-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /const WALLET_TRIGGER = SOLANA_WALLET_TRIGGER_ID;/);
  assert.match(shell, /triggerId=\{WALLET_TRIGGER\}/);
});

test("a panel already open stays open: the toggle is not pressed again", () => {
  const events = [];
  const opened = openSolanaConnection(() => ({ focus: () => events.push("focus"), click: () => events.push("click"), getAttribute: (name) => (name === "aria-expanded" ? "true" : null) }), (task) => task());
  assert.equal(opened, true);
  assert.deepEqual(events, []);
});
