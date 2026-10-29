// Run from repo root: node --test app/solana/workspace/spot/sol-c12.test.mjs
/**
 * SOL-C12 «Термінал Solana — чистий стандарт» (decision 63, the UX audit of 21.10): Spot and a token's page in
 * «Стандарт» — one interval switch, one row of the chart's tools, the source and the age in one line, the chart the most
 * of the screen; the strip's figures first and its actions under one «⋯» (UX-152); «Verified by Jupiter», never green,
 * and the minting right beside it (UX-151); the risk in one line by «Купити» (UX-156); nothing over the chip on a phone
 * (UX-153); one last price with its age (UX-254); «Trade again» only once the outcome is known (UX-256); the ticket
 * whole at 1280 (UX-253). Only the showing: no route, fee, signature or receipt changes here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SOLANA_UK_TEXT } from "../i18n/catalog.ts";
import { cautionFact, riskFactsOf } from "./risk-facts.ts";
import { knownOutcome } from "./ticket-outcome.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const HEADER = read("./market-header.tsx");
const CHART = read("./spot-chart.tsx");
const TICKET = read("./spot-ticket.tsx");
const PAGE = read("./spot-workspace.tsx");
const TERMINAL = read("./spot-terminal.tsx");
const CSS = read("./spot.module.css");

const NOW = Date.parse("2026-10-22T12:00:00Z");
const meme = {
  mint: "GoBLoFxtr7Rpf1111111111111111111111111pump",
  verified: true,
  category: "meme",
  issuer: null,
  holders: 710,
  liquidityUsd: 4600,
  firstPoolAt: "2026-10-22T03:00:00Z",
  audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: true, topHoldersPct: 28.8, devBalancePct: 4.1, suspicious: false },
};

test("UX-156: the risk line states the facts in reading order, the issuer's rights in the caution colour, no verdict", () => {
  const facts = riskFactsOf(meme, NOW);
  assert.deepEqual(facts.map((fact) => fact.kind), ["mint-on", "liquidity", "top", "holders", "age"]);
  assert.deepEqual(facts.filter(cautionFact).map((fact) => fact.kind), ["mint-on"]);
  assert.equal(facts.find((fact) => fact.kind === "age").days, 0, "a market of nine hours is today's");
  /* Unverified and flagged are one fact each, the flag first. */
  assert.equal(riskFactsOf({ ...meme, verified: false }, NOW)[0].kind, "unverified");
  assert.equal(riskFactsOf({ ...meme, verified: false, audit: { ...meme.audit, suspicious: true } }, NOW)[0].kind, "flagged");
  /* A figure not read is left out, never a zero. */
  assert.deepEqual(
    riskFactsOf({ ...meme, holders: null, liquidityUsd: null, firstPoolAt: null, audit: { ...meme.audit, mintAuthorityDisabled: null, topHoldersPct: null } }, NOW).map((fact) => fact.kind),
    [],
  );
});

