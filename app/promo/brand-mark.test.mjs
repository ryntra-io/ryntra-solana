import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/*
 * Ріст 19: every page of the Growth line outside the product's
 * shell — a friend's link and a card's page under `/r/…`, the partner Terms under `/promo/…` — carries the real
 * Ryntra brand of `app/brand/`, and none draws a stand-in «R» of its own.
 */

/* Paths from the repository's root, wherever the test is started from. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const at = (path) => join(ROOT, path);
const read = (path) => readFileSync(path.startsWith(ROOT) ? path : at(path), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const FILES = [...walk(at("app/r")), ...walk(at("app/promo"))];
const PAGES = FILES.filter((path) => /page\.tsx$/.test(path));

test("the Growth line has public pages under /r and /promo, and each draws the public header", () => {
  assert.ok(PAGES.length >= 2, PAGES.join(", "));
  for (const page of PAGES) assert.match(strip(read(page)), /<PublicHeader\b/, `${page} draws the header that carries the brand`);
});

test("the header's logo is the brand's own artwork — the same files `app/brand` names", () => {
  const brand = read("app/brand/ryntra-brand.tsx");
  const sources = [...brand.matchAll(/src: "(\/brand\/ryntra-wordmark-(?:dark|light)\.svg)"/g)].map((match) => match[1]);
  assert.deepEqual(sources, ["/brand/ryntra-wordmark-dark.svg", "/brand/ryntra-wordmark-light.svg"]);
  const header = strip(read("app/site/frozen/public-header.tsx"));
  for (const src of sources) {
    assert.ok(header.includes(`src="${src}"`), `the header draws ${src}`);
    assert.ok(existsSync(at(join("public", src))), `${src} is shipped`);
  }
});

test("no page of the line draws a stand-in «R»", () => {
  for (const file of FILES) {
    const source = strip(read(file));
    assert.doesNotMatch(source, />\s*R\s*</, `${file} draws a letter R as a mark`);
    assert.doesNotMatch(source, /brandMark|logoBox|markBox/, `${file} draws a box for a mark`);
  }
  /* The card's picture draws the wordmark of `app/brand`, not a letter. */
  const scene = read("lib/growth/card-scene.ts");
  assert.match(scene, /ctx\.drawImage\(assets\.wordmark/);
});
