import assert from "node:assert/strict";
import test from "node:test";

import { nextCronOccurrence, projectRuleRun } from "./scheduler.ts";

test("a declared daily schedule resolves to its next UTC occurrence", () => {
  assert.equal(nextCronOccurrence("0 7 * * *", "2026-08-23T06:59:00.000Z"), "2026-08-23T07:00:00.000Z");
  assert.equal(nextCronOccurrence("0 7 * * *", "2026-08-23T07:00:00.000Z"), "2026-08-24T07:00:00.000Z");
  assert.equal(nextCronOccurrence("0 21 * * *", "2026-08-23T07:00:00.000Z"), "2026-08-23T21:00:00.000Z");
});

test("lists, ranges and steps are supported, and the result is always in the future", () => {
  assert.equal(nextCronOccurrence("0 7,21 * * *", "2026-08-23T08:00:00.000Z"), "2026-08-23T21:00:00.000Z");
  assert.equal(nextCronOccurrence("*/15 * * * *", "2026-08-23T08:07:00.000Z"), "2026-08-23T08:15:00.000Z");
  assert.equal(nextCronOccurrence("0 9-11 * * *", "2026-08-23T09:30:00.000Z"), "2026-08-23T10:00:00.000Z");
});

test("day-of-week and day-of-month are both honoured", () => {
  /* 2026-08-23 is a Sunday; Monday 07:00 is the next Monday occurrence. */
  assert.equal(nextCronOccurrence("0 7 * * 1", "2026-08-23T08:00:00.000Z"), "2026-08-24T07:00:00.000Z");
  assert.equal(nextCronOccurrence("0 7 1 * *", "2026-08-23T08:00:00.000Z"), "2026-09-01T07:00:00.000Z");
});

test("anything the parser does not fully understand returns null rather than a guess", () => {
  for (const expression of [
    "@daily",
    "0 7 * *",
    "0 7 * * * *",
    "0 61 * * *",
    "0 7 * * SUN",
    "*/0 * * * *",
    "",
  ]) {
    assert.equal(nextCronOccurrence(expression, "2026-08-23T08:00:00.000Z"), null, expression);
  }
});

test("an unparsable clock produces no occurrence", () => {
  assert.equal(nextCronOccurrence("0 7 * * *", "not-a-time"), null);
});

const rule = {
  ruleId: "rule-1",
  mode: "SCHEDULE",
  schedule: "0 7 * * *",
};

test("last run is OBSERVED only when a real scheduler record carries a run time", () => {
  const projection = projectRuleRun({
    rule,
    record: {
      ruleId: "rule-1",
      lastRunAt: "2026-08-23T07:00:02.000Z",
      lastSuccessfulEvidenceRefreshAt: "2026-08-23T07:00:03.000Z",
      runCount: 41,
      watermark: "sequence:412",
      source: "account_watch",
    },
    asOf: "2026-08-23T09:00:00.000Z",
  });
  assert.equal(projection.last.state, "OBSERVED");
  assert.equal(projection.last.at, "2026-08-23T07:00:02.000Z");
  assert.equal(projection.last.source, "account_watch");
  assert.equal(projection.lastEvidenceRefresh.state, "OBSERVED");
  assert.equal(projection.watermark, "sequence:412");
});

test("a record without a run time leaves last run UNKNOWN and says why", () => {
  const projection = projectRuleRun({
    rule,
    record: {
      ruleId: "rule-1",
      lastRunAt: null,
      lastSuccessfulEvidenceRefreshAt: null,
      runCount: null,
      watermark: "sequence:412",
      source: "account_watch",
    },
    asOf: "2026-08-23T09:00:00.000Z",
  });
  assert.equal(projection.last.state, "UNKNOWN");
  assert.equal(projection.last.at, null);
  assert.match(projection.last.reason ?? "", /watermark/i);
  /* The watermark is still real evidence that the job touched this rule. */
  assert.equal(projection.watermark, "sequence:412");
  assert.equal(projection.enrolled, true);
});

test("no record at all is UNKNOWN, never zero and never 'never ran'", () => {
  const projection = projectRuleRun({ rule, record: null, asOf: "2026-08-23T09:00:00.000Z" });
  assert.equal(projection.last.state, "UNKNOWN");
  assert.equal(projection.last.at, null);
  assert.equal(projection.enrolled, false);
  assert.equal(projection.watermark, null);
});

test("next run is DECLARED, because a schedule is a declaration and not an observation", () => {
  const projection = projectRuleRun({ rule, record: null, asOf: "2026-08-23T09:00:00.000Z" });
  assert.equal(projection.next.state, "DECLARED");
  assert.equal(projection.next.at, "2026-08-24T07:00:00.000Z");
  assert.match(projection.next.reason ?? "", /declared/i);
});

test("an invalid or absent schedule cannot produce a next run", () => {
  const bad = projectRuleRun({ rule: { ...rule, schedule: "@hourly" }, record: null, asOf: "2026-08-23T09:00:00.000Z" });
  assert.equal(bad.next.state, "UNKNOWN");
  assert.equal(bad.next.at, null);

  const event = projectRuleRun({ rule: { ruleId: "r", mode: "EVENT", schedule: null }, record: null, asOf: "2026-08-23T09:00:00.000Z" });
  assert.equal(event.next.state, "UNKNOWN");
  assert.match(event.next.reason ?? "", /event/i);
});

test("a record belonging to another rule is not adopted", () => {
  const projection = projectRuleRun({
    rule,
    record: { ruleId: "rule-2", lastRunAt: "2026-08-23T07:00:00.000Z", lastSuccessfulEvidenceRefreshAt: null, runCount: 1, watermark: null, source: "account_watch" },
    asOf: "2026-08-23T09:00:00.000Z",
  });
  assert.equal(projection.last.state, "UNKNOWN");
  assert.equal(projection.enrolled, false);
});

test("a run time that is not an explicit instant is refused rather than displayed", () => {
  const projection = projectRuleRun({
    rule,
    record: { ruleId: "rule-1", lastRunAt: "yesterday", lastSuccessfulEvidenceRefreshAt: null, runCount: 1, watermark: null, source: "account_watch" },
    asOf: "2026-08-23T09:00:00.000Z",
  });
  assert.equal(projection.last.state, "UNKNOWN");
  assert.match(projection.last.reason ?? "", /explicit/i);
});

test("a run time in the future is refused: a record cannot observe what has not happened", () => {
  const projection = projectRuleRun({
    rule,
    record: { ruleId: "rule-1", lastRunAt: "2026-08-24T07:00:00.000Z", lastSuccessfulEvidenceRefreshAt: null, runCount: 1, watermark: null, source: "account_watch" },
    asOf: "2026-08-23T09:00:00.000Z",
  });
  assert.equal(projection.last.state, "UNKNOWN");
  assert.match(projection.last.reason ?? "", /future/i);
});
