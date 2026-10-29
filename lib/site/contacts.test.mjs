// Run from repo root: node --test lib/site/contacts.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import {
  CONTACTS,
  CONTACT_ROUTES,
  FOUNDER_ACTIONS,
  ORGANIZATION_PROFILES,
  PRIMARY_CONTACT_ACTIONS,
  PUBLIC_REPOSITORIES,
  REPOSITORY_URL,
  contactMailto,
} from "./contacts.ts";
import { siteFooter } from "./homepage-copy.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const CONTACT_PAGE = read("app/contact/page.tsx");
const CHROME = read("app/site/frozen/public-footer.tsx");
const PRIVACY = read("app/legal/privacy/page.tsx");

/**
 * Every source file whose bytes can reach a public visitor.
 *
 * Walked rather than listed: the defect this suite exists to prevent is a
 * contact literal appearing in a file nobody thought to add to a list, which is
 * exactly how the retired Telegram channel survived in `sameAs` long after it
 * left every visible surface.
 */
function sourceFiles() {
  const out = [];
  const skip = new Set(["node_modules", ".next", ".git", "docs", "reports", "output", "examples"]);
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, root))) {
      if (skip.has(entry) || entry.startsWith(".")) continue;
      const rel = dir + entry;
      if (statSync(new URL(rel, root)).isDirectory()) walk(rel + "/");
      else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(rel);
    }
  };
  for (const top of ["app/", "lib/", "packages/"]) if (existsSync(new URL(top, root))) walk(top);
  return out;
}

const SOURCES = sourceFiles();

/**
 * The file with its comments removed.
 *
 * An address quoted in a comment explaining why the rule exists is prose about
 * the rule, not a second source of truth — and the parked chrome's own comment
 * quotes the exact `mailto:` this suite forbids. Stripping is crude on purpose:
 * a false negative costs nothing a reviewer would not catch, and a real parser
 * would be more machinery than the check is worth.
 */
const code = (body) =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

test("the retired public Telegram channel is gone from every source file", () => {
  /* This suite names the string in its own failure message. */
  const offenders = SOURCES.filter(
    (path) => path !== "lib/site/contacts.test.mjs" && code(read(path)).includes("t.me/Ryntra_io"),
  );
  assert.deepEqual(
    offenders,
    [],
    "t.me/Ryntra_io is retired from public copy. It must not return — including in JSON-LD, in a parked chrome, or in a comment.",
  );
});

