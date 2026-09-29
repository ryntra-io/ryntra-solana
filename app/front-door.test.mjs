import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import nextConfig, { HOME_LANGUAGE_ADDRESSES, LANDING_ADDRESSES, LANDING_REDIRECTS, PARKED_LANGUAGE_ADDRESSES } from "../next.config.ts";
import { CUSTOMER_REDIRECTS } from "../lib/product/customer-routing.ts";
import { HOMEPAGE_CATEGORY, HOMEPAGE_COPY } from "../lib/site/homepage-copy.ts";
import { ENABLED_LOCALE_CODES } from "./i18n/locales.ts";
import manifest from "./manifest.ts";
import robots from "./robots.ts";
import { APP_HOME_PATH, SITE, buildAppHomeMetadata, buildMetadata, landingOgImage } from "./seo.ts";
import { sitemapEntries } from "./sitemap.ts";
import { helpTopic } from "./shell/help-topics.ts";
import { LANDING_META } from "./(home)/landing-meta.ts";

/*
 * The site — the Owner's word of 2026-09-26: first `RYN-SITE-NOW-001` («Сайт:
 * тимчасовий редірект і правдиві тексти») led `/` into the app and made
 * everything the outside world reads say what Ryntra is; then the new site of
 * `RYN-SITE-V5-001` (subtask 2) took `/` back with the landing in English and
 * `/uk` in Ukrainian, and removed the temporary redirect. The Owner's line,
 * word for word, in both languages — the tab of Home and the share card of the
 * landing.
 */
const TITLE = {
  en: "Ryntra — invest in tokenized stocks from $1, in your own wallet, on Solana",
  uk: "Ryntra — інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana",
};

/* The retired line in every form it took: English with «&» and with «and»,
   both Ukrainian renderings, the parked Russian. */
const RETIRED =
  /professional\s+trading\s+(?:&|and)\s+strategy\s+platform|професійна\s+платформа\s+для\s+(?:торгівлі|трейдингу)\s+та\s+стратегій|профессиональная\s+платформа\s+для\s+торговли\s+и\s+стратегий/iu;

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the landing answers at `/` and `/uk`; the temporary redirect into the app is gone; every other language address is one hop", async () => {
  const rows = await nextConfig.redirects();
  /* Next answers with the first row that matches, so the first row per source is the one that counts. */
  const first = new Map();
  for (const row of rows) if (!first.has(row.source)) first.set(row.source, row);

  assert.deepEqual(LANDING_ADDRESSES, { en: "/", uk: "/uk" });
  assert.deepEqual(rows.slice(0, LANDING_REDIRECTS.length), LANDING_REDIRECTS, "the landing's language map is matched before every other row");
  /* The two landing addresses are pages: nothing redirects them. */
  for (const source of ["/", "/uk"]) assert.equal(first.get(source), undefined, `${source} is the landing and must answer itself`);
  /* The same page under a second name, for good. */
  assert.deepEqual(first.get("/en"), { source: "/en", destination: "/", permanent: true });
  assert.deepEqual(first.get("/ua"), { source: "/ua", destination: "/uk", permanent: true });
  /* Every language the home page once answered in, and its aliases, is paused, not gone: `/`, temporarily. */
  for (const code of ENABLED_LOCALE_CODES) {
    assert.ok(HOME_LANGUAGE_ADDRESSES.includes(`/${code}`), `/${code} is a language address of the home page`);
  }
  assert.ok(PARKED_LANGUAGE_ADDRESSES.length >= 20, "the parked languages and their aliases");
  for (const source of PARKED_LANGUAGE_ADDRESSES) {
    assert.ok(!["/en", "/uk", "/ua"].includes(source));
    const row = first.get(source);
    assert.equal(row?.destination, "/", `${source} leads to the landing`);
    assert.equal(row?.permanent, false, `${source} must stay a 307 — a paused language comes back`);
  }
  /* The company page is a page again since the public pages of the new site (subtask 3, 2026-09-26). */
  assert.equal(first.get("/company"), undefined);
  /* The landing's old review doors and the parked workspaces: to the landing itself, one hop. */
  for (const [source, destination] of [
    ["/v2", "/"], ["/preview/site", "/"], ["/preview/site/uk", "/uk"], ["/preview/hero-ab", "/"],
    ["/stellar", "/"], ["/stellar/:path*", "/"], ["/robinhood", "/"], ["/robinhood/:path*", "/"],
  ]) {
    const row = first.get(source);
    assert.equal(row?.destination, destination, `${source} must lead to ${destination}`);
    assert.equal(row?.permanent, false, `${source} must stay a 307`);
  }
  /* No hop lands where another waits: no row's destination is itself redirected. */
  const sources = new Set(rows.map((row) => row.source));
  for (const row of rows) {
    const path = row.destination.split("?")[0];
    assert.ok(!sources.has(path) || path === "/app", `${row.source} → ${row.destination} is a chain`);
  }
  /* `/app` answers with Home, the first of the five places — the landing's «Відкрити застосунок» goes straight there. */
  assert.equal(CUSTOMER_REDIRECTS.find((row) => row.source === "/app")?.destination, "/app/home");
});

