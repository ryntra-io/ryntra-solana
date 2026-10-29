import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readDetail } from "./detail.ts";
import { readDiscover } from "./markets.ts";
import { linesOn, practiceBook, realBook, statusWord, summaryOf } from "./positions.ts";
import { emptyBook, STORAGE_KEY } from "./practice.ts";
import { readLive } from "./real.ts";
import { orderLines, setRealDeps, useReal } from "./real-store.ts";
import { forgetReads, priceOf, setPredictEnv, usePredict } from "./store.ts";
import { discoverBody, eventBody, liveBody, orderRecord, quoteBody } from "./test-fixtures.mjs";

/*
 * «Зробив ставку, немає її». A bet shows at once in «Your positions» and on its
 * market, with how it stands — on its way, taken, not taken — and it is still there after a reload: Practice keeps
 * it on the device, real money reads it from the engine.
 */

const A = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";
const ok = (value, status = 200) => ({ ok: true, status, value });
const no = (code) => ({ ok: false, failure: { code, message: "x" } });
let now = Date.parse("2026-10-29T12:00:00.000Z");
let saved = {};
let answers = {};

const engine = new Proxy(
  {},
  {
    get: (_, name) => async (...args) => {
      const a = answers[name];
      return typeof a === "function" ? a(...args) : (a ?? no("PROVIDER_UNAVAILABLE"));
    },
  },
);
const storage = { load: (k) => saved[k] ?? null, save: (k, v) => void (saved[k] = JSON.parse(JSON.stringify(v))) };

beforeEach(() => {
  now = Date.parse("2026-10-29T12:00:00.000Z");
  saved = {};
  forgetReads();
  answers = {
    discover: () => ok(readDiscover(discoverBody(now))),
    event: (id, card) => ok(readDetail(eventBody(id, { now, yes: 0.58 }), card)),
    chart: () => ok([]),
    live: ok(liveBody(A, { positions: false })),
    funding: no("FUNDING_OFF"),
    quote: ok(quoteBody(A, { spend: 10, price: 0.58 })),
  };
  setPredictEnv({ engine, storage, now: () => now });
  setRealDeps({ prove: async () => ({ ok: true }), sign: async () => ({ ok: true, signature: "c2ln" }) });
  useReal.getState().forget();
  usePredict.setState({ open: false, mode: "practice", page: { kind: "markets" }, tab: "trending", tabs: [{ id: "trending", label: "Trending", category: null }], search: null, lists: {}, detail: { status: "idle" }, chart: null, range: "1D", action: "buy", side: null, amount: 25, fraction: 1, book: emptyBook(), quotes: {}, hydrated: false, notice: null, bought: null });
});

const practiceLines = () => {
  const st = usePredict.getState();
  return practiceBook(st.book, (h) => priceOf(st, h.eventId, h.marketId, h.outcomeId)?.p ?? null);
};

test("Practice: a bet is in your positions at once, on its market, taken — and the ticket says so", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc", "ev-btc-yes");
  await usePredict.getState().loadDetail();
  usePredict.getState().setAmount(25);
  assert.equal(usePredict.getState().practiceBuy(), null);
  const { open } = practiceLines();
  assert.equal(open.length, 1);
  const [line] = open;
  assert.equal(line.status, "accepted");
  assert.equal(statusWord(line.status), null, "a position taken needs no word of its state");
  assert.equal(line.label, "Yes");
  assert.equal(line.cost, 25);
  assert.equal(line.price, 0.58, "priced by the page's read");
  assert.equal(linesOn(open, "ev-btc").length, 1, "its market's card and page find it");
  assert.equal(linesOn(open, "ev-sol").length, 0);
  const bought = usePredict.getState().bought;
  assert.deepEqual({ eventId: bought.eventId, outcomeId: bought.outcomeId, label: bought.label, spendUsd: bought.spendUsd }, { eventId: "ev-btc", outcomeId: "ev-btc-yes", label: "Yes", spendUsd: 25 });
  assert.equal(summaryOf(open).count, 1);
});

