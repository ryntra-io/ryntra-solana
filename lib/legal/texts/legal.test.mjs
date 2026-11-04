import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ANDROID_SECTION_ID } from "./android.ts";
import { LEGAL_FEES, LEGAL_REWARDS } from "./figures.ts";
import { LAUNCH_SECTION_ID } from "./launch.ts";
import { documentLines } from "./model.ts";
import { privacyPolicy } from "./privacy.ts";
import { termsOfUse } from "./terms.ts";

/* CITY-157: the Terms and the Privacy Policy move into the city's look with their words exactly as published (effective
   7 October 2026). `published/*.txt` is the text the old pages rendered, line by line, in English and with a Ukrainian
   reader's sections; the documents as data must read the same, word for word. A change to the wording is a legal
   change and goes through its own reviewed task — this test then changes with it, on purpose. */

const published = (name) =>
  readFileSync(new URL(`./published/${name}.txt`, import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const norm = (line) => line.replace(/\s+/g, " ").trim();

for (const [name, doc] of [
  ["terms.en", termsOfUse("en")],
  ["terms.uk", termsOfUse("uk")],
  ["privacy.en", privacyPolicy("en")],
  ["privacy.uk", privacyPolicy("uk")],
]) {
  test(`${name}: the document reads exactly as published`, () => {
    assert.deepEqual(documentLines(doc).map(norm), published(name).map(norm));
  });
}

test("each section has its own anchor; the store's and the launch's anchors stay", () => {
  for (const doc of [termsOfUse(), privacyPolicy(), termsOfUse("uk"), privacyPolicy("uk")]) {
    const ids = doc.sections.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, `${doc.id}: anchors are unique`);
    for (const id of ids) assert.match(id, /^[a-z][a-z-]*$/, `${doc.id}: ${id} is an anchor`);
  }
  assert.ok(termsOfUse().sections.some((section) => section.id === LAUNCH_SECTION_ID));
  assert.ok(privacyPolicy().sections.some((section) => section.id === ANDROID_SECTION_ID));
  assert.equal(termsOfUse("uk").sections.find((section) => section.id === LAUNCH_SECTION_ID)?.lang, "uk", "the launch section follows a Ukrainian reader");
  assert.equal(privacyPolicy("uk").sections.find((section) => section.id === ANDROID_SECTION_ID)?.lang, "uk", "the Android section follows a Ukrainian reader");
  assert.equal(termsOfUse().sections.length, 16);
  assert.equal(privacyPolicy().sections.length, 10);
});

test("the figures in the Terms are the ones the product charges and accrues with", async () => {
  const { FEES, REWARDS } = await import("../../../app/docs/content/facts.ts");
  assert.equal(LEGAL_FEES.swap, FEES.swap);
  assert.equal(LEGAL_FEES.bridge, FEES.bridge);
  assert.equal(LEGAL_REWARDS.cashbackPercent, REWARDS.cashbackPercent);
  assert.equal(LEGAL_REWARDS.referralL1Percent, REWARDS.referralL1Percent);
  assert.equal(LEGAL_REWARDS.referralL2Percent, REWARDS.referralL2Percent);
  assert.equal(LEGAL_REWARDS.claimFloorUsd, REWARDS.claimFloorUsd);
  assert.equal(LEGAL_REWARDS.rankWindowDays, REWARDS.rankWindowDays);
});

test("the documents link only to their own anchors, each other, the site and the inbox", () => {
  for (const doc of [termsOfUse(), privacyPolicy(), termsOfUse("uk"), privacyPolicy("uk")]) {
    const anchors = new Set(doc.sections.map((section) => `#${section.id}`));
    const blocks = [...doc.intro, ...doc.sections.flatMap((section) => section.blocks)];
    const lines = blocks.flatMap((block) => (block.kind === "p" ? [block.line] : block.items));
    for (const run of lines.flat()) {
      if (typeof run === "string" || !("href" in run)) continue;
      const ok = anchors.has(run.href) || run.href === "/legal/privacy" || run.href === "https://ryntra.io" || run.href.startsWith("mailto:");
      assert.ok(ok, `${doc.id}: ${run.href}`);
    }
  }
});
