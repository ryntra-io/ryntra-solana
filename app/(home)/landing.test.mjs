// Run from repo root: node --test "app/(home)/landing.test.mjs"
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { LANDING_COPY, LANDING_PATH, SHOTS_TAKEN } from "./landing-copy.ts";
import { landingJsonLd, landingJsonLdScript } from "./landing-jsonld.ts";
import { LANDING_META } from "./landing-meta.ts";
import { SHOT_NAMES, SHOT_SIZE, SHOT_THEMES, shotSrc } from "./landing-shots.ts";
import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { FEES, readinessOf } from "../docs/content/facts.ts";
import { MIN_BUY_USD } from "../app/invest/company-model.ts";
import { INVEST_WORDS } from "../app/invest/invest-words.ts";
import { HELP_TOPICS } from "../shell/help-topics.ts";
import { RULE_KINDS } from "../../lib/api/v1/contract.ts";
import { RULE_PAYMENT_MODES } from "../../lib/autoinvest/payments.ts";
import { BUDGET_MINIMUM_USD, PRICE_CONDITION_PRESETS_PCT, RULE_DIP_PRESETS_PCT } from "../../lib/autoinvest/limits.ts";
import { REWARD_RATE_BPS } from "../../lib/rewards/model.ts";
import { needsDevelopmentRepository } from "../../lib/development-repository.mjs";

/*
 * The landing of the new site (2026-09-26): the original hero, orbit,
 * workflow and Rewards with the new words, and the new blocks in the same
 * design. What these tests hold is what the page may say:
 *
 *   - the first screen — the landing's line word for word and one action;
 *   - «Працює зараз» — every item tied to the code that does it on production;
 *   - «Будуємо» and «Далі» — plain words with no date, id or figure, drawn
 *     on the landing only;
 *   - the pictures — every one a file of `ryntra.io` screens, at its size;
 *   - the words — both languages the same shape, the product's own names,
 *     no forbidden word, nothing internal.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(path, import.meta.url));
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const LOCALES = ["en", "uk"];
/* The original blocks and the new ones, as `homepage.tsx` mounts them. */
const BLOCK_FILES = ["./hero.tsx", "./universe.tsx", "./workflow.tsx", "./workflow-cards.tsx", "./rewards.tsx", "./landing-blocks.tsx", "./autoinvest-block.tsx"];

function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]));
  return typeof value;
}

/** The words of `HOMEPAGE_COPY` the mounted blocks and the chrome print — not the parked heroes' keys. */
function renderedHomepageWords(locale) {
  const c = HOMEPAGE_COPY[locale];
  const h = c.hero;
  return {
    titleLines: c.titleLines,
    open: c.open,
    statuses: c.statuses,
    hero: { eyebrow: h.eyebrow, sub: h.sub, lead: h.lead, min: h.min, open: h.open, motto: h.motto, rail: h.rail, strip: h.strip, portfolio: h.portfolio, rewards: h.rewards, productNote: h.productNote, builtOn: h.builtOn },
    universe: c.universe,
    workflow: c.workflow,
    rewards: c.rewards,
    footer: c.footer,
  };
}

