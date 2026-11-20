import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { straightBars } from "../../city/lib/bots/path.ts";
import { MENU } from "../shell/menu.ts";
import { BOTS_PATH, BOT_IDS, EVERY_BOT_DOOR, PAPER_KIND, botHref, botOpen, botsOpen, isBotId, isPaperBot } from "./kinds.ts";
import { CHOICES_MOST, LADDER_STEP_CHOICES, PACES, coinChoices, ladderDraft, ladderRows, ladderStart, paceOf, paperRows, paperStart, paperWorking, searchable, typedNumber, venueOf, weekOnPaper } from "./rows.ts";
import { BOT_PAGE } from "./kinds.ts";
import { BOTS } from "./words.ts";

/* «Bots»: a bot is a rule a person sets, each a page of its own, as many of
   one kind as she likes, each stopped on its own. The bots stand on the city's engines as they are; nothing here signs
   but the page's own button, and the paper ones never sign at all. */

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const page = (path) => new URL(`../../app/(terminal)${path}/page.tsx`, import.meta.url);

/* ------------------------------------------------------------------------------------------------ the bots */

test("the bots are the menu's, in its order, each at its own page", () => {
  const items = MENU.find((group) => group.id === "bots").items.filter((item) => item.ready);
  // «All bots» — the catalogue at the section's own address — stands first, as the section's first tab.
  assert.deepEqual([items[0].id, items[0].href, items[0].shelf], ["allBots", BOTS_PATH, "agents"], "the catalogue first, as the tabs stand");
  assert.equal(BOTS.uk.all, "Усі боти", "the item's name is the tab's");
  const menu = items.slice(1);
  assert.deepEqual(
    menu.map((item) => item.id),
    [...BOT_IDS],
    "every bot with a screen is an item that stands, in the same order",
  );
  for (const item of menu) {
    assert.equal(item.href, botHref(item.id));
    assert.equal(item.shelf, "agents", "the bots stand on the Agents shelf, as the menu places them");
    assert.ok(existsSync(page(item.href)), `${item.id}: its page`);
    assert.match(readFileSync(page(item.href), "utf8"), new RegExp(`botOpen\\("${item.id}", botDoors\\(\\)\\)`), `${item.id}: its page answers only where the bot stands`);
  }
  assert.ok(existsSync(page(BOTS_PATH)), "the section's own address");
  for (const id of ["copy", "keeper"]) assert.equal(MENU.find((group) => group.id === "bots").items.find((item) => item.id === id).ready, false, `${id}: no screen yet, no item`);
  assert.equal(isBotId("grid"), true);
  assert.equal(isBotId("keeper"), false);
});

test("a bot stands where its engine runs; the paper ones everywhere", () => {
  assert.deepEqual(botsOpen(EVERY_BOT_DOOR), ["recurring", "grid", "ladder", "signals", "autopilot"]);
  assert.deepEqual(botsOpen({ trader: false, ladder: false, pilot: false }), ["grid", "signals"]);
  assert.equal(botOpen("recurring", { trader: true, ladder: false, pilot: false }), true);
  assert.equal(botOpen("ladder", { trader: true, ladder: false, pilot: true }), false);
  assert.equal(botOpen("autopilot", { trader: true, ladder: true, pilot: false }), false, "the money autopilot opens with its engine");
  assert.deepEqual(Object.keys(PAPER_KIND), ["signals"]);
  assert.equal(isPaperBot("signals"), true);
  assert.equal(isPaperBot("grid"), false);
  assert.equal(isPaperBot("ladder"), false);
});

test("every bot has its name and one line of what it does, in both languages; no coin is advertised", () => {
  for (const lang of ["en", "uk"]) {
    for (const id of BOT_IDS) {
      assert.ok(BOTS[lang][id], `${lang} ${id}`);
      assert.ok(BOTS[lang][`${id}Job`], `${lang} ${id}Job`);
    }
    const all = Object.values(BOTS[lang])
      .map((value) => (typeof value === "string" ? value : value("1", "1")))
      .join(" ");
    assert.doesNotMatch(all, /BONK|PUMP|WIF|profit|прибут|заробиш|x\d/iu, lang);
  }
  assert.equal(BOTS.uk.recurring, "Регулярні покупки");
  assert.equal(BOTS.uk.ladder, "Драбина ордерів");
  assert.equal(BOTS.uk.grid, "Сітка");
  assert.equal(BOTS.uk.signals, "Сигнали");
});

