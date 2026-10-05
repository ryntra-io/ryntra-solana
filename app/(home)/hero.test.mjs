import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { homepageModel } from "../../lib/site/homepage-model.ts";
import { SOLANA_UK_TEXT } from "../solana/workspace/i18n/catalog.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");

/*
 * The hero. Three things live here.
 *
 * The mounted hero (`hero.tsx`) is the finished render's composition drawn
 * in code (2026-09-14): the words, the Spot workspace in a tilted device,
 * the two cards, the rail and the strip as HTML on the page's own light
 * (hero-atmosphere.tsx). The render it replaced (`hero-render.tsx`, with
 * `hero-art.png`) and the first drawn hero before it (`hero-drawn.tsx`) are
 * parked, not deleted, and keep their tests below so either can be mounted
 * again as it was.
 *
 * What these pin is the shape the design asks for and the honesty rules the
 * page lives by, not the pixels: the pixels were looked at on rendered pages
 * at 2560, 1440 and 390 px before release.
  */

test("the mounted hero is drawn in code: the words, the workspace in a device, two cards, the rail and the strip", () => {
  const hero = withoutComments(read("app/(home)/hero.tsx"));
  assert.doesNotMatch(hero, /hero-art|next\/image|<Image/, "no picture: the hero is HTML on the page's light");
  assert.match(hero, /import \{ HeroAtmosphere \} from "\.\/hero-atmosphere";/);
  assert.match(hero, /import \{ HeroTerminal \} from "\.\/hero-terminal";/);
  assert.match(hero, /<HeroAtmosphere \/>/);
  /* The words, real. */
  assert.match(hero, /<h1 id="homepage-title"/);
  assert.match(hero, /c\.titleLines\.map/);
  assert.match(hero, /\{h\.sub\}[\s\S]*?\{h\.lead\}/);
  assert.match(hero, /className=\{styles\.primary\} href=\{localizedPath\("\/app\/home", locale\)\}[\s\S]*?\{h\.open\}/, "«Відкрити застосунок» opens the app at Home, the first of its places — `/uk/app/home` from `/uk`");
  /* The device holds the drawn workspace and a note for the reader who cannot see it. */
  assert.match(hero, /<div className=\{styles\.screen\}>\s*<span className=\{styles\.srOnly\}>\{h\.productNote\}<\/span>\s*<HeroTerminal locale=\{locale\} \/>/);
  /* The two cards, the rail of three and the strip of four, all from the copy. */
  assert.match(hero, /\{h\.portfolio\.rows\.map/);
  assert.match(hero, /\{h\.rewards\.rows\.map/);
  assert.match(hero, /\{h\.builtOn\} \{h\.solana\}/);
  assert.match(hero, /\{h\.rail\[0\]\}[\s\S]*?\{h\.rail\[1\]\}/);
  assert.match(hero, /\{h\.strip\.map\(/);
  assert.match(hero, /\{h\.motto\}/);
  assert.match(hero, /status !== "AVAILABLE" \? <span className=\{styles\.stripStatus\}>\{c\.statuses\[status\]\}<\/span> : null/, "a status chip appears exactly when the route is not available");
  /* The strip's four ways in: a company from $1, the rules, the private companies, the fee back. */
  assert.match(hero, /invest: "\/app\/markets"/);
  assert.match(hero, /autoinvest: "\/app\/autoinvest"/);
  assert.match(hero, /private: "\/app\/markets\?tab=private"/);
  assert.match(hero, /rewards: "\/app\/rewards"/);
  for (const locale of ["en", "uk"]) {
    const h = HOMEPAGE_COPY[locale].hero;
    assert.ok(h.motto.length > 8, `${locale}: the strip's end line`);
    assert.doesNotMatch(JSON.stringify(h.strip), /deep liquidity/i, "no claim of depth the product does not make");
  }
  /* The render and the first drawn hero are parked, not mounted. */
  assert.doesNotMatch(read("app/(home)/homepage.tsx"), /hero-drawn|hero-render/);
  assert.match(read("app/(home)/homepage.tsx"), /<Hero locale=\{locale\}/);
});

test("the hero's light is the page's own, stays inside the section, and the scene moves honestly", () => {
  const css = read("app/(home)/hero.module.css");
  const atmosphere = withoutComments(read("app/(home)/hero-atmosphere.tsx"));
  /* Transparent over the landing's one ground; no light at the foot. */
  assert.match(css, /\.hero \{[\s\S]*?background: transparent;/);
  assert.match(css, /overflow: clip;/);
  assert.match(css, /\.horizon \{[\s\S]*?bottom: 12%;[\s\S]*?transparent 70%\)/, "the horizon's light is zero before the section's foot");
  assert.doesNotMatch(css, /at 50% 100%|at 50% 0%/, "nothing lights an edge of the section");
  assert.match(css, /\.arc \{[\s\S]*?border-radius: 50%;/, "the arc is the edge of a circle, drawn");
  /* The light breathes on long clocks, only on screen, and stands still under reduced motion. */
  assert.match(css, /animation: arcBreath 14s ease-in-out infinite alternate;/);
  assert.match(css, /animation: horizonBreath 11s ease-in-out infinite alternate;/);
  assert.match(css, /\.hero\[data-js\]:not\(\[data-active\]\) \.arc[\s\S]*?animation-play-state: paused;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.hero \*, \.hero \*::before, \.hero \*::after \{ animation: none !important; transition: none !important; \}/);
  assert.match(atmosphere, /section\.dataset\.js = "";/);
  assert.match(atmosphere, /new IntersectionObserver/);
  /* No plane cuts another: perspective on the stage, no preserve-3d anywhere,
     so the device's and the cards' shadows may be ordinary. */
  assert.match(css, /\.visual \{[^}]*perspective: 2400px;/);
  assert.doesNotMatch(withoutComments(css), /preserve-3d/);
  /* The entrances move `translate`, never `transform`, so the device and the
     cards keep their turn after the animation ends. */
  assert.match(css, /@keyframes heroRise \{ from \{ opacity: 0; translate: 0 24px; \} to \{ opacity: 1; translate: 0 0; \} \}/);
  assert.match(css, /@keyframes heroDevice \{ from \{ opacity: 0; translate: 0 28px; \} to \{ opacity: 1; translate: 0 0; \} \}/);
  /* The headline is sized to its column: the first screen's line is two long lines,
     each may wrap once, balanced, and never runs out of its column. */
  assert.match(css, /\.copy \{[^}]*container-type: inline-size;/);
  assert.match(css, /\.h1 \{[\s\S]*?font-size: min\(clamp\(var\(--ry-fs-h2\), 3vw, var\(--ry-fs-display\)\), 8\.2cqw\);/);
  assert.match(css, /\.h1 span \{ display: block; text-wrap: balance; \}/);
  /* The scene recedes under the scroll while the universe rises. */
  assert.match(css, /@supports \(animation-timeline: view\(\)\)[\s\S]*?\.scene \{ animation: heroRecede linear both; animation-timeline: view\(\); animation-range: cover 47% cover 100%;/);
  /* One continuous ground for the landing, painted on the root and the page. */
  assert.match(read("app/(home)/landing.module.css"), /\.root \{\s*--landing-ground: color-mix\(in srgb, var\(--ry-midnight\) 30%, black\);[\s\S]*?background: var\(--landing-ground\);\s*\}[\s\S]*?\.page \{ background: var\(--landing-ground\); \}/);
  /* The terminal scales with the screen it sits on, not with JavaScript. */
  assert.match(css, /\.screen \{[^}]*aspect-ratio: 900 \/ 560;[^}]*container-type: inline-size;/);
});

test("the render is parked as it was and can be mounted again", () => {
  const render = withoutComments(read("app/(home)/hero-render.tsx"));
  assert.match(render, /import heroArt from "\.\/hero-art\.png"/);
  assert.ok(existsSync(new URL("./hero-art.png", import.meta.url)));
  assert.match(render, /const OPEN_APP_AREA = \{ left: "8\.8%", top: "49\.2%", width: "15\.5%", height: "8\.8%" \}/);
  assert.match(render, /import styles from "\.\/hero-render\.module\.css";/);
  assert.match(read("app/(home)/hero-render.module.css"), /\.artMotion \{[\s\S]*?mask-image:/);
  for (const locale of ["en", "uk"]) {
    const h = HOMEPAGE_COPY[locale].hero;
    assert.match(h.imageAlt, /NVDAx/);
    assert.ok(h.openArea.length > 8);
  }
});

/* ── the parked drawn hero (hero-drawn.tsx), kept as it was ─────────────── */

test("the drawn hero keeps its composition: one headline, four proof points, three rail lines", () => {
  for (const locale of ["en", "uk"]) {
    const c = HOMEPAGE_COPY[locale];
    assert.equal(c.titleLines.length, 2, "two headline lines, the second in orange");
    assert.deepEqual(c.hero.strip.map((item) => item.id), ["invest", "autoinvest", "private", "rewards"]);
    assert.equal(c.hero.rail.length, 3, "Built on Solana and three proof lines, nothing else");
    assert.equal(c.hero.features.length, 3);
    /* The body is kept short: one breath, not a paragraph. */
    assert.ok(c.hero.lead.length <= 160, `the lead stays short (${c.hero.lead.length})`);
    assert.ok(c.hero.lead.split(". ").length <= 2, "at most two sentences");
  }
  /* The first screen's line word for word, one action. */
  assert.deepEqual(HOMEPAGE_COPY.en.titleLines, ["Buy a piece of a company", "from $1 — in your own wallet."]);
  assert.deepEqual(HOMEPAGE_COPY.uk.titleLines.map((line) => line.replace(/ /g, " ")), ["Купи частинку компанії", "від $1 — у своєму гаманці."]);
  assert.equal(HOMEPAGE_COPY.en.hero.open, "Open the app");
  assert.equal(HOMEPAGE_COPY.uk.hero.open, "Відкрити застосунок");
  assert.equal(HOMEPAGE_COPY.en.hero.explore, "See the companies");
  assert.deepEqual(HOMEPAGE_COPY.en.hero.rail, ["From $1", "Onchain, 24/7", "Solana mainnet"]);
  /* EN/UA parity on the hero's own keys. */
  const shape = (value) => Array.isArray(value) ? value.length : typeof value === "object" && value ? Object.keys(value).sort().join(",") : typeof value;
  for (const key of Object.keys(HOMEPAGE_COPY.en.hero)) {
    assert.equal(shape(HOMEPAGE_COPY.uk.hero[key]), shape(HOMEPAGE_COPY.en.hero[key]), `uk hero.${key}`);
  }
});

test("nothing in the drawn hero is invented: no user, volume or partner counts, and the portfolio adds up", () => {
  const words = JSON.stringify([HOMEPAGE_COPY.en.hero, HOMEPAGE_COPY.uk.hero]);
  for (const forbidden of [/\b\d{3,}\+/, /1,000/, /\$1[0-9],[0-9]{3}/, /12,4[0-9]0/, /Diamond/i, /RYN token/i, /win[- ]rate/i, /Jupiter|Relay/]) {
    assert.doesNotMatch(words, forbidden, `the hero must not carry ${forbidden}`);
  }
  for (const locale of ["en", "uk"]) {
    const rows = HOMEPAGE_COPY[locale].hero.portfolio.rows;
    const total = rows.reduce((sum, [, share]) => sum + share, 0);
    assert.equal(Math.round(total * 10) / 10, 100, `the allocation sums to 100 (${locale})`);
    const rewards = HOMEPAGE_COPY[locale].hero.rewards.rows.map(([figure]) => figure);
    assert.deepEqual(rewards, ["50%", "10–30%", "Points"], "the real 50% cashback, the inviter's 10–30% by rank and Points, no tier or token");
  }
});

test("the drawn strip reads its statuses from the registry and never calls a building page live", () => {
  const model = homepageModel("en");
  assert.deepEqual(model.hero.map((entry) => entry.id), ["invest", "autoinvest", "private", "rewards"]);
  assert.ok(model.hero.every((entry) => entry.status === "AVAILABLE"), "every way in the strip names is open on production");
  const building = homepageModel("en", [
    { id: "stocks", href: "/app/stocks/screener", readiness: "building" },
    { id: "rewards", href: "/app/rewards", readiness: "available" },
  ], []);
  /* A company's purchase and the private companies live on the company pages, the stock route family. */
  assert.equal(building.hero.find((entry) => entry.id === "private").status, "BUILDING");
  assert.equal(building.hero.find((entry) => entry.id === "rewards").status, "AVAILABLE");
  assert.equal(homepageModel("uk", [], []).hero.find((entry) => entry.id === "rewards").status, "UNAVAILABLE");

  const hero = withoutComments(read("app/(home)/hero-drawn.tsx"));
  assert.match(hero, /status !== "AVAILABLE" \? <span className=\{styles\.stripStatus\}>\{c\.statuses\[status\]\}<\/span> : null/,
    "a status chip appears exactly when the route is not available");
});

test("every destination in the drawn hero is a real page", () => {
  const hero = withoutComments(read("app/(home)/hero-drawn.tsx"));
  assert.match(hero, /href="\/app\/swap"/, "the parked hero's Open App opens the page chosen for it then");
  assert.match(hero, /href="\/app\/stocks"/, "Explore Stocks opens the stock desk, where Buy comes first");
  /* Its strip reads the same four ways in as the mounted one. */
  assert.match(hero, /invest: "\/app\/markets"/);
  assert.match(hero, /autoinvest: "\/app\/autoinvest"/);
  assert.match(hero, /rewards: "\/app\/rewards"/);
  assert.doesNotMatch(hero, /Request beta|Open free beta|Beta bot|FLAGSHIP|ryn-[a-z]+\.webp/);
});

test("the product in the drawn hero comes from the registry and the Spot page's own words, and says it is a picture", () => {
  const terminal = withoutComments(read("app/(home)/hero-terminal.tsx"));
  assert.match(terminal, /menuNavigation\(PRODUCT_ROUTES, locale\)/, "the rail is the product's own menu, from the page registry");
  assert.match(terminal, /data-active=\{row\.id === "spot" \|\| undefined\}/, "the picture is Spot, so Spot is the lit row");
  assert.doesNotMatch(terminal, /readiness === "planned"|tSoon/, "the rail draws no locked row, so the picture cannot either");
  assert.match(terminal, /aria-hidden="true"/);
  assert.match(read("app/(home)/hero-drawn.tsx"), /<span className=\{styles\.srOnly\}>\{h\.productNote\}<\/span>/, "a screen reader gets the note instead of the picture");
  /* Every catalogue key the mock asks for exists in Ukrainian, because the
     catalogue throws on a missing key and the page must not. */
  const keys = [...terminal.matchAll(/text\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, "the mock's labels come through the catalogue");
  for (const key of keys) assert.ok(SOLANA_UK_TEXT[key], `Ukrainian for "${key}"`);
  /* The header price, the dashed line and the selected row are one number —
     the page's one NVDAx story (workflow-trade.ts), since 2026-09-14, so the
     hero and the workflow never disagree about the same market. */
  assert.match(terminal, /import \{ FIGURES, TRADE \} from "\.\/workflow-trade";/);
  assert.match(terminal, /const LAST = TRADE\.quote;/);
  assert.match(terminal, /price: FIGURES\.quote, change: FIGURES\.change24h, up: TRADE\.change24h > 0, selected: true/);
  assert.match(terminal, /<strong>\{FIGURES\.quote\}<\/strong>/);
  assert.match(terminal, /\["Liquidity", TRADE\.liquidity\]/);
  assert.match(terminal, /const SNAPSHOT_DAY = "2026-09-13";/, "the figures name the day they were read");
  assert.match(terminal, /Backed Finance/, "the issuer line the real page shows");
});

test("the drawn hero is written on the projection and moves once", () => {
  const css = read("app/(home)/hero-drawn.module.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /container-type: inline-size/, "the terminal scales with its frame, not with JavaScript");
  assert.match(css, /--u: calc\(100cqw \/ 900\)/, "one canvas pixel");
  assert.doesNotMatch(css, /animation-iteration-count|infinite/, "nothing perpetual");
  assert.doesNotMatch(css, /Onest|Plex|Space Grotesk/);
  /* The home segment inherits the root's brand faces; it loads none of its own. */
  assert.doesNotMatch(read("app/(home)/layout.tsx"), /next\/font/);
  assert.ok(existsSync(new URL("../../public/site/solana-mark.svg", import.meta.url)), "the network's mark is an asset, not a palette value");
});

test("the landing is back at its addresses: `/` in English, `/uk` in Ukrainian, the address deciding the language", () => {
  /* On 2026-09-26 the old landing's story was retired and `/` led into the
     app by a temporary 307 until the new site took `/` back. This is that
     site: the landing's design with its new words, English at `/` and
     Ukrainian at `/uk`, the temporary redirect gone. */
  const routing = withoutComments(read("lib/product/customer-routing.ts"));
  assert.doesNotMatch(routing, /\["\/", "\/app\/swap"\]/, "`/` never goes to Swap");
  const config = withoutComments(read("next.config.ts"));
  assert.doesNotMatch(config, /\{ source: "\/", destination: FRONT_DOOR/, "the temporary 307 from `/` into the app is gone");
  assert.doesNotMatch(config, /FRONT_DOOR/);
  assert.equal(existsSync(new URL("../preview/site", import.meta.url)), false, "no preview door: the landing is the site");
  for (const [file, locale] of [["app/(home)/page.tsx", "en"], ["app/(home)/uk/page.tsx", "uk"]]) {
    const route = withoutComments(read(file));
    assert.doesNotMatch(route, /cookies\(\)/, `${file}: the address decides the language, never a cookie`);
    assert.match(route, new RegExp(`export const metadata: Metadata = buildLandingMetadata\\("${locale}"\\);`), `${file}: its own title, description, canonical and hreflang`);
    assert.match(route, new RegExp(`landingJsonLdScript\\("${locale}"\\)`), `${file}: its own structured data, in its own language`);
    assert.match(route, new RegExp(`<Homepage locale="${locale}" />`), `${file}: the landing`);
  }
  /* The header, handed the page's language, writes it to the language cookie on arrival,
     so «Відкрити застосунок» on `/uk` opens the app in Ukrainian and on `/` in English. */
  assert.match(withoutComments(read("app/site/frozen/public-header.tsx")), /if \(localeProp\) \{\s*writePublicLocaleCookie\(localeProp\);/);
  assert.match(read("app/(home)/homepage.tsx"), /<PublicHeader locale=\{locale\}/);
});

test("the landing follows the reader's language and theme like every page — one chrome, one switch", () => {
  /* On 2026-09-14 the English-and-dark decision of the day before was
     reopened: the landing carries the language menu and the theme switch and
     renders in the reader's language and theme. Nothing forces dark, nothing
     forces English, nothing hides the switches. */
  const page = withoutComments(read("app/(home)/homepage.tsx"));
  assert.match(page, /<PublicHeader locale=\{locale\} mainId="main-content" landing ctaTone="quiet" languageHrefs=\{LANDING_PATH\} homeHref=\{LANDING_PATH\[locale\]\} \/>/, "the landing's look over the site's one menu, with both switches; its Open Ryntra quiet because the hero's «Відкрити застосунок» is the screen's one orange action; the language menu moves between `/` and `/uk`");
  assert.doesNotMatch(page, /controls=\{false\}|DarkOnly|DARK_BOOT|data-theme|const locale: PublicLocale = "en"/);
  assert.equal(existsSync(new URL("./dark-only.tsx", import.meta.url)), false, "the dark-only helper is gone with the decision");
  const header = withoutComments(read("app/site/frozen/public-header.tsx"));
  assert.match(header, /controls = true,/, "the switches are the default on every page");
  assert.match(header, /\{controls \? <LocaleMenu/);
  assert.match(header, /\{controls \? <ThemeControl/);
  /* The blocks are drawn on the landing's own tokens, so the light theme is
     the same drawing on a light ground: no block reads the static mist for
     its words, its dust, its hairlines or its panel. */
  const root = read("app/(home)/landing.module.css");
  assert.match(root, /:global\(\[data-theme="light"\]\) \.root, :global\(\[data-ry-theme="light"\]\) \.root \{[^}]*--landing-ground: var\(--ry-bg\);[^}]*--landing-ink: var\(--ry-text\);/);
  for (const [file, deviceLines] of [["hero.module.css", 5], ["universe.module.css", 9], ["workflow.module.css", 0], ["rewards.module.css", 0]]) {
    const css = read("app/(home)/" + file);
    assert.equal((css.match(/var\(--ry-mist\)/g) ?? []).length, deviceLines, file + ": the static mist is kept only inside the devices and the spheres");
    assert.match(css, /var\(--landing-ink\)/, file + " reads the landing's ink");
  }
  /* Each address writes its own tab words; the segment's layout writes none. */
  const layout = withoutComments(read("app/(home)/layout.tsx"));
  assert.doesNotMatch(layout, /generateMetadata|buildMetadata|cookies\(\)/);
});
