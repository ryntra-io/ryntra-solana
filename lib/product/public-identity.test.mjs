import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { ALL_LOCALES, buildMetadata } from "../../app/seo.ts";
import { HOME_COPY, LANDING_COPY } from "../../app/landing/content.ts";
import { ENABLED_LOCALE_CODES, PUBLIC_LOCALES, localeDir } from "../../app/i18n/locales.ts";
import { METHODOLOGY_SUMMARY } from "../../app/methodology/content.ts";
import { PRODUCT_IDENTITY } from "./identity.ts";
import { landingJsonLd } from "../../app/(home)/landing-jsonld.ts";
import { LANDING_COPY as SITE_LANDING_COPY } from "../../app/(home)/landing-copy.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("all public locales preserve category, trust, audience, Simple/Pro, risk, maturity, and bounded AI meaning", () => {
  // Parked since 2026-08-06, not deleted. The public surface is
  // English only, while every translation stays in the repository: the twelve
  // legacy ones, and the three home-copy locales. These two assertions are the
  // pair that keeps "parked" honest — narrowing the public list must not become
  // an excuse to delete translated work.
  assert.deepEqual(Object.keys(LANDING_COPY), [...ENABLED_LOCALE_CODES]);
  assert.deepEqual(Object.keys(METHODOLOGY_SUMMARY), [...ENABLED_LOCALE_CODES]);
  assert.deepEqual(Object.keys(HOME_COPY), ["en", "uk", "ru"]);
  assert.deepEqual(PUBLIC_LOCALES.map(({ code, shortLabel }) => [code, shortLabel]), [["en", "EN"], ["uk", "UA"]]);
  assert.deepEqual([...ALL_LOCALES], ["en", "uk"]);

  const homeClient = read("app/components/site-chrome.tsx");
  // The selector markup is retained and gated on the public locale count, so
  // unparking a locale brings the control back without a code change. Both
  // renderings must stay behind that gate rather than being deleted.
  assert.equal((homeClient.match(/\{locale\.shortLabel\}/g) ?? []).length, 2,
    "desktop and mobile selectors must keep rendering locale abbreviations");
  /* One chrome for every public page. `/methodology` used to be the second
     page this checked; it is gone, and the guarantee is now much stronger —
     every public route mounts `app/site/chrome.tsx`, which
     `app/site/site.test.mjs` asserts route by route. */
  assert.equal((homeClient.match(/PUBLIC_LOCALES\.length > 1/g) ?? []).length, 2,
    "both language controls must be gated on there being more than one public locale");
  assert.match(homeClient, /aria-label=\{locale\.label\}/,
    "abbreviated selector options must retain accessible full locale names");
  assert.equal(HOME_COPY.en.hero, PRODUCT_IDENTITY.hero);
  assert.notEqual(HOME_COPY.uk.hero, HOME_COPY.en.hero);
  assert.notEqual(HOME_COPY.ru.heroSub, HOME_COPY.en.heroSub);
  for (const copy of Object.values(HOME_COPY)) {
    for (const field of ["skip", "heroSubDegraded", "stripFineDegraded", "stripPause", "stripResume", "recheckBody", "footerBoundary"]) {
      assert.ok(copy[field]?.trim(), "HOME_COPY missing " + field);
    }
    assert.ok(copy.stage.ticketNoteDegraded.trim());
    assert.ok(copy.stage.routeUnavailable.trim());
    // The hand-authored "Next · …" row is gone: it labelled the scanner "Next"
    // while its registry badge said "In build", and gave watchlist alerts a
    // maturity the registry never assigned. Forward-looking capability may only
    // appear where a registry badge vouches for it.
    assert.equal(copy.soonLabel, undefined, "HOME_COPY must not reintroduce a hand-authored roadmap row");
    assert.equal(copy.soonItems, undefined, "HOME_COPY must not reintroduce a hand-authored roadmap row");

    // No copy field may promise time or claim an unshipped capability is arriving.
    const rendered = JSON.stringify(copy);
    assert.doesNotMatch(rendered, /coming soon|\bскоро\b|any asset|будь-якого активу|любого актива/i);
    assert.doesNotMatch(rendered, /in a minute|за хвилину|через минуту|shortly|ten seconds|десять секунд/i);
  }

  for (const locale of ENABLED_LOCALE_CODES) {
    const copy = LANDING_COPY[locale];
    assert.equal(copy.category, PRODUCT_IDENTITY.category);
    assert.equal(copy.heroTitle, PRODUCT_IDENTITY.motto);
    assert.equal(copy.trustLine, PRODUCT_IDENTITY.trustLine);
    for (const field of ["heroBody", "icp", "modeRelationship", "riskState", "riskReason", "loopScope", "analystBody", "trustBody"]) {
      assert.ok(copy[field]?.trim(), `${locale} missing ${field}`);
    }
    assert.match(copy.analystBody, /Strategy Lab/);
    assert.match(copy.analystBody, /preview|vista previa|aperçu/i);
    assert.ok(Object.values(copy.maturity).every((value) => value.trim().length > 0));
  }

  assert.match(LANDING_COPY.en.analystBody, /never approves readiness/i);
  assert.match(LANDING_COPY.en.analystBody, /or executes/i);

  assert.equal(localeDir("ar"), "rtl");
  assert.notEqual(LANDING_COPY.uk.heroBody, LANDING_COPY.en.heroBody);
  assert.notEqual(LANDING_COPY.ar.modeRelationship, LANDING_COPY.en.modeRelationship);
});

