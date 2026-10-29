// Run from repo root: node --test lib/predictions/limit.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { getPredictionProvider, resetAggAdapterCache } from "./agg/adapter.ts";
import {
  alignLimitPrice,
  alignLimitShares,
  cancelLimitOrder,
  limitCancellable,
  limitFigures,
  limitFillAgainstBook,
  limitFromPlan,
  limitSignature,
  limitStateOf,
  listLimitRecords,
  placeLimitOrder,
  readLimitRecord,
  reviewLimitOrder,
  sweepLimitOrders,
  syncLimitOrder,
} from "./limit.ts";
import { listNotes } from "./notify/channel.ts";
import { limitNoteWords } from "./notify/words.ts";
import { writeLink } from "./session.ts";
import { seal } from "./vault.ts";

/*
 * The limit order's whole path, replayed against the aggregator's answers
 * (`fixtures/agg-limit.json`): the Review's arithmetic and its grid, the one
 * send per Review, a part filled, the rest cancelled, a lapsed order, a
 * dropped read that ends nothing, and the simulated order over the venue's
 * own book with real money switched off. The real adapter and SDK talk to a
 * local server that answers as the aggregator does; nothing leaves this
 * machine.
 */

const LIMIT = JSON.parse(readFileSync(new URL("./fixtures/agg-limit.json", import.meta.url), "utf8"));
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const SECRET = "test-secret-of-sufficient-length";
process.env.BETA_TOKEN_SECRET = SECRET;
const OFF = { BETA_TOKEN_SECRET: SECRET };
const ON = { PREDICTIONS_LIVE_FUNDING: "on", PREDICTIONS_LIVE_WALLETS: WALLET, PREDICTIONS_LIVE_VENUES: "polymarket", PREDICTIONS_LIVE_MAX_USD: "5", BETA_TOKEN_SECRET: SECRET };

const EVENT = {
  id: "ev1",
  title: "Will the test pass?",
  subtitle: null,
  image: null,
  status: "open",
  venue: "polymarket",
  venues: ["polymarket"],
  volume: 1000,
  endDate: "2027-01-01T00:00:00.000Z",
  categories: [],
  marketCount: 1,
  aggKey: null,
  structureType: null,
  arbReturn: null,
  leading: [{ id: "o-yes", label: "Yes", probability: 0.42, venueMarketId: "m1" }],
  description: null,
  startDate: null,
  markets: [
    {
      id: "m1",
      venue: "polymarket",
      question: "Will the test pass?",
      status: "open",
      outcomes: [
        { id: "o-yes", label: "Yes", probability: 0.42, venueMarketId: "m1", winner: null, matched: [] },
        { id: "o-no", label: "No", probability: 0.58, venueMarketId: "m1", winner: null, matched: [] },
      ],
      volume: 1000,
      endDate: "2027-01-01T00:00:00.000Z",
      resolutionDate: null,
      rules: { primary: "Resolves Yes if the test passes.", secondary: null },
      tickSize: 0.01,
      minOrderSize: 5,
      aggKey: null,
      arbReturn: null,
      matched: [],
      image: null,
    },
  ],
  settlement: null,
};

