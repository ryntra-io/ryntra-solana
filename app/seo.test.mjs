import assert from "node:assert/strict";
import { LANDING_IS_LIVE } from "../lib/site/home-to-app.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import robots from "./robots.ts";
import nextConfig from "../next.config.ts";
import { CUSTOMER_REDIRECTS } from "../lib/product/customer-routing.ts";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination.js";
import {
  ALL_LOCALES,
  LANDING_LOCALES,
  OG_IMAGE,
  ROOT_LOCALE,
  SITE,
  buildMetadata,
  hreflangsFor,
  urlForSurface,
} from "./seo.ts";
import { sitemapEntries } from "./sitemap.ts";
import { DOCS_UPDATED } from "../lib/site/page-dates.ts";
import { AWAITING_CITY, awaitingSources, CITY_PAGES } from "../city/lib/open/site-map.ts";
import { hasUkAddress } from "../lib/site/localized.ts";
import { HOMEPAGE_CATEGORY } from "../lib/site/homepage-copy.ts";
import { DOC_IDS } from "../city/lib/docs/model.ts";
import { DOC_PAGES } from "./docs/content/index.ts";
import { METHODOLOGY_SUMMARY } from "./methodology/content.ts";

/*
 * The public SEO surface is English and Ukrainian.
 *
 * Every other translation stays in the repository — METHODOLOGY_SUMMARY and the
 * legacy LANDING_COPY still carry all twelve — and their URLs temporarily
 * redirect, so they are parked rather than deleted and are absent from
 * hreflang. `EXPECTED_TRANSLATED_LOCALES` below still asserts all twelve, which
 * is what keeps "parked, not deleted" honest: if a translation were removed to
 * tidy up, that assertion fails.
 */
const EXPECTED_LOCALES = ["en", "uk"];
const EXPECTED_TRANSLATED_LOCALES = [
  "en",
  "uk",
  "ru",
  "es",
  "pt-BR",
  "fr",
  "tr",
  "vi",
  "id",
  "zh",
  "ko",
  "ar",
];
const NEXT_CONFIG_SOURCE = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("SEO locale registry is exact and every public surface has canonical hreflang", () => {
  assert.deepEqual([...ALL_LOCALES], EXPECTED_LOCALES);
  assert.deepEqual([...LANDING_LOCALES], ["en", "uk"], "the landing answers in English at `/` and in Ukrainian at `/uk`");
  assert.equal(ROOT_LOCALE, "en");
  /* The share card's address carries the card's fingerprint, so a link cache
     that keyed on the old address cannot keep serving the old picture — and
     each landing address shares the card in its own language. */
  assert.match(OG_IMAGE, new RegExp("^" + SITE.replace(/[.]/g, "[.]") + "/opengraph-image[?]v=[0-9a-f]{8}$"));
  const cards = { en: OG_IMAGE, uk: OG_IMAGE.replace("/opengraph-image", "/uk/opengraph-image") };
  const ogLocales = { en: "en_US", uk: "uk_UA" };

  for (const locale of LANDING_LOCALES) {
    for (const [surface, metadata] of [
      ["landing", buildMetadata(locale)],
    ]) {
      const canonical = urlForSurface(locale, surface);
      assert.equal(canonical, locale === "uk" ? `${SITE}/uk` : SITE);
      assert.equal(metadata.alternates?.canonical, canonical);
      assert.equal(metadata.alternates?.languages?.[locale], canonical);
      assert.equal(metadata.alternates?.languages?.["x-default"], urlForSurface("en", surface));
      // One entry per landing locale, plus x-default — the pair names each other.
      assert.deepEqual(metadata.alternates?.languages, { en: SITE, uk: `${SITE}/uk`, "x-default": SITE });
      assert.equal(metadata.openGraph?.locale, ogLocales[locale]);
      assert.deepEqual(metadata.openGraph?.alternateLocale, [ogLocales[locale === "en" ? "uk" : "en"]]);
      // Company category on the company surfaces. The Guard descriptor is a
      // different audience's line and must not leak back onto the landing.
      assert.equal(metadata.category, HOMEPAGE_CATEGORY);
      assert.equal(HOMEPAGE_CATEGORY, "Tokenized stock investing on Solana");
      const title = metadata.title?.absolute;
      assert.equal(typeof title, "string");
      assert.ok(title.length <= 60, `${locale} title within 60 characters`);
      assert.match(title, /^Ryntra — /);
      assert.match(title, /\$1/);
      assert.doesNotMatch(title, /Decision & Settlement Evidence Layer/);
      assert.equal(metadata.robots?.index, true);
      assert.equal(metadata.robots?.follow, true);
      assert.equal(metadata.openGraph?.url, canonical);
      const description = String(metadata.description);
      assert.ok(description.length > 40 && description.length <= 160, `${locale} ${surface} description length`);
      assert.equal(metadata.openGraph?.description, description);
      assert.equal(metadata.twitter?.description, description);
      assert.match(description, /[.!?。؟]$/u);
      assert.equal(metadata.openGraph?.images?.[0]?.url, cards[locale]);
      assert.deepEqual(metadata.twitter?.images, [cards[locale]]);
      assert.match(String(metadata.openGraph?.images?.[0]?.alt), /Solana/);
      assert.doesNotMatch(JSON.stringify(metadata), /Evidence OS|Weekly Risk|first shipped adapter/);
      assert.doesNotMatch(title + " " + description, /Arcus spot|Robinhood Chain|Stock Tokens/i);
    }
  }

  assert.deepEqual(hreflangsFor("landing")["x-default"], SITE);

  /* The language addresses of the home page other than `/` and `/uk` lead to
     the landing, each in one hop — `front-door.test.mjs` holds them; none may
     point at a parked locale's own page. */
  assert.match(NEXT_CONFIG_SOURCE, /"\/pt", "\/pt-br", "\/pt-pt", "\/zh-cn", "\/zh-CN", "\/zh-tw", "\/zh-hk",/);
  assert.doesNotMatch(NEXT_CONFIG_SOURCE, /source: "\/pt-br"[^\n]+destination: "\/pt-BR"/);
});

