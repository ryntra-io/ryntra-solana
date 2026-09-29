import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * The boundaries this wave promised, asserted against the source rather than
 * against a paragraph in a card.
 *
 * Each one is here because the opposite is cheap to write by accident: an
 * `await explain(change)` inside a detector, a `fetch` in a pure module, a
 * second place that decides what `executionAuthority` means.
 */

const DIRECTORY = new URL("./", import.meta.url);

/**
 * Prose is not code.
 *
 * The first version of the clock check failed on a *comment* — one that says a
 * module must not read the wall clock. That is the repository's own recurring
 * lesson, and the reason the design gate learned it too: a scan that cannot
 * tell an explanation from an instruction forces the explanation to be deleted.
 * Block comments and comment-only lines are stripped before any scan below.
 */
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

test("the research modules exist as one directory of pure modules", () => {
  assert.deepEqual(
    modules.map((module) => module.name).sort(),
    ["change.ts", "mandate.ts", "monitor-rule.ts", "read-model.ts", "scheduler.ts"],
  );
});

test("the comment stripper removes prose and keeps code", () => {
  /* The gate above is only as good as this: proven by handing it a file whose
     comment says the forbidden thing and whose code does not. */
  const stripped = codeOnly([
    "/* a comment naming Date.now( in prose */",
    "// another one naming Date.now(",
    " * a JSDoc continuation naming Date.now(",
    "const value = 1;",
  ].join("\n"));
  assert.equal(stripped.includes("Date.now("), false);
  assert.match(stripped, /const value = 1;/);
  assert.equal(codeOnly("const now = Date.now();").includes("Date.now("), true);
});

test("no model, inference or completion call exists on any detection path", () => {
  /* "No LLM per tick" as a property of the code. An LLM may explain one of
     these rows to a reader later; it may never produce one. */
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

test("no research module performs a network read, a write or a signature", () => {
  for (const { name, code } of modules) {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "method: \"POST\"",
      "eth_sendTransaction",
      "personal_sign",
      "signTypedData",
      "paperOpen",
      "paperClose",
      "watchUpdate",
      "watchRecapUpdate",
    ]) {
      assert.equal(code.includes(forbidden), false, `${name} must not ${forbidden}`);
    }
  }
});

test("no research module reads a hidden clock", () => {
  /* Every function takes `asOf`. Constructing a date from a parsed instant is
     arithmetic on a value the caller supplied; a wall-clock read is not, and it
     makes a projection untestable. */
  for (const { name, code } of modules) {
    assert.equal(code.includes("Date.now("), false, `${name} must not read the wall clock`);
    assert.doesNotMatch(code, /new Date\(\s*\)/, `${name} must not read the wall clock`);
  }
});

test("execution authority is decided in exactly one place and is always NONE", () => {
  const declarations = modules.flatMap(({ name, code }) =>
    [...code.matchAll(/executionAuthority:\s*"([A-Z_]+)"/g)].map((match) => ({ name, value: match[1] })),
  );
  assert.ok(declarations.length >= 3, "the mandate, the rule and the projection each state it");
  for (const declaration of declarations) {
    assert.equal(declaration.value, "NONE", `${declaration.name} states a non-NONE execution authority`);
  }
});

test("a source with no entitlement can never be ingested, whatever else is true of it", () => {
  const mandate = modules.find((module) => module.name === "mandate.ts").source;
  assert.match(mandate, /SOURCE_NOT_ENTITLED/);
  assert.match(mandate, /RIGHTS_EXCEED_ENTITLEMENT/);
  /* Data rights are checked before anything reads a source: the entitlement
     guard sits in the compile step, which is the only way a source enters. */
  const compileBody = mandate.slice(mandate.indexOf("export function compileResearchMandate"));
  assert.ok(
    compileBody.indexOf("SOURCE_NOT_ENTITLED") < compileBody.indexOf("const material ="),
    "entitlement must be checked before a mandate is built from its sources",
  );
});