function durableStore() {
  return { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
}

function jwt(expSeconds, sub = "u1") {
  return `h.${Buffer.from(JSON.stringify({ sub, exp: expSeconds })).toString("base64url")}.s`;
}

async function linked(store, wallet = WALLET) {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  await writeLink(
    store,
    {
      wallet,
      externalId: `ryntra:solana:${wallet}`,
      providerUserId: "agguser",
      providerWallet: wallet,
      externalIdLinked: true,
      linkAttemptedAt: stamp,
      linkError: null,
      access: seal(jwt(now / 1000 + 3600), { BETA_TOKEN_SECRET: SECRET }),
      refresh: seal("refresh-1", { BETA_TOKEN_SECRET: SECRET }),
      accessExpiresAt: new Date(now + 3_600_000).toISOString(),
      state: "active",
      stateReason: null,
      createdAt: stamp,
      updatedAt: stamp,
      refreshedAt: null,
    },
    null,
  );
  return store;
}

/** The real adapter, with the event read from the fixture (the event read is not the order path). */
function provider() {
  const real = getPredictionProvider();
  return { ...real, event: async (id) => (id === EVENT.id ? { ok: true, value: EVENT } : { ok: false, code: "NOT_FOUND", message: "no such event" }) };
}

/**
 * The aggregator, answering from the fixture. `script` names the answer per
 * call kind; a list is answered in turn (its last answer repeats); a function
 * decides from what was seen so far. `"drop"` closes the socket without an
 * answer.
 */
async function aggServer(t, script = {}) {
  const seen = [];
  const plan = { config: "appConfigLive", book: "bookThin", place: "limitAccepted", orders: "limitOrdersOpen", cancel: "cancelAccepted", balances: "balancesLive", ...script };
  const queues = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const answerFor = (kind) => {
    const q = queues[kind];
    if (typeof q === "function") return q(seen);
    if (Array.isArray(q)) return q.length > 1 ? q.shift() : q[0];
    return q;
  };
  /* The provider echoes back the client order id it was given, as it does on the wire. */
  let clientOrderId = "";
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://agg");
      const body = raw ? JSON.parse(raw) : null;
      const query = {};
      for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
      seen.push({ method: request.method, path: url.pathname, query, body });
      if (body?.clientOrderId) clientOrderId = body.clientOrderId;
      const p = url.pathname;
      const kind =
        request.method === "GET" && p === "/app/config" ? "config"
        : request.method === "GET" && p === "/orderbooks" ? "book"
        : request.method === "POST" && p === "/execution/limit-orders" ? "place"
        : request.method === "GET" && p === "/execution/orders" ? "orders"
        : request.method === "POST" && p === "/execution/orders/cancel" ? "cancel"
        : request.method === "GET" && p === "/execution/balances" ? "balances"
        : request.method === "GET" && p === "/me" ? "profile"
        : null;
      const key = kind === "profile" ? null : kind ? answerFor(kind) : null;
      if (key === "drop") {
        request.socket.destroy();
        return;
      }
      const answer = key === null ? { status: 404, body: { message: "not here" } } : LIMIT[key];
      response.statusCode = answer.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer.body).split("{{clientOrderId}}").join(clientOrderId));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { id: process.env.AGG_APP_ID, base: process.env.AGG_API_BASE_URL };
  process.env.AGG_APP_ID = "app-under-test";
  process.env.AGG_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  resetAggAdapterCache();
  t.after(() => {
    server.close();
    if (saved.id === undefined) delete process.env.AGG_APP_ID;
    else process.env.AGG_APP_ID = saved.id;
    if (saved.base === undefined) delete process.env.AGG_API_BASE_URL;
    else process.env.AGG_API_BASE_URL = saved.base;
    resetAggAdapterCache();
  });
  const calls = (method, path) => seen.filter((s) => s.method === method && s.path === path);
  return { seen, calls, places: () => calls("POST", "/execution/limit-orders") };
}

