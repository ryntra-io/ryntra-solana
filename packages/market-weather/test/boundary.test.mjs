/**
 * The boundary: what this package structurally cannot do, asserted by reading its shipped files rather than by trusting
 * the README. It reads public data with GET. It holds no key, signs nothing, swaps nothing and moves no money.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const walk = (dir) =>
  readdirSync(dir)
    .filter((name) => name !== "dist" && name !== "node_modules")
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const sources = walk(join(root, "src")).filter((path) => path.endsWith(".ts"));

test("no signing, no keys, no swaps, no money", () => {
  const forbidden = [
    /\bsign(Transaction|AllTransactions|Message)\b/,
    /\bsendTransaction\b/,
    /\bsendRawTransaction\b/,
    /\bKeypair\b/,
    /\b(secret|private)Key\b/i,
    /\bseed ?phrase\b/i,
    /\/swap\//,
    /\/(order|execute|build)\b/,
    /x-api-key/i,
    /\bauthorization\b/i,
    /process[.]env/,
    /\bmethod:\s*["'](POST|PUT|PATCH|DELETE)["']/,
    /localStorage|sessionStorage|indexedDB/,
  ];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${relative(root, file)} matches ${pattern}`);
  }
});

test("every network call is a GET through the one door", () => {
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const calls = [...text.matchAll(/\bfetch(Impl)?\(/g)].length;
    if (!calls) continue;
    const name = relative(root, file).replaceAll("\\", "/");
    assert.ok(["src/adapters/http.ts", "src/embed/city.ts"].includes(name), `${name} calls fetch outside the door`);
    assert.match(text, /method: "GET"/, `${name} reads with GET`);
  }
});

test("self-contained: no runtime dependencies, no imports from outside the package", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.dependencies, undefined);
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/);
  for (const file of sources) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.match(spec, /^\.{1,2}\/.*\.ts$/, `${relative(root, file)} imports ${spec}`);
      const target = join(file, "..", spec);
      assert.ok(target.startsWith(join(root, "src")), `${relative(root, file)} reaches outside src: ${spec}`);
    }
  }
});

/* The shape of a verdict names what is supposedly fine: «the token is safe», «safe to buy», «risk-free». */
const VERDICT = /\b(?:token|asset|mint|coin|pool)s?\s+(?:is|are)\s+safe\b|\bsafe to (?:buy|trade|hold|send)\b|\brisk-free\b/i;

test("no verdict words: the package states facts, it never calls a token safe", () => {
  assert.match("This token is safe.", VERDICT);
  for (const file of sources) {
    for (const [literal] of readFileSync(file, "utf8").matchAll(/"[^"\n]*"|`[^`\n]*`/g)) assert.doesNotMatch(literal, VERDICT, `${relative(root, file)}: ${literal}`);
  }
});

