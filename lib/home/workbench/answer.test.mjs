import assert from "node:assert/strict";
import test from "node:test";

import { RYN_ANSWER_SECTIONS, compileRynAnswer } from "./answer.ts";

const fact = (overrides = {}) => ({
  key: "multiplier",
  statement: "TSLA-USD carries a uiMultiplier of 1.000000.",
  value: "1.000000",
  sourceId: "rhj",
  sourceLabel: "Robinhood stock tokens",
  observedAt: "2026-08-23T09:00:00.000Z",
  freshness: "CURRENT",
  entitlement: "PUBLIC",
  ...overrides,
});

const input = (overrides = {}) => ({
  asOf: "2026-08-23T10:00:00.000Z",
  question: {
    questionId: "q_change_tsla",
    prompt: "What changed on TSLA-USD, and what does it touch that I hold?",
    operation: "EXPLAIN",
    subjectLabel: "TSLA-USD",
    subjectHref: "/app/research",
  },
  plainAnswer: "One scheduled corporate action is declared on TSLA-USD and you hold it in one book.",
  facts: [fact()],
  conflicts: [],
  unknowns: [],
  scenarios: [
    {
      scenarioId: "s_multiplier",
      label: "If the declared multiplier takes effect",
      assumption: "The declared 2.000000 multiplier replaces 1.000000 on the effective date.",
      effect: "Your unit count doubles and the per-unit price halves; the position value is unchanged.",
      requires: ["multiplier"],
      basis: "ISSUER_DECLARED",
    },
  ],
  relevance: {
    state: "RELEVANT",
    positions: ["TSLA-USD in the live book"],
    plans: [],
    reason: null,
  },
  deterministic: {
    statement: "TSLA-USD is 42.10% of priced value against a 25.00% concentration limit.",
    value: "42.10%",
    basis: "PRICED_POSITIONS_AT_AS_OF",
    inputDigest: "0xabc123",
  },
  risk: { state: "AVAILABLE", reference: "portfolio", reason: null },
  nextSteps: [
    { kind: "REVIEW_EVIDENCE", label: "Open the change", href: "/app/research", reason: null },
  ],
  sourceVersions: [{ sourceId: "rhj", label: "Robinhood stock tokens", version: "rhj-1" }],
  ...overrides,
});

test("every answer carries all eight sections, in the fixed order, always", () => {
  const complete = compileRynAnswer(input());
  const bare = compileRynAnswer(
    input({
      facts: [],
      scenarios: [],
      plainAnswer: null,
      deterministic: null,
      relevance: { state: "UNKNOWN", positions: [], plans: [], reason: "Nothing is in scope." },
      risk: { state: "UNAVAILABLE", reference: null, reason: "The portfolio read did not complete." },
      nextSteps: [],
      sourceVersions: [],
    }),
  );
  for (const answer of [complete, bare]) {
    assert.deepEqual(answer.sections.map((section) => section.id), [...RYN_ANSWER_SECTIONS]);
    assert.equal(answer.sections.length, 8);
    for (const section of answer.sections) {
      assert.ok(section.label.length > 0);
      if (section.state === "EMPTY") assert.ok(section.reason && section.reason.length > 0);
    }
  }
});

test("an empty section states why rather than disappearing", () => {
  const answer = compileRynAnswer(input({ conflicts: [], unknowns: [] }));
  const section = answer.sections.find((entry) => entry.id === "CONFLICTS_AND_UNKNOWNS");
  assert.equal(section.state, "EMPTY");
  assert.match(section.reason, /no source disagrees|nothing/i);
});

test("a deterministic result exists only when the data is sufficient", () => {
  assert.equal(compileRynAnswer(input()).result.state, "DETERMINISTIC");

  const stale = compileRynAnswer(input({ facts: [fact({ freshness: "STALE" })] }));
  assert.equal(stale.result.state, "INSUFFICIENT");
  assert.ok(stale.result.missing.some((entry) => entry.key === "multiplier"));
  assert.match(stale.result.missing[0].label, /current reading/i);

  const blocked = compileRynAnswer(
    input({ unknowns: [{ unknownId: "u1", missingKey: "coverage", missingFact: "Valuation coverage", why: "No source priced it.", blocking: true }] }),
  );
  assert.equal(blocked.result.state, "INSUFFICIENT");
  assert.ok(blocked.result.missing.some((entry) => entry.key === "coverage"));
  assert.equal(blocked.result.missing.find((entry) => entry.key === "coverage").label, "Valuation coverage");

  const noRisk = compileRynAnswer(input({ risk: { state: "UNAVAILABLE", reference: null, reason: "The portfolio read did not complete." } }));
  assert.equal(noRisk.result.state, "INSUFFICIENT");
});

test("a supplied number is still withheld when its inputs are not sufficient", () => {
  const answer = compileRynAnswer(input({ facts: [fact({ freshness: "STALE" })] }));
  assert.equal(answer.result.state, "INSUFFICIENT");
  assert.equal(JSON.stringify(answer.result).includes("42.10%"), false);
});

test("sufficiency with no number to show is refused as missing, not rendered as zero", () => {
  const answer = compileRynAnswer(input({ deterministic: null }));
  assert.equal(answer.result.state, "INSUFFICIENT");
  assert.ok(answer.result.missing.length > 0);
});

