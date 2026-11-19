import { test } from "node:test";
import assert from "node:assert/strict";

import { orderMovedALot } from "./figures.ts";
import { momentary, quietWaitMs } from "./quote-copy.ts";
import { setTradeEnv, useTrade } from "./store.ts";
import { EXECUTED, memoryAttempts, ORDER, orderWith, QUOTE, scriptedEngine, signingWallet, signWire, T0, TAKER, testClock, USDT } from "./test-fixtures.mjs";

// Swap speed (18.11): a price or an order refused only for the moment is asked again quietly; words come only when it
// is refused for good. Over the engine's recorded answers; nothing here touches a network or a wallet.

const TOWER = { id: USDT, symbol: "USDT", name: "Tether", icon: null, district: "core", price: 1, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 90, verified: true, launchedAt: null };
const PHANTOM = { wallet: "Phantom", address: TAKER };
const SOL_ONLY = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map(), complete: true };
const BUSY = { status: 429, body: { error: { code: "QUOTE_RATE_LIMITED", message: "Jupiter Swap API V2 was rate-limited.", retryAfterMs: 3_000 } } };
const ORDER_BUSY = { status: 429, body: { error: { code: "ORDER_RATE_LIMITED", message: "rate-limited" } } };
const OK = { status: 200, body: QUOTE };

const flush = async () => {
  for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene(script, { connection = PHANTOM, holdings = SOL_ONLY } = {}) {
  const scripted = scriptedEngine({ quote: [OK], order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }], ...script });
  const clock = testClock(T0 + 1_000);
  const slept = [];
  const signer = signingWallet(signWire);
  setTradeEnv({
    engine: scripted.engine,
    attempts: memoryAttempts().store,
    now: clock.now,
    sleep: async (ms) => (slept.push(ms), clock.sleep(ms)),
    sign: (_connection, wire) => signer.sign(wire),
    wallet: () => ({ connection, holdings }),
    refreshHoldings: () => {},
    card: async () => ({ ok: false, code: "UNAVAILABLE" }),
    prove: async () => ({ ok: true }),
    jitter: () => 0,
  });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", typed: "", review: null, notice: null, done: null, failed: null, unknown: null, optimistic: {}, celebrate: null, autoKey: null, auto: false });
  return { ...scripted, clock, slept, signer };
}

test("which refusals are momentary, and which one quiet ask each earns", () => {
  for (const code of ["RATE_LIMITED", "QUOTE_RATE_LIMITED", "ORDER_RATE_LIMITED", "QUOTE_UNREACHABLE", "QUOTE_HTTP_ERROR", "TIMEOUT", "NETWORK", "HTTP_502", "HTTP_429"]) assert.equal(momentary(code), true, code);
  for (const code of ["QUOTE_NO_ROUTE", "ORDER_NO_ROUTE", "QUOTE_REFUSED", "QUOTE_MALFORMED", "PASSPORT_REFUSED", "MINT_UNREADABLE", "VALIDATION_ERROR", "PROVIDER_KEY_MISSING", "SWAP_PAUSED", "HTTP_400"]) assert.equal(momentary(code), false, code);
  // A full window waits for the slot the venue names, spread a little; never past ten seconds.
  assert.equal(quietWaitMs({ code: "QUOTE_RATE_LIMITED", retryAfterMs: 3_000 }, 0), 3_000);
  assert.equal(quietWaitMs({ code: "QUOTE_RATE_LIMITED", retryAfterMs: 3_000 }, 1), 3_400);
  assert.equal(quietWaitMs({ code: "QUOTE_RATE_LIMITED" }, 0), 1_500);
  assert.equal(quietWaitMs({ code: "QUOTE_RATE_LIMITED", retryAfterMs: 0 }, 0), 500);
  assert.equal(quietWaitMs({ code: "QUOTE_RATE_LIMITED", retryAfterMs: 12_000 }, 0), null);
  assert.equal(quietWaitMs({ code: "QUOTE_HTTP_ERROR" }, 0), 800);
  // A slow or lost answer was already asked twice by the engine line; anything else is said.
  for (const code of ["TIMEOUT", "NETWORK", "HTTP_502", "QUOTE_NO_ROUTE", "QUOTE_REFUSED"]) assert.equal(quietWaitMs({ code }, 0), null, code);
});

test("a price refused for a full window shimmers on and is asked once more, after the slot the venue names", async () => {
  const { routes, slept } = scene({ quote: [BUSY, OK] }, { connection: null, holdings: null });
  const seen = [];
  const off = useTrade.subscribe((state) => seen.push(state.quote.status));
  useTrade.getState().openFor(TOWER);
  await flush();
  off();
  assert.equal(useTrade.getState().quote.status, "ready");
  assert.equal(routes("quote").length, 2);
  assert.deepEqual(slept, [3_000]);
  assert.equal(seen.includes("error"), false, "no refusal reached the screen");
});