test("landing metadata follows the Solana homepage without exposing internal product-law fields", () => {
  for (const locale of ALL_LOCALES) {
    const landingMetadata = buildMetadata(locale);

    for (const metadata of [landingMetadata]) {
      /* Since 2026-09-26 the professional-platform line is retired from
         everything the outside world reads. */
      assert.equal(metadata.category, "Tokenized stock investing on Solana");
      assert.equal(metadata.other, undefined);
      assert.doesNotMatch(JSON.stringify(metadata), /Evidence OS|Weekly Risk|first shipped adapter/);
    }

    for (const metadata of [landingMetadata]) {
      const description = String(metadata.description);
      assert.ok(description.length > 40 && description.length <= 160, `${locale} metadata description length`);
      assert.equal(metadata.openGraph?.description, description);
      assert.equal(metadata.twitter?.description, description);
      assert.doesNotMatch(description, /Arcus spot|Robinhood Chain|Stock Tokens/i);
    }

    const images = landingMetadata.openGraph?.images;
    const first = Array.isArray(images) ? images[0] : images;
    assert.match(String(typeof first === "string" ? first : first?.alt), /Solana/);
  }

  /* These four identity fields used to be checked on `/methodology`. That page was
     one of four public documents restating the same boundaries and is gone; the
     fields are not, because every public surface resolves them from the landing
     model. Checking the model rather than one page's rendering of it is the
     stronger assertion — it survives the next page that renders them. */
  const model = [read("app/landing/content.ts"), read("lib/product/identity.ts")].join("\n");
  for (const field of ["icp", "modeRelationship", "arcusBoundary", "analystBody"]) {
    assert.match(model, new RegExp(field), `the public model must still carry ${field}`);
  }
});