test("a conflict keeps every disagreeing reading and averages none of them", () => {
  const answer = compileRynAnswer(
    input({
      conflicts: [
        {
          conflictId: "c1",
          subject: "TSLA-USD mark",
          readings: [
            { sourceId: "arcus", label: "Arcus", value: "441.20", observedAt: "2026-08-23T09:59:00.000Z" },
            { sourceId: "rhj", label: "Robinhood", value: "439.80", observedAt: "2026-08-23T09:58:00.000Z" },
          ],
          reason: "Two venues report a different mark for the same instrument.",
        },
      ],
    }),
  );
  const conflict = answer.conflicts[0];
  assert.equal(conflict.readings.length, 2);
  assert.deepEqual(conflict.readings.map((reading) => reading.value), ["441.20", "439.80"]);
  assert.equal("resolved" in conflict, false);
  assert.equal(JSON.stringify(answer).includes("440.50"), false);
});

test("a conflict with fewer than two readings is not a conflict and is refused", () => {
  assert.throws(
    () =>
      compileRynAnswer(
        input({
          conflicts: [
            {
              conflictId: "c1",
              subject: "TSLA-USD mark",
              readings: [{ sourceId: "arcus", label: "Arcus", value: "441.20", observedAt: "2026-08-23T09:59:00.000Z" }],
              reason: "Only one reading.",
            },
          ],
        }),
      ),
    /two/i,
  );
});

test("an unknown names the missing fact and what it blocks", () => {
  const answer = compileRynAnswer(
    input({
      unknowns: [
        { unknownId: "u1", missingKey: "coverage", missingFact: "Valuation coverage for the paper book", why: "No source priced it.", blocking: true },
      ],
    }),
  );
  assert.equal(answer.unknowns[0].missingFact, "Valuation coverage for the paper book");
  assert.ok(answer.unknowns[0].blocks.length > 0);
});

test("a scenario whose input is missing is dropped by its human name, never by its key", () => {
  const answer = compileRynAnswer(
    input({
      unknowns: [{ unknownId: "u1", missingKey: "multiplier", missingFact: "The declared multiplier", why: "The source refused.", blocking: true }],
    }),
  );
  assert.equal(answer.scenarios.length, 0);
  const section = answer.sections.find((entry) => entry.id === "SCENARIOS");
  assert.equal(section.state, "EMPTY");
  assert.match(section.reason, /The declared multiplier/);
});

test("no missing input is reported as a raw field key", () => {
  /* Found by looking: the deterministic result printed `effectiveAt` under
     "Not enough data" — an internal key where a reader needed the fact. */
  const answer = compileRynAnswer(
    input({
      unknowns: [{ unknownId: "u1", missingKey: "effectiveAt", missingFact: "The effective date of the declared multiplier", why: "Not reported.", blocking: true }],
    }),
  );
  assert.equal(answer.result.state, "INSUFFICIENT");
  for (const entry of answer.result.missing) {
    assert.notEqual(entry.label, entry.key, "a missing input must carry a human label, not its key");
    assert.match(entry.label, /^[A-Z]/, "a missing input label reads as a sentence fragment");
  }
});

test("the plain answer is withheld when nothing is established, and says so", () => {
  const answer = compileRynAnswer(input({ facts: [], plainAnswer: "Everything is fine." }));
  assert.equal(answer.plainAnswer.state, "WITHHELD");
  assert.equal(answer.plainAnswer.statement, null);
  assert.match(answer.plainAnswer.reason, /no fact/i);
});

test("a plain answer carrying a personalized verdict is refused outright", () => {
  for (const verdict of ["You should buy TSLA-USD.", "Hold this position.", "Time to reduce.", "Rebalance now."]) {
    assert.throws(() => compileRynAnswer(input({ plainAnswer: verdict })), /verdict/i);
  }
});

test("the next step is permissible by construction — no step executes, signs or authorizes", () => {
  assert.throws(
    () => compileRynAnswer(input({ nextSteps: [{ kind: "EXECUTE", label: "Send the order", href: "/x", reason: null }] })),
    /step/i,
  );
  const answer = compileRynAnswer(input());
  assert.equal(answer.nextStep.state, "AVAILABLE");
  assert.equal(answer.nextStep.authority, "USER");
});

test("with no permissible step the answer says there is none rather than inventing one", () => {
  const answer = compileRynAnswer(input({ nextSteps: [] }));
  assert.equal(answer.nextStep.state, "NONE");
  assert.ok(answer.nextStep.reason.length > 0);
});

test("versions name every source, and record that compiling called no model", () => {
  const answer = compileRynAnswer(input());
  assert.deepEqual(answer.versions.sources.map((source) => source.sourceId), ["rhj"]);
  assert.equal(answer.versions.model.state, "NOT_CALLED");
  assert.equal(answer.versions.policy.adviceAuthority, "NONE");
  assert.equal(answer.versions.policy.aiAuthority, "NONE");
  assert.ok(answer.versions.policy.riskFormulaVersion.length > 0);
});

test("the answer holds no recommendation and no universal score, structurally", () => {
  const answer = compileRynAnswer(input());
  assert.equal(answer.recommendation, null);
  assert.equal(answer.aiAuthority, "NONE");
  const text = JSON.stringify(answer).toLowerCase();
  for (const word of ["confidence", "conviction", "opportunity score", "quality score"]) {
    assert.equal(text.includes(word), false, "an answer must not carry " + word);
  }
});

test("the same question over the same facts always compiles the same answer id", () => {
  assert.equal(compileRynAnswer(input()).answerId, compileRynAnswer(input()).answerId);
  assert.match(compileRynAnswer(input()).answerId, /^ryn_[0-9a-f]{12}$/);
  assert.notEqual(
    compileRynAnswer(input()).answerId,
    compileRynAnswer(input({ facts: [fact({ value: "2.000000" })] })).answerId,
  );
});

test("an operation outside the four verbs cannot produce an answer", () => {
  assert.throws(
    () => compileRynAnswer(input({ question: { ...input().question, operation: "DECIDE" } })),
    /operation/i,
  );
});
