import { test } from "node:test";
import assert from "node:assert/strict";

import { depositSenderOf } from "../../lib/relay/bridge-chains.ts";
import { actionOf } from "../coin/ticket-rules.ts";
import { bridgeQuietlyAgain } from "./bridge-form.ts";

// Swap speed (18.11): the button while the card builds its own order, the bridge's quiet asks, and the stand-in
// recipient Relay keeps.

const BASE = { phase: "idle", side: "buy", connected: true, connecting: false, problem: null, hasAmount: true, empty: false, priced: true, exact: false, canTopUp: true };

test("while the card builds its own order the button stays the verb and can be pressed; a press's own order waits", () => {
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing", auto: true }), { label: "verb", does: "press", busy: false });
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing", auto: false }), { label: "building", does: "none", busy: true });
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing" }), { label: "building", does: "none", busy: true }, "absent is a press's");
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing", auto: true, exact: true }), { label: "building", does: "none", busy: true }, "renewing bytes on screen is a wait");
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing", auto: true, connected: false }), { label: "connect", does: "press", busy: false }, "the rest of the rules still read");
  assert.deepEqual(actionOf({ ...BASE, phase: "preparing", auto: true, problem: "balance" }), { label: "short", does: "none", busy: false });
});

test("the bridge asks again quietly for Relay's window or a lost answer, never for a way that is not there", () => {
  for (const code of ["RATE_LIMITED", "QUOTE_RATE_LIMITED", "QUOTE_HTTP_ERROR", "QUOTE_UNREADABLE", "CHAINS_UNAVAILABLE", "UNAVAILABLE"]) assert.equal(bridgeQuietlyAgain(code), true, code);
  for (const code of ["TIMEOUT", "QUOTE_TRANSPORT", "QUOTE_NO_ROUTE", "QUOTE_MISMATCH", "QUOTE_AMOUNT_TOO_SMALL", "SAME_COIN", "RECIPIENT_INVALID", "ORIGIN_REFUSED"]) assert.equal(bridgeQuietlyAgain(code), false, code);
});

test("an EVM stand-in is the burn address in its checksummed spelling, the one Relay keeps as the recipient", () => {
  assert.equal(depositSenderOf({ id: 8453, vm: "evm" }), "0x000000000000000000000000000000000000dEaD");
  assert.equal(depositSenderOf({ id: 792703809, vm: "svm" }), "CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr");
});
