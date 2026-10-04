// Run from repo root: node --test app/company/company.test.mjs
//
// «Про Ryntra» and «Контакти» — two public pages of the site,
// their words as data in both languages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPANY_COPY } from "./company-copy.ts";
import { CONTACT_COPY } from "../contact/contact-copy.ts";
import { CONTACTS, PRIMARY_CONTACT_ACTIONS } from "../../lib/site/contacts.ts";
import { FEES, FEES_UK, REWARDS } from "../docs/content/facts.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const code = (body) => body.replace(/\/\*[\s\S]*?\*\//g, "");
const COMPANY_PAGE = code(read("app/company/page.tsx"));
const CONTACT_PAGE = code(read("app/contact/page.tsx"));
const LOCALES = ["en", "uk"];
const words = (value) => JSON.stringify(value);

test("About answers again, in the page's own words, with the one chrome", () => {
  /* It led into the app from 2026-09-26 until the public pages came back. */
  assert.doesNotMatch(read("next.config.ts"), /source: "\/company"/);
  assert.match(COMPANY_PAGE, /<InfoPage locale=\{locale\}>/);
  assert.match(COMPANY_PAGE, /path: "\/company"/);
  assert.match(COMPANY_PAGE, /CONTACTS\.founder\.name/);
  assert.match(COMPANY_PAGE, /FOUNDER_ACTIONS/);
  assert.equal(COMPANY_COPY.en.meta.title, "About Ryntra — who builds it and how it earns");
  assert.equal(COMPANY_COPY.uk.meta.title, "Про Ryntra — хто будує і як заробляє");
  for (const locale of LOCALES) {
    assert.ok(COMPANY_COPY[locale].meta.title.length <= 60, `${locale} title`);
    assert.ok(COMPANY_COPY[locale].meta.description.length <= 160, `${locale} description`);
  }
});

test("About says what production does, and the one fee, from the policy the product charges with", () => {
  assert.equal(COMPANY_COPY.en.what.tiles.length, COMPANY_COPY.uk.what.tiles.length);
  assert.equal(COMPANY_COPY.en.rules.items.length, COMPANY_COPY.uk.rules.items.length);
  assert.equal(COMPANY_COPY.en.earns.rows.length, COMPANY_COPY.uk.earns.rows.length);
  const en = words(COMPANY_COPY.en);
  const uk = words(COMPANY_COPY.uk);
  assert.ok(en.includes(`${FEES.swap} of a purchase or a swap`));
  assert.ok(uk.includes(`${FEES_UK.swap} суми купівлі чи обміну`));
  assert.ok(en.includes(`${REWARDS.cashbackPercent}% of the fee Ryntra collects`));
  /* No rate is typed into the copy: it is read from the policy (`FEES`, `REWARDS`). */
  assert.doesNotMatch(code(read("app/company/company-copy.ts")), /"[^"]*\b0\.(5|25)%[^"]*"|"[^"]*\b(50|10|5)% (of|від)[^"]*"/);
  /* The retired line and the old story are gone; no team, partner or performance claim. */
  for (const text of [en, uk]) {
    assert.doesNotMatch(text, /Trade with a plan|Торгуйте за планом|strategy cycle|Ideas, My strategies|workspace|кабінет/i);
    assert.doesNotMatch(text, /advisory board|official partner|guaranteed|risk-free|profit promise|гарантован|без ризику/i);
    assert.doesNotMatch(text, /RYN-[A-Z0-9-]+|docs\/tasks|MASTER-PLAN|canon|readiness|founder action/i);
    assert.doesNotMatch(text, /coming soon|being built|Будуємо|Скоро|у планах|незабаром/i, "no roadmap outside the landing");
  }
});

test("Contact is one inbox, three subjects that sort it, and no promise of a response time", () => {
  assert.doesNotMatch(code(read("app/contact/contact-copy.ts")), /access|integrations|доступ|інтеграц/i, "the contact page offers no «access» and no «integrations»");
  assert.match(CONTACT_PAGE, /<InfoPage locale=\{locale\} quietHeaderAction>/, "the letter is the one orange action");
  assert.match(CONTACT_PAGE, /PRIMARY_CONTACT_ACTIONS/);
  assert.match(CONTACT_PAGE, /contactMailto\(topic\.subject\)/);
  assert.deepEqual(PRIMARY_CONTACT_ACTIONS.map((action) => action.href), ["mailto:" + CONTACTS.email, CONTACTS.companyX]);
  for (const locale of LOCALES) {
    const copy = CONTACT_COPY[locale];
    const subjects = copy.topics.items.map((topic) => topic.subject);
    assert.deepEqual(subjects, ["Product", "Purchase", "Security Report"]);
    assert.match(copy.send.never, /seed phrase|сід-фраз/);
    assert.doesNotMatch(words(copy), /within \d+|respond within|протягом \d+/i);
    assert.ok(copy.meta.description.length <= 160);
  }
  assert.equal(CONTACT_COPY.en.hero.email, "Email Ryntra");
  assert.equal(CONTACT_COPY.uk.hero.email, "Написати Ryntra");
  assert.doesNotMatch(CONTACT_PAGE, /<form|<input|<textarea/, "the page is form-free");
});

test("the Ukrainian of both pages speaks as the app does — «ти», never «ви»", () => {
  const FORMAL = /(?<![\p{L}'’])(?:ви|вас|вам|вами|ваш|ваша|ваше|ваші|вашого|вашої|вашу)(?![\p{L}'’])/iu;
  const PLURAL_IMPERATIVE = /(?<![\p{L}'’])[\p{L}'’]{3,}(?:йте|іть|ьте)(?![\p{L}'’])/u;
  for (const copy of [COMPANY_COPY.uk, CONTACT_COPY.uk]) {
    assert.doesNotMatch(words(copy), FORMAL);
    assert.doesNotMatch(words(copy), PLURAL_IMPERATIVE);
  }
});
