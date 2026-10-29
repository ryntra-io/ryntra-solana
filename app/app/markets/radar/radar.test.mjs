// SOL-R1 «Market Radar — мем-режим»: «Ринки» → «Меми» is the Radar — six feeds with live data and the time of the
// read; from a row's card — the chart, the risks and the total fees before buying. Read-only: nothing here signs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pulseRowOf } from "../../../../lib/spot/pulse.ts";
import { cardFactsOf, chartTimeframeOf, firstCostSum } from "./radar-model.ts";
import { RADAR_WORDS } from "./radar-words.ts";

const root = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const RADAR = read("app/app/markets/radar/meme-radar.tsx");
const CARD = read("app/app/markets/radar/radar-card.tsx");
const CSS = read("app/app/markets/radar/radar.module.css");
const SCREENER = read("app/app/markets/markets-screener.tsx");
const PULSE_ROUTE = read("app/api/spot/pulse/route.ts");
const COST_ROUTE = read("app/api/spot/radar/cost/route.ts");

const NOW = Date.parse("2026-10-20T12:00:00Z");
const MINT = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const raw = (overrides = {}) => ({
  id: MINT,
  name: "Three Fen",
  symbol: "3FEN",
  launchpad: "pump.fun",
  usdPrice: 0.0000369,
  mcap: 36_900,
  liquidity: 12_280,
  holderCount: 412,
  firstPool: { id: MINT, createdAt: "2026-10-20T09:00:00Z" },
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: false, devBalancePercentage: 2.1, topHoldersPercentage: 31.5, devMints: 7, devMigrations: 2 },
  tags: ["unknown"],
  ...overrides,
});

