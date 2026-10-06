// Run from repo root: node --test app/docs/docs.test.mjs
//
// The documentation is data, and this suite is what makes that worth
// anything: both languages on every page, every figure the one the product
// computes with, every status the registry's, every link a page that
// answers, and none of the vocabulary that belongs inside the company.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { DEVELOPER_ENTRIES, DOC_NAV, DOC_PAGES, docNeighbours, docPageBySlug, docSearchText, docsHref } from "./content/index.ts";
import { FEES, JUPITER_ORDER_KEEPS_PERCENT, JUPITER_ORDER_MIN_FEE_BPS, POINTS, PRODUCT_PAGES, REWARDS, hrefOf, readinessOf } from "./content/facts.ts";
import { DOC_GROUP_IDS, DOC_PATH_PREFIXES } from "./content/model.ts";
import { PRODUCT_ROUTES } from "../shell/product-routes.ts";
import { MENU_SECTIONS, MENU_SECTION_IDS, PRODUCT_PAGE_IDS, drawn } from "../shell/domains.ts";
import { CUSTOMER_REDIRECTS } from "../../lib/product/customer-routing.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../../lib/swap/service-fee.ts";
import { FEE_POLICY_V2 } from "../../lib/core/fee-policy.ts";
import { REWARD_MINIMUM_CLAIM_USD_MICROS, USD_MICROS_PER_USD } from "../../lib/rewards/model.ts";
import { REWARD_RANKS, REWARD_RULES_CURRENT } from "../../lib/rewards/rules.ts";
import { JUPITER_REFERRAL_FEE_MIN_BPS, JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT } from "../../lib/solana/quotes.ts";
import { POINTS_POLICY_V1 } from "../../lib/points/policy.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const EXPERIENCE = read("app/docs/docs-experience.tsx");
const LOCALES = ["en", "uk"];

/** Every sentence a page carries, in one language. */
function textOf(page, locale) {
  return docSearchText(page, locale);
}

