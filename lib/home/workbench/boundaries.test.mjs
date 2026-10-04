import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * The boundaries of the workbench, strategy and control modules, asserted against
 * their own source.
 *
 * Three module directories arrived together — the workbench, the strategy
 * lifecycle and the Agent Control projections — and they share four failure
 * modes that are cheap to write by accident: a model call on a path that is
 * supposed to be arithmetic over records, a hidden clock, a second copy of a
 * vocabulary that already has an owner, and a personalized verdict as a typed
 * value.
 *
 * The verdict check has one deliberate exemption, and naming it is the point:
 * `answer.ts` is the module that *defines* the refusal, so it is the one file
 * that must carry the six words. Every other module and every surface is
 * refused them — which is the same shape as the advice modules' "advice
 * authority is decided in one place".
 */

const DIRECTORIES = [
  { id: "workbench", url: new URL("./", import.meta.url) },
  { id: "strategy", url: new URL("../strategy/", import.meta.url) },
  { id: "control", url: new URL("../control/", import.meta.url) },
];

/** Prose is not code — the same stripper the research and advice boundaries proved. */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");

const modules = DIRECTORIES.flatMap(({ id, url }) =>
  readdirSync(url)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => {
      const source = readFileSync(new URL(name, url), "utf8");
      return { name: id + "/" + name, source, code: codeOnly(source) };
    }),
);

test("the workbench, strategy and control directories exist with exactly the declared modules", () => {
  assert.deepEqual(
    modules.map((module) => module.name).sort(),
    [
      "control/projection.ts",
      "strategy/backtest.ts",
      "strategy/lifecycle.ts",
      "strategy/read-model.ts",
      "workbench/answer.ts",
      "workbench/draft.ts",
      "workbench/operations.ts",
      "workbench/question.ts",
      "workbench/read-model.ts",
    ],
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

test("no workbench, strategy or control module calls a model, reads the network or writes anything", () => {
  for (const { name, code } of modules) {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "openai",
      "OpenAI",
      'method: "POST"',
      "eth_sendTransaction",
      "eth_requestAccounts",
      "personal_sign",
      "signTypedData",
      "strategyLabAppend",
      "paperOpen",
      "paperClose",
      "liveNoteUpsert",
    ]) {
      assert.equal(code.includes(forbidden), false, `${name} must not ${forbidden}`);
    }
  }
});

test("no workbench, strategy or control module reads a hidden clock or a random number", () => {
  for (const { name, code } of modules) {
    assert.equal(code.includes("Date.now("), false, `${name} must not read the wall clock`);
    assert.doesNotMatch(code, /new Date\(\s*\)/, `${name} must not read the wall clock`);
    assert.equal(code.includes("Math.random"), false, `${name} must not be random`);
  }
});

test("the personalized verdict vocabulary exists in exactly one module — the one that refuses it", () => {
  const carriers = modules.filter(({ code }) =>
    ['"BUY"', '"SELL"', '"HOLD"', '"REDUCE"', '"HEDGE"', '"REBALANCE"'].some((verdict) => code.includes(verdict)),
  );
  assert.deepEqual(carriers.map((module) => module.name), ["workbench/answer.ts"]);
  assert.match(
    carriers[0].code,
    /VERDICT_WORDS\s*=\s*\["BUY", "SELL", "HOLD", "REDUCE", "HEDGE", "REBALANCE"\]/,
  );
});

test("AI authority is declared once and is always NONE", () => {
  const declarations = modules.flatMap(({ name, code }) =>
    [...code.matchAll(/RYN_AI_AUTHORITY\s*=\s*"([A-Z_]+)"/g)].map((match) => ({ name, value: match[1] })),
  );
  assert.equal(declarations.length, 1, "exactly one module may define the AI authority");
  assert.equal(declarations[0].name, "workbench/operations.ts");
  assert.equal(declarations[0].value, "NONE");
});

test("projection authority is declared once and is always PROJECTION", () => {
  const declarations = modules.flatMap(({ name, code }) =>
    [...code.matchAll(/CONTROL_AUTHORITY\s*=\s*"([A-Z_]+)"/g)].map((match) => ({ name, value: match[1] })),
  );
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].name, "control/projection.ts");
  assert.equal(declarations[0].value, "PROJECTION");
});

test("the control projection imports Agent Control's vocabulary rather than redeclaring it", () => {
  const projection = modules.find((module) => module.name === "control/projection.ts");
  assert.match(projection.code, /from "\.\.\/\.\.\/agent-control\/owner-control\.ts"/);
  for (const redeclaration of [
    "AGENT_OWNER_ACTION_CLASSES =",
    "AGENT_OWNER_AUTHORIZATION_MODES =",
    "AGENT_ENFORCEMENT_GRADES =",
    "AGENT_MANDATE_STATES =",
  ]) {
    assert.equal(projection.code.includes(redeclaration), false, "must not redeclare " + redeclaration);
  }
});

test("no workbench, strategy or control module invents a universal score", () => {
  for (const { name, code } of modules) {
    for (const forbidden of ["confidenceScore", "convictionScore", "opportunityScore", "safetyScore", "trustScore", "qualityScore"]) {
      assert.equal(code.includes(forbidden), false, `${name} must not carry ${forbidden}`);
    }
  }
});

test("no workbench, strategy or control module can save a draft: there is no ok true path out of the save", () => {
  const draft = modules.find((module) => module.name === "workbench/draft.ts");
  assert.equal(/ok:\s*true/.test(draft.code), false, "a save that succeeds would need persistence these modules do not add");
  assert.match(draft.code, /refusal:\s*"CONVERSATION_MAY_NOT_SAVE"/);
  assert.match(draft.code, /refusal:\s*"NO_PERSISTENCE"/);
});

test("the strategy lifecycle has no edge from Draft to Approved and none from Backtest to Active", () => {
  const lifecycle = modules.find((module) => module.name === "strategy/lifecycle.ts");
  assert.equal(/DRAFT:\s*\[[^\]]*"APPROVED"/.test(lifecycle.code), false);
  assert.equal(/BACKTEST:\s*\[[^\]]*"ACTIVE"/.test(lifecycle.code), false);
});