const ASK = { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", price: 0.4, amountUsd: 2, life: "7d", locale: "uk" };
const LIVE_ASK = { ...ASK, mode: "live" };

/* ------------------------------------------------------------------ the arithmetic and the grid */

test("the price lands on the venue's grid in the person's favour, and the amount buys what it buys at it", () => {
  assert.equal(alignLimitPrice(0.4237, 0.01, "buy"), 0.42, "a buy never pays more than it named");
  assert.equal(alignLimitPrice(0.4237, 0.01, "sell"), 0.43);
  assert.equal(alignLimitPrice(0.4237, null, "buy"), 0.4237, "no tick stated keeps the millionth");
  assert.equal(alignLimitPrice(0, 0.01, "buy"), 0);
  assert.equal(alignLimitShares(4.9876), 4.98);

  const f = limitFigures({ price: 0.4 });
  assert.equal(f.shares, 0, "no amount buys nothing");
  const two = limitFigures({ price: 0.4, amountUsd: 2 });
  /* $2 all in: Ryntra's 30 bps set aside first, the rest buys contracts at 40c. */
  assert.equal(two.shares, 4.98);
  assert.equal(two.contractsUsd, 1.992);
  assert.equal(two.ryntraBips, 30);
  assert.equal(two.ryntraFeeUsd, 0.005976);
  assert.equal(two.venueFeeUsd, null, "the venue's own fee is unknown before the fill, never zero");
  assert.equal(two.totalUsd, 1.997976);
  assert.equal(two.payoutIfRightUsd, 4.98);
  assert.equal(two.maxLossUsd, 2, "the whole of it is at risk");
  assert.equal(two.returnIfRightPct > 149 && two.returnIfRightPct < 150, true);
});

test("a limit buy fills only at or below its price, and never more than the book shows", () => {
  const asks = [
    { price: 0.46, size: 500, venues: {} },
    { price: 0.4, size: 2, venues: {} },
    { price: 0.39, size: 1, venues: {} },
  ];
  const whole = limitFillAgainstBook(asks, 0.4, 4.98);
  assert.equal(whole.shares, 3, "only the levels at or below 40c");
  assert.equal(Math.round(whole.usd * 1e6) / 1e6, 1.19);
  const capped = limitFillAgainstBook(asks, 0.5, 1);
  assert.equal(capped.shares, 1, "never more than the order has left");
  assert.deepEqual(limitFillAgainstBook(asks, 0.3, 4.98), { shares: 0, usd: 0, avgPrice: null });
});

test("a provider status and what filled add up to one state; an unknown status is never read as finished", () => {
  assert.equal(limitStateOf("open", 0), "accepted");
  assert.equal(limitStateOf("open", 2), "partially_filled");
  assert.equal(limitStateOf("partially_filled_open", 2), "partially_filled");
  assert.equal(limitStateOf("filled", 4.98), "filled");
  assert.equal(limitStateOf("cancelled", 2), "cancelled");
  assert.equal(limitStateOf("expired", 0), "expired");
  assert.equal(limitStateOf("rejected", 0), "failed");
  assert.equal(limitStateOf("some_new_word", 0), "accepted", "a word we do not know is not an ending");
  assert.equal(limitStateOf(null, 0), "sending");
  assert.equal(limitCancellable({ state: "accepted", providerStatus: "open" }), true);
  assert.equal(limitCancellable({ state: "filled", providerStatus: "filled" }), false);
  assert.equal(limitCancellable({ state: "sending", providerStatus: null }), false, "nothing to cancel before the venue names it");
});

test("the ticket's fingerprint changes with every part of the ticket", () => {
  const base = { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", priceInput: 0.4, amountUsd: 2, life: "7d", mode: "paper", planId: null };
  const one = limitSignature(base);
  assert.equal(limitSignature({ ...base }), one, "the same ticket is the same Review");
  for (const change of [{ outcomeId: "o-no" }, { priceInput: 0.41 }, { amountUsd: 3 }, { life: "1d" }, { mode: "live" }, { planId: "pplan_000000000000000000000000" }]) {
    assert.notEqual(limitSignature({ ...base, ...change }), one, `a changed ticket makes a new fingerprint: ${Object.keys(change)[0]}`);
  }
});

test("a plan becomes a limit ticket at the highest price it allows", () => {
  const rules = { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", amountUsd: 25, entryProbability: 0.42, maxProbability: 0.45 };
  assert.deepEqual(limitFromPlan(rules), { outcomeId: "o-yes", venueMarketId: "m1", eventId: "ev1", priceInput: 0.45, amountUsd: 25, life: "7d", from: "bound" });
  assert.deepEqual(limitFromPlan({ ...rules, maxProbability: null }).priceInput, 0.42, "no bound: the probability it was written at");
});

/* ------------------------------------------------------------------ the Review */

test("the paper Review states the price, the amount, Ryntra's fee, the venue's unknown fee and what happens if it does not fill", async (t) => {
  const agg = await aggServer(t, { balances: "balancesPaper" });
  const store = await linked(durableStore());
  const reviewed = await reviewLimitOrder(store, provider(), WALLET, ASK, Date.now(), OFF);
  assert.equal(reviewed.ok, true, reviewed.message);
  const review = reviewed.value.review;
  assert.equal(review.mode, "paper");
  assert.equal(agg.calls("GET", "/orderbooks").length, 1, "the venue's own book is read for the Review");
  assert.equal(review.figures.price, 0.4);
  assert.equal(review.figures.shares, 4.98);
  assert.equal(review.figures.venueFeeUsd, null);
  assert.equal(review.timeInForce, "GTD");
  assert.equal(typeof review.expiresAt, "string");
  assert.equal(review.fillsAtOnce, false, "40c under a 45c best ask rests");
  assert.equal(review.book.bestAsk, 0.45);
  assert.equal(review.canPlace, true, review.blockedBy.join(","));
  const ids = review.checks.map((c) => c.id);
  for (const id of ["mode", "market", "price", "amount", "size", "balance", "expiry", "fill_now", "venue_fee", "not_filled"]) assert.equal(ids.includes(id), true, `the Review states ${id}`);
  assert.equal(review.checks.find((c) => c.id === "venue_fee").state, "warn");
  assert.match(review.checks.find((c) => c.id === "venue_fee").detail, /майданчик/i);
  assert.match(review.checks.find((c) => c.id === "not_filled").detail, /не виконається/);
  assert.equal(review.checks.find((c) => c.id === "size_min").state, "warn", "under the market's own floor the Review warns rather than promising");
  assert.equal(reviewed.value.record.state, "reviewed");
  assert.equal(reviewed.value.record.providerOrderId, null);
  assert.equal(agg.places().length, 0, "a Review places nothing");
});

test("the Review moves the price onto the grid and says so, and refuses what cannot be placed", async (t) => {
  await aggServer(t, { balances: "balancesPaper" });
  const store = await linked(durableStore());
  const p = provider();
  const moved = await reviewLimitOrder(store, p, WALLET, { ...ASK, price: 0.4237 }, Date.now(), OFF);
  assert.equal(moved.value.review.figures.price, 0.42);
  assert.equal(moved.value.review.checks.find((c) => c.id === "grid").state, "pass");
  assert.match(moved.value.review.checks.find((c) => c.id === "grid").detail, /42\.4% стає 42\.0%/);

  const tooSmall = await reviewLimitOrder(store, p, WALLET, { ...ASK, amountUsd: 0.5 }, Date.now(), OFF);
  assert.equal(tooSmall.value.review.canPlace, false);
  assert.deepEqual(tooSmall.value.review.blockedBy, ["amount"]);

  const bad = await reviewLimitOrder(store, p, WALLET, { ...ASK, life: "forever" }, Date.now(), OFF);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "VALIDATION_ERROR");
});

test("a live Review is capped, named on the venue open to it, and never placed on a balance nobody read", async (t) => {
  const agg = await aggServer(t, { balances: ["balancesLive", "balancesShort"] });
  const store = await linked(durableStore());
  const p = provider();
  const ok = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  assert.equal(ok.value.review.mode, "live");
  assert.equal(ok.value.review.checks.find((c) => c.id === "live_venues").state, "pass");
  assert.equal(ok.value.review.canPlace, true, ok.value.review.blockedBy.join(","));
  assert.equal(agg.calls("GET", "/app/config").length >= 1, true, "the provider's own mode is read before a live Review");

  const short = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  assert.deepEqual(short.value.review.blockedBy, ["balance"], "a balance that does not cover it blocks the order");

  const overCap = await reviewLimitOrder(store, p, WALLET, { ...LIVE_ASK, amountUsd: 50 }, Date.now(), ON);
  assert.equal(overCap.value.review.blockedBy.includes("amount"), true);

  /* Live open on another venue than this market's: the Review is built and names the refusal rather than failing blind. */
  const elsewhere = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), { ...ON, PREDICTIONS_LIVE_VENUES: "limitless" });
  assert.equal(elsewhere.ok, true);
  assert.equal(elsewhere.value.review.canPlace, false);
  assert.equal(elsewhere.value.review.blockedBy.includes("live_venues"), true);
  assert.match(elsewhere.value.review.checks.find((c) => c.id === "live_venues").detail, /polymarket/);

  const closed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), { ...ON, PREDICTIONS_LIVE_VENUES: "" });
  assert.equal(closed.ok, false);
  assert.equal(closed.code, "FORBIDDEN", "live open on no venue at all is no live Review");

  const appPaper = await aggServer(t, { config: "appConfigPaper" });
  const stillPaper = await reviewLimitOrder(store, provider(), WALLET, LIVE_ASK, Date.now(), ON);
  assert.equal(stillPaper.ok, false);
  assert.equal(stillPaper.code, "FORBIDDEN");
  assert.equal(appPaper.places().length, 0);
});

