import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../../../lib/development-repository.mjs";

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");

const PAGE = read("app/app/connect/page.tsx");
const CENTER = read("app/app/connect/connection-center.tsx");
const CARD = read("app/app/connect/connection-card.tsx");
const CONTEXT = read("app/app/connect/investor-context-form.tsx");
const COPY = read("app/app/connect/copy.ts");
const CSS = read("app/app/connect/connection-center.module.css");
const OVERVIEW = read("app/solana/workspace/holdings/holdings-card.tsx");
const SUMMARY = read("app/app/overview/financial-twin-summary.tsx");
const DESIGN_CHECK = inDevelopmentRepository ? read("scripts/design-check.mjs") : "";

test("the page gates the account and the venue credential independently", () => {
  assert.match(PAGE, /if \(!session\) \{/);
  assert.doesNotMatch(PAGE, /if \(!session\?\.verified\) \{/);
  assert.match(PAGE, /homeLocalOwnerRef\(\{/);
  assert.match(PAGE, /<ConnectionCenter/);
  assert.match(PAGE, /canManageVenue=\{session\.verified\}/);
  assert.match(CENTER, /canManageVenue \? [\s\S]*<ConnectFlow/);
  assert.match(CENTER, /<WalletSignIn[\s\S]*action="link"/);
});

test("one operating surface makes all trust planes and connection families visible", () => {
  for (const plane of ["IDENTITY", "READ_ONLY_DATA", "EXACT_ACTION_AUTHORITY"]) {
    assert.match(CENTER, new RegExp(`data-plane=["']${plane}["']`));
  }
  for (const section of ["wallets", "venues", "watch-only", "financial-twin"]) {
    assert.match(CENTER, new RegExp(`id=["']${section}["']`));
  }
  assert.match(CENTER, /projectFinancialTwin/);
  assert.match(CENTER, /EXACT_ACTION_ONLY/);
  assert.doesNotMatch(CENTER, /SIGN_TX|ALLOW_BY_CONNECTION|AUTO_EXECUTE/);
});

test("browser state is owner-bound, parsed, persisted and recoverable", () => {
  assert.match(CENTER, /`ryntra\.home\.v1\.\$\{ownerRef\}`/);
  assert.match(CENTER, /parseHomeLocalEnvelope/);
  assert.match(CENTER, /encodeHomeLocalEnvelope/);
  assert.match(CENTER, /localStorage\.getItem/);
  assert.match(CENTER, /localStorage\.setItem/);
  assert.match(CENTER, /localStorage\.removeItem/);
  assert.match(CENTER, /window\.dispatchEvent\(new CustomEvent\(HOME_LOCAL_EVENT/);
  assert.match(CENTER, /storageState === "DEGRADED"/);
  assert.match(CENTER, /storageState === "UNAVAILABLE"/);
});

test("watch-only records have real add, duplicate, cap and revoke UI", () => {
  assert.match(CENTER, /addWatchConnection/);
  assert.match(CENTER, /revokeConnection/);
  assert.match(CENTER, /copy\.watch\.errors\[result\.error\]/);
  assert.match(COPY, /DUPLICATE_ACTIVE_CONNECTION/);
  assert.match(COPY, /CONNECTION_LIMIT_REACHED/);
  assert.match(CARD, /record\.ownership/);
  assert.match(CARD, /record\.authority/);
  assert.match(CARD, /record\.scopes/);
  assert.match(CARD, /onRevoke/);
});

test("InvestorContext is versioned by the domain contract and preserves no-op truth", () => {
  assert.match(CONTEXT, /createInvestorContextVersion/);
  assert.match(CONTEXT, /UNCHANGED_CONTEXT/);
  assert.match(CONTEXT, /missingInvestorContextFields/);
  assert.match(CONTEXT, /declaredBy/);
  assert.match(CONTEXT, /version/);
  assert.match(CONTEXT, /onCommit: \(history: readonly InvestorContextVersion\[\]\) => boolean/);
  assert.match(CONTEXT, /saveState === "UNAVAILABLE"/);
  assert.doesNotMatch(CONTEXT, /country|jurisdiction|eligibilityResult|recommendationResult/);
});

test("Connection Center copy is complete in every cabinet locale", () => {
  assert.match(COPY, /Record<BetaLang, ConnectionCenterCopy>/);
  for (const locale of ["en", "uk", "ru"]) assert.match(COPY, new RegExp(`\\b${locale}: \\{`));
  for (const phrase of ["Identity", "Read-only data", "Exact action authority", "Financial Twin"] ) {
    assert.match(COPY, new RegExp(phrase, "i"));
  }
});

test("the new surface stays inside the frozen design system and mobile contract", { skip: needsDevelopmentRepository("the design lint scripts/design-check.mjs") }, () => {
  assert.match(DESIGN_CHECK, /"app\/app\/connect"/);
  assert.match(CSS, /min-height:\s*44px/);
  assert.match(CSS, /@media \(max-width:/);
  assert.match(CSS, /var\(--rt-/);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(CSS, /linear-gradient|radial-gradient|backdrop-filter/);
  assert.doesNotMatch(CENTER + CARD + CONTEXT, /style=\{\{/);
});

test("the retained Financial Twin remains owner-scoped without replacing the overview", () => {
  /* The source stays available to the legacy connection flow, but the overview
     — Portfolio, since Home was folded into it — reports the connected
     wallet through the shared read provider instead. */
  assert.doesNotMatch(OVERVIEW, /<FinancialTwinSummary/);
  assert.match(OVERVIEW, /useWalletData\(\)/);
  assert.match(SUMMARY, /parseHomeLocalEnvelope/);
  assert.match(SUMMARY, /projectFinancialTwin/);
  assert.match(SUMMARY, /event instanceof StorageEvent/);
  assert.match(SUMMARY, /event\.key === storageKey/);
  assert.match(SUMMARY, /\}, \[ownerRef, readTwin, storageKey\]\);/);
  assert.match(SUMMARY, /href="\/app\/connect"/);
  assert.doesNotMatch(SUMMARY, /portfolioValue|netWorth|riskVerdict/);
});
