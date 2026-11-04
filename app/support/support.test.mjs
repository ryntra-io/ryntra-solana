import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { ANDROID_PRIVACY, ANDROID_SECTION_ID } from "../../lib/legal/texts/android.ts";
import { privacyPolicy } from "../../lib/legal/texts/privacy.ts";
import { termsOfUse } from "../../lib/legal/texts/terms.ts";
import { CONTACTS } from "../../lib/site/contacts.ts";
import { CONTACT_COPY } from "../contact/contact-copy.ts";
import { DOC_PAGES, docsHref } from "../docs/content/index.ts";
import { sitemapEntries } from "../sitemap.ts";
import { AWAITING_CITY } from "../../city/lib/open/site-map.ts";
import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { hasUkAddress, localizedPath } from "../../lib/site/localized.ts";
import { SUPPORT_COPY, SUPPORT_PRIVACY_ANDROID } from "./support-copy.ts";

/*
 * The store's two addresses (the mobile line's request 27): `/support` in both
 * languages and the privacy policy's section on the Android app in both — each
 * saying only what production has and what the phone's code does.
 */

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const LOCALES = ["en", "uk"];

/** Where a site path is served from, so a link on the page can be proved to land. */
function pageExists(href) {
  const path = href.split("#")[0];
  if (path.startsWith("/docs/")) return DOC_PAGES.some((page) => page.slug && docsHref(page.slug) === path);
  return existsSync(new URL(`app${path}/page.tsx`, root));
}

test("the support page reads the same in both languages and every door it opens is a page that exists", () => {
  const [en, uk] = LOCALES.map((locale) => SUPPORT_COPY[locale]);
  assert.equal(en.answers.items.length, 4);
  assert.deepEqual(uk.answers.items.map((item) => item.href), en.answers.items.map((item) => item.href));
  assert.equal(uk.android.items.length, en.android.items.length);
  assert.equal(uk.helps.items.length, en.helps.items.length);
  /* Nothing the shipped app cannot do yet: phone notifications wait for the push configuration. */
  assert.doesNotMatch(JSON.stringify([en.android, uk.android]), /notification|сповіщ/i);
  for (const item of en.answers.items) assert.ok(pageExists(item.href), `${item.href} has no page`);
  assert.ok(pageExists(SUPPORT_PRIVACY_ANDROID), "the privacy policy answers");
  assert.ok(SUPPORT_PRIVACY_ANDROID.endsWith(`#${ANDROID_SECTION_ID}`), "the phone's facts open at their section");
  for (const locale of LOCALES) {
    const copy = SUPPORT_COPY[locale];
    assert.ok(copy.meta.title.length <= 60, `${locale} title`);
    assert.ok(copy.meta.description.length <= 160, `${locale} description`);
    /* One inbox sorted by /contact's own subjects — the two pages cannot name a topic differently. */
    assert.deepEqual(copy.write.topics, CONTACT_COPY[locale].topics.items);
    assert.equal(copy.helps.never, CONTACT_COPY[locale].send.never);
  }
});

test("the Ukrainian words address the reader without a gendered past tense", () => {
  const text = JSON.stringify([SUPPORT_COPY.uk, ANDROID_PRIVACY.uk]);
  /* `\b` does not see Cyrillic letters as a word, so the edges are letters by property. */
  assert.doesNotMatch(text, /(?<!\p{L})(?:знайшов|знайшла|робив|робила|ввімкнув|ввімкнула|купив|купила|під'єднав|під'єднала)(?!\p{L})/u);
});

