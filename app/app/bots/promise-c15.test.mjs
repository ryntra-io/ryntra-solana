// Run from repo root: node --test app/app/bots/promise-c15.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeKept, encodeKept, fragmentPart, restoreDraft } from "../strategies/plans/draft-keep.ts";
import { PLAN_WORDS } from "../strategies/plans/plan-words.ts";
import { INVEST_WORDS } from "../invest/invest-words.ts";
import { STRATEGY_TYPES } from "../../../lib/product/strategy-types.ts";
import { BOTS_WORDS } from "./bots-words.ts";

/**
 * SOL-C15 «Боти й плани — обіцянка дорівнює функції» (the UX audit of 21.10, UX-700 … UX-716): «Боти» say what a
 * recurring buy does — it reminds, and only the person's signature buys; one way to «Обрати токен»; a plan's one home
 * is «Боти»; a guest's last step is one button; the name is the menu's.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const BOTH = (word) => [word.en, word.uk];

test("UX-700: no word on «Боти» says a rule buys by itself — it reminds, the person signs", () => {
  const all = [...Object.values(BOTS_WORDS), INVEST_WORDS.noRulesYet, INVEST_WORDS.autoinvestPromise].flatMap(BOTH);
  for (const line of all) {
    assert.doesNotMatch(line, /^Buys a token|^Купує токен|A rule buys|Правило купує/u, line);
    assert.doesNotMatch(line, /one tap|одним дотиком/u, `${line}: a purchase is a Review and a signature, not a tap`);
  }
  assert.match(BOTS_WORDS.recurringHow.en, /reminds you.*you sign each buy/u);
  assert.match(BOTS_WORDS.recurringHow.uk, /нагадає.*підписуєш ти/u);
  assert.match(INVEST_WORDS.noRulesYet.en, /reminds you to buy/u);
  assert.match(INVEST_WORDS.noRulesYet.uk, /нагадує купити/u);
  /* Where the reminder arrives, said on «Боти» with the way to Telegram on «Акаунт». */
  assert.match(BOTS_WORDS.remindersWhere.en, /Notifications.*Telegram/u);
  const view = read("./bots-view.tsx");
  assert.match(view, /function RemindersWhere/);
  assert.match(view, /href="\/app\/settings#account"/);
  /* UX-716: an example says it is one. */
  for (const key of ["recurringExample", "planExample", "gridExample"]) {
    assert.match(BOTS_WORDS[key].en, /^e\.g\. /u, key);
    assert.match(BOTS_WORDS[key].uk, /^Напр\. /u, key);
  }
});

test("the name is the menu's: «Боти», never «Автоінвест», on the page, the plan's crumbs and the site's menu", () => {
  assert.deepEqual(BOTH(BOTS_WORDS.title), ["Bots", "Боти"]);
  assert.deepEqual(BOTH(PLAN_WORDS.back), ["Bots", "Боти"]);
  assert.deepEqual(BOTH(PLAN_WORDS.builderTitle), ["Trade plan", "План угоди"]);
  assert.deepEqual(BOTH(PLAN_WORDS.planKind), ["Trade plan", "План угоди"]);
  for (const word of Object.values(PLAN_WORDS)) {
    assert.doesNotMatch(word.en, /My strategies|Trading plan/u);
    assert.doesNotMatch(word.uk, /Мої стратегії|Торговий план|\bReview\b/u, `${word.uk}: «Перевірка» in Ukrainian`);
  }
  const site = read("../../../lib/site/homepage-copy.ts");
  assert.match(site, /\{ label: "Bots", href: "\/app\/bots" \}/);
  assert.match(site, /\{ label: "Боти", href: "\/app\/bots" \}/);
  assert.doesNotMatch(site, /href: "\/app\/autoinvest"/);
});

