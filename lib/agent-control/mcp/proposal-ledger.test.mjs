// Run from repo root:
// node --test --test-isolation=none lib/agent-control/mcp/proposal-ledger.test.mjs
//
// The bounded ledger a write tool writes into, and the three things it cannot
// do: authorize, drop silently, or forget that somebody asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROPOSAL_LEDGER_CAPACITY,
  PROPOSAL_MAX_EVIDENCE,
  ProposalLedgerError,
  createProposalLedger,
} from "./proposal-ledger.ts";
import { RYNTRA_OWNER_AUTHORIZATION } from "../a2a/inbound.ts";

const source = readFileSync(new URL("./proposal-ledger.ts", import.meta.url), "utf8");

/**
 * The module's source with its comments removed.
 *
 * Every absence check in this file runs against this rather than the raw text,
 * and the reason cost one red run: this module's own prose explains that it
 * never writes `GRANTED_BY_OWNER` and never calls `Date.now()`, so a scan over
 * the raw source refuses the explanation along with the thing it explains. The
 * property being checked is what the code *does*, and a comment does nothing.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

function fixedClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-08-24T12:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

function seed(overrides = {}) {
  return {
    source: "MCP_CLIENT",
    tool: "propose_action",
    actionRef: "action:bnb-apex/create-job-draft@1",
    adapterRef: "adapter:bnb-apex@1",
    canonicalClass: "RECORD_ONLY",
    subjectRef: "book-golden-rwa",
    summary: "Draft a bounded integration job.",
    ownerAuthorization: "NOT_REQUESTED",
    ...overrides,
  };
}

function refusedWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ProposalLedgerError, `expected a ledger refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was refused`);
}

test("an opened proposal sits at PROPOSE with nothing decided", function () {
  const ledger = createProposalLedger(fixedClock());
  const record = ledger.open(seed());

  assert.equal(record.kind, "AGENT_CONTROL_PROPOSAL");
  assert.equal(record.phase, "PROPOSE");
  assert.equal(record.status, "OPEN");
  assert.equal(record.reviewRequested, false);
  assert.equal(record.ownerAuthorization, "NOT_REQUESTED");
  assert.deepEqual([...record.evidence], []);
  assert.equal(record.withdrawalReason, null);
  assert.equal(ledger.size(), 1);
});

test("GATE-PROVED: the ledger has no method that authorizes anything", function () {
  const ledger = createProposalLedger(fixedClock());
  const surface = Object.keys(ledger).sort();
  assert.deepEqual(surface, [
    "attachEvidence", "capacity", "list", "open", "read", "requestReview", "size", "withdraw",
  ]);

  /* `GRANTED_BY_OWNER` is a real value elsewhere in the product and this file
     never writes it. The assertion is on the source rather than on a return
     value, because a method that could produce it is the defect — reaching it
     once is only the symptom. */
  assert.ok(RYNTRA_OWNER_AUTHORIZATION.includes("GRANTED_BY_OWNER"));
  assert.doesNotMatch(code, /GRANTED_BY_OWNER/);

  const record = ledger.open(seed());
  const reviewed = ledger.requestReview(record.id);
  assert.equal(reviewed.reviewRequested, true);
  assert.equal(reviewed.phase, "PROPOSE", "asking for review does not advance the phase");
  assert.equal(reviewed.ownerAuthorization, "NOT_REQUESTED");
});

test("an A2A proposal keeps the authorization state its own path computed", function () {
  const ledger = createProposalLedger(fixedClock());
  const asking = ledger.open(seed({
    source: "A2A_INBOUND",
    tool: "ingest_a2a_task",
    actionRef: "action:a2a/inbound-task@1",
    adapterRef: "adapter:a2a@1",
    ownerAuthorization: "REQUESTED",
  }));
  assert.equal(asking.ownerAuthorization, "REQUESTED", "somebody asked, and the record says so");
  assert.equal(asking.phase, "PROPOSE");
});

