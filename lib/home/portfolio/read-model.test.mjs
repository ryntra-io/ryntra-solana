import assert from "node:assert/strict";
import test from "node:test";

import { createPositionRecord } from "./position.ts";
import { HOME_RISK_CATEGORIES, projectHomePortfolio } from "./read-model.ts";

const asOf = "2026-08-23T10:01:00.000Z";
const observedAt = "2026-08-23T10:00:00.000Z";
const money = (units, scale = 2, currency = "USD") => ({ amount: { units, scale }, currency });

function leg(id, units, options = {}) {
  return {
    legId: id,
    underlyingKey: options.underlyingKey ?? id,
    role: options.role ?? "PRINCIPAL",
    phase: options.phase ?? "SETTLED",
    direction: options.direction ?? "LONG",
    notional: units === null ? null : money(units),
    unknownReason: units === null ? "source does not decompose this position" : null,
    observedAt,
    validUntil: null,
    freshnessPolicy: { maxAgeSeconds: 3600 },
    evidenceRefs: [`evidence:${id}`],
  };
}

function position(id, options = {}) {
  const positionType = options.positionType ?? "WALLET_ASSET";
  const reservation = ["ESCROW", "FUNDS_IN_MOTION", "AGENT_COMMITMENT"].includes(positionType);
  const valuationState = options.valuationState ?? (options.valueUnits === null ? "UNPRICED" : "PRICED");
  const measured = valuationState === "PRICED" || valuationState === "ESTIMATED" || valuationState === "STALE";
  return createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: options.sourceId ?? `source_${id}`,
      connectionId: null,
      sourcePositionKey: `native-${id}`,
      sourceVersion: "1",
      observedAt,
      evidenceRefs: [`evidence:source:${id}`],
    },
    accountRef: "account_example",
    networkRef: "network_example",
    venueRef: null,
    protocolRef: null,
    instrumentKey: options.instrumentKey ?? `instrument_${id}`,
    underlyingKey: options.underlyingKey ?? `underlying_${id}`,
    representationKey: `representation_${id}`,
    positionType,
    positionSlotKey: `slot-${id}`,
    book: "LIVE",
    accountingRole: options.accountingRole ?? (reservation ? "RESERVATION" : "PRIMARY"),
    economicLot: { state: "VERIFIED", lotId: `lot-${id}`, evidenceRefs: [`evidence:lot:${id}`] },
    quantity: options.quantity ?? null,
    valuation: measured
      ? {
          state: valuationState,
          value: money(options.valueUnits ?? "10000"),
          sourceRef: `price:${id}`,
          observedAt,
          validUntil: null,
          freshnessPolicy: { maxAgeSeconds: 3600 },
          reason: null,
          conflictRefs: [],
        }
      : {
          state: valuationState,
          value: null,
          sourceRef: null,
          observedAt,
          validUntil: null,
          freshnessPolicy: null,
          reason: options.reason ?? "no price source covers this position",
          conflictRefs: valuationState === "CONFLICTING" ? ["price:a", "price:b"] : [],
        },
    valuationContribution: options.valuationContribution ?? (reservation ? "NONE" : "ASSET"),
    cashState: options.cashState ?? "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: options.exposureLegs ?? [],
  });
}

function source(sourceId, records, overrides = {}) {
  return {
    sourceId,
    label: `Source ${sourceId}`,
    observedAt,
    freshnessPolicy: { maxAgeSeconds: 3600 },
    detailHref: "/app/portfolio#sources",
    result: { ok: true, records },
    ...overrides,
  };
}

function failed(sourceId, code = "SOURCE_CONTRACT_INSUFFICIENT") {
  return source(sourceId, [], {
    result: {
      ok: false,
      code,
      reason: "the provider read did not satisfy the adapter contract",
      evidenceRefs: [`evidence:${sourceId}`],
    },
  });
}

