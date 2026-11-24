// «Портфель: прибуток і збиток» — the screen's half without React: the read of /api/portfolio/pnl (lenient:
// what is not a figure is not known, never a zero), the figures in SOL, the one line when the result is not known, the
// calendar, the sale a card is made of and the card on the existing /api/growth/cards; the words human; the block
// mounted once on the Portfolio, «Share» only on the person's own wallet; the route reads only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DAY_S } from "../../../lib/core/pnl/honest.ts";
import { portfolioPnl } from "../../../lib/portfolio/pnl.ts";
import { bestSale, calendarOf, cardTrades, nothingTraded, pctText, periodState, pnlShown, readAnswer, solPrice, solText, toneOf, usdAbout } from "./pnl-view.ts";
import { postUrl, shareResult } from "./share.ts";
import { standWallets } from "./stand.ts";
import { PNL, PNL_STAND } from "./words.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const NOW = Date.parse("2026-11-19T15:00:00Z") / 1000;
const KITE = "KiteKiteKiteKiteKiteKiteKiteKiteKiteKite1111";

let slot = 1;
const trade = (side, amount, sol, daysAgo, extra = {}) => ({ signature: `s${(slot += 1)}`, slot, at: NOW - daysAgo * DAY_S, side, mint: KITE, tokensRaw: String(amount * 1e6), decimals: 6, quote: "SOL", quoteAmount: sol, paidBy: null, feeSol: 0.001, ...extra });
const market = new Map([[KITE, { priceUsd: 0.4, liquidityUsd: 1e12, symbol: "KITE", name: "Kite", icon: null }]]);
const pnlOf = (trades, more = {}) => portfolioPnl({ read: { trades, held: new Map([[KITE, 500]]), oldestAt: NOW - 100 * DAY_S, complete: true, gap: false, skipped: 0, ...more }, solUsd: 200, market, nowS: NOW });
const answer = (pnl) => JSON.parse(JSON.stringify({ ok: true, owner: KITE, readAt: "x", pricesRead: true, pnl }));

test("the read: the route's answer comes back as it was counted; anything else is not one", () => {
  const pnl = pnlOf([trade("buy", 1_000, 1, 20), trade("sell", 500, 1, 3)]);
  assert.deepEqual(readAnswer(answer(pnl)), JSON.parse(JSON.stringify(pnl)));
  assert.equal(readAnswer(null), null);
  assert.equal(readAnswer({ ok: false }), null);
  assert.equal(readAnswer({ ok: true, pnl: { ...pnl, standard: "other" } }), null);
  /* A plus without its figure is not a plus; a figure that is not a number is not known; a link that is not https is none. */
  const bent = answer(pnl);
  bent.pnl.periods["7"].result = "1.2";
  bent.pnl.periods["7"].verdict = "PLUS";
  bent.pnl.coins[0].entry = "0.001";
  bent.pnl.coins[0].icon = "javascript:alert(1)";
  bent.pnl.days.push({ day: "nope", from: 1 });
  const got = readAnswer(bent);
  assert.equal(got.periods[7].result, null);
  assert.equal(got.periods[7].verdict, "UNKNOWN");
  assert.equal(got.coins[0].entry, null);
  assert.equal(got.coins[0].icon, null);
  assert.equal(got.days.length, pnl.days.length);
});

test("figures in SOL: signed, places by size, a run of zeros folded, the language's own comma", () => {
  assert.equal(solText(1.28449, "en", true), "+1.284");
  assert.equal(solText(-0.04213, "en", true), "−0.0421");
  assert.equal(solText(0.04213, "en"), "0.0421");
  assert.equal(solText(1234.5, "en", true), "+1,234.50");
  assert.equal(solText(1.28449, "uk", true), "+1,284");
  assert.equal(solText(null, "en"), "—");
  assert.equal(solText(0.00002, "en", true), "+0.0₄20", "a dust of a result folds its zeros as a tiny price does");
  assert.equal(solPrice(0.0000041234, "en"), "0.0₅4123");
  assert.equal(solPrice(0.0052, "uk"), "0,005200");
  assert.equal(solPrice(null, "en"), "—");
  assert.equal(pctText(38.2, "en"), "+38.20%");
  assert.equal(pctText(null, "en"), "—");
  assert.equal(usdAbout(1.5, 200, "en"), "+$300");
  assert.equal(usdAbout(5.653, 182, "en"), "+$1,029", "whole dollars, grouped — never «$1K»");
  assert.equal(usdAbout(5.653, 182, "uk"), "+$1 029", "the Ukrainian thousands: a no-break space");
  assert.equal(usdAbout(-0.5, 200, "en"), "−$100");
  assert.equal(usdAbout(0.001, 200, "en"), null, "under half a dollar says nothing");
  assert.equal(usdAbout(1, null, "en"), null);
  assert.equal(toneOf(0.2), "up");
  assert.equal(toneOf(-0.2), "down");
  assert.equal(toneOf(0), undefined);
  assert.equal(toneOf(null), undefined);
});