test("the privacy policy's Android section says what stays on the phone, the wallet's address and the push token only when turned on", () => {
  const [en, uk] = LOCALES.map((locale) => ANDROID_PRIVACY[locale]);
  assert.equal(uk.items.length, en.items.length);
  assert.match(en.heading, /^2\. The Ryntra app for Android$/);
  assert.match(uk.heading, /^2\. Застосунок Ryntra для Android$/);
  const words = JSON.stringify(en);
  assert.match(words, /public address of the wallet you connect/);
  assert.match(words, /secure storage/);
  assert.match(words, /only when you turn phone notifications on/);
  assert.match(words, /While they are off, no push token is sent to Ryntra/);
  assert.match(words, /changes to your plans/);
  assert.match(words, /Google Firebase Cloud Messaging/);
  assert.equal(en.pointer, null, "an English reader needs no pointer");
  assert.ok(uk.pointer, "a Ukrainian reader of the English policy is shown where the section is");
  /* The published policy as data (CITY-157: the city's page draws it): the section second, in the reader's language,
     numbered in order, and the processor named where the processors are. */
  for (const locale of LOCALES) {
    const policy = privacyPolicy(locale);
    assert.equal(policy.sections[1].id, ANDROID_SECTION_ID);
    assert.equal(policy.sections[1].lang, locale);
    assert.deepEqual(policy.sections.map((section) => Number.parseInt(section.heading, 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }
  const processors = JSON.stringify(privacyPolicy().sections.find((section) => section.id === "processed"));
  assert.match(processors, /\{"strong":"Google Firebase Cloud Messaging"\}/);
});

test("the privacy policy's Android section names the two permissions, the photo picker and a launch's public content (request 51)", () => {
  const [en, uk] = LOCALES.map((locale) => JSON.stringify(ANDROID_PRIVACY[locale]));
  for (const words of [en, uk]) {
    assert.match(words, /\(CAMERA\)/);
    assert.match(words, /\(POST_NOTIFICATIONS\)/);
  }
  assert.match(en, /Camera \(CAMERA\)/);
  assert.match(en, /Notifications \(POST_NOTIFICATIONS\)/);
  assert.match(en, /scan a wallet address or a payment QR code/);
  assert.match(en, /take a picture for a token you launch/);
  assert.match(en, /reminders and the state of your operations/);
  assert.match(en, /system photo picker/);
  assert.match(en, /with no permission to your photos or files/);
  assert.match(en, /picture, name, ticker, description and links of a token you launch become public together with the token/);
  assert.match(uk, /Камера \(CAMERA\)/);
  assert.match(uk, /Сповіщення \(POST_NOTIFICATIONS\)/);
  assert.match(uk, /системному вікні вибору фото/);
  assert.match(uk, /Картинка, назва, тікер, опис і посилання токена, який ти запускаєш, стають публічними/);
  /* The old line the phone outgrew cannot come back. */
  assert.doesNotMatch(en + uk, /one permission|один дозвіл|location, camera|геолокації, камери/);
});

test("the Terms carry the content rules a launch agrees to, in both languages (request 52)", async () => {
  const { LAUNCH_TERMS, LAUNCH_SECTION_ID } = await import("../../lib/legal/texts/launch.ts");
  const [en, uk] = LOCALES.map((locale) => LAUNCH_TERMS[locale]);
  assert.match(en.heading, /^10\. Tokens you launch$/);
  assert.match(uk.heading, /^10\. Токени, які ти запускаєш$/);
  assert.equal(uk.forbidden.length, en.forbidden.length);
  assert.equal(uk.after.length, en.after.length);
  const words = JSON.stringify(en);
  for (const rule of [/impersonation/, /hateful/, /sexual content/, /violent/, /a scam/, /breaks the law/]) assert.match(words, rule);
  assert.match(words, /may hide its picture, description and links on Ryntra's pages/);
  assert.match(JSON.stringify(uk), /може сховати його картинку, опис і посилання/);
  assert.equal(en.pointer, null);
  assert.ok(uk.pointer);
  /* The published Terms as data (CITY-157): the section tenth, in the reader's language, the report going to the inbox. */
  for (const locale of LOCALES) {
    const terms = termsOfUse(locale);
    const launch = terms.sections[9];
    assert.equal(launch.id, LAUNCH_SECTION_ID);
    assert.equal(launch.lang, locale);
    const report = launch.blocks.at(-1);
    assert.equal(report.kind, "p");
    assert.deepEqual(report.line[1], { link: CONTACTS.email, href: `mailto:${CONTACTS.email}` });
    assert.deepEqual(terms.sections.map((section) => Number.parseInt(section.heading, 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  }
  assert.match(JSON.stringify(termsOfUse().intro), /the Ryntra app for Android/);
  assert.equal(LAUNCH_SECTION_ID, "launch");
});

test("both pages are in the footer, the support page at both of its addresses; out of the sitemap until the city draws them", () => {
  assert.ok(hasUkAddress("/support"));
  assert.equal(localizedPath("/support", "uk"), "/uk/support");
  assert.equal(localizedPath("/legal/privacy", "uk"), "/legal/privacy", "the policy has one address; the cookie keeps the language");
  /* Both stay at their addresses (the Android app's store listing names them) and are the city's pages since CITY-157:
     offered to the index in English, never held out as old pages. */
  const urls = sitemapEntries().map((entry) => entry.url);
  for (const url of ["https://ryntra.io/support", "https://ryntra.io/legal/privacy"]) assert.ok(urls.includes(url), `${url} is offered to the index`);
  assert.ok(!urls.includes("https://ryntra.io/uk/support"), "one address per page in the sitemap");
  assert.ok(!AWAITING_CITY.includes("/support") && !AWAITING_CITY.some((source) => source === "/legal/:path*"), "they no longer answer noindex");
  for (const locale of LOCALES) {
    const hrefs = HOMEPAGE_COPY[locale].footer.legal.map((link) => link.href);
    assert.ok(hrefs.includes("/legal/privacy") && hrefs.includes("/support"), `${locale} footer`);
  }
  assert.match(read("app/site/frozen/public-footer.tsx"), /href=\{localizedPath\(item\.href, locale\)\}/);
});
