import { test } from "node:test";
import assert from "node:assert/strict";

import { createEngine } from "../../city/lib/trade/engine.ts";
import { setTradeEnv, useTrade } from "../../city/lib/trade/store.ts";
import { memoryAttempts, QUOTE, recorded } from "../../city/lib/trade/test-fixtures.mjs";
import { SOL_REF } from "./state.ts";

// «Обмін» без гаманця (огляд очима 20.11, №17): перша відповідь котирування прийшла за 2,4 с і на екран не потрапила —
// число чекало другого запиту до 9,8 с. Тут — справжнє сховище квитка над записаними відповідями двигуна з
// затримками (у десять разів коротшими за наживо): друге питання тієї самої ціни, поки перша відповідь у дорозі, не
// викидає її. Мережі й гаманця немає.

const OK = { status: 200, body: QUOTE };
const BUSY = { status: 429, body: { error: { code: "QUOTE_RATE_LIMITED", message: "rate-limited", retryAfterMs: 300 } } };
const SECOND = (() => {
  const body = structuredClone(QUOTE);
  body.order.outAmountRaw = "1499000";
  return { status: 200, body };
})();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The engine's line over a fetch that answers each ask from `script` after its delay: `[{ answer, ms }…]`, the last one
 * repeated. Every ask is written down with the time it left and the time its answer came.
 */
function stage(script) {
  const asks = [];
  const t0 = Date.now();
  const fetchStub = async (url, init) => {
    const step = script[Math.min(asks.length, script.length - 1)];
    const ask = { at: Date.now() - t0, body: JSON.parse(init.body), answeredAt: null, status: step.answer.status };
    asks.push(ask);
    await wait(step.ms);
    ask.answeredAt = Date.now() - t0;
    return { ok: step.answer.status >= 200 && step.answer.status < 300, status: step.answer.status, json: async () => structuredClone(step.answer.body) };
  };
  setTradeEnv({
    engine: createEngine(fetchStub),
    attempts: memoryAttempts().store,
    now: () => Date.now(),
    sleep: wait,
    sign: async () => ({ ok: false, state: "REFUSED", reason: "no" }),
    wallet: () => ({ connection: null, holdings: null }),
    refreshHoldings: () => {},
    card: async () => ({ ok: false, code: "UNAVAILABLE" }),
    prove: async () => ({ ok: true }),
    jitter: () => 0,
  });
  useTrade.getState().close();
  useTrade.setState({ pay: "SOL", other: null });
  // When the figure first stands on the card: «Отримаєш» stops shimmering then.
  let shownAt = null;
  const off = useTrade.subscribe((card) => {
    if (shownAt === null && card.quote.status === "ready") shownAt = Date.now() - t0;
  });
  return { asks, shown: () => shownAt, off };
}

/** The Swap screen opening, as `useTicket` opens it: SOL bought with USDC, at the card's start amount. */
const open = () => useTrade.getState().openFor(SOL_REF, "buy", { view: "swap" });

test("a second ask of the same price while the first is out waits for it: the figure stands from the first answer", async () => {
  const { asks, shown, off } = stage([{ answer: OK, ms: 240 }, { answer: SECOND, ms: 980 }]);
  open();
  await wait(50);
  // The refresh's beat, a second open of the card on the same coin, the same amount typed back — any of them, mid-way.
  void useTrade.getState().refreshQuote();
  await wait(400);
  off();
  const card = useTrade.getState();
  assert.equal(asks.length, 1, "no second ask of the venue for the same price");
  assert.equal(card.quote.status, "ready");
  assert.equal(card.quote.body.order.outAmountRaw, QUOTE.order.outAmountRaw, "the first answer is the figure");
  assert.ok(shown() !== null && shown() < 400, `figure at ${shown()} ms, with the first answer (${asks[0].answeredAt} ms)`);
});

test("the card let go and opened again on the same coin mid-ask (a screen mounted twice) asks once", async () => {
  const { asks, shown, off } = stage([{ answer: OK, ms: 240 }, { answer: SECOND, ms: 980 }]);
  open();
  await wait(30);
  useTrade.getState().close();
  open();
  await wait(400);
  off();
  assert.equal(asks.length, 1);
  assert.equal(useTrade.getState().quote.status, "ready");
  assert.ok(shown() < 400, `figure at ${shown()} ms`);
});

test("the same amount typed back while its price is out joins that ask; the other amount's late answer never lands", async () => {
  const { asks, off } = stage([{ answer: OK, ms: 240 }, { answer: SECOND, ms: 120 }]);
  open();
  const start = useTrade.getState().typed;
  await wait(20);
  // Another amount, priced at once; then back to the start amount while its first ask is still out.
  useTrade.setState({ typed: "1" });
  void useTrade.getState().refreshQuote();
  await wait(20);
  useTrade.setState({ typed: start });
  void useTrade.getState().refreshQuote();
  await wait(500);
  off();
  const card = useTrade.getState();
  assert.equal(card.typed, start);
  assert.equal(card.quote.status, "ready");
  assert.equal(card.quote.key.endsWith(`:${asks[0].body.amountRaw}`), true, "the figure is the start amount's");
  assert.equal(asks.filter((ask) => ask.body.amountRaw === asks[0].body.amountRaw).length, 1, "the start amount asked once");
});

test("a beat of the refresh during the quiet wait after a full window joins it: one quiet ask, never a third", async () => {
  const { asks, off } = stage([{ answer: BUSY, ms: 60 }, { answer: OK, ms: 60 }]);
  open();
  await wait(150);
  void useTrade.getState().refreshQuote();
  await wait(600);
  off();
  assert.equal(asks.length, 2, asks.map((ask) => ask.status).join(","));
  assert.deepEqual(asks.map((ask) => ask.status), [429, 200]);
  assert.ok(asks[1].at >= asks[0].answeredAt + 280, `the second ask left at ${asks[1].at} ms — after the slot the venue named, not into the same window`);
  assert.equal(useTrade.getState().quote.status, "ready");
});

test("another coin's answer, late, never stands on the coin now on the card", async () => {
  const { asks, off } = stage([{ answer: OK, ms: 240 }, { answer: SECOND, ms: 60 }]);
  open();
  await wait(20);
  useTrade.getState().openFor({ id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether", icon: null }, "buy", { view: "swap" });
  await wait(400);
  off();
  const card = useTrade.getState();
  assert.equal(asks.length, 2);
  assert.equal(card.quote.status, "ready");
  assert.equal(card.quote.body.order.outAmountRaw, SECOND.body.order.outAmountRaw, "the coin on the card wears its own price");
  assert.equal(card.quote.key.includes("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), true);
});

test("a refresh of a price already on screen keeps it until the new one comes, and the new one replaces it", async () => {
  const { asks, off } = stage([{ answer: OK, ms: 40 }, { answer: SECOND, ms: 40 }]);
  open();
  await wait(120);
  const seen = [];
  const watch = useTrade.subscribe((card) => seen.push(card.quote.status));
  void useTrade.getState().refreshQuote();
  await wait(150);
  watch();
  off();
  assert.equal(asks.length, 2);
  assert.equal(seen.includes("loading"), false, "the old figure stays while the new one is asked");
  assert.equal(useTrade.getState().quote.body.order.outAmountRaw, SECOND.body.order.outAmountRaw);
});

test("the recorded answer the race is played on is the engine's own quote", () => {
  assert.equal(recorded("quote: SOL to USDT with the referral fee").status, 200);
});