test("Practice: the bet survives a reload — the book is read back from the device", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc", "ev-btc-no");
  await usePredict.getState().loadDetail();
  usePredict.getState().practiceBuy();
  assert.ok(saved[STORAGE_KEY], "saved on the device at once");
  // A reload: the page's memory is gone, the device's book is not.
  usePredict.setState({ book: emptyBook(), hydrated: false, lists: {}, detail: { status: "idle" }, bought: null });
  usePredict.getState().hydrate();
  const { open } = practiceLines();
  assert.equal(open.length, 1);
  assert.equal(open[0].label, "No");
  assert.equal(open[0].price, null, "not priced until a read holds its market");
  assert.equal(summaryOf(open).value, 25, "a line no read prices counts at its cost, never as nothing");
});

test("Practice: a sale is in the history with what came back", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc", "ev-btc-yes");
  await usePredict.getState().loadDetail();
  usePredict.getState().setAmount(29);
  usePredict.getState().practiceBuy();
  const id = usePredict.getState().book.holdings[0].id;
  usePredict.getState().setFraction(1);
  assert.equal(usePredict.getState().practiceSell(id), null);
  const { open, past } = practiceLines();
  assert.equal(open.length, 0);
  assert.equal(past.length, 1);
  assert.equal(past[0].word, "Sold");
  assert.equal(past[0].amount, 29, "sold back at the same price: what went in");
  assert.equal(past[0].tone, "flat");
});

test("Practice: a holding is priced off its page too — its market is read again for the positions list", async () => {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket("ev-btc", "ev-btc-yes");
  await usePredict.getState().loadDetail();
  usePredict.getState().practiceBuy();
  // Leave the page and forget the cards: nothing on screen prices the holding now.
  usePredict.setState({ page: { kind: "positions" }, detail: { status: "idle" }, lists: {} });
  assert.equal(practiceLines().open[0].price, null);
  answers.event = (id, card) => ok(readDetail(eventBody(id, { now, yes: 0.7 }), card));
  await usePredict.getState().priceHeld();
  const [line] = practiceLines().open;
  assert.equal(line.price, 0.7, "the held market's fresh read");
  assert.equal(line.pnl, Math.round((line.shares * 0.7 - 25) * 100) / 100, "and its move");
  let reads = 0;
  answers.event = (id, card) => (reads++, ok(readDetail(eventBody(id, { now, yes: 0.7 }), card)));
  await usePredict.getState().priceHeld();
  assert.equal(reads, 0, "not read again within half a minute");
});

async function reviewed() {
  await useReal.getState().refresh(A);
  await useReal.getState().quote({ wallet: "Stand", address: A }, { eventId: "ev-btc", marketId: "ev-btc-m", outcomeId: "ev-btc-yes", side: "buy", spendUsd: 10 }, "k");
  assert.equal(useReal.getState().trade.step, "review");
}

const realLines = () => {
  const st = useReal.getState();
  return realBook(st.live, orderLines(st), new Set(st.recent.map((o) => o.quoteId)));
};

test("Real: from the press on the order is in your positions as on its way, then taken once the engine fills it", async () => {
  await reviewed();
  let release;
  answers.place = () => new Promise((resolve) => (release = () => resolve(ok({ order: { quoteId: "q_live_1", state: "filled" } }))));
  const placing = useReal.getState().place({ title: "Will Bitcoin close October above $120,000?" });
  await new Promise((r) => setImmediate(r));
  let open = realLines().open;
  assert.equal(open.length, 1, "shown before the engine answers");
  assert.equal(open[0].status, "pending");
  assert.equal(statusWord(open[0].status), "On its way");
  assert.equal(open[0].title, "Will Bitcoin close October above $120,000?");
  assert.equal(linesOn(open, "ev-btc").length, 1, "and on its market");
  // The engine fills it; the account now holds the position and the record.
  answers.live = ok(liveBody(A, { orders: [orderRecord(A, { state: "filled" })] }));
  release();
  await placing;
  await new Promise((r) => setTimeout(r, 5));
  const st = useReal.getState();
  assert.equal(st.trade.step, "done");
  assert.equal(st.recent.length, 0, "the engine's record took the visit's line's place");
  open = realLines().open;
  assert.ok(open.every((l) => l.status === "accepted"), "taken");
  assert.ok(open.some((l) => l.eventId === "ev-btc" && l.label === "Yes"));
  const past = realLines().past;
  assert.equal(past[0].word, "Bought");
});