test("the first screen is the landing's line and one action, in both languages", () => {
  assert.equal(HOMEPAGE_COPY.uk.titleLines.join(" ").replace(/ /g, " "), "Купи частинку компанії від $1 — у своєму гаманці.");
  assert.equal(HOMEPAGE_COPY.en.titleLines.join(" "), "Buy a piece of a company from $1 — in your own wallet.");
  assert.equal(HOMEPAGE_COPY.uk.hero.open, "Відкрити застосунок");
  assert.equal(HOMEPAGE_COPY.en.hero.open, "Open the app");
  for (const locale of LOCALES) {
    const c = HOMEPAGE_COPY[locale];
    assert.equal(c.rewards.open, c.hero.open, "the close repeats the one action, never a second");
    assert.equal(c.workflow.open, c.hero.open, "and so does the workflow's");
    assert.equal(c.open, c.hero.open, "the header's button says the same words");
  }
  assert.deepEqual(LANDING_PATH, { en: "/", uk: "/uk" });

  /* One headline on the page: the hero's; every other block opens with a second-level one. */
  const headlines = BLOCK_FILES.map((file) => (withoutComments(read(file)).match(/<h1\b/g) ?? []).length);
  assert.equal(headlines.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(headlines[0], 1, "the one headline is the hero's");
  /* A two-line heading reads as one sentence to a machine: a space between its lines ("company from", not "companyfrom"). */
  for (const file of BLOCK_FILES) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(source, /titleLines\[0\]\}<\/span>\s*<span/, `${file}: the heading's lines run together`);
    assert.doesNotMatch(source, /titleLines\.map\(\(line\) =>/, `${file}: the heading's lines run together`);
  }
  assert.match(read("./hero.tsx"), /\{index > 0 \? " " : null\}\{line\}/);
  /* Every «Відкрити застосунок» opens the app at Home, at the address of the page's language
     (`/uk/app/home` from `/uk`); the header's stays quiet under the hero's orange one. */
  for (const file of ["./hero.tsx", "./workflow.tsx", "./rewards.tsx"]) {
    assert.match(withoutComments(read(file)), /className=\{styles\.(?:primary|open)\} href=\{localizedPath\("\/app\/home", locale\)\}/, `${file}: the one action opens the app`);
  }
  assert.match(read("./homepage.tsx"), /ctaTone="quiet"/);
});

test("both languages carry the same page, in the product's own words", () => {
  assert.deepEqual(shape(LANDING_COPY.uk), shape(LANDING_COPY.en));
  for (const locale of LOCALES) {
    const copy = LANDING_COPY[locale];
    assert.deepEqual(copy.autoinvest.kinds.map((kind) => kind.title), ["regularly", "ifFalls", "fromPayments"].map((key) => INVEST_WORDS[key][locale]), "the three kinds of rule as the app names them");
    assert.deepEqual(copy.autoinvest.kinds.map((kind) => kind.key), [...RULE_KINDS]);
    assert.deepEqual(copy.autoinvest.extras.map((extra) => extra.title), ["monthBudget", "priceCondition"].map((key) => INVEST_WORDS[key][locale]));
    assert.deepEqual(copy.buy.issuers.map((row) => row.label), ["truthXStocks", "truthBackpack", "truthPreStocks"].map((id) => HELP_TOPICS[id].title[locale]), "the issuers' labels as the company page shows them");
    assert.doesNotMatch(copy.buy.issuers[2].line, /\{fee\}|\d\s?%/u, "the PreStocks fee is read from the chain on the company page; the landing states no rate");
  }
  /* The workflow's cards speak the purchase sheet's words: the Review's four lines, the loss limit, the rule. */
  const cards = read("./workflow-cards.tsx");
  for (const locale of LOCALES) {
    for (const key of ["review", "rowSpend", "rowGet", "rowCosts", "rowWhat", "lossLimit", "limitNone", "priceCondition", "monthBudget", "timeToBuy"]) {
      assert.ok(cards.includes(`"${INVEST_WORDS[key][locale]}"`), `${locale}: the card says «${INVEST_WORDS[key][locale]}» as the app does`);
    }
  }
  /* The Autoinvest block's reminder is the app's own. */
  assert.match(read("./landing-blocks.tsx"), /head: INVEST_WORDS\.timeToBuy\[locale\],[\s\S]*?action: buyByRuleWord\(locale, 1\),/);
});

test("the landing's metadata fits a search result and the share card carries the landing's line", () => {
  for (const locale of LOCALES) {
    const meta = LANDING_META[locale];
    assert.equal(LANDING_COPY[locale].meta, meta);
    assert.ok(meta.title.length <= 60, `${locale} title ${meta.title.length}`);
    assert.ok(meta.description.length > 100 && meta.description.length <= 160, `${locale} description ${meta.description.length}`);
    assert.equal(meta.ogTitle, HOMEPAGE_COPY[locale].seoTitle, "the landing's line, word for word");
    assert.equal(meta.ogAlt, HOMEPAGE_COPY[locale].ogAlt);
    assert.match(meta.title, /\$1/);
    assert.match(meta.description, /\$1/);
  }
});

