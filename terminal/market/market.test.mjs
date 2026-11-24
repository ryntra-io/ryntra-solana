import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf } from "../../city/lib/command/parse.ts";
import { askRows } from "../shell/ask-route.ts";
import { DEFAULT_SORT, FRESH_DAYS, MARKET_TABS, PHONE_MARKET_TABS, cleanQuery, coinName, isFresh, listed, marketRows, matches, nextSort, pickedCoin, sorted, tabCount } from "./market-view.ts";
import { SAVED_MAX, parseSaved, toggleSaved, toggled, useSaved } from "./saved.ts";
import { HERO, READ_AS, SENTENCES, dipPrice, heroCoin, readySentences } from "./sentences.ts";
import { MARKET } from "./words.ts";

/* The Market's list, «Saved» and the agent's ready sentences, held as they are written. */

const NOW = Date.UTC(2026, 10, 16, 12);
const DAY = 86_400_000;
const SOL = "So11111111111111111111111111111111111111112";
const mint = (n) => `${"123456789"[n % 9]}${"A".repeat(40)}`;

function coin(over) {
  return {
    id: mint(over.n ?? 1),
    symbol: "C",
    name: "Coin",
    icon: null,
    district: "core",
    price: 1,
    mcap: 1e6,
    liquidity: 1e5,
    holders: 100,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24h: 1000,
    traders1h: 10,
    organic: 90,
    verified: true,
    launchedAt: "2021-01-01T00:00:00Z",
    ...over,
  };
}

const MARKET_COINS = [
  coin({ n: 1, id: SOL, symbol: "SOL", name: "Wrapped SOL", district: "core", volume24h: 2e9, price: 72, change24h: 3.7 }),
  coin({ n: 2, symbol: "JUP", name: "Jupiter", district: "heights", volume24h: 8e6, change24h: 8.7 }),
  coin({ n: 3, symbol: "BONK", name: "Bonk", district: "strip", volume24h: 5e6, change24h: -2 }),
  coin({ n: 4, symbol: "NVDAx", name: "NVIDIA", district: "avenue", volume24h: 2e7, change24h: 3.8 }),
  coin({ n: 5, symbol: "TREND", name: "Trending unvetted", district: "strip", verified: false, volume24h: 9e9 }),
  coin({ n: 6, symbol: "NEWBY", name: "Fresh launch", district: "docks", verified: false, volume24h: 100, launchedAt: new Date(NOW - 3_600_000).toISOString() }),
  coin({ n: 7, symbol: "FLOAT", name: "Float", district: "strip", volume24h: 300, launchedAt: new Date(NOW - 10 * DAY).toISOString(), unread: ["change5m"] }),
];

test("the Market names the verified coins and the launches of the last hours — never an unvetted pool that only trends", () => {
  assert.deepEqual(listed(MARKET_COINS).map((c) => c.symbol), ["SOL", "JUP", "BONK", "NVDAx", "NEWBY", "FLOAT"]);
});

test("each tab holds its coins: crypto the core and the heights, memes the strip, stocks the avenue, new the young ones", () => {
  const saved = new Set([mint(2)]);
  const under = (tab) => marketRows(MARKET_COINS, { tab, query: "", sort: { key: "symbol", dir: "asc" }, saved, now: NOW }).map((c) => c.symbol);
  assert.deepEqual(under("all"), ["BONK", "FLOAT", "JUP", "NVDAx", "SOL"], "every verified coin, no launch without a vetting");
  assert.deepEqual(under("crypto"), ["JUP", "SOL"]);
  assert.deepEqual(under("memes"), ["BONK", "FLOAT"]);
  assert.deepEqual(under("stocks"), ["NVDAx"]);
  assert.deepEqual(under("fresh"), ["FLOAT", "NEWBY"]);
  assert.deepEqual(under("saved"), ["JUP"]);
  assert.equal(tabCount(MARKET_COINS, "all", saved, NOW), 5);
  assert.deepEqual([...MARKET_TABS], ["all", "crypto", "memes", "stocks", "fresh", "saved"]);
  assert.deepEqual([...PHONE_MARKET_TABS], ["all", "memes", "stocks", "fresh", "saved"], "the phone's five tabs of the approved design");
});

