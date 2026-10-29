// Run from repo root: node --test lib/agent-control/procurement/mandate.test.mjs
//
// The owner's rule, as a table and as refusals.
//
// Two of Solana's mandates hold both the recipient and the end date; three do
// not, and Blueshift's Pull Program has no audit behind either. The first three
// tests are the table itself, because the whole decision rests on which program
// holds which fact — and a wrong row there is a permanent spending authority
// that every other check would then happily validate.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLUESHIFT_PULL_PROGRAM,
  MANDATE_KINDS_WITH_RECIPIENT_AND_EXPIRY,
  MANDATE_PROGRAM_GAP,
  MANDATE_REFUSALS,
  OWNER_WORD_LIFTS_PROGRAM_GAP,
  PROGRAM_MANDATE_KINDS,
  evaluateProgramMandate,
} from "./mandate.ts";
import {
  DEVNET,
  FIXTURE,
  MAINNET,
  USDC_DEVNET,
  USDC_MAINNET,
  merchantPlan,
  pullDelegation,
  smartAccountLimit,
  subscriptionsDelegation,
  v4SpendingLimit,
} from "./fixtures.ts";

const NOW_MS = Date.parse("2026-10-26T12:00:00.000Z");

function request(overrides = {}) {
  return {
    network: MAINNET,
    mint: USDC_MAINNET,
    payTo: FIXTURE.payTo,
    amountBaseUnits: "200000",
    spender: FIXTURE.agent,
    agentBoundBaseUnits: "500000",
    ...overrides,
  };
}

const decide = (read, overrides = {}, nowMs = NOW_MS) =>
  evaluateProgramMandate({ read, request: request(overrides), nowMs });

/* ── The table ────────────────────────────────────────────────────────────── */

test("every kind is either sound or has a named gap, and none is both", () => {
  for (const kind of PROGRAM_MANDATE_KINDS) {
    const sound = MANDATE_KINDS_WITH_RECIPIENT_AND_EXPIRY.includes(kind);
    const gap = MANDATE_PROGRAM_GAP[kind];
    assert.equal(
      sound,
      gap === undefined,
      `${kind} is ${sound ? "listed as sound" : "not sound"} and its gap is ${String(gap)}`,
    );
  }
  assert.deepEqual(
    [...MANDATE_KINDS_WITH_RECIPIENT_AND_EXPIRY],
    ["SQUADS_SMART_ACCOUNT_SPENDING_LIMIT", "SUBSCRIPTIONS_MERCHANT_PLAN"],
  );
});

test("Squads v4 is refused for its missing expiry, whatever else is right", () => {
  // GATE-PROVED: this read is active, on the right chain, in the right token,
  // with the right spender, the right recipient and plenty of room. The only
  // thing wrong with it is that the program has no expiry — and that alone is
  // enough, which is why the gap is checked before any of the rest.
  const decision = decide(v4SpendingLimit(NOW_MS));
  assert.equal(decision.authorization, "HUMAN_SIGNATURE");
  assert.equal(decision.enforcement, "NOT_PROGRAM_ENFORCED");
  assert.equal(decision.reasonCode, "PROGRAM_HOLDS_NO_EXPIRY");
  assert.match(decision.detail, /Ryntra-side timer is not a bound/);
});

test("a Subscriptions fixed or recurring delegation is refused for its missing recipient", () => {
  for (const kind of ["SUBSCRIPTIONS_FIXED_DELEGATION", "SUBSCRIPTIONS_RECURRING_DELEGATION"]) {
    const decision = decide(subscriptionsDelegation(kind, NOW_MS));
    assert.equal(decision.authorization, "HUMAN_SIGNATURE", kind);
    assert.equal(decision.reasonCode, "PROGRAM_HOLDS_NO_RECIPIENT", kind);
    assert.match(decision.detail, /could pay itself/);
  }
});

test("Blueshift's Pull Program is refused on both chains and reaches no person", () => {
  for (const network of [DEVNET, MAINNET]) {
    const decision = decide(pullDelegation(), {
      network,
      mint: network === DEVNET ? USDC_DEVNET : USDC_MAINNET,
    });
    assert.equal(decision.authorization, "HUMAN_SIGNATURE", network);
    assert.equal(decision.reasonCode, "PROGRAM_NOT_AUDITED", network);
  }
  assert.equal(BLUESHIFT_PULL_PROGRAM.audit, "NONE");
  assert.equal(BLUESHIFT_PULL_PROGRAM.reachesPeople, false);
  assert.deepEqual([...BLUESHIFT_PULL_PROGRAM.mayBeTriedOn], ["PAPER", "DEVNET"]);
});

test("nothing in the code lifts a program gap", () => {
  // Lifting a gap is a recorded product decision and an edit to the gate,
  // never a value somebody can set.
  assert.equal(OWNER_WORD_LIFTS_PROGRAM_GAP, false);
});

/* ── The sound kinds ──────────────────────────────────────────────────────── */

test("a smart-account spending limit with a list and an end date lets the agent act alone", () => {
  const decision = decide(smartAccountLimit({}, NOW_MS));
  assert.equal(decision.authorization, "AGENT_ALONE");
  assert.equal(decision.enforcement, "PROGRAM_ENFORCED");
  assert.deepEqual([...decision.holds], ["RECIPIENT", "EXPIRY"]);
  assert.equal(decision.availableBaseUnits, "1000000");
});