test("the landing's structured data says no more than the page, and the parked landings keep their fail-closed rules", () => {
  /* The current landing writes its graph from its own words: the app, free to
     open, whose feature list is the page's «Працює зараз» — each item of which
     `app/(home)/landing.test.mjs` ties to the code that does it — and the
     page's own questions. It replaced the hourly registry helper of the
     landing before it, whose capabilities described a product the site no
     longer tells. */
  for (const locale of ["en", "uk"]) {
    const [app, faq] = landingJsonLd(locale);
    assert.equal(app["@type"], "SoftwareApplication");
    assert.equal(app["@id"], "https://ryntra.io/#software");
    assert.equal(app.applicationCategory, "FinanceApplication");
    assert.equal(app.inLanguage, locale);
    assert.equal(app.offers.price, "0", "the app is free to open; Ryntra's fee is a line of the Review");
    assert.equal(app.aggregateRating, undefined, "Ryntra has no ratings, and none is invented");
    assert.deepEqual(app.featureList, SITE_LANDING_COPY[locale].status.now.items.map((item) => item.text));
    assert.equal(faq["@type"], "FAQPage");
    assert.deepEqual(faq.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]), SITE_LANDING_COPY[locale].faq.items.map((item) => [item.q, item.a]));
    assert.doesNotMatch(JSON.stringify([app, faq]), /InternalCapabilityEvidence|evidence|lastVerifiedAt|RYN-|(?:app|lib|docs|scripts|output)\//i);
  }

  const home = read("app/home-client.tsx");
  const publicView = read("lib/product/public-capability-view.ts");
  const layout = read("app/layout.tsx");
  /* `/` and `/uk` are served by the `(home)` route group; each route writes
     the page's own graph and nothing assembled beside it. */
  const routes = [read("app/(home)/page.tsx"), read("app/(home)/uk/page.tsx")];

  assert.doesNotMatch(home, /from "@\/lib\/product\/capabilities"/);
  assert.match(home, /LandingPublicModel/);
  // Fail-closed truth: every "works today" card is bound to a registry
  // capability through the pure home-truth rules (state coverage lives in
  // app/landing/home-truth.test.mjs).
  assert.match(home, /isHomeCardConfirmed\(card\.capabilityId/);
  // The "what works today" list became the roadmap. The fail-closed rule moved
  // with it rather than being dropped: home-client still hands the degraded
  // verdict down, and the roadmap still swaps its lead when anything is awaiting
  // re-verification.
  assert.match(home, /<RavenRoadmap[\s\S]{0,120}degraded=\{anyCardDegraded\}/);
  const roadmap = read("app/landing/raven-roadmap.tsx");
  assert.match(roadmap, /degraded \? copy\.leadDegraded : copy\.lead/);
  const roadmapCopy = read("app/landing/raven-copy.ts");
  for (const marker of [/awaiting re-verification/, /очікує повторної перевірки/, /ждёт повторной проверки/]) {
    assert.match(roadmapCopy, marker);
  }
  // The hero moved to RavenHero, but the fail-closed rule did not move with it
  // by accident — it is asserted at its new address. home-client must still
  // hand the route verdict down, and the hero must still branch on it rather
  // than printing the confident copy unconditionally.
  assert.match(home, /<RavenHero[\s\S]{0,200}routeConfirmed=\{spotRouteConfirmed\}/);
  const ravenHero = read("app/landing/raven-hero.tsx");
  const ravenCopy = read("app/landing/raven-copy.ts");
  assert.match(ravenHero, /routeConfirmed \? copy\.lead : copy\.leadDegraded/);
  // The degraded line must say the data is unconfirmed, not just reword the
  // confident one — every locale carries its own sentence.
  for (const marker of [/unconfirmed right now/, /не підтверджені/, /не подтверждены/]) {
    assert.match(ravenCopy, marker);
  }
  assert.match(ravenHero, /MarketsStrip|href="#loop"/);
  assert.match(home, /MarketsStrip copy=\{copy\} routeConfirmed=\{spotRouteConfirmed\}/);
  // Still enforced, now where the roadmap builds its stages.
  // Fail-closed on the roadmap: an unconfirmed capability cannot light.
  assert.match(home, /confirmed \? maturityKey : "unverified"/);
  assert.doesNotMatch(home, /href="\/demo"/);
  const homeTruth = read("app/landing/home-truth.ts");
  assert.match(homeTruth, /freshness !== "fresh"/);
  assert.match(homeTruth, /rule\.modes\.includes\(capability\.mode\)/);
  assert.doesNotMatch(homeTruth, /"danger"/);

  // The living hero and the market ticker may only render real venue numbers
  // or an explicitly labelled deterministic sample. State coverage for the
  // pure rules lives in app/landing/live-market.test.mjs.
  const heroStage = read("app/landing/hero-stage.tsx");
  const strip = read("app/landing/markets-strip.tsx");
  const liveMarket = read("app/landing/live-market.ts");
  const chart = read("app/landing/hero-chart.tsx");
  const landingCss = read("app/landing/landing.css");
  assert.match(heroStage, /points:\s*SAMPLE_HERO_SERIES,[\s\S]*status:\s*"sample",[\s\S]*observedAt:\s*null/);
  assert.match(heroStage, /markRefreshing\(current\.status\)/);
  assert.match(heroStage, /href="\/robinhood\/workspace\/swap"/);
  assert.match(heroStage, /routeConfirmed \? stage\.ticketNote : stage\.ticketNoteDegraded/);
  assert.match(heroStage, /className="btn lp2-sign lp2-sign-disabled btn-sm" disabled/);
  assert.doesNotMatch(heroStage, /href="\/demo"|lp2-dot/);
  assert.match(heroStage, /expireFeedStatus\(current\.status, current\.observedAt, now\)/);
  assert.match(heroStage, /visibilitychange/);
  assert.doesNotMatch(heroStage, /Math\.random|TELEGRAM_BOT|\btrack\(/);
  assert.match(chart, /attributionLogo:\s*true/);
  assert.match(strip, /markRefreshing\(current\.status\)/);
  assert.match(strip, /"stale"/);
  assert.match(strip, /"unavailable"/);
  assert.match(strip, /status === "stale" \? copy\.stripStale : copy\.stripTitle/);
  assert.match(strip, /routeConfirmed \? copy\.stripFine : copy\.stripFineDegraded/);
  assert.match(strip, /expireFeedStatus\(current\.status, current\.observedAt, now\)/);
  assert.match(strip, /visibilitychange/);
  assert.match(strip, /aria-controls="ryntra-market-ticker"/);
  assert.match(strip, /aria-pressed=\{paused\}/);
  assert.match(landingCss, /\.lp3-rail\.is-paused \.lp3-track/);
  assert.doesNotMatch(strip, /SAMPLE|fallbackRows/);
  assert.doesNotMatch(liveMarket, /Math\.random|Date\.now/);
  assert.match(liveMarket, /if \(market\.status !== "ONLINE"\) continue/);
  assert.match(liveMarket, /LANDING_FEED_TTL_MS = 120_000/);
  assert.match(liveMarket, /findLast\(\(point\) => point\.time <= cutoff\)/);

  // The acquisition page stays intentionally shallow. Deeper capability and
  // decision-loop material belongs to Methodology and authenticated surfaces.
  assert.doesNotMatch(home, /PROOF_TX|blockscout|CapabilityMatrix|DecisionLoop|id="faq"/);
  assert.match(home, /copy\.proofStatus/);
  assert.doesNotMatch(publicView, /InternalCapabilityEvidence|evidence:\s*\{/);
  assert.doesNotMatch(layout, /\bfeatureList\b/);
  assert.match(layout, /HOMEPAGE_COPY\.en\.description/);
  for (const route of routes) {
    /* The graph comes from `landing-jsonld.ts`, which reads the page's own
       words; a route that assembled a feature list of its own would say
       something the page does not. */
    assert.match(route, /landingJsonLdScript\("(?:en|uk)"\)/);
    assert.doesNotMatch(route, /featureList\s*:/);
  }
});

test("public surfaces declare language direction, explicit surface themes, and localized ARIA names", () => {
  const rootLayout = read("app/layout.tsx");
  const publicHeader = read("app/site/frozen/public-header.tsx");
  const publicFooter = read("app/site/frozen/public-footer.tsx");
  assert.match(rootLayout, /normalizePublicLocale\(\(await cookies\(\)\)\.get\(PUBLIC_LOCALE_COOKIE\)\?\.value\)/);
  assert.match(rootLayout, /<html\s+lang=\{locale\}\s+dir="ltr"/);
  assert.match(publicHeader, /\{copy\.skip\}/);
  assert.match(publicHeader, /aria-label=\{`\$\{copy\.langSwitch\}: \$\{current\.name\}`\}/);
  assert.match(publicHeader, /role="menu"\s+aria-label=\{copy\.langSwitch\}/);
  assert.match(publicHeader, /aria-label=\{`\$\{copy\.themeSwitch\}/);
  assert.match(publicHeader, /applyThemePref\(next\)/);
  assert.match(publicFooter, /aria-label=\{copy\.brandHome\}/);

  // Retained legacy surfaces still honor their own locale and motion contract.
  const home = read("app/home-client.tsx");
  const beta = read("app/beta/page.tsx");
  const legal = read("app/legal/layout.tsx");
  const demo = read("app/demo/public-tour.tsx");

  assert.match(home, /className="lp-root" lang=\{lang\} dir=\{localeDir\(lang\)\}/);
  // Header, footer and skip link are shared with methodology; assert them where
  // they are defined rather than where they used to be inlined.
  const chrome = read("app/components/site-chrome.tsx");
  assert.match(chrome, /lp-skip-link[^>]*>\s*\{labels\.skip\}/);
  assert.match(home, /boundary=\{copy\.footerBoundary\}/);
  assert.doesNotMatch(chrome, /lp-skip-link[^>]*lang="en"/);
  assert.doesNotMatch(home, /lp2-dot|<i className="mono">\/0[2-6]<\/i>/);
  // The nav's accessible name is now derived from the labels the page supplies,
  // so it stays correct on both pages instead of naming two hardcoded sections.
  assert.match(chrome, /const navLabel = nav\.map\(\(item\) => item\.label\)\.join\(" \/ "\)/);
  assert.match(chrome, /aria-label=\{navLabel\}/);
  // The sample risk panel must stay honestly labelled and every motion layer
  // must honor prefers-reduced-motion (the panel moved into the hero stage
  // with the living hero composition).
  assert.match(read("app/landing/hero-stage.tsx"), /copy\.sample/);
  assert.match(home, /prefers-reduced-motion/);
  assert.match(read("app/landing/hero-stage.tsx"), /prefers-reduced-motion/);

  /* The skip link belongs to the shared chrome. A page must not grow a second
     one — two skip links on one page is exactly the drift that made the public
     surfaces diverge in the first place, and it is now checked against the
     documents that replaced `/methodology`. */
  /* The public pages of the new site mount their `main` in the one shared frame (`app/site/info/info.tsx`). */
  for (const page of ["app/developers/page.tsx", "app/company/page.tsx", "app/contact/page.tsx", "app/support/page.tsx", "app/security/page.tsx", "app/methodology/page.tsx"]) {
    assert.match(read(page), /<InfoPage locale=\{locale\}/, `${page} must mount the shared frame`);
  }
  for (const path of ["app/docs/docs-page.tsx", "app/site/info/info.tsx"]) {
    const doc = read(path);
    assert.doesNotMatch(doc, /rx-skip/, `${path} must not draw its own skip link`);
    assert.match(doc, /<main\b[^>]*id="main"[^>]*tabIndex=\{-1\}/,
      `${path} must mount the id the shared skip link targets`);
  }
  for (const path of ["app/docs/page.tsx", "app/docs/developers/page.tsx", "app/docs/developers/agent-control/page.tsx"]) {
    const doc = read(path);
    assert.match(doc, /<DocsPage\s+view=/, `${path} must use the shared docs composition`);
    assert.doesNotMatch(doc, /<main\b|rx-skip/, `${path} must not create a second docs landmark`);
  }
  /*
   * Every public page is now one system on the brand's dark surface (since
   * 2026-08-06). `/beta` and the legal documents each used to force a light
   * theme and draw their own header, nav and footer; both now mount the shared
   * chrome and must not grow a second one.
   */
  for (const [name, source] of [["beta", beta], ["legal", legal]]) {
    /* Both classes, both required. `public-info-surface` is the shared public
       shape; `rx` is the token scope the frozen system resolves in, and these
       pages joined it on 2026-08-18 when they left the legacy chrome. Without
       `rx` every `--ry-*` role resolves to nothing, `var()` is discarded as
       invalid at computed-value time, and the page renders on whatever the
       global sheet last set — which is exactly how /company drew a near-white
       heading on a near-white plate. */
    assert.match(
      source,
      /className="rx public-info-surface"/,
      `${name} keeps the public surface class inside the token scope`,
    );
    assert.doesNotMatch(source, /data-theme="light"/, `${name} must not force the light theme`);
    assert.match(source, /<PublicHeader/, `${name} must mount the shared header`);
    assert.match(source, /<FrozenFooter/, `${name} must mount the shared footer`);
  }
  assert.match(legal, /className="rx public-info-surface"/);
  assert.doesNotMatch(legal, /data-theme="light"/);
  assert.match(legal, /<PublicHeader/);
  assert.match(legal, /<FrozenFooter/);
  assert.doesNotMatch(legal, /className="bg-header"|className="legal-nav"|className="legal-foot"/);
  assert.match(demo, /className="lp-root public-demo"/);
});

test("obsolete identity, preview indexing, stale static OG, and public theme keys cannot return", () => {
  const publicSources = [
    "package.json",
    "README.md",
    "app/beta/page.tsx",
    "app/api/telegram/route.ts",
    "lib/beta/texts.ts",
    "app/demo/page.tsx",
    "app/demo/public-tour.tsx",
    "app/demo/terminal.tsx",
    "app/legal/terms/page.tsx",
    "app/landing/content.ts",
    "app/home-client.tsx",
  ].map(read).join("\n");
  for (const forbidden of [
    /Arcus-native/i,
    /built around the Arcus/i,
    /on top of Arcus/i,
    /Safe to trade now\?/i,
    /participates in (?:the )?.*affiliate program/i,
    /professional trading, simplified/i,
    /Live trading · soon/i,
  ]) {
    assert.doesNotMatch(publicSources, forbidden);
  }

  const demo = read("app/demo/page.tsx");
  const layout = read("app/layout.tsx");
  const landingCss = read("app/landing/landing.css");
  assert.match(demo, /robots:\s*\{ index: false, follow: false \}/);
  assert.doesNotMatch(publicSources, /ryntra-public-theme|data-public-theme|lp-theme-row/);
  assert.doesNotMatch(layout, /ryntra-public-theme|data-public-theme/);
  assert.doesNotMatch(landingCss, /data-public-theme/);
  assert.equal(existsSync(new URL("../../public/og.png", import.meta.url)), false);
  assert.doesNotMatch(read("app/seo.ts"), /STATIC_OG_FALLBACK|\/og\.png/);
});

test("no public page mounts the legacy chrome, and the mega-menu cannot come back", () => {
  /*
   * A person reported that the Workspaces mega-menu could not be understood.
   * The landing design fixes the public bar and contains no such panel, so the
   * answer was to remove it rather than restyle it: on 2026-08-18 the last
   * eight surfaces moved to `PublicHeader` and `app/site/chrome.tsx` lost its
   * final importer.
   *
   * A file nobody imports is one careless import away from returning, and this
   * one brings a second navigation system with it. The rule is therefore stated
   * where it can fail rather than left to memory. `app/components/site-chrome.tsx`
   * is a different file and is exempt: it belongs to the parked localized
   * landing, whose routes all redirect to `/`.
   */
  const roots = ["app", "lib"];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL("../../" + dir, import.meta.url), { withFileTypes: true })) {
      const rel = dir + "/" + entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (rel === "app/site/chrome.tsx") continue;
      if (rel === "app/home-client.tsx") continue; /* parked localized landing */
      if (rel === "app/site/home.tsx") continue; /* parked pre-reset landing; asserted unreferenced below */
      const source = read(rel);
      if (/from ["'][^"']*app\/site\/chrome["']|from ["']\.\/chrome["']/.test(source)) {
        if (rel.startsWith("app/site/frozen/")) continue; /* the frozen bar is a different file */
        offenders.push(rel);
      }
    }
  };
  for (const root of roots) walk(root);

  assert.deepEqual(
    offenders,
    [],
    "a page imported the legacy chrome again — it carries the mega-menu the frozen system does not have",
  );

  /*
   * The two exemptions above are only honest while they stay unreachable, so
   * that is asserted rather than assumed. `app/site/home.tsx` is the pre-reset
   * landing, preserved by the repository's own rule that parked work is
   * kept rather than deleted; nothing imports it. `app/home-client.tsx` serves
   * `/[lang]`, and every locale redirects to `/`.
   */
  const importers = [];
  const findImporters = (dir) => {
    for (const entry of readdirSync(new URL("../../" + dir, import.meta.url), { withFileTypes: true })) {
      const rel = dir + "/" + entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        findImporters(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || rel === "app/site/home.tsx") continue;
      if (/from ["'][^"']*app\/site\/home["']|from ["']\.\/home["']/.test(read(rel))) importers.push(rel);
    }
  };
  findImporters("app");
  assert.deepEqual(importers, [], "the parked pre-reset landing was imported — parked means unreferenced");
});
