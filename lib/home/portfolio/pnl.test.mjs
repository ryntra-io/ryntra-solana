import assert from "node:assert/strict";
import test from "node:test";

import { PNL_COMPONENTS, projectPnlBooks } from "./pnl.ts";

const BASIS = {
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-08-23T00:00:00.000Z",
  sign: "PROFIT_POSITIVE",
  measure: "CASH_SETTLED",
};

function reported(component, book, units, overrides = {}) {
  return {
    component,
    book,
    state: "REPORTED",
    value: { amount: { units, scale: 2 }, currency: "USD" },
    sourceRef: `source:${book}:${component}`,
    observedAt: "2026-08-23T09:00:00.000Z",
    basis: BASIS,
    ...overrides,
  };
}

function unknown(component, book, state = "UNKNOWN") {
  return {
    component,
    book,
    state,
    reason: `${book} ${component} is not reported by the source contract`,
    sourceRef: `source:${book}:${component}`,
    observedAt: "2026-08-23T09:00:00.000Z",
  };
}

const SETTINGS = { scale: 2, roundingMode: "HALF_EVEN", displayCurrency: "USD" };

test("Paper and Live are separate projections with separate provenance", () => {
  const books = projectPnlBooks({
    ...SETTINGS,
    observations: [
      reported("REALIZED", "LIVE", "1500"),
      reported("UNREALIZED", "LIVE", "-400"),
      reported("FEES", "LIVE", "-25"),
      reported("FUNDING", "LIVE", "-75"),
      reported("REALIZED", "PAPER", "900"),
      unknown("UNREALIZED", "PAPER"),
      unknown("FEES", "PAPER", "UNAVAILABLE"),
      unknown("FUNDING", "PAPER"),
    ],
  });

  assert.equal(books.live.book, "LIVE");
  assert.equal(books.paper.book, "PAPER");
  assert.deepEqual(books.live.components.map((entry) => entry.component), [...PNL_COMPONENTS]);
  assert.deepEqual(books.paper.components.map((entry) => entry.component), [...PNL_COMPONENTS]);
  for (const entry of books.live.components) assert.match(entry.sourceRef, /^source:LIVE:/);
  for (const entry of books.paper.components) assert.match(entry.sourceRef, /^source:PAPER:/);

  assert.equal(books.live.net.state, "AVAILABLE");
  assert.deepEqual(books.live.net.value, { amount: { units: "1000", scale: 2 }, currency: "USD" });
  assert.equal(books.paper.net.state, "WITHHELD");
});

test("a reported zero is zero and a missing component never becomes zero", () => {
  const books = projectPnlBooks({
    ...SETTINGS,
    observations: [
      reported("REALIZED", "LIVE", "0"),
      reported("UNREALIZED", "LIVE", "0"),
      reported("FEES", "LIVE", "0"),
      unknown("FUNDING", "LIVE", "UNAVAILABLE"),
    ],
  });

  const byComponent = new Map(books.live.components.map((entry) => [entry.component, entry]));
  assert.equal(byComponent.get("REALIZED").state, "REPORTED");
  assert.deepEqual(byComponent.get("REALIZED").value, { amount: { units: "0", scale: 2 }, currency: "USD" });
  assert.equal(byComponent.get("FUNDING").state, "UNAVAILABLE");
  assert.equal(byComponent.get("FUNDING").value, null);
  assert.match(byComponent.get("FUNDING").reason, /not reported/);
  assert.equal(books.live.net.state, "WITHHELD");
  assert.deepEqual(books.live.net.reasons, ["FUNDING is UNAVAILABLE"]);
});

test("an entirely unobserved book reports every component unknown, not zero", () => {
  const books = projectPnlBooks({ ...SETTINGS, observations: [] });
  for (const projection of [books.live, books.paper]) {
    assert.equal(projection.components.length, PNL_COMPONENTS.length);
    for (const entry of projection.components) {
      assert.equal(entry.state, "UNKNOWN");
      assert.equal(entry.value, null);
      assert.equal(entry.sourceRef, null);
    }
    assert.equal(projection.net.state, "WITHHELD");
  }
});

test("Net is withheld when currency, period, measure or sign semantics disagree", () => {
  const incompatible = [
    ["currency", { value: { amount: { units: "10", scale: 2 }, currency: "EUR" } }, /currency/i],
    ["period", { basis: { ...BASIS, periodStart: "2026-07-01T00:00:00.000Z" } }, /period/i],
    ["measure", { basis: { ...BASIS, measure: "MARK_TO_MARKET" } }, /measure/i],
    ["sign", { basis: { ...BASIS, sign: "COST_POSITIVE" } }, /sign/i],
  ];

  for (const [label, override, pattern] of incompatible) {
    const books = projectPnlBooks({
      ...SETTINGS,
      observations: [
        reported("REALIZED", "LIVE", "1500"),
        reported("UNREALIZED", "LIVE", "-400"),
        reported("FEES", "LIVE", "-25", override),
        reported("FUNDING", "LIVE", "-75"),
      ],
    });
    assert.equal(books.live.net.state, "WITHHELD", `${label} must withhold Net`);
    assert.equal(books.live.net.reasons.length, 1, `${label} reports one reason`);
    assert.match(books.live.net.reasons[0], pattern);
  }
});

test("component order and Net are invariant to observation order", () => {
  const observations = [
    reported("FUNDING", "LIVE", "-75"),
    reported("FEES", "LIVE", "-25"),
    reported("UNREALIZED", "LIVE", "-400"),
    reported("REALIZED", "LIVE", "1500"),
  ];
  const forward = projectPnlBooks({ ...SETTINGS, observations });
  const reverse = projectPnlBooks({ ...SETTINGS, observations: [...observations].reverse() });
  assert.deepEqual(forward, reverse);
});

test("a duplicate component observation is refused rather than silently summed", () => {
  assert.throws(
    () => projectPnlBooks({
      ...SETTINGS,
      observations: [reported("FEES", "LIVE", "-25"), reported("FEES", "LIVE", "-30")],
    }),
    /duplicate/i,
  );
});

test("an offset-less instant is refused rather than read in host time", () => {
  assert.throws(
    () => projectPnlBooks({
      ...SETTINGS,
      observations: [reported("FEES", "LIVE", "-25", { observedAt: "2026-08-23T09:00:00" })],
    }),
    /explicit-offset/i,
  );
});
