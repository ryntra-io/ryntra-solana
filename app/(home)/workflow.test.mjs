import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { homepageModel } from "../../lib/site/homepage-model.ts";
import { PRICE_CONDITION_DEFAULT_PCT, RULE_MINIMUM_USD } from "../../lib/autoinvest/limits.ts";
import { LOSS_LIMIT_PRESETS } from "../../lib/plans/purchase.ts";
import { MENU_DESTINATION_IDS } from "../shell/domains.ts";
import { PRODUCT_ROUTES } from "../shell/product-routes.ts";
import { BUY, DERIVED, FIGURES, TRADE } from "./workflow-trade.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const manifest = JSON.parse(read("app/(home)/universe-assets.json"));

/*
 * How it works — the third block of the landing: the pinned stage and frame
 * (2026-09-13, late), since the new site of 2026-09-26 («$1 → «Перевірка» →
 * підпис») the road of one purchase. What these pin: the
 * six steps and their words in both languages; that every step stands on a
 * real place of the product and carries its readiness from the registry or
 * the menu, never a word of its own; that the illustrative $1 of NVDAx tells
 * one story across the six cards — the same quote, the same sum, the
 * product's own presets — and is the NVDAx the universe orbits; and the
 * motion rules the block lives by.
 */

const STEPS = ["company", "sum", "review", "sign", "receipt", "autoinvest"];
const STATUS_OF = { available: "AVAILABLE", building: "BUILDING", planned: "PLANNED", limited: "LIMITED" };

test("the workflow carries the six steps of one purchase in both languages, in their order", () => {
  for (const locale of ["en", "uk"]) {
    const w = HOMEPAGE_COPY[locale].workflow;
    assert.deepEqual(w.steps.map((step) => step.id), STEPS);
    assert.equal(w.titleLines.length, 2);
    assert.equal(w.closingLines.length, 2);
    assert.ok(w.lead.length <= 130, `${locale}: the lead is one sentence`);
    for (const step of w.steps) {
      assert.ok(step.label.length >= 2 && step.label.length <= 12, `${locale}.${step.id}: a rail label is a word or the sum`);
      assert.ok(step.title.length > 8 && step.body.length > 30, `${locale}.${step.id}: title and body`);
      assert.ok(step.crumbs.length >= 1 && step.crumbs.length <= 3, `${locale}.${step.id}: the frame's crumbs`);
      assert.equal(new Set(step.crumbs).size, step.crumbs.length, `${locale}.${step.id}: no crumb twice`);
    }
    assert.deepEqual(Object.keys(w.surfaces).sort(), ["autoinvest", "company", "history", "markets", "wallet"]);
    for (const key of ["eyebrow", "railLabel", "frameNote", "open"]) assert.ok(w[key].length > 2, `${locale}.${key}`);
  }
  const en = HOMEPAGE_COPY.en.workflow;
  assert.equal(en.eyebrow, "How it works");
  assert.deepEqual(en.titleLines, ["From a dollar", "to a receipt."]);
  assert.deepEqual(en.steps.map((step) => step.label), ["Company", "$1", "Review", "Signature", "Receipt", "Autoinvest"]);
  /* The purchase's road, word for word in Ukrainian: $1 → «Перевірка» → підпис. */
  assert.deepEqual(HOMEPAGE_COPY.uk.workflow.steps.slice(1, 4).map((step) => step.label), ["$1", "Перевірка", "Підпис"]);
  const words = JSON.stringify([HOMEPAGE_COPY.en.workflow, HOMEPAGE_COPY.uk.workflow]);
  for (const forbidden of [/\b\d{3,}\+/, /Diamond/i, /RYN token/i, /win[- ]rate/i, /guarantee/i, /profit/i, /Jupiter|Relay/, /AI signal/i, /one signature|один підпис/i]) {
    assert.doesNotMatch(words, forbidden, `the workflow must not claim ${forbidden}`);
  }
});