test("«Ринки» → «Меми» is Market Radar: its own feeds in place of the table, no order select of the table above it", () => {
  assert.match(SCREENER, /const radar = tab === "memes";/);
  assert.match(SCREENER, /\{radar \? \(\s*<MemeRadar locale=\{locale\} query=\{query\} watched=\{watchlist\.mints\} onToggleWatch=\{watchlist\.toggle\} \/>/);
  /* SOL-R4: «Гаманці» hides the order select too; DSC-1: so does «Події». */
  assert.match(SCREENER, /\{radar \|\| wallets \|\| events \? null : \(\s*<label className=\{styles\.sort\}>/);
});

test("six feeds read live in meme mode, each with the time of its read and its sources under it", () => {
  assert.match(RADAR, /RADAR_FEEDS\.map\(\(feed, index\) =>/);
  assert.match(RADAR, /`\/api\/spot\/pulse\?feed=\$\{view\.feed\}&mode=meme&window=\$\{view\.window\}`/);
  assert.match(RADAR, /`\/api\/spot\/pulse\?feed=watchlist&mode=meme&window=\$\{view\.window\}&mints=\$\{encodeURIComponent\(mints\)\}`/);
  assert.match(RADAR, /pulse\("updatedAt", \{ time: new Date\(answer\.observedAt\)/, "the read's own time, to the second");
  assert.match(RADAR, /data-observed-at=\{answer\.observedAt\}/);
  assert.match(RADAR, /word\("sources"\)/);
  assert.match(PULSE_ROUTE, /mode: pulseModeOf\(params\.get\("mode"\)\)/);
  for (const feed of ["New", "Growing", "Near Graduation", "Graduated", "Trending", "Watchlist"]) {
    assert.ok(Object.values(RADAR_WORDS).some((pair) => pair.en === feed), `the registry's own name: ${feed}`);
  }
  assert.deepEqual(
    ["feedNew", "feedGrowing", "feedSoon", "feedDex", "feedTrending", "feedWatchlist"].map((key) => RADAR_WORDS[key].uk),
    ["Нові", "Ростуть", "Майже на DEX", "Вийшли на DEX", "Тренди", "Обране"],
  );
});

test("the filters: liquidity, age, holders, the creator's history and concentration — Pulse's panel, kept apart from Home's", () => {
  assert.match(RADAR, /<Filters key=\{filterGeneration\}/);
  assert.match(RADAR, /const FILTER_KEY = "ryntra\.radar\.filter\.v1";/);
  const panel = read("app/app/home/pulse.tsx");
  for (const key of ["liquidityMin", "ageMinHours", "ageMaxHours", "holdersMin", "creatorLaunchesMax", "creatorGraduatedMin", "top10Max", "devMax"]) {
    assert.match(panel, new RegExp(`field\\("${key}"`), key);
  }
});

test("a row's name opens its card; the card holds the chart, the risks and the total fees before buying", () => {
  assert.match(RADAR, /onOpen=\{setOpened\}/);
  assert.match(CARD, /<CardChart row=\{row\} age=\{age\} locale=\{locale\} \/>/);
  assert.match(CARD, /<AreaChart/, "the core's compact chart, with its source and age");
  assert.match(CARD, /cardFactsOf\(row, now\)\.map/);
  assert.match(CARD, /<CostLines mint=\{row\.mint\} usd=\{sum\} locale=\{locale\} \/>/);
  assert.match(CARD, /`\/api\/spot\/radar\/cost\?mint=\$\{encodeURIComponent\(mint\)\}&usd=\$\{usd\}`/);
  assert.match(CARD, /showModal\(\)/, "a modal dialog: the focus stays in the card, Escape closes it");
  assert.match(CSS, /@media \(min-width: 720px\) \{\s*\.sheet\[open\] \{\s*align-items: center;/, "a sheet from a phone's foot, a panel in a desk's middle");
});

test("read-only: the card's one action opens the token's Review; no signature, no transaction, no order here", () => {
  for (const [name, source] of [
    ["radar", RADAR],
    ["card", CARD],
    ["cost route", COST_ROUTE],
  ]) {
    assert.doesNotMatch(source, /signTransaction|sendTransaction|swap\/order|swap\/execute|transactionBase64/, `${name}: nothing signed or sent`);
  }
  assert.match(CARD, /href=\{pulseHref\(row, launch \? undefined : sum\)\}/, "the sum goes to the token's own page and its Review");
  assert.match(COST_ROUTE, /chooseQuote\(\{ inputMint: USDC_MINT, outputMint: mint, amountRaw: usdcRawOf\(usd\)/, "the ticket's own lane choice, no wallet");
  assert.doesNotMatch(COST_ROUTE, /taker:/);
  assert.match(COST_ROUTE, /catch \(cause\) \{[\s\S]*?code: "QUOTE_UNREACHABLE"/, "a quote that threw answers in the route's own shape, never a bare 500");
  assert.match(COST_ROUTE, /lane: choice\.lane/, "the lane decides what the quote has sized");
});

test("no geoblock (decision 38), and the words carry none of the engine's jargon", () => {
  for (const source of [RADAR, CARD, COST_ROUTE]) assert.doesNotMatch(source, /x-vercel-ip-country|geoip|request\.geo|blockedCountr/i);
  for (const [key, pair] of Object.entries(RADAR_WORDS)) {
    for (const text of [pair.en, pair.uk]) {
      assert.doesNotMatch(text, /драбин|ladder|DAMM|DLMM|bin step|Шлях до DEX|Крива повна|Curve full/i, key);
      assert.doesNotMatch(text, /біржа|біржі|біржу/u, `${key}: «DEX», one word for one thing (B17)`);
      assert.doesNotMatch(text, /\bRyn\b/, `${key}: the assistant is «Ryntra»`);
    }
    assert.ok(pair.en.trim() && pair.uk.trim(), `${key}: both languages`);
  }
});

test("the card's risks: the rights and Jupiter's flag as the token page says them, then who holds, the creator's history, the market", () => {
  const row = pulseRowOf(raw(), NOW);
  const facts = cardFactsOf(row, NOW);
  assert.deepEqual(facts.map((fact) => fact.code), ["MINT", "FREEZE", "TOP10", "CREATOR_HOLDS", "CREATOR_HISTORY", "LIQUIDITY", "HOLDERS", "AGE"]);
  assert.deepEqual(facts.filter((fact) => fact.tone === "notice").map((fact) => fact.code), ["FREEZE"], "a right still on; nothing else scored");
  assert.deepEqual(facts.find((fact) => fact.code === "CREATOR_HISTORY"), { code: "CREATOR_HISTORY", tone: "plain", value: 7, second: 2 });
  assert.equal(facts.find((fact) => fact.code === "AGE").value, 3);
  const unread = cardFactsOf(pulseRowOf(raw({ audit: undefined, holderCount: undefined }), NOW), NOW);
  assert.equal(unread[0].code, "RIGHTS_UNREAD");
  assert.equal(unread.find((fact) => fact.code === "CREATOR_HISTORY").tone, "unread", "not stated, said so — never «none»");
  assert.equal(unread.find((fact) => fact.code === "TOP10").tone, "unread");
  const flagged = cardFactsOf(pulseRowOf(raw({ audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, isSus: true } }), NOW), NOW);
  assert.ok(flagged.some((fact) => fact.code === "FLAGGED" && fact.tone === "notice"));
  const curve = cardFactsOf({ ...row, curve: { venue: "pump", progressPct: 61.5, complete: false } }, NOW);
  assert.deepEqual(curve.at(-1), { code: "CURVE", tone: "plain", value: 61.5 });
});

test("the card's risks agree with its row (SOL-C5): a borrowed name first among them, the creator's tokens, a thin pool, few holders and minutes on the market in the caution colour", () => {
  const copy = pulseRowOf(raw({ name: "OFFICIAL TRUMP", symbol: "TRUMP", liquidity: undefined, holderCount: 3, firstPool: { id: MINT, createdAt: new Date(NOW - 60_000).toISOString() }, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 446, devMigrations: 0 } }), NOW);
  const facts = cardFactsOf(copy, NOW);
  assert.deepEqual(facts.find((fact) => fact.code === "BORROWED"), { code: "BORROWED", tone: "notice", value: null, label: "Donald Trump" });
  assert.deepEqual(facts.filter((fact) => fact.tone === "notice").map((fact) => fact.code), ["BORROWED", "CREATOR_HISTORY", "LIQUIDITY", "HOLDERS", "AGE"]);
  assert.match(CARD, /<MintCopy mint=\{row\.mint\} locale=\{locale\} \/>/, "the card shows the token's own address, one press to copy (UX-154)");
  assert.match(RADAR, /twins=\{twins\.get\(row\.mint\) \?\? 0\}/, "a feed's copies of one name show their address in the Radar as on Home");
});

test("the card's chart reads candles by the token's age; its fees are counted first for $100 when it is a quick sum", () => {
  assert.equal(chartTimeframeOf(0.5), "1m");
  assert.equal(chartTimeframeOf(30), "15m");
  assert.equal(chartTimeframeOf(500), "1h");
  assert.equal(chartTimeframeOf(null), "1h");
  assert.equal(firstCostSum([10, 50, 100, 500]), 100);
  assert.equal(firstCostSum([25, 75, 150, 300]), 25);
  assert.equal(firstCostSum([]), 100);
});
