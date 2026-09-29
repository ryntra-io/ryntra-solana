import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sitemapEntries as advertised } from "../../app/sitemap.ts";
import {
  LEGAL_CONTENT_FILES,
  LEGAL_PACKAGE,
  legalPackageReady,
} from "./release.ts";
import { CANDIDATE_DOCUMENTS, CANDIDATE_PRIVACY, CANDIDATE_TERMS, candidateText } from "./candidate.ts";
import { needsDevelopmentRepository } from "../development-repository.mjs";

const read = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");

async function computeContentDigest() {
  const hash = createHash("sha256");
  for (const file of LEGAL_CONTENT_FILES) {
    const normalized = (await read(file)).replace(/\r\n/g, "\n");
    hash.update(file + "\n", "utf8");
    hash.update(normalized, "utf8");
    hash.update("\n", "utf8");
  }
  return "sha256:" + hash.digest("hex");
}

test("legal package fails closed until every fact, policy, privacy and digest-bound sign-off gate passes", () => {
  assert.equal(LEGAL_PACKAGE.status, "review-candidate");
  /* The version is shown on public pages: a date and a candidate number, never an internal id. */
  assert.match(LEGAL_PACKAGE.id, /^\d{4}-\d{2}-\d{2}-rc\d+$/);
  assert.equal(LEGAL_PACKAGE.verifiedThrough, "2026-09-26");
  assert.equal(LEGAL_PACKAGE.issuer.ryntraIssuerCountryDenylistEnabled, false);
  assert.equal(LEGAL_PACKAGE.issuer.ukraineVerified, false, "canon §13: not verified until a lawyer says so");
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
    read("app/legal/terms/page.tsx"),
    read("app/legal/privacy/page.tsx"),
    read("app/legal/layout.tsx"),
    read("app/legal/review/layout.tsx"),
    read("app/legal/review-notice.tsx"),
    read("app/legal/review/terms/page.tsx"),
    read("app/legal/review/privacy/page.tsx"),
    read("app/legal/review/disclosures/page.tsx"),
    read("app/legal/review/candidate-document.tsx"),
  ]);
  const sitemapEntries = advertised([]);
  const sitemapUrls = sitemapEntries.map((entry) => entry.url);

  /* The published documents change only on a lawyer's word (the plan of the new
     site, decision 7) or the Owner's: they keep their text and their one
     effective date. The privacy policy's moved to September 29, 2026 with its
     section on the Android app, on the Owner's word of 2026-09-28
     (`RYN-MOBILE-STORE-001`). */
  assert.equal(canonicalTerms.match(/Effective date: September 14, 2026/g)?.length, 1);
  assert.equal(canonicalPrivacy.match(/Effective date: September 29, 2026/g)?.length, 1);
  assert.equal(canonicalPrivacy.match(/Effective date:/g)?.length, 1, "one effective date, the latest revision's");
  assert.doesNotMatch(canonicalTerms + canonicalPrivacy, /Factual product-truth clarification|clarification date/i);
  assert.doesNotMatch(canonicalTerms + canonicalPrivacy, /review candidate/i);
  assert.match(rootLayout, /index: true, follow: true/);
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
  assert.ok(sitemapUrls.includes("https://ryntra.io/legal/terms"));
  assert.ok(sitemapUrls.includes("https://ryntra.io/legal/privacy"));
});

test("the candidate describes the product of today, in both languages, with the Android app", { skip: needsDevelopmentRepository("the legal candidate under docs/legal/") }, async () => {
  const [signoff, dataMap] = await Promise.all([
    read("docs/legal/CANDIDATE-2026-09-26-SIGNOFF.md"),
    read("docs/legal/CANDIDATE-2026-09-26-DATA-MAP.md"),
  ]);
  for (const document of CANDIDATE_DOCUMENTS) {
    assert.ok(document.sections.length >= 5, `${document.id} is thin`);
    for (const section of document.sections) {
      for (const block of section.blocks) {
        if ("list" in block) assert.equal(block.list.en.length, block.list.uk.length, `${document.id}#${section.id}: the languages list different items`);
        if ("table" in block) assert.equal(block.table.rows.en.length, block.table.rows.uk.length, `${document.id}#${section.id}: the tables differ`);
      }
    }
    for (const locale of ["en", "uk"]) {
      const text = candidateText(document, locale);
      /* Nothing of the July candidate's venue, issuer or preview survives, and nothing internal is shown. */
      assert.doesNotMatch(text, /Arcus|Robinhood Assets|RHJ|Strategy Lab|paper|Permit2|MAX_UINT256|RYN-[A-Z0-9-]+|canon|WIP/i, `${document.id} (${locale})`);
      /* No promise the product cannot keep (canon §5.5, B.15). */
      assert.doesNotMatch(text, /guarantee(?!s nothing)|risk-free|passive income|гарантован|безпечн|пасивн/iu, `${document.id} (${locale}) promises what it cannot`);
    }
    /* Ukrainian speaks as the app does: «ти», never «ви». */
    assert.doesNotMatch(candidateText(document, "uk"), /(?<![\p{L}'’])(?:ви|вас|вам|ваш|ваша|ваше|ваші)(?![\p{L}'’])/iu, `${document.id} (uk) says «ви»`);
  }
  const privacy = candidateText(CANDIDATE_PRIVACY, "en");
  for (const fact of ["Mobile Wallet Adapter", "Firebase Cloud Messaging", "push token", "OpenAI", "never the address itself", "Webacy", "Neon", "Supabase", "up to a day"]) {
    assert.ok(privacy.includes(fact), `the candidate privacy names «${fact}»`);
  }
  assert.ok(candidateText(CANDIDATE_PRIVACY, "uk").includes("Mobile Wallet Adapter"));
  const terms = candidateText(CANDIDATE_TERMS, "en");
  assert.match(terms, /only schedules reminders/);
  assert.match(terms, /not the share itself/);
  assert.match(terms, /no tool to buy, sell, send or sign/);
  assert.match(signoff, /Promotion is manual/i);
  assert.match(signoff, /contentDigest/);
  assert.match(dataMap, /store: false/);
  assert.match(dataMap, /no erasure endpoint|No account-erasure endpoint/i);
});

test("canonical Terms state the Rewards programme from the ledger's own policy, and nothing of the retired venue", async () => {
  const terms = await read("app/legal/terms/page.tsx");

  /* The rates are read from `app/docs/content/facts.ts` — the same policy the
     ledger accrues with — never typed into the legal text. */
  assert.match(terms, /from "@\/app\/docs\/content\/facts"/);
  assert.match(terms, /\{REWARDS\.cashbackPercent\}%/);
  assert.match(terms, /\{REWARDS\.referralL1Percent\}%/);
  assert.match(terms, /\{REWARDS\.referralL2Percent\}%/);
  assert.match(terms, /\{REWARDS\.claimFloorUsd\.toFixed\(2\)\}/);
  assert.match(terms, /\{FEES\.swap\}/);
  assert.match(terms, /\{FEES\.bridge\}/);
  assert.doesNotMatch(terms, /"[^"]*\b0\.(5|25)%[^"]*"|\b(50|10|5)% to the wallet/, "no rate is a literal");
  /* What the programme is, in the words the product uses. */
  assert.match(terms, /Only a fee actually collected by\s+Ryntra is eligible/);
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
    read("app/legal/terms/page.tsx"),
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

test("recorded legal content digest matches every signable and review-isolation artifact", { skip: needsDevelopmentRepository("the legal candidate under docs/legal/") }, async () => {
  assert.match(LEGAL_PACKAGE.contentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(LEGAL_PACKAGE.contentDigest, await computeContentDigest());
});
