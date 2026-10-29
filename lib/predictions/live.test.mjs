// Run from repo root: node --test lib/predictions/live.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { getPredictionProvider, resetAggAdapterCache } from "./agg/adapter.ts";
import { applyAggOrder, readLedgerView } from "./fee-ledger.ts";
import { checkWithdrawal, previewWithdrawal, readFunding, submitWithdrawal } from "./funding-account.ts";
import { LIVE_MAX_USD_DEFAULT, liveVenuesFor, liveWalletAllowed, readLiveAccess, readLiveSettings, venuesOutside } from "./live.ts";
import { cancellable, cancelOrder, placePaper, quotePaper, readPaperAccount, readPaperOrder, syncPaperOrder } from "./paper.ts";
import { listRedeemReceipts, redeemable, redeemPositions } from "./redeem.ts";
import { writeLink } from "./session.ts";
import { seal } from "./vault.ts";

/*
 * The live pilot's path, replayed against the aggregator's answers
 * (`fixtures/agg-live.json` for orders, `fixtures/agg-funding.json` for the
 * money): a deposit seen, a real-money Review, a fill that fills in part, the
 * rest cancelled, the fee ledger reconciled against the Review, the market
 * settled and the win collected, the money withdrawn — every step with its
 * Review or its receipt. The real adapter and SDK talk to a local server
 * that answers as the aggregator does; nothing leaves this machine.
 */

const LIVE = JSON.parse(readFileSync(new URL("./fixtures/agg-live.json", import.meta.url), "utf8"));
const MONEY = JSON.parse(readFileSync(new URL("./fixtures/agg-funding.json", import.meta.url), "utf8"));
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SECRET = "test-secret-of-sufficient-length";
process.env.BETA_TOKEN_SECRET = SECRET;
const ON = { PREDICTIONS_LIVE_FUNDING: "on", PREDICTIONS_LIVE_WALLETS: WALLET, PREDICTIONS_LIVE_VENUES: "polymarket", BETA_TOKEN_SECRET: SECRET };
const UUID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