/* ------------------------------------------------------------------------------------------------ the coin's list */

const coin = (id, symbol, volume24h, verified = true, name = symbol) => ({ id, symbol, name, icon: null, verified, volume24h });
const MARKET = [coin("SOL1", "SOL", 900), coin("JUP1", "JUP", 300), coin("MET1", "MET", 50), coin("BONK1", "BONK", 800), coin("WIF1", "WIF", 700), coin("FAKE1", "METH", 5, false, "Meth coin")];

test("a bot's list holds the whole market, not three coins: the first ones, the wallet's, then the market by its day", () => {
  const list = coinChoices({ market: MARKET, first: ["SOL1", "JUP1", "MET1"], held: ["WIF1"], found: [], query: "" });
  assert.deepEqual(
    list.map((one) => one.symbol),
    ["SOL", "JUP", "MET", "WIF", "BONK", "METH"],
    "SOL, JUP and MET first, the wallet's next, then every other coin by its day's trading",
  );
  const many = Array.from({ length: 200 }, (_, at) => coin(`M${at}`, `C${at}`, at));
  assert.equal(coinChoices({ market: many, first: [], held: [], found: [], query: "" }).length, CHOICES_MOST, "the list scrolls, and stops at its most");
});

test("a search finds the market's coin by its address or ticker first, then what the catalogue found beyond the market", () => {
  const found = [coin("MET1", "MET", 0), coin("METAL1", "METAL", 0, false)];
  assert.deepEqual(
    coinChoices({ market: MARKET, first: [], held: [], found, query: "met" }).map((one) => one.id),
    ["MET1", "FAKE1", "METAL1"],
    "the exact ticker, then the one that starts with it, then the catalogue's coin the market does not hold; MET once",
  );
  assert.deepEqual(coinChoices({ market: MARKET, first: [], held: [], found: [coin("NEW1", "NEWC", 0, false)], query: "NEWC" }).map((one) => one.id), ["NEW1"], "a coin outside the market, from the catalogue");
  assert.deepEqual(coinChoices({ market: MARKET, first: [], held: [], found: [], query: "BONK1" }).map((one) => one.id), ["BONK1"], "a pasted address");
  assert.equal(searchable("m"), false);
  assert.equal(searchable("$me"), true);
  assert.equal(searchable("x".repeat(65)), false);
});

test("a coin's venue: DLMM Pro first, the classic pool next, «no pool» only once every venue answered", () => {
  const open = { pro: true, classic: true };
  const ready = (value) => ({ status: "ready", value, code: null });
  const failed = (code) => ({ status: "failed", value: null, code });
  const loading = { status: "loading", value: null, code: null };
  assert.equal(venueOf(ready({ pool: "p" }), undefined, open), "pro");
  assert.equal(venueOf(ready(null), ready({ facts: {} }), open), "dlmm");
  assert.equal(venueOf(ready(null), ready(null), open), "none");
  assert.equal(venueOf(failed("CAPABILITY_UNAVAILABLE"), ready(null), open), "none", "a lane closed here says «not here»");
  assert.equal(venueOf(loading, undefined, open), null, "a read under way is not «no pool»");
  assert.equal(venueOf(failed("UNAVAILABLE"), ready(null), open), null, "a read that failed is not «no pool»");
  assert.equal(venueOf(ready(null), failed("UNAVAILABLE"), open), null);
  assert.equal(venueOf(undefined, ready(null), { pro: false, classic: true }), "none", "only the classic venue asked here");
  assert.equal(venueOf(ready({ pool: "p" }), undefined, { pro: false, classic: false }), null, "no venue open: nothing said");
});