test("a price refused twice is said after one quiet ask, never a third ask into the same window", async () => {
  const { routes } = scene({ quote: [BUSY] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  const state = useTrade.getState();
  assert.equal(routes("quote").length, 2);
  assert.equal(state.quote.status, "error");
  assert.equal(state.quote.refusal.retryable, true);
});

test("a price that timed out is not asked again by the card: the engine line already asked twice", async () => {
  const { routes } = scene({ quote: [{ status: 504, body: { error: { code: "TIMEOUT", message: "late" } } }] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(routes("quote").length, 2, "the engine line's own second ask, and none of the card's");
  assert.equal(useTrade.getState().quote.status, "error");
});

test("a new amount during the quiet wait drops the old ask: its answer never lands", async () => {
  const { routes } = scene({ quote: [BUSY, OK] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  useTrade.getState().setTyped("0.2");
  await flush();
  const state = useTrade.getState();
  assert.equal(state.typed, "0.2");
  assert.equal(state.quote.status === "ready" ? state.quote.key.endsWith(":200000000") : true, true);
  assert.ok(routes("quote").length <= 3);
});

test("a refusal about the pair is said at once, never asked again", async () => {
  const { routes } = scene({ quote: [{ status: 409, body: { error: { code: "QUOTE_NO_ROUTE", message: "none" } } }] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(routes("quote").length, 1);
  assert.equal(useTrade.getState().quote.status, "error");
});

test("a refresh refused for the moment keeps the young price on screen and asks Jupiter nothing more", async () => {
  const { routes, clock } = scene({ quote: [OK, BUSY] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  const before = useTrade.getState().quote;
  clock.advance(20_000);
  await useTrade.getState().refreshQuote();
  const after = useTrade.getState().quote;
  assert.equal(routes("quote").length, 2);
  assert.equal(after.status, "ready");
  assert.equal(after.at, before.at);
});

test("an order the card builds by itself, refused for a full window, is let go in silence and never asked again", async () => {
  const { routes } = scene({ order: [ORDER_BUSY] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().prepare(true);
  let state = useTrade.getState();
  assert.equal(routes("order").length, 1);
  assert.equal(state.notice, null);
  assert.equal(state.phase, "idle");
  // The person's own press builds it and says what it hears.
  await state.press();
  state = useTrade.getState();
  assert.equal(routes("order").length, 2);
  assert.equal(state.notice?.tone, "error");
});

test("a press while the card builds its own order takes that order: no second order, the wallet waits for the next press", async () => {
  const { routes, signer } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const building = useTrade.getState().prepare(true);
  assert.equal(useTrade.getState().phase, "preparing");
  assert.equal(useTrade.getState().auto, true);
  await useTrade.getState().press();
  assert.equal(useTrade.getState().auto, false, "the press made it the person's own");
  await building;
  const state = useTrade.getState();
  assert.equal(routes("order").length, 1);
  assert.ok(state.review);
  assert.equal(signer.shown.length, 0);
});

test("renewed bytes a hair worse are shown without words; a press right after is still not consent", async () => {
  const slight = orderWith({ minReceivedRaw: String(BigInt(ORDER.order.minReceivedRaw) - BigInt(ORDER.order.minReceivedRaw) / 1000n) });
  const { clock, signer } = scene({ order: [{ status: 200, body: ORDER }, { status: 200, body: slight }] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().renew();
  let state = useTrade.getState();
  assert.equal(state.review.order.order.minReceivedRaw, slight.order.minReceivedRaw);
  assert.equal(state.notice, null);
  await state.press();
  assert.equal(signer.shown.length, 0);
  clock.advance(1_500);
  await useTrade.getState().press();
  assert.equal(signer.shown.length, 1);
});

test("quiet slips never add up unsaid: each renewal is measured against the figures last said", async () => {
  const least = BigInt(ORDER.order.minReceivedRaw);
  const slip = (bps) => ({ status: 200, body: orderWith({ minReceivedRaw: String(least - (least * BigInt(bps)) / 10_000n) }) });
  const { clock } = scene({ order: [{ status: 200, body: ORDER }, slip(30), slip(60)] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().renew();
  assert.equal(useTrade.getState().notice, null, "0.3 per cent: the figures say it");
  clock.advance(2_000);
  await useTrade.getState().renew();
  assert.equal(useTrade.getState().notice?.tone, "warn", "0.6 per cent from the figures first shown: said");
});

test("a press while the card renews bytes already on screen waits: nothing is taken over", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  const renewing = useTrade.getState().renew();
  assert.equal(useTrade.getState().phase, "preparing");
  await useTrade.getState().press();
  assert.equal(useTrade.getState().auto, true, "the renewal is not taken over");
  await renewing;
  assert.equal(routes("order").length, 2);
});

test("what renewed bytes say in words: a lower least-you-get by half a per cent or more, a higher fee, another swap", () => {
  const least = BigInt(ORDER.order.minReceivedRaw);
  // The least you get lower by `bps`, rounded so the slip is never under it.
  const at = (bps) => orderWith({ minReceivedRaw: String(least - (least * BigInt(bps) + 9_999n) / 10_000n) });
  assert.equal(orderMovedALot(ORDER, at(10)), false);
  assert.equal(orderMovedALot(ORDER, at(49)), false);
  assert.equal(orderMovedALot(ORDER, at(50)), true);
  assert.equal(orderMovedALot(ORDER, orderWith({ minReceivedRaw: String(least + 1n) })), false);
  assert.equal(orderMovedALot(ORDER, orderWith({ totalFeeBasisPoints: ORDER.order.totalFeeBasisPoints + 1 })), true);
  assert.equal(orderMovedALot(ORDER, orderWith({ inAmountRaw: "1" })), true);
  assert.equal(orderMovedALot(ORDER, orderWith({ rentFeeLamports: String(BigInt(ORDER.order.rentFeeLamports) + 2_039_280n) })), true, "a deposit the order did not carry");
});
