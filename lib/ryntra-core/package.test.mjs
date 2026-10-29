// Run from repo root: node --test lib/ryntra-core/package.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The shared core (`@ryntra/core`: tokens, components, adapter contracts) comes in as an archive of one of its
 * commits, kept in `vendor/ryntra-core` and named `ryntra-core-<version>-<sha>.tgz`, installed as a `file:`
 * dependency. These checks prove an install from the lock gives what every screen built on the core needs first:
 * the tokens and a component that renders. The declarations are checked by `usage.tsx` beside this file, which
 * `npm run typecheck` and `next build` compile.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const readResolved = (specifier) => readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8");

/** An archive of one commit; an archive packed from uncommitted changes ends in `-dirty` and is refused here. */
const ARCHIVE = /^ryntra-core-(\d+\.\d+\.\d+)-([0-9a-f]{7,40})\.tgz$/;

test("package.json takes the core from the one archive in vendor/ryntra-core, and the lock agrees", () => {
  const archives = readdirSync(new URL("vendor/ryntra-core/", ROOT)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, `one archive in vendor/ryntra-core, found: ${archives.join(", ") || "none"}`);
  const [file] = archives;
  const match = ARCHIVE.exec(file);
  assert.ok(match, `${file} is not an archive of one commit of the core`);

  const spec = `file:vendor/ryntra-core/${file}`;
  assert.equal(JSON.parse(read("package.json")).dependencies["@ryntra/core"], spec);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages[""].dependencies["@ryntra/core"], spec);
  const entry = lock.packages["node_modules/@ryntra/core"];
  assert.equal(entry.resolved, spec);
  assert.equal(entry.version, match[1]);
  assert.match(entry.integrity, /^sha512-/);

  // Two commits of the core can carry one version, so the install is matched by the archive's integrity: npm writes
  // what it installed into node_modules/.package-lock.json.
  const installed = JSON.parse(readResolved("@ryntra/core/package.json"));
  assert.equal(installed.version, match[1], "node_modules holds another core than the lock names: run npm ci");
  const hidden = JSON.parse(read("node_modules/.package-lock.json")).packages["node_modules/@ryntra/core"];
  assert.equal(hidden?.integrity, entry.integrity, "node_modules holds another archive than the lock names: run npm ci");
});

test("the tokens load from the package: the brand orange in the JSON and the CSS, both themes", async () => {
  const { default: tokens } = await import("@ryntra/core/tokens.json", { with: { type: "json" } });
  assert.equal(tokens.default, "graphite");
  assert.equal(tokens.themes.graphite.color.brand, "#FF681C");
  assert.equal(tokens.themes.graphite.color.bg, "#080D13");
  assert.match(tokens.themes.porcelain.color.brand, /^#[0-9A-F]{6}$/);

  const css = readResolved("@ryntra/core/tokens.css");
  assert.match(css, /:root[^{]*\{[^}]*--ryntra-brand:\s*#FF681C;/);
  assert.match(css, /\[data-theme="porcelain"\][^{]*\{[^}]*--ryntra-brand:\s*#[0-9A-F]{6};/);
});

test("a component renders from the package: Button, on the core's classes and styles", async () => {
  const { Button } = await import("@ryntra/core/ui");
  const html = renderToStaticMarkup(createElement(Button, { variant: "primary" }, "Купити"));
  assert.match(html, /^<button\b/);
  assert.match(html, /class="[^"]*\bryntra-button ryntra-button--primary\b/);
  assert.match(html, /type="button"/);
  assert.match(html, />Купити</);
  assert.match(readResolved("@ryntra/core/ui.css"), /\.ryntra-button--primary\b/);
});
