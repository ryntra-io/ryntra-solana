import { test } from "node:test";
import assert from "node:assert/strict";

import { predictOpen, realOpen } from "./flag.ts";
import { artOf, ENDING, searchTab, cents, chance, closesIn, headSide, isDelayed, DELAY_MS, kickerOf, leadOf, marketOf, marketsOf, readDiscover, signedPct, signedUsd, tabsOf, toWin, TRENDING, usd, volumeText } from "./markets.ts";
import { CATEGORIES, discoverBody, discoverEvents } from "./test-fixtures.mjs";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("the district opens only where its switch says open, and real money only where both do", () => {
  for (const v of [undefined, "", "true", "OPEN", "closed", "1"]) assert.equal(predictOpen(v), false, String(v));
  assert.equal(predictOpen("open"), true);
  assert.equal(predictOpen(" open "), true);
  assert.equal(realOpen("open", undefined), false, "Practice only without the real switch");
  assert.equal(realOpen("open", "closed"), false);
  assert.equal(realOpen(undefined, "open"), false, "no real money in a closed district");
  assert.equal(realOpen("closed", "open"), false);
  assert.equal(realOpen("open", "open"), true);
});

test("prices are the venue's, in cents, and the chance in whole percent — never a flat 0 or 100 while trading", () => {
  assert.equal(cents(0.58), "58¢");
  assert.equal(cents(0.425), "43¢");
  assert.equal(cents(0.004), "<1¢");
  assert.equal(cents(0.996), ">99¢");
  assert.equal(cents(0), "0¢");
  assert.equal(cents(1), "100¢");
  assert.equal(cents(Number.NaN), "—");
  assert.equal(chance(0.58), "58%");
  assert.equal(chance(0.004), "<1%");
  assert.equal(chance(0.996), ">99%");
  assert.equal(chance(1), "100%");
});

test("an amount wins its shares in dollars: spend ÷ price, rounded down to the cent", () => {
  assert.equal(toWin(100, 0.58), 172.41, "the mock's $100 at 58¢");
  assert.equal(toWin(25, 0.5), 50);
  assert.equal(toWin(10, 0.42), 23.8);
  assert.equal(toWin(10, 1), 10);
  assert.equal(toWin(0, 0.5), 0);
  assert.equal(toWin(-5, 0.5), 0);
  assert.equal(toWin(10, 0), 0, "no price, no win");
  assert.equal(toWin(10, 1.2), 0, "a price above a dollar is no price");
  assert.equal(toWin(Number.NaN, 0.5), 0);
});

test("a card is an open, priced market: Yes then No, or the most likely outcomes first", () => {
  const markets = marketsOf(discoverEvents(NOW), NOW);
  const ids = markets.map((m) => m.eventId);
  assert.deepEqual(ids, ["ev-btc", "ev-fed", "ev-sol", "ev-ars", "ev-etf", "ev-cease", "ev-eth", "ev-gold"], "closed, past, unpriced, mixed and repeated events have no card");
  const btc = markets[0];
  assert.equal(btc.binary, true);
  assert.deepEqual(btc.sides.map((s) => s.label), ["Yes", "No"]);
  assert.deepEqual(btc.categories, ["crypto"]);
  assert.deepEqual(btc.venues, ["Polymarket", "Kalshi"]);
  const ars = markets.find((m) => m.eventId === "ev-ars");
  assert.equal(ars.binary, false);
  assert.deepEqual(ars.sides.map((s) => s.label), ["Arsenal", "Draw", "Chelsea"]);
  assert.equal(ars.question, "Match winner");
  const fed = markets.find((m) => m.eventId === "ev-fed");
  assert.equal(fed.question, "25 bps increase");
  assert.equal(fed.marketCount, 5, "an event of several markets says how many");
  assert.equal(markets[0].marketCount, 1);
});

test("the side that leads is the one the venue prices highest, Yes on a tie; a yes/no card speaks of Yes", () => {
  const markets = marketsOf(discoverEvents(NOW), NOW);
  const eth = markets.find((m) => m.eventId === "ev-eth");
  assert.equal(leadOf(eth).label, "No", "No leads at 81%");
  assert.equal(headSide(eth).label, "Yes", "the card's chance is still Yes's");
  assert.equal(leadOf(markets.find((m) => m.eventId === "ev-ars")).label, "Arsenal");
  assert.equal(headSide(markets.find((m) => m.eventId === "ev-ars")).label, "Arsenal");
  const tie = { sides: [{ id: "y", label: "Yes", p: 0.5 }, { id: "n", label: "No", p: 0.5 }] };
  assert.equal(leadOf(tie).label, "Yes");
});

test("an event's picture is kept only as an https address", () => {
  const [btc] = discoverEvents(NOW);
  assert.equal(marketOf({ ...btc, image: "https://assets.agg.market/e/btc.webp" }, NOW).image, "https://assets.agg.market/e/btc.webp");
  assert.equal(marketOf({ ...btc, image: "javascript:alert(1)" }, NOW).image, null);
  assert.equal(marketOf({ ...btc, image: "http://plain.example/x.png" }, NOW).image, null);
  assert.equal(marketOf({ ...btc, image: null }, NOW).image, null);
});