test("Real: an order the engine refused shows as not filled — and nothing as held", async () => {
  await reviewed();
  answers.place = no("ORDER_REFUSED");
  await useReal.getState().place({ title: "BTC" });
  const { open } = realLines();
  assert.equal(open.length, 1);
  assert.equal(open[0].status, "failed");
  assert.equal(statusWord("failed"), "Not filled");
  assert.equal(summaryOf(open).count, 0, "a refused order is no position");
  assert.equal(summaryOf(open).value, 0);
});

test("Real: positions and orders survive a reload — they are read from the engine, not the page's memory", async () => {
  // A fresh page: nothing in memory, the engine holds an order still on its way and two positions.
  answers.live = ok(liveBody(A, { orders: [orderRecord(A, { quoteId: "q2", state: "submitted", createdAt: new Date(now).toISOString() }), orderRecord(A, { quoteId: "q1", state: "filled", createdAt: new Date(now - 60_000).toISOString() }), orderRecord(A, { quoteId: "q0", state: "reviewed" })] }));
  await useReal.getState().refresh(A);
  const { open, past } = realLines();
  assert.equal(open[0].status, "pending", "the order on its way first");
  assert.equal(open.filter((l) => l.status === "accepted").length, 2, "then the account's positions");
  assert.deepEqual(
    past.map((p) => p.word),
    ["Bought"],
    "a Review never placed is no order",
  );
  const s = summaryOf(open);
  assert.equal(s.pending, 1);
  assert.equal(s.count, 2);
  assert.equal(s.value, 2791.09);
  assert.equal(s.pnl, Math.round((2791.09 - (0.4666 * 2862 + 0.52233 * 1824.4)) * 100) / 100);
});

test("the engine's order records read only as live orders, newest first, in three states", () => {
  const live = readLive(
    liveBody(A, {
      orders: [
        orderRecord(A, { quoteId: "a", state: "partially_filled", createdAt: "2026-10-29T10:00:00.000Z" }),
        orderRecord(A, { quoteId: "b", state: "failed", createdAt: "2026-10-29T11:00:00.000Z" }),
        orderRecord(A, { quoteId: "c", state: "filled", mode: "paper" }),
        orderRecord(A, { quoteId: "d", state: "expired" }),
        orderRecord(A, { quoteId: "e", state: "cancelled", createdAt: "2026-10-29T09:00:00.000Z" }),
      ],
      redeemable: [{ outcomeId: "ev-sol-yes", question: "SOL", label: "Yes", valueUsd: 12.5 }, { outcomeId: "<bad>", question: "x", label: "y", valueUsd: 3 }],
      receipts: [{ redeemId: "r1", createdAt: "2026-10-29T08:00:00.000Z", asked: [{ outcomeId: "x", question: "ETH", label: "No", valueUsd: 4 }], legs: [{ outcomeId: "x", status: "confirmed" }] }],
    }),
  );
  assert.deepEqual(
    live.orders.map((o) => [o.quoteId, o.status]),
    [
      ["b", "failed"],
      ["a", "accepted"],
      ["e", "failed"],
    ],
  );
  assert.deepEqual(live.payouts, [{ outcomeId: "ev-sol-yes", title: "SOL", label: "Yes", valueUsd: 12.5 }]);
  assert.equal(live.receipts[0].paid, true);
  assert.equal(live.receipts[0].totalUsd, 4);
});

test("Real: collect asks the engine for exactly the payable wins, then reads the account again", async () => {
  answers.live = ok(liveBody(A, { redeemable: [{ outcomeId: "ev-sol-yes", question: "SOL", label: "Yes", valueUsd: 12.5 }] }));
  await useReal.getState().refresh(A);
  let asked = null;
  answers.redeem = (ids) => ((asked = ids), ok({ receipt: { redeemId: "r1" } }));
  await useReal.getState().collect(useReal.getState().live.payouts.map((p) => p.outcomeId));
  assert.deepEqual(asked, ["ev-sol-yes"]);
  assert.equal(useReal.getState().collecting, "idle");
  answers.redeem = no("PROVIDER_UNAVAILABLE");
  await useReal.getState().collect(["ev-sol-yes"]);
  assert.equal(useReal.getState().collecting, "failed");
});
