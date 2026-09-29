import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Nothing a browser imports may reach a Node built-in.
 *
 * This gate exists because of a defect no other test in this repository could
 * have caught. The Send console imported one function from `send-safety.ts`;
 * that module imported one constant — a base58 string — from the owner-canary
 * policy; and the policy imports `node:crypto` to hash a policy document.
 * Webpack cannot resolve `node:crypto` for a client bundle, so the Send page
 * returned 500 in the browser while typecheck, lint and 3,954 server-side
 * tests all passed. It was found by opening the page.
 *
 * A value import pulls a module's whole dependency graph. A type import does
 * not — it is erased before anything is bundled — which is why the walk below
 * distinguishes them rather than treating every mention of a module as a link.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

/** Client entry points whose graph must stay free of Node built-ins. */
const CLIENT_ENTRIES = [
  "app/solana/workspace/send/send-card.tsx",
  "app/solana/workspace/bridge/bridge-card.tsx",
  "app/solana/workspace/trade/swap-card.tsx",
  "lib/solana/send-safety.ts",
  "lib/solana/send-inventory.ts",
  "lib/solana/send-kinds.ts",
  "lib/solana/send-readiness.ts",
  "lib/solana/fingerprint.client.ts",
  "lib/solana/cctp-ephemeral.client.ts",
  "lib/base/wallet.client.ts",
];

/**
 * Import specifiers with their type-only flag.
 *
 * `import type { X } from "y"` and `import { type X } from "y"` are both
 * erased. The first is detected here; the second only matters when *every*
 * binding is a type, which this deliberately does not try to prove — a false
 * link is a stricter gate, and stricter is the safe direction.
 */
function importsOf(source) {
  const found = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const [, typeKeyword, bindings, specifier] = match;
    const everyBindingIsType =
      bindings.includes("{") &&
      bindings
        .replace(/[{}]/g, "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .every((entry) => entry.startsWith("type "));
    found.push({ specifier, typeOnly: Boolean(typeKeyword) || everyBindingIsType });
  }
  /* `export { x } from "y"` re-exports a value and carries the same weight. */
  for (const match of source.matchAll(/export\s+(type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/g)) {
    found.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }
  return found;
}

function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith("node:")) return { builtin: specifier };
  let base;
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = join(REPO, specifier.slice(2));
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return { file: candidates.find((path) => existsSync(path) && !path.endsWith("/")) ?? null };
}

/** The first path from `entry` to a `node:` import, or null when there is none. */
function pathToNodeBuiltin(entry) {
  const seen = new Set();
  const stack = [{ file: join(REPO, entry), trail: [entry] }];

  while (stack.length > 0) {
    const { file, trail } = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const { specifier, typeOnly } of importsOf(source)) {
      if (typeOnly) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === null) continue;
      if (resolved.builtin) return trail.concat(resolved.builtin);
      if (resolved.file) {
        stack.push({ file: resolved.file, trail: trail.concat(resolved.file.slice(REPO.length + 1)) });
      }
    }
  }
  return null;
}

test("no client Send module reaches a Node built-in through a value import", () => {
  for (const entry of CLIENT_ENTRIES) {
    const trail = pathToNodeBuiltin(entry);
    assert.equal(
      trail,
      null,
      trail === null ? "" : `${entry} pulls a Node built-in into the browser bundle: ${trail.join(" -> ")}`,
    );
  }
});

test("that walk really does catch the import chain it was written for", () => {
  /* The exact defect, reconstructed: the console imports a value from the
     safety module, which imports a value from the canary policy, which imports
     node:crypto. If this stops failing, the walk has stopped following value
     imports and the gate above is decorative. */
  const trail = pathToNodeBuiltin("lib/solana/canary-policy.ts");
  assert.notEqual(trail, null, "canary-policy really does import node:crypto");
  assert.ok(trail.at(-1).startsWith("node:"));
});