test("the structured data is the page's own: the app, free to open, and the questions it shows — no rating invented", () => {
  for (const locale of LOCALES) {
    const [app, faq] = landingJsonLd(locale);
    const copy = LANDING_COPY[locale];
    assert.equal(app["@type"], "SoftwareApplication");
    assert.equal(app.inLanguage, locale);
    assert.equal(app.url, locale === "uk" ? "https://ryntra.io/uk" : "https://ryntra.io");
    assert.deepEqual(app.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
    assert.deepEqual(app.featureList, copy.status.now.items.map((item) => item.text), "the graph says no more than «Працює зараз»");
    assert.equal(faq["@type"], "FAQPage");
    assert.deepEqual(faq.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]), copy.faq.items.map((item) => [item.q, item.a]));
    const script = landingJsonLdScript(locale);
    assert.doesNotMatch(script, /aggregateRating|"review"|ratingValue/, "no rating the product does not have");
    assert.doesNotMatch(script, /</, "nothing in the graph can close its script");
  }
});

/**
 * «Працює зараз»: each item and the code on production that does it. A new
 * item with no check here fails — the page may not claim what nothing proves.
 */
const WORKS_NOW = {
  purchase: () => {
    assert.equal(MIN_BUY_USD, 1, "a purchase from $1");
    const sheet = read("../app/stocks/[ticker]/buy-sheet.tsx");
    assert.match(sheet, /data-sheet="review"/);
    assert.match(sheet, /data-sheet="receipt"/);
    /* The sale from a position, on the company page and in Portfolio — the purchase's Review and receipt on the sale's side. */
    const sale = read("../app/stocks/[ticker]/sell-sheet.tsx");
    assert.match(sale, /side: SPOT_SALE_SIDE/);
    assert.match(sale, /data-sheet="review"/);
    assert.match(sale, /data-sheet="receipt"/);
    assert.match(read("../app/stocks/[ticker]/company-live.tsx"), /<SellSheet /);
    assert.match(read("../solana/workspace/holdings/holdings-card.tsx"), /<PositionSale /);
  },
  listed: () => {
    assert.ok(HELP_TOPICS.truthXStocks && HELP_TOPICS.truthBackpack);
    assert.ok(exists("../../lib/stocks/issuer-xstocks.server.ts"));
    assert.match(read("../../lib/stocks/shelf.ts"), /backpack|xstocks/i);
  },
  private: () => {
    assert.ok(HELP_TOPICS.truthPreStocks);
    assert.ok(exists("../../lib/stocks/issuer-prestocks.server.ts"));
    assert.match(read("../../lib/stocks/shelf.ts"), /prestocks/i);
  },
  autoinvest: () => {
    assert.deepEqual([...RULE_KINDS], ["schedule", "dip", "payments"]);
    assert.deepEqual([...RULE_PAYMENT_MODES], ["roundup", "fixed", "percent"]);
    assert.ok(RULE_DIP_PRESETS_PCT.length > 0);
    assert.ok(exists("../app/autoinvest/page.tsx"));
  },
  budget: () => {
    assert.equal(BUDGET_MINIMUM_USD, 1);
    assert.ok(PRICE_CONDITION_PRESETS_PCT.length > 0);
  },
  company: () => {
    assert.ok(exists("../app/stocks/[ticker]/company-path.tsx"));
    assert.ok(exists("../app/stocks/[ticker]/company-facts-blocks.tsx"));
    const events = read("../../lib/stocks/lifecycle-events.ts");
    assert.match(events, /SPACEX/);
    assert.match(events, /SPCXx/);
  },
  portfolio: () => {
    assert.equal(readinessOf("portfolio"), "available");
    assert.equal(readinessOf("activity"), "available");
    assert.ok(exists("../api/v1/notifications/telegram/route.ts"));
  },
  rewards: () => {
    /* Half the fee back and the referrals stay on the page. */
    assert.equal(readinessOf("rewards"), "available");
    assert.equal(REWARD_RATE_BPS.CASHBACK, 5000, "up to half of the fee back");
    assert.ok(REWARD_RATE_BPS.REFERRAL_L1 > 0 && REWARD_RATE_BPS.REFERRAL_L2 > 0, "two levels of referral");
  },
  assistant: () => {
    assert.ok(exists("../app/ryn/page.tsx"));
  },
  experienced: () => {
    for (const id of ["spot", "swap", "bridge", "send", "receive"]) assert.equal(readinessOf(id), "available", `${id} is live`);
  },
};

