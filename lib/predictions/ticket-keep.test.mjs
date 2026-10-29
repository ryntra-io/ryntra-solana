// Run from repo root: node --test lib/predictions/ticket-keep.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createTicketKeep } from "./ticket-keep.ts";

/** A send whose answers the test gives by hand, one per call, in order. */
function hand() {
  const calls = [];
  const send = (path, init) =>
    new Promise((resolve, reject) => {
      calls.push({ path, init, body: init.body ? JSON.parse(init.body) : null, answer: (status, body) => resolve({ ok: status >= 200 && status < 300, json: async () => body }), fail: () => reject(new TypeError("network")) });
    });
  return { calls, send };
}

const review = (quoteId = "q-1", requested = 25) => ({ quoteId, requested, market: { id: "m-fed" }, outcome: { id: "o-fed-y", label: "Yes" } });
const order = (quoteId = "q-1", state = "quoted") => ({ quoteId, state });
const ask = { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", spendUsd: 25, planId: null, locale: "en" };

/** A panel reading the keep: it sees every change while it stands; taken down, it sees nothing more. */
function panel(keep) {
  const seen = [];
  const stop = keep.subscribe(() => seen.push(keep.get()));
  return { seen, stop };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the amount, the plan and an open Review outlive the ticket's panel being taken down and built again", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const first = panel(keep);
  keep.typeAmount("25");
  keep.choosePlan("plan-1");
  const asked = keep.quote(ask);
  assert.equal(keep.get().flow.stage, "quoting");
  // The layout changes while the price is asked: the panel goes, another is built in its place.
  first.stop();
  const second = panel(keep);
  calls[0].answer(200, { review: review(), order: order() });
  await asked;
  assert.equal(keep.get().flow.stage, "review");
  assert.equal(keep.get().flow.review.quoteId, "q-1");
  assert.equal(second.seen.at(-1).flow.stage, "review");
  assert.equal(first.seen.some((state) => state.flow.stage === "review"), false);
  assert.equal(keep.get().amount, "25");
  assert.equal(keep.get().ownAmount, true);
  assert.equal(keep.get().planId, "plan-1");
  // The quote asked for what the person typed and chose.
  assert.deepEqual(calls[0].body, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", side: "buy", spendUsd: 25, planId: null, locale: "en" });

  // Put away and brought back, and the layout changed again: the Review is still open over the same quote.
  second.stop();
  const third = panel(keep);
  assert.equal(keep.get().flow.stage, "review");
  assert.equal(keep.get().flow.review.quoteId, "q-1");
  third.stop();
});

test("the usual amount fills the ticket only until the person types their own", () => {
  const keep = createTicketKeep({ amount: "10", send: hand().send });
  keep.offerAmount("20");
  assert.equal(keep.get().amount, "20");
  assert.equal(keep.get().ownAmount, false);
  keep.typeAmount("7");
  keep.offerAmount("50");
  assert.equal(keep.get().amount, "7");
  // A plan brings its own amount, and it is the person's.
  keep.choosePlan("plan-2", "40");
  assert.equal(keep.get().amount, "40");
  assert.equal(keep.get().planId, "plan-2");
  keep.choosePlan(null);
  assert.equal(keep.get().planId, null);
  assert.equal(keep.get().amount, "40");
});

test("an unchanged state is the same object, so a reader is not told of nothing", () => {
  const keep = createTicketKeep({ amount: "10", send: hand().send });
  const before = keep.get();
  const reader = panel(keep);
  keep.offerAmount("10");
  keep.close();
  assert.equal(keep.get(), before);
  assert.equal(reader.seen.length, 0);
  reader.stop();
});

test("one quote at a time; a closed Review is not opened again by a late answer", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const asked = keep.quote(ask);
  await keep.quote(ask);
  assert.equal(calls.length, 1);
  keep.close();
  assert.equal(keep.get().flow.stage, "ticket");
  calls[0].answer(200, { review: review(), order: order() });
  await asked;
  assert.equal(keep.get().flow.stage, "ticket");
});

test("a refused or unanswered quote says why and opens nothing", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const refused = keep.quote(ask);
  calls[0].answer(409, { error: { code: "NOT_LINKED", message: "link first" } });
  await refused;
  assert.deepEqual(keep.get().flow, { stage: "failed", code: "NOT_LINKED", message: "link first", review: null });
  const lost = keep.quote(ask);
  calls[1].fail();
  await lost;
  assert.deepEqual(keep.get().flow, { stage: "failed", code: "NETWORK", message: "", review: null });
  const empty = keep.quote(ask);
  calls[2].answer(200, {});
  await empty;
  assert.equal(keep.get().flow.code, "UNAVAILABLE");
});

