import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sitemapEntries as advertised } from "../../app/sitemap.ts";
import { AWAITING_CITY } from "../../city/lib/open/site-map.ts";
import {
  LEGAL_PACKAGE,
  legalPackageReady,
} from "./release.ts";

const read = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");

test("legal package fails closed until every fact, policy, privacy and digest-bound sign-off gate passes", () => {
  assert.equal(LEGAL_PACKAGE.status, "review-candidate");
  /* The version is shown on public pages: a date and a candidate number, never an internal id. */
  assert.match(LEGAL_PACKAGE.id, /^\d{4}-\d{2}-\d{2}-rc\d+$/);
  assert.equal(LEGAL_PACKAGE.verifiedThrough, "2026-09-26");
  assert.equal(LEGAL_PACKAGE.issuer.ryntraIssuerCountryDenylistEnabled, false);
  assert.equal(LEGAL_PACKAGE.issuer.ukraineVerified, false, "not verified until a lawyer says so");
  assert.equal(LEGAL_PACKAGE.issuer.counselReviewed, false);
  assert.equal(LEGAL_PACKAGE.ai.providerStoreDisabled, true);
  assert.equal(LEGAL_PACKAGE.ai.counselReviewed, false);
  assert.equal(LEGAL_PACKAGE.android.released, false);
  assert.equal(LEGAL_PACKAGE.contract.acceptanceMechanismApproved, false);
  assert.equal(LEGAL_PACKAGE.contract.languagePlanApproved, false);
  assert.equal(LEGAL_PACKAGE.privacy.lawfulBasesApproved, false);
  assert.equal(LEGAL_PACKAGE.privacy.dataSubjectRightsWorkflowApproved, false);
  assert.equal(LEGAL_PACKAGE.privacy.incidentResponseApproved, false);
  assert.equal(legalPackageReady(), false);
});

test("review candidate is isolated from published canonical legal routes and always noindex", async () => {
  const [
    canonicalTerms,
    canonicalPrivacy,
    rootLayout,
    reviewLayout,
    notice,
    reviewTerms,
    reviewPrivacy,
    reviewDisclosures,
    renderer,
  ] = await Promise.all([
    /* The published documents as data since CITY-157 (31.10): the city's pages at the same addresses draw them. */
    read("lib/legal/texts/terms.ts"),
    read("lib/legal/texts/privacy.ts"),
    read("app/seo.ts"),
    read("app/legal/review/layout.tsx"),
    read("app/legal/review-notice.tsx"),
    read("app/legal/review/terms/page.tsx"),
    read("app/legal/review/privacy/page.tsx"),
    read("app/legal/review/disclosures/page.tsx"),
    read("app/legal/review/candidate-document.tsx"),
  ]);
  const sitemapEntries = advertised([]);
  const sitemapUrls = sitemapEntries.map((entry) => entry.url);

  /* The published documents change only on a lawyer's word or the operator's:
     they keep their text and their one effective date. The privacy policy's
     moved to September 29, 2026 with its section on the Android app, added on
     2026-09-28. The terms' moved to October 5, 2026 with the Rewards rules 2.0.0
     (shares of the fee Ryntra received, the inviter's by rank), released on the
     operator's word that day. Both moved to October 7, 2026 on the operator's
     word: the app's two permissions and a launch's public content in the policy,
     the content rules a launch agrees to in the terms (the mobile line's
     requests 51 and 52). */
  assert.equal(canonicalTerms.match(/Effective date: October 7, 2026/g)?.length, 1);
  assert.equal(canonicalTerms.match(/Effective date:/g)?.length, 1, "one effective date, the latest revision's");
  assert.equal(canonicalPrivacy.match(/Effective date: October 7, 2026/g)?.length, 1);
  assert.equal(canonicalPrivacy.match(/Effective date:/g)?.length, 1, "one effective date, the latest revision's");
  assert.doesNotMatch(canonicalTerms + canonicalPrivacy, /Factual product-truth clarification|clarification date/i);
  assert.doesNotMatch(canonicalTerms + canonicalPrivacy, /review candidate/i);
  /* The published documents are offered to the index at their own addresses (`buildCityPageMetadata`). */
  assert.match(rootLayout, /robots: \{ index: path === own, follow: true \}/);
  assert.match(await read("app/legal/terms/page.tsx"), /buildCityPageMetadata\("terms", "\/legal\/terms"\)/);
  assert.match(await read("app/legal/privacy/page.tsx"), /buildCityPageMetadata\("privacy", "\/legal\/privacy"\)/);
  assert.match(reviewLayout, /index: false, follow: false/);
  assert.match(reviewLayout, /\/legal\/review\/terms/);
  assert.match(reviewLayout, /lang=\{locale\} dir="ltr"/);
  assert.match(notice, /not effective/i);
  assert.match(notice, /не чинний/);
  assert.doesNotMatch(notice, /legalPackageReady/);
  for (const [page, document] of [[reviewTerms, "CANDIDATE_TERMS"], [reviewPrivacy, "CANDIDATE_PRIVACY"], [reviewDisclosures, "CANDIDATE_DISCLOSURES"]]) {
    assert.ok(page.includes(`<CandidateDocument document={${document}} locale={locale} version={LEGAL_PACKAGE.id} />`), `${document} renders through the one candidate renderer`);
  }
  /* A table scrolls in its own labelled, focusable region, its caption read aloud. */
  assert.match(renderer, /tabIndex=\{0\}/);
  assert.match(renderer, /<caption className="sr-only">/);
  assert.match(renderer, /role="region"/);
  assert.ok(!sitemapUrls.some((url) => url.includes("/legal/review/")));
  /* The published texts stay at their addresses (a store listing and the law name them); the city draws them since
     CITY-157, so the Terms and the Privacy Policy are offered to the index — the drafts for signature never are. */
  assert.deepEqual(sitemapUrls.filter((url) => url.includes("/legal/")).sort(), ["https://ryntra.io/legal/privacy", "https://ryntra.io/legal/terms"]);
  assert.ok(AWAITING_CITY.includes("/legal/review/:path*"), "the drafts answer noindex");
});