const EVENT = {
  id: "ev1",
  title: "Will the test pass?",
  subtitle: null,
  image: null,
  status: "open",
  venue: "polymarket",
  venues: ["polymarket", "kalshi"],
  volume: 1000,
  endDate: "2027-01-01T00:00:00.000Z",
  categories: [],
  marketCount: 1,
  aggKey: null,
  structureType: null,
  arbReturn: null,
  leading: [{ id: "o-yes", label: "Yes", probability: 0.4, venueMarketId: "m1" }],
  description: null,
  startDate: null,
  markets: [
    {
      id: "m1",
      venue: "polymarket",
      question: "Will the test pass?",
      status: "open",
      outcomes: [
        { id: "o-yes", label: "Yes", probability: 0.4, venueMarketId: "m1", winner: null, matched: [] },
        { id: "o-no", label: "No", probability: 0.6, venueMarketId: "m1", winner: null, matched: [] },
      ],
      volume: 1000,
      endDate: "2027-01-01T00:00:00.000Z",
      resolutionDate: null,
      rules: { primary: "Resolves Yes if the test passes.", secondary: null },
      tickSize: 0.01,
      minOrderSize: null,
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

/** The real adapter, with the event read from the fixture (the event read is not the money path). */
function provider() {
  const real = getPredictionProvider();
  return { ...real, event: async (id) => (id === EVENT.id ? { ok: true, value: EVENT } : { ok: false, code: "NOT_FOUND", message: "no such event" }) };
}

/**
 * The aggregator, answering from the fixtures. `script` names the answer per
 * call kind; a list is answered in turn (its last answer repeats); a
 * function decides from what was seen so far. `"drop"` closes the socket
 * without an answer.
 */
async function aggServer(t, script = {}) {
  const seen = [];
  const plan = {
    config: "appConfigLive",
    route: "routeLive",
    fill: "fillAccepted",
    status: "statusWorking",
    orders: "ordersLive",
    cancel: "cancelAccepted",
    positionsActive: "positionsActiveNone",
    positionsClosed: "positionsClosedWon",
    redeem: "redeemSubmitted",
    balances: "balancesLive",
    preview: "withdrawPreviewQuoted",
    withdraw: "withdrawAccepted",
    withdrawal: "withdrawalCompleted",
    ...script,
  };
  const queues = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const answerFor = (kind) => {
    const q = queues[kind];
    if (typeof q === "function") return q(seen);
    if (Array.isArray(q)) return q.length > 1 ? q.shift() : q[0];
    return q;
  };
  const ahead = (s) => new Date(Date.now() + s * 1000).toISOString();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://agg");
      const body = raw ? JSON.parse(raw) : null;
      const query = {};
      for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
      seen.push({ method: request.method, path: url.pathname, query, body });
      const p = url.pathname;
      const kind =
        request.method === "GET" && p === "/app/config" ? "config"
        : request.method === "GET" && /^\/orderbook\/[^/]+\/route$/.test(p) ? "route"
        : request.method === "POST" && p === "/execution/fill" ? "fill"
        : request.method === "GET" && p === "/execution/status" ? "status"
        : request.method === "GET" && p === "/execution/orders" ? "orders"
        : request.method === "POST" && p === "/execution/orders/cancel" ? "cancel"
        : request.method === "GET" && p === "/execution/positions" ? (query.status === "closed" ? "positionsClosed" : "positionsActive")
        : request.method === "POST" && p === "/execution/redeem" ? "redeem"
        : request.method === "GET" && p === "/execution/balances" ? "balances"
        : request.method === "GET" && p === "/execution/deposit-addresses" ? "addresses"
        : request.method === "GET" && p === "/users/activity" ? "activity"
        : request.method === "POST" && p === "/execution/withdraw/preview" ? "preview"
        : request.method === "POST" && p === "/execution/withdraw" ? "withdraw"
        : request.method === "GET" && p.startsWith("/execution/withdrawals/") ? "withdrawal"
        : request.method === "GET" && p === "/me" ? "profile"
        : null;
      const key = kind === "addresses" ? "depositAddresses" : kind === "activity" ? "activityDeposits" : kind === "profile" ? null : kind ? answerFor(kind) : null;
      if (key === "drop") {
        request.socket.destroy();
        return;
      }
      const answer = key === null ? { status: 404, body: { message: "not here" } } : (LIVE[key] ?? MONEY[key]);
      response.statusCode = answer.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer.body).split("{{expires}}").join(ahead(60)).split("{{refresh}}").join(ahead(20)).split("{{destination}}").join(body?.destinationAddress ?? WALLET));
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
  return { seen, calls, fills: () => calls("POST", "/execution/fill"), routes: () => seen.filter((s) => s.path.endsWith("/route")) };
}

const quoteId = (quoted) => quoted.value.review.quoteId;
const ASK = { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 2, locale: "uk", mode: "live" };

/* ------------------------------------------------------------------ the settings */

test("live is off unless money is on, the wallet is listed and a venue is named; the cap is $5 unless set", () => {
  assert.equal(liveWalletAllowed(WALLET, {}), false);
  assert.equal(liveWalletAllowed(WALLET, { PREDICTIONS_LIVE_WALLETS: WALLET }), false, "a listed wallet without money switched on");
  assert.equal(liveWalletAllowed(WALLET, ON), true);
  assert.equal(liveWalletAllowed(OTHER, ON), false);
  assert.equal(liveWalletAllowed(OTHER, { ...ON, PREDICTIONS_LIVE_WALLETS: "*" }), true);
  assert.equal(liveWalletAllowed("0xabc", { ...ON, PREDICTIONS_LIVE_WALLETS: "*" }), false, "only Solana wallets");
  assert.deepEqual(liveVenuesFor(WALLET, { ...ON, PREDICTIONS_LIVE_VENUES: "" }), []);
  assert.deepEqual(liveVenuesFor(WALLET, { ...ON, PREDICTIONS_LIVE_VENUES: " Polymarket , limitless,polymarket, ,bad venue" }), ["polymarket", "limitless"]);
  assert.deepEqual(liveVenuesFor(OTHER, ON), []);
  assert.equal(readLiveSettings({}).maxOrderUsd, LIVE_MAX_USD_DEFAULT);
  assert.equal(readLiveSettings({ PREDICTIONS_LIVE_MAX_USD: "2.5" }).maxOrderUsd, 2.5);
  assert.equal(readLiveSettings({ PREDICTIONS_LIVE_MAX_USD: "0.5" }).maxOrderUsd, 0, "below a dollar closes live, never raises the cap");
  assert.equal(readLiveSettings({ PREDICTIONS_LIVE_MAX_USD: "five" }).maxOrderUsd, 0);
  assert.deepEqual(liveVenuesFor(WALLET, { ...ON, PREDICTIONS_LIVE_MAX_USD: "0" }), [], "a cap of nothing is no live order");
  assert.equal(readLiveSettings({ PREDICTIONS_LIVE_MAX_USD: "999999" }).maxOrderUsd, 10_000);
  assert.deepEqual(venuesOutside(["Polymarket", "kalshi"], ["polymarket"]), ["kalshi"]);
});

test("live access reads the provider's app mode only for a wallet live is open to", async (t) => {
  const agg = await aggServer(t, { config: ["appConfigPaper", "appConfigLive"] });
  const p = provider();
  assert.deepEqual(await readLiveAccess(p, OTHER, ON), { state: "off", venues: [], maxOrderUsd: 5, appMode: null });
  assert.equal(agg.calls("GET", "/app/config").length, 0, "nothing of the provider read for a wallet live is not open to");
  assert.equal((await readLiveAccess(p, WALLET, ON)).state, "app_paper");
  assert.deepEqual(await readLiveAccess(p, WALLET, ON), { state: "open", venues: ["polymarket"], maxOrderUsd: 5, appMode: "live" });
});

/* ------------------------------------------------------------------ the whole pilot */

test("the pilot end to end: deposit → live Review → part filled → rest cancelled → fee ledger agrees → settled → collected → withdrawn", async (t) => {
  let cancelled = false;
  const agg = await aggServer(t, { status: () => (cancelled ? "statusPartialCancelled" : "statusWorking"), cancel: () => ((cancelled = true), "cancelAccepted") });
  const store = await linked(durableStore());
  const p = provider();

  /* 1. Deposit: the Solana address and the balance as the provider states them. */
  const funding = await readFunding(store, p, WALLET, ON);
  assert.equal(funding.ok, true);
  assert.equal(funding.value.enabled, true);
  assert.equal(funding.value.deposit.state, "ready");
  assert.equal(funding.value.deposits.length > 0, true, "the deposit is listed with its state");
  assert.equal(funding.value.balance.availableUsd > 2, true);

  /* 2. The real-money Review: said on the first line, priced only on the open venue, nothing placed. */
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  assert.equal(quoted.ok, true, quoted.message);
  const review = quoted.value.review;
  assert.equal(review.mode, "live");
  assert.deepEqual(review.checks[0], { id: "mode", state: "pass", detail: review.checks[0].detail, figure: "live" });
  assert.match(review.checks[0].detail, /Справжні гроші/);
  assert.equal(review.checks.find((c) => c.id === "live_venues").state, "pass");
  assert.equal(review.canPlace, true, review.blockedBy.join(","));
  assert.equal(review.balance.cashBalance, funding.value.balance.availableUsd, "the Review is judged on the spendable live balance");
  assert.equal(review.costs.ryntra.bips, 30);
  assert.equal(review.checks.find((c) => c.id === "slippage").figure, "2%");
  const [route] = agg.routes();
  assert.equal(route.query.mode, "live");
  assert.equal(route.query.allowedVenues, "polymarket");
  assert.equal(route.query.deepEstimate, "true", "every cost of a live buy, one-time setup included");
  assert.equal(route.query.slipCapBps, "200");
  assert.deepEqual(agg.calls("GET", "/execution/balances").map((c) => c.query.mode), ["live", "live"]);
  assert.equal(agg.fills().length, 0, "a Review places nothing");

  /* 3. Placed: exactly the reviewed quote, in live mode, no re-pricing fallback; it fills in part and keeps working. */
  const placed = await placePaper(store, p, WALLET, review.quoteId, Date.now(), ON);
  assert.equal(placed.ok, true, placed.message);
  const [fill] = agg.fills();
  assert.deepEqual(fill.body, { quoteId: "q_live_1", mode: "live" });
  assert.equal(placed.value.state, "submitted");
  assert.equal(placed.value.execution.orders[0].status, "partially_filled_open");
  assert.equal(placed.value.execution.orders[0].actualShares, 2.45);
  assert.equal(agg.calls("GET", "/execution/status").every((c) => c.query.mode === "live"), true);
  assert.equal(cancellable(placed.value), true);

  /* 4. The rest cancelled by the person; the part filled stays filled. */
  const after = await cancelOrder(store, p, WALLET, review.quoteId);
  assert.equal(after.ok, true, after.message);
  assert.deepEqual(agg.calls("POST", "/execution/orders/cancel").map((c) => c.body), [{ orderId: "ord_live_1" }]);
  assert.equal(after.value.state, "partially_filled");
  assert.equal(after.value.execution.orders[0].actualShares, 2.45);
  assert.equal(cancellable(after.value), false);
  const again = await cancelOrder(store, p, WALLET, review.quoteId);
  assert.equal(again.code, "ORDER_REFUSED", "nothing left to cancel");

  /* 5. The fee ledger, from the provider's own order list, agrees with the Review: 30 bps, on the half that filled. */
  await applyAggOrder(store, LIVE.appOrderLive);
  const ledger = await readLedgerView(store);
  const line = ledger.lines.find((l) => l.quoteId === "q_live_1");
  assert.ok(line, "the live trade has its ledger line");
  assert.equal(line.paper, false);
  assert.equal(line.feeBips, review.costs.ryntra.bips);
  assert.equal(line.filledRaw, "980000");
  assert.equal(line.feeCollectedRaw, String((980000n * 30n) / 10000n));
  assert.ok(Number(line.feeCollectedRaw) / 1e6 <= review.costs.ryntra.usd + 1e-9, "never more than the Review said");

  /* 6. Settled: the live account shows the resolved win the provider marks payable; collecting it keeps a receipt. */
  const account = await readPaperAccount(store, p, WALLET, "live");
  assert.equal(account.orders.length, 1, "only live records in the live account");
  assert.equal(account.orders[0].state, "partially_filled");
  const payable = redeemable([...account.positions, ...account.closedPositions]);
  assert.deepEqual(payable.map((r) => r.outcomeId), ["o-yes"]);
  const receipt = await redeemPositions(store, p, WALLET, ["o-yes"], ON);
  assert.equal(receipt.ok, true, receipt.message);
  assert.deepEqual(agg.calls("POST", "/execution/redeem").map((c) => c.body), [{ venueMarketOutcomeIds: ["o-yes"], mode: "live" }]);
  assert.equal(receipt.value.legs[0].status, "submitted");
  assert.equal(receipt.value.legs[0].txHash, "0xabc123def4567890");
  assert.equal((await listRedeemReceipts(store, WALLET)).length, 1);
  assert.equal((await readPaperAccount(store, p, WALLET, "paper")).orders.length, 0, "the paper account holds no live record");

  /* 7. Withdrawn into the person's own Solana wallet: Review (preview), send, delivered. */
  const preview = await previewWithdrawal(store, p, WALLET, { amountRaw: "5000000" }, ON);
  assert.equal(preview.ok, true);
  assert.equal(preview.value.receiveRaw, "4770000");
  const sent = await submitWithdrawal(store, p, WALLET, { requestId: UUID, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.value.outcome, "recorded");
  const [send] = agg.calls("POST", "/execution/withdraw");
  assert.equal(send.body.destinationAddress, WALLET);
  const done = await checkWithdrawal(store, p, WALLET, UUID, ON);
  assert.equal(done.ok, true);
  assert.equal(done.value.phase, "completed");
});

/* ------------------------------------------------------------------ the refusals */

test("a wallet live is not open to, or a paper app, gets no live Review and no provider route", async (t) => {
  const agg = await aggServer(t, { config: "appConfigPaper" });
  const store = await linked(durableStore(), OTHER);
  const closed = await quotePaper(store, provider(), OTHER, ASK, Date.now(), ON);
  assert.equal(closed.code, "FORBIDDEN");
  const own = await linked(durableStore());
  const paperApp = await quotePaper(own, provider(), WALLET, ASK, Date.now(), ON);
  assert.equal(paperApp.code, "FORBIDDEN");
  assert.match(paperApp.message, /paper only/);
  assert.equal(agg.routes().length, 0);
  /* No new money for the unlisted wallet: no deposit address is asked for. */
  const money = await readFunding(store, provider(), OTHER, ON);
  assert.equal(money.value.deposit.state, "off");
  assert.equal(agg.calls("GET", "/execution/deposit-addresses").length, 0);
});

test("a wallet off the list that holds nothing here sees money switched off", async (t) => {
  LIVE.balancesEmpty = { status: 200, body: { cash: [], positions: [] } };
  t.after(() => delete LIVE.balancesEmpty);
  await aggServer(t, { balances: "balancesEmpty" });
  const store = await linked(durableStore(), OTHER);
  const money = await readFunding(store, provider(), OTHER, ON);
  assert.equal(money.value.enabled, false);
});

test("a live Review refuses a route that fills on a closed venue, an amount over the cap, and an unread balance", async (t) => {
  const agg = await aggServer(t, { route: ["routeLiveOutside", "routeLive", "routeLive"], balances: ["balancesLive", "balancesLive", "drop"] });
  const store = await linked(durableStore());
  const p = provider();
  const outside = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  assert.equal(outside.value.review.canPlace, false);
  assert.deepEqual(outside.value.review.blockedBy, ["live_venues"]);
  assert.equal(outside.value.review.checks.find((c) => c.id === "live_venues").figure, "kalshi");
  const placedOutside = await placePaper(store, p, WALLET, outside.value.review.quoteId, Date.now(), ON);
  assert.equal(placedOutside.code, "ORDER_REFUSED");

  const over = await quotePaper(store, p, WALLET, { ...ASK, spendUsd: 6 }, Date.now(), ON);
  assert.ok(over.value.review.blockedBy.includes("amount"));
  assert.match(over.value.review.checks.find((c) => c.id === "amount").detail, /\$5\.00/);

  /* A quote id is reviewed once: the same route answered again goes to a store of its own. */
  const unread = await quotePaper(await linked(durableStore()), p, WALLET, ASK, Date.now(), ON);
  assert.ok(unread.value.review.blockedBy.includes("balance"), "a live order never stands on a balance nobody read");
  assert.equal(agg.fills().length, 0);
});

test("between Review and fill: live switched off, or the quote too old, places nothing", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  assert.equal(quoted.value.review.canPlace, true);
  const off = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), { ...ON, PREDICTIONS_LIVE_WALLETS: "" });
  assert.equal(off.code, "FORBIDDEN");
  const lowered = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), { ...ON, PREDICTIONS_LIVE_MAX_USD: "1" });
  assert.equal(lowered.code, "ORDER_REFUSED");
  const old = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now() + 5 * 60_000, ON);
  assert.equal(old.code, "QUOTE_EXPIRED");
  assert.equal(agg.fills().length, 0);
});