test("every page is complete in both languages and structurally identical across them", () => {
  /* 27 since 2026-09-24: the prediction demo left the surface, and its page left the documentation.
     33 since the site's redesign (2026-09-26): Invest's five pages, Top up, the screener and Ryntra, with
     the old Stocks page split among them and «Security and risk» become the Security page. */
  assert.ok(DOC_PAGES.length >= 33, `expected a full documentation set, got ${DOC_PAGES.length} pages`);
  const slugs = new Set();
  for (const page of DOC_PAGES) {
    assert.ok(!slugs.has(page.slug), `duplicate slug ${page.slug}`);
    slugs.add(page.slug);
    assert.match(page.slug, /^$|^[a-z]+(\/[a-z-]+)*$/, `${page.slug} is not a documentation path`);
    assert.ok(DOC_GROUP_IDS.includes(page.group), `${page.slug} has an unknown group`);
    /* A page keeps its address when it changes section (money/rewards under Rewards, strategies/* under Portfolio). */
    if (page.slug) assert.ok(DOC_PATH_PREFIXES.includes(page.slug.split("/")[0]), `${page.slug} lives outside every documentation path`);
    if (page.destination) assert.ok(page.destination === "agent" || MENU_SECTIONS[page.destination], `${page.slug} opens a place the menu does not have`);
    for (const locale of LOCALES) if (page.seoTitle) assert.ok(page.seoTitle[locale].length <= 60, `${page.slug} ${locale} search title is longer than 60`);
    for (const locale of LOCALES) {
      assert.ok(page.title[locale].length > 2, `${page.slug} has no ${locale} title`);
      assert.ok(page.summary[locale].length > 40, `${page.slug} has a thin ${locale} summary`);
      assert.match(page.summary[locale], /[.!?]$/u, `${page.slug} ${locale} summary is not a sentence`);
    }
    assert.ok(page.sections.length >= 1, `${page.slug} has no sections`);
    const ids = new Set();
    for (const section of page.sections) {
      assert.ok(!ids.has(section.id), `${page.slug} repeats section ${section.id}`);
      ids.add(section.id);
      for (const locale of LOCALES) assert.ok(section.heading[locale].length > 2, `${page.slug}#${section.id} has no ${locale} heading`);
      assert.ok(section.blocks.length >= 1, `${page.slug}#${section.id} is empty`);
      for (const block of section.blocks) {
        switch (block.kind) {
          case "p":
          case "note":
            for (const locale of LOCALES) assert.ok(block.text[locale].length > 40, `${page.slug}#${section.id} has a thin ${locale} ${block.kind}`);
            break;
          case "steps":
          case "list":
            assert.equal(block.items.en.length, block.items.uk.length, `${page.slug}#${section.id}: the two languages list a different number of items`);
            for (const locale of LOCALES) for (const item of block.items[locale]) assert.ok(item.length > 12, `${page.slug}#${section.id} has a thin ${locale} item`);
            break;
          case "facts":
            assert.equal(block.items.en.length, block.items.uk.length, `${page.slug}#${section.id}: the fact lists differ in length`);
            break;
          case "table":
            assert.equal(block.head.en.length, block.head.uk.length);
            assert.equal(block.rows.en.length, block.rows.uk.length, `${page.slug}#${section.id}: the tables differ in rows`);
            for (const locale of LOCALES) for (const row of block.rows[locale]) assert.equal(row.length, block.head[locale].length, `${page.slug}#${section.id}: a ${locale} row does not fit the head`);
            break;
          case "product-pages":
            break;
          case "links":
            assert.ok(block.items.length >= 1, `${page.slug}#${section.id} links nowhere`);
            for (const item of block.items) {
              assert.ok(existsSync(new URL(`app${item.href}/page.tsx`, root)), `${page.slug} links to ${item.href}, which has no page`);
              for (const locale of LOCALES) assert.ok(item.label[locale].length > 2, `${page.slug} has an unnamed ${locale} link`);
            }
            break;
          default:
            assert.fail(`${page.slug}#${section.id}: unknown block ${JSON.stringify(block)}`);
        }
      }
    }
    for (const related of page.related ?? []) {
      assert.ok(docPageBySlug(related), `${page.slug} relates to ${related}, which does not exist`);
      assert.notEqual(related, page.slug, `${page.slug} relates to itself`);
    }
  }
  assert.ok(slugs.has(""), "the hub (slug \"\") must exist");
});

test("every page the menu draws has its documentation, and a page that is not built has none", () => {
  /* Only what is built reaches a person (since 2026-09-23). A drawn page is
     documented as what it does today; a planned page is registered and
     documented nowhere — no «What Perps will be», no summary that says
     Planned — and its old address leads to a page that works. */
  for (const id of PRODUCT_PAGE_IDS) {
    const page = DOC_PAGES.find((item) => item.pageId === id && item.group !== "reference");
    const route = PRODUCT_ROUTES.find((row) => row.id === id);
    assert.equal(readinessOf(id), route.readiness);
    assert.equal(hrefOf(id), route.href);
    if (!drawn(route)) {
      /* A planned page, or one kept off the surface, is documented nowhere. */
      assert.equal(page, undefined, `${id} is not on the surface and still has a documentation page`);
      continue;
    }
    assert.ok(page, `product page ${id} has no documentation page`);
  }
  /* The table lists the pages the menu draws, section by section in the menu's order. */
  const drawnInMenuOrder = MENU_SECTION_IDS.flatMap((section) => MENU_SECTIONS[section].pages).filter((id) => drawn(PRODUCT_ROUTES.find((route) => route.id === id)));
  assert.deepEqual(PRODUCT_PAGES.map((page) => page.id), drawnInMenuOrder);
  assert.deepEqual([...new Set(PRODUCT_PAGES.map((page) => page.section))], ["markets", "trade", "bots", "portfolio", "money", "rewards"]);
  assert.equal(CUSTOMER_REDIRECTS.find((row) => row.source === "/docs/trade/predictions")?.destination, "/docs/start/cabinet", "the demo's documentation address leads to the cabinet page");
  const redirected = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row]));
  for (const [gone, to] of [["/docs/trade/perps", "/docs/trade/spot"], ["/docs/strategies/ideas", "/docs/strategies/overview"]]) {
    assert.equal(redirected.get(gone)?.destination, to, `${gone} must lead to ${to}`);
    assert.equal(redirected.get(gone)?.permanent, false, `${gone} is temporary: the page may come back when it is built`);
    assert.ok(docPageBySlug(to.replace("/docs/", "")), `${to} is not a documentation page`);
  }
  /* The cabinet page draws the registry table rather than retyping it. */
  const cabinet = docPageBySlug("start/cabinet");
  assert.ok(cabinet.sections.some((section) => section.blocks.some((block) => block.kind === "product-pages")));
  assert.match(EXPERIENCE, /case "product-pages"/);
  assert.match(EXPERIENCE, /PRODUCT_PAGES\.map/);
});