function project(overrides = {}) {
  return projectHomePortfolio({
    asOf,
    displayCurrency: "USD",
    scale: 2,
    roundingMode: "HALF_EVEN",
    inclusionMethod: "PRICED_ONLY",
    scope: { scopeId: "scope_example", ownerRef: "owner_example", contextVersion: 1 },
    sources: [],
    fx: [],
    constraints: [],
    pnl: [],
    signals: [],
    ...overrides,
  });
}

test("Observed Value is one inseparable projection with coverage, currency, as-of and source state", () => {
  const projection = project({ sources: [source("wallet", [position("a"), position("b")])] });

  assert.deepEqual(Object.keys(projection.observedValue).sort(), [
    "asOf",
    "coverage",
    "currency",
    "reason",
    "sourceState",
    "state",
    "value",
  ]);
  assert.equal(projection.observedValue.state, "OBSERVED");
  assert.deepEqual(projection.observedValue.value, money("20000"));
  assert.equal(projection.observedValue.currency, "USD");
  assert.equal(projection.observedValue.asOf, asOf);
  assert.equal(projection.observedValue.coverage.positionCoverageBps, 10_000);
  assert.equal(projection.observedValue.sourceState, "CURRENT");
  /* Never Net Worth. */
  assert.doesNotMatch(JSON.stringify(projection), /netWorth|net_worth/i);
});

test("no priced position withholds the amount instead of rendering zero", () => {
  const projection = project({
    sources: [source("wallet", [position("a", { valueUnits: null })])],
  });

  assert.equal(projection.observedValue.state, "UNAVAILABLE");
  assert.equal(projection.observedValue.value, null);
  assert.match(projection.observedValue.reason, /priced/i);
  assert.equal(projection.observedValue.coverage.stateCounts.UNPRICED, 1);
  assert.equal(projection.state, "PARTIAL");
});

test("a private-hidden position discloses a count and never an amount", () => {
  const records = [position("a"), position("b")];
  const hidden = position("secret", {
    positionType: "PRIVATE",
    valuationState: "PRIVATE_HIDDEN",
    valueUnits: null,
    quantity: { amount: { units: "777777", scale: 0 }, unitRef: "share" },
    reason: "the owner marked this holding private",
  });

  const without = project({ sources: [source("wallet", records)] });
  const withHidden = project({ sources: [source("wallet", [...records, hidden])] });

  assert.deepEqual(withHidden.observedValue.value, without.observedValue.value);
  assert.deepEqual(withHidden.coverage.pricedSubtotal, without.coverage.pricedSubtotal);
  assert.deepEqual(withHidden.distribution, without.distribution);
  assert.equal(withHidden.hidden.count, 1);
  assert.equal(withHidden.hidden.amountDisclosed, false);
  assert.equal(withHidden.coverage.stateCounts.PRIVATE_HIDDEN, 1);
  /* The strongest form of the invariant: the private magnitude is not anywhere
     in the projection — not in a total, a share, an ordering key or a tooltip. */
  assert.doesNotMatch(JSON.stringify(withHidden), /777777/);
});

test("the five cash buckets are exclusive, complete and independently unknown", () => {
  const projection = project({
    sources: [source("wallet", [
      position("cash", { cashState: "SPENDABLE", valueUnits: "50000" }),
      position("motion", {
        positionType: "FUNDS_IN_MOTION",
        cashState: "FUNDS_IN_MOTION",
        valueUnits: "1000",
        exposureLegs: [leg("motion-leg", "1000", { phase: "PENDING" })],
      }),
      position("collateral", { cashState: "LOCKED_COLLATERAL", valueUnits: "2500" }),
    ])],
  });

  assert.deepEqual(projection.cash.map((bucket) => bucket.id), [
    "SPENDABLE",
    "PENDING",
    "FUNDS_IN_MOTION",
    "COMMITTED",
    "LOCKED_COLLATERAL",
  ]);
  const byId = new Map(projection.cash.map((bucket) => [bucket.id, bucket]));
  assert.deepEqual(byId.get("SPENDABLE").value, money("50000"));
  assert.deepEqual(byId.get("LOCKED_COLLATERAL").value, money("2500"));
  assert.deepEqual(byId.get("FUNDS_IN_MOTION").value, money("1000"));
  assert.deepEqual(byId.get("PENDING").value, money("0"));
  assert.deepEqual(byId.get("COMMITTED").value, money("0"));
  /* One economic amount, one bucket: no total over the buckets exists to be
     double counted, and the projection exposes none. */
  assert.equal(Object.hasOwn(projection, "cashTotal"), false);
});