test("a fresh price asks again for the same order", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const first = keep.quote(ask);
  calls[0].answer(200, { review: review("q-1"), order: order("q-1") });
  await first;
  const again = keep.requote();
  assert.equal(keep.get().flow.stage, "quoting");
  assert.deepEqual(calls[1].body, calls[0].body);
  calls[1].answer(200, { review: review("q-2"), order: order("q-2") });
  await again;
  assert.equal(keep.get().flow.review.quoteId, "q-2");
});

test("an order being placed is sent once, cannot be closed over, and what came of it is shown", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const quoted = keep.quote(ask);
  calls[0].answer(200, { review: review(), order: order() });
  await quoted;
  const placing = keep.place(keep.get().flow.review);
  await keep.place(keep.get().flow.review);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { quoteId: "q-1" });
  // Esc or a layout change while it is placed: the Review stays.
  keep.close();
  assert.equal(keep.get().flow.stage, "placing");
  calls[1].answer(200, { order: order("q-1", "submitted") });
  await placing;
  assert.equal(keep.get().flow.stage, "placed");
  // Read again until it ends; a read for another order is not taken.
  const read = keep.reread();
  assert.equal(calls[2].path, "/api/predictions/orders/q-1");
  calls[2].answer(200, { order: order("q-1", "filled") });
  await read;
  assert.equal(keep.get().flow.order.state, "filled");
  await keep.reread();
  assert.equal(calls.length, 3);
  keep.close();
  assert.equal(keep.get().flow.stage, "ticket");
});

test("a refused order keeps its Review, so the person sees why and can ask a fresh price", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const quoted = keep.quote(ask);
  calls[0].answer(200, { review: review(), order: order() });
  await quoted;
  const placing = keep.place(keep.get().flow.review);
  calls[1].answer(410, { error: { code: "QUOTE_EXPIRED", message: "" } });
  await placing;
  assert.equal(keep.get().flow.stage, "failed");
  assert.equal(keep.get().flow.code, "QUOTE_EXPIRED");
  assert.equal(keep.get().flow.review.quoteId, "q-1");
  await tick();
});

test("a submitted order is read once at a time, and an older answer never lands over how it ended", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const quoted = keep.quote(ask);
  calls[0].answer(200, { review: review(), order: order() });
  await quoted;
  const placing = keep.place(keep.get().flow.review);
  calls[1].answer(200, { order: order("q-1", "submitted") });
  await placing;
  const first = keep.reread();
  await keep.reread();
  assert.equal(calls.length, 3);
  calls[2].answer(200, { order: order("q-1", "filled") });
  await first;
  assert.equal(keep.get().flow.order.state, "filled");
  // Ended: nothing more is read, and a late «submitted» could not undo it.
  await keep.reread();
  assert.equal(calls.length, 3);
});

/* ------------------------------------------------------------- the limit ticket */

