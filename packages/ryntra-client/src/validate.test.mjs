// Run from repo root: node --test packages/ryntra-client/src/validate.test.mjs
//
// The validator's two judgement calls are the things worth testing, because
// both are decisions a future reader could undo by accident:
//
//   an unknown property is accepted  — an additive release must not break a
//                                      client that is already out there
//   a declared field is checked      — all the way down, so a renamed nested
//                                      object fails the read instead of
//                                      handing the caller `undefined`
//
// The rest is arithmetic on keywords, and it is tested because a validator
// that passes everything is indistinguishable from no validator at all.
import assert from "node:assert/strict";
import test from "node:test";

import { check, describe } from "./validate.ts";

test("an unknown property is accepted even where the document says it is not", function () {
  const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
  assert.deepEqual(check({ a: "x" }, schema), []);
  assert.deepEqual(
    check({ a: "x", addedInAFutureRelease: 7 }, schema),
    [],
    "the contract is additive; a released client must survive a new field",
  );
});

test("a missing required property is named by its path", function () {
  const failures = check({ outer: {} }, { type: "object", properties: { outer: { type: "object", required: ["inner"] } }, required: ["outer"] });
  assert.deepEqual(failures, [{ path: "outer.inner", message: "missing" }]);
});

test("an explicit undefined counts as missing rather than as present", function () {
  const failures = check({ a: undefined }, { type: "object", required: ["a"], properties: { a: { type: "string" } } });
  assert.deepEqual(failures, [{ path: "a", message: "missing" }]);
});

test("a declared field is checked all the way down", function () {
  const schema = {
    type: "object",
    required: ["market"],
    properties: {
      market: {
        type: "object",
        required: ["price"],
        properties: { price: { type: "object", required: ["usd"], properties: { usd: { type: "number" } } } },
      },
    },
  };
  assert.deepEqual(check({ market: { price: { usd: 1.5 } } }, schema), []);
  const failures = check({ market: { price: { usd: "1.5" } } }, schema);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].path, "market.price.usd");
  assert.match(failures[0].message, /expected number, got string/);
});

test("an integer satisfies number, and nothing else widens", function () {
  assert.deepEqual(check(3, { type: "number" }), []);
  assert.deepEqual(check(3, { type: "integer" }), []);
  assert.equal(check(3.5, { type: "integer" }).length, 1);
  assert.equal(check("3", { type: "number" }).length, 1);
  assert.equal(check(null, { type: "number" }).length, 1, "null is its own type, not an absent number");
  assert.deepEqual(check(null, { type: ["number", "null"] }), []);
});

test("enum, const and the string keywords", function () {
  assert.deepEqual(check("LIVE", { enum: ["LIVE", "PAPER"] }), []);
  assert.match(check("DEMO", { enum: ["LIVE", "PAPER"] })[0].message, /expected one of "LIVE", "PAPER"/);
  assert.deepEqual(check("solana:mainnet", { const: "solana:mainnet" }), []);
  assert.equal(check("solana:devnet", { const: "solana:mainnet" }).length, 1);
  assert.equal(check("x", { type: "string", minLength: 2 })[0].message, "shorter than 2 characters");
  assert.equal(check("abc", { type: "string", maxLength: 2 })[0].message, "longer than 2 characters");
  assert.match(check("not-base58-$", { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]+$" })[0].message, /does not match/);
});

test("the two formats the contract uses are read leniently, not strictly", function () {
  assert.deepEqual(check("2026-10-26T09:00:00.000Z", { type: "string", format: "date-time" }), []);
  assert.deepEqual(check("2026-10-26T09:00:00Z", { type: "string", format: "date-time" }), [], "a server that omits milliseconds is not wrong");
  assert.equal(check("someday", { type: "string", format: "date-time" })[0].message, "not a time anything can read");
  assert.deepEqual(check("https://ryntra.io/x", { type: "string", format: "uri" }), []);
  assert.equal(check("ryntra.io", { type: "string", format: "uri" })[0].message, "not a URL");
});

test("the number bounds, including the exclusive ones", function () {
  assert.equal(check(-1, { type: "number", minimum: 0 })[0].message, "below 0");
  assert.equal(check(101, { type: "number", maximum: 100 })[0].message, "above 100");
  assert.equal(check(0, { type: "number", exclusiveMinimum: 0 })[0].message, "not above 0");
  assert.equal(check(100, { type: "number", exclusiveMaximum: 100 })[0].message, "not below 100");
});

test("arrays: every entry, its index, the bounds and a tuple", function () {
  const rows = { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } } } };
  assert.deepEqual(check([{ id: "a" }, { id: "b" }], rows), []);
  assert.deepEqual(check([{ id: "a" }, { nope: 1 }], rows), [{ path: "[1].id", message: "missing" }]);
  assert.equal(check([], { type: "array", minItems: 1 })[0].message, "fewer than 1 entries");
  assert.equal(check([1, 2, 3], { type: "array", maxItems: 2 })[0].message, "more than 2 entries");
  const bar = { type: "array", prefixItems: [{ type: "number" }, { type: "number" }] };
  assert.deepEqual(check([1, 2], bar), []);
  assert.deepEqual(check([1], bar), [{ path: "[1]", message: "missing" }]);
});

test("a free-form record constrains its keys and reads every value", function () {
  const schema = { type: "object", propertyNames: { type: "string", enum: ["view", "sign"] }, additionalProperties: { enum: ["ALLOW", "DENY"] } };
  assert.deepEqual(check({ view: "ALLOW" }, schema), []);
  assert.deepEqual(check({}, schema), [], "a record may be empty");
  assert.equal(check({ view: "MAYBE" }, schema).length, 1);
  assert.equal(check({ launch: "ALLOW" }, schema).length, 1, "a key outside propertyNames is a key the contract does not have");
});

test("a union reports the closest near-miss rather than every branch", function () {
  const schema = {
    anyOf: [
      { type: "object", required: ["kind", "mint"], properties: { kind: { const: "token" }, mint: { type: "string" } } },
      { type: "object", required: ["kind", "ticker", "isin"], properties: { kind: { const: "stock" }, ticker: { type: "string" }, isin: { type: "string" } } },
    ],
  };
  assert.deepEqual(check({ kind: "token", mint: "So1" }, schema), []);
  const failures = check({ kind: "token" }, schema);
  assert.match(failures[0].message, /matched none of the 2 shapes/);
  assert.ok(
    failures.some((failure) => failure.path === "mint" && failure.message === "missing"),
    `the near-miss should point at the one missing field, got ${JSON.stringify(failures)}`,
  );
});

test("a schema with no keywords accepts anything, and says nothing", function () {
  assert.deepEqual(check({ whatever: true }, {}), []);
  assert.deepEqual(check(null, {}), []);
});

test("describe keeps a long list readable and names the root when the path is empty", function () {
  const failures = [1, 2, 3, 4, 5, 6].map((n) => ({ path: `f${n}`, message: "missing" }));
  const line = describe(failures);
  assert.match(line, /f1: missing; f2: missing; f3: missing; f4: missing; and 2 more/);
  assert.match(describe([{ path: "", message: "expected object, got null" }]), /^\(the answer\): /);
});