test("a live fill with no answer is recorded as sent and read back by its quote — never offered again as a fresh order", async (t) => {
  const agg = await aggServer(t, { fill: "drop", status: ["drop", "statusPartialCancelled"] });
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  const placed = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(placed.ok, true, placed.message);
  assert.equal(placed.value.state, "submitted", "not reviewed again: it may have reached the venues");
  const second = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(second.value.quoteId, quoted.value.review.quoteId);
  assert.equal(agg.fills().length, 1, "one send only");
});

test("paper stays paper: no mode asked is a paper Review priced in paper mode on every venue", async (t) => {
  const agg = await aggServer(t, { route: "routeLiveOutside" });
  const store = await linked(durableStore());
  const { mode: _mode, ...paperAsk } = ASK;
  const quoted = await quotePaper(store, provider(), WALLET, paperAsk, Date.now(), ON);
  assert.equal(quoted.value.review.mode, "paper");
  assert.equal(quoted.value.review.checks[0].figure, "paper");
  const [route] = agg.routes();
  assert.equal(route.query.mode, "paper");
  assert.equal(route.query.allowedVenues, undefined);
  assert.equal(agg.calls("GET", "/app/config").length, 0, "a paper Review does not ask the app's mode");
});

test("collecting only what the provider marks payable, and only while money is on", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const p = provider();
  const made = await redeemPositions(store, p, WALLET, ["o-made-up"], ON);
  assert.equal(made.code, "ORDER_REFUSED");
  const closed = await redeemPositions(store, p, WALLET, ["o-yes"], { ...ON, PREDICTIONS_LIVE_FUNDING: "" });
  assert.equal(closed.code, "FUNDING_OFF");
  assert.equal(agg.calls("POST", "/execution/redeem").length, 0);
});