test("every step stands on a place of the product and shows its readiness, read from the registry or the menu", () => {
  const model = homepageModel("en").workflow;
  assert.deepEqual(model.map((entry) => entry.id), STEPS);
  const route = (id) => PRODUCT_ROUTES.find((entry) => entry.id === id);
  /* The purchase lives on the company page (the `stocks` family), the receipt in History (`activity`). */
  const registered = { sum: "stocks", review: "stocks", sign: "stocks", receipt: "activity" };
  for (const [id, pageId] of Object.entries(registered)) {
    const page = route(pageId);
    assert.ok(page, `${id} stands on a registered page`);
    assert.equal(model.find((entry) => entry.id === id).status, STATUS_OF[page.readiness], `${id} carries the registry's readiness of ${page.id}`);
  }
  /* Markets and «Автоінвест» are the menu's own destinations. */
  for (const [id, destination] of [["company", "markets"], ["autoinvest", "autoinvest"]]) {
    assert.ok(MENU_DESTINATION_IDS.includes(destination), `${id} stands on the menu's ${destination}`);
  }
  assert.deepEqual(model.map((entry) => entry.surface), ["markets", "company", "company", "wallet", "history", "autoinvest"]);
  /* Only what is built reaches a screen — every step stands on a place that works. */
  for (const entry of model) assert.equal(entry.status, "AVAILABLE", `${entry.id} shows the landing an unfinished page`);
  const copy = JSON.stringify([HOMEPAGE_COPY.en.workflow, HOMEPAGE_COPY.uk.workflow]);
  assert.doesNotMatch(copy, /in development|being built|у розробці|ще будується/i, "the landing speaks of an unfinished step");
  /* An absent registry fails closed for every step on a registered page. */
  const closed = homepageModel("en", [], []).workflow;
  for (const id of Object.keys(registered)) assert.equal(closed.find((entry) => entry.id === id).status, "UNAVAILABLE");
  const source = withoutComments(read("app/(home)/workflow.tsx"));
  assert.match(source, /homepageModel\(locale\)\.workflow/);
  assert.match(source, /\{c\.statuses\[status\]\}/, "the chip's word is the registry's");
  assert.match(source, /data-live=\{status === "AVAILABLE" \|\| undefined\}/, "only an available page lights the chip");
});