test("the tabs are Trending, Ending soon and the engine's own categories: Crypto, Politics, Sports, World first", () => {
  const tabs = tabsOf(CATEGORIES);
  assert.deepEqual(tabs.map((t) => t.label), ["Trending", "Ending soon", "Crypto", "Politics", "Sports", "World", "Tech"]);
  assert.equal(tabs[0], TRENDING);
  assert.equal(tabs[0].category, null);
  assert.equal(tabs[1], ENDING);
  assert.equal(tabs[1].sort, "ending", "the soonest closes, as the engine sorts them");
  assert.deepEqual(tabs.slice(2).map((t) => t.category), ["crypto", "politics", "sports", "world", "tech"], "then the rest by the day's volume, capped");
  assert.deepEqual(tabsOf(CATEGORIES, true).map((t) => t.id), ["trending", "ending"], "without the engine's categories: the two alone");
  assert.deepEqual(tabsOf([]).map((t) => t.id), ["trending", "ending"]);
  assert.deepEqual(tabsOf([{ slug: "<x>", name: "Bad" }, { slug: "crypto", name: "Crypto" }, { slug: "crypto", name: "Crypto again" }]).map((t) => t.id), ["trending", "ending", "crypto"], "an odd or repeated slug is no tab");
});

test("a search is a tab of its own: two letters at least, the words trimmed", () => {
  assert.equal(searchTab(""), null);
  assert.equal(searchTab(" b "), null);
  assert.deepEqual(searchTab("  Bitcoin   October "), { id: "q:bitcoin october", label: "Bitcoin October", category: null, q: "Bitcoin October" });
  assert.equal(searchTab("x".repeat(200)).q.length, 80);
});

test("the discover answer is read only in its own shape; an empty page reads as no cards", () => {
  const body = discoverBody(NOW);
  const read = readDiscover(body);
  assert.equal(read.events.length, body.events.length);
  assert.equal(read.categories.length, CATEGORIES.length);
  assert.equal(read.categoriesUnavailable, false);
  assert.equal(readDiscover({ ...body, categoriesUnavailable: true }).categoriesUnavailable, true);
  assert.equal(readDiscover({ events: [], readAt: new Date(NOW).toISOString() }).categoriesUnavailable, true, "no categories in the answer: none to tab");
  for (const bad of [null, "x", {}, { events: [] }, { events: "x", readAt: "now" }, { events: [], readAt: "not a time" }]) assert.equal(readDiscover(bad), null);
  assert.deepEqual(marketsOf(readDiscover({ events: [], readAt: new Date(NOW).toISOString() }).events, NOW), []);
  assert.equal(readDiscover({ events: [null, 1, { id: "x" }, { id: "y", leading: [] }], readAt: new Date(NOW).toISOString() }).events.length, 1, "only events with a leading list");
});

test("a read older than two minutes is delayed, and so is one that cannot be dated", () => {
  const at = new Date(NOW).toISOString();
  assert.equal(isDelayed(at, NOW + DELAY_MS), false);
  assert.equal(isDelayed(at, NOW + DELAY_MS + 1), true);
  assert.equal(isDelayed(null, NOW), true);
  assert.equal(isDelayed("garbage", NOW), true);
});

test("figures read the way a person reads them", () => {
  assert.equal(usd(1240), "$1,240.00");
  assert.equal(usd(-12), "−$12.00");
  assert.equal(signedUsd(324.5), "+$324.50");
  assert.equal(signedUsd(-0.004), "$0.00");
  assert.equal(signedUsd(-12), "−$12.00");
  assert.equal(signedPct(24.3), "+24.3%");
  assert.equal(signedPct(-5.04), "−5.0%");
  assert.equal(signedPct(null), "");
  assert.equal(volumeText(4_210_000), "$4.2M");
  assert.equal(volumeText(862_000), "$862K");
  assert.equal(volumeText(null), "—");
  assert.equal(closesIn(new Date(NOW + 42 * MIN).toISOString(), NOW), "42m");
  assert.equal(closesIn(new Date(NOW + 3 * DAY + 4 * HOUR).toISOString(), NOW), "3d 4h");
  assert.equal(closesIn(new Date(NOW - MIN).toISOString(), NOW), "Closed");
  assert.equal(closesIn(null, NOW), "No set close");
});

test("a card without a picture falls back to its category's art; the kicker is its category", () => {
  const markets = marketsOf(discoverEvents(NOW), NOW);
  const tabs = tabsOf(CATEGORIES);
  assert.equal(artOf(markets.find((m) => m.eventId === "ev-btc")), "crypto");
  assert.equal(artOf(markets.find((m) => m.eventId === "ev-ars")), "sports");
  assert.equal(artOf(markets.find((m) => m.eventId === "ev-fed")), "politics");
  assert.equal(artOf(markets.find((m) => m.eventId === "ev-cease")), "world");
  assert.equal(artOf({ categories: [], title: "Will it rain?" }), "market");
  // A position row knows the title only: a race for the House is politics, not a match.
  assert.equal(artOf({ categories: [], title: "Which party will win the House in 2026?" }), "politics");
  assert.equal(artOf({ categories: [], title: "Texas Governor winner?" }), "politics");
  assert.equal(artOf({ categories: [], title: "Will Arsenal win the league?" }), "sports");
  assert.equal(artOf({ categories: [], title: "Counter-Strike: Vitality vs Natus Vincere (BO3)" }), "sports");
  assert.equal(kickerOf(markets.find((m) => m.eventId === "ev-btc"), tabs), "CRYPTO");
  assert.equal(kickerOf({ categories: [] }, tabs), null);
});