test("a merchant plan with a non-empty list and a last date does the same", () => {
  const decision = decide(merchantPlan({}, NOW_MS));
  assert.equal(decision.authorization, "AGENT_ALONE");
  assert.equal(decision.kind, "SUBSCRIPTIONS_MERCHANT_PLAN");
});

test("an unread mandate is never active", () => {
  const decision = decide(smartAccountLimit({ state: "UNKNOWN" }, NOW_MS));
  assert.equal(decision.reasonCode, "MANDATE_READ_UNKNOWN");
  for (const state of ["REVOKED", "EXPIRED"]) {
    assert.equal(decide(smartAccountLimit({ state }, NOW_MS)).reasonCode, "MANDATE_NOT_ACTIVE", state);
  }
});

test("a mandate on another chain, in another token or for another spender refuses by name", () => {
  assert.equal(decide(smartAccountLimit({}, NOW_MS), { network: DEVNET }).reasonCode, "MANDATE_NETWORK_MISMATCH");
  assert.equal(decide(smartAccountLimit({}, NOW_MS), { mint: FIXTURE.otherMint }).reasonCode, "MANDATE_MINT_MISMATCH");
  assert.equal(
    decide(smartAccountLimit({}, NOW_MS), { spender: FIXTURE.otherAgent }).reasonCode,
    "MANDATE_SPENDER_MISMATCH",
  );
});

test("an empty destination list is a refusal rather than «anywhere»", () => {
  // GATE-PROVED: Squads itself reads an empty list as unrestricted. Inheriting
  // that reading is how a mandate becomes a blank cheque.
  const decision = decide(smartAccountLimit({ destinations: [] }, NOW_MS));
  assert.equal(decision.reasonCode, "MANDATE_RECIPIENT_LIST_EMPTY");
  assert.match(decision.detail, /anywhere is not a mandate/);
});

test("a recipient the program does not hold refuses, and the count is named", () => {
  const decision = decide(smartAccountLimit({}, NOW_MS), { payTo: FIXTURE.otherPayTo });
  assert.equal(decision.reasonCode, "MANDATE_RECIPIENT_NOT_LISTED");
  assert.match(decision.detail, /1 recipients the program holds/);
});

test("a plan with no last date, or one already past, refuses", () => {
  assert.equal(decide(merchantPlan({ expiresAtMs: 0 }, NOW_MS)).reasonCode, "MANDATE_EXPIRY_ABSENT");
  assert.equal(
    decide(merchantPlan({ expiresAtMs: NOW_MS - 1 }, NOW_MS)).reasonCode,
    "MANDATE_EXPIRY_PASSED",
  );
});

test("a payment above what the program allows right now refuses", () => {
  const decision = decide(smartAccountLimit({ availableBaseUnits: "100000" }, NOW_MS), {
    amountBaseUnits: "100001",
  });
  assert.equal(decision.reasonCode, "MANDATE_AMOUNT_ABOVE_AVAILABLE");
});

test("amounts are whole base units, and nothing is a payment of nothing", () => {
  assert.equal(decide(smartAccountLimit({}, NOW_MS), { amountBaseUnits: "0.2" }).reasonCode, "MANDATE_FIELDS_MALFORMED");
  assert.equal(decide(smartAccountLimit({}, NOW_MS), { amountBaseUnits: "0" }).reasonCode, "MANDATE_FIELDS_MALFORMED");
});

/* ── Ryntra's own bound ───────────────────────────────────────────────────── */

test("above the agent's own bound a person confirms, and the mandate stays sound", () => {
  // The Ledger Agent Intent model: up to the bound the agent acts, above it a
  // person confirms. A different answer from «a person signs», deliberately.
  const decision = decide(smartAccountLimit({}, NOW_MS), { amountBaseUnits: "500001" });
  assert.equal(decision.authorization, "HUMAN_CONFIRMATION");
  assert.equal(decision.enforcement, "PROGRAM_ENFORCED");
  assert.equal(decision.reasonCode, "AMOUNT_ABOVE_AGENT_BOUND");
  assert.match(decision.detail, /acts alone up to 500000/);
});

test("exactly at the bound the agent still acts alone", () => {
  const decision = decide(smartAccountLimit({}, NOW_MS), { amountBaseUnits: "500000" });
  assert.equal(decision.authorization, "AGENT_ALONE");
});

test("every refusal the gate can produce is in its own list", () => {
  const unique = new Set(MANDATE_REFUSALS);
  assert.equal(unique.size, MANDATE_REFUSALS.length);
  for (const produced of [
    "PROGRAM_HOLDS_NO_EXPIRY",
    "PROGRAM_HOLDS_NO_RECIPIENT",
    "PROGRAM_NOT_AUDITED",
    "MANDATE_READ_UNKNOWN",
    "MANDATE_NOT_ACTIVE",
    "MANDATE_NETWORK_MISMATCH",
    "MANDATE_MINT_MISMATCH",
    "MANDATE_SPENDER_MISMATCH",
    "MANDATE_RECIPIENT_LIST_EMPTY",
    "MANDATE_RECIPIENT_NOT_LISTED",
    "MANDATE_EXPIRY_ABSENT",
    "MANDATE_EXPIRY_PASSED",
    "MANDATE_AMOUNT_ABOVE_AVAILABLE",
    "MANDATE_FIELDS_MALFORMED",
    "AMOUNT_ABOVE_AGENT_BOUND",
  ]) {
    assert.ok(MANDATE_REFUSALS.includes(produced), `${produced} is produced and not listed`);
  }
});