test("the plan's own bound is judged against the limit price, not against a route", async (t) => {
  await aggServer(t, { balances: "balancesPaper" });
  const store = await linked(durableStore());
  const { createPredictionPlan } = await import("./plan.ts");
  const rules = {
    thesis: "The test passes.",
    whyNow: null,
    eventId: "ev1",
    eventTitle: EVENT.title,
    venueMarketId: "m1",
    question: EVENT.markets[0].question,
    outcomeId: "o-yes",
    outcomeLabel: "Yes",
    amountUsd: 2,
    entryProbability: 0.42,
    maxProbability: 0.43,
    invalidation: { text: "The build breaks.", probabilityBelow: null },
    resolutionDeadline: null,
    monitoring: [],
    references: [],
    assumptions: [],
  };
  const plan = await createPredictionPlan(store, { owner: WALLET, rules, activate: true });
  assert.equal(plan.ok, true);
  const p = provider();
  const within = await reviewLimitOrder(store, p, WALLET, { ...ASK, planId: plan.value.id }, Date.now(), OFF);
  assert.equal(within.value.review.plan.checks.find((c) => c.id === "max_probability").state, "pass");
  assert.equal(within.value.review.canPlace, true, within.value.review.blockedBy.join(","));
  const above = await reviewLimitOrder(store, p, WALLET, { ...ASK, price: 0.5, planId: plan.value.id }, Date.now(), OFF);
  assert.equal(above.value.review.canPlace, false);
  assert.equal(above.value.review.blockedBy.includes("plan:max_probability"), true);
});

