import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import robots from "./robots.ts";
import nextConfig from "../next.config.ts";
import { CUSTOMER_REDIRECTS } from "../lib/product/customer-routing.ts";
import {
  ALL_LOCALES,
  APP_HOME_PATH,
  LANDING_LOCALES,
  OG_IMAGE,
  ROOT_LOCALE,
  SITE,
  buildMetadata,
  hreflangsFor,
  languageAlternates,
  localizedUrl,
  urlForSurface,
} from "./seo.ts";
import { APP_PAGES, DOCS_UPDATED, HOME_UPDATED, LANDING_UPDATED, MARKETS_UPDATED, PUBLIC_PAGES, sitemapEntries } from "./sitemap.ts";
import { hasUkAddress } from "../lib/site/localized.ts";
import { HOMEPAGE_CATEGORY } from "../lib/site/homepage-copy.ts";
import { DOC_PAGES, docsHref } from "./docs/content/index.ts";
import { METHODOLOGY_SUMMARY } from "./methodology/content.ts";

/*
 * The public SEO surface is English and Ukrainian (founder decision 2026-08-26).
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
  assert.deepEqual([...LANDING_LOCALES], ["en", "uk"], "the landing answers in English at `/` and in Ukrainian at `/uk` (RYN-SITE-V5-001)");
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
 * The public pages the sitemap advertises, by name.
 *
 * Asserted by name rather than by count so a route cannot join the sitemap
 * without someone deciding it should be indexed — which is the whole point
 * of listing it here. Everything else that once sat in this list (the product
 * map, the handbook chapters, the developer portal's old addresses, `/uk`)
 * redirects now, and the sitemap of 2026-09-14 was still advertising all of
 * it — nineteen redirects among twenty-four entries.
 */
const ADVERTISED_PATHS = [
  "/docs",
  /* Every documentation page, in the documentation's own reading order —
     derived, because the documentation is data and a page added to it should
     be found without anyone editing this list. */
  ...DOC_PAGES.filter((page) => page.slug).map((page) => docsHref(page.slug)),
  /* Since the public pages of the new site (2026-09-26): About, and where the figures come from. */
  "/company",
  "/contact",
  /* Since 2026-09-29: the support page the Android app's store listing names. */
  "/support",
  "/security",
  "/methodology",
  "/stats",
  "/legal/terms",
  "/legal/privacy",
];

/**
 * Routes that must never reappear in the sitemap: every one answers with a
 * redirect, or is a reviewer artifact kept out of the index on purpose.
 * Advertising a redirect to a crawler is how a stale URL keeps outranking
 * the page that replaced it, so the absence is asserted rather than assumed.
 */
const NEVER_ADVERTISED = [
  "/status", "/guard",
  "/product", "/product-map", "/developers", "/developers/guard", "/developers/agent-control",
  "/docs/product-paper", "/docs/current-capabilities", "/docs/introduction", "/docs/how-ryntra-works",
  "/docs/core-principles", "/docs/glossary", "/docs/receipts-journal", "/docs/ryntra-home",
  "/docs/agent-control", "/docs/ecosystems", "/docs/roadmap", "/docs/changelog", "/docs/faq",
  /* The reviewer pages this deployment still serves assert their own absence
     from the sitemap beside themselves. */
  /* Since 2026-09-26: the developer references and the open-source page are `noindex`, the landing's
     other language addresses lead to `/` and `/uk`, and the documentation's moved pages answer by
     308 (`RYN-SITE-V5-001`); `/company` and `/methodology` are pages again and advertised above. */
  "/en", "/ua", "/ru", "/app", "/docs/developers", "/docs/developers/guard", "/docs/developers/agent-control",
  "/docs/trade/tokenized-stocks", "/docs/reference/security",
  "/stellar", "/robinhood",
];
/* 27 since canon v5.4 (В32, 2026-09-24): the prediction demo's page left with the demo; 33 since the new site (2026-09-26). */
assert.ok(DOC_PAGES.length >= 33, "the documentation set is not the full one");
assert.ok(DOC_PAGES.every((page) => !page.slug || /^[a-z]+(?:[/][a-z-]+)*$/.test(page.slug)), "every documentation page has a documentation path");
assert.equal(typeof DOCS_UPDATED, "string");

