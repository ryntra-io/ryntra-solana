import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readDetail } from "./detail.ts";
import { readDiscover } from "./markets.ts";
import { emptyBook, ORACLE_KEY, STORAGE_KEY } from "./practice.ts";
import { cardOf, EARLY_GAP_MS, forgetReads, pageMarket, priceOf, setPredictEnv, SETTLE_GAP_MS, usePredict } from "./store.ts";
import { discoverBody, eventBody } from "./test-fixtures.mjs";

const DAY = 86_400_000;
let now = Date.parse("2026-10-28T12:00:00.000Z");
let saved = {};
let listAnswer = null;
let eventAnswer = null;
let settleAnswers = {};
let settleReads = [];
let chartReads = [];

const engine = {
  discover: async (category) => listAnswer(category),
  event: async (id, card) => eventAnswer(id, card),
  settle: async (id) => {
    settleReads.push(id);
    return settleAnswers[id] ?? { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "down" } };
  },
  chart: async (outcomeId, range) => {
    chartReads.push(`${outcomeId}:${typeof range === "string" ? range : range.resolution}`);
    return { ok: true, status: 200, value: [{ t: now - 1000, p: 0.5 }, { t: now, p: 0.58 }] };
  },
};
const ok = (value) => ({ ok: true, status: 200, value });
const live = (category) => ok(readDiscover(discoverBody(now, { category, readAt: new Date(now).toISOString() })));
const detail = (id, card) => ok(readDetail(eventBody(id, { now, yes: 0.6 }), card));
const won = (id, winner) => ok({ id, markets: [{ id: `${id}-m`, status: "resolved", outcomes: [{ id: `${id}-yes`, winner: winner === "yes" }, { id: `${id}-no`, winner: winner === "no" }] }] });

beforeEach(() => {
  now = Date.parse("2026-10-28T12:00:00.000Z");
  saved = {};
  listAnswer = live;
  eventAnswer = detail;
  settleAnswers = {};
  settleReads = [];
  chartReads = [];
  forgetReads();
  setPredictEnv({ engine, storage: { load: (k) => saved[k] ?? null, save: (k, v) => (saved[k] = JSON.parse(JSON.stringify(v))) }, now: () => now });
  usePredict.setState({ open: false, mode: "practice", page: { kind: "markets" }, tab: "trending", tabs: [{ id: "trending", label: "Trending", category: null }], lists: {}, detail: { status: "idle" }, chart: null, range: "1D", action: "buy", side: null, amount: 25, fraction: 1, book: emptyBook(), hydrated: false, notice: null });
});

test("opening the window reads Trending, and the engine's tabs come with the first read", async () => {
  usePredict.getState().show();
  await usePredict.getState().loadList();
  const st = usePredict.getState();
  assert.equal(st.open, true);
  assert.equal(st.mode, "practice", "Practice is where the window starts");
  assert.equal(st.lists.trending.status, "ready");
  assert.equal(st.lists.trending.markets.length, 8);
  assert.deepEqual(st.tabs.map((t) => t.label), ["Trending", "Ending soon", "Crypto", "Politics", "Sports", "World", "Tech"]);
  st.setTab("crypto");
  await usePredict.getState().loadList("crypto");
  assert.ok(usePredict.getState().lists.crypto.markets.every((m) => m.categories.includes("crypto")));
});

test("an empty page is no cards; a failed first read is an error; a failed refresh keeps the cards and says so", async () => {
  listAnswer = () => ok({ events: [], categories: [], categoriesUnavailable: true, readAt: new Date(now).toISOString() });
  await usePredict.getState().loadList();
  assert.equal(usePredict.getState().lists.trending.status, "ready");
  assert.deepEqual(usePredict.getState().lists.trending.markets, []);
  assert.deepEqual(usePredict.getState().tabs.map((t) => t.id), ["trending", "ending"]);
  usePredict.setState({ lists: {} });
  listAnswer = () => ({ ok: false, failure: { code: "NETWORK", message: "x" } });
  await usePredict.getState().loadList();
  assert.equal(usePredict.getState().lists.trending.status, "error");
  listAnswer = live;
  await usePredict.getState().loadList();
  listAnswer = () => ({ ok: false, failure: { code: "TIMEOUT", message: "x" } });
  await usePredict.getState().loadList();
  const list = usePredict.getState().lists.trending;
  assert.equal(list.status, "ready");
  assert.equal(list.failed, true);
  assert.equal(list.markets.length, 8);
});