/* ------------------------------------------------------------------ one Review, one order */

test("one Review sends one order: a second confirmation finds the record taken and sends nothing", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const id = reviewed.value.review.id;
  const [first, second] = await Promise.all([placeLimitOrder(store, p, WALLET, id, Date.now(), ON), placeLimitOrder(store, p, WALLET, id, Date.now(), ON)]);
  assert.equal(first.ok && second.ok, true);
  assert.equal(agg.places().length, 1, "the venue was told once");
  assert.equal(agg.places()[0].body.clientOrderId, id, "Ryntra's own id is the venue's client order id");
  assert.equal(agg.places()[0].body.limitPriceRaw, "400000");
  assert.equal(agg.places()[0].body.sizeRaw, "4980000");
  assert.equal(agg.places()[0].body.timeInForce, "GTD");
  assert.equal(typeof agg.places()[0].body.expiresAt, "string");
  const held = await readLimitRecord(store, WALLET, id);
  assert.equal(held.state, "accepted");
  assert.equal(held.providerOrderId, "lim_1");
  assert.equal(held.reservedUsd, 1.994018);

  /* And a third confirmation of the same Review, once it is an order, sends nothing either. */
  const third = await placeLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(third.ok, true);
  assert.equal(third.value.state, "accepted");
  assert.equal(agg.places().length, 1);
});