test("the language map lives in the config, never as a redirect() in a page", () => {
  /* A page's redirect answers 200 with a meta refresh on production — no redirect to a crawler or a link preview. */
  for (const file of ["./(home)/page.tsx", "./(home)/uk/page.tsx", "./(home)/layout.tsx"]) {
    assert.doesNotMatch(read(file), /\bredirect\(|permanentRedirect\(|cookies\(\)/, `${file} decides nothing by a redirect or a cookie`);
  }
  assert.match(read("../next.config.ts"), /\.\.\.LANDING_REDIRECTS,\s*\.\.\.CUSTOMER_REDIRECTS,/);
  assert.doesNotMatch(read("../next.config.ts"), /SITE_NOW_REDIRECTS|FRONT_DOOR/, "the temporary front door is gone");
});

/* Home's words of its own as the app's page — the plan of `RYN-SITE-V5-001` §3,
   built by its technical subtask (2026-09-27). */
const HOME_WORDS = {
  en: {
    title: "Ryntra app — buy a piece of a company from $1",
    description: "Connect a Solana wallet, top up from $1 and buy a piece of a company. Popular companies, Autoinvest and your notifications — on one screen.",
  },
  uk: {
    title: "Застосунок Ryntra — частинка компанії від $1",
    description: "Під'єднай гаманець Solana, поповни від $1 і купи частинку компанії. Популярні компанії, «Автоінвест» і сповіщення — на одному екрані.",
  },
};

test("Home has words of its own as the app's page, at both of its addresses, with the landing's card in its language", () => {
  const pair = { en: SITE + APP_HOME_PATH, uk: `${SITE}/uk${APP_HOME_PATH}`, "x-default": SITE + APP_HOME_PATH };
  for (const locale of ["en", "uk"]) {
    const metadata = buildAppHomeMetadata(locale);
    const description = String(metadata.description);
    assert.deepEqual(metadata.title, { absolute: HOME_WORDS[locale].title }, "the tab and the result name the app and the purchase, not «Home · Ryntra»");
    assert.ok(HOME_WORDS[locale].title.length <= 60, `${locale} title within 60`);
    assert.equal(description, HOME_WORDS[locale].description);
    assert.ok(description.length > 40 && description.length <= 160, `${locale} description length`);
    assert.match(description, /\$1/);
    assert.match(description, /[.!?]$/u);
    assert.equal(metadata.robots?.index, true, "Home is offered to the index");
    assert.equal(metadata.alternates?.canonical, pair[locale], "the canonical is the address of the language the page is drawn in");
    assert.deepEqual(metadata.alternates?.languages, pair, "the two addresses name each other, x-default the English");
    assert.equal(metadata.category, HOMEPAGE_CATEGORY);
    assert.equal(metadata.openGraph?.title, HOME_WORDS[locale].title);
    assert.equal(metadata.openGraph?.description, description);
    assert.equal(metadata.openGraph?.url, pair[locale]);
    assert.equal(metadata.openGraph?.locale, locale === "uk" ? "uk_UA" : "en_US");
    assert.equal(metadata.openGraph?.images?.[0]?.url, landingOgImage(locale), "the landing's card in the page's language (plan §6)");
    assert.equal(metadata.openGraph?.images?.[0]?.alt, HOMEPAGE_COPY[locale].ogAlt);
    assert.equal(metadata.twitter?.card, "summary_large_image");
    assert.equal(metadata.twitter?.title, HOME_WORDS[locale].title);
    assert.equal(metadata.twitter?.description, description);
    assert.deepEqual(metadata.twitter?.images, [landingOgImage(locale)]);
    /* The landing's share card says the Owner's line; its tab and its result
       carry the plan's shorter title, within 60 characters (plan decision 5). */
    const landing = buildMetadata(locale);
    assert.equal(landing.openGraph?.title, TITLE[locale]);
    assert.equal(landing.twitter?.title, TITLE[locale]);
    assert.deepEqual(landing.title, { absolute: LANDING_META[locale].title });
    assert.ok(LANDING_META[locale].title.length <= 60, `${locale} landing title length`);
  }
  assert.match(read("./app/home/page.tsx"), /return buildAppHomeMetadata\(locale\);/);
  assert.equal(HOMEPAGE_CATEGORY, "Tokenized stock investing on Solana");
});

test("the manifest, the share card and the structured data say the same line", () => {
  const app = manifest();
  assert.equal(app.description, "Invest in tokenized stocks from $1, in your own wallet, on Solana.");
  assert.equal(app.start_url, "/app/home", "an installed app opens the app, not the site's front door");
  assert.equal(app.scope, "/", "the installed app keeps the whole site in scope");
  assert.deepEqual(HOMEPAGE_COPY.en.ogLines, ["Invest in tokenized", "stocks from $1."]);
  assert.deepEqual(HOMEPAGE_COPY.uk.ogLines, ["Інвестуй у токенізовані", "акції від $1."]);
  assert.equal(HOMEPAGE_COPY.en.ogContext, "In your own wallet, on Solana.");
  assert.equal(HOMEPAGE_COPY.uk.ogContext, "У своєму гаманці, на Solana.");
  assert.match(read("./layout.tsx"), /slogan: HOMEPAGE_COPY\.en\.tagline,/);
  assert.match(read("./opengraph-image.tsx"), /export const alt = HOMEPAGE_COPY\.en\.ogAlt;/);
  assert.match(read("./uk/opengraph-image.tsx"), /export const alt = HOMEPAGE_COPY\.uk\.ogAlt;/);
  assert.match(read("./uk/opengraph-image.tsx"), /return homepageOpenGraph\("uk"\);/, "the Ukrainian landing shares its own card");
  /* Outside the route group, so its address is the plain one the page names — inside `(home)` Next would hash it. */
  assert.equal(existsSync(new URL("./(home)/uk/opengraph-image.tsx", import.meta.url)), false);
  /* A public page without a card of its own shares the landing's, in its language, and the alt is the card's own words — never «Paper-first». */
  assert.match(read("./site/seo.ts"), /image \?\? \{ url: landingOgImage\(locale\), alt: HOMEPAGE_COPY\[locale\]\.ogAlt \}/);
  assert.doesNotMatch(read("./site/seo.ts"), /trustLine/);
});

test("the retired line is said nowhere the outside world reads", () => {
  const docs = readdirSync(new URL("./docs/content/", import.meta.url)).filter((name) => name.endsWith(".ts")).map((name) => read(`./docs/content/${name}`));
  const surfaces = [
    JSON.stringify(HOMEPAGE_COPY),
    HOMEPAGE_CATEGORY,
    JSON.stringify(manifest()),
    ...["en", "uk"].flatMap((locale) => [JSON.stringify(buildAppHomeMetadata(locale)), JSON.stringify(buildMetadata(locale))]),
    read("./seo.ts"),
    read("./site/seo.ts"),
    read("./manifest.ts"),
    read("./layout.tsx"),
    read("./brand/homepage-og.tsx"),
    read("./company/company-copy.ts"),
    read("./contact/contact-copy.ts"),
    read("./security/security-copy.ts"),
    read("./methodology/methodology-copy.ts"),
    read("./developers/developers-copy.ts"),
    read("./(home)/landing-copy.ts"),
    read("./(home)/landing-meta.ts"),
    ...docs,
  ];
  for (const text of surfaces) assert.doesNotMatch(text, RETIRED);
});

test("«Що ти купуєш» names the PreStocks fee the chain states, never a typed rate", () => {
  for (const locale of ["en", "uk"]) {
    const plain = helpTopic("truthPreStocks", locale).short;
    assert.doesNotMatch(plain, /\d\s?%|today|зараз|\{fee\}/u, "without a reading the line names no rate");
    /* The page formats the chain's figure once; the help line carries that same text. */
    assert.match(helpTopic("truthPreStocks", locale, { fee: "3.0%" }).short, /transfer \(3\.0%\);|переказ \(3\.0%\);/u, "3 % from epoch 1043 on seven tokens");
    assert.match(helpTopic("truthPreStocks", locale, { fee: "1.0%" }).short, /\(1\.0%\)/);
    assert.doesNotMatch(helpTopic("truthPreStocks", locale, { fee: "" }).short, /%|\(\)/);
    assert.doesNotMatch(helpTopic("truthPreStocks", locale, { fee: null }).short, /%/);
  }
  const block = read("./app/stocks/[ticker]/company-facts-blocks.tsx");
  assert.match(block, /const fee = feeBps !== null && feeBps > 0 \? pctShort\(feeBps \/ 100, lang\) : null;/, "one reading of the chain, one format");
  assert.match(block, /helpTopic\(topic, locale, \{ fee \}\)\.short/);
  assert.match(block, /<Help topic=\{topic\} locale=\{locale\} fee=\{fee\} \/>/);
  assert.doesNotMatch(read("./docs/content/trade.ts"), /1% today|зараз 1%/);
});

test("the sitemap and robots name only what is live", async () => {
  const entries = sitemapEntries(["NVDAx", "SPACEX"]);
  assert.equal(entries[0].url, SITE, "the landing in English comes first");
  assert.equal(entries[1].url, SITE + "/uk", "then the landing in Ukrainian");
  for (const entry of entries.slice(0, 2)) {
    assert.equal(entry.priority, 1);
    assert.deepEqual(entry.alternates?.languages, { en: SITE, uk: SITE + "/uk", "x-default": SITE }, "each names its language pair");
  }
  for (const path of [APP_HOME_PATH, "/app/markets", "/app/stocks/NVDAx", "/app/stocks/SPACEX"]) {
    const english = entries.find((entry) => entry.url === SITE + path);
    const ukrainian = entries.find((entry) => entry.url === `${SITE}/uk${path}`);
    assert.ok(english && ukrainian, `${path} is advertised at both addresses`);
    assert.ok(english.priority < 1, `${path} sits under the landing`);
    assert.deepEqual(english.alternates?.languages, { en: SITE + path, uk: `${SITE}/uk${path}`, "x-default": SITE + path });
    assert.deepEqual(ukrainian.alternates, english.alternates);
  }
  const rows = await nextConfig.redirects();
  const redirected = new Set(rows.map((row) => row.source).filter((source) => !source.includes(":")));
  for (const entry of entries) {
    const path = entry.url.replace(SITE, "") || "/";
    assert.ok(!redirected.has(path), `${path} redirects and must not be advertised`);
  }
  /* `/company` is a page again and advertised since the public pages of the new site (2026-09-26), in both languages since subtask 4. */
  assert.ok(entries.find((entry) => entry.url === SITE + "/company"), "/company is advertised again");
  assert.ok(entries.find((entry) => entry.url === SITE + "/uk/company"), "and at its Ukrainian address");
  for (const gone of ["/en", "/ua", "/docs/developers", "/docs/developers/guard", "/docs/developers/agent-control", "/app/portfolio", "/uk/legal/terms"]) {
    assert.equal(entries.find((entry) => entry.url === SITE + gone), undefined, `${gone} is not advertised`);
  }
  /* Kept for whoever holds the link, and say so themselves. */
  /* The Guard reference asserts the same beside itself (`guard-reference.test.mjs`). */
  for (const file of ["./docs/developers/page.tsx", "./docs/developers/agent-control/page.tsx"]) {
    assert.match(read(file), /index: false,/, `${file} is reachable but not offered to the index`);
  }

  const policy = robots();
  const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
  for (const rule of rules.filter((item) => item.allow)) {
    assert.deepEqual(rule.allow, ["/", "/app/home$", "/app/markets$", "/app/stocks/", "/uk/app/home$", "/uk/app/markets$", "/uk/app/stocks/"], "the site, Home, Markets and the companies' pages — at both addresses — are open");
    assert.ok(rule.disallow.includes("/app/") && rule.disallow.includes("/uk/app/"), "the rest of the cabinet stays out, in either language");
    assert.ok(!rule.disallow.includes("/app$"), "/app itself is the one hop to Home");
  }
  assert.doesNotMatch(JSON.stringify(policy), /strategy-lab-qa/, "robots names no route that no longer exists");
});
