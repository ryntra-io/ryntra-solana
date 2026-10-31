// Run from repo root: node --test lib/site/security.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  BOUNDARIES,
  FORBIDDEN_ASSURANCE_WORDS,
  NO_AUDIT_STATEMENT,
  NO_AUDIT_STATEMENT_UK,
  SECURITY_ASSURANCE,
  SECURITY_AS_OF,
  SECURITY_REPORT_SUBJECT,
} from "./security.ts";
import { SECURITY_COPY, SECURITY_SECTION_IDS } from "../../app/security/security-copy.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

/* The page and its words, English and Ukrainian (since the new site the words are data beside the page). */
const PAGE_SOURCE = read("app/security/page.tsx");
const PAGE = [PAGE_SOURCE, read("app/security/security-copy.ts")].join("\n");
const DOCS = read("app/docs/page.tsx");
const CONFIG = read("next.config.ts");
const CHROME = read("app/site/frozen/public-footer.tsx");

test("the audit status is a fact in one module, not a sentence on a page", () => {
  /* Every product that has written "enterprise-grade security" on a page did it
     by letting the claim live in copy, where no test could see it. */
  assert.equal(SECURITY_ASSURANCE.independentAudit, null);
  assert.equal(SECURITY_ASSURANCE.bugBounty, null);
  assert.equal(SECURITY_ASSURANCE.dedicatedInbox, null);
  assert.equal(SECURITY_ASSURANCE.penetrationTest, null);
  assert.match(PAGE_SOURCE, /NO_AUDIT_STATEMENT/, "the page must render the statement, not retype it");
  assert.match(PAGE_SOURCE, /NO_AUDIT_STATEMENT_UK/, "and its Ukrainian, not retype it either");
  assert.doesNotMatch(
    PAGE,
    /has not completed an independent security audit/,
    "the sentence belongs to lib/site/security.ts so a copy edit cannot soften it",
  );
  /* And the sentence itself stays plain. The specification's own instruction —
     do not replace it with vague "enterprise-grade security" — is only kept if
     the wording is pinned, not merely centralised. */
  assert.equal(NO_AUDIT_STATEMENT, "Ryntra has not completed an independent security audit.");
  assert.equal(NO_AUDIT_STATEMENT_UK, "Ryntra не проходила незалежного аудиту безпеки.");
  assert.doesNotMatch(read("app/security/security-copy.ts"), /не проходила незалежного аудиту безпеки/, "the Ukrainian sentence lives in the module too");
});

test("the page never describes itself in vocabulary no evidence supports", () => {
  const body = PAGE.toLowerCase();
  const offenders = FORBIDDEN_ASSURANCE_WORDS.filter((word) => body.includes(word));
  assert.deepEqual(offenders, [], "each of these asserts assurance only an artifact can establish");
  /* "audited" and "certified" may appear only in the negative. */
  for (const match of PAGE.matchAll(/[^.]*\b(audited|certified)\b[^.]*\./g)) {
    assert.match(
      match[0],
      /\b(no|not|nothing|never)\b/i,
      `"${match[0].trim()}" claims a review that has not happened`,
    );
  }
});

test("no response time is promised, because none is staffed", () => {
  assert.doesNotMatch(PAGE, /within \d+ (hours|days|business days)|respond within|response time of/i);
  assert.match(PAGE, /no response-time commitment/i);
});

test("the boundary leads with what Ryntra cannot do", () => {
  assert.ok(BOUNDARIES.length >= 6);
  const firstCan = BOUNDARIES.findIndex((b) => b.kind === "can");
  const lastCannot = BOUNDARIES.map((b) => b.kind).lastIndexOf("cannot");
  assert.ok(
    lastCannot < firstCan,
    "every `cannot` must precede every `can` — a page that opens with capabilities answers the wrong question first",
  );
  for (const boundary of BOUNDARIES) {
    assert.ok(boundary.text.length > 40, boundary.text);
    assert.ok(boundary.uk.length > 40, boundary.uk);
  }
});

