import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PUBLIC_COPY } from "./public-copy.ts";
import { publicEcosystemEntries } from "./public-ecosystems.ts";
import { PUBLIC_LANGUAGES, PUBLIC_LOCALES, PUBLIC_LOCALE_COOKIE } from "./locale.ts";
import { HOMEPAGE_COPY, siteMenu } from "./homepage-copy.ts";
import { localizedPath } from "./localized.ts";
import { GITHUB_ORGANIZATION_URL, PUBLIC_REPOSITORIES } from "./contacts.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

function keysOf(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

test("public copy has EN/UA parity", () => {
  assert.deepEqual(keysOf(PUBLIC_COPY.en), keysOf(PUBLIC_COPY.uk));
  assert.notEqual(PUBLIC_COPY.uk.heroLine1, PUBLIC_COPY.en.heroLine1);
  assert.equal(PUBLIC_COPY.en.navHome, "Ryntra Home");
  assert.equal(PUBLIC_COPY.uk.navHome, "Ryntra Home");
  assert.equal(PUBLIC_COPY.en.navAgents, "Agent Control");
  assert.equal(PUBLIC_COPY.uk.flowSteps.length, PUBLIC_COPY.en.flowSteps.length);
});

test("the public locale cookie keeps the name the Hub reads", () => {
  /* The Hub asserts on its side that it reads this same cookie; the public
     site pins the name and imports nothing of the Hub. */
  assert.equal(PUBLIC_LOCALE_COOKIE, "ryntra_hub_locale");
});

test("the public ecosystem projection is registry-built and carries one network", () => {
  const entries = publicEcosystemEntries();
  /* Solana alone since 2026-09-04, when Robinhood Chain, Stellar and the
     other networks were taken out of the active public product story by
     turning off their `publicEntry`, which is a flag rather than a deletion:
     every workspace, adapter, route and piece of evidence stays where it is
     and opens by direct URL. The assertion used to require a
     network that has since left to be in this list; requiring its absence
     would be the same mistake in reverse, so what is pinned is the one network
     the product actually runs on. */
  assert.deepEqual(entries.map((row) => row.href), ["/solana/workspace"]);
  for (const row of entries) {
    assert.ok(row.href.endsWith("/workspace") || row.href.includes("/workspace"), row.id);
    assert.notEqual(row.maturity, "research", row.id);
    assert.ok(row.description.en.length > 0 && row.description.uk.length > 0, row.id);
  }
  const menu = read("app/site/frozen/eco-menu.tsx");
  assert.doesNotMatch(menu, /FAMILIES = \[/);
  assert.match(menu, /publicEcosystemEntries/);
});

test("footer GitHub is the organization, not an evidence repository", () => {
  assert.equal(GITHUB_ORGANIZATION_URL, "https://github.com/ryntra-io");
  for (const repository of Object.values(PUBLIC_REPOSITORIES)) {
    assert.notEqual(GITHUB_ORGANIZATION_URL, repository);
  }
  const footer = read("app/site/frozen/public-footer.tsx");
  assert.match(footer, /GITHUB_ORGANIZATION_URL/);
  assert.doesNotMatch(footer.replace(/\/\*[\s\S]*?\*\//g, ""), /Beta bot/);
  assert.doesNotMatch(footer, /Request beta/);
  assert.doesNotMatch(read("app/site/frozen/chrome.tsx"), /FLAGSHIP/);
});

test("the homepage keeps the landing's design in the new site's words, its new blocks in the same design", () => {
  /* The new site (2026-09-26): the landing's hero, orbit, workflow and
     Rewards stay, with the new words; «Автоінвест», what you buy, the phone,
     security, where Ryntra is today and the questions join them in the same
     design; the same chrome as every public page. */
  const page = read("app/(home)/homepage.tsx");
  assert.match(page, /<PublicHeader locale=\{locale\} mainId="main-content" landing ctaTone="quiet" languageHrefs=\{LANDING_PATH\}/);
  assert.match(page, /<FrozenFooter locale=\{locale\} landing \/>/);
  const order = [...page.matchAll(/<(Hero|Universe|Workflow|AutoinvestSection|WhatYouBuy|OnYourPhone|Security|Today|Questions|Rewards) locale=\{locale\} \/>/g)].map((match) => match[1]);
  assert.deepEqual(order, ["Hero", "Universe", "Workflow", "AutoinvestSection", "WhatYouBuy", "OnYourPhone", "Security", "Today", "Questions", "Rewards"]);
  for (const kept of ["hero.tsx", "universe.tsx", "workflow.tsx", "rewards.tsx"]) {
    assert.ok(existsSync(new URL(`../../app/(home)/${kept}`, import.meta.url)), `${kept}: the landing's block stays`);
  }
  assert.doesNotMatch(page, /BetaProvider|Request beta/);
});

test("public header carries the site's one menu — the product's ways in, the documentation, the statistics and Open the app — on every page", () => {
  /* The documentation's Product · Documentation pair is gone; every public
     page's bar is the landing's menu in the reader's language, with the
     language menu and the theme switch beside the button. */
  const header = read("app/site/frozen/public-header.tsx");
  assert.match(header, /import \{ siteMenu, type SiteMenu \} from "@\/lib\/site\/homepage-copy";/);
  assert.doesNotMatch(header, /function NavLinks|copy\.navProduct|copy\.navDocs|href="\/app"/);
  assert.doesNotMatch(header, /navBusiness|navForAgents|navProductMap|solana\/workspace/);
  const links = [...header.matchAll(/<MenuLinks menu=\{menu\} pathname=\{pathname\}( stacked)? \/>/g)];
  assert.equal(links.length, 2, "the menu across the bar and again in the sheet");
  /* Since the new site (2026-09-26) the doors are the product's own —
     Markets, Bots (named as the app's menu names it since SOL-C15; «Autoinvest» before) and Rewards (the fee back and the referrals) — with
     the documentation and the statistics; the button opens the app at Home,
     the first of the five places, in the landing's own words. */
  /* Each door at the address of the reader's language where the page has one. */
  const HREFS = {
    en: ["/app/markets", "/app/bots", "/app/rewards", "/docs", "/stats"],
    uk: ["/uk/app/markets", "/app/bots", "/app/rewards", "/uk/docs", "/uk/stats"],
  };
  for (const locale of ["en", "uk"]) {
    const menu = siteMenu(locale);
    assert.deepEqual(menu.links.map((item) => item.href), HREFS[locale]);
    assert.deepEqual(
      menu.links,
      HOMEPAGE_COPY[locale].footer.links.map((link) => ({ ...link, href: localizedPath(link.href, locale) })),
      "the bar and the footer are one list",
    );
    assert.equal(menu.open.href, locale === "uk" ? "/uk/app/home" : "/app/home");
    assert.equal(menu.open.label, HOMEPAGE_COPY[locale].open);
  }
  assert.match(read("app/site/frozen/public-footer.tsx"), /href=\{localizedPath\(item\.href, locale\)\}/, "the footer takes the same addresses");
  assert.deepEqual([HOMEPAGE_COPY.en.open, HOMEPAGE_COPY.uk.open], ["Open the app", "Відкрити застосунок"]);
  /* The language control is a menu of every public language, not a pair:
     the list is `PUBLIC_LANGUAGES`, each language by its own name. */
  const localeMenu = header.slice(header.indexOf("function LocaleMenu"), header.indexOf("function ThemeControl"));
  assert.match(localeMenu, /aria-haspopup="menu"/);
  assert.match(localeMenu, /\{PUBLIC_LANGUAGES\.map\(\(language\) => \{/);
  assert.match(localeMenu, /role="menuitemradio"/);
  assert.match(localeMenu, /lang=\{language\.locale\}/);
  assert.doesNotMatch(localeMenu, /langEn|langUa|data-on=/);
  assert.deepEqual(PUBLIC_LANGUAGES.map(({ locale, code, name }) => [locale, code, name]), [["en", "EN", "English"], ["uk", "UA", "Українська"]]);
  assert.deepEqual(PUBLIC_LANGUAGES.map((language) => language.locale), [...PUBLIC_LOCALES], "one switch: app/i18n/locales.ts");
});

test("public chrome has no Request beta, Open free beta, or FLAGSHIP-only mark", () => {
  const files = [
    "app/site/frozen/chrome.tsx",
    "app/site/frozen/public-header.tsx",
    "app/(home)/homepage.tsx",
    "app/(home)/landing-copy.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /Request beta|Open free beta|Beta bot|FLAGSHIP/);
  }
});

test("a class shared by an anchor and a button declares its own background", () => {
  /* The Share control on the public Passport is a real `<button>` wearing
     `.ghost`, a class written when only anchors used it. An anchor with no
     `background` rule is transparent; a button with no `background` rule paints
     the user agent's `buttonface` grey, so the two rendered as different
     controls side by side for one revision. The fix is one declaration and the
     regression is invisible to every check that reads markup rather than
     pixels, which is why it is pinned here. */
  const css = read("app/product/product.module.css");
  /* Every rule whose selector list carries `.ghost`, joined — the class is
     declared twice on purpose (shared geometry, then its own skin) and the
     question is what the element ends up with, not which block says it. */
  const block = css
    .split("}")
    .filter((chunk) => /(^|,|\n)\s*\.ghost\s*(,|\{)/.test(chunk))
    .join("\n");
  assert.match(block, /background:/, ".ghost must declare a background because a <button> wears it");
  assert.match(block, /cursor:\s*pointer/, "a button styled as a link still needs the pointer");
});