test("one line when the result is not known: no trades, a read that does not reach back, too little known, transactions not read", () => {
  const known = pnlOf([trade("buy", 1_000, 1, 20), trade("sell", 500, 1, 3)]);
  assert.equal(periodState(known.periods[7], known.coverage).kind, "known");
  const quiet = pnlOf([trade("buy", 1_000, 1, 40)]);
  assert.equal(periodState(quiet.periods[7], quiet.coverage).kind, "empty");
  const older = pnlOf([trade("buy", 1_000, 1, 9), trade("sell", 1_000, 2, 1)], { complete: false, oldestAt: NOW - 10 * DAY_S });
  const state = periodState(older.periods[30], older.coverage);
  assert.equal(state.kind, "older");
  assert.equal(state.since, NOW - 10 * DAY_S);
  assert.ok(state.known > 0, "the known part is said beside");
  const partial = pnlOf([trade("buy", 1_000, null, 9, { quote: null, quoteAmount: null }), trade("sell", 1_000, 2, 1)]);
  const said = periodState(partial.periods[30], partial.coverage);
  assert.equal(said.kind, "partial");
  assert.ok(said.pct < 95);
  const skipped = pnlOf([trade("buy", 1_000, 1, 2)], { skipped: 3 });
  assert.equal(periodState(skipped.periods[7], skipped.coverage).kind, "skipped");
  assert.equal(nothingTraded(pnlOf([])), true);
  assert.equal(nothingTraded(known), false);
});

test("the calendar: the period's days in weeks, Monday on top, deeper colour for a larger day, the plus and minus counted", () => {
  /* Bought at 0.001 SOL a coin, worth 0.002 now: the day of the buy is in the plus by what is still held. */
  const pnl = pnlOf([trade("buy", 1_000, 1, 6), trade("sell", 250, 1, 5), trade("sell", 250, 0.1, 3)], { held: new Map([[KITE, 500]]) });
  const week = calendarOf(pnl.days, 7);
  assert.equal(week.cells.length, 7);
  assert.equal(week.cells.at(-1).day, "2026-11-19");
  assert.equal(week.strip, true, "a week is one row of days");
  assert.equal(week.cols, 7);
  assert.ok(week.cells.every((cell, at) => cell.row === 0 && cell.col === at));
  const month = calendarOf(pnl.days, 30);
  assert.equal(month.strip, false);
  assert.equal(month.cells.at(-1).row, 3, "19.11.2026 is a Thursday: Monday on top");
  assert.equal(month.cells[0].row, 2, "21.10.2026 is a Wednesday");
  assert.equal(month.cells[0].col, 0);
  assert.equal(week.plus, 2, "the day of the buy and the sale for four times its cost");
  assert.equal(week.minus, 1, "the sale under its cost");
  const days = Object.fromEntries(week.cells.map((cell) => [cell.day, cell]));
  assert.equal(days["2026-11-14"].level, 3, "the largest day is the deepest");
  assert.equal(days["2026-11-16"].verdict, "MINUS");
  assert.equal(days["2026-11-15"].verdict, "EMPTY");
  assert.ok(week.cells.filter((cell) => cell.verdict === "EMPTY").every((cell) => cell.level === 0));
  assert.equal(calendarOf(pnl.days, 90).cells.length, 90);
  assert.ok(calendarOf(pnl.days, 90).cols >= 13);
});

test("the card is made of the period's best sale with a measured result — a buy is no result", () => {
  const list = cardTrades({
    trades: [
      { key: "BUY:a", kind: "BUY", symbol: "JUP", at: "2026-11-18T10:00:00Z", resultBps: null },
      { key: "SELL:b", kind: "SELL", symbol: "JUP", at: "2026-11-17T10:00:00Z", resultBps: 1200 },
      { key: "SELL:c", kind: "SELL", symbol: "MET", at: "2026-11-15T10:00:00Z", resultBps: 3400 },
      { key: "SELL:d", kind: "SELL", symbol: "KITE", at: "2026-10-01T10:00:00Z", resultBps: 90000 },
      { key: "bad" },
    ],
  });
  assert.equal(list.length, 4);
  assert.equal(bestSale(list, Date.parse("2026-11-12T15:00:00Z")).key, "SELL:c");
  assert.equal(bestSale(list, Date.parse("2026-11-16T15:00:00Z")).key, "SELL:b");
  assert.equal(bestSale(list, Date.parse("2026-11-19T00:00:00Z")), null);
});