test("one unknown cash bucket leaves the others known", () => {
  const projection = project({
    sources: [source("wallet", [
      position("cash", { cashState: "SPENDABLE", valueUnits: "50000" }),
      position("committed", {
        positionType: "AGENT_COMMITMENT",
        cashState: "COMMITTED",
        valueUnits: null,
        exposureLegs: [leg("committed-leg", null, { phase: "COMMITTED" })],
      }),
    ])],
  });

  const byId = new Map(projection.cash.map((bucket) => [bucket.id, bucket]));
  assert.equal(byId.get("SPENDABLE").state, "KNOWN");
  assert.deepEqual(byId.get("SPENDABLE").value, money("50000"));
  assert.equal(byId.get("COMMITTED").state, "UNKNOWN");
  assert.equal(byId.get("COMMITTED").value, null);
  assert.ok(byId.get("COMMITTED").reasons.length > 0);
});

test("five independent risk categories exist and no composite score does", () => {
  const projection = project({ sources: [source("wallet", [position("a")])] });

  assert.deepEqual(projection.risk.map((category) => category.id), [...HOME_RISK_CATEGORIES]);
  assert.equal(projection.risk.length, 5);
  for (const category of projection.risk) {
    assert.ok(["WITHIN", "EXCEEDED", "UNKNOWN", "DEGRADED"].includes(category.status));
    assert.ok(Array.isArray(category.metrics));
    assert.ok(Array.isArray(category.limitations));
  }
  assert.doesNotMatch(
    JSON.stringify(projection.risk),
    /"(score|grade|overall|average|totalRisk|safety)"/i,
  );
});

test("an unknown exposure category never reports itself as within bounds", () => {
  const projection = project({
    sources: [source("wallet", [
      position("opaque", {
        valueUnits: "10000",
        exposureLegs: [leg("opaque-leg", null)],
      }),
    ])],
    constraints: [{ id: "gross", metric: "MAX_GROSS_EXPOSURE", limit: money("100000") }],
  });

  const exposure = projection.risk.find((category) => category.id === "EXPOSURE");
  assert.equal(exposure.status, "UNKNOWN");
  assert.notEqual(exposure.status, "WITHIN");
  assert.ok(exposure.limitations.length > 0);
});

test("an exceeded constraint is reported by its own category and nowhere else", () => {
  const projection = project({
    sources: [source("wallet", [
      position("big", { valueUnits: "500000", exposureLegs: [leg("big-leg", "500000")] }),
    ])],
    constraints: [{ id: "gross", metric: "MAX_GROSS_EXPOSURE", limit: money("100000") }],
  });

  const byId = new Map(projection.risk.map((category) => [category.id, category]));
  assert.equal(byId.get("EXPOSURE").status, "EXCEEDED");
  assert.equal(byId.get("CONCENTRATION").status, "WITHIN");
  assert.deepEqual(byId.get("EXPOSURE").constraints.map((entry) => entry.id), ["gross"]);
  assert.deepEqual(byId.get("LIQUIDITY").constraints, []);
  assert.ok(projection.attention.some((item) => item.kind === "DETERMINISTIC_REVIEW"));
});