test("a Review that is no longer fresh is not placed, and the venue is never told", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const p = provider();
  const at = Date.now();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, at, ON);
  const placed = await placeLimitOrder(store, p, WALLET, reviewed.value.review.id, at + 120_000, ON);
  assert.equal(placed.ok, false);
  assert.equal(placed.code, "QUOTE_EXPIRED");
  assert.equal(agg.places().length, 0);
  assert.equal((await readLimitRecord(store, WALLET, reviewed.value.review.id)).state, "failed");
});

test("a Review the venue refuses is closed; a Review refused before the venue looked is free again", async (t) => {
  const refusing = await aggServer(t, { place: "limitRefused" });
  const store = await linked(durableStore());
  const p = provider();
  const one = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const refused = await placeLimitOrder(store, p, WALLET, one.value.review.id, Date.now(), ON);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "ORDER_REFUSED");
  assert.equal((await readLimitRecord(store, WALLET, one.value.review.id)).state, "failed");
  assert.equal(refusing.places().length, 1);

  /* Live switched off between the Review and the confirmation: nothing is sent and the Review stands. */
  const two = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const closed = await placeLimitOrder(store, p, WALLET, two.value.review.id, Date.now(), { ...ON, PREDICTIONS_LIVE_VENUES: "" });
  assert.equal(closed.ok, false);
  assert.equal(closed.code, "FORBIDDEN");
  assert.equal((await readLimitRecord(store, WALLET, two.value.review.id)).state, "reviewed");
  assert.equal(refusing.places().length, 1, "nothing more reached the venue");
});

/* ------------------------------------------------------------------ partly filled, cancelled, lapsed */

test("a part filled stays filled when the rest is cancelled", async (t) => {
  let cancelled = false;
  const agg = await aggServer(t, {
    orders: () => (cancelled ? "limitOrdersCancelled" : "limitOrdersPartial"),
    cancel: () => ((cancelled = true), "cancelAccepted"),
  });
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const id = reviewed.value.review.id;
  const placed = await placeLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(placed.value.state, "partially_filled");
  assert.equal(placed.value.filledShares, 2);
  assert.equal(placed.value.filledUsd, 0.8);
  assert.equal(placed.value.avgFillPrice, 0.4);
  assert.equal(limitCancellable(placed.value), true);

  const stopped = await cancelLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(stopped.ok, true, stopped.message);
  assert.equal(stopped.value.state, "cancelled");
  assert.equal(stopped.value.filledShares, 2, "what filled stays filled");
  assert.equal(stopped.value.filledUsd, 0.8);
  assert.equal(stopped.value.cancelRequested, true);
  assert.equal(typeof stopped.value.closedAt, "string");
  assert.equal(agg.calls("POST", "/execution/orders/cancel").length, 1);
  assert.equal(limitCancellable(stopped.value), false);

  const again = await cancelLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(again.ok, false);
  assert.equal(again.code, "ORDER_REFUSED");
  assert.equal(agg.calls("POST", "/execution/orders/cancel").length, 1, "a finished order is not cancelled twice");
});

test("an order that stood out its time reads as lapsed, and the person is told once", async (t) => {
  await aggServer(t, { orders: ["limitOrdersOpen", "limitOrdersExpired"] });
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const id = reviewed.value.review.id;
  assert.equal((await placeLimitOrder(store, p, WALLET, id, Date.now(), ON)).value.state, "accepted");

  const swept = await sweepLimitOrders(store, p, WALLET, ON, Date.now());
  assert.equal(swept.orders.find((o) => o.id === id).state, "expired");
  const notes = await listNotes(store, WALLET);
  const lapsed = notes.filter((n) => n.kind === "limit_expired");
  assert.equal(lapsed.length, 1);
  assert.equal(lapsed[0].paper, false);
  assert.equal(lapsed[0].facts.price, 0.4);
  const words = limitNoteWords(lapsed[0], "uk");
  assert.match(words.title, /строк/i);
  assert.match(words.body, /погас/);

  /* The same pass again: the state has not moved, so nobody is told a second time. */
  await sweepLimitOrders(store, p, WALLET, ON, Date.now());
  assert.equal((await listNotes(store, WALLET)).filter((n) => n.kind === "limit_expired").length, 1);
});

