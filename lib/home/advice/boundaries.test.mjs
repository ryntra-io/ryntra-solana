import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * The boundaries this wave promised, asserted against the source rather than
 * against a paragraph in a card.
 *
 * Wave 4's version of this file caught a wall-clock read and a non-`NONE`
 * execution authority before either shipped. This one guards the three things
 * that are cheap to write by accident on a *decision* surface: a recommendation
 * verb, a receipt built without an observed outcome, and a model call on a path
 * that is supposed to be arithmetic over records.
 */

const DIRECTORY = new URL("./", import.meta.url);

/** Prose is not code — the same stripper wave 4 proved, for the same reason. */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");

const modules = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => {
    const source = readFileSync(new URL(name, DIRECTORY), "utf8");
    return { name, source, code: codeOnly(source) };
  });

test("the advice modules exist as one directory of pure modules", () => {
  assert.deepEqual(
    modules.map((module) => module.name).sort(),
    ["action-case.ts", "activity.ts", "advice-case.ts", "journal.ts", "read-model.ts", "receipt.ts"],
  );
});

test("the comment stripper removes prose and keeps code", () => {
  const stripped = codeOnly([
    "/* a comment naming Date.now( and the verdict BUY in prose */",
    "// another one naming Date.now(",
    " * a JSDoc continuation naming Date.now(",
    "const value = 1;",
  ].join("\n"));
  assert.equal(stripped.includes("Date.now("), false);
  assert.equal(stripped.includes("BUY"), false);
  assert.match(stripped, /const value = 1;/);
  assert.equal(codeOnly("const now = Date.now();").includes("Date.now("), true);
});

test("no personalized recommendation verb is issuable from any advice module", () => {
  /* `AFTER_GATE` is a real gate, not a phrasing preference: issuing one of
     these requires a permitted provider of record, a counsel-approved product
     perimeter and a versioned RegulatoryCapabilityState. None exists, so the
     vocabulary must not exist in the code that would carry it. */
  for (const { name, code } of modules) {
    for (const verdict of ['"BUY"', '"SELL"', '"HOLD"', '"REDUCE"', '"HEDGE"', '"REBALANCE"']) {
      assert.equal(code.includes(verdict), false, `${name} must not carry the verdict ${verdict}`);
    }
  }
});

test("advice authority is decided in one place and is always NONE", () => {
  const declarations = modules.flatMap(({ name, code }) =>
    [...code.matchAll(/ADVICE_AUTHORITY\s*=\s*"([A-Z_]+)"/g)].map((match) => ({ name, value: match[1] })),
  );
  assert.equal(declarations.length, 1, "exactly one module may define the advice authority");
  assert.equal(declarations[0].value, "NONE");
  assert.equal(declarations[0].name, "advice-case.ts");

  const compiler = modules.find((module) => module.name === "advice-case.ts").code;
  /* Written by the compiler, never read from its input: that is the difference
     between a rule and a default a caller can override. */
  assert.match(compiler, /adviceAuthority:\s*ADVICE_AUTHORITY/);
  assert.match(compiler, /recommendation:\s*null/);
  assert.equal(/input\.adviceAuthority/.test(compiler), false);
  assert.equal(/input\.recommendation/.test(compiler), false);
});

test("a receipt cannot be built without an authoritative observed outcome", () => {
  const receipt = modules.find((module) => module.name === "receipt.ts");
  /* One constructor, one gate, and the gate is the first thing in it. The
     match is on the id being *minted* rather than on the field being declared,
     because a type carries the same word and is not a way to build one. */
  const constructors = [...receipt.code.matchAll(/receiptId: `rcp_/g)];
  assert.equal(constructors.length, 1, "there must be exactly one place a receipt is constructed");
  const body = receipt.code.slice(receipt.code.indexOf("export function issueReceipt"));
  /* Presence first, order second. Written as an `indexOf` comparison alone this
     passed when the check was DELETED — `-1` is less than any real index — so
     the structural half of the gate was green on exactly the defect it exists
     to catch. Proved by removing the guard and watching both halves fail. */
  assert.ok(body.includes("!outcome.authoritative"), "the guard must exist before it can come first");
  assert.ok(
    body.indexOf("!outcome.authoritative") < body.indexOf("receiptId: `rcp_"),
    "the authoritative check must precede the only receipt construction",
  );
  /* And the gate is proved by the behaviour test beside this one, not only by
     the shape of the file: `receipt.test.mjs` hands it a non-authoritative
     outcome and requires null back. */
});

test("no model, inference or completion call exists on any decision path", () => {
  for (const { name, code } of modules) {
    for (const forbidden of [
      "openai",
      "anthropic",
      "@ai-sdk",
      "generateText",
      "streamText",
      "createCompletion",
      "chat.completions",
      "embeddings",
      "inference",
    ]) {
      assert.equal(
        code.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `${name} must not reach a model: found ${forbidden}`,
      );
    }
  }
});

test("no advice module performs a network read, a write or a signature", () => {
  for (const { name, code } of modules) {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      'method: "POST"',
      "eth_sendTransaction",
      "eth_requestAccounts",
      "personal_sign",
      "signTypedData",
      "paperOpen",
      "paperClose",
      "paperJournal",
      "liveNoteUpsert",
      "watchUpdate",
    ]) {
      assert.equal(code.includes(forbidden), false, `${name} must not ${forbidden}`);
    }
  }
});

test("no advice module reads a hidden clock", () => {
  for (const { name, code } of modules) {
    assert.equal(code.includes("Date.now("), false, `${name} must not read the wall clock`);
    assert.doesNotMatch(code, /new Date\(\s*\)/, `${name} must not read the wall clock`);
  }
});

test("no advice module invents a universal score", () => {
  for (const { name, code } of modules) {
    for (const forbidden of ["confidenceScore", "convictionScore", "opportunityScore", "safetyScore", "trustScore"]) {
      assert.equal(code.includes(forbidden), false, `${name} must not carry ${forbidden}`);
    }
  }
});

test("Home imports Agent Control's action vocabulary rather than redeclaring it", () => {
  const homeAction = modules.find((module) => module.name === "action-case.ts");
  assert.match(homeAction.code, /from "\.\.\/\.\.\/agent-control\/action-case\.ts"/);
  /* A second declaration of the stage list is the second source of truth the
     planned-route register warned about, in the exact file it warned about. */
  assert.equal(/export const ACTION_STAGES\s*=/.test(homeAction.code), false);
  assert.equal(/type ActionStageId\s*=\s*\(/.test(homeAction.code), false);
});

test("no advice module totals money across the paper and live books", () => {
  for (const { name, code } of modules) {
    for (const forbidden of ["realizedTotal", "combinedRealized", "totalRealized"]) {
      assert.equal(code.includes(forbidden), false, `${name} must not carry ${forbidden}`);
    }
  }
});