test("the documentation speaks only of what is built, and the page count follows the menu", () => {
  /* The drift this guards happened. Results and Stocks went live while their
     summaries still said *In development*, the FAQ still called Results
     planned, the strategy overview's table kept Results *In development*, and
     the cabinet counted fourteen pages after Predictions made fifteen. Since
     2026-09-23 no page says anything is coming at all: no *Planned*,
     *In development*, *Soon* or «згодом» anywhere a person reads the
     documentation. */
  const NOT_BUILT = {
    /* Case-sensitive on purpose: «what you planned», «the planned entry» and
       Predictions' «ending soon» are sentences about now, not labels. */
    en: /[Ii]n development|\bPlanned\b|being built|[Cc]oming soon|\bSoon\b|on the way|not built yet|in the future|will be (built|added|available)/,
    uk: /Розробляється|[Уу] розробці|Заплановано|заплановані|будуються|будується|Скоро|Незабаром|незабаром|на підході|згодом|у майбутньому|в майбутньому|поки не збудован/,
  };
  for (const page of DOC_PAGES) {
    for (const locale of LOCALES) {
      assert.doesNotMatch(textOf(page, locale), NOT_BUILT[locale], `${page.slug} (${locale}) speaks of something not built`);
    }
  }

  const STATUS_WORD = {
    available: { en: "Live", uk: "Працює" },
    building: { en: "In development", uk: "Розробляється" },
    planned: { en: "Planned", uk: "Заплановано" },
  };
  const overview = docPageBySlug("strategies/overview");
  const status = overview.sections.find((section) => section.id === "status").blocks.find((block) => block.kind === "table");
  for (const locale of LOCALES) {
    for (const [name, word] of status.rows[locale]) {
      const page = DOC_PAGES.find((item) => item.pageId && item.title[locale] === name);
      assert.ok(page, `the strategy overview names ${name}, which documents no product page`);
      assert.equal(word, STATUS_WORD[readinessOf(page.pageId)][locale], `the strategy overview's status for ${name} (${locale}) is not the registry's`);
    }
  }

  const EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const UK = ["нуль", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять", "десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять", "двадцять"];
  /* The cabinet has the sections of the menu and the pages it draws — a
     planned page and one kept off the surface are not among them (the menu
     you can see). */
  const count = PRODUCT_ROUTES.filter(drawn).length;
  const sections = MENU_SECTION_IDS.length;
  const UK_SECTIONS = ["нуль", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім"];
  const cabinet = docPageBySlug("start/cabinet");
  assert.ok(cabinet.summary.en.toLowerCase().startsWith(`the ${EN[sections]} sections of the menu and the ${EN[count]} pages in them`), "the cabinet counts the registry's pages (en)");
  assert.ok(cabinet.summary.uk.toLowerCase().startsWith(`${UK_SECTIONS[sections]} розділів меню і ${UK[count]} сторінок у них`), "the cabinet counts the registry's pages (uk)");
  const glossary = docPageBySlug("reference/glossary");
  assert.ok(textOf(glossary, "en").includes(`the ${EN[sections]} sections of the menu and the ${EN[count]} pages in them`), "the glossary counts the registry's pages (en)");
  assert.ok(textOf(glossary, "uk").includes(`${UK_SECTIONS[sections]} розділів меню і ${UK[count]} сторінок у них`), "the glossary counts the registry's pages (uk)");
  /* No depth to choose is documented to a person. */
  for (const page of DOC_PAGES) {
    for (const locale of LOCALES) {
      assert.doesNotMatch(textOf(page, locale), /«Простий»|«Простому»|«Профі»|\bin Simple\b|\bin Pro\b|Simple or Pro|Simple \/ Pro/, `${page.slug} (${locale}) documents a depth switch that is gone`);
    }
  }
});

test("every figure the documentation states is the one the product computes with", () => {
  /* Fee policy v2: a token swap from a major's rate to a new token's, a company from xStocks' to Ondo's. */
  assert.equal(FEES.swap, `${FEE_POLICY_V2.MAJOR.bps / 100}–${FEE_POLICY_V2.MEME.bps / 100}%`);
  assert.equal(FEES.company, `${FEE_POLICY_V2.XSTOCK.bps / 100}–${FEE_POLICY_V2.ONDO.bps / 100}%`);
  assert.equal(FEES.flow("STABLE"), "0%");
  assert.equal(FEES.bridge, `${RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE / 100}%`);
  /* The rules in force: shares of the fee Ryntra received, the inviter's by rank. */
  const level1 = REWARD_RANKS.map((rank) => REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100);
  assert.equal(REWARDS.cashbackPercent, REWARD_RULES_CURRENT.cashbackBps / 100);
  assert.equal(REWARDS.referralL1Percent, `${Math.min(...level1)}–${Math.max(...level1)}`);
  assert.equal(REWARDS.referralL2Percent, REWARD_RULES_CURRENT.referralL2Bps / 100);
  /* The order route's share the net cost assumes is the one the quote code applies. */
  assert.equal(JUPITER_ORDER_KEEPS_PERCENT, JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT);
  assert.equal(JUPITER_ORDER_MIN_FEE_BPS, JUPITER_REFERRAL_FEE_MIN_BPS);
  for (const share of level1) assert.ok(REWARDS.referralL1Ladder.en.includes(`${share}%`) && REWARDS.referralL1Ladder.uk.includes(`${share}%`), `the ladder states ${share}%`);
  assert.equal(REWARDS.claimFloorUsd, Number(REWARD_MINIMUM_CLAIM_USD_MICROS / USD_MICROS_PER_USD));
  assert.equal(POINTS.dailyCap, Number(POINTS_POLICY_V1.dailyVolumePointsCap));
  assert.equal(POINTS.levels.length, POINTS_POLICY_V1.levels.length);
  assert.equal(POINTS.tiers.length, POINTS_POLICY_V1.volumeTiers.length);

  const fees = textOf(docPageBySlug("reference/fees"), "en");
  for (const flow of ["MEME", "TRENDING", "MAJOR", "XSTOCK", "ONDO", "PRESTOCK"]) assert.ok(fees.includes(FEES.flow(flow)), `the fees page states the ${flow} rate`);
  assert.ok(fees.includes(FEES.bridge.toLowerCase()), "the fees page states the bridge fee");
  const rewards = textOf(docPageBySlug("money/rewards"), "en");
  for (const share of [REWARDS.cashbackPercent, REWARDS.referralL1Percent, REWARDS.referralL2Percent]) {
    assert.ok(rewards.includes(`${share}%`), `the rewards page states the ${share}% share`);
  }
  assert.ok(rewards.includes(`$${REWARDS.claimFloorUsd.toFixed(2)}`), "the rewards page states the claim floor");
  const points = textOf(docPageBySlug("money/points"), "en");
  assert.ok(points.includes(POINTS.dailyCap.toLocaleString("en-US")), "the points page states the daily cap");
  assert.ok(points.includes(`+${POINTS.qualifiedReferralPoints} points`), "the points page states the referral points");
  assert.ok(points.includes(POINTS.levels[POINTS.levels.length - 1].toLocaleString("en-US")), "the points page states the top level");
  /* No figure is typed as a literal that could drift from the policy. */
  for (const file of ["start.ts", "invest.ts", "trade.ts", "money.ts", "ryntra.ts", "reference.ts"]) {
    const source = read(`app/docs/content/${file}`);
    assert.doesNotMatch(source, /"[^"]*\b0\.(5|25)%[^"]*"/, `${file} types a fee as a literal instead of reading FEES`);
    assert.doesNotMatch(source, /"[^"]*\b(50|10|5)% (of|від)[^"]*"/, `${file} types a rewards share as a literal`);
  }
});

test("the documentation speaks the product's language, never the company's", () => {
  const forbidden = [
    /RYN-[A-Z0-9]+-[A-Z0-9-]+/, /Evidence (OS|Kernel)/i, /paper-first/i, /Arcus/i, /Guard API/, /Agent Control/,
    /Master Plan/i, /canon/i, /registry rollup/i, /WIP/, /hackathon/i, /grant (application|programme|program|packet)/i, /founder report/i, /readiness matrix/i, /venue-neutral/i,
    /Risk, Strategy/i, /Robinhood(?! Chain)/, /Stellar/, /Starknet/, /Uniswap/,
  ];
  for (const page of DOC_PAGES) {
    for (const locale of LOCALES) {
      const text = textOf(page, locale);
      for (const pattern of forbidden) {
        assert.doesNotMatch(text, pattern, `${page.slug} (${locale}) carries ${pattern}`);
      }
    }
  }
  /* The old handbook's redirected addresses never come back as pages. */
  const redirected = new Set(CUSTOMER_REDIRECTS.map((row) => row.source));
  for (const page of DOC_PAGES) assert.ok(!redirected.has(docsHref(page.slug)), `${docsHref(page.slug)} is a redirected address`);
  /* Nothing in the renderer either. */
  assert.doesNotMatch(EXPERIENCE, /RYN-[A-Z0-9-]+|docs\/tasks|MASTER-PLAN|readiness matrix|founder report/i);
});

test("the navigation is the menu's sections with every page once, and the developers' routes are real", () => {
  /* The documentation's sections are the menu's, then Reference and Developers. */
  assert.deepEqual([...DOC_GROUP_IDS], ["start", "invest", "trade", "launch", "money", "portfolio", "ryntra", "rewards", "reference", "developers"]);
  assert.deepEqual(DOC_NAV.map((group) => group.id), [...DOC_GROUP_IDS]);
  const hrefs = DOC_NAV.flatMap((group) => group.items.map((item) => item.href));
  assert.equal(new Set(hrefs).size, hrefs.length, "a page appears twice in the navigation");
  for (const page of DOC_PAGES) assert.ok(hrefs.includes(docsHref(page.slug)), `${page.slug} is not in the navigation`);
  for (const entry of DEVELOPER_ENTRIES) {
    assert.ok(hrefs.includes(entry.href));
    const file = `app${entry.href}/page.tsx`;
    assert.ok(existsSync(new URL(file, root)), `${entry.href} has no page at ${file}`);
    assert.match(read(file), /<DocsPage view=\{\{ kind: "/);
  }
  /* The dynamic route renders every other page and refuses unknown slugs. */
  const dynamic = read("app/docs/[...slug]/page.tsx");
  assert.match(dynamic, /dynamicParams = false/);
  assert.match(dynamic, /generateStaticParams/);
  assert.match(dynamic, /notFound\(\)/);
  assert.match(read("app/docs/page.tsx"), /page: OVERVIEW/);
  /* Reading order is a line: every page but the ends has a neighbour on each side. */
  const inner = DOC_PAGES.slice(1, -1);
  for (const page of inner) {
    const { previous, next } = docNeighbours(page.slug);
    assert.ok(previous && next, `${page.slug} has no neighbours`);
  }
});

test("search and the shared language control update the documentation in place", () => {
  assert.match(EXPERIENCE, /type="search"/);
  /* The server draws the page in its address's language — `/uk/docs/…` — or the cookie's, and the
     page trusts it; a page with one address still changes in place. */
  assert.match(EXPERIENCE, /setLocale\(initialLocale\);/);
  assert.match(EXPERIENCE, /ryntra:public-locale/);
  assert.match(read("app/site/frozen/public-header.tsx"), /dispatchEvent\(new CustomEvent<PublicLocale>\("ryntra:public-locale"/);
  /* The docs segment inherits the root's faces rather than loading its own. */
  assert.doesNotMatch(read("app/docs/layout.tsx"), /next\/font/, "the documentation must render in the brand's faces, not a segment's own");
});

test("the Guard reference is not in the documentation's menu, hub, search, overview or renderer", () => {
  /* Since 2026-09-29 the Guard reference has no entry in the app's menus. Its
     reference page stays reachable by its own links, out of the index, and
     brings its own renderer — the documentation draws it as a reference a page
     hands over, and carries none of it. */
  const hrefs = DOC_NAV.flatMap((group) => group.items.map((item) => item.href));
  assert.equal(hrefs.some((href) => /guard/i.test(href)), false, "the documentation's menu lists the Guard reference");
  assert.equal(DEVELOPER_ENTRIES.some((entry) => /guard/i.test(`${entry.href} ${entry.title.en} ${entry.title.uk}`)), false);
  const overview = EXPERIENCE.slice(EXPERIENCE.indexOf("function DeveloperOverview("), EXPERIENCE.indexOf("export function DeveloperReferenceCrumbs(")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(overview.length > 100, "the developer overview renderer was not found");
  assert.doesNotMatch(overview, /guard/i, "the developer overview offers the Guard reference");
  assert.match(overview, /localizedPath\("\/developers", locale\)/, "the overview's first way in is the open repository");
  assert.doesNotMatch(EXPERIENCE, /GuardReference|api-surface|API_GROUPS|guard-v1/, "the documentation's renderer carries the Guard reference");
  assert.match(EXPERIENCE, /view\.kind === "reference" \? <DocsLocaleContext\.Provider value=\{locale\}>\{children\}/);
});

test("Agent Control reference names only current client, HTTP and local MCP surfaces", () => {
  for (const value of [
    "@ryntra/action-evidence-sdk",
    "openapi/ryntra-agent-control-v0.yaml",
    "node packages/agent-control-mcp/src/stdio.ts",
    "/api/agents/preflight",
    "/api/agents/verify",
  ]) {
    assert.match(EXPERIENCE, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(EXPERIENCE, /no wallet, signing, funding, trading or settlement method/);
  assert.match(EXPERIENCE, /MCP package is not published to npm/);
});

test("the Ukrainian documentation speaks to the reader as «ти», like the app and the landing", () => {
  /* The Ukrainian documentation was written in «ви» while the app and the landing say «ти». JS word boundaries do
     not bound Cyrillic, so the words are bounded by letters themselves. */
  const FORMAL = /(?<![\p{L}\p{N}'’])(?:ви|вас|вам|вами|ваш|ваша|ваше|ваші|вашого|вашої|вашому|вашій|вашим|вашими|ваших|вашу)(?![\p{L}\p{N}'’])/iu;
  const PLURAL_IMPERATIVE = /(?<![\p{L}'’])[\p{L}'’]{3,}(?:йте|іть|ьте|йтеся|іться|ьтеся)(?![\p{L}'’])/u;
  for (const page of DOC_PAGES) {
    const text = textOf(page, "uk");
    assert.doesNotMatch(text, FORMAL, `${page.slug} (uk) addresses the reader as «ви»`);
    assert.doesNotMatch(text, PLURAL_IMPERATIVE, `${page.slug} (uk) asks the reader in the plural`);
  }
});