/**
 * What the sitemap advertises, by name: the city's live addresses and nothing else (CITY-159).
 *
 * Asserted by name rather than by count so a route cannot join the sitemap without someone deciding it should be
 * indexed. Until 2026-10-31 it named 103 addresses and 102 were pages of the old site, drawn in the old interface
 * nobody is to see (decision 75); each comes back here when the city takes it over at its own address (CITY-157).
 */
const ADVERTISED_PATHS = ["/", "/launches", "/roadmap", "/build", "/partners", "/docs", ...DOC_IDS.map((id) => `/docs/${id}`), "/developers", "/connector", "/support", "/about", "/legal/terms", "/legal/privacy"];

/**
 * The site's old public pages: reachable at their addresses, never in the sitemap, and answering noindex until the
 * city draws them. The old handbook left this list with CITY-180: its addresses lead to the documentation's sections.
 */
const WAITING_PATHS = [
  "/company",
  "/contact",
  "/security",
  "/methodology",
  "/stats",
  "/legal/licenses",
];

/**
 * Routes that must never reappear in the sitemap: every one answers with a
 * redirect, or is a reviewer artifact kept out of the index on purpose.
 * Advertising a redirect to a crawler is how a stale URL keeps outranking
 * the page that replaced it, so the absence is asserted rather than assumed.
 */
const NEVER_ADVERTISED = [
  "/status", "/guard",
  "/product", "/product-map", "/developers/guard", "/developers/agent-control",
  "/docs/product-paper", "/docs/current-capabilities", "/docs/introduction", "/docs/how-ryntra-works",
  "/docs/core-principles", "/docs/glossary", "/docs/receipts-journal", "/docs/ryntra-home",
  "/docs/agent-control", "/docs/ecosystems", "/docs/roadmap", "/docs/changelog", "/docs/faq",
  "/en", "/ua", "/ru", "/app", "/docs/developers", "/docs/developers/guard", "/docs/developers/agent-control",
  "/docs/trade/tokenized-stocks", "/docs/reference/security",
  "/stellar", "/robinhood",
  /* The short addresses lead into the city (CITY-159); the partner Terms are the Growth line's page. */
  "/launch", "/trade", "/rewards", "/terms", "/privacy", "/promo/partners/terms",
];
/* 27: the prediction demo's page left with the demo; 33 since the new site (2026-09-26). */
assert.ok(DOC_PAGES.length >= 33, "the documentation set is not the full one");
assert.ok(DOC_PAGES.every((page) => !page.slug || /^[a-z]+(?:[/][a-z-]+)*$/.test(page.slug)), "every documentation page has a documentation path");
assert.equal(typeof DOCS_UPDATED, "string");