test("a fill is told through the one prediction channel, and a part filling again raises that note rather than writing a second", async (t) => {
  await aggServer(t, { orders: ["limitOrdersOpen", "limitOrdersPartial", "limitOrdersFilled"] });
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const id = reviewed.value.review.id;
  await placeLimitOrder(store, p, WALLET, id, Date.now(), ON);
  await sweepLimitOrders(store, p, WALLET, ON, Date.now());
  const partial = (await listNotes(store, WALLET)).filter((n) => n.kind === "limit_partial");
  assert.equal(partial.length, 1);
  assert.equal(partial[0].facts.filledShares, 2);
  assert.match(limitNoteWords(partial[0], "uk").body, /скасувати однією дією/);

  await sweepLimitOrders(store, p, WALLET, ON, Date.now());
  const after = await listNotes(store, WALLET);
  assert.equal(after.filter((n) => n.kind === "limit_partial").length, 1, "one note for one thing happening");
  const filled = after.filter((n) => n.kind === "limit_filled");
  assert.equal(filled.length, 1);
  assert.equal((await readLimitRecord(store, WALLET, id)).state, "filled");
  assert.match(limitNoteWords(filled[0], "en").body, /position/);
});

/* ------------------------------------------------------------------ a dropped stream */

test("a read that failed ends nothing; the state comes back from the provider's own list by Ryntra's id", async (t) => {
  const agg = await aggServer(t, { orders: ["limitOrdersOpen", "limitOrdersUnread", "drop", "limitOrdersPartial"] });
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, Date.now(), ON);
  const id = reviewed.value.review.id;
  await placeLimitOrder(store, p, WALLET, id, Date.now(), ON);

  const unread = await syncLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(unread.ok, false, "a list that could not be read is said to be unread, not turned into an ending");
  assert.equal((await readLimitRecord(store, WALLET, id)).state, "accepted");

  const dropped = await syncLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(dropped.ok, false);
  assert.equal((await readLimitRecord(store, WALLET, id)).state, "accepted", "a dropped socket leaves the order where it was");

  const back = await syncLimitOrder(store, p, WALLET, id, Date.now(), ON);
  assert.equal(back.ok, true, back.message);
  assert.equal(back.value.state, "partially_filled");
  assert.equal(back.value.filledShares, 2);
  assert.equal(agg.places().length, 1, "no reconnection ever places a second order");
});

test("a send with no clear answer is never a second order: the same client id is looked for, and only a list that knows nothing of it closes the order", async (t) => {
  const agg = await aggServer(t, { place: "limitTimeout", orders: ["limitOrdersNone", "limitOrdersOpen"] });
  const store = await linked(durableStore());
  const p = provider();
  const at = Date.now();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, at, ON);
  const id = reviewed.value.review.id;
  const sent = await placeLimitOrder(store, p, WALLET, id, at, ON);
  assert.equal(sent.ok, true, "no answer is not a no");
  assert.equal(sent.value.state, "sending", "it waits on the provider's word rather than being called failed");
  assert.equal(agg.places().length, 1);

  /* The venue does know it after all, under Ryntra's own id: the order is adopted, not sent again. */
  const found = await syncLimitOrder(store, p, WALLET, id, at + 1000, ON);
  assert.equal(found.value.state, "accepted");
  assert.equal(found.value.providerOrderId, "lim_1");
  assert.equal(agg.places().length, 1);
});

test("a send that left no trace at all is closed as never received, and only once the Review's grace has passed", async (t) => {
  const agg = await aggServer(t, { place: "limitTimeout", orders: "limitOrdersNone" });
  const store = await linked(durableStore());
  const p = provider();
  const at = Date.now();
  const reviewed = await reviewLimitOrder(store, p, WALLET, LIVE_ASK, at, ON);
  const id = reviewed.value.review.id;
  await placeLimitOrder(store, p, WALLET, id, at, ON);
  assert.equal((await syncLimitOrder(store, p, WALLET, id, at + 60_000, ON)).value.state, "sending", "inside the grace nothing is concluded");
  const closed = await syncLimitOrder(store, p, WALLET, id, at + 400_000, ON);
  assert.equal(closed.value.state, "failed");
  assert.equal(closed.value.error, "not_received");
  assert.equal(agg.places().length, 1);
});