test("a card opens its market's page on the side tapped; the page reads the event and the chance over time", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc", "ev-btc-no");
  let st = usePredict.getState();
  assert.deepEqual(st.page, { kind: "market", eventId: "ev-btc" });
  assert.equal(st.side, "ev-btc-no");
  assert.equal(pageMarket(st).market.sides[0].p, 0.58, "the card's price while the event is read");
  await usePredict.getState().loadDetail();
  await new Promise((r) => setImmediate(r));
  st = usePredict.getState();
  assert.equal(st.detail.status, "ready");
  assert.equal(pageMarket(st).market.sides[0].p, 0.6, "then the event's live price");
  assert.equal(st.side, "ev-btc-no", "the side tapped stays");
  assert.ok(chartReads.includes("ev-btc-yes:5m"), "the chance over time is Yes's, a day of five minutes");
  st.setRange("1M");
  await new Promise((r) => setImmediate(r));
  assert.ok(chartReads.includes("ev-btc-yes:1d"), "a month of days");
  assert.equal(usePredict.getState().chart.status, "ready");
});

test("a page whose event is gone says so", async () => {
  eventAnswer = () => ({ ok: false, failure: { code: "NOT_FOUND", message: "x" } });
  usePredict.getState().openMarket("ev-none");
  await usePredict.getState().loadDetail();
  assert.deepEqual(usePredict.getState().detail, { status: "error", gone: true });
});

test("Practice: a buy at the page's price leaves the practice cash and is saved on the device", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc");
  await usePredict.getState().loadDetail();
  usePredict.getState().setAmount(100);
  assert.equal(usePredict.getState().side, "ev-btc-yes", "Yes is picked first");
  assert.equal(usePredict.getState().practiceBuy(), null);
  const st = usePredict.getState();
  assert.equal(st.book.cash, 900);
  assert.equal(st.book.holdings[0].label, "Yes");
  assert.ok(Math.abs(st.book.holdings[0].shares - 100 / 0.6) < 1e-5, "at the event's live 60¢");
  assert.equal(saved[STORAGE_KEY].cash, 900);
  assert.equal(st.notice.tone, "ok");
  now += 3 * 60_000;
  assert.equal(usePredict.getState().practiceBuy(), "delayed", "a stale page buys nothing");
  assert.equal(usePredict.getState().book.cash, 900);
});

test("Practice: a sale takes the freshest price of the side; without one nothing is sold", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc");
  await usePredict.getState().loadDetail();
  usePredict.getState().setAmount(60);
  usePredict.getState().practiceBuy();
  const id = usePredict.getState().book.holdings[0].id;
  assert.equal(priceOf(usePredict.getState(), "ev-btc", "ev-btc-m", "ev-btc-yes").p, 0.6);
  usePredict.getState().setFraction(0.5);
  assert.equal(usePredict.getState().practiceSell(id), null);
  assert.equal(usePredict.getState().book.cash, 970);
  usePredict.setState({ detail: { status: "idle" }, lists: {} });
  assert.equal(usePredict.getState().practiceSell(id), "price");
});

test("Practice settles from the venue's word: closed markets every minute, the others now and then", async () => {
  usePredict.getState().hydrate();
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc");
  await usePredict.getState().loadDetail();
  usePredict.getState().setAmount(100);
  usePredict.getState().practiceBuy();
  settleAnswers["ev-btc"] = won("ev-btc", "yes");
  await usePredict.getState().settleDue();
  assert.equal(usePredict.getState().book.cash, 900 + Math.floor((100 / 0.6) * 100) / 100);
  assert.equal(usePredict.getState().book.holdings[0].state, "won");
  assert.match(usePredict.getState().notice.text, /1 won/);
  settleReads = [];
  await usePredict.getState().settleDue();
  assert.deepEqual(settleReads, [], "a settled holding is asked about no more");
  usePredict.setState({ book: emptyBook() });
  usePredict.getState().setAmount(10);
  usePredict.getState().practiceBuy();
  settleReads = [];
  await usePredict.getState().settleDue();
  now += SETTLE_GAP_MS;
  await usePredict.getState().settleDue();
  assert.equal(settleReads.length, 0, "an open market before its close waits the slower gap");
  now += EARLY_GAP_MS;
  await usePredict.getState().settleDue();
  assert.equal(settleReads.length, 1);
});

test("the paper Oracle's book carries over once; a book already saved wins", () => {
  saved[ORACLE_KEY] = { v: 1, points: 870, resets: 0, calls: [] };
  usePredict.getState().hydrate();
  assert.equal(usePredict.getState().book.cash, 870);
  assert.equal(saved[STORAGE_KEY].carried, true);
  usePredict.setState({ hydrated: false });
  saved[STORAGE_KEY] = { ...saved[STORAGE_KEY], cash: 500 };
  usePredict.getState().hydrate();
  assert.equal(usePredict.getState().book.cash, 500);
});

test("the freshest card of an event is the one read last across the tabs", async () => {
  await usePredict.getState().loadList();
  now += 30_000;
  await usePredict.getState().loadList("crypto");
  const card = cardOf(usePredict.getState().lists, "ev-btc");
  assert.equal(card.readAt, new Date(now).toISOString());
  assert.equal(cardOf(usePredict.getState().lists, "nope"), null);
  void DAY;
});

test("with the real switch closed the window stays in Practice, whoever asks for Real", () => {
  usePredict.getState().setMode("real");
  assert.equal(usePredict.getState().mode, "practice");
});