test("sitemap advertises only pages that answer, at both of their addresses, dated by their own content", async () => {
  const entries = sitemapEntries(["NVDAx"]);
  /* Every page offered to the index at both addresses (RYN-SITE-V5-001, subtask 4); the legal texts English only. */
  const twoLanguage = ADVERTISED_PATHS.filter((path) => hasUkAddress(path));
  const english = ADVERTISED_PATHS.filter((path) => !hasUkAddress(path));
  assert.deepEqual(english, ["/legal/terms", "/legal/privacy"], "only the legal texts have one address");
  assert.equal(entries.length, 2 + APP_PAGES.length * 2 + twoLanguage.length * 2 + english.length + 2, "the landing, Home and Markets, the advertised pages and one company — each at its addresses — nothing else");
  assert.equal(new Set(entries.map((entry) => entry.url)).size, entries.length);
  assert.deepEqual(PUBLIC_PAGES.map((page) => page.path), ADVERTISED_PATHS, "the advertised pages are exactly these, in this order");
  assert.deepEqual(APP_PAGES.map((page) => page.path), [APP_HOME_PATH, "/app/markets"], "of the cabinet, Home and Markets — and the companies the shelf opens");

  /* No entry may be an address the app redirects: neither a customer
     alias nor one of next.config's own rows. Static, so it cannot go stale
     without this test noticing. */
  const configured = await nextConfig.redirects();
  const redirected = new Set([...CUSTOMER_REDIRECTS, ...configured].map((row) => row.source).filter((source) => !source.includes(":")));
  for (const entry of entries) {
    const path = entry.url.replace(SITE, "") || "/";
    assert.ok(!redirected.has(path), `${path} redirects and must not be advertised in the sitemap`);
  }

  for (const path of ADVERTISED_PATHS) {
    const page = PUBLIC_PAGES.find((item) => item.path === path);
    for (const locale of hasUkAddress(path) ? ["en", "uk"] : ["en"]) {
      const entry = entries.find((item) => item.url === localizedUrl(path, locale));
      assert.ok(entry, `missing sitemap entry for ${path} (${locale})`);
      assert.equal(new Date(entry.lastModified).toISOString(), `${page.updated}T00:00:00.000Z`);
      assert.ok(new Date(entry.lastModified) <= new Date(), `${path} is dated in the future`);
      assert.ok(entry.priority > 0 && entry.priority < 1, `${path} sits under the landing`);
      /* A page with an address per language names the pair; one with a single address names none —
         an alternates map naming an address that does not exist is worse than none. */
      assert.deepEqual(entry.alternates?.languages, languageAlternates(path));
    }
  }

  /* The landing comes first, one entry per language, each naming the pair
     (`RYN-SITE-V5-001`); then Home and Markets, each at both addresses. */
  LANDING_LOCALES.forEach((locale, index) => {
    const entry = entries[index];
    assert.equal(entry.url, urlForSurface(locale, "landing"));
    assert.equal(entry.priority, 1);
    assert.equal(new Date(entry.lastModified).toISOString(), `${LANDING_UPDATED}T00:00:00.000Z`);
    assert.deepEqual(entry.alternates?.languages, hreflangsFor("landing"));
  });
  const home = entries.find((entry) => entry.url === SITE + APP_HOME_PATH);
  assert.ok(home, "missing Home");
  assert.equal(entries[LANDING_LOCALES.length], home);
  assert.equal(home.priority, 0.9);
  assert.equal(new Date(home.lastModified).toISOString(), `${HOME_UPDATED}T00:00:00.000Z`);
  assert.deepEqual(home.alternates?.languages, { en: SITE + APP_HOME_PATH, uk: `${SITE}/uk${APP_HOME_PATH}`, "x-default": SITE + APP_HOME_PATH });
  const markets = entries.find((entry) => entry.url === `${SITE}/uk/app/markets`);
  assert.equal(new Date(markets.lastModified).toISOString(), `${MARKETS_UPDATED}T00:00:00.000Z`);
  const company = entries.find((entry) => entry.url === `${SITE}/uk/app/stocks/NVDAx`);
  assert.deepEqual(company?.alternates?.languages, languageAlternates("/app/stocks/NVDAx"), "a company the shelf opens, at both addresses");

  for (const path of NEVER_ADVERTISED) {
    for (const url of [SITE + path, `${SITE}/uk${path}`]) {
      assert.equal(entries.find((entry) => entry.url === url), undefined, `${url} redirects or is a reviewer artifact and must not be advertised in the sitemap`);
    }
  }

  /* The reviewer pages this deployment still serves keep themselves out of
     the index; each asserts that beside its own page. */
});

test("every documentation page's search title fits 60 and its description 160, in both languages", () => {
  /* The plan of RYN-SITE-V5-001 §3; the sweep of 2026-09-27 found two English descriptions at 161. */
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

  assert.deepEqual(rule.allow, ["/", "/app/home$", "/app/markets$", "/app/stocks/", "/uk/app/home$", "/uk/app/markets$", "/uk/app/stocks/"]);
  assert.ok(disallow.includes("/api/"));
  assert.ok(disallow.includes("/app/"));
  assert.ok(disallow.includes("/uk/app/"), "the cabinet's Ukrainian addresses are closed as its English ones are");
  assert.ok(!disallow.includes("/app$"), "/app is the front door's first hop (RYN-SITE-NOW-001)");
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
  const protectedPaths = ["/api/", "/admin", "/app/", "/uk/app/"];

  for (const agent of [...userTriggered, ...answerAndSearch]) {
    const rule = ruleFor(agent);
    assert.ok(rule, `${agent} falls through to the wildcard instead of receiving an explicit answer-time policy.`);
    assert.deepEqual(rule.allow, ["/", "/app/home$", "/app/markets$", "/app/stocks/", "/uk/app/home$", "/uk/app/markets$", "/uk/app/stocks/"], `${agent} is not deliberately admitted to public Ryntra pages, Home, Markets and the companies.`);
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

test("the Handbook and structured data consume canon/registry without invented review or shipped-loop claims", () => {
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
  /* The security page's words are data beside it since the new site of canon v5.5. */
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
  assert.match(layout, /HOMEPAGE_COPY/);
  assert.doesNotMatch(layout, /PRODUCT_CANON\.(shippedLoopBoundary|northStar|arcusBoundary)/);
  assert.doesNotMatch(layout, /offers:\s*\{/);
  /* The landing's graph is the page's own words (`RYN-SITE-V5-001`): the
     feature list is «Працює зараз», which `(home)/landing.test.mjs` ties item
     by item to the code that does it, so the graph can claim no more than the
     page — the property the registry helper of the landing before it held. */
  for (const [route, locale] of [[landing, "en"], [localizedLanding, "uk"]]) {
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
     fabricated example. The brand-system card (2026-08-09) renders no mock
     panel at all: the canonical mark, the pinned promise and the canon trust
     line, with no maturity vocabulary or verdict to disclaim. */
  assert.match(readFileSync(new URL("./brand/homepage-og.tsx", import.meta.url), "utf8"), /R_MARK_PATHS/);
  assert.match(og, /HOMEPAGE_COPY/);
  assert.doesNotMatch(og, /RISK STATE|EVIDENCE REQUIRED|LIVE VERDICT/);
});
