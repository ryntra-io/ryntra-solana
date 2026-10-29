// Run from repo root: node --test packages/ryntra-client/src/generated.test.mjs
//
// What the generated half must be true of on its own — the part that needs
// nothing but this package.
//
// Whether it still matches the document is proven beside the generator, in
// `scripts/api/build-client-v1.test.mjs`: the document and the generator live
// in the development repository, and the closed code snapshot that reviewers
// read carries this package without them. A test that reached across that line
// would be a test the snapshot cannot run.
import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_MAJOR, CONTRACT_VERSION, ERRORS, IDEMPOTENCY_HEADER } from "./generated/contract.ts";
import { SCHEMAS } from "./generated/schemas.ts";

test("the constants the package stands on come from the contract, not from here", function () {
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(CONTRACT_MAJOR, Number(CONTRACT_VERSION.split(".")[0]));
  assert.equal(IDEMPOTENCY_HEADER, "Idempotency-Key");
});

test("every error code has a status and a retryability, and the two agree", function () {
  const codes = Object.entries(ERRORS);
  assert.ok(codes.length > 50, `the contract has more codes than this build carries (${codes.length})`);
  for (const [code, row] of codes) {
    assert.ok(Number.isInteger(row.status) && row.status >= 400, `${code} has no status`);
    assert.equal(row.retryable, row.status === 429 || row.status >= 500, `${code}: retryability must follow the status, not a judgement`);
  }
  assert.ok(codes.some(([, row]) => row.retryable), "some refusal must be worth retrying");
  assert.ok(codes.some(([, row]) => !row.retryable), "and some must not");
});

test("no schema the package carries uses a keyword the validator does not handle", function () {
  /* The generator throws on an unhandled keyword, so this cannot normally
     drift — but a validator silently ignoring a constraint is the failure mode
     worth a second lock, because it looks exactly like a passing check. */
  const handled = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "propertyNames",
    "items",
    "prefixItems",
    "enum",
    "const",
    "anyOf",
    "oneOf",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
  ]);
  const formats = new Set(["date-time", "uri"]);
  const unexpected = new Set();
  const unexpectedFormats = new Set();

  const walk = (schema) => {
    if (!schema || typeof schema !== "object") return;
    for (const key of Object.keys(schema)) if (!handled.has(key)) unexpected.add(key);
    if (typeof schema.format === "string" && !formats.has(schema.format)) unexpectedFormats.add(schema.format);
    for (const child of Object.values(schema.properties ?? {})) walk(child);
    walk(schema.items);
    (schema.prefixItems ?? []).forEach(walk);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") walk(schema.additionalProperties);
    walk(schema.propertyNames);
    for (const key of ["anyOf", "oneOf"]) (schema[key] ?? []).forEach(walk);
  };
  for (const schema of Object.values(SCHEMAS)) walk(schema);

  assert.deepEqual([...unexpected], [], "the validator would ignore these keywords, which is worse than failing on them");
  assert.deepEqual([...unexpectedFormats], [], "an unhandled format is a constraint nobody checks");
});