test("the admin access list is not mistaken for a contact and deleted with it", () => {
  /* `@Ryntra_io` is the bootstrap fallback for admin operators. It looks like
     the retired public contact and it is a different fact; deleting it would
     lock the bootstrap admin out before `admin_operators` exists. */
  const beta = read("lib/beta/types.ts");
  assert.match(beta, /channelHandle: "@Ryntra_io"/);
  assert.doesNotMatch(beta, /channel: "https:\/\/t\.me/);
});

test("no public surface writes a contact identity as a literal", () => {
  const literals = [
    CONTACTS.email,
    CONTACTS.betaBot,
    CONTACTS.companyX,
    CONTACTS.founder.x,
    CONTACTS.founder.linkedin,
    REPOSITORY_URL,
    /* Added 2026-08-19 with the Developer Platform. The other two public
       repositories were being spelled by hand — the Agent Control one already
       was, in `app/developers/agent-control/page.tsx`, and the platform hub
       would have added two more. Three repository literals is the same defect
       six address literals were, one identifier later. */
    PUBLIC_REPOSITORIES.agentControl,
    PUBLIC_REPOSITORIES.solanaEvidence,
  ];
  /* The beta flow owns the bot as an access control rather than as a contact and
     its Telegram handlers address it directly; the legal review documents are
     historical records of a reviewed text and are never rewritten; and a test
     that pins exact copy has to be allowed to write the copy it pins. */
  const allowed =
    /(^lib\/site\/contacts\.ts$|\.test\.mjs$|^lib\/beta\/|^lib\/telegram\/|^app\/api\/telegram\/|^app\/admin\/|^app\/legal\/review\/|^app\/demo\/|^app\/app\/)/;

  const offenders = [];
  for (const path of SOURCES) {
    if (allowed.test(path)) continue;
    const body = code(read(path));
    for (const literal of literals) {
      if (body.includes(literal)) offenders.push(path + " -> " + literal);
    }
  }
  assert.deepEqual(offenders, [], "Import from lib/site/contacts.ts instead of writing the address.");
});

test("the organization claims only profiles Ryntra posts from", () => {
  assert.deepEqual([...ORGANIZATION_PROFILES], [CONTACTS.companyX]);
  /* The founder's personal accounts are reachable from `/contact`. Asserting
     them as `sameAs` would claim a person is the company. */
  assert.ok(!ORGANIZATION_PROFILES.includes(CONTACTS.founder.x));
  assert.match(read("app/layout.tsx"), /sameAs: \[\.\.\.ORGANIZATION_PROFILES\]/);
});

test("every contact route sets a subject, and the subjects are distinct", () => {
  assert.equal(CONTACT_ROUTES.length, 5);
  const subjects = [];
  for (const route of CONTACT_ROUTES) {
    assert.ok(route.actions.length >= 1, route.id + " has no action");
    for (const action of route.actions) {
      assert.ok(action.label.length > 0);
      assert.ok(!action.label.includes("http"), "a control label is never a URL");
      if (!action.href.startsWith("mailto:")) continue;
      const subject = new URL(action.href).searchParams.get("subject");
      assert.ok(subject, route.id + " sends an unsorted email");
      subjects.push(subject);
    }
  }
  assert.equal(new Set(subjects).size, subjects.length, "two routes sort into the same subject");
  assert.ok(subjects.includes("Security Report"));
});

test("contactMailto encodes the subject", () => {
  assert.equal(
    contactMailto("Partnership / Integration"),
    "mailto:" + CONTACTS.email + "?subject=Partnership%20%2F%20Integration",
  );
  assert.equal(contactMailto(), "mailto:" + CONTACTS.email);
});

test("the contact page renders from the module and offers no form", () => {
  assert.match(CONTACT_PAGE, /PRIMARY_CONTACT_ACTIONS/);
  assert.doesNotMatch(CONTACT_PAGE, /<form|<input|<textarea/, "V1 is deliberately form-free");
  assert.doesNotMatch(CONTACT_PAGE, /CONTACT_ROUTES|FOUNDER_ACTIONS/, "the footer destination stays concise");
  /* No staffed inbox means no promised response time. */
  assert.doesNotMatch(CONTACT_PAGE, /within \d+ (hours|business days)|respond within/i);
});

test("the hero and the founder card offer their fixed labels", () => {
  assert.deepEqual(
    PRIMARY_CONTACT_ACTIONS.map((a) => a.label),
    ["Email Ryntra", "Ryntra on X"],
  );
  assert.deepEqual(
    FOUNDER_ACTIONS.map((a) => a.label),
    ["Founder on X", "LinkedIn"],
  );
  assert.equal(CONTACTS.founder.name, "Dmytro Plavutskyi");
});

test("the footer carries the site's one list — the ways in and the public statistics, the two accounts, the legal pair", () => {
  /* One footer on every page, the landing's, read from the same copy as the
     header's menu; no destination is spelled in the component. */
  assert.deepEqual([...CHROME.matchAll(/href: "(\/[^"]*)"/g)], []);
  assert.match(CHROME, /const footer = siteFooter\(locale\);/);
  const hrefs = [...siteFooter("en").links, ...siteFooter("en").legal].map((item) => item.href);
  /* Since the new site (2026-09-26): Markets, Bots («Autoinvest» until SOL-C15 named it as the menu does) and Rewards, the documentation and the statistics;
     since 2026-09-29 the support page beside the legal pair — the Android app's store listing names both. */
  assert.deepEqual(hrefs, ["/app/markets", "/app/bots", "/app/rewards", "/docs", "/stats", "/legal/terms", "/legal/privacy", "/support"]);
  assert.deepEqual(siteFooter("uk").links.map((item) => item.href), siteFooter("en").links.map((item) => item.href));
  assert.match(CHROME, /GITHUB_ORGANIZATION_URL/);
  assert.match(CHROME, /CONTACTS\.companyX/);
  assert.doesNotMatch(CHROME, /footerSecurity|footerX|navProductMap|navDevelopers/);

  for (const href of hrefs.filter((item) => item.startsWith("/legal/") || item === "/docs" || item === "/support")) {
    const [path, anchor] = href.split("#");
    if (path === "/") continue;
    const page = "app" + path + "/page.tsx";
    assert.ok(existsSync(new URL(page, root)), href + " has no page at " + page);
    if (anchor) {
      assert.match(read(page), new RegExp('id="' + anchor + '"'), href + " points at a missing anchor");
    }
  }
});

test("the footer links no retained redirect", () => {
  const redirected = [...read("next.config.ts").matchAll(/source: "(\/[a-z-]+)"/g)].map((m) => m[1]);
  const hrefs = [...siteFooter("en").links, ...siteFooter("en").legal].map((item) => item.href.split("?")[0]);
  for (const href of hrefs) {
    assert.ok(
      !redirected.includes(href),
      href + " is a redirect in next.config.ts — link the destination, not the 308",
    );
  }
});

test("every external link in the chrome and the contact page is opener-safe", () => {
  for (const [name, body] of [
    ["chrome", CHROME],
    ["contact", CONTACT_PAGE],
  ]) {
    const blanks = [...body.matchAll(/target="_blank"/g)].length;
    const safe = [...body.matchAll(/rel="noopener noreferrer"/g)].length;
    assert.equal(blanks, safe, name + " has a _blank without rel");
  }
});

test("Privacy acknowledges account authentication and optional support correspondence", () => {
  assert.doesNotMatch(
    PRIVACY,
    /Email addresses — the Service has no email-collection forms/,
    "the policy denied collecting email while the site asked to be emailed",
  );
  assert.match(PRIVACY, /<strong>Correspondence and feedback<\/strong>/);
  /* Since 2026-09-11 the wallet is the account: no email, password or social
     sign-in is offered to a customer, and the policy says so rather than
     describing doors that are shut. Correspondence stays optional and real. */
  assert.doesNotMatch(PRIVACY, /no email sign-up/);
  assert.match(PRIVACY, /There is no\s+email, password or social sign-in for customers/);
  assert.match(PRIVACY, /<strong>Supabase<\/strong>/);
  assert.doesNotMatch(PRIVACY, /Arcus|paper trades|Supabase Auth|Resend|Google sign-in/);
});

test("the contact page is indexable and in the sitemap", () => {
  assert.match(CONTACT_PAGE, /path: "\/contact"/);
  assert.match(read("app/sitemap.ts"), /path: "\/contact"/);
});