test("GATE-PROVED: capacity refuses rather than dropping the oldest proposal", function () {
  const ledger = createProposalLedger(fixedClock());
  for (let index = 0; index < PROPOSAL_LEDGER_CAPACITY; index += 1) {
    ledger.open(seed({ summary: `proposal ${index}` }));
  }
  assert.equal(ledger.size(), PROPOSAL_LEDGER_CAPACITY);

  refusedWith("PROPOSAL_LEDGER_FULL", () => ledger.open(seed()));

  /* A ring buffer would have made a lost decision look like a decision nobody
     made. The first proposal is still there. */
  assert.equal(ledger.read("proposal-1").summary, "proposal 0");
  assert.equal(ledger.size(), PROPOSAL_LEDGER_CAPACITY);
});

test("evidence is bounded and kept beside its source, never folded into a verdict", function () {
  const ledger = createProposalLedger(fixedClock());
  const record = ledger.open(seed());

  for (let index = 0; index < PROPOSAL_MAX_EVIDENCE; index += 1) {
    ledger.attachEvidence(record.id, { sourceRef: `source:mcp@1`, note: `observation ${index}` });
  }
  refusedWith("PROPOSAL_EVIDENCE_LIMIT_REACHED", () =>
    ledger.attachEvidence(record.id, { sourceRef: "source:mcp@1", note: "one too many" }));

  const full = ledger.read(record.id);
  assert.equal(full.evidence.length, PROPOSAL_MAX_EVIDENCE);
  for (const entry of full.evidence) assert.equal(entry.sourceRef, "source:mcp@1");
  assert.equal(full.ownerAuthorization, "NOT_REQUESTED", "evidence is not a decision");
});

test("a withdrawn proposal keeps its record and takes no further writes", function () {
  const ledger = createProposalLedger(fixedClock());
  const record = ledger.open(seed());
  const withdrawn = ledger.withdraw(record.id, "the counterparty answered out of band");

  assert.equal(withdrawn.status, "WITHDRAWN");
  assert.equal(withdrawn.withdrawalReason, "the counterparty answered out of band");
  assert.equal(ledger.size(), 1, "withdrawal is recorded, not erased");
  assert.equal(ledger.read(record.id).status, "WITHDRAWN");

  refusedWith("PROPOSAL_ALREADY_WITHDRAWN", () => ledger.withdraw(record.id, "again"));
  refusedWith("PROPOSAL_ALREADY_WITHDRAWN", () => ledger.requestReview(record.id));
  refusedWith("PROPOSAL_ALREADY_WITHDRAWN", () =>
    ledger.attachEvidence(record.id, { sourceRef: "source:mcp@1", note: "late" }));
});

test("an unknown id refuses by name and leaks nothing about the ledger", function () {
  const ledger = createProposalLedger(fixedClock());
  ledger.open(seed());
  const error = refusedWith("PROPOSAL_UNKNOWN", () => ledger.read("proposal-999"));
  assert.doesNotMatch(error.message, /book-golden-rwa/);
});

test("two ledgers share nothing, because there is no store behind them", function () {
  /* The honest consequence of "this lives in the server process": a second
     process starts empty. The surface says so in its own words rather than
     letting a reader assume a queue. */
  const first = createProposalLedger(fixedClock());
  const second = createProposalLedger(fixedClock());
  first.open(seed());
  assert.equal(first.size(), 1);
  assert.equal(second.size(), 0);
  refusedWith("PROPOSAL_UNKNOWN", () => second.read("proposal-1"));
});

test("the ledger reaches no network, no database and no ambient clock", function () {
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /node:(net|http|https|tls|child_process|fs)/);
  assert.doesNotMatch(code, /process\.env/);
  assert.doesNotMatch(code, /\bpg\b|postgres|supabase|redis/i);
  assert.doesNotMatch(code, /Date\.now|new Date\(/, "the clock is a parameter so a test can pin it");
});
