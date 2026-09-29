import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * The AGG product lab (`RYN-AGG-LAB-001`) is an internal decision surface.
 * These are the properties that make it one, pinned so that a later edit
 * cannot quietly turn it into a product page, a live trading surface or a
 * leak of the server key.
 */

const LAB = new URL(".", import.meta.url);
const REPO = new URL("../../../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, LAB), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const labSources = readdirSync(LAB)
  .filter((name) => /\.(tsx?|css)$/.test(name))
  .map((name) => [name, strip(read(name))]);

test("the lab is noindex and opens only for a Ryntra admin session", () => {
  const layout = read("layout.tsx");
  assert.match(layout, /robots: \{ index: false, follow: false/);
  const page = read("page.tsx");
  assert.match(page, /getAdminSession/);
  assert.match(page, /if \(!admin\) return <AdminUnauthorized/);
  assert.match(page, /force-dynamic/);
});

test("the lab never reads the server key and never runs live", () => {
  for (const [name, source] of labSources) {
    assert.doesNotMatch(source, /AGG_API_KEY/, `${name} must not reference the server key`);
    assert.doesNotMatch(source, /apiKey\s*:/, `${name} must not pass an API key to the SDK`);
    assert.doesNotMatch(source, /executionMode:\s*"live"/, `${name} must not force live execution`);
    assert.doesNotMatch(source, /mode:\s*"live"/, `${name} must not send mode: live`);
    assert.doesNotMatch(source, /placeOrder\(/, `${name} must not call the live-only direct order route`);
    assert.doesNotMatch(source, /withdrawManaged|fillSelfCustody|redeem\(/, `${name} must not move funds`);
  }
  /* The console also prints the calls it makes as labels, with escaped quotes. */
  const console = read("agents-data.tsx");
  const paper = /mode: \\?"paper\\?"/;
  for (const call of console.match(/getSmartRoute\(\{[^}]*\}/g) ?? []) assert.match(call, paper);
  for (const call of console.match(/executeManaged\(\{[\s\S]*?\}\)/g) ?? []) assert.match(call, paper);
  assert.match(read("agg-lab.tsx"), /trading: \{ executionMode: "paper" as const \}/);
});

test("the lab labels itself as paper trading on the page", () => {
  assert.match(read("agg-lab.tsx"), /Paper trading · AGG test environment/);
});

test("nothing in the product links to the lab", () => {
  const roots = ["app/shell", "app/components", "app/app", "app/site", "app/landing", "lib/product"].map((dir) => new URL(dir, REPO));
  const offenders = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir.pathname ? decodeURIComponent(dir.pathname).replace(/^\/([A-Za-z]:)/, "$1") : String(dir), entry);
      let info;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(new URL(`${entry}/`, dir));
      else if (/\.(tsx?|mdx?|json)$/.test(entry) && readFileSync(path, "utf8").includes("/preview/agg-lab")) offenders.push(path);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], "the lab must stay unlinked from the product");
});

test("the four packages are the official ones and the lab imports only them", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", REPO), "utf8"));
  for (const name of ["@agg-build/sdk", "@agg-build/hooks", "@agg-build/ui", "@agg-build/auth"]) {
    assert.ok(pkg.dependencies[name], `${name} must be a dependency`);
  }
  /* Their UI bundle imports the wallet peers at build time; the pin on the
     adapter base keeps the repository's web3.js where it is. */
  assert.ok(pkg.dependencies.wagmi, "wagmi is imported by @agg-build/ui at build time");
  assert.ok(pkg.dependencies["@solana/wallet-adapter-react"], "wallet-adapter-react is imported by @agg-build/ui at build time");
  assert.equal(pkg.overrides["@solana/wallet-adapter-base"], "0.9.27");
  for (const [name, source] of labSources) {
    for (const match of source.matchAll(/from "([^"]+)"/g)) {
      const spec = match[1];
      assert.ok(
        spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("@agg-build/") || spec === "react" || spec === "next" || spec.startsWith("next/") || spec.startsWith("react/"),
        `${name} imports ${spec}; the lab talks to the aggregator through its official packages only`,
      );
    }
  }
});

test("the server-key read is admin-only and the key never leaves the route", () => {
  const route = strip(readFileSync(new URL("../../api/preview/agg-lab/paper/route.ts", LAB), "utf8"));
  assert.match(route, /getAdminSession/);
  assert.match(route, /if \(!admin\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(route, /process\.env\.AGG_API_KEY/);
  /* The key is read once, checked once, handed to the SDK once and put on the
     partner-read header once; it appears in no response body. */
  assert.equal((route.match(/apiKey/g) ?? []).length, 4, "apiKey: read, checked, the client, the partner header");
  assert.match(route, /"x-app-api-key": apiKey/);
  assert.doesNotMatch(route, /NextResponse\.json\([^)]*apiKey/);
  assert.match(route, /listPaperTradingAccounts/);
  for (const forbidden of ["placePaperTradingOrder", "createPaperTradingAccount", "resetPaperTradingAccount", "setPaperTradingBalance"]) {
    assert.doesNotMatch(route, new RegExp(forbidden), `${forbidden} would mutate the aggregator's ledger from the lab`);
  }
});
