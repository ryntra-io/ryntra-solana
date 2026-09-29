import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Width and premium (`RYN-WIDTH-PREMIUM-001`, the Owner's word «Ширина й
 * преміум»): from 1440 up no half of the screen stands empty — Home has a main
 * column and a right one (notifications, «Автоінвест», «Спитати Ryntra», what
 * moves today), on a phone the right one's blocks come under the main ones;
 * Markets and Portfolio take the full width with big figures and one orange
 * action.
 */

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const HOME = read("app/app/home/home-surface.tsx");
const HOME_CSS = read("app/app/home/home.module.css");
const ASIDE = read("app/app/home/home-aside.tsx");
const HOLDINGS = read("app/solana/workspace/holdings/holdings-card.tsx");
const HOLDINGS_CSS = read("app/solana/workspace/holdings/holdings.module.css");
const MARKETS = read("app/app/markets/markets-surface.tsx");
const MARKETS_PLACE = read("app/app/markets/markets-place.tsx");
const INVEST_CSS = read("app/app/invest/invest.module.css");

test("Home: a main column and a right one from 1280 px; on a phone the right one comes under the main one", () => {
  assert.match(HOME_CSS, /@media \(min-width: 1280px\) \{\s*\.layout \{\s*grid-template-columns: minmax\(0, 1fr\) clamp\(/);
  const main = HOME.indexOf("<div className={home.main}>");
  const aside = HOME.indexOf("<HomeAside locale={locale} />");
  assert.ok(main > 0 && aside > main, "the main column first, the right one after it — its order on a phone");
});

test("the right column holds notifications, «Автоінвест», «Спитати Ryntra» and what moves today, in that order", () => {
  const body = ASIDE.slice(ASIDE.indexOf("export function HomeAside"));
  const order = ["<NotesBlock", "<AutoinvestBlock", "<AskBlock", "<MoversBlock"].map((tag) => body.indexOf(tag));
  assert.ok(order.every((index) => index > 0), "every block is drawn");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the Owner's order");
});

test("«Автоінвест» in the column: the rules with their switches, one line each, the nearest purchase first, three at most", () => {
  const BLOCK = read("app/app/invest/autoinvest-block.tsx");
  assert.match(ASIDE, /<AutoinvestBlock locale=\{locale\} compact \/>/);
  assert.match(BLOCK, /const COMPACT_SHOWN = 3;/);
  assert.match(BLOCK, /compact \? byNextPurchase\(state\.rules, Date\.now\(\)\)\.slice\(0, COMPACT_SHOWN\) : state\.rules/);
  /* The switch stays on every rule: canon v5.3 В29 keeps the rules with their switches on Home. */
  assert.match(BLOCK, /role="switch"/);
  assert.match(BLOCK, /word\("allRules"\)/);
});

test("on a phone a wallet's «Автоінвест» comes right after what it owns, the other right-column blocks under the main ones", () => {
  const phone = HOME_CSS.slice(HOME_CSS.indexOf("@media (max-width: 900px)"));
  const order = (block) => Number(new RegExp(`\\.layout \\[data-block="${block}"\\] \\{ order: (\\d+); \\}`).exec(phone)?.[1]);
  assert.deepEqual(["head", "owned", "autoinvest", "popular", "notes", "ask", "movers"].map(order), [1, 2, 3, 4, 5, 7, 8]);
  assert.match(phone, /\.main,\s*\.aside \{\s*display: contents;/);
  assert.match(phone, /align-items: stretch;/);
});

test("nothing in the right column is orange: the page's one orange action is the head's", () => {
  assert.doesNotMatch(ASIDE, /rw-btn--primary|data-variant="primary"/);
});

test("the head uses its own width: what the money is in beside the balance, a guest's three steps beside the promise", () => {
  assert.match(HOME, /<Allocation rows=\{owned\} totalMicro=\{totals\.total\} locale=\{locale\} \/>/);
  assert.match(HOME, /\["stepConnect", "stepTopUp", "stepBuy"\]/);
  assert.match(HOME_CSS, /@container \(min-width: 640px\)/);
});

test("Portfolio: the main column and «Автоінвест» on the right from 1280 px, the value carrying the page's one orange action", () => {
  assert.match(HOLDINGS_CSS, /@media \(min-width: 1280px\) \{\s*\.workspace \{\s*grid-template-columns: minmax\(0, 1fr\) clamp\([^)]*\);\s*grid-template-areas:\s*"value rules"\s*"holdings rules";/);
  assert.equal(HOLDINGS.split("<FundingActions").length - 1, 1, "one set of actions: the wallet's next step");
  assert.equal(HOME.split("<FundingActions").length - 1, 1, "Home says the same step the same way");
  /* Big figures in the interface's face, in the reader's language. */
  assert.match(HOLDINGS_CSS, /\.totalValue \{[^}]*font-family: var\(--ry-font-sans\);/);
  assert.match(HOLDINGS, /usdValueIn\(totals\.total, locale\)/);
  /* The table never runs past its panel: a narrow one drops the amount and the share. */
  assert.match(HOLDINGS_CSS, /container: holdings \/ inline-size;/);
  assert.match(HOLDINGS_CSS, /@container holdings \(max-width: 820px\)/);
});

test("Markets: the full width, four columns from 1600 px, and «Усі» never ending on a half-empty row", () => {
  assert.match(MARKETS, /const OVERVIEW = \{ companies: 8, private: 4, crypto: 8, memes: 4 \} as const;/);
  assert.match(MARKETS_PLACE, /className=\{`\$\{styles\.page\} \$\{styles\.wide\}`\}/);
  assert.match(INVEST_CSS, /@media \(min-width: 1600px\) \{\s*\.board \.rows \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(INVEST_CSS, /\[data-section="companies"\] \.rows > :nth-child\(n \+ 7\)/);
  assert.match(INVEST_CSS, /\.board \.price \{\s*font-size: var\(--ry-fs-data-m\);/);
});
