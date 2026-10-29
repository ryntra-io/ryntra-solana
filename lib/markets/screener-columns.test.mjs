import assert from "node:assert/strict";
import test from "node:test";

import { SCREENER_COLUMNS, SCREENER_DESK_PX, SCREENER_TABS, screenerColumns } from "./screener.ts";

/*
 * SOL-C16 (аудит UX 21.10, UX-179, тема T9): the figures «Ринки» keeps as the table narrows.
 *
 * The widths are the table's own, not the window's. A laptop of 1280–1366 px is the case the audit found: the rail
 * takes 240 px before the table begins, so the table stands at 1000–1100 px on a 1280 screen and under 1000 with the
 * assistant's panel open — and it was the capitalisation that went first there, the one number that says how big a coin
 * is, while liquidity stayed.
 */

/** A laptop of 1280 with the rail: the band where the audit found the wrong figure leaving. */
const LAPTOP = 900;
/** A phone: the asset, its price and its day, and nothing that would run past an edge that clips (B17). */
const PHONE = 390;

const TABLES = ["all", "memes", "crypto", "watchlist"];
/** The tabs that draw liquidity and no capitalisation: a stock's size is the company's, not its pool's. */
const NO_CAP = ["stocks", "private"];

test("on a laptop the coin's size stays and its liquidity gives way — the figure a person reads is the one that is kept", () => {
  for (const tab of TABLES) {
    const columns = screenerColumns(tab, LAPTOP);
    assert.ok(columns.includes("marketCap"), `${tab}: the capitalisation is the figure that stays`);
    assert.ok(!columns.includes("liquidity"), `${tab}: liquidity gives up its place`);
  }
});

test("a tab with no capitalisation keeps its liquidity: nothing stands in its place, so nothing takes it", () => {
  for (const tab of NO_CAP) {
    const columns = screenerColumns(tab, LAPTOP);
    assert.ok(columns.includes("liquidity"), `${tab}: liquidity has no stand-in to give way to`);
    /* And the table is no emptier than a wider one by more than the figures that are gone for every tab. */
    assert.deepEqual(
      screenerColumns(tab, 1300).filter((column) => column !== "age" && column !== "change1h"),
      columns,
      `${tab}: a laptop lost a figure and put none in its place`,
    );
  }
});

test("a phone keeps the asset, its price and its day — neither figure of the pair", () => {
  for (const tab of SCREENER_TABS) {
    const columns = screenerColumns(tab, PHONE);
    assert.ok(!columns.includes("liquidity"), `${tab}: liquidity on a phone runs past the edge`);
    assert.ok(!columns.includes("marketCap"), `${tab}: the capitalisation on a phone runs past the edge`);
    assert.deepEqual(columns, SCREENER_COLUMNS[tab].filter((column) => column === "price" || column === "change24h"), tab);
  }
});

test("a figure never comes back as the table narrows", () => {
  /* Every width where a rule turns, and one either side of it: what a narrower table draws is always part of what a
     wider one draws. A rule that drops a figure only where another stays in its place could break this, and the two
     changing places on a laptop is exactly such a rule. */
  const widths = [320, 390, 600, 679, 680, 760, 999, 1000, 1100, 1239, 1240, 1400];
  for (const tab of SCREENER_TABS) {
    for (let i = 1; i < widths.length; i += 1) {
      const narrow = screenerColumns(tab, widths[i - 1]);
      const wide = screenerColumns(tab, widths[i]);
      for (const column of narrow) {
        assert.ok(wide.includes(column), `${tab}: ${column} stands at ${widths[i - 1]} px and is gone at ${widths[i]} px`);
      }
    }
  }
});

test("the table the server streams is a desk's, and every figure it draws is one the tab has", () => {
  for (const tab of SCREENER_TABS) {
    const columns = screenerColumns(tab, SCREENER_DESK_PX);
    for (const column of columns) assert.ok(SCREENER_COLUMNS[tab].includes(column), `${tab}: ${column} is not a figure of this tab`);
    /* A desk of 1100 px keeps everything but the venue's two facts, which need 1240. */
    assert.deepEqual(columns, SCREENER_COLUMNS[tab].filter((column) => column !== "organic" && column !== "top10"), tab);
  }
});

test("«Події» and «Гаманці» are no tables of figures at any width", () => {
  for (const width of [PHONE, LAPTOP, 1400]) {
    assert.deepEqual(screenerColumns("events", width), []);
    assert.deepEqual(screenerColumns("wallets", width), []);
  }
});