/* ------------------------------------------------------------------ paper by default */

test("with real money switched off everything works as a simulation: it fills at or below the price, it is cancelled, and no venue is told anything", async (t) => {
  const agg = await aggServer(t, { balances: "balancesPaper", book: "bookCrossesPartly" });
  const store = await linked(durableStore());
  const p = provider();
  const reviewed = await reviewLimitOrder(store, p, WALLET, ASK, Date.now(), OFF);
  const id = reviewed.value.review.id;
  assert.equal(reviewed.value.review.fillsAtOnce, true, "40c meets a 40c best ask");

  const placed = await placeLimitOrder(store, p, WALLET, id, Date.now(), OFF);
  assert.equal(placed.ok, true, placed.message);
  assert.equal(placed.value.mode, "paper");
  assert.equal(placed.value.state, "partially_filled", "the book holds two shares at 40c and nothing more under the price");
  assert.equal(placed.value.filledShares, 2);
  assert.equal(placed.value.filledUsd, 0.8);
  assert.equal(agg.places().length, 0, "the aggregator has no paper limit order and is told nothing");

  const stopped = await cancelLimitOrder(store, p, WALLET, id, Date.now(), OFF);
  assert.equal(stopped.value.state, "cancelled");
  assert.equal(stopped.value.filledShares, 2);
  assert.equal(agg.calls("POST", "/execution/orders/cancel").length, 0);

  const notes = await listNotes(store, WALLET);
  const told = notes.filter((n) => n.kind === "limit_partial");
  assert.equal(told.length, 1);
  assert.equal(told[0].paper, true, "a simulated fill is marked a simulation");
  assert.match(limitNoteWords(told[0], "uk").body, /Симуляція/);
});

test("a simulated order lapses at its own time, and an unread book fills nothing", async (t) => {
  await aggServer(t, { balances: "balancesPaper", book: ["bookThin", "bookUnavailable", "bookCrossesPartly"] });
  const store = await linked(durableStore());
  const p = provider();
  const at = Date.now();
  const reviewed = await reviewLimitOrder(store, p, WALLET, { ...ASK, life: "1h" }, at, OFF);
  const id = reviewed.value.review.id;
  const placed = await placeLimitOrder(store, p, WALLET, id, at, OFF);
  assert.equal(placed.value.state, "accepted", "an unread book fills nothing rather than inventing a fill");
  assert.equal(placed.value.filledShares, 0);

  const lapsed = await syncLimitOrder(store, p, WALLET, id, at + 2 * 3_600_000, OFF);
  assert.equal(lapsed.value.state, "expired");
  assert.equal(lapsed.value.filledShares, 0, "past its time it fills nothing, whatever the book shows");
});

test("an order that stands until it is cancelled has no expiry, and the list keeps every order of the wallet", async (t) => {
  await aggServer(t, { balances: "balancesPaper" });
  const store = await linked(durableStore());
  const p = provider();
  const gtc = await reviewLimitOrder(store, p, WALLET, { ...ASK, life: "until_cancelled" }, Date.now(), OFF);
  assert.equal(gtc.value.review.expiresAt, null);
  assert.equal(gtc.value.review.timeInForce, "GTC");
  assert.match(gtc.value.review.checks.find((c) => c.id === "expiry").detail, /скасуєте/);
  await reviewLimitOrder(store, p, WALLET, ASK, Date.now(), OFF);
  const rows = await listLimitRecords(store, WALLET);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((r) => r.wallet === WALLET), true);
  assert.equal(await readLimitRecord(store, WALLET, "plim_not_an_id"), null);
});