test("the illustrative trade is one story: the plan's rule makes the position the ticket spends and the result compares", () => {
  assert.equal(TRADE.symbol, "NVDAx");
  const orbit = manifest.assets.find((asset) => asset.symbol === TRADE.symbol);
  assert.equal(TRADE.mint, orbit.mint, "the same NVDAx the universe orbits");
  assert.equal(TRADE.icon, orbit.icon);
  assert.ok(existsSync(new URL(`../../public/site/universe/${TRADE.icon}`, import.meta.url)));
  /* The market's two figures are the Spot header's, and the hero's workspace
     reads them from here too — one story on the whole page (2026-09-14). */
  assert.match(read("app/(home)/hero-terminal.tsx"), /\["Liquidity", TRADE\.liquidity\]/);
  assert.match(read("app/(home)/hero-terminal.tsx"), /\["Volume 24h", TRADE\.volume24h\]/);
  assert.match(TRADE.liquidity, /^\$\d+(\.\d+)?M$/);
  /* The arithmetic. */
  assert.equal(DERIVED.units, Number((TRADE.spend / TRADE.quote).toFixed(2)));
  assert.equal(DERIVED.riskAtInvalidation, Number(((TRADE.spend * (TRADE.entry - TRADE.invalidation)) / TRADE.entry).toFixed(2)));
  assert.equal(DERIVED.riskAtInvalidation, 32.56);
  assert.equal(DERIVED.rewardToRisk, 1.9);
  assert.equal(DERIVED.deviationPercent, 0.1);
  assert.ok(TRADE.invalidation < TRADE.quote && TRADE.quote <= TRADE.entry && TRADE.entry < TRADE.target, "stop below the quote, the quote at or under the entry, the target above");
  assert.ok(TRADE.spend <= TRADE.budget, "the position is within the budget");
  assert.ok(TRADE.actualSlippagePercent <= TRADE.maxSlippagePercent, "the fill is within the plan");
  assert.equal(FIGURES.position, "$1,000");
  assert.equal(FIGURES.units, "4.65 NVDAx");
  assert.equal(FIGURES.deviation, "+0.10%");
  assert.equal(FIGURES.riskAtInvalidation, "−$32.56");
  /* The purchase: the product's least sum at the same quote, its own presets. */
  assert.equal(BUY.sum, `$${RULE_MINIMUM_USD}`);
  assert.equal(BUY.pay, `$${RULE_MINIMUM_USD.toFixed(2)} USDC`);
  assert.equal(BUY.price, FIGURES.quote, "the company card's price is the hero's quote");
  assert.equal(BUY.units, (RULE_MINIMUM_USD / TRADE.quote).toFixed(4));
  assert.deepEqual(BUY.lossLimits, [`−${LOSS_LIMIT_PRESETS.careful.stopPct}%`, `−${LOSS_LIMIT_PRESETS.balanced.stopPct}%`], "the loss limits the purchase sheet offers");
  assert.equal(BUY.condition, `${PRICE_CONDITION_DEFAULT_PCT}%`, "a new rule's price condition, as the rule's sheet opens it");
  /* Every card reads the one story; no card types a figure of its own. */
  const cards = withoutComments(read("app/(home)/workflow-cards.tsx"));
  assert.doesNotMatch(cards, /\$\d/, "no dollar figure is typed on a card");
  assert.doesNotMatch(cards, /[−+-]\d+(\.\d+)?%/, "no per cent is typed on a card");
  assert.doesNotMatch(cards, /#[0-9A-Fa-f]{6}\b/, "no hex literal in the cards");
  const page = withoutComments(read("app/(home)/workflow.tsx"));
  assert.match(page, /<div className=\{styles\.visual\} aria-hidden="true">/, "the frame's picture is hidden from the reader who cannot see it");
  assert.match(page, /\{w\.frameNote\}/, "and the note says the figures are examples");
});

test("the block is one piece with the page and moves honestly: pinned only where it can, a column elsewhere, still under reduced motion", () => {
  const css = read("app/(home)/workflow.module.css");
  const source = withoutComments(read("app/(home)/workflow.tsx"));
  assert.match(read("app/(home)/homepage.tsx"), /<Universe locale=\{locale\} \/>\s*<Workflow locale=\{locale\} \/>/, "the workflow is the third block, after the universe");
  /* Transparent over the landing's one ground; the grid reaches zero before
     the top edge and before the bottom one — Rewards follows on the same
     ground, so no foot hands anything over. */
  assert.match(css, /\.workflow \{[\s\S]*?background: transparent;/);
  assert.match(css, /\.grid \{[\s\S]*?mask-image: linear-gradient\(180deg, transparent 0%, black 16%, black 82%, transparent 100%\)/);
  assert.doesNotMatch(css, /\.foot\b/, "the workflow no longer ends the page");
  assert.doesNotMatch(read("app/(home)/universe.module.css"), /\.haze/, "the universe no longer ends the page");
  assert.doesNotMatch(read("app/(home)/universe.tsx"), /styles\.haze/);
  /* The stage pins only from 1024px without a motion preference against it. */
  assert.match(css, /\.stage \{[\s\S]*?position: sticky;/);
  assert.match(css, /@media \(max-width: 1023px\), \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.stage \{ position: static;/);
  assert.match(source, /window\.matchMedia\("\(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\)"\)/);
  /* The reader's scroll is the progress; a click lands on the same step. */
  assert.match(source, /requestAnimationFrame\(measure\)/);
  assert.match(source, /Math\.floor\(progress \* count\)/);
  assert.match(source, /window\.scrollTo\(\{ top: start \+ \(\(index \+ 0\.5\) \/ count\) \* range, behavior \}\)/);
  assert.match(source, /aria-current=\{index === active \? "step" : undefined\}/);
  assert.match(source, /rootMargin: "-45% 0px -45% 0px"/, "in the column, the step nearest the middle is the lit one");
  /* Eight pixels and a fade; nothing slides. */
  assert.match(css, /\.step\[data-state="after"\] \.words, \.step\[data-state="after"\] \.chrome \{ translate: 0 6px; \}/);
  assert.doesNotMatch(css, /translate: 0 (2\d|[3-9]\d)px/, "no dramatic slide");
  /* Still under reduced motion; the reveal only once the script has the section. */
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.workflow \*, \.workflow \*::before, \.workflow \*::after \{ animation: none !important; transition: none !important; \}/);
  assert.match(css, /\.workflow\[data-js\]:not\(\[data-seen\]\) \.stage \{ opacity: 0;/);
  assert.match(source, /root\.dataset\.js = "";/);
  assert.match(source, /if \(reduced\.matches\) root\.dataset\.seen = "";/);
  /* One real destination; no library. */
  assert.match(source, /className=\{styles\.open\} href=\{localizedPath\("\/app\/home", locale\)\}/);
  assert.doesNotMatch(source, /framer-motion|gsap|lenis|locomotive/);
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{6}\b/, "no hex literal in the component");
  /* The frame's fixed dark palette is the brand's own, declared once. */
  const palette = /\.workflow \{[\s\S]*?\n\}/.exec(css)[0];
  const literals = css.match(/#[0-9A-Fa-f]{6}\b|rgba?\([^)]*\)/g) ?? [];
  const declared = palette.match(/#[0-9A-Fa-f]{6}\b|rgba?\([^)]*\)/g) ?? [];
  assert.equal(literals.length, declared.length, "every colour literal in the stylesheet is in the `--wf-*` block");
  for (const value of ["#0B121A", "#0E1620", "#131E2A", "#22303E", "#2F4052", "#F5F7FA", "#91A0B2", "#7A8899", "#19C77A", "#FF4D55", "#F5A524", "#FF681C", "#FF7A2F"]) {
    assert.ok(declared.includes(value), `${value} is a brand value`);
    assert.match(read("app/design/tokens.css"), new RegExp(value, "i"), `${value} is projected`);
  }
});
