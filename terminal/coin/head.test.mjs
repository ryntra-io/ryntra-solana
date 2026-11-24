import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { passportOf } from "./passport/passport-data.ts";
import { standCoins } from "./passport/stand-coins.ts";
import { aboutOf } from "./head-view.ts";
import { HEAD } from "./head-words.ts";

/* The coin's head of two rows, «About the coin» on the passport, and the phone's one screen. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.UTC(2026, 10, 20, 12);
const coins = standCoins(NOW);
const passportFor = (key) => passportOf({ ...coins[key], now: NOW });
const aboutFor = (key, lang = "en", over = {}) => aboutOf({ market: coins[key].market, depth: null, passport: passportFor(key), ...over }, lang);

test("a creator some source names is drawn with what is known of them, and never as «—»", () => {
  const about = aboutFor("old");
  assert.ok(about.creatorHolds, "the creator's share stands");
  assert.notEqual(about.creatorHolds.text, "—");
  assert.ok(about.creatorCoins, "the creator's coins stand");
  assert.match(about.creatorCoins, /listed/);
});

test("a creator no source names leaves no row behind — the old «Creator —» is gone", () => {
  const about = aboutFor("noCreator");
  assert.equal(about.creatorHolds, null);
  assert.equal(about.creatorCoins, null);
  // The same with no passport at all and a market that does not state the creator's share.
  const bare = aboutOf({ market: { ...coins.noCreator.market, audit: { ...coins.noCreator.market.audit, devBalancePct: null } }, depth: null, passport: null }, "uk");
  assert.equal(bare.creatorHolds, null);
});

test("the rights are said in plain words: both given up as one line, a right still on in the warm tone", () => {
  const off = aboutOf({ market: null, depth: null, passport: { ...passportFor("old"), minting: "off", freezing: "off" } }, "uk");
  assert.deepEqual(off.rights.map((right) => [right.key, right.tone]), [["both", "ok"]]);
  assert.equal(off.rights[0].text, "Випуск і заморожування вимкнено");
  const on = aboutOf({ market: null, depth: null, passport: { ...passportFor("old"), minting: "on", freezing: "off" } }, "en");
  assert.deepEqual(on.rights.map((right) => [right.key, right.tone]), [["mint", "warn"], ["freeze", "ok"]]);
  for (const right of [...off.rights, ...on.rights]) assert.doesNotMatch(right.text, /authority|mint\b|мінт/i, "no chain words");
});

test("the share of the ten largest is warm from half the supply, and the sentence on top is facts only", () => {
  const risky = aboutFor("risky");
  assert.equal(risky.top10.warn, (passportFor("risky").top10Pct ?? 0) >= 50);
  for (const key of ["old", "fresh", "risky"]) {
    for (const lang of ["en", "uk"]) {
      const sentence = aboutFor(key, lang).sentence;
      if (sentence) assert.doesNotMatch(sentence, /\b(buy|sell)\b|купу|продава|x\d{2,}/i);
    }
  }
});

test("a stock has no creator rows, and the passport's figures fill what the market lacks", () => {
  const stock = aboutOf({ market: { ...coins.old.market, category: "stock" }, depth: null, passport: { ...passportFor("old"), stock: true } }, "en");
  assert.equal(stock.creatorHolds, null);
  assert.equal(stock.creatorCoins, null);
  assert.equal(stock.sentence, null);
  const fromDepth = aboutOf({ market: null, depth: { holders: 42, topHolders: 61, mint: "on", freeze: null }, passport: null }, "en");
  assert.equal(fromDepth.holders, 42);
  assert.equal(fromDepth.top10.warn, true);
  assert.deepEqual(fromDepth.rights.map((right) => right.key), ["mint"]);
});

test("the phone's views are Chart · Trades · Holders · Pools · About, registered in one place on the screen", () => {
  const screen = read("./CoinScreen.tsx");
  const order = ["'chart'", "'trades'", "'holders'", "'pools'", "'about'"].map((id) => screen.indexOf(`{ id: ${id}`));
  assert.ok(order.every((at) => at > 0), "each view stands in the registry");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in this order");
  assert.match(screen, /type PhoneView = 'chart' \| 'trades' \| 'holders' \| 'pools' \| 'about' \| 'mine'/);
  for (const lang of ["en", "uk"]) for (const key of ["chart", "trades", "holders", "pools", "about", "mine", "views", "quick"]) assert.ok(HEAD[lang][key], `${lang}.${key}`);
  assert.equal(HEAD.uk.about, "Про монету");
});

test("the phone keeps Buy and Sell with the quick sums under the thumb, and room under the page so no table is covered", () => {
  const screen = read("./CoinScreen.tsx");
  const sheet = read("./coin.module.css");
  assert.match(screen, /\{risk \? <div className=\{u\.phoneRisk\}>\{risk\}<\/div> : null\}/, "the one sentence of risk under the price, only when there is one");
  assert.match(screen, /quickSums\(payMint\)/, "the quick sums of the ticket's own money");
  assert.match(screen, /trade\.setTyped\(sum\)/, "a sum fills the field");
  assert.doesNotMatch(screen, /press\(\)|prepare\(/, "nothing is ordered from the bar");
  assert.match(sheet, /\.barRoom\[data-quick\]\s*\{\s*height: 112px;/, "the page keeps the bar's height with its sums");
});

test("the head carries the passport's row and a company's facts; no words of the head are written outside the words files", () => {
  const head = read("./CoinHead.tsx");
  const screen = read("./CoinScreen.tsx");
  assert.match(head, /figures\?: ReactNode; stockMint\?: string \| null/);
  assert.match(screen, /figures=\{headFiguresKnown\(passport\) \|\| \(!passport && passportStatus === 'reading'\) \? <PassportFigures passport=\{passport\} status=\{passportStatus\} \/> : undefined\}/);
  assert.match(screen, /stockMint=\{stock \? mint : null\}/);
  for (const source of [head, screen, read("./CoinFacts.tsx")]) assert.doesNotMatch(source, />\s*(Creator|Творець)\s*</);
});

test("the desk is the window's height under the head of two rows", () => {
  assert.match(read("./desk.module.css"), /--desk-h: max\(600px, calc\(100dvh - var\(--top\) - 214px\)\);/);
});