/* ------------------------------------------------------------------ one send per Review */

test("two places of one Review at once send it once; the loser gets the record as it stands", async (t) => {
  const agg = await aggServer(t, { status: "statusPartialCancelled" });
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  const [a, b] = await Promise.all([placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON), placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON)]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(agg.fills().length, 1, "one send only");
  const record = await readPaperOrder(store, WALLET, quoted.value.review.quoteId);
  assert.equal(record.state, "partially_filled");
});

test("a fill answered with a conflict or a timeout is not a refusal: the record stays sent and is read back", async (t) => {
  const conflict = { status: 409, body: { message: "quote is already being executed" } };
  const agg = await aggServer(t, { fill: "conflict", status: "statusPartialCancelled" });
  LIVE.conflict = conflict;
  t.after(() => delete LIVE.conflict);
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  const placed = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(placed.ok, true, placed.message);
  assert.equal(placed.value.state, "partially_filled", "the provider's word, read by the quote");
  assert.equal(agg.fills().length, 1);
});

test("a fill refused before anything was created frees the Review; a quote refused marks it failed", async (t) => {
  LIVE.busy = { status: 429, body: { message: "Too many requests" } };
  LIVE.quoteGone = { status: 400, body: { message: "quote_not_found", code: "quote_not_found" } };
  t.after(() => {
    delete LIVE.busy;
    delete LIVE.quoteGone;
  });
  const agg = await aggServer(t, { fill: ["busy", "quoteGone"] });
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  const busy = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(busy.code, "RATE_LIMITED");
  assert.equal((await readPaperOrder(store, WALLET, quoted.value.review.quoteId)).state, "reviewed", "nothing was created: the same Review may be placed again");
  const gone = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(gone.code, "ORDER_REFUSED");
  assert.equal((await readPaperOrder(store, WALLET, quoted.value.review.quoteId)).state, "failed");
  assert.equal(agg.fills().length, 2);
});