const limitReview = (id = "plim_000000000000000000000001", price = 0.4) => ({
  id,
  mode: "paper",
  market: { id: "m-fed" },
  outcome: { id: "o-fed-y", label: "Yes" },
  figures: { price, shares: 4.98 },
  amountUsd: 2,
});
const limitOrder = (id = "plim_000000000000000000000001", state = "accepted") => ({ id, state, review: limitReview(id) });
const limitAsk = { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", price: 0.4, amountUsd: 2, life: "7d", planId: null, locale: "en" };

test("a limit Review is asked for as the person typed it, and placed once", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  keep.chooseKind("limit");
  assert.equal(keep.get().kind, "limit");
  assert.equal(keep.get().life, "7d");
  const asked = keep.reviewLimit(limitAsk);
  assert.equal(keep.get().flow.stage, "quoting");
  assert.equal(calls[0].path, "/api/predictions/limit/review");
  assert.deepEqual(calls[0].body, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", price: 0.4, amountUsd: 2, life: "7d", planId: null, locale: "en" });
  calls[0].answer(200, { review: limitReview(), order: limitOrder("plim_000000000000000000000001", "reviewed") });
  await asked;
  assert.equal(keep.get().flow.stage, "limitReview");
  assert.equal(keep.get().flow.stale, false);

  const placing = keep.placeLimit(keep.get().flow.review);
  assert.equal(keep.get().flow.stage, "limitPlacing");
  /* A second press while the first is in flight sends nothing. */
  await keep.placeLimit(keep.get().flow.review);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/api/predictions/limit/orders");
  assert.deepEqual(calls[1].body, { id: "plim_000000000000000000000001" });
  calls[1].answer(200, { order: limitOrder() });
  await placing;
  assert.equal(keep.get().flow.stage, "limitPlaced");
  assert.equal(keep.get().flow.order.state, "accepted");
});

test("any change to the ticket marks an open limit Review out of date", async () => {
  const changes = [
    ["the amount", (keep) => keep.typeAmount("5")],
    ["the price", (keep) => keep.typePrice("45")],
    ["how long it stands", (keep) => keep.chooseLife("1d")],
    ["the plan", (keep) => keep.choosePlan("plan-1")],
  ];
  for (const [what, change] of changes) {
    const { calls, send } = hand();
    const keep = createTicketKeep({ amount: "2", send });
    keep.chooseKind("limit");
    const asked = keep.reviewLimit(limitAsk);
    calls[0].answer(200, { review: limitReview(), order: limitOrder("plim_000000000000000000000001", "reviewed") });
    await asked;
    assert.equal(keep.get().flow.stale, false, what);
    change(keep);
    assert.equal(keep.get().flow.stage, "limitReview", what);
    assert.equal(keep.get().flow.stale, true, `${what} makes the Review out of date`);
  }
});

test("changing the kind or the money puts away whatever Review was open, and a limit order is read until it ends", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "2", send });
  keep.chooseKind("limit");
  const asked = keep.reviewLimit(limitAsk);
  calls[0].answer(200, { review: limitReview(), order: limitOrder("plim_000000000000000000000001", "reviewed") });
  await asked;
  keep.chooseKind("market");
  assert.equal(keep.get().flow.stage, "ticket", "a Review of the other kind is never left standing");

  keep.chooseKind("limit");
  const again = keep.reviewLimit(limitAsk);
  calls[1].answer(200, { review: limitReview(), order: limitOrder("plim_000000000000000000000001", "reviewed") });
  await again;
  const placing = keep.placeLimit(keep.get().flow.review);
  calls[2].answer(200, { order: limitOrder("plim_000000000000000000000001", "accepted") });
  await placing;

  const reading = keep.rereadLimit();
  await keep.rereadLimit();
  assert.equal(calls.length, 4, "one read at a time");
  assert.equal(calls[3].path, "/api/predictions/limit/orders/plim_000000000000000000000001");
  calls[3].answer(200, { order: limitOrder("plim_000000000000000000000001", "filled") });
  await reading;
  assert.equal(keep.get().flow.order.state, "filled");
  /* Ended: nothing more is read, and nothing more is cancelled. */
  await keep.rereadLimit();
  await keep.cancelLimit();
  assert.equal(calls.length, 4);
});

test("a plan becomes a limit ticket and its Review in one step, and nothing is placed by it", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "10", send });
  const plan = {
    id: "pplan_000000000000000000000001",
    current: { rules: { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", amountUsd: 25, entryProbability: 0.42, maxProbability: 0.45 } },
  };
  const step = keep.fromPlan(plan, "uk");
  assert.equal(keep.get().kind, "limit");
  assert.equal(keep.get().amount, "25");
  assert.equal(keep.get().price, "45", "the highest price the plan allows");
  assert.equal(keep.get().planId, "pplan_000000000000000000000001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/predictions/limit/review", "one step opens the Review and places nothing");
  assert.deepEqual(calls[0].body, { eventId: "e-fed", venueMarketId: "m-fed", outcomeId: "o-fed-y", price: 0.45, amountUsd: 25, life: "7d", planId: "pplan_000000000000000000000001", locale: "uk" });
  calls[0].answer(200, { review: limitReview("plim_000000000000000000000002", 0.45), order: limitOrder("plim_000000000000000000000002", "reviewed") });
  await step;
  assert.equal(keep.get().flow.stage, "limitReview");
  assert.equal(keep.get().flow.review.id, "plim_000000000000000000000002");
});

test("a limit Review the server refuses is said plainly, and the ticket keeps what the person typed", async () => {
  const { calls, send } = hand();
  const keep = createTicketKeep({ amount: "2", send });
  keep.chooseKind("limit");
  keep.typePrice("40");
  const asked = keep.reviewLimit(limitAsk);
  calls[0].answer(409, { error: { code: "NOT_LINKED", message: "not linked" } });
  await asked;
  assert.equal(keep.get().flow.stage, "limitFailed");
  assert.equal(keep.get().flow.code, "NOT_LINKED");
  assert.equal(keep.get().price, "40");
  assert.equal(keep.get().kind, "limit");

  /* Asked again, it is the same ticket that is priced. */
  const again = keep.requote();
  assert.equal(calls[1].path, "/api/predictions/limit/review");
  assert.deepEqual(calls[1].body, calls[0].body);
  calls[1].answer(200, { review: limitReview(), order: limitOrder("plim_000000000000000000000001", "reviewed") });
  await again;
  assert.equal(keep.get().flow.stage, "limitReview");
});
