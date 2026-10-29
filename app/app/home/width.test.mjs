import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Width and premium: from 1440 up no half of the screen stands empty —
 * Markets and Portfolio take the full width with big figures and one orange
 * action. Home's own shape — one number, three blocks — is `home.test.mjs`.
 */

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const HOLDINGS = read("app/solana/workspace/holdings/holdings-card.tsx");
const HOLDINGS_CSS = read("app/solana/workspace/holdings/holdings.module.css");
const MARKETS = read("app/app/markets/markets-screener.tsx");
const SCREENER_CSS = read("app/app/markets/screener.module.css");
const MARKETS_PLACE = read("app/app/markets/markets-place.tsx");

test("Portfolio: the main column and «Автоінвест» on the right from 1280 px, the value carrying the page's one orange action", () => {
  assert.match(HOLDINGS_CSS, /@media \(min-width: 1280px\) \{\s*\.workspace \{\s*grid-template-columns: minmax\(0, 1fr\) clamp\([^)]*\);\s*grid-template-areas:\s*"value rules"\s*"holdings rules";/);
  assert.equal(HOLDINGS.split("<FundingActions").length - 1, 1, "one set of actions: the wallet's next step");
  /* Big figures in the interface's face, in the reader's language. */
  assert.match(HOLDINGS_CSS, /\.totalValue \{[^}]*font-family: var\(--ry-font-sans\);/);
  /* The number is «Вартість портфеля» — the wallet, its pools and its orders, by Home's own rule (B2b). */
  assert.match(HOLDINGS, /usdValueIn\(portfolio\.total, locale\)/);
  /* The table never runs past its panel: a narrow one drops the amount and the share. */
  assert.match(HOLDINGS_CSS, /container: holdings \/ inline-size;/);
  assert.match(HOLDINGS_CSS, /@container holdings \(max-width: 820px\)/);
});

test("Markets: one screener over the full width — fifty rows at a time, the columns following the screen", () => {
  /* Since the menu v6.2 «Ринки» is one table, not a board of cards: it takes the canvas's width and draws its rows fifty at a time. */
  assert.match(MARKETS, /const PAGE = 50;/);
  /* Since B4 the core's page holds it, the frame giving the edges; the screener's block takes the whole column. */
  assert.match(MARKETS_PLACE, /<Page kind="overview" className=\{styles\.page\}/);
  assert.match(SCREENER_CSS, /\.page \{\s*width: 100%;\s*padding: 0;/);
  /* The columns are chosen by the width — the table's own since B17 — not hidden by CSS; a phone keeps the asset, its
     price and its day, a laptop of 1280–1366 the coin's size. Both are the pure model's and asserted with real widths
     in `lib/markets/screener-columns.test.mjs`; here, that the screener asks it with the width it measured. */
  assert.match(MARKETS, /screenerColumns\(tab, width \?\? SCREENER_DESK_PX\)/);
  assert.doesNotMatch(MARKETS, /window\.innerWidth/);
});
