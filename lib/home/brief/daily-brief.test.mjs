import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIEF_SECTIONS,
  BRIEF_SECTION_PRIORITY,
  buildDailyBrief,
  briefWindow,
} from "./daily-brief.ts";

const AS_OF = "2026-08-24T12:00:00.000Z";

const input = (overrides = {}) => ({
  asOf: AS_OF,
  window: briefWindow({ lastSeenAt: "2026-08-23T12:00:00.000Z", asOf: AS_OF, defaultWindowSeconds: 60 * 60 * 24 }),
  decisions: [
    {
      id: "case-1",
      title: "TSLA-USD corporate action",
      detail: "A split was declared and one book holds the position.",
      severity: "HIGH",
      observedAt: "2026-08-24T08:00:00.000Z",
      href: "/app/action-cases/case-1",
      surface: "Decisions",
    },
  ],
  changes: [
    {
      id: "change-1",
      title: "Robinhood stock token disclosure",
      detail: "The issuer disclosure page changed.",
      severity: "MEDIUM",
      observedAt: "2026-08-24T07:00:00.000Z",
      href: "/app/research/change-1",
      surface: "Research",
    },
  ],
  portfolio: [
    {
      id: "move-1",
      title: "Concentration exceeded",
      detail: "One position is above the declared limit.",
      severity: "HIGH",
      observedAt: "2026-08-24T06:00:00.000Z",
      href: "/app/portfolio",
      surface: "Portfolio",
    },
  ],
  monitoring: [
    {
      id: "source-1",
      title: "Robinhood stock tokens",
      detail: "The venue refused the read.",
      severity: "MEDIUM",
      observedAt: null,
      href: "/app/coverage",
      surface: "Coverage",
    },
  ],
  ...overrides,
});

test("the five sections are fixed and always present, in the declared priority order", () => {
  assert.deepEqual([...BRIEF_SECTIONS], ["DECISIONS", "CHANGES", "PORTFOLIO", "MONITORING", "QUIET"]);
  assert.deepEqual([...BRIEF_SECTION_PRIORITY], [...BRIEF_SECTIONS]);

  const brief = buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], monitoring: [] }));
  assert.deepEqual(brief.sections.map((section) => section.section), [...BRIEF_SECTIONS]);
});

test("an empty section states why it is empty rather than disappearing", () => {
  const brief = buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], monitoring: [] }));
  for (const section of brief.sections) {
    if (section.section === "QUIET") continue;
    assert.equal(section.lines.length, 0, section.section);
    assert.ok(section.emptyReason && section.emptyReason.length > 0, section.section + " must say why it is empty");
  }
});

test("priority is the declared table, not a score: a decision outranks a change outranks a move outranks an operational state", () => {
  const brief = buildDailyBrief(input());
  const order = brief.lines.map((line) => line.section);
  assert.deepEqual(order.slice(0, 4), ["DECISIONS", "CHANGES", "PORTFOLIO", "MONITORING"]);
  assert.equal(brief.lines.some((line) => "score" in line), false, "no line carries an invented importance number");
});

test("a critical operational state still ranks below a low-severity decision, because the table is the order", () => {
  const brief = buildDailyBrief(input({
    decisions: [{ id: "d", title: "d", detail: "d", severity: "LOW", observedAt: AS_OF, href: "/app/action-cases", surface: "Decisions" }],
    monitoring: [{ id: "m", title: "m", detail: "m", severity: "CRITICAL", observedAt: AS_OF, href: "/app/coverage", surface: "Coverage" }],
    changes: [],
    portfolio: [],
  }));
  assert.equal(brief.lines[0].section, "DECISIONS");
  assert.equal(brief.lines[1].section, "MONITORING");
});

test("inside one section, severity then observation time decides, deterministically", () => {
  const brief = buildDailyBrief(input({
    changes: [
      { id: "c-low", title: "low", detail: "", severity: "LOW", observedAt: "2026-08-24T09:00:00.000Z", href: "/app/research", surface: "Research" },
      { id: "c-high", title: "high", detail: "", severity: "HIGH", observedAt: "2026-08-24T01:00:00.000Z", href: "/app/research", surface: "Research" },
      { id: "c-high-late", title: "high late", detail: "", severity: "HIGH", observedAt: "2026-08-24T05:00:00.000Z", href: "/app/research", surface: "Research" },
    ],
  }));
  const changes = brief.sections.find((section) => section.section === "CHANGES");
  assert.deepEqual(changes.lines.map((line) => line.lineId), ["c-high-late", "c-high", "c-low"]);
});