test("each bot stands on the page of its category: every bot a terminal with a chart", () => {
  assert.deepEqual(BOT_PAGE, { recurring: "chart", grid: "chart", ladder: "chart", signals: "chart", autopilot: "chart" });
  const grid = source("./Grid.tsx");
  assert.match(grid, /const MET = MET_MINT/, "MET opens the grid where DLMM Pro is open: its pool is Pro's");
  /** The props a screen gives its one coin field, however the line wraps. */
  const coinField = (file) => {
    const found = source(file).match(/<CoinAmount\b([\s\S]*?)\/>/);
    assert.ok(found, `${file}: its coin field`);
    return found[1];
  };
  assert.match(coinField("./Grid.tsx"), /\banyCoin\b/, "the grid's coin is any coin of Solana");
  assert.match(coinField("./Ladder.tsx"), /\banyCoin\b/, "the ladder's too: its engine reads any coin's pool");
  assert.doesNotMatch(coinField("./Paper.tsx"), /\banyCoin\b/, "a paper bot needs the market's own week: the market's coins");
  for (const file of ["./Grid.tsx", "./Ladder.tsx"]) assert.match(source(file), /useOffHoursRisk\(/, `${file}: a stock's risk before the signature`);
});

/* ------------------------------------------------------------------------------------------------ the ladder */

test("a number is read as typed: a comma or a point, nothing else", () => {
  assert.equal(typedNumber("100"), 100);
  assert.equal(typedNumber("2,5"), 2.5);
  assert.equal(typedNumber("0.25"), 0.25);
  for (const typed of ["", "abc", "1,2,3", "-1", "1e3", " "]) assert.equal(typedNumber(typed), null, typed);
});

test("the ladder's form is the city's own draft: a buy ladder under the price, an exit ladder over it", () => {
  const pair = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
  const buy = ladderDraft(pair, { side: "buy", amountUsd: 100, steps: 5, firstPct: 2, lastPct: 12 }, 150);
  assert.deepEqual([buy.kind, buy.amountUsd, buy.steps, buy.firstPct, buy.lastPct, buy.pair.symbol], ["buyLadder", 100, 5, 2, 12, "SOL"]);
  const exit = ladderDraft(pair, { side: "exit", amountUsd: 40, steps: 3, firstPct: 4, lastPct: 16 }, 150);
  assert.equal(exit.kind, "exitLadder");
  assert.deepEqual(ladderStart("buy", null), { steps: 5, firstPct: 2, lastPct: 12 }, "the city's own distances for a day's move");
  assert.deepEqual(ladderStart("exit", null), { steps: 4, firstPct: 4, lastPct: 16 });
  assert.deepEqual([...LADDER_STEP_CHOICES], [3, 4, 5, 8]);
});

test("the wallet's ladders: its own, on the network, the standing ones first, then the newest", () => {
  const ladder = (id, owner, network, placedAt, closedAt = null) => ({ id, owner, network, placedAt, closedAt });
  const all = [ladder("a", "me", "mainnet", 1), ladder("b", "me", "mainnet", 3, 9), ladder("c", "you", "mainnet", 5), ladder("d", "me", "devnet", 7), ladder("e", "me", "mainnet", 2)];
  assert.deepEqual(ladderRows(all, "me", "mainnet").map((one) => one.id), ["e", "a", "b"]);
  assert.deepEqual(ladderRows(all, null, "mainnet"), [], "no wallet, none");
  assert.deepEqual(ladderRows(all, "me", null), [], "no network here, none");
});

/* ------------------------------------------------------------------------------------------------ on paper */

const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 10);

test("a paper bot starts from the city's own draft on its coin; the signals' pace is two averages", () => {
  const signal = paperStart("signals", SOL, 150, null, 100);
  assert.deepEqual([signal.kind, signal.fast, signal.slow], ["signal", 12, 26]);
  assert.equal(paceOf(signal), "steady");
  assert.equal(paceOf({ ...signal, ...PACES.fast }), "fast");
  assert.equal(paceOf({ fast: 3, slow: 9 }), null);
});

test("a week on paper is the rule played on real hours; nothing is said without a week or with a draft that cannot start", () => {
  const draft = paperStart("signals", SOL, 100, null, 100);
  const bars = [...straightBars(100, 92, START, 48), ...straightBars(92, 108, START + 48 * HOUR, 72)];
  const week = weekOnPaper(draft, bars);
  assert.ok(week && week.trades > 0, "the signals traded as the trend turned up");
  assert.equal(typeof week.pnlUsd, "number");
  assert.equal(typeof week.holdUsd, "number");
  assert.equal(weekOnPaper(draft, []), null, "no week of prices — nothing made up");
  assert.equal(weekOnPaper({ ...draft, amountUsd: 1 }, bars), null, "a draft that cannot start");
  assert.equal(weekOnPaper(null, bars), null);
});