function deps(overrides = {}) {
  const calls = [];
  const lists = { status: 200, body: { trades: [{ key: "SELL:x1", kind: "SELL", symbol: "JUP", at: "2026-11-18T10:00:00Z", resultBps: 2500 }] } };
  const made = { status: 200, body: { ok: true, card: { url: "https://ryntra.io/r/abc/c/def", image: "https://ryntra.io/r/abc/c/def/image", text: "JUP +25%", alt: "A card" } } };
  return {
    calls,
    prove: overrides.prove ?? (async () => ({ ok: true })),
    fetch: async (url, init) => {
      calls.push({ url, init });
      const reply = init?.method === "POST" ? (overrides.made ?? made) : (overrides.lists ?? lists);
      if (reply === "throw") throw new Error("offline");
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
    },
  };
}

test("«Share»: one signed message, the best sale, the card on the existing generator — the screen names a trade, never a figure", async () => {
  const d = deps();
  const out = await shareResult({ owner: KITE, fromMs: Date.parse("2026-11-12T15:00:00Z"), lang: "uk" }, d);
  assert.equal(out.ok, true);
  assert.deepEqual(out.card, { page: "https://ryntra.io/r/abc/c/def", image: "https://ryntra.io/r/abc/c/def/image", text: "JUP +25%", alt: "A card", symbol: "JUP" });
  assert.match(d.calls[0].url, /^\/api\/growth\/cards\?address=/);
  assert.equal(d.calls[1].url, "/api/growth/cards");
  assert.deepEqual(JSON.parse(d.calls[1].init.body), { address: KITE, trade: "SELL:x1", locale: "uk", amounts: false });
  assert.equal(postUrl(out.card), "https://x.com/intent/post?text=JUP%20%2B25%25&url=https%3A%2F%2Fryntra.io%2Fr%2Fabc%2Fc%2Fdef");

  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ prove: async () => ({ ok: false, state: "declined" }) })), { ok: false, code: "DECLINED" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ prove: async () => ({ ok: false, state: "failed" }) })), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: Date.parse("2026-11-19T00:00:00Z"), lang: "en" }, deps()), { ok: false, code: "NO_SALE" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ lists: { status: 401, body: {} } })), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ lists: "throw" })), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ made: { status: 503, body: { ok: false } } })), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await shareResult({ owner: KITE, fromMs: 0, lang: "en" }, deps({ made: { status: 200, body: { card: { url: "javascript:x", image: "https://a", text: "t" } } } })), { ok: false, code: "UNAVAILABLE" });
});

test("the words: human, both languages alike, no market jargon and no promise of a result", () => {
  for (const dict of [PNL, PNL_STAND]) assert.deepEqual(Object.keys(dict.uk).sort(), Object.keys(dict.en).sort());
  const said = (half) => Object.values(half).map((value) => (typeof value === "string" ? value : value("1", "1"))).join(" ");
  for (const lang of ["en", "uk"]) {
    const text = said(PNL[lang]);
    assert.doesNotMatch(text, /\bP&?n&?L\b|realized|unrealized|cost basis|ROI|PnL/i, `${lang}: «${text}»`);
    assert.doesNotMatch(text, /guarantee|profit is|you will earn|заробиш|гарант/i);
    assert.doesNotMatch(text, /!/);
  }
  assert.equal(PNL.en.lockedIn, "Locked in");
  assert.equal(PNL.uk.unsold, "Не продано");
});

test("the stand's wallets are counted by the standard itself: a live result, a read from twelve days, too little known, none", () => {
  const wallets = standWallets(NOW);
  assert.equal(periodState(wallets.live.periods[30], wallets.live.coverage).kind, "known");
  assert.equal(periodState(wallets.older.periods[30], wallets.older.coverage).kind, "older");
  assert.equal(periodState(wallets.older.periods[7], wallets.older.coverage).kind !== "older", true);
  assert.equal(periodState(wallets.partial.periods[90], wallets.partial.coverage).kind, "partial");
  assert.equal(nothingTraded(wallets.empty), true);
  assert.ok(wallets.live.coins.length >= 3);
});

test("the block stands once on the Portfolio; «Share» only on the person's own wallet; the route only reads", () => {
  const screen = read("terminal/portfolio/PortfolioScreen.tsx");
  assert.equal(screen.match(/<PnlPanel\b/g)?.length, 1);
  assert.match(screen, /<PnlPanel owner=\{address\} own=\{own\} \/>/);
  const panel = read("terminal/portfolio/pnl/PnlPanel.tsx");
  assert.match(panel, /const mayShare = own && connection\?\.address === owner;/);
  assert.match(panel, /share=\{mayShare \? shared : null\}/);
  assert.doesNotMatch(panel, /<Action\b/, "the Portfolio's one amber action is not this block's");
  const route = read("app/api/portfolio/pnl/route.ts");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|DELETE|PATCH)/);
  assert.doesNotMatch(route, /signTransaction|sendTransaction|Keypair|secretKey|process\.env/);
  assert.match(route, /isAddress\(owner\)/);
  assert.match(route, /LIMITER\.consume/);
  assert.match(route, /claimChainRead/);
});