test("every line carries the surface that owns it and a link to that surface", () => {
  const brief = buildDailyBrief(input());
  assert.ok(brief.lines.length > 0);
  for (const line of brief.lines) {
    assert.ok(line.owner.surface.length > 0, line.lineId);
    assert.match(line.owner.href, /^\/app\//, line.lineId);
  }
});

test("a line with no destination is refused rather than rendered as a dead link", () => {
  assert.throws(
    () => buildDailyBrief(input({ changes: [{ id: "x", title: "x", detail: "", severity: "LOW", observedAt: null, href: "", surface: "Research" }] })),
    /owner|href|surface/i,
  );
});

test("the quiet section names what was checked and found unchanged", () => {
  const brief = buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], monitoring: [], quiet: [{ title: "Portfolio valuation", surface: "Portfolio", href: "/app/portfolio" }, { title: "Monitor rules", surface: "Research", href: "/app/research" }] }));
  const quiet = brief.sections.find((section) => section.section === "QUIET");
  assert.equal(quiet.lines.length, 2);
  assert.deepEqual(quiet.lines.map((line) => line.title), ["Portfolio valuation", "Monitor rules"]);
  assert.equal(brief.state, "CALM");
});

test("a quiet check with no owner is refused: a line that found nothing still names who looked", () => {
  assert.throws(
    () => buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], monitoring: [], quiet: [{ title: "x", surface: "", href: "" }] })),
    /owner|looked/i,
  );
});

test("with nothing at all — not even a quiet check — the brief is EMPTY and says so", () => {
  const brief = buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], monitoring: [], quiet: [] }));
  assert.equal(brief.state, "EMPTY");
});

test("a decision waiting on a human makes the brief ATTENTION", () => {
  assert.equal(buildDailyBrief(input()).state, "ATTENTION");
});

test("an operational state alone makes the brief DEGRADED, never CALM", () => {
  const brief = buildDailyBrief(input({ decisions: [], changes: [], portfolio: [], quiet: [{ title: "Portfolio valuation", surface: "Portfolio", href: "/app/portfolio" }] }));
  assert.equal(brief.state, "DEGRADED");
});

test("the window is honest about where it came from", () => {
  const seen = briefWindow({ lastSeenAt: "2026-08-23T12:00:00.000Z", asOf: AS_OF, defaultWindowSeconds: 3600 });
  assert.equal(seen.state, "SINCE_LAST_VISIT");
  assert.equal(seen.from, "2026-08-23T12:00:00.000Z");

  const none = briefWindow({ lastSeenAt: null, asOf: AS_OF, defaultWindowSeconds: 3600 });
  assert.equal(none.state, "DEFAULT_WINDOW");
  assert.equal(none.from, "2026-08-24T11:00:00.000Z");
  assert.match(none.reason, /default/i);

  const unreadable = briefWindow({ lastSeenAt: "not-an-instant", asOf: AS_OF, defaultWindowSeconds: 3600 });
  assert.equal(unreadable.state, "DEFAULT_WINDOW");
});

test("a marker no server can read says exactly that", () => {
  const window = briefWindow({ lastSeenAt: null, asOf: AS_OF, defaultWindowSeconds: 3600, serverReadable: false });
  assert.equal(window.state, "NOT_SERVER_READABLE");
  assert.match(window.reason, /browser|device/i);
  assert.equal(window.from, null);
});

test("a future marker is refused rather than producing a negative window", () => {
  const window = briefWindow({ lastSeenAt: "2027-01-01T00:00:00.000Z", asOf: AS_OF, defaultWindowSeconds: 3600 });
  assert.equal(window.state, "DEFAULT_WINDOW");
  assert.match(window.reason, /future/i);
});

test("compilation is pure: same input, same briefId, twice", () => {
  const once = buildDailyBrief(input());
  const twice = buildDailyBrief(input());
  assert.equal(once.briefId, twice.briefId);
  assert.deepEqual(once, twice);
});

test("a different fact produces a different briefId", () => {
  const base = buildDailyBrief(input());
  const moved = buildDailyBrief(input({ changes: [] }));
  assert.notEqual(base.briefId, moved.briefId);
});

test("counts are counts and are never summed across sections into one importance figure", () => {
  const brief = buildDailyBrief(input());
  assert.deepEqual(brief.counts, { decisions: 1, changes: 1, portfolio: 1, monitoring: 1, quiet: 0 });
});

test("the brief issues no verdict word", () => {
  const serialized = JSON.stringify(buildDailyBrief(input()));
  for (const verdict of ["BUY", "SELL", "HOLD", "REDUCE", "HEDGE", "REBALANCE"]) {
    assert.equal(serialized.includes(verdict), false, verdict + " must not appear");
  }
});