test("a failed source degrades the aggregate without blanking a healthy source", () => {
  const projection = project({
    sources: [source("wallet", [position("a")]), failed("venue")],
  });

  assert.equal(projection.state, "DEGRADED");
  assert.deepEqual(projection.observedValue.value, money("10000"));
  assert.equal(projection.observedValue.sourceState, "DEGRADED");
  const states = new Map(projection.sources.map((entry) => [entry.sourceId, entry.state]));
  assert.equal(states.get("wallet"), "OK");
  assert.equal(states.get("venue"), "FAILED");
  const degraded = projection.attention.find((item) => item.kind === "DEGRADED_PROVIDER");
  assert.equal(degraded.severity, "HIGH");
  assert.match(degraded.reason, /adapter contract/);
});

test("every source failing is a hard error rather than an empty portfolio", () => {
  const projection = project({ sources: [failed("wallet"), failed("venue")] });

  assert.equal(projection.state, "ERROR");
  assert.equal(projection.observedValue.state, "UNAVAILABLE");
  assert.equal(projection.observedValue.value, null);
  assert.ok(projection.recovery.length > 0);
});

test("no source at all is empty, and empty is not calm", () => {
  const empty = project({ sources: [] });
  assert.equal(empty.state, "EMPTY");
  assert.equal(empty.observedValue.value, null);
  assert.equal(empty.attention.length, 0);

  const calm = project({ sources: [source("wallet", [position("a")])] });
  assert.equal(calm.state, "CALM");
  assert.equal(calm.attention.length, 0);
  assert.ok(calm.coverageLimit.length > 0);
});

test("Attention is derived from typed facts, ordered canonically and never filled", () => {
  const projection = project({
    sources: [source("wallet", [position("a", { valuationState: "CONFLICTING", valueUnits: null })]), failed("venue")],
    signals: [{
      id: "signal-review",
      kind: "EXACT_REVIEW_REQUEST",
      severity: "CRITICAL",
      observedAt,
      title: "An exact action is waiting for your signature",
      reason: "One Action Case reached the authorization step",
      sourceRef: "agent-control:case-1",
      freshness: "CURRENT",
      detailHref: "/app/portfolio#attention",
      actionLabel: "Review",
      limitation: null,
    }],
  });

  assert.equal(projection.state, "DEGRADED");
  assert.equal(projection.attention[0].kind, "EXACT_REVIEW_REQUEST");
  const kinds = projection.attention.map((item) => item.kind);
  assert.deepEqual(kinds, [...new Set(kinds)]);
  assert.ok(kinds.includes("DEGRADED_PROVIDER"));
  assert.ok(kinds.includes("STALE_OR_CONFLICTING_EVIDENCE"));
  for (const item of projection.attention) {
    assert.ok(item.title.length > 0 && item.reason.length > 0 && item.sourceRef.length > 0);
    if (item.detailHref === null) assert.equal(item.actionLabel, null);
  }
});

test("an attention signal with no destination keeps its limitation and grows no dead link", () => {
  const projection = project({
    signals: [{
      id: "signal-strategy",
      kind: "STRATEGY_TRIGGER",
      severity: "MEDIUM",
      observedAt,
      title: "A strategy condition matched",
      reason: "The saved condition matched on the latest observation",
      sourceRef: "strategy:1",
      freshness: "CURRENT",
      detailHref: null,
      actionLabel: "Open",
      limitation: "The strategy detail route is not built in this wave.",
    }],
  });

  const item = projection.attention[0];
  assert.equal(item.detailHref, null);
  assert.equal(item.actionLabel, null);
  assert.match(item.limitation, /not built/);
});

test("the whole projection is invariant to source and signal input order", () => {
  const sources = [source("wallet", [position("a"), position("b")]), failed("venue")];
  const signals = [
    {
      id: "b-signal",
      kind: "AGENT_BUDGET_THRESHOLD",
      severity: "MEDIUM",
      observedAt,
      title: "An agent budget crossed its threshold",
      reason: "Observed spend passed the configured share of the budget",
      sourceRef: "agent:1",
      freshness: "CURRENT",
      detailHref: null,
      actionLabel: null,
      limitation: "Agent Control detail is projected in a later wave.",
    },
    {
      id: "a-signal",
      kind: "UNREVIEWED_OUTCOME",
      severity: "LOW",
      observedAt,
      title: "A closed outcome has no review",
      reason: "The journal has no entry for this outcome",
      sourceRef: "journal:1",
      freshness: "CURRENT",
      detailHref: "/app/journal",
      actionLabel: "Open Journal",
      limitation: null,
    },
  ];

  const forward = project({ sources, signals });
  const reverse = project({ sources: [...sources].reverse(), signals: [...signals].reverse() });
  assert.deepEqual(forward, reverse);
});