test("«Працює зараз» — every item is tied to the code that does it on production", () => {
  for (const locale of LOCALES) {
    const keys = LANDING_COPY[locale].status.now.items.map((item) => item.key);
    assert.deepEqual(new Set(keys), new Set(Object.keys(WORKS_NOW)), `${locale}: every item has its proof, every proof its item`);
  }
  for (const [key, check] of Object.entries(WORKS_NOW)) {
    assert.doesNotThrow(check, `«${key}» is not proven by the code`);
  }
  /* The Android app is not released (no signing key; `assetlinks.json` is `[]`): «Будуємо» only, never «Працює зараз». */
  for (const locale of LOCALES) {
    assert.doesNotMatch(JSON.stringify(LANDING_COPY[locale].status.now), /Android|Seeker/);
  }
});

test("«Будуємо» and «Далі» carry no dates, ids or figures, and only the landing draws them", () => {
  for (const locale of LOCALES) {
    const items = [...LANDING_COPY[locale].status.building.items, ...LANDING_COPY[locale].status.next.items];
    for (const item of items) {
      /* No dates, no ids, no per cents on the page. */
      assert.doesNotMatch(item.text, /\d|RYN-|\bM\d/u, `${locale}: «${item.text}» carries a date, an id or a figure`);
    }
  }
  /* Nowhere but the landing: the app draws no roadmap; only `/` and `/uk` show one. */
  assert.doesNotMatch(read("../app/home/page.tsx"), /status\.building|status\.next|landing-copy/);
});

/* A word, not a part of one: Cyrillic letters are not `\w`, so `\b` cannot bound them. */
const word = (source) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "iu");

test("the words: nothing forbidden, nothing internal, no typed fee", () => {
  const text = JSON.stringify([LANDING_COPY, LOCALES.map(renderedHomepageWords)]);
  const forbidden = [
    word("скоро|soon|coming soon|у планах"),
    word("DCA|Autopilot|автопілот|passive income|пасивн\\p{L}* дох\\p{L}*"),
    word("гарантован\\p{L}*|guarantee\\p{L}*|безпечн\\p{L}*|safe|safely|без ризику|risk-free|without risk"),
    word("перші|єдин[іиа]|єдиний|the only|first-ever|first ever"),
    word("справжн\\p{L}* акці\\p{L}*|real shares?"),
    word("one signature|один підпис"),
    /(?<![\p{L}])Ryn(?![\p{L}])/u,
    word("радник\\p{L}*|консультант\\p{L}*|adviser|advisor|регульован\\p{L}*|regulated|прогноз ШІ|AI forecast|у межах закону|найкраще для тебе|рекомендуємо купити"),
    word("Professional Trading|Trade with a plan|Торгуйте за планом|Торгуй за планом"),
    /RYN-|\bWIP\b/u,
    word("canon|канон\\p{L}*|hackathon|хакатон\\p{L}*|grants?|грант\\p{L}*"),
  ];
  for (const pattern of forbidden) {
    const found = pattern.exec(text);
    assert.equal(found, null, `the page says «${found?.[0]}» (${pattern})`);
  }
  /* The fee is the code's own figure, never typed into a sentence. */
  for (const locale of LOCALES) {
    const answer = LANDING_COPY[locale].faq.items[3].a;
    assert.ok(answer.includes(FEES.swap), `${locale}: the fee is FEES.swap`);
  }
  assert.doesNotMatch(withoutComments(read("./landing-copy.ts")), /\d(?:[.,]\d+)?\s?%/u, "no per cent typed into the landing's words");
});

