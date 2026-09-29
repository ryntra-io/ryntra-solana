// Run from repo root: node --test "app/(home)/agent-control-scenarios.test.mjs"
//
// The demo decides with a rule, not with a model. These tests are what makes
// that claim checkable: same input, same verdict, and a verdict that moves for
// a named reason rather than because something was regenerated.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AC_PHASES,
  AC_SCENARIOS,
  AC_ZONES,
  acDecide,
} from "./agent-control-scenarios.ts";

const byId = (id) => AC_SCENARIOS.find((scenario) => scenario.id === id);

test("the same input always produces the same verdict", () => {
  for (const scenario of AC_SCENARIOS) {
    const first = acDecide(scenario, scenario.amount, true);
    const second = acDecide(scenario, scenario.amount, true);
    assert.deepEqual(first, second, scenario.id);
  }
});

test("amount alone moves a scenario across all three verdicts", () => {
  const paidApi = byId("paid-api");
  assert.equal(acDecide(paidApi, 0.1, true).decision, "ALLOW");
  assert.equal(acDecide(paidApi, 0.1, false).decision, "REVIEW");
  // Over the per-action limit, and the reason says which limit.
  const blocked = acDecide(paidApi, 0.3, true);
  assert.equal(blocked.decision, "BLOCK");
  assert.equal(blocked.reasons[0].code, "PER_ACTION_LIMIT");
});

test("counterparty alone moves a verdict without touching the amount", () => {
  const transfer = byId("usdc-payment");
  assert.equal(acDecide(transfer, 40, true).decision, "ALLOW");
  const review = acDecide(transfer, 40, false);
  assert.equal(review.decision, "REVIEW");
  assert.equal(review.reasons[0].code, "COUNTERPARTY_UNKNOWN");
});

test("an action outside the mandate is blocked on scope, never on budget", () => {
  const swap = byId("token-swap");
  const outcome = acDecide(swap, 1, true);
  assert.equal(outcome.decision, "BLOCK");
  assert.equal(outcome.reasons[0].code, "MANDATE_SCOPE");
  // Even a trivially small amount stays blocked: scope is not a budget question.
  assert.equal(acDecide(swap, 0.01, true).decision, "BLOCK");
});

test("the RWA scenario is the beachhead: stale reference and closed market escalate", () => {
  const rwa = byId("rwa-transfer");
  const outcome = acDecide(rwa, 500, true);
  assert.equal(outcome.decision, "REVIEW");
  const codes = outcome.reasons.map((reason) => reason.code);
  assert.ok(codes.includes("REFERENCE_STALE"));
  assert.ok(codes.includes("MARKET_HOURS_MISMATCH"));
});

test("precedence is mandate, then limit, then budget", () => {
  const transfer = byId("usdc-payment");
  // Over both the budget and, with an unknown payee, a review trigger. The
  // hard stop has to win, or the page would show a softer verdict than the
  // product would.
  const outcome = acDecide(transfer, 200, false);
  assert.equal(outcome.decision, "BLOCK");
  assert.equal(outcome.reasons[0].code, "BUDGET_EXCEEDED");
});

test("a blocked or escalated action never claims to have executed", () => {
  for (const scenario of AC_SCENARIOS) {
    for (const known of [true, false]) {
      const outcome = acDecide(scenario, scenario.amount, known);
      if (outcome.decision === "ALLOW") continue;
      assert.ok(
        outcome.reachedPhase < 3,
        `${scenario.id} claims to reach execution while ${outcome.decision}`,
      );
    }
  }
});

test("every reason carries a machine code and a sentence", () => {
  for (const scenario of AC_SCENARIOS) {
    for (const known of [true, false]) {
      for (const reason of acDecide(scenario, scenario.amount, known).reasons) {
        assert.match(reason.code, /^[A-Z][A-Z_]+$/, reason.code);
        assert.ok(reason.text.length > 20, reason.code);
      }
    }
  }
});

test("the request sentence reads as a sentence", () => {
  // The gap this closes: every other test read the verdict, so nobody read the
  // ask. It shipped "send $40 USDC USDC to a supplier" and "move $500 Tokenized
  // equity of a tokenized security", and only opening the page found it.
  for (const scenario of AC_SCENARIOS) {
    const sentence = scenario.ask("$1");
    const words = sentence.toLowerCase().match(/[a-z]+/g) ?? [];
    for (let i = 1; i < words.length; i += 1) {
      assert.notEqual(words[i], words[i - 1], `${scenario.id}: "${sentence}" repeats "${words[i]}"`);
    }
    assert.ok(sentence.includes("$1"), `${scenario.id} drops the amount`);
    assert.ok(!/\$\d+\s+\$/.test(sentence), `${scenario.id} prints two amounts`);
    // It has to complete "Agent wants to …" without reading as a fragment.
    assert.match(sentence, /^[a-z]/, `${scenario.id} should start lowercase after "wants to"`);
  }
});

test("the five phases carry a trust zone each", () => {
  assert.equal(AC_PHASES.length, 5);
  assert.deepEqual(
    AC_PHASES.map((phase) => phase.name),
    ["Propose", "Verify", "Authorize", "Execute", "Prove"],
  );
  for (const phase of AC_PHASES) {
    assert.ok(AC_ZONES[phase.zone], `${phase.key} has no zone label`);
  }
  // Execution is not Ryntra's. If this ever flips, the page is claiming the
  // product signs or settles, which it does not.
  assert.equal(AC_PHASES.find((phase) => phase.key === "execute").zone, "wallet");
  assert.equal(AC_PHASES.find((phase) => phase.key === "propose").zone, "runtime");
});