test("Paper never enters the Live observed value and keeps its own book", () => {
  const paper = createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: "paper",
      connectionId: null,
      sourcePositionKey: "paper-1",
      sourceVersion: "1",
      observedAt,
      evidenceRefs: ["evidence:paper"],
    },
    accountRef: "account_example",
    networkRef: "paper",
    venueRef: null,
    protocolRef: null,
    instrumentKey: "BTC-PERP",
    underlyingKey: "BTC",
    representationKey: "paper:BTC-PERP",
    positionType: "PAPER",
    positionSlotKey: "paper-1",
    book: "PAPER",
    accountingRole: "PAPER",
    economicLot: { state: "SOURCE_SCOPED", sourceId: "paper", lotKey: "paper-1", evidenceRefs: ["evidence:paper"] },
    quantity: null,
    valuation: {
      state: "UNPRICED",
      value: null,
      sourceRef: null,
      observedAt,
      validUntil: null,
      freshnessPolicy: null,
      reason: "paper trades carry no exact source decimal",
      conflictRefs: [],
    },
    valuationContribution: "NONE",
    cashState: "NOT_CASH",
    settlementState: "PAPER_OPEN",
    custodyClass: "PAPER_ONLY",
    exposureLegs: [],
  });

  const projection = project({ sources: [source("wallet", [position("a"), paper])] });

  assert.deepEqual(projection.observedValue.value, money("10000"));
  assert.equal(projection.books.live.positionCount, 1);
  assert.equal(projection.books.paper.positionCount, 1);
  assert.equal(projection.pnl.live.book, "LIVE");
  assert.equal(projection.pnl.paper.book, "PAPER");
});

test("the distribution is a labelled snapshot of priced positions, never an invented series", () => {
  const projection = project({
    sources: [source("wallet", [
      position("a", { underlyingKey: "BTC", valueUnits: "75000" }),
      position("b", { underlyingKey: "ETH", valueUnits: "25000" }),
      position("c", { underlyingKey: "SOL", valueUnits: null }),
    ])],
  });

  assert.deepEqual(projection.distribution.map((slice) => slice.key), ["BTC", "ETH"]);
  assert.equal(projection.distribution[0].shareBps, 7_500);
  assert.equal(projection.distribution[1].shareBps, 2_500);
  assert.equal(projection.distributionBasis, "PRICED_POSITIONS_AT_AS_OF");
  assert.equal(projection.distributionExcludedCount, 1);
  assert.equal(Object.hasOwn(projection, "history"), false);
});

test("an offset-less as-of is refused rather than read in host time", () => {
  assert.throws(() => project({ asOf: "2026-08-23T10:01:00" }), /explicit-offset/i);
});

test("healthy sources with one typed fact resolve to the ATTENTION state", () => {
  const projection = project({
    sources: [source("wallet", [position("a")])],
    signals: [{
      id: "signal-issuer",
      kind: "ISSUER_OR_PERMISSION_CHANGE",
      severity: "HIGH",
      observedAt,
      title: "An issuer permission changed",
      reason: "The issuer updated a transfer permission on a held representation",
      sourceRef: "issuer:1",
      freshness: "CURRENT",
      detailHref: "/app/portfolio#sources",
      actionLabel: "Open sources",
      limitation: null,
    }],
  });

  assert.equal(projection.state, "ATTENTION");
  assert.equal(projection.attention.length, 1);
  assert.equal(projection.sources.every((entry) => entry.state === "OK"), true);
});
