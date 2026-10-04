import assert from "node:assert/strict";
import test from "node:test";

import { BACKTEST_REQUIREMENTS, assessBacktest, canReachApproved } from "./backtest.ts";

const run = (overrides = {}) => ({
  runId: "run_1",
  dataset: "TradingView export, TSLA 1h",
  datasetVersion: "pine-8f2c",
  engineVersion: "backtest-1",
  costsIncluded: true,
  commissionBps: 5,
  spreadBps: 2,
  slippageBps: 3,
  fundingBpsPerDay: 0,
  missingDataBars: 0,
  missingDataReason: null,
  maxDrawdownPercent: 12.5,
  outOfSample: "blind",
  forwardEvidence: true,
  parameterSensitivity: "stable",
  regimesCovered: 3,
  trades: 84,
  ...overrides,
});

test("the seven requirements are fixed, and every one is named", () => {
  assert.deepEqual(
    [...BACKTEST_REQUIREMENTS],
    ["dataset", "datasetVersion", "costs", "missingData", "maxDrawdown", "outOfSample", "forwardEvidence"],
  );
});

test("a complete run is evidence and says nothing is missing", () => {
  const assessment = assessBacktest(run());
  assert.equal(assessment.state, "EVIDENCE");
  assert.deepEqual(assessment.missing, []);
  assert.equal(assessment.satisfied.length, BACKTEST_REQUIREMENTS.length);
});

test("each missing requirement is named individually rather than as one failure", () => {
  const assessment = assessBacktest(
    run({ dataset: "", costsIncluded: false, maxDrawdownPercent: null, forwardEvidence: false }),
  );
  assert.equal(assessment.state, "INCOMPLETE");
  assert.deepEqual(assessment.missing.sort(), ["costs", "dataset", "forwardEvidence", "maxDrawdown"].sort());
  for (const requirement of assessment.missing) {
    assert.ok(assessment.reasons[requirement].length > 0, requirement + " must carry its own reason");
  }
});

test("missing data is a stated quantity, and unstated missing data is itself missing", () => {
  assert.equal(assessBacktest(run({ missingDataBars: 40, missingDataReason: "Forty bars had no quote." })).state, "EVIDENCE");
  const unstated = assessBacktest(run({ missingDataBars: 40, missingDataReason: null }));
  assert.equal(unstated.state, "INCOMPLETE");
  assert.ok(unstated.missing.includes("missingData"));
  assert.equal(assessBacktest(run({ missingDataBars: null })).missing.includes("missingData"), true);
});

test("an in-sample curve is never proof: no out-of-sample cannot reach Approved", () => {
  const inSample = assessBacktest(run({ outOfSample: "none", forwardEvidence: false }));
  assert.equal(inSample.state, "INCOMPLETE");
  assert.equal(canReachApproved(inSample).ok, false);
  assert.match(canReachApproved(inSample).reason, /out-of-sample|forward/i);
});

test("self-attested out-of-sample is recorded as weaker, not as blind", () => {
  const selfAttested = assessBacktest(run({ outOfSample: "self-attested" }));
  assert.equal(selfAttested.state, "EVIDENCE");
  assert.equal(selfAttested.strength, "SELF_ATTESTED");
  assert.equal(assessBacktest(run()).strength, "BLIND");
});

test("complete evidence with forward paper behind it may reach Approved", () => {
  const complete = assessBacktest(run());
  assert.equal(canReachApproved(complete).ok, true);
});

test("evidence alone does not approve: a complete run without forward evidence is refused", () => {
  const noForward = assessBacktest(run({ forwardEvidence: false }));
  assert.equal(canReachApproved(noForward).ok, false);
});

test("the assessment carries no score, verdict or quality grade", () => {
  const text = JSON.stringify(assessBacktest(run())).toLowerCase();
  for (const word of ["score", "grade", "confidence", "verdict", "quality"]) {
    assert.equal(text.includes(word), false, "a backtest assessment must not carry " + word);
  }
});

test("the same run always assesses the same way", () => {
  assert.deepEqual(assessBacktest(run()), assessBacktest(run()));
});