test("the sitemap advertises the city's live addresses alone, each a page that answers, dated by its own content", async () => {
  const entries = sitemapEntries();
  assert.deepEqual(CITY_PAGES.map((page) => page.path), ADVERTISED_PATHS, "the advertised addresses are exactly these, in this order");
  assert.equal(entries.length, ADVERTISED_PATHS.length, "one entry per address: the city's address has no Ukrainian twin");
  assert.equal(new Set(entries.map((entry) => entry.url)).size, entries.length);
  /* The old interface leads into the city since CITY-13: nothing of it is offered to the index. */
  assert.ok(!entries.some((entry) => /^\/(?:uk\/)?(?:app|solana|mission|live)(?:[/?]|$)/.test(entry.url.replace(SITE, ""))), "no address of the old interface");

  /* No entry may be an address the app redirects: neither a customer
     alias nor one of next.config's own rows. Static, so it cannot go stale
     without this test noticing. */
  /* Rows whose conditions never hold on ryntra.io (app.ryntra.io's, predict.ryntra.io's), by Next's own matcher. */
  const configured = (await nextConfig.redirects()).filter((row) => !(row.has || row.missing) || matchHas({ headers: { host: "ryntra.io" }, cookies: {} }, {}, row.has, row.missing));
  const redirected = new Set([...CUSTOMER_REDIRECTS, ...configured].map((row) => row.source).filter((source) => !source.includes(":")));
  for (const entry of entries) {
    const path = entry.url.replace(SITE, "") || "/";
    assert.ok(!redirected.has(path), `${path} redirects and must not be advertised in the sitemap`);
  }

  /* The city comes first — `/` alone, in English. */
  const home = entries[0];
  assert.equal(home.url, urlForSurface("en", "landing"));
  assert.equal(home.priority, 1);
  assert.equal(home.alternates, undefined, "one language, no pair");
  assert.ok(new Date(home.lastModified) <= new Date(), "not dated in the future");
  assert.ok(!entries.some((entry) => entry.url === urlForSurface("uk", "landing")), "the Ukrainian home is a redirect, never advertised");
  assert.ok(LANDING_IS_LIVE, "ryntra.io's home is the city itself");

  for (const path of [...WAITING_PATHS, ...NEVER_ADVERTISED]) {
    for (const url of [SITE + path, `${SITE}/uk${path}`]) {
      assert.equal(entries.find((entry) => entry.url.split("?")[0] === url), undefined, `${url} is not the city's page and must not be advertised in the sitemap`);
    }
  }
});