test("every picture is a screen of ryntra.io, in both languages and both themes, at its own size", { skip: needsDevelopmentRepository("the screenshot script scripts/site/capture-landing-shots.mjs") }, async () => {
  assert.match(SHOTS_TAKEN, /^\d{4}-\d{2}-\d{2}$/);
  for (const name of SHOT_NAMES) {
    for (const locale of LOCALES) {
      for (const theme of SHOT_THEMES) {
        const src = shotSrc(name, locale, theme);
        const file = new URL(`../../public${src}`, import.meta.url);
        assert.ok(existsSync(file), `${src} is missing`);
        const meta = await sharp(fileURLToPath(file)).metadata();
        assert.equal(meta.format, "webp", `${src} is WebP`);
        assert.deepEqual({ width: meta.width, height: meta.height }, { ...SHOT_SIZE }, `${src} is ${meta.width}×${meta.height}`);
      }
    }
  }
  /* Every shot the page mounts is one the manifest knows, and every one it knows is mounted. */
  const blocks = read("./landing-blocks.tsx");
  const autoinvest = read("./autoinvest-block.tsx");
  const mounted = [...blocks.matchAll(/<Shot name="([a-z]+)"/g)].map((match) => match[1]);
  const kinds = /const KIND_SHOTS = \{([^}]*)\}/.exec(autoinvest)?.[1] ?? "";
  mounted.push(...[...kinds.matchAll(/: "([a-z]+)"/g)].map((match) => match[1]));
  assert.deepEqual(new Set(mounted), new Set(SHOT_NAMES));
  /* The capture script photographs a guest: no wallet is ever connected. */
  const script = read("../../scripts/site/capture-landing-shots.mjs");
  assert.doesNotMatch(script, /wallet-standard:register-wallet|standard:connect/);
});

test("the new blocks are the landing's own design: its ground and ink, the reader's theme, motion that waits for the reader", () => {
  const page = read("./homepage.tsx");
  const css = read("./blocks.module.css");
  assert.equal((page.match(/<PublicHeader\b/g) ?? []).length, 1);
  assert.equal((page.match(/<FrozenFooter\b/g) ?? []).length, 1);
  assert.match(page, /<main id="main-content" className=\{styles\.page\} tabIndex=\{-1\}>/);
  /* The two themes' pictures: the page shows the one that matches `data-theme`. */
  assert.match(css, /\.shotLight \{ display: none; \}/);
  assert.match(css, /:global\(\[data-theme="light"\]\) \.shotLight/);
  assert.match(css, /:global\(\[data-theme="light"\]\) \.shotDark/);
  /* Drawn on the landing's tokens, so the light theme is the same drawing on a light ground. */
  assert.match(css, /var\(--landing-ink\)/);
  assert.doesNotMatch(withoutComments(css), /#[0-9A-Fa-f]{3,8}\b/, "no hex literal in the stylesheet");
  /* Nothing moves under reduced motion; the reveal and the turning rules wait for the block to be seen. */
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const file of ["./reveal.tsx", "./autoinvest-block.tsx"]) {
    const source = withoutComments(read(file));
    assert.match(source, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/, `${file} reads the reader's motion preference`);
    assert.match(source, /new IntersectionObserver/, `${file} moves only on screen`);
  }
  assert.doesNotMatch(BLOCK_FILES.map(read).join("\n"), /framer-motion|gsap|lenis|lottie/, "no library carries the motion");
});