test("canonical Terms state the Rewards programme from the ledger's own policy, and nothing of the retired venue", async () => {
  const terms = await read("lib/legal/texts/terms.ts");

  /* The rates are read from `lib/legal/texts/figures.ts` — the same policy the ledger accrues with, held equal to the
     documentation's facts by `legal.test.mjs` — never typed into the legal text. */
  assert.match(terms, /from "\.\/figures\.ts"/);
  assert.match(terms, /\$\{REWARDS\.cashbackPercent\}%/);
  assert.match(terms, /\$\{REWARDS\.referralL1Percent\}%/);
  assert.match(terms, /\$\{REWARDS\.referralL2Percent\}%/);
  assert.match(terms, /\$\{REWARDS\.claimFloorUsd\.toFixed\(2\)\}/);
  assert.match(terms, /\$\{FEES\.swap\}/);
  assert.match(terms, /\$\{FEES\.bridge\}/);
  assert.doesNotMatch(terms, /"[^"]*\b0\.(5|25)%[^"]*"|\b(50|10|5)% to the wallet/, "no rate is a literal");
  /* What the programme is, in the words the product uses. */
  assert.match(terms, /Only a fee\s+actually received by Ryntra is eligible/);
  assert.match(terms, /by that wallet’s rank when the\s+operation settled/);
  assert.match(terms, /paid in USDC on Solana/);
  assert.match(terms, /An inviter, once confirmed, cannot be changed/);
  assert.match(terms, /Points record activity[\s\S]*have no\s+cash value/);
  assert.match(terms, /makes no promises of tokens, airdrops, or monetary rewards/);
  /* The venue of the July text is gone from the product and from the Terms. */
  assert.doesNotMatch(terms, /Arcus|dYdX|trading key|paper trading|Risk & Strategy OS/i);
  assert.doesNotMatch(terms, /Beta Status/, "the July checklist gate is gone; the beta is open");
  assert.doesNotMatch(terms, /wherever (?:the )?link appears|may (?:earn|receive).*referral fees|Factual product-truth clarification/i);
});

test("canonical and product referral surfaces state unverified economics without unsupported payout claims", async () => {
  const productCopy = (await Promise.all([
    read("app/app/copy.ts"),
    read("lib/beta/texts.ts"),
    read("app/robinhood/workspace/swap/swap-terminal.tsx"),
    read("app/landing/content.ts"),
    read("lib/legal/texts/terms.ts"),
  ])).join("\n");

  const unsupportedClaims = [
    /participates in (?:the )?.*affiliate program/i,
    /may (?:earn|receive) (?:a )?referral fees?/i,
    /no routed compensation is enabled/i,
    /routed compensation is disabled/i,
    /може отримувати referral fees/i,
    /может получать реферальные комиссии/i,
    /puede recibir referral fees/i,
    /peut percevoir des commissions/i,
    /dapat menerima referral fee/i,
    /pode receber referral fees/i,
    /referral ücreti alabilir/i,
    /có thể nhận referral fee/i,
    /可能从.*获得推荐费用/i,
    /قد يتلقى.*رسوم إحالة/i,
    /리퍼럴 수수료를 받을 수 있습니다/i,
  ];
  for (const claim of unsupportedClaims) assert.doesNotMatch(productCopy, claim);

  assert.match(productCopy, /provider-supplied spot referral code/i);
  assert.match(productCopy, /recipient, economics, and control of any provider-supplied spot referral code are unverified/i);
  assert.match(productCopy, /current (?:product )?route supports no Ryntra-controlled/i);
});