test("a coin is new for its first days, and a launch of the docks always", () => {
  assert.equal(isFresh({ district: "strip", verified: true, launchedAt: new Date(NOW - (FRESH_DAYS - 1) * DAY).toISOString() }, NOW), true);
  assert.equal(isFresh({ district: "strip", verified: true, launchedAt: new Date(NOW - (FRESH_DAYS + 1) * DAY).toISOString() }, NOW), false);
  assert.equal(isFresh({ district: "strip", verified: false, launchedAt: new Date(NOW - DAY).toISOString() }, NOW), false, "unvetted and young is not «new» unless the engine read it as a launch");
  assert.equal(isFresh({ district: "docks", verified: false, launchedAt: null }, NOW), true);
  assert.equal(isFresh({ district: "core", verified: true, launchedAt: new Date(NOW + DAY).toISOString() }, NOW), false, "a date in the future is no date");
});

test("the search finds a coin by its ticker, its name or its own address; a `$` and the case do not matter", () => {
  const jup = MARKET_COINS[1];
  assert.equal(cleanQuery("  $JuP "), "jup");
  assert.ok(matches(jup, "$jup"));
  assert.ok(matches(jup, "piter"));
  assert.ok(matches(jup, jup.id));
  assert.ok(!matches(jup, "bonk"));
  assert.ok(matches(MARKET_COINS[0], "solana"), "SOL answers to the network's own name");
  assert.equal(coinName(MARKET_COINS[0]), "Solana");
  assert.equal(coinName(jup), "Jupiter");
  assert.equal(coinName({ id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", name: "USDT" }), "Tether USD", "the dollars go by their issuers' names");
});

test("a column sorts both ways; a figure the source did not measure stands last either way", () => {
  assert.deepEqual(DEFAULT_SORT, { key: "volume24h", dir: "desc" }, "the busiest coins first, as the approved design opens");
  assert.deepEqual(nextSort(DEFAULT_SORT, "volume24h"), { key: "volume24h", dir: "asc" });
  assert.deepEqual(nextSort({ key: "volume24h", dir: "asc" }, "volume24h"), { key: "volume24h", dir: "desc" });
  assert.deepEqual(nextSort(DEFAULT_SORT, "symbol"), { key: "symbol", dir: "asc" });
  assert.deepEqual(nextSort(DEFAULT_SORT, "change1h"), { key: "change1h", dir: "desc" });
  const rows = listed(MARKET_COINS);
  assert.deepEqual(sorted(rows, DEFAULT_SORT).map((c) => c.symbol), ["SOL", "NVDAx", "JUP", "BONK", "FLOAT", "NEWBY"]);
  assert.equal(sorted(rows, { key: "change5m", dir: "desc" }).at(-1).symbol, "FLOAT");
  assert.equal(sorted(rows, { key: "change5m", dir: "asc" }).at(-1).symbol, "FLOAT");
  assert.deepEqual(sorted(rows, { key: "change24h", dir: "desc" }).slice(0, 2).map((c) => c.symbol), ["JUP", "NVDAx"]);
});

test("the side panel keeps its coin while the market names it: a fresh read that reorders the list never moves it", () => {
  const rows = listed(MARKET_COINS);
  assert.equal(pickedCoin(rows, MARKET_COINS, mint(3)).symbol, "BONK");
  const reordered = sorted(rows, { key: "change24h", dir: "asc" });
  assert.equal(pickedCoin(reordered, MARKET_COINS, SOL).symbol, "SOL", "SOL stays though another coin leads now");
  const memes = rows.filter((c) => c.district === "strip");
  assert.equal(pickedCoin(memes, MARKET_COINS, SOL).symbol, "SOL", "a search that hides it does not swap the ticket under the person");
  assert.equal(pickedCoin(rows, MARKET_COINS, "gone").symbol, "SOL", "a coin the market no longer names gives way to the first");
  assert.equal(pickedCoin(rows, MARKET_COINS, null).symbol, "SOL");
  assert.equal(pickedCoin([], MARKET_COINS, null), null);
});

test("«Saved» keeps mints only, each once, the newest; a star adds a coin last and takes it away again", () => {
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved("{bad"), []);
  assert.deepEqual(parseSaved(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parseSaved(JSON.stringify([mint(1), "not a mint", mint(1), 7, mint(2)])), [mint(1), mint(2)]);
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const many = Array.from({ length: SAVED_MAX + 5 }, (_, i) => `${B58[i % 58]}${B58[Math.floor(i / 58)]}${"B".repeat(40)}`);
  assert.equal(parseSaved(JSON.stringify(many)).length, SAVED_MAX);
  assert.deepEqual(toggled([mint(1)], mint(2)), [mint(1), mint(2)]);
  assert.deepEqual(toggled([mint(1), mint(2)], mint(1)), [mint(2)]);
  assert.deepEqual(toggled([mint(1)], "nope"), [mint(1)]);
  useSaved.setState({ mints: [], read: true });
  toggleSaved(mint(3));
  assert.deepEqual(useSaved.getState().mints, [mint(3)]);
  toggleSaved(mint(3));
  assert.deepEqual(useSaved.getState().mints, []);
});

test("a sentence is offered only where the agent's line reads it as what it says and a shelf that is on takes it", () => {
  const all = SENTENCES.map((id) => ({ id, text: id }));
  const reads = { tradeDaily: "coin", dips: "buy", launch: null, buy: "buy", limit: "order", chart: "chart" };
  assert.deepEqual(readySentences(all, (text) => reads[text]).map((s) => s.id), ["buy", "limit", "chart"], "today: the Market's own sentences");
  const agents = { tradeDaily: "autopilot", dips: "instruct", launch: "launch", buy: "buy", limit: "order", chart: "chart" };
  assert.deepEqual(readySentences(all, (text) => agents[text]).map((s) => s.id), ["tradeDaily", "dips", "launch"], "with Agents and Launch on: the approved design's three");
  for (const id of SENTENCES) assert.ok(READ_AS[id].length > 0, id);
});

test("the block's sentences read, in both languages, as what they say — on the line the terminal has today", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
  const book = bookOf(snapshot.towers);
  const market = (id) => id === "market";
  const gates = { trade: true, spot: true, money: false, earn: false, launch: false, instruct: false };
  for (const lang of ["en", "uk"]) {
    const w = MARKET[lang];
    const price = lang === "uk" ? "68,4" : "68.4";
    const kind = (text) => askRows(text, book, { subject: null }, market, gates)[0]?.command.kind ?? null;
    assert.equal(kind(w.sayBuy("SOL")), "buy", lang);
    assert.equal(kind(w.sayLimit("SOL", price)), "order", lang);
    assert.equal(kind(w.sayChart("JUP")), "chart", lang);
    assert.equal(kind(w.sayLaunch), null, `${lang}: Launch is not on, so «launch me a token» is not offered`);
    // Limits shut by the engine: the sentence would open the coin, not a limit — it is not offered as one.
    assert.equal(askRows(w.sayLimit("SOL", price), book, { subject: null }, market, { ...gates, spot: false })[0]?.command.kind, "coin", lang);
  }
});

test("a dip's price is a little under the market, written as a person would type it", () => {
  assert.equal(dipPrice(72.03), "68.43");
  assert.equal(dipPrice(236.72), "225");
  assert.equal(dipPrice(0.2655), "0.2522");
  assert.equal(dipPrice(0.002917), "0.00277");
  assert.equal(dipPrice(0), null);
  assert.equal(dipPrice(Number.NaN), null);
});

test("the first screen's promise: the agent's four sentences, each read as what it says, none with a sum", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
  const book = bookOf(snapshot.towers);
  const every = () => true;
  const gates = { trade: true, spot: true, money: true, earn: true, launch: true, instruct: false, agentTrade: true, agentLaunch: true };
  assert.deepEqual(HERO, ["scout", "tradeDaily", "launch", "earn"]);
  for (const lang of ["en", "uk"]) {
    const w = MARKET[lang];
    const kind = (text) => askRows(text, book, { subject: null }, every, gates)[0]?.command.kind ?? null;
    const hero = [
      { id: "scout", text: w.sayScout },
      { id: "tradeDaily", text: w.sayTradeDaily("JUP") },
      { id: "launch", text: w.sayLaunch },
      { id: "earn", text: w.sayEarn("SOL") },
    ];
    assert.deepEqual(readySentences(hero, kind, HERO.length).map((s) => s.id), HERO, lang);
    // An example names no sum.
    for (const s of hero) assert.ok(!/\d/.test(s.text), `${lang}: ${s.text}`);
    // Agents shut: the trading sentence is not offered; the rest still are.
    const shut = (text) => askRows(text, book, { subject: null }, every, { ...gates, agentTrade: false })[0]?.command.kind ?? null;
    assert.ok(!readySentences(hero, shut, HERO.length).some((s) => s.id === "tradeDaily"), lang);
  }
  assert.equal(MARKET.uk.sayTradeDaily("JUP"), "Торгуй JUP щодня");
  // A one-time find — the market's new coins — never «keep finding for me» before the scout is.
  assert.equal(MARKET.uk.sayScout, "Знайди нові монети");
  assert.equal(MARKET.en.sayScout, "Find new coins");
});

test("«Trade … with 0.1 SOL a day» names JUP, else MET — never another coin (decision 108)", () => {
  assert.equal(heroCoin([{ symbol: "PUMP" }, { symbol: "Bonk" }, { symbol: "JUP" }]).symbol, "JUP");
  assert.equal(heroCoin([{ symbol: "PUMP" }, { symbol: "MET" }]).symbol, "MET");
  assert.equal(heroCoin([{ symbol: "PUMP" }, { symbol: "Bonk" }]), null);
  assert.equal(heroCoin([]), null);
});

test("the home page draws the agent's promise first, then the market's depth, and the promise never asks for a wallet", () => {
  const screen = readFileSync(new URL("./MarketScreen.tsx", import.meta.url), "utf8");
  // Decision 109: the agent's panel, the five doors, the Pulse, then the table.
  const at = ["<HomeHero", "<Tiles", "<Pulse", "<DepthMarket"].map((part) => screen.indexOf(part));
  assert.ok(at.every((i) => i > 0) && at.every((i, n) => n === 0 || i > at[n - 1]), "the agent's panel, the doors, the Pulse, the table — in that order");
  const hero = readFileSync(new URL("./HomeHero.tsx", import.meta.url), "utf8");
  assert.ok(!/connectWallet|cityAccount/.test(hero), "the promise never asks for a wallet: the shelf's card does, once the person decided");
  assert.ok(hero.includes("funnelSay('agent_hint')"));
  assert.ok(hero.includes("funnelSay('agent_said')"));
});

test("the panel names no budget of ours, in a sentence or in its line", () => {
  const hero = readFileSync(new URL("./HomeHero.tsx", import.meta.url), "utf8");
  assert.ok(!/FIRST_BUDGET|budgetText|perDay|heroTerms\(/.test(hero), "no sum in the panel");
  assert.ok(hero.includes("m.heroLimit"), "the one line on the money: the budget is the person's");
  for (const lang of ["en", "uk"]) assert.ok(!/\d/.test(MARKET[lang].heroLimit), lang);
});

test("the risk's edge in words on the first screen — at most the person's budget a day, no withdrawal, a stop", () => {
  const parts = { en: [/at most your budget a day/, /can’t withdraw/, /stop anytime/], uk: [/не більше твого бюджету на день/, /вивести не може/, /стоп будь-коли/] };
  for (const lang of ["en", "uk"]) {
    const line = MARKET[lang].heroLimit;
    assert.equal(line.split(" · ").length, 3, `${lang}: three parts`);
    for (const part of parts[lang]) assert.match(line, part, lang);
  }
  // Big: the panel's body type in the words' own ice, never the caption's grey.
  const css = readFileSync(new URL("./home.module.css", import.meta.url), "utf8");
  const safe = css.slice(css.indexOf(".safe {"), css.indexOf("}", css.indexOf(".safe {")));
  assert.match(safe, /var\(--type-base\)/);
  assert.match(safe, /color: var\(--ice\)/);
  assert.ok(!/--type-caption|--dim/.test(safe), "never small and grey");
});

test("on a phone the agent's field and its «Say» stand in the thumb's reach: a dock over the tab bar, the page keeping room for it", () => {
  const hero = readFileSync(new URL("./HomeHero.tsx", import.meta.url), "utf8");
  assert.match(hero, /data-terminal="ask-dock">[\s\S]{0,120}\{ask\(true\)\}\s*<\/div>/u, "the dock draws the same field and «Say»");
  assert.match(hero, /body\.style\.setProperty\('--sheet-h'/u, "the page keeps room under its last block");
  const css = readFileSync(new URL("./home.module.css", import.meta.url), "utf8");
  const phone = css.slice(css.lastIndexOf("@media (max-width: 767px)"));
  assert.match(phone, /\.ask:not\(\.askDock\) \{\n    display: none;/u, "one field and one amber «Say» on a phone");
  assert.match(phone, /position: fixed;[\s\S]*bottom: calc\(var\(--tabbar\) \+ env\(safe-area-inset-bottom\)\);/u, "right over the tab bar");
  assert.match(css.slice(0, css.lastIndexOf("@media (max-width: 767px)")), /\.dock \{\n  display: none;/u, "a desk draws no dock");
  // Every sentence whole and in sight on a phone: two by two, of one width, a long one on two lines — never off the edge.
  const phoneHero = css.slice(css.indexOf("@media (max-width: 767px)"), css.lastIndexOf("@media (max-width: 767px)"));
  assert.match(phoneHero, /\.says \{\n    display: grid;\n    grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(phoneHero, /\.say \{[^}]*white-space: normal;/u);
  assert.doesNotMatch(phoneHero, /overflow-x: auto/u);
  // The agent's answer stands by the field it answers: over the dock on a phone, in plain size — never the edge's type.
  assert.match(hero, /data-terminal="ask-dock">\s*\{note \? <AskNote note=\{note\} className=\{h\.dockNote\} \/> : null\}/u);
  assert.match(phoneHero, /\.under \.note \{\n    display: none;/u);
  const note = css.slice(css.indexOf(".note,\n.dockNote {"), css.indexOf("}", css.indexOf(".note,\n.dockNote {")));
  assert.match(note, /var\(--type-small\)/u);
  // The edge breaks only before a «·», never after one.
  assert.match(hero, /\{at \? <span className=\{h\.dot\}>·\{'\\u00a0'\}<\/span> : null\}/u);
});

test("«Find new coins» opens the agent that finds them — the Scout — once its screen stands; the market's new coins before", async () => {
  const { SCOUT_AGENT, scoutRow, NEW_COINS } = await import("../shell/ask-route.ts");
  assert.deepEqual(SCOUT_AGENT, { shelf: "agents", mint: null, path: "/agent?ai=scout" });
  assert.deepEqual(scoutRow("Find new coins").target, SCOUT_AGENT);
  assert.equal(NEW_COINS.path, "/launch?tab=fresh");
  const hero = readFileSync(new URL("./HomeHero.tsx", import.meta.url), "utf8");
  assert.match(hero, /scoutReady\(\) \? scoutRow\(sentence\.text\) : newCoinsRow\(sentence\.text\)/u);
});