test("UX-701: one way to «Обрати токен» — «Боти» and «Каталог» open the same picker, then the rule's own sheet", () => {
  const view = read("./bots-view.tsx");
  const catalog = read("./catalog/page.tsx");
  const start = read("./recurring-start.tsx");
  assert.match(view, /<RecurringStartButton locale=\{locale\} className=\{styles\.pathLink\} onOpen=\{recurring\.open\} \/>/);
  /* The sheet outlives the guest's cards: held at the page, drawn outside the wallet's branch. */
  assert.match(view, /\{recurring\.sheets\}\s*<\/section>/);
  assert.match(catalog, /type\.id === "dca" \? \(\s*<RecurringStart/);
  assert.match(start, /<RuleTokenPicker/);
  assert.match(start, /<AutoinvestSheet/);
  assert.match(start, /openSolanaConnection\(\)/, "a guest connects through the header's own panel (B14)");
  /* «Додати правило» with a wallet opens the same picker. */
  const block = read("../invest/autoinvest-block.tsx");
  assert.match(block, /<RuleTokenPicker/);
  assert.doesNotMatch(block, /function CompanyPicker/);
  /* No step leads through Markets any more. */
  const picker = read("../invest/rule-token-picker.tsx");
  assert.doesNotMatch(picker, /href="\/app\/markets"/);
  assert.match(picker, /\/api\/spot\/markets\?q=/);
  assert.match(picker, /row\.verified && !row\.suspicious/);
  assert.match(picker, /!row\.halted && row\.kind !== "pre-ipo"/, "a pre-IPO rule is written on its own page, under its notice");
  assert.equal(STRATEGY_TYPES.find((type) => type.id === "dca").setup, "/app/bots");
  assert.equal(INVEST_WORDS.pickTokenFromMarkets, undefined);
});

test("UX-709 and UX-715: a wallet not yet confirmed reads one sentence and one button; no catalogue card glows at rest", () => {
  const view = read("./bots-view.tsx");
  assert.match(view, /data-bots-confirm/);
  assert.equal((view.match(/proof\.prove\(\)/g) ?? []).length, 1);
  assert.match(view, /className=\{`rw-btn\$\{proven \? " rw-btn--primary" : ""\}`\}/, "«Створити план» is the one orange action only once the wallet is confirmed");
  assert.doesNotMatch(read("./catalog/page.tsx"), /rw-btn--primary/);
});

test("UX-702: the builder's last step for a guest is the one button, and what was written is kept", () => {
  const builder = read("../strategies/plans/plan-builder.tsx");
  assert.match(builder, /data-save-guest>\s*<p className=\{styles\.muted\}>\{word\("connectToSave"\)\}<\/p>\s*<ConnectWalletButton \/>/);
  assert.match(builder, /keepDraft\(assetMint, draft, address === null\)/);
  assert.match(builder, /if \(assetMint\) clearKept\(assetMint\);\s*router\.push/);
  /* Never over what the link itself carries: a budget or a condition from the asset's page wins. */
  assert.match(builder, /budget === null && carried === null \? readKept\(/);
});

test("a kept draft travels in the address and comes back only in the form's own shape", () => {
  const fresh = { thesis: "", horizonUnit: "none", maxPriceOn: false, entryPrice: "186.40", conditions: [] };
  const kept = { thesis: "Солана росте — «так»", horizonUnit: "weeks", maxPriceOn: true, entryPrice: 180, conditions: [{ ok: true }], extra: "x" };
  const back = decodeKept(encodeKept("So11111111111111111111111111111111111111112", kept));
  assert.equal(back.mint, "So11111111111111111111111111111111111111112");
  assert.deepEqual(back.draft, kept, "UTF-8 survives the fragment");
  const restored = restoreDraft(back.draft, fresh, { accept: { horizonUnit: (value) => ["days", "weeks", "months", "none"].includes(value) }, acceptItem: (item) => item.ok === true });
  assert.deepEqual(restored, { thesis: "Солана росте — «так»", horizonUnit: "weeks", maxPriceOn: true, entryPrice: "186.40", conditions: [{ ok: true }] }, "a number where text is kept is dropped; a field the form lacks is never added");
  assert.equal(restoreDraft({ horizonUnit: "years" }, fresh, { accept: { horizonUnit: (value) => ["days", "weeks", "months", "none"].includes(value) } }), null, "nothing the form can take — nothing restored");
  assert.equal(restoreDraft({ conditions: [{ ok: false }] }, fresh, { acceptItem: (item) => item.ok === true }), null, "a condition the form cannot draw drops the list");
  assert.equal(decodeKept("%%%"), null);
  /* A link carries what the person writes about the trade, never the execution limits. */
  assert.deepEqual(fragmentPart({ thesis: "x", budget: "100", maxSlippagePct: "20", maxQuoteAge: "600", deviationOn: false, referenceRequired: false, minLiquidity: "0", costBufferPct: "0", conditions: [] }), { thesis: "x", budget: "100", conditions: [] });
  assert.equal(decodeKept(encodeKept("m", null)), null);
});