test("UX-156: SOL, a tokenized stock and a token Ryntra no longer supports carry no risk line", () => {
  assert.deepEqual(riskFactsOf({ ...meme, mint: "So11111111111111111111111111111111111111112" }, NOW), []);
  assert.deepEqual(riskFactsOf({ ...meme, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, NOW), [], "the dollar the page quotes in");
  assert.deepEqual(riskFactsOf({ ...meme, category: "stock" }, NOW), []);
  assert.deepEqual(riskFactsOf({ ...meme, issuer: { label: "No longer supported in Ryntra", tag: "unsupported" } }, NOW), []);
  assert.deepEqual(riskFactsOf(null, NOW), []);
});

test("UX-156: the line stands by «Купити» — over the ticket and in the phone's pinned bar", () => {
  assert.match(TICKET, /<RiskLine market=\{market\} lang=\{lang\} \/>/);
  assert.match(PAGE, /<RiskLine market=\{marketValue\} lang=\{locale === "uk" \? "uk" : "en"\} \/>/);
  assert.match(read("./risk-line.tsx"), /data-risk-line/);
});

test("UX-256: an unknown answer offers the transaction and a read again; «Trade again» only once it is known", () => {
  const history = [{ signature: "sigA", outcome: "DONE" }, { signature: "sigB", outcome: "FAILED" }, { signature: "sigC", outcome: "IN_FLIGHT" }];
  assert.equal(knownOutcome({ signature: "sigA", limit: false, history, orders: null }), "done");
  assert.equal(knownOutcome({ signature: "sigB", limit: false, history, orders: null }), "failed");
  assert.equal(knownOutcome({ signature: "sigC", limit: false, history, orders: null }), null, "in flight is not known");
  assert.equal(knownOutcome({ signature: "sigD", limit: false, history, orders: null }), null);
  assert.equal(knownOutcome({ signature: "sigA", limit: false, history: null, orders: null }), null, "an unread history knows nothing");
  assert.equal(knownOutcome({ signature: "sigL", limit: true, history, orders: [{ placeSignature: "sigL", state: "OPEN" }] }), "placed");
  assert.equal(knownOutcome({ signature: "sigL", limit: true, history, orders: [{ placeSignature: "sigL", state: "FILLED" }] }), "placed");
  /* Ryntra writes the row before the bytes go out: «PLACING» is not an answer of the chain. */
  assert.equal(knownOutcome({ signature: "sigL", limit: true, history, orders: [{ placeSignature: "sigL", state: "PLACING" }] }), null);
  assert.equal(knownOutcome({ signature: "sigL", limit: true, history, orders: [{ placeSignature: "sigL", state: "FAILED" }] }), "failed");
  assert.equal(knownOutcome({ signature: "sigL", limit: true, history, orders: [{ placeSignature: null, state: "OPEN" }] }), null);
  assert.equal(knownOutcome({ signature: null, limit: false, history, orders: null }), null);
  /* The button to start over stands only under a known outcome. */
  assert.match(TICKET, /\{unsettledKnown \? \(\s*<Button variant="ghost" lang=\{lang\} onClick=\{startOver\}/);
  assert.match(TICKET, /data-read-again/);
  assert.match(PAGE, /history=\{fills\.value\}/);
  assert.match(PAGE, /orders=\{limits\.orders\}/);
});

test("«⋯»: Esc in a sheet opened from it is the sheet's; the watch and a preset give the focus back", () => {
  assert.match(HEADER, /event\.defaultPrevented \|\| \(event\.target as Element\)\.closest\("dialog"\)/);
  assert.match(HEADER, /else if \(target\.closest\("\[data-more-close\], \[data-preset\]"\)\) close\(true\);/);
});

test("UX-152: the strip's figures stand first and wrap; its actions are one «⋯»", () => {
  /* The figures come before the actions in the strip, and wrap to a second line rather than scroll out of reach. */
  const menuStart = HEADER.indexOf("<MoreMenu ");
  const menuEnd = HEADER.indexOf("</MoreMenu>");
  assert.ok(HEADER.indexOf("data-header-stats") < menuStart, "figures, then the one «⋯»");
  assert.match(HEADER, /data-header-more/);
  assert.match(CSS, /\.stats \{[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(CSS, /\.stats \{[^}]*overflow-x: auto;/);
  /* The assistant's three, the watch, a trade's card and the layout's presets — under the one button. */
  for (const part of ["<ExplainMove", "<ShareTrade", "aria-pressed={starred}", "{tools}"]) {
    const at = HEADER.indexOf(part);
    assert.ok(at > menuStart && at < menuEnd, `${part} under «⋯»`);
  }
  /* A meme's figures in the order its risk reads: liquidity first, the volume last. */
  assert.match(HEADER, /const order = market\?\.category === "meme" \? MEME_ORDER : PLAIN_ORDER;/);
  assert.match(TERMINAL, /data-spot-layout/);
});

test("UX-151: «Verified by Jupiter» in a quiet chip, the minting and freezing rights each a chip of their own", () => {
  assert.match(HEADER, /text\("Verified by Jupiter"\)/);
  assert.match(HEADER, /data-authority-chip="mint"/);
  assert.match(HEADER, /data-authority-chip="freeze"/);
  assert.doesNotMatch(CSS, /\.chip\[data-tone="verified"\] \{[^}]*--ry-verified/, "never the colour of «good»");
  assert.equal(SOLANA_UK_TEXT["Verified by Jupiter"], "Перевірено Jupiter");
  assert.equal(SOLANA_UK_TEXT["Not verified by Jupiter"], "Не перевірено Jupiter");
  assert.equal(SOLANA_UK_TEXT["Minting on"], "Випуск увімкнено");
});

test("UX-153: on a phone the chips stand on their own line under the name, nothing over them", () => {
  assert.match(HEADER, /data-header-chips/);
  assert.match(CSS, /\.header > \.chips \{ grid-area: chips; \}/);
});

test("one interval switch: the chart's; the strip's change is the day's", () => {
  assert.doesNotMatch(HEADER, /<select/, "no second interval choice in the strip");
  assert.match(HEADER, /data-header-change/);
  /* The core's list of every interval stands only where its row of quick ones does not. */
  assert.match(CSS, /@container \(min-width: 641px\) \{\s*\.coreChart :global\(\.ryntra-chart__select--frames\) \{\s*display: none;/);
});

test("one row of the chart's tools: the candles' type and the scale in «Вигляд графіка», the symbol once — in the strip", () => {
  assert.match(CSS, /\.coreChart :global\(\.ryntra-chart__scale\),\s*\.coreChart :global\(\.ryntra-chart__select:not\(\.ryntra-chart__select--frames\)\) \{\s*display: none;/);
  assert.match(CHART, /candleType=\{look\.candle\}/);
  assert.match(CHART, /scale=\{look\.scale\}/);
  assert.match(CHART, /setLook\(\{ candle: entry \}\)/);
  assert.match(CHART, /setLook\(\{ scale: entry \}\)/);
  assert.doesNotMatch(CHART, /<b translate="no">\{symbol\}<\/b>/, "the strip names the market");
});

test("the source and the age in one line under the chart", () => {
  assert.match(CSS, /\.coreChart :global\(\.ryntra-chart__age\) \{\s*order: -2;/);
  assert.match(CSS, /\.coreChart :global\(\.ryntra-chart__status\) \{[^}]*flex-wrap: nowrap;/);
});

test("UX-254: one last price with its age — the strip's; the ticket's head prints none of its own", () => {
  assert.match(HEADER, /data-price-age/);
  assert.match(HEADER, /usePriceAge\(state\.status === "ready" \? state\.observedAt : null\)/);
  assert.match(CSS, /\.ticketHost\[data-quote-usd="true"\] :global\(\.ryntra-ticket__ref\) \{\s*display: none;/, "paid in dollars; a price in SOL stays");
});

test("UX-253: the ticket's lines wrap in a narrow column rather than run past its edge", () => {
  assert.match(CSS, /\.ticketHost :global\(\.ryntra-ticket__field-head\) \{\s*flex-wrap: wrap;/);
});

test("the chart is the most of a desk's screen and of a phone's first screen", () => {
  assert.match(PAGE, /tail: "\[data-terminal-chart\]"/);
  for (const key of ["Minting on", "Freeze on", "More actions", "Read again", "Top 10", "Holders", "Liquidity", "Chart scale"]) assert.ok(SOLANA_UK_TEXT[key], key);
});