test("all twelve specified sections render, each with its own id", () => {
  const ids = [
    "model",
    "custody",
    "authorization",
    "credentials",
    "agents",
    "ai",
    "providers",
    "replay",
    "receipts",
    "data",
    "assurance",
    "report",
  ];
  assert.deepEqual([...SECURITY_SECTION_IDS], ids);
  /* Both languages carry the twelve in the specification's order; the page numbers them «1 ·» … «12 ·» and mounts each id. */
  for (const locale of ["en", "uk"]) {
    assert.deepEqual(SECURITY_COPY[locale].sections.items.map((section) => section.id), ids, `${locale} keeps the twelve in order`);
  }
  assert.match(PAGE_SOURCE, /id: section\.id,/, "each disclosure mounts its section's id");
  assert.match(PAGE_SOURCE, /number: `\$\{index \+ 1\} ·`/, "each section keeps its number so the twelve stay findable");
});

test("the report route carries the subject that sorts it", () => {
  assert.equal(SECURITY_REPORT_SUBJECT, "Security Report");
  assert.match(PAGE_SOURCE, /contactMailto\(SECURITY_REPORT_SUBJECT\)/);
  assert.doesNotMatch(PAGE, /mailto:/, "the address comes from lib/site/contacts.ts");
  /* The two instructions that protect the reporter rather than us. */
  assert.match(PAGE, /never send a seed phrase or a private key/i);
  assert.match(PAGE, /do not test against other people/i);
});

test("the boundary carries the date it was checked", () => {
  assert.match(SECURITY_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(PAGE_SOURCE, /SECURITY_AS_OF/, "a security statement with no observation date describes no moment");
});

test("/security is a page again, and the cached 308 still lands somewhere true", () => {
  assert.ok(existsSync(new URL("app/security/page.tsx", root)));
  assert.doesNotMatch(
    CONFIG,
    /source: "\/security"/,
    "the redirect is gone; the route serves the page",
  );
  /* Reversing a 308 does not un-cache it, so the Handbook still has to send a
     reader onward. When `/docs` became a hub the pointer moved from a chapter
     into the documentation tree, where the whole navigation carries it. */
  const tree = readFileSync(new URL("app/docs/nav.ts", root), "utf8");
  assert.match(tree, /href: "\/security"/, "documentation must reach the page that replaced the chapter");
  /* The claims moved rather than being copied. Two places stating one boundary
     is how they start disagreeing. */
  assert.ok(!DOCS.includes("non-extractable"), "the full boundary text belongs to /security only");
});

/*
 * The row left the footer on 2026-08-20 and the anchor still may not come back.
 *
 * The public site's design fixes the footer at four columns and puts
 * `Security` in none of them — security is routed through Docs, and the Trust
 * block on the landing links to `/docs#security` for exactly that reason. What
 * this test was built to stop is narrower than the row: the footer once pointed
 * a reader at an anchor inside a chapter instead of at the page, and a cached
 * 308 meant that anchor went nowhere. So the assertion inverts rather than
 * disappears — no Security row, and if one ever returns it may not return as an
 * anchor. `/security` stays indexable and in the sitemap, which the next test
 * still proves.
 */
test("security remains a direct page without expanding the approved footer", () => {
  assert.doesNotMatch(CHROME, /footerSecurity/);
  assert.doesNotMatch(CHROME, /href: "\/security"/);
  assert.doesNotMatch(CHROME, /\/docs#security/);
});

test("/security keeps its address, out of the sitemap and the index until the city draws it (CITY-159)", async () => {
  assert.match(PAGE_SOURCE, /path: "\/security"/);
  const { sitemapEntries } = await import("../../app/sitemap.ts");
  const { AWAITING_CITY } = await import("../../city/lib/open/site-map.ts");
  assert.ok(!sitemapEntries().some((entry) => entry.url.endsWith("/security")), "not offered to the index while it is the old page");
  assert.ok(AWAITING_CITY.includes("/security"), "it answers noindex until the city's About window takes it over (CITY-157)");
});
