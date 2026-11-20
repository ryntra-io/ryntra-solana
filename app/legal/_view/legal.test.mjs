// Run from repo root: node --test app/legal/_view/legal.test.mjs
//
// The legal documents in the terminal: every page of `/legal` stands in the terminal's frame at its own
// address, draws the documents' words from where they are kept and owns none of them, takes nothing of the old
// interface, and the terminal leads to the Terms and the Privacy Policy from «More» and from About.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { LEGAL_WORDS, candidateDoors, publishedDoors } from "./words.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path) => existsSync(new URL(path, ROOT));

/** Every page of `/legal`, found on disk. */
function pages(dir = fileURLToPath(new URL("app/legal/", ROOT)), out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (name === "page.tsx") out.push(path.slice(fileURLToPath(ROOT).length).split("\\").join("/"));
  }
  return out.sort();
}

const VIEWS = ["app/legal/_view/LegalPage.tsx", "app/legal/_view/PublishedView.tsx", "app/legal/_view/LicencesView.tsx", "app/legal/review/candidate-document.tsx"];
const OLD = /@\/components\/|@\/app\/site\/|@\/app\/app\/|app\/solana\/workspace|CityDocument|city\/components\/pages|PublicHeader|FrozenFooter/;

test("every page of /legal is the terminal's, at the address it always had", () => {
  assert.deepEqual(pages(), [
    "app/legal/licenses/page.tsx",
    "app/legal/privacy/page.tsx",
    "app/legal/review/disclosures/page.tsx",
    "app/legal/review/privacy/page.tsx",
    "app/legal/review/terms/page.tsx",
    "app/legal/terms/page.tsx",
  ]);
  assert.ok(!exists("app/legal/(frozen)"), "the old legal shell is gone");
  assert.ok(!exists("app/legal/layout.tsx"), "no layout over the published documents");
  for (const page of ["app/legal/terms/page.tsx", "app/legal/privacy/page.tsx", "app/legal/licenses/page.tsx"]) {
    const source = read(page);
    assert.match(source, /<TerminalFrame>/, `${page} stands in the terminal's frame`);
    assert.match(source, /export const dynamic = "force-static"/, `${page} is built once`);
    assert.doesNotMatch(source, OLD, `${page} takes nothing of the old interface`);
  }
  assert.match(read("app/legal/terms/page.tsx"), /<PublishedView id="terms" \/>/);
  assert.match(read("app/legal/privacy/page.tsx"), /<PublishedView id="privacy" \/>/);
  assert.match(read("app/legal/licenses/page.tsx"), /<LicencesView en=\{<ChartLicenses lang="en" \/>\} uk=\{<ChartLicenses lang="uk" \/>\} \/>/);
  const review = read("app/legal/review/layout.tsx");
  assert.match(review, /return <TerminalFrame>\{children\}<\/TerminalFrame>;/);
  assert.match(review, /robots: \{ index: false, follow: false \}/, "the drafts stay out of the index");
});

test("the pages draw the documents' words and own none of them", () => {
  for (const file of VIEWS) {
    const source = read(file);
    assert.match(source, /from "@\/terminal\/ui"|from "\.\/LegalPage"|from "\.\.\/_view\/LegalPage"/, `${file} is made of the terminal's kit`);
    assert.doesNotMatch(source, OLD, `${file} takes nothing of the old interface`);
  }
  const published = read("app/legal/_view/PublishedView.tsx");
  assert.match(published, /termsOfUse\(lang\) : privacyPolicy\(lang\)/, "the published texts, in the reader's language as published");
  assert.match(published, /heading: section\.heading/);
  assert.match(published, /date=\{doc\.effective\}/);
  // Not one sentence of a document is written into a view: every string a view prints is a word of the table.
  for (const file of VIEWS) {
    const literals = [...read(file).matchAll(/>\s*([A-Za-zА-Яа-яІіЇїЄєҐґ][^<>{}]{12,})\s*</g)].map((m) => m[1].trim());
    assert.deepEqual(literals, [], `${file} writes words of its own`);
  }
  const candidate = read("app/legal/review/candidate-document.tsx");
  assert.match(candidate, /document\.title\[lang\]/);
  assert.match(candidate, /<LegalReviewNotice locale=\{lang\} className=\{l\.notice\} \/>/, "the draft's notice, as written");
});

test("the words around the documents: both languages the same, short, no word of the city", () => {
  assert.deepEqual(Object.keys(LEGAL_WORDS.uk).sort(), Object.keys(LEGAL_WORDS.en).sort());
  for (const lang of ["en", "uk"]) {
    for (const [key, word] of Object.entries(LEGAL_WORDS[lang])) {
      assert.ok(word.trim() && word.length <= 40, `${lang}.${key}: «${word}»`);
      assert.doesNotMatch(word, /\bcity\b|tower|місто|міст[аі]\b|веж|квартал/i, `${lang}.${key}: a word of the city`);
    }
  }
});

test("every document beside a document is a page that answers", () => {
  for (const lang of ["en", "uk"]) {
    const w = LEGAL_WORDS[lang];
    for (const here of ["terms", "privacy", "licences"]) {
      const doors = publishedDoors(w, here);
      assert.equal(doors.filter((door) => door.current).length, 1, `${here}: one is in view`);
      for (const door of doors) assert.ok(exists(`app${door.href}/page.tsx`), door.href);
    }
    for (const here of ["terms", "privacy", "disclosures"]) {
      const doors = candidateDoors(w, here);
      assert.equal(doors.filter((door) => door.current).length, 1, `review ${here}: one is in view`);
      for (const door of doors) assert.ok(exists(`app${door.href}/page.tsx`), door.href);
    }
  }
});

test("the terminal leads to the Terms and the Privacy Policy: «More», and the foot of About", async () => {
  const more = read("terminal/shell/More.tsx");
  assert.match(more, /\{ href: '\/legal\/terms', word: 'terms' \}/);
  assert.match(more, /\{ href: '\/legal\/privacy', word: 'privacy' \}/);
  const { SHELL } = await import("../../../terminal/shell/words.ts");
  assert.equal(SHELL.en.terms, "Terms");
  assert.equal(SHELL.uk.terms, "Умови");
  assert.equal(SHELL.en.privacy, "Privacy");
  assert.equal(SHELL.uk.privacy, "Приватність");
  const about = read("app/about/_view/AboutView.tsx");
  assert.match(about, /<Link href="\/legal\/terms" className=\{b\.inlineLink\}>\s*\{w\.terms\}/);
  assert.match(about, /<Link href="\/legal\/privacy" className=\{b\.inlineLink\}>\s*\{w\.privacy\}/);
});

test("the look is the terminal's: tokens only, its corners, its spacing scale", () => {
  const css = read("app/legal/_view/legal.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i, "a colour written as a number");
  assert.doesNotMatch(css, /border-radius/, "a corner of its own");
  const scale = new Set([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40]);
  for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:padding|margin|gap)(?:-[a-z-]+)?)\s*:\s*([^;]+);/g)) {
    for (const [, n] of value.matchAll(/-?(\d+(?:\.\d+)?)px/g)) assert.ok(scale.has(Number(n)), `${prop}: ${value} — ${n}px is off the scale`);
  }
});