test("the site's old public pages stay reachable but answer noindex until the city takes each over (CITY-157)", async () => {
  const headers = await nextConfig.headers();
  const noindex = (source) => headers.some((row) => row.source === source && !row.has && row.headers.some((header) => header.key === "X-Robots-Tag" && /noindex/.test(header.value)));
  for (const source of awaitingSources()) assert.ok(noindex(source), `${source} answers noindex`);
  /* Every waiting page is matched by one of the patterns, at both of its addresses where it has two. */
  const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match.js");
  const matched = (path) => awaitingSources().some((source) => getPathMatch(source, { strict: true })(path));
  for (const path of WAITING_PATHS) {
    assert.ok(matched(path), `${path} is held out of the index`);
    if (hasUkAddress(path)) assert.ok(matched(`/uk${path}`), `/uk${path} is held out of the index`);
  }
  /* The city itself, a coin's tower and the engine are never held out by this list. */
  for (const path of ["/", "/c/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "/api/v1/health", "/window"]) assert.ok(!matched(path), `${path} is not an old page`);
  assert.ok(AWAITING_CITY.length > 0);
});

test("every documentation page's search title fits 60 and its description 160, in both languages", () => {
  /* The sweep of 2026-09-27 found two English descriptions at 161. */
  for (const page of DOC_PAGES) {
    for (const locale of ["en", "uk"]) {
      const title = page.seoTitle?.[locale] ?? `${page.title[locale]} — ${locale === "uk" ? "Документація Ryntra" : "Ryntra Docs"}`;
      assert.ok(title.length <= 60, `${page.slug || "/docs"} ${locale} title ${title.length}`);
      assert.ok(page.summary[locale].length <= 160, `${page.slug || "/docs"} ${locale} description ${page.summary[locale].length}`);
    }
  }
});

test("every page's metadata stands in its head, for every reader", () => {
  /* Next streams the title, the description, the canonical and the hreflang into the body for every
     user agent it does not name; Googlebot and Lighthouse were among them, and Lighthouse scored `/`
     and `/app` 92 for a description it could not find in the head (measured 2026-09-27). */
  assert.equal(String(nextConfig.htmlLimitedBots), "/.*/", "no reader gets the metadata streamed after the head");
});

test("robots keeps the public documents crawlable while blocking private, API, and QA paths", () => {
  const policy = robots();
  const rule = Array.isArray(policy.rules) ? policy.rules[0] : policy.rules;
  const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
  const reviewLayout = readFileSync(new URL("./legal/review/layout.tsx", import.meta.url), "utf8");

  assert.deepEqual(rule.allow, ["/"]);
  assert.ok(disallow.includes("/api/"));
  /* The old interface only leads into the city since CITY-13: crawlable, so a crawler sees the 308 and drops it. */
  for (const old of ["/app", "/uk/app", "/solana", "/uk/solana", "/mission", "/live"]) {
    assert.ok(!disallow.some((path) => String(path).startsWith(old)), `${old} must stay crawlable so robots can observe its redirect`);
  }
  assert.ok(!disallow.includes("/legal/review/"), "review pages must remain crawlable so robots can observe noindex");
  assert.ok(!disallow.some((path) => String(path).startsWith("/strategy-lab-qa")), "robots names only what is live");
  /* The documentation, the open-source page and where the figures come from are public
     documents, and nothing may quietly hide them from a crawler. */
  for (const open of ["/docs", "/developers", "/methodology", "/company"]) {
    assert.ok(!disallow.some((path) => String(path).startsWith(open)), open + " must stay crawlable");
  }
  assert.match(reviewLayout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.equal(policy.sitemap, SITE + "/sitemap.xml");
});

test("robots makes an explicit purpose-based decision for every currently tracked AI crawler", () => {
  const policy = robots();
  const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
  const agentsOf = (rule) => Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
  const ruleFor = (agent) => rules.find((rule) => agentsOf(rule).includes(agent));
  const pathsOf = (value) => Array.isArray(value) ? value : value ? [value] : [];

  const userTriggered = ["ChatGPT-User", "Claude-User", "Perplexity-User"];
  const answerAndSearch = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];
  const training = [
    "GPTBot",
    "ClaudeBot",
    "anthropic-ai",
    "Google-Extended",
    "Applebot-Extended",
    "meta-externalagent",
    "Amazonbot",
    "Bytespider",
    "CCBot",
  ];
  const protectedPaths = ["/api/", "/admin"];

  for (const agent of [...userTriggered, ...answerAndSearch]) {
    const rule = ruleFor(agent);
    assert.ok(rule, `${agent} falls through to the wildcard instead of receiving an explicit answer-time policy.`);
    assert.deepEqual(rule.allow, ["/"], `${agent} is not deliberately admitted to the city and the public Ryntra pages.`);
    const disallow = pathsOf(rule.disallow);
    for (const path of protectedPaths) {
      assert.ok(disallow.includes(path), `${agent} escapes the existing protected path ${path}.`);
    }
  }

  for (const agent of training) {
    const rule = ruleFor(agent);
    assert.ok(rule, `${agent} falls through to the wildcard instead of receiving an explicit training policy.`);
    assert.ok(pathsOf(rule.disallow).includes("/"), `${agent} is not opted out from bulk model-training crawl.`);
  }

  const explicitlyDecided = new Set(
    rules.flatMap(agentsOf).filter((agent) => agent !== "*"),
  );
  assert.deepEqual(
    [...explicitlyDecided].sort(),
    [...userTriggered, ...answerAndSearch, ...training].sort(),
    "The declared AI policy and the current 15-agent audit roster drifted apart.",
  );
});

test("all locale summaries preserve the loop, WRRD, non-custody/human authority, and AI limits", () => {
  assert.deepEqual(Object.keys(METHODOLOGY_SUMMARY), EXPECTED_TRANSLATED_LOCALES);

  for (const locale of EXPECTED_TRANSLATED_LOCALES) {
    const copy = METHODOLOGY_SUMMARY[locale];
    for (const field of ["title", "lead", "loopBoundary", "wrrd", "trust", "aiBoundary", "technicalReference", "backHome"]) {
      assert.ok(copy[field]?.trim(), locale + " missing " + field);
    }
    assert.match(copy.loopBoundary, /StrategySpec/);
    assert.match(copy.loopBoundary, /DecisionReceipt/);
    assert.match(copy.loopBoundary, /ReviewRecord/);
    assert.match(copy.wrrd, /WRRD/);
    assert.match(copy.aiBoundary, /AI/);
  }
});

test("the Handbook and structured data consume the product's own facts without invented review or shipped-loop claims", () => {
  /* This used to read `/methodology`. That page is gone — it was one of four
     public documents restating the same boundaries — so the same obligations
     are checked against the document that replaced it. The terms below are the
     load-bearing vocabulary: each one is a boundary that must survive any
     shortening of the public surface. */
  /* The Handbook was one page; it is a hub with pages under it now, and the
     custody boundary moved further still — onto `/security`. The vocabulary
     below has to survive somewhere a reader can reach, not in one particular
     file, so the check reads the whole documentation segment plus the security
     page it now points at. */
  const handbook =
    [
      "docs/page",
      "docs/introduction/page",
      "docs/how-ryntra-works/page",
      "docs/core-principles/page",
      "docs/receipts-journal/page",
      "docs/current-capabilities/page",
      "docs/ecosystems/page",
      "docs/roadmap/page",
      "docs/faq/page",
      "docs/changelog/page",
      "docs/glossary/page",
      "docs/product-paper/chapters",
      /* The state vocabulary lives in the Handbook furniture the split extracted,
         not on any one page. */
      "docs/parts",
      "security/page",
    ]
      .map((f) =>
        readFileSync(new URL(`./${f}.ts${/chapters$/.test(f) ? "" : "x"}`, import.meta.url), "utf8"),
      )
      .join("\n");
  const handbookWithSecurityCopy = [handbook, readFileSync(new URL("./security/security-copy.ts", import.meta.url), "utf8")].join("\n");
  const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
  const landing = readFileSync(new URL("./(home)/page.tsx", import.meta.url), "utf8");
  const localizedLanding = readFileSync(new URL("./(home)/uk/page.tsx", import.meta.url), "utf8");
  const landingGraph = readFileSync(new URL("./(home)/landing-jsonld.ts", import.meta.url), "utf8");
  const og = readFileSync(new URL("./opengraph-image.tsx", import.meta.url), "utf8");

  for (const term of [
    "StrategySpec",
    "DecisionReceipt",
    "ReviewRecord",
    "review window",
    "fail closed",
    "Non-custodial",
    "not publicly released",
  ]) {
    assert.ok(handbookWithSecurityCopy.includes(term), "the Handbook is missing " + term);
  }

  /* The three claims that must never quietly disappear from the public
     documentation, whichever page carries it. */
  assert.match(handbook, /not shipped end to end today/,
    "the complete loop is a target model, and the Handbook has to say so");
  assert.match(handbook, /No independent security audit has been performed/);
  assert.match(handbook, /never supplies a missing\s+fact, decides policy, authorizes, signs or executes|never supplies a missing fact/,
    "the AI boundary must be stated");
  assert.doesNotMatch(handbook, /Ryntra Product & Risk|editorial review/i);

  /* Capability figures are rendered from the registry rather than retyped —
     the property that makes a shorter public surface no less honest. */
  assert.match(handbook, /getSiteTruth\(\)/);
  assert.match(handbook, /truth\.capabilities/);
  assert.doesNotMatch(layout, /\bfeatureList\b/, "static root JSON-LD must not freeze drift-prone capability claims");
  assert.match(layout, /CITY_WORDS/, "the root's words and structured data are the city's (CITY-158)");
  assert.doesNotMatch(layout, /PRODUCT_CANON\.(shippedLoopBoundary|northStar|arcusBoundary)/);
  assert.doesNotMatch(layout, /offers:\s*\{/);
  /* The landing's graph is the page's own words: the
     feature list is «Працює зараз», which `(home)/landing.test.mjs` ties item
     by item to the code that does it, so the graph can claim no more than the
     page — the property the registry helper of the landing before it held. */
  /* `/` is Ryntra City since decision 70: the city's words, no landing feature list. */
  assert.match(landing, /buildCityMetadata\(\)/);
  assert.doesNotMatch(landing, /featureList|landingJsonLdScript|cookies\(\)/);
  for (const [route, locale] of [[localizedLanding, "uk"]]) {
    assert.match(route, new RegExp(`landingJsonLdScript\\("${locale}"\\)`));
    assert.match(route, new RegExp(`buildLandingMetadata\\("${locale}"\\)`));
    assert.doesNotMatch(route, /featureList|cookies\(\)/);
  }
  /* Read without its prose: the comment says why there is no rating, the code must not have one. */
  const graphCode = landingGraph.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(graphCode, /featureList: copy\.status\.now\.items\.map\(\(item\) => item\.text\)/);
  assert.doesNotMatch(graphCode, /aggregateRating|review:/);
  assert.doesNotMatch(graphCode, /InternalCapabilityEvidence|evidence:\s*\{/);
  /* The share card used to stage a mock risk panel, which is why it carried
     "NOT A LIVE VERDICT" and "planned, not shipped" — disclaimers for a
     fabricated example. Since CITY-158 it is the city's card: the live city's
     frame, the mark and one line, with no verdict to disclaim. */
  assert.match(og, /cityCard\(/);
  assert.match(og, /CARD_WORDS/);
  assert.doesNotMatch(og, /RISK STATE|EVIDENCE REQUIRED|LIVE VERDICT/);
});
