import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The activity store's contract.
 *
 * Three properties matter more than the rest, and each one is a defect this
 * repository has already paid for somewhere else:
 *
 *   one payment is one row, not eight — the same shape as a registry flag and a
 *     hand-ordered array disagreeing;
 *   a terminal state is never left — the payout kernel's monotonic
 *     reconciliation, arrived at through a review finding;
 *   a broken payload is no history, never a crash — fail closed, which is the
 *     rule the evidence envelope already enforces at the type level.
 *
 * They are tested against the source rather than by importing it, because this
 * suite runs under `node --test` with no TypeScript step and the module is a
 * `.ts` file. Behaviour that can only be described by reading the file is
 * described by reading the file; behaviour that can be re-implemented from the
 * source exactly is re-implemented and exercised.
 */

const HERE = join("lib", "stellar", "activity");
const read = (name) => readFileSync(join(HERE, name), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RECORD = strip(read("record.ts"));
const STORE = strip(read("store.ts"));

test("the vocabulary carries the states the delivery contract names", () => {
  const declared = RECORD.match(/STELLAR_ACTIVITY_STATES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(declared, "the state list is no longer an array literal, so the type cannot be derived from it");
  const states = [...declared[1].matchAll(/"([A-Z_]+)"/g)].map(([, value]) => value);

  for (const state of [
    "DRAFT",
    "BLOCKED",
    "AWAITING_AUTHORIZATION",
    "AUTHORIZED",
    "SIGNED",
    "SUBMITTED",
    "CONFIRMED",
    "RECONCILIATION_REQUIRED",
    "RECONCILED",
    "FAILED",
  ]) {
    assert.ok(states.includes(state), `${state} is missing from the activity vocabulary.`);
  }

  /* Every state needs copy. A state with no sentence renders as its own
     identifier, which is how `RECONCILIATION_REQUIRED` reaches a person. */
  for (const state of states) {
    assert.match(RECORD, new RegExp(`${state}:\\s*\\{\\s*label:`), `${state} has no copy.`);
  }
});

test("a terminal state is never rewritten into something in flight", () => {
  /*
   * The payout kernel shipped this defect and a review found it: a late update
   * reopened a settled decision. The same shape is available here — a slow
   * ledger read resolving after a lifecycle already failed — and the fix is the
   * same, refuse the write rather than trust the caller's ordering.
   */
  assert.match(
    RECORD,
    /TERMINAL_ACTIVITY_STATES\s*:\s*readonly StellarActivityState\[\]\s*=\s*\[[\s\S]*?"BLOCKED"[\s\S]*?"RECONCILED"[\s\S]*?"FAILED"/,
    "the terminal set no longer names all three finished states",
  );
  assert.match(
    RECORD,
    /function applyActivityUpdate[\s\S]{0,400}?if \(TERMINAL_ACTIVITY_STATES\.includes\(record\.state\)\) return record;/,
    "applyActivityUpdate no longer refuses to leave a terminal state",
  );
});

test("a record's identity survives an update, so one payment is one row", () => {
  /* `id`, `schema` and `createdAt` are re-applied after the spread rather than
     left to the patch, which is what stops a caller from forking a record by
     passing a field it should not own. */
  const body = RECORD.match(/function applyActivityUpdate[\s\S]*?\n\}/)[0];
  for (const field of ["id: record.id", "schema: ACTIVITY_SCHEMA", "createdAt: record.createdAt"]) {
    assert.ok(body.includes(field), `applyActivityUpdate lets a patch overwrite ${field.split(":")[0]}.`);
  }
  assert.ok(body.includes("updatedAt: now"), "applyActivityUpdate does not stamp the update time.");
});

test("the store keeps activity in this browser and says so in the file that decides it", () => {
  assert.match(STORE, /ACTIVITY_STORAGE_KEY\s*=\s*"ryntra\.stellar-activity\.v1"/);
  assert.match(STORE, /window\.localStorage/, "the store no longer uses local storage");
  assert.doesNotMatch(
    STORE,
    /\bfetch\(|axios|XMLHttpRequest|\/api\//,
    "the activity store reaches the network. Activity is kept in the browser and nowhere else; a server-side\n" +
      "payment history is the database this product was designed not to have.",
  );
});

test("a cap exists and is a number rather than a hope", () => {
  const cap = STORE.match(/ACTIVITY_LIMIT\s*=\s*(\d+)/);
  assert.ok(cap, "the store no longer declares a cap, so one browser key grows without a bound");
  assert.ok(Number(cap[1]) > 0 && Number(cap[1]) <= 500, `the cap is ${cap[1]}, which is not a browser-key size`);
  assert.match(STORE, /function trimActivity/, "nothing trims the stored set to the cap");
});

test("every storage path fails closed", () => {
  /*
   * Storage throws on *access* when cookies are blocked, before any read — so a
   * `typeof window` check alone is not enough and the guard has to be inside a
   * try. A workspace that cannot list its history still has to render.
   */
  assert.match(STORE, /function storage\(\)[\s\S]*?try \{[\s\S]*?window\.localStorage[\s\S]*?catch/);
  for (const fn of ["readActivity", "parseActivityPayload"]) {
    assert.match(STORE, new RegExp(`function ${fn}[\\s\\S]*?return \\[\\];`), `${fn} can throw instead of returning no history.`);
  }
  /* A write that cannot happen is reported, not swallowed: the Send surface has
     to be able to say "this run will not be remembered". */
  assert.match(STORE, /function writeActivity\([\s\S]*?\): boolean/);
  assert.match(STORE, /function recordActivity\([\s\S]*?\): boolean/);
});

test("a foreign, truncated or future payload is no history rather than a half-record", () => {
  /*
   * The parser is re-implemented here from the source's own rules and exercised,
   * because this is the one behaviour where reading the file is not enough: a
   * validator that accepts a record missing `amount` renders a blank row that
   * looks like a real payment.
   */
  const SCHEMA = "stellar-activity-1.0.0";
  const states = [...RECORD.match(/STELLAR_ACTIVITY_STATES\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/"([A-Z_]+)"/g)].map(
    ([, value]) => value,
  );

  const parseRecord = (value) => {
    if (!value || typeof value !== "object") return null;
    if (value.schema !== SCHEMA) return null;
    if (typeof value.id !== "string" || value.id.length === 0) return null;
    if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
    if (!states.includes(value.state)) return null;
    if (value.operation !== "payment") return null;
    for (const field of ["network", "assetCode", "amount", "destination"]) {
      if (typeof value[field] !== "string") return null;
    }
    return value;
  };

  const parse = (raw) => {
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) return [];
    return parsed.records.map(parseRecord).filter(Boolean);
  };

  const good = {
    id: "a",
    schema: SCHEMA,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    state: "RECONCILED",
    operation: "payment",
    network: "Stellar Testnet",
    assetCode: "XLM",
    amount: "1.0000000",
    destination: "GABC",
  };

  assert.equal(parse(JSON.stringify({ records: [good] })).length, 1, "a valid record must survive");
  assert.deepEqual(parse('{"records":[{"id":"a"'), [], "a truncated write must be no history");
  assert.deepEqual(parse("not json"), [], "a foreign value must be no history");
  assert.deepEqual(parse(JSON.stringify({ records: "nope" })), [], "a non-array must be no history");
  assert.deepEqual(
    parse(JSON.stringify({ records: [{ ...good, schema: "stellar-activity-2.0.0" }] })),
    [],
    "a future schema must be dropped rather than read as this one",
  );
  assert.deepEqual(
    parse(JSON.stringify({ records: [{ ...good, state: "TOTALLY_FINE" }] })),
    [],
    "a hand-edited state must be dropped",
  );
  assert.deepEqual(
    parse(JSON.stringify({ records: [{ ...good, amount: undefined }] })),
    [],
    "a record with no amount must be dropped rather than rendered as a blank payment",
  );
  assert.equal(
    parse(JSON.stringify({ records: [good, { ...good, id: "b", state: "NONSENSE" }] })).length,
    1,
    "one bad record must cost only itself",
  );
});

test("the Send surface records every branch, including the ones a demo skips", () => {
  const console_ = strip(readFileSync(join("app", "stellar", "workspace", "send", "send-console.tsx"), "utf8"));

  assert.match(console_, /import \{ recordActivity \}/, "the Send surface no longer records anything");
  for (const state of [
    "DRAFT",
    "BLOCKED",
    "AWAITING_AUTHORIZATION",
    "AUTHORIZED",
    "SIGNED",
    "SUBMITTED",
    "CONFIRMED",
    "RECONCILED",
    "RECONCILIATION_REQUIRED",
    "FAILED",
  ]) {
    /* Both forms: a literal `state: "X"` and the ternary that picks the terminal
       state from the reconciliation verdict. */
    assert.match(
      console_,
      new RegExp(`state:[^,\\n]*"${state}"`),
      `the Send lifecycle never records ${state}.`,
    );
  }

  /* One id, created once. Creating one per stage is how a payment becomes eight
     rows, and it is invisible until somebody opens Activity. */
  const created = [...console_.matchAll(/crypto\.randomUUID\(\)/g)];
  assert.equal(created.length, 1, `the Send surface mints ${created.length} ids; one payment must be one row.`);

  /* The terminal state is the reconciliation's, not the network's. */
  assert.match(
    console_,
    /reconciliation\.status === "MATCHED"/,
    "the record's terminal state no longer comes from reconciliation, so a transaction that merely succeeded would be filed as reconciled",
  );

  /* A browser that will not store must be told about, not implied to. */
  assert.match(console_, /remembered \?\s*null\s*:/, "the Send surface no longer says when a run will not be kept");
});

test("Attention is one computation, used by both surfaces", () => {
  /*
   * Every time this repository has had two lists that must agree, they have
   * disagreed silently — a module marked Guided that never reached the rail, a
   * registry flag against a hand-ordered array. The Overview panel and the
   * Attention page are exactly that shape, so they share the function.
   */
  const hub = join("app", "stellar", "workspace");
  const overview = strip(readFileSync(join(hub, "overview.tsx"), "utf8"));
  const page = strip(readFileSync(join(hub, "attention", "attention-console.tsx"), "utf8"));

  for (const [label, source] of [
    ["the Overview", overview],
    ["the Attention page", page],
  ]) {
    assert.match(source, /attentionItems\(/, `${label} no longer uses the shared attention computation.`);
    assert.match(source, /AttentionRow/, `${label} renders attention rows of its own rather than the shared one.`);
  }

  const shared = strip(readFileSync(join(hub, "hub", "attention.ts"), "utf8"));
  assert.match(shared, /recovery: /, "an attention item without a recovery step is a complaint");
  assert.match(
    shared,
    /state === "RECONCILIATION_REQUIRED"[\s\S]{0,300}?severity: "action"/,
    "a ledger that did not do what was authorized is filed below Action required, which is the whole product's claim as a log line",
  );
});
