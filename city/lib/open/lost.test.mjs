import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { LOST } from "../../components/open/words.ts";
import { LANGS } from "../i18n/langs.ts";
import { pick } from "../art/frames.ts";
import { LOST_CODE, LOST_FRAME, LOST_HOME, LOST_KINDS, LOST_MARK, LOST_SIZES } from "./lost.ts";

/* CITY-159: an address that never was and a page that broke are the city's own pages — the island, one line, one way
   back — never the framework's bare 404 and 500 on the old root. */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

const LOST_PAGE = read("city/components/open/Lost.tsx");
const LOST_STYLE = read("city/components/open/lost.module.css");
const ROUTES = { "app/not-found.tsx": "missing", "app/error.tsx": "broken", "app/global-error.tsx": "broken" };

test("the 404, the 500 and the root's own 500 are the city's page", () => {
  for (const [path, kind] of Object.entries(ROUTES)) {
    const source = read(path);
    assert.match(source, /from "@\/city\/components\/open\/Lost"/, `${path} shows the city's page`);
    assert.match(source, new RegExp(`<Lost kind="${kind}" />`), `${path} is the ${kind} kind`);
  }
  /* Next draws error pages in the browser: both are client components; the root's brings its own document. */
  for (const path of ["app/error.tsx", "app/global-error.tsx"]) assert.match(read(path), /^"use client";/, `${path} is a client component`);
  assert.match(read("app/global-error.tsx"), /<html lang="en"[^>]*>[\s\S]*<body/);
  /* Never offered to the index; a shared link to it carries the city's card. */
  const notFound = read("app/not-found.tsx");
  assert.match(notFound, /robots: \{ index: false, follow: false \}/);
  assert.match(notFound, /openGraph: city\.openGraph/);
  assert.match(read("app/global-error.tsx"), /<meta name="robots" content="noindex, nofollow" \/>/);
});

test("one line and one way back: to the city's home, nothing else to press", () => {
  assert.equal(LOST_HOME, "/");
  assert.equal((LOST_PAGE.match(/<a\b/g) ?? []).length, 1, "one link");
  assert.doesNotMatch(LOST_PAGE, /<button\b/, "no second control");
  assert.match(LOST_PAGE, /href=\{LOST_HOME\}/);
  assert.equal((LOST_PAGE.match(/<h1\b/g) ?? []).length, 1, "one heading");
  assert.doesNotMatch(LOST_PAGE, /<p\b(?![^>]*s\.code)/, "no paragraph of explanation under the line");
  assert.deepEqual([...LOST_KINDS], ["missing", "broken"]);
  assert.deepEqual(LOST_CODE, { missing: "404", broken: "500" });
  assert.match(LOST_PAGE, /\{\.\.\.marked\}/, `the page carries ${LOST_MARK}, which the walk reads`);
});

test("the words are the city's, in both languages, short", () => {
  assert.deepEqual(Object.keys(LOST).sort(), [...LANGS].sort());
  assert.equal(LOST.en.toCity, "To the city");
  assert.equal(LOST.uk.toCity, "До міста");
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(LOST[lang])) {
      assert.ok(value.length <= 32, `${lang}.${key} is one short line («${value}»)`);
      assert.doesNotMatch(value, /404|500|error|engine|api|route|stack|digest|помилк[аи] сервера/i, `${lang}.${key} says nothing technical`);
    }
  }
});

test("the frame behind it is filmed from the live city, and the look is the brandbook's", () => {
  for (const file of LOST_FRAME.files) {
    assert.match(file.src, /^\/city\/art\/district-[a-z]+-\d+\.webp$/, "a district frame from the live scene, not a generated city");
    assert.ok(existsSync(join(REPO, "public", file.src)), `${file.src} is in the build`);
  }
  /* The frame covers the screen: a tall phone draws it far wider than the screen, so it gets the wide file, sharp. */
  assert.equal(LOST_SIZES, "max(100vw, 178vh)");
  assert.equal(pick(LOST_FRAME.files, Math.max(390, 844 * LOST_FRAME.ratio) * 2).width, 1600, "a phone at 2× takes the 1600 file");
  assert.equal(pick(LOST_FRAME.files, Math.max(1440, 900 * LOST_FRAME.ratio)).width, 1600, "a desk takes the 1600 file");
  assert.match(LOST_PAGE, /sizes=\{LOST_SIZES\}/);
  assert.match(LOST_STYLE, /var\(--warm\), var\(--amber\)/, "the one amber action");
  assert.match(LOST_STYLE, /var\(--font-display/, "Hubot Sans for the big words");
  assert.match(LOST_STYLE, /height: 56px/, "a thumb's height");
  assert.match(LOST_STYLE, /html\.city-lang-wait/, "the words wait for the person's language, as the city's do");
});

test("nothing of the old interface is on it", () => {
  const sources = [LOST_PAGE, LOST_STYLE, read("city/components/open/words.ts"), read("city/lib/open/lost.ts"), ...Object.keys(ROUTES).map(read)];
  for (const source of sources) {
    assert.doesNotMatch(source, /from ["'](?:@\/)?(?:components|app\/app|app\/shell|app\/brand|app\/site|app\/solana)\//, "no import from the old interface");
    assert.doesNotMatch(source, /@ryntra\/core|ryntra-wordmark|ryntra-brand|ry-mark-grad|#FF681C|--ry-/i, "no old brand, shell or token");
  }
});