test("my paper bots of one kind: the hangar's order, each with what it did since it started; the others are not here", () => {
  const draft = paperStart("signals", SOL, 100, null, 100);
  const other = { ...draft, kind: "grid", lower: 90, upper: 110, levels: 10 };
  const bot = (id, d, spans, stoppedAt = null, createdAt = START) => ({ id, draft: d, createdAt, spans, stoppedAt, strategyId: null, mode: "paper" });
  const bots = [bot("g1", draft, [[START, null]]), bot("g2", draft, [[START, START + HOUR]], START + HOUR, START + 1), bot("x1", other, [[START, null]]), bot("g3", draft, [[START, START + 2 * HOUR]], null, START + 2)];
  const bars = [...straightBars(100, 92, START, 48), ...straightBars(92, 108, START + 48 * HOUR, 72)];
  const rows = paperRows(bots, "signals", () => bars, new Set([SOL.mint]));
  assert.deepEqual(rows.map((row) => [row.key, row.status]), [
    ["g1", "running"],
    ["g3", "paused"],
    ["g2", "stopped"],
  ]);
  assert.ok(rows[0].trades > 0);
  assert.equal(typeof rows[0].pnlUsd, "number");
  assert.deepEqual(paperRows(bots, "signals", () => null, null).map((row) => [row.trades, row.pnlUsd]), [[null, null], [null, null], [null, null]], "no hours read — no figure, never a zero");
  assert.equal(paperRows(bots, "signals", () => bars, new Set(["another"]))[0].status, "orphaned", "its coin left the market");
  assert.equal(paperWorking(bots, "signals"), 1, "a paper grid of the city's is not a signals bot");
});

/* ------------------------------------------------------------------------------------------------ the screens' rules */

test("the wallet opens only from a press: the ladder's place, take back and finish stand in the page's own buttons", () => {
  const ladder = source("./Ladder.tsx");
  for (const call of ladder.matchAll(/\b(placeDraft|takeBack|finish)\(/g)) {
    const before = ladder.slice(Math.max(0, call.index - 300), call.index);
    assert.match(before, /onClick=\{|const place = \(\) => \{/, `${call[1]} outside a press`);
  }
  assert.match(ladder, /const place = \(\) => \{\s*if \(!who\) return connect\(\);\s*if \(!draft \|\| !pool \|\| issue \|\| busy\) return;/u, "nothing is placed with a «no» on screen or a step under way");
  // The engines are the city's as they are: the screens only call them.
  for (const file of ["./Ladder.tsx", "./Paper.tsx", "./Budget.tsx", "./BotsScreen.tsx", "./parts.tsx"]) {
    assert.doesNotMatch(source(file), /from '@\/lib\/mandate\/(?!budget)|signTransaction|sendTransaction|fetch\(/u, `${file}: no engine of its own`);
  }
});

test("a paper bot never touches a wallet or the network's money", () => {
  const paper = source("./Paper.tsx");
  assert.doesNotMatch(paper, /useWallet|placeDraft|signTrade|tapEnable|ladder-actions/u);
  assert.match(paper, /useBots\.getState\(\)\.startPaper\(\)/u, "the city's own paper start");
});

test("Recurring buys is the card that was the Agents screen's «Trader», its engine as it is", () => {
  const budget = source("./Budget.tsx");
  assert.match(budget, /import \{ Note, noteWords, PilotPropose, Split, Trader \} from '@\/terminal\/agents\/NewAgent';/u);
  assert.match(budget, /const form = <Trader /u);
  assert.match(budget, /row\.role === 'trader'/u, "its rows are the traders at work — every one of them");
  // The section's mark and the tabs say how many work; the Agents screen no longer draws the trader.
  assert.doesNotMatch(source("../agents/AgentsScreen.tsx"), /Trader|NewAgent|MineTable/u);
});
