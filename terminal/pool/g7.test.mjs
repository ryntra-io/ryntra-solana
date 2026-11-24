import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { elsewhereBetter, evenPlaces, unbroken } from "./pool-view.ts";
import { POOL } from "./words.ts";

/* Measured on
   a stand with recorded answers (terminal/pool/shots-g7.mjs): ANT/SOL's card of the other pool 123 px → 46 px; a phone's
   head 4 of 5 figures → 5 of 5; the table under the chart ends on a row's edge. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./pool.module.css");
const screen = read("./PoolScreen.tsx");
const side = read("./PoolSide.tsx");
const stock = read("../stocks/dlmm/DlmmStockTicket.tsx");
const { en, uk } = POOL;

test("fault 53: the way to another pool only where it pays a limit order more than this one", () => {
  assert.equal(elsewhereBetter(4, 32), false, "ANT/SOL: +0.04% there, +0.32% here — no call");
  assert.equal(elsewhereBetter(60, 32), true);
  assert.equal(elsewhereBetter(32, 32), false, "the same bonus is no reason to leave");
  assert.equal(elsewhereBetter(Number.NaN, 1), false);
  assert.match(side, /const better = elsewhereBetter\(bonusBps, row\.bonusBps\);/);
  assert.match(side, /\{better \? \(\s*<QuietLink href=\{`\/pool\/\$\{ladderPool\}\?tab=limit`\}/);
});

test("fault 53: the card of another pool is one line, its why behind «i»", () => {
  assert.match(side, /<span>\{w\.bonusIn\(`\$\{otherPair\}\$\{fee\}`\)\}<\/span>/);
  assert.match(side, /<Info label=\{w\.bonusTitle\}>\s*<span className=\{p\.facts\}>\s*<b>\{w\.elsewhereIn\(sym, otherPair, fee\)\}<\/b>/);
  assert.match(css, /\.bonus\[data-elsewhere\] \{\s*flex-wrap: wrap;\s*gap: 6px 10px;\s*padding: 8px 12px;/);
  assert.equal(en.bonusIn("0.1%"), "Bonus in the 0.1% pool");
  assert.equal(uk.bonusIn("0,1%"), "Бонус у пулі 0,1%");
  assert.equal(uk.elsewhereGo, "Перейти до пулу", "fault 60: not «Відкрити той пул»");
});

test("fault 55: a phone's head shows every figure — rows of three, or two for four", () => {
  assert.match(css, /@media \(max-width: 767px\) \{\s*\/\*[^]*?\*\/\s*\.poolHead dl \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.poolHead dl:has\(> div:nth-child\(4\):last-child\) \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("fault 56: a pool with liquidity away from its price says so, and asks no one to be first", () => {
  assert.match(screen, /const held = pool\.tvlUsd !== null && pool\.tvlUsd > 0;/);
  assert.match(screen, /<b>\{held \? w\.emptyNear : w\.emptyTitle\}<\/b>/);
  assert.match(screen, /\{way === 'open' && !held \? \(/);
  assert.match(css, /\.phoneBlock\[data-quiet\] \{\s*height: auto;/);
  assert.equal(en.emptyNear, "No liquidity near the price");
  assert.equal(uk.emptyNear, "Біля ціни ліквідності немає");
});

test("faults 57, 58, 120: the stock's two-coin ticket — the coin's logo, the goals without shape names, a line that holds", () => {
  assert.match(stock, /icon: iconOf\(read\.stock\.mint\), also: iconsAfter\(read\.stock\.mint\)/);
  assert.match(read("../ui/AmountField.tsx"), /<CoinLogo src=\{asset\.icon\} also=\{asset\.also\}/);
  assert.doesNotMatch(stock, /SHAPE_WORD|GOAL_SHAPE/);
  assert.match(stock, /lineOf\(\[rangeText, d\.noSwap, w\.ryntraNone\]\.map\(unbroken\)\)/);
  assert.equal(unbroken("Ryntra 0%"), "Ryntra 0%");
  assert.equal(unbroken(null), null);
});

test("fault 59: a range's two prices with the same decimals", () => {
  assert.deepEqual(evenPlaces("80.77", "86.1"), { low: "80.77", high: "86.10" });
  assert.deepEqual(evenPlaces("0.5", "0.5123"), { low: "0.5000", high: "0.5123" });
  assert.deepEqual(evenPlaces("99", "100.5"), { low: "99.0", high: "100.5" });
  assert.deepEqual(evenPlaces("1,240", "1,310"), { low: "1,240", high: "1,310" }, "thousands stay as written");
  assert.deepEqual(evenPlaces("82.07", "87.49"), { low: "82.07", high: "87.49" });
  assert.match(stock, /const prices = evenPlaces\(edges\.low, edges\.high\);/);
});

test("fault 61: a pool that did not read says so with «Try again», which reads it afresh", () => {
  assert.match(screen, /<PoolRead key=\{turn\} address=\{address\} onAgain=\{again\} \/>/);
  assert.match(screen, /read\.status === 'failed' \? \(\s*<Quiet size="s" onClick=\{onAgain\}>\s*\{w\.again\}/);
  assert.equal(en.failedPool, "This pool is not available right now");
  assert.equal(uk.failedPool, "Пул зараз недоступний");
});

test("fault 62: the table under the chart ends on a row's own edge", () => {
  assert.match(screen, /snapBook\(box, '\[role="row"\]'\)/);
  assert.match(screen, /<div className=\{p\.underBox\} ref=\{snapUnder\}>/);
  assert.match(css, /\.underBox \{\s*display: contents;/);
});

test("fault 119: the head's tools stand at its far end", () => {
  assert.match(screen, /<\/dl>\s*\{\/\*[^]*?\*\/\}\s*<span className=\{h\.grow\} \/>\s*<span className=\{p\.headTools\}>/);
});
