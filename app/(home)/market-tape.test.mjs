import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LANDING_COPY } from "./landing-copy.ts";

/* TradingView's Ticker Tape on the landing — a condition of the free Advanced
   Charts licence (2026-10-09): the widget stands on the home page with
   TradingView's logo and its link under it. These hold the parts that keep
   the condition met and the page light. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const source = withoutComments(read("./market-tape.tsx"));
const css = withoutComments(read("./market-tape.module.css"));
const config = read("../../next.config.ts");

test("the tape is TradingView's own web component, from the one host the landing's policy names", () => {
  assert.match(source, /export const TAPE_SCRIPT = "https:\/\/widgets\.tradingview-widget\.com\/w\/en\/tv-ticker-tape\.js";/);
  assert.match(config, /const TRADINGVIEW_WIDGETS = "https:\/\/widgets\.tradingview-widget\.com";/, "the script's host is the one the landing's policy adds");
  assert.match(source, /script\.type = "module";/);
  assert.match(source, /document\.createElement\("tv-ticker-tape"\)/);
});

test("the symbols: the four Solana-side assets in dollars on one exchange, three companies and the S&P 500 fund", () => {
  const symbols = source.match(/export const TAPE_SYMBOLS = \[([\s\S]*?)\] as const;/)?.[1].match(/"[^"]+"/g)?.map((value) => value.slice(1, -1));
  assert.deepEqual(symbols, [
    "BITSTAMP:SOLUSD",
    "BITSTAMP:BTCUSD",
    "BITSTAMP:ETHUSD",
    "BITSTAMP:JUPUSD",
    "NASDAQ:AAPL",
    "NASDAQ:NVDA",
    "NASDAQ:TSLA",
    "AMEX:SPY",
  ]);
  assert.match(source, /setAttribute\("symbols", TAPE_SYMBOLS\.join\(","\)\)/);
});

test("TradingView's logo and link stay as TradingView draws them — nothing hides, clips or recolours the attribution", () => {
  /* The widget's own switches for its branding are never set… */
  assert.doesNotMatch(source, /hide-attribution|no-link|white-label|hide-logo|no-links|disable-scroll/);
  /* …nor are the tokens of its attribution and its link… */
  assert.doesNotMatch(css, /--tv-widget-attribution|--tv-widget-link-color/);
  /* …and the slot has no overflow, no mask and nothing laid over the tape. */
  assert.doesNotMatch(css, /overflow|mask|clip-path|::before|::after|opacity|visibility|display: none/);
});

test("lazy: nothing of TradingView is in the page's markup; it loads after the page, near the screen, once", () => {
  const rendered = source.slice(source.indexOf("return ("));
  assert.doesNotMatch(rendered, /<script|tv-ticker-tape|tradingview/i, "the server sends an empty slot");
  assert.match(source, /new IntersectionObserver\(/);
  assert.match(source, /document\.readyState === "complete"/);
  assert.match(source, /addEventListener\("load", whenIdle, \{ once: true \}\)/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /document\.querySelector\(`script\[src="\$\{TAPE_SCRIPT\}"\]`\)/, "one script, however often the block mounts");
  /* The slot keeps the tape's height (measured: 78 px, compact, at 1440 and 375), so the orbit never moves. */
  assert.match(css, /\.slot \{[^}]*min-height: 78px;/);
});

test("the tape follows the reader's theme on a transparent ground, in the landing's ink and font", () => {
  assert.match(source, /watchResolvedTheme\(\(theme\) => tape\.setAttribute\("theme", theme\)\)/);
  assert.match(source, /setAttribute\("transparent", ""\)/);
  assert.match(source, /setAttribute\("item-size", "compact"\)/);
  assert.match(css, /--tv-widget-border-color: color-mix\(in srgb, var\(--landing-ink\) 10%, transparent\);/);
  assert.match(css, /--tv-widget-font-family: var\(--ry-font-sans\);/);
  assert.match(css, /--tv-widget-positive-color: var\(--ry-pnl-pos\);/);
  assert.match(css, /--tv-widget-negative-color: var\(--ry-pnl-neg\);/);
});

test("a screen reader hears whose prices these are, in both languages", () => {
  assert.equal(LANDING_COPY.en.tape.label, "Market prices from TradingView");
  assert.equal(LANDING_COPY.uk.tape.label, "Ціни ринків від TradingView");
  assert.match(source, /aria-label=\{landingCopy\(locale\)\.tape\.label\}/);
});