/* Release check 20.11: with trades read only from 20.11, nearly every Portfolio opened on a big dash, an empty calendar
   and rows of dashes. The block takes room only for what it has to show. */
const blank = (pnl, patch = {}) => ({ ...pnl, ...patch });
const noResult = (period) => ({ ...period, result: null, realized: null, unrealized: null, pct: null, verdict: "UNKNOWN" });

test("nothing traded: one quiet line, no figure, no calendar, no periods, no table", () => {
  const { empty } = standWallets(NOW);
  const shown = pnlShown(empty, 30);
  assert.equal(shown.kind, "quiet");
  assert.equal(shown.state.kind, "nothing");
});

test("not all transactions read: one quiet line that says so — never a dash, a calendar or rows of dashes", () => {
  const { live } = standWallets(NOW);
  const periods = Object.fromEntries(Object.entries(live.periods).map(([days, period]) => [days, noResult(period)]));
  const coins = live.coins.map((coin) => ({ ...coin, entry: null, result: null, realized: null, unrealized: null, pct: null }));
  const days = live.days.map((day) => ({ ...day, result: null, verdict: "UNREAD" }));
  const pnl = blank(live, { periods, coins, days, coverage: { ...live.coverage, gaps: ["skipped"] } });
  const shown = pnlShown(pnl, 30);
  assert.equal(shown.kind, "quiet");
  assert.equal(shown.state.kind, "skipped");
  // Coins whose entry is known but no period counted: still the quiet line — no table.
  assert.equal(pnlShown(blank(pnl, { coins: live.coins.map((coin) => ({ ...coin, result: null })) }), 30).kind, "quiet");
});

test("a result for 7 days only: that week on screen, no switch of one, the calendar only for days with a result", () => {
  const { older } = standWallets(NOW);
  assert.notEqual(older.periods[7].result, null);
  assert.equal(older.periods[30].result, null);
  assert.equal(older.periods[90].result, null);
  const shown = pnlShown(older, 30);
  assert.equal(shown.kind, "full");
  assert.equal(shown.days, 7, "the asked month has no result: the week that has one");
  assert.deepEqual(shown.periods, [7]);
  assert.equal(shown.calendar, calendarOf(older.days, 7).cells.some((cell) => cell.result !== null));
  const silent = blank(older, { days: older.days.map((day) => ({ ...day, result: null, verdict: "EMPTY" })) });
  assert.equal(pnlShown(silent, 30).calendar, false, "no day with a result: no calendar");
});

test("the coins shown are those with a known entry or result — no row of dashes; none such, no table", () => {
  const { live } = standWallets(NOW);
  const dashes = { ...live.coins[0], mint: "Dash111111111111111111111111111111111111111", symbol: "MEW", entry: null, result: null, realized: null, unrealized: null, pct: null };
  const entryOnly = { ...live.coins[1], mint: "Entry11111111111111111111111111111111111111", entry: 0.004, result: null, pct: null };
  const shown = pnlShown(blank(live, { coins: [dashes, entryOnly, ...live.coins] }), 30);
  assert.equal(shown.kind, "full");
  assert.deepEqual(shown.periods, [7, 30, 90]);
  assert.equal(shown.days, 30);
  assert.ok(!shown.coins.some((coin) => coin.mint === dashes.mint));
  assert.ok(shown.coins.some((coin) => coin.mint === entryOnly.mint));
  for (const coin of shown.coins) assert.ok(coin.entry !== null || coin.result !== null, coin.mint);
  assert.deepEqual(pnlShown(blank(live, { coins: [dashes] }), 30).coins, []);
});

test("the panel draws by that rule: the quiet line has no big figure, calendar or table, and the coins take the Portfolio's logo queue", () => {
  const panel = read("terminal/portfolio/pnl/PnlPanel.tsx");
  assert.match(panel, /const shown = pnlShown\(pnl, days\);/);
  const quiet = panel.slice(panel.indexOf("if (shown.kind === 'quiet')"), panel.indexOf("const period = pnl.periods[shown.days];"));
  assert.doesNotMatch(quiet, /<Figure|<Days|<Table|<Tabs|ListRow/);
  assert.match(panel, /\{shown\.calendar \? <Days/);
  assert.match(panel, /tabs\.length > 1 \?/);
  assert.match(panel, /logosFor\(coin\.mint\)/);
  assert.doesNotMatch(panel, /icon=\{coin\.icon\}/);
});