test("a send that left no trace is called not received only after its quote can no longer run", async (t) => {
  LIVE.noSuch = { status: 404, body: { message: "no execution for this quote" } };
  LIVE.ordersEmpty = { status: 200, body: { data: [], nextCursor: null, hasMore: false } };
  t.after(() => {
    delete LIVE.noSuch;
    delete LIVE.ordersEmpty;
  });
  let listed = true;
  const agg = await aggServer(t, { fill: "drop", status: "noSuch", orders: () => (listed ? "ordersLive" : "ordersEmpty") });
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  const placed = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  assert.equal(placed.value?.state ?? (await readPaperOrder(store, WALLET, quoted.value.review.quoteId)).state, "submitted", "while the quote could still run, it waits");
  /* A late place never marks it expired over the send. */
  const late = await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now() + 10 * 60_000, ON);
  assert.equal(late.value.state, "submitted");
  /* Once the quote is past running, the provider's «no such execution» closes it. */
  const records = store.versioned("predictionOrders");
  const key = `solana:mainnet:${WALLET}:${quoted.value.review.quoteId}`;
  const now = await records.get(key);
  const past = { ...now, review: { ...now.review, route: { ...now.review.route, expiresAt: new Date(Date.now() - 5 * 60_000).toISOString() } }, version: now.version + 1 };
  assert.equal(await records.compareAndSet(key, now.version, past), true);
  /* The provider's own order list still holds an order of the quote: it reached the venues, whatever the status says. */
  const held = await syncPaperOrder(store, p, WALLET, quoted.value.review.quoteId);
  assert.equal(held.ok, false);
  assert.equal((await readPaperOrder(store, WALLET, quoteId(quoted))).state, "submitted");
  listed = false;
  const closed = await syncPaperOrder(store, p, WALLET, quoted.value.review.quoteId);
  assert.equal(closed.value.state, "failed");
  assert.equal(agg.fills().length, 1);
});

