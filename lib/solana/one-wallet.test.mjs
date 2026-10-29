import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * One wallet — Solana.
 *
 * On the pages of Ryntra on Solana a person signs in and signs with a Solana
 * wallet only: no Ethereum sign-in (SIWE), no Ethereum-style wallet to connect.
 * Money from another network arrives at a deposit address; money sent to
 * another network is signed by the Solana wallet with the address typed as text.
 *
 * The gate walks the value-import graph of every page under `app/app/` — the
 * routes a person reaches at `/app/*` — and fails if any of them reaches the EVM
 * wallet client, the SIWE library, or a module that talks to an injected
 * Ethereum provider. Прогнози (`app/app/predictions/**`) are the Predictions
 * line's and are asked there (NAV-6c, PM-S1).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const OTHER_LINES = [/^app\/app\/predictions\//, /^app\/app\/rewards\//, /^app\/app\/ryn\//, /^app\/app\/lens\//];
const FORBIDDEN_MODULES = ["lib/base/wallet.client.ts", "lib/auth/siwe.ts", "app/app/wallet-connect.ts"];
/* Asked of the code with its comments removed: a module that explains an Ethereum signature is not one that asks for it. */
const FORBIDDEN_TEXT = /\.ethereum\b|ethereum\?\s*:|eth_requestAccounts|eth_accounts|personal_sign|eth_sendTransaction/;
/**
 * `/app/connect` (the old Connection Center, with Arcus's own key signature)
 * answers 308 to the account settings (`lib/product/customer-routing.ts`), so no
 * person reaches it. It is let through only while that redirect stands.
 */
const UNREACHABLE = [/^app\/app\/connect\//];

const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function pages(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...pages(path));
    else if (name === "page.tsx" || name === "layout.tsx") found.push(path);
  }
  return found;
}

function importsOf(source) {
  const found = [];
  for (const match of source.matchAll(/import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g)) {
    const [, typeKeyword, bindings, specifier] = match;
    const allTypes = bindings.includes("{") && bindings.replace(/[{}]/g, "").split(",").map((entry) => entry.trim()).filter(Boolean).every((entry) => entry.startsWith("type "));
    if (!typeKeyword && !allTypes) found.push(specifier);
  }
  for (const match of source.matchAll(/export\s+(type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g)) if (!match[1]) found.push(match[2]);
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]);
  return found;
}

function resolveSpecifier(fromFile, specifier) {
  let base;
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = join(REPO, specifier.slice(2));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (path) => relative(REPO, path).replaceAll("\\", "/");

test("no page of Ryntra on Solana reaches an Ethereum wallet or an Ethereum sign-in", () => {
  const routing = readFileSync(join(REPO, "lib", "product", "customer-routing.ts"), "utf8");
  assert.match(routing, /\["\/app\/connect", "\/app\/settings#account"\]/, "the old Connection Center stays a redirect");
  const entries = pages(join(REPO, "app", "app")).filter((path) => ![...OTHER_LINES, ...UNREACHABLE].some((re) => re.test(rel(path))));
  assert.ok(entries.length > 30, "the cabinet's pages are found");
  const seen = new Map();
  const queue = entries.map((path) => [path, rel(path)]);
  while (queue.length > 0) {
    const [file, via] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, via);
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      const next = resolveSpecifier(file, specifier);
      if (next && !seen.has(next) && !OTHER_LINES.some((re) => re.test(rel(next)))) queue.push([next, via]);
    }
  }
  const reached = [...seen.keys()].map(rel);
  for (const forbidden of FORBIDDEN_MODULES) {
    const file = join(REPO, forbidden);
    assert.ok(!seen.has(file), `${forbidden} is reached from ${seen.get(file)}`);
  }
  const talking = reached.filter((path) => !path.endsWith(".test.mjs") && FORBIDDEN_TEXT.test(code(readFileSync(join(REPO, path), "utf8"))));
  assert.deepEqual(talking, [], `modules that ask an Ethereum provider, reached from a Solana page: ${talking.map((path) => `${path} ← ${seen.get(join(REPO, path))}`).join(", ")}`);
});
