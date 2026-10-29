import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LANDING_COPY } from "./landing-copy.ts";

/* The market tape on the landing — Ryntra's own since SOL-T4: the core's sparkline on Solana's
   prices, where TradingView's Ticker Tape stood. These hold the parts that
   keep it ours, honest about its sources, and the page light. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const source = withoutComments(read("./market-tape.tsx"));
const css = withoutComments(read("./market-tape.module.css"));

test("no chart of anyone else's: the lines are the core's sparkline, and nothing of TradingView is left", () => {
  assert.match(source, /import \{ ChartCaption, Sparkline \} from "@ryntra\/core\/chart\/compact";/);
  assert.match(source, /import "@ryntra\/core\/chart\/compact\.css";/);
  assert.match(source, /<Sparkline[\s\S]*caption="none"/, "each line says nothing of its own: one caption speaks for the tape");
  assert.match(source, /<ChartCaption[\s\S]*status=\{status\}/, "the sources and the age of the numbers, once, under the tape");
  assert.doesNotMatch(source + css, /tradingview|tv-ticker-tape|--tv-widget|lightweight-charts|<script|createElement\("script"\)/i);
});

test("the tape reads Ryntra's own route, after the page and near the screen, and keeps its height", () => {
  assert.match(source, /export const TAPE_ROUTE = "\/api\/spot\/tape";/);
  assert.match(source, /new IntersectionObserver\(/);
  assert.match(source, /document\.readyState === "complete"/);
  assert.match(source, /addEventListener\("load", whenIdle, \{ once: true \}\)/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /window\.setTimeout\(\(\) => void load\(\), next\)/, "it reads again while the page is open");
  assert.match(source, /const next = !whole && soon <= 6 \? TAPE_PARTIAL_TTL_MS : TAPE_TTL_MS;/, "a failed or partial read is read again soon — a few times");
  assert.match(source, /if \(document\.hidden\) \{/, "no reads while nobody is looking");
  const rendered = source.slice(source.indexOf("<section"));
  assert.doesNotMatch(rendered, /fetch\(/, "the server sends an empty slot");
  /* The slot keeps the tape's height (TradingView's compact tape measured 78 px at 1440 and 375), so the orbit never moves. */
  assert.match(css, /\.slot \{[^}]*min-height: 78px;/);
});

test("the tape runs, stops under a hand, and stands still for anyone who asked for less motion", () => {
  assert.match(css, /\.track \{[^}]*animation: tape-run 60s linear infinite;/);
  assert.match(css, /\.frame:hover \.track,\s*\.frame:focus-within \.track \{[^}]*animation-play-state: paused;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.track \{[^}]*animation: none;/);
  assert.match(source, /<ul className=\{styles\.run\} aria-hidden>/, "the run's second copy is hidden from a screen reader");
});

test("the core's tokens are the landing's own ink, font and colours of up and down", () => {
  assert.match(css, /--ryntra-text: var\(--landing-ink\);/);
  assert.match(css, /--ryntra-up: var\(--ry-pnl-pos\);/);
  assert.match(css, /--ryntra-down: var\(--ry-pnl-neg\);/);
  assert.match(css, /--ryntra-font-sans: var\(--ry-font-sans\);/);
  assert.match(css, /--ryntra-border: color-mix\(in srgb, var\(--landing-ink\) 10%, transparent\);/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, "no colour of its own");
});

test("a screen reader hears what the tape is, in both languages", () => {
  assert.equal(LANDING_COPY.en.tape.label, "Market prices on Solana");
  assert.equal(LANDING_COPY.uk.tape.label, "Ціни ринків на Solana");
  assert.equal(LANDING_COPY.en.tape.day, "over 24 hours");
  assert.equal(LANDING_COPY.uk.tape.day, "за 24 години");
  assert.match(source, /aria-label=\{landingCopy\(locale\)\.tape\.label\}/);
});