test("a cancel that fails on one order still reads back the others it cancelled", async (t) => {
  LIVE.cancelRefused = { status: 400, body: { message: "order already filled" } };
  t.after(() => delete LIVE.cancelRefused);
  let cancelled = false;
  const agg = await aggServer(t, { status: () => (cancelled ? "statusPartialCancelled" : "statusWorking"), cancel: () => ((cancelled = true), "cancelRefused") });
  const store = await linked(durableStore());
  const p = provider();
  const quoted = await quotePaper(store, p, WALLET, ASK, Date.now(), ON);
  await placePaper(store, p, WALLET, quoted.value.review.quoteId, Date.now(), ON);
  const after = await cancelOrder(store, p, WALLET, quoted.value.review.quoteId);
  assert.equal(after.ok, false, "the only cancel was refused");
  assert.equal((await readPaperOrder(store, WALLET, quoted.value.review.quoteId)).state, "partially_filled", "yet the order was read back");
  assert.equal(agg.calls("POST", "/execution/orders/cancel").length, 1);
});

test("an outcome held on two venues is collected at its value once, not twice", () => {
  const rows = redeemable([
    {
      eventId: "ev1",
      venueEventId: "ev1",
      question: "Q",
      image: null,
      marketStatus: "resolved",
      status: "closed",
      redeemStatus: "eligible",
      resolutionDate: null,
      outcomes: [{ label: "Yes", totalSize: 4, avgEntryPrice: 0.5, currentPrice: 1, totalValue: 4, unrealizedPnl: 2, unrealizedPnlPercent: 100, winner: true, venues: [{ venue: "polymarket", size: 3, venueMarketId: "m1", outcomeId: "o-a" }, { venue: "limitless", size: 1, venueMarketId: "m2", outcomeId: "o-b" }] }],
    },
  ]);
  assert.deepEqual(rows.map((r) => [r.outcomeId, r.valueUsd]), [["o-a", 3], ["o-b", 1]]);
});

test("money already held stays visible and withdrawable for a wallet off the list; a new deposit address is not shown", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore(), OTHER);
  const p = provider();
  const funding = await readFunding(store, p, OTHER, ON);
  assert.equal(funding.value.enabled, true, "it holds money here");
  assert.equal(funding.value.deposit.state, "off");
  assert.equal(agg.calls("GET", "/execution/deposit-addresses").length, 0);
  const preview = await previewWithdrawal(store, p, OTHER, { amountRaw: "5000000" }, ON);
  assert.equal(preview.ok, true);
  const off = await readFunding(store, p, OTHER, { ...ON, PREDICTIONS_LIVE_FUNDING: "" });
  assert.equal(off.value.enabled, false, "money switched off: nothing");
});
