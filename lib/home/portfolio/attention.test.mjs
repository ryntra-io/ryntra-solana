import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTENTION_KINDS,
  ATTENTION_SEVERITIES,
  dominantAttention,
  rankAttention,
} from "./attention.ts";

function item(id, kind, severity, observedAt, detailHref = `/app/portfolio#${id}`) {
  return {
    id,
    kind,
    severity,
    observedAt,
    title: `Attention ${id}`,
    reason: `Reason ${id}`,
    sourceRef: `source:${id}`,
    freshness: "CURRENT",
    detailHref,
    actionLabel: detailHref ? "Open detail" : null,
  };
}

test("Attention ranks by canonical priority, severity, age, then stable id", () => {
  const input = [
    item("z-provider", "DEGRADED_PROVIDER", "CRITICAL", "2026-08-23T09:00:00.000Z"),
    item("z-review", "DETERMINISTIC_REVIEW", "HIGH", "2026-08-23T08:00:00.000Z"),
    item("b-block", "DETERMINISTIC_REVIEW", "CRITICAL", "2026-08-23T08:00:00.000Z"),
    item("a-block-new", "DETERMINISTIC_REVIEW", "CRITICAL", "2026-08-23T09:00:00.000Z"),
    item("a-block-old", "DETERMINISTIC_REVIEW", "CRITICAL", "2026-08-23T08:00:00.000Z"),
  ];

  assert.deepEqual(rankAttention(input).map((entry) => entry.id), [
    "a-block-old",
    "b-block",
    "a-block-new",
    "z-review",
    "z-provider",
  ]);
});

test("Attention ordering is input-order invariant and preserves a missing route", () => {
  const withoutRoute = item(
    "unknown-evidence",
    "STALE_OR_CONFLICTING_EVIDENCE",
    "MEDIUM",
    "2026-08-23T07:00:00.000Z",
    null,
  );
  const withRoute = item(
    "reconcile",
    "INCOMPLETE_RECONCILIATION",
    "HIGH",
    "2026-08-23T08:00:00.000Z",
  );

  const left = rankAttention([withoutRoute, withRoute]);
  const right = rankAttention([withRoute, withoutRoute]);
  assert.deepEqual(left, right);
  assert.equal(left[1].detailHref, null);
  assert.equal(left[1].actionLabel, null);
});


test("the canonical priority is the canon's own eleven kinds in its own order", () => {
  /* Mutation resistance: this list is Home canon §7 written out. A reordering,
     an addition or a rename fails here rather than quietly changing what the
     top of Today means. */
  assert.deepEqual([...ATTENTION_KINDS], [
    "EXACT_REVIEW_REQUEST",
    "DETERMINISTIC_REVIEW",
    "INCOMPLETE_RECONCILIATION",
    "LIQUIDATION_OR_HEALTH_RISK",
    "DELAYED_FUNDS",
    "DEGRADED_PROVIDER",
    "ISSUER_OR_PERMISSION_CHANGE",
    "STRATEGY_TRIGGER",
    "AGENT_BUDGET_THRESHOLD",
    "STALE_OR_CONFLICTING_EVIDENCE",
    "UNREVIEWED_OUTCOME",
  ]);
  assert.deepEqual([...ATTENTION_SEVERITIES], ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

  /* One item per kind, deliberately supplied in reverse canon order and with a
     severity/age gradient that a lazier comparator would sort by instead. */
  const items = [...ATTENTION_KINDS].reverse().map((kind, index) => item(
    `id-${index}`,
    kind,
    index % 2 === 0 ? "LOW" : "CRITICAL",
    `2026-08-23T0${index % 10}:00:00.000Z`,
  ));
  assert.deepEqual(rankAttention(items).map((entry) => entry.kind), [...ATTENTION_KINDS]);
});

test("every permutation of one fact set produces one identical ranking", () => {
  const base = [
    item("d", "DELAYED_FUNDS", "HIGH", "2026-08-23T06:00:00.000Z"),
    item("c", "DETERMINISTIC_REVIEW", "MEDIUM", "2026-08-23T05:00:00.000Z"),
    item("b", "DETERMINISTIC_REVIEW", "MEDIUM", "2026-08-23T05:00:00.000Z"),
    item("a", "EXACT_REVIEW_REQUEST", "LOW", "2026-08-23T09:00:00.000Z"),
  ];
  const expected = rankAttention(base).map((entry) => entry.id);
  assert.deepEqual(expected, ["a", "b", "c", "d"]);

  const permutations = (values) => values.length <= 1
    ? [values]
    : values.flatMap((value, index) => permutations([
        ...values.slice(0, index),
        ...values.slice(index + 1),
      ]).map((rest) => [value, ...rest]));

  for (const order of permutations(base)) {
    assert.deepEqual(rankAttention(order).map((entry) => entry.id), expected);
  }
});

test("a dead link, an unregistered kind and a duplicate id are all refused", () => {
  assert.equal(dominantAttention([]), null);
  assert.equal(
    dominantAttention([item("a", "UNREVIEWED_OUTCOME", "LOW", "2026-08-23T05:00:00.000Z")]).id,
    "a",
  );
  assert.throws(
    () => rankAttention([item("a", "PROMOTION", "LOW", "2026-08-23T05:00:00.000Z")]),
    /unregistered kind/,
  );
  assert.throws(
    () => rankAttention([
      item("a", "DELAYED_FUNDS", "LOW", "2026-08-23T05:00:00.000Z"),
      item("a", "DELAYED_FUNDS", "LOW", "2026-08-23T06:00:00.000Z"),
    ]),
    /unique/,
  );
  assert.throws(
    () => rankAttention([item("a", "DELAYED_FUNDS", "LOW", "2026-08-23T05:00:00")]),
    /explicit-offset/,
  );
});
