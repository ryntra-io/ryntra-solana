// Run from repo root: node --test lib/predictions/fee-ledger.test.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyWebhook } from "@agg-build/sdk/server";

import { createMemoryGuardStore } from "../guard/store.ts";
import { aggOrdersFetcher, parseOrdersPage, syncFeeLedger } from "./agg-orders.ts";
import { checkWebhookSignature, handleAggWebhook, readWebhookSecret, signWebhook, WEBHOOK_EVENTS_COLLECTION } from "./agg-webhook.ts";
import { applyAggOrder, applyLedgerEvent, buildTradeLine, estimatedAggShare, FEE_LEDGER_COLLECTION, ledgerTotals, readLedgerView } from "./fee-ledger.ts";

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const NOW_S = Math.floor(NOW / 1000);

/** A store whose claims hold across instances, as the deployment's database does. */
function durableStore() {
  return { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
}

function delivery(event, { id = `msg_${event.id}`, timestamp = String(NOW_S), secret = SECRET, signature } = {}) {
  const body = JSON.stringify(event);
  return new Request("https://ryntra.io/api/predictions/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature ?? signWebhook(secret, id, timestamp, body) },
    body,
  });
}

const deps = (store, extra = {}) => ({ secret: SECRET, store, now: () => NOW, ...extra });
const lineOf = (view, key) => view.lines.find((l) => l.tradeKey === key);

/* ---- the trade fixtures: what the webhooks say, and what the order list says ---- */

const placed = (quoteId, id) => ({ id, type: "trades.placed", createdAt: "2026-10-18T11:59:00.000Z", data: { orderId: quoteId, userId: "usr_1", side: "yes", timestamp: "2026-10-18T11:59:00.000Z", externalId: "ryntra:solana:wallet" } });
const filled = (orderId, status, filledAmountRaw, id, timestamp = "2026-10-18T11:59:30.000Z") => ({ id, type: "trades.filled", createdAt: timestamp, data: { orderId, userId: "usr_1", status, timestamp, externalId: null, filledAmountRaw } });
const reconciled = (over = {}, id = "evt_rec") => ({
  id,
  type: "trades.fee_reconciled",
  createdAt: "2026-10-18T12:00:05.000Z",
  data: {
    dagRunId: "run_s", quoteId: "quote_s", userId: "usr_1",
    orders: [{ orderId: "s1", externalId: null }, { orderId: "s2", externalId: null }],
    status: "confirmed", feeDueRaw: "300000", feeCollectedRaw: "300000", appShareRaw: "246000", platformShareRaw: "54000",
    chainId: "137", tokenSymbol: "USDC.e", tokenAddress: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", appTxHash: "0xaa", platformTxHash: null, timestamp: "2026-10-18T12:00:05.000Z",
    ...over,
  },
});

function order(id, over = {}) {
  const { fees, ...rest } = over;
  return {
    id,
    quoteId: `quote_${id}`,
    dagRunId: `run_${id}`,
    externalId: null,
    userId: "usr_1",
    venue: "polymarket",
    status: "filled",
    side: "buy",
    amountRaw: "100000000",
    orderType: "market",
    filledAmountRaw: "100000000",
    updatedAt: "2026-10-18T12:00:00.000Z",
    fees: {
      venueFeeBasis: "fill",
      quoted: { venueFeeRaw: null, appFeeRaw: "300000", appFeeBips: 30, referralFeeRaw: null },
      actual: { dagRunId: `run_${id}`, venueFeeRaw: null, appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, bridge: null, referral: null },
      ...fees,
    },
    ...rest,
  };
}

/** Six trades, one of each kind the ledger has to tell apart, as `GET /apps/{appId}/orders` returns them. */
const ORDERS = [
  /* $100 bought, nobody invited: 30 bps → $0.30, AGG $0.06, Ryntra $0.24. */
  order("a"),
  /* $100 bought by a friend's invitee: 24 + 6 bps → $0.24 fee, AGG $0.048, Ryntra $0.192; the friend's $0.06 comes from the person. */
  order("b", { fees: { quoted: { appFeeRaw: "240000", appFeeBips: 24, referralFeeRaw: "60000" }, actual: { appFee: { bips: 24, dueRaw: "240000", collectedRaw: "240000", status: "confirmed" }, referral: { referrer: "0x1111111111111111111111111111111111111111", payer: "user", feeBips: 6, dueRaw: "60000", paidRaw: "60000", status: "confirmed" } } } }),
  /* $100 bought through an ambassador: 20 + 10 bps → $0.20, AGG $0.04, Ryntra $0.16. */
  order("c", { fees: { quoted: { appFeeRaw: "200000", appFeeBips: 20, referralFeeRaw: "100000" }, actual: { appFee: { bips: 20, dueRaw: "200000", collectedRaw: "200000", status: "confirmed" }, referral: { referrer: "0x2222222222222222222222222222222222222222", payer: "user", feeBips: 10, dueRaw: "100000", paidRaw: "100000", status: "confirmed" } } } }),
  /* Inside «0 % for the first 30 days»: no fee, no inviter. */
  order("d", { fees: { quoted: { appFeeRaw: "0", appFeeBips: 0, referralFeeRaw: null }, actual: { appFee: { bips: 0, dueRaw: "0", collectedRaw: "0", status: "skipped_zero" }, referral: null } } }),
  /* Half of $100 filled: the fee is on the filled half. */
  order("e", { status: "partial_fill", filledAmountRaw: "50000000", fees: { actual: { appFee: { bips: 30, dueRaw: "150000", collectedRaw: "150000", status: "confirmed" }, referral: null } } }),
  /* Cancelled before any fill: no fee. */
  order("f", { status: "cancelled", filledAmountRaw: "0", fees: { actual: { appFee: { bips: 30, dueRaw: "0", collectedRaw: "0", status: "skipped_zero" }, referral: null } } }),
];

const WEBHOOKS = [
  placed("quote_a", "evt_pa"), filled("a", "filled", "100000000", "evt_fa"),
  placed("quote_b", "evt_pb"), filled("b", "filled", "100000000", "evt_fb"),
  placed("quote_c", "evt_pc"), filled("c", "filled", "100000000", "evt_fc"),
  placed("quote_d", "evt_pd"), filled("d", "filled", "100000000", "evt_fd"),
  placed("quote_e", "evt_pe"), filled("e", "partial_fill", "50000000", "evt_fe"),
  placed("quote_f", "evt_pf"),
];

function pages(list, size = 4) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push({ data: list.slice(i, i + size), nextCursor: `cur_${i + size}`, hasMore: i + size < list.length });
  return out;
}

function fetchFrom(pageList) {
  const asked = [];
  const fetchPage = async (cursor) => {
    asked.push(cursor);
    const index = cursor === null ? 0 : pageList.findIndex((p, i) => i > 0 && pageList[i - 1].nextCursor === cursor);
    return parseOrdersPage(pageList[index] ?? { data: [], nextCursor: cursor, hasMore: false });
  };
  return { fetchPage, asked };
}

/* ------------------------------------------------------------------ */
/* The signature                                                       */
/* ------------------------------------------------------------------ */

test("our signature is the aggregator's own: its SDK verifies what signWebhook produces", () => {
  const body = JSON.stringify(placed("quote_x", "evt_x"));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { "webhook-id": "msg_x", "webhook-timestamp": timestamp, "webhook-signature": signWebhook(SECRET, "msg_x", timestamp, body) };
  assert.doesNotThrow(() => verifyWebhook(body, headers, SECRET));
  assert.equal(checkWebhookSignature({ secret: SECRET, id: "msg_x", timestamp, signature: headers["webhook-signature"], body, nowSeconds: Number(timestamp) }), "ok");
  /* Over bytes or over the same text, the signature is one. */
  assert.equal(signWebhook(SECRET, "msg_x", timestamp, new TextEncoder().encode(body)), headers["webhook-signature"]);
});

test("a signature is refused when the body, the id, the time or the secret is not the one signed", () => {
  const body = '{"id":"evt","type":"trades.placed","data":{}}';
  const t = String(NOW_S);
  const good = signWebhook(SECRET, "msg", t, body);
  const check = (over) => checkWebhookSignature({ secret: SECRET, id: "msg", timestamp: t, signature: good, body, nowSeconds: NOW_S, ...over });
  assert.equal(check({}), "ok");
  assert.equal(check({ body: body.replace("placed", "filled") }), "invalid");
  assert.equal(check({ id: "msg2" }), "invalid");
  assert.equal(check({ signature: signWebhook(`whsec_${randomBytes(24).toString("base64")}`, "msg", t, body) }), "invalid");
  assert.equal(check({ signature: good.replace("v1,", "v2,") }), "invalid");
  assert.equal(check({ signature: null }), "missing_headers");
  assert.equal(check({ timestamp: "12abc" }), "invalid");
  /* While a secret rotates several signatures arrive; one matching is enough. */
  assert.equal(check({ signature: `v1,AAAA ${good}` }), "ok");
  /* More than five minutes off either way is a replay or a broken clock. */
  assert.equal(check({ nowSeconds: NOW_S + 301 }), "stale");
  assert.equal(check({ nowSeconds: NOW_S - 301 }), "stale");
  assert.equal(check({ nowSeconds: NOW_S + 300 }), "ok");
  /* A forged signature is «invalid» whatever its time: the window is read only after the signature holds. */
  assert.equal(check({ signature: "v1,AAAA", nowSeconds: NOW_S + 999 }), "invalid");
});

/* ------------------------------------------------------------------ */
/* The route                                                           */
/* ------------------------------------------------------------------ */

test("without the signing secret the route says it is not configured and takes nothing", async () => {
  const store = durableStore();
  const saved = process.env.AGG_WEBHOOK_SECRET;
  delete process.env.AGG_WEBHOOK_SECRET;
  try {
    assert.equal(readWebhookSecret(), null);
  } finally {
    if (saved !== undefined) process.env.AGG_WEBHOOK_SECRET = saved;
  }
  assert.equal(readWebhookSecret({ AGG_WEBHOOK_SECRET: "  " }), null);
  /* The external-id signing secret is a different key and does not stand in for it. */
  assert.equal(readWebhookSecret({ AGG_APP_SECRET: "abcd" }), null);
  assert.equal(readWebhookSecret({ AGG_WEBHOOK_SECRET: " whsec_abc " }), "whsec_abc");
  const response = await handleAggWebhook(delivery(placed("quote_a", "evt_pa")), deps(store, { secret: null }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /not configured/);
  assert.deepEqual(await store.collection(WEBHOOK_EVENTS_COLLECTION).valuesWithPrefix(""), []);
  assert.deepEqual(await store.versioned(FEE_LEDGER_COLLECTION).valuesWithPrefix(""), []);
});

test("a store whose claims do not hold across instances is refused: it could not take each delivery once", async () => {
  assert.equal((await handleAggWebhook(delivery(placed("quote_a", "evt_pa")), deps(createMemoryGuardStore()))).status, 503);
  const singleWriter = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  assert.equal((await handleAggWebhook(delivery(placed("quote_a", "evt_pa")), deps(singleWriter))).status, 503);
});

test("a correct webhook is recorded with its data and reaches the ledger", async () => {
  const store = durableStore();
  const response = await handleAggWebhook(delivery(filled("a", "filled", "100000000", "evt_fa")), deps(store));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, duplicate: false });
  const recorded = await store.collection(WEBHOOK_EVENTS_COLLECTION).get("msg_evt_fa");
  assert.deepEqual([recorded.state, recorded.type, recorded.ledger, recorded.data.orderId], ["applied", "trades.filled", "applied", "a"]);
  /* A fill with no trade known yet is shown on its own, not counted as a trade. */
  const view = await readLedgerView(store);
  assert.deepEqual(view.lines, []);
  assert.deepEqual(view.unlinked, [{ orderId: "a", userId: "usr_1", status: "filled", filledRaw: "100000000", at: "2026-10-18T11:59:30.000Z" }]);
  assert.equal(ledgerTotals(view).unlinkedOrders, 1);
});

test("an account event keeps no data, so no email is stored", async () => {
  const store = durableStore();
  const event = { id: "evt_acc", type: "accounts.created", createdAt: "2026-10-18T12:00:00.000Z", data: { userId: "usr_1", appId: "app", createdAt: "2026-10-18T12:00:00.000Z", email: "person@example.com" } };
  assert.equal((await handleAggWebhook(delivery(event), deps(store))).status, 200);
  const recorded = await store.collection(WEBHOOK_EVENTS_COLLECTION).get("msg_evt_acc");
  assert.deepEqual([recorded.data, recorded.ledger], [null, "ignored"]);
});

test("an event type the ledger does not know is answered 200 and left alone, so the aggregator does not send it again", async () => {
  const store = durableStore();
  for (const [i, type] of ["markets.resolved", "deposits.confirmed", "wallets.ready", "something.new_kind"].entries()) {
    const response = await handleAggWebhook(delivery({ id: `evt_other_${i}`, type, createdAt: "2026-10-18T12:00:00.000Z", data: { userId: "usr_1" } }), deps(store));
    assert.equal(response.status, 200, type);
    assert.deepEqual(await response.json(), { received: true, duplicate: false });
    assert.equal((await store.collection(WEBHOOK_EVENTS_COLLECTION).get(`msg_evt_other_${i}`)).ledger, "ignored");
  }
  assert.deepEqual(await store.versioned(FEE_LEDGER_COLLECTION).valuesWithPrefix(""), []);
});

test("the order list is read on a schedule: the deployment's cron calls the ledger every hour", () => {
  const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons;
  assert.deepEqual(crons.filter((cron) => cron.path === "/api/predictions/webhooks/ledger"), [{ path: "/api/predictions/webhooks/ledger", schedule: "23 * * * *" }]);
});

test("a forged webhook is refused and leaves no trace", async () => {
  const store = durableStore();
  const forged = await handleAggWebhook(delivery(filled("a", "filled", "100000000", "evt_fa"), { secret: `whsec_${randomBytes(24).toString("base64")}` }), deps(store));
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).error.code, "SIGNATURE_INVALID");
  /* A body changed after signing. */
  const event = filled("a", "filled", "100000000", "evt_fa");
  const signed = delivery(event);
  const tampered = new Request(signed.url, { method: "POST", headers: signed.headers, body: JSON.stringify({ ...event, data: { ...event.data, filledAmountRaw: "999000000" } }) });
  assert.equal((await handleAggWebhook(tampered, deps(store))).status, 401);
  /* No signature at all. */
  const bare = new Request(signed.url, { method: "POST", body: JSON.stringify(event) });
  assert.equal((await handleAggWebhook(bare, deps(store))).status, 401);
  assert.deepEqual(await store.collection(WEBHOOK_EVENTS_COLLECTION).valuesWithPrefix(""), []);
  assert.deepEqual(await store.versioned(FEE_LEDGER_COLLECTION).valuesWithPrefix(""), []);
});

test("a repeated webhook takes no second effect, and an old one replayed outside the window is refused", async () => {
  const store = durableStore();
  const first = await handleAggWebhook(delivery(filled("e", "partial_fill", "50000000", "evt_fe")), deps(store));
  assert.deepEqual(await first.json(), { received: true, duplicate: false });
  const again = await handleAggWebhook(delivery(filled("e", "partial_fill", "50000000", "evt_fe")), deps(store));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  /* The same event under a new message id (the operator's replay) still counts once in the ledger. */
  const replay = await handleAggWebhook(delivery(filled("e", "partial_fill", "50000000", "evt_fe"), { id: "msg_replayed" }), deps(store));
  assert.equal(replay.status, 200);
  const stored = await store.versioned(FEE_LEDGER_COLLECTION).get("order:e");
  assert.deepEqual(stored.events, ["evt_fe"]);
  /* Captured and sent again ten minutes later. */
  const late = await handleAggWebhook(delivery(filled("e", "filled", "100000000", "evt_late"), { timestamp: String(NOW_S - 600) }), deps(store));
  assert.equal(late.status, 401);
  assert.match((await late.json()).error.message, /time window/);
  assert.equal((await readLedgerView(store)).unlinked[0].filledRaw, "50000000");
});

test("a delivery whose recording fails is answered 5xx so the aggregator sends it again, and the retry applies once", async () => {
  const store = durableStore();
  const real = store.versioned.bind(store);
  let fail = true;
  const flaky = { ...store, versioned: (name) => { const c = real(name); return { ...c, compareAndSet: async (...a) => { if (fail) throw new Error("db down"); return c.compareAndSet(...a); } }; } };
  const first = await handleAggWebhook(delivery(filled("a", "filled", "100000000", "evt_fa")), deps(flaky));
  assert.equal(first.status, 500);
  assert.equal((await store.collection(WEBHOOK_EVENTS_COLLECTION).get("msg_evt_fa")).state, "received");
  fail = false;
  const retry = await handleAggWebhook(delivery(filled("a", "filled", "100000000", "evt_fa")), deps(flaky));
  assert.equal(retry.status, 200);
  const stored = await store.versioned(FEE_LEDGER_COLLECTION).get("order:a");
  assert.deepEqual(stored.events, ["evt_fa"]);
  assert.equal((await store.collection(WEBHOOK_EVENTS_COLLECTION).get("msg_evt_fa")).state, "applied");
});

/** A delivery signed with the endpoint's secret, whatever its body. */
function signedRaw(id, body) {
  const t = String(NOW_S);
  return new Request("https://ryntra.io/api/predictions/webhooks", { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": t, "webhook-signature": signWebhook(SECRET, id, t, body) }, body });
}

test("a signed delivery the receiver cannot read as an event is still answered 200 and kept aside, so the aggregator does not send it again", async () => {
  const store = durableStore();
  /* What a dashboard test may look like: a type without a dot, no data, no id — or a body that is not an object at all. */
  const bodies = [
    ["msg_t1", JSON.stringify({ type: "webhook.test", data: { message: "hello" } })],
    ["msg_t2", JSON.stringify({ type: "ping" })],
    ["msg_t3", JSON.stringify({ eventType: "Test", payload: { ok: true } })],
    ["msg_t4", JSON.stringify({ id: "evt_t4", type: "Trade.Placed-Test", createdAt: 1, data: [1, 2] })],
    ["msg_t5", "[1,2,3]"],
    ["msg_t6", "not json"],
  ];
  for (const [id, body] of bodies) {
    const response = await handleAggWebhook(signedRaw(id, body), deps(store));
    assert.equal(response.status, 200, `${id}: ${body}`);
    const kept = await store.collection(WEBHOOK_EVENTS_COLLECTION).get(id);
    assert.equal(kept.state, "applied");
    assert.equal(kept.ledger, "ignored");
  }
  const deliveries = store.collection(WEBHOOK_EVENTS_COLLECTION);
  assert.deepEqual([(await deliveries.get("msg_t1")).type, (await deliveries.get("msg_t1")).raw], ["webhook.test", null]);
  assert.deepEqual([(await deliveries.get("msg_t2")).type, (await deliveries.get("msg_t2")).eventId], ["ping", "msg_t2"]);
  assert.deepEqual([(await deliveries.get("msg_t3")).type, (await deliveries.get("msg_t3")).raw], ["unreadable", bodies[2][1]]);
  assert.equal((await deliveries.get("msg_t5")).raw, "[1,2,3]");
  assert.equal((await deliveries.get("msg_t6")).raw, "not json");
  /* None of them touches the fee ledger. */
  assert.deepEqual(await store.versioned(FEE_LEDGER_COLLECTION).valuesWithPrefix(""), []);
  /* The same test sent again is a repeat, not a second record. */
  assert.deepEqual(await (await handleAggWebhook(signedRaw("msg_t1", bodies[0][1]), deps(store))).json(), { received: true, duplicate: true });
});

test("a trade event whose data is missing is taken and ignored, not applied", async () => {
  const store = durableStore();
  const response = await handleAggWebhook(signedRaw("msg_empty", JSON.stringify({ id: "evt_empty", type: "trades.filled" })), deps(store));
  assert.equal(response.status, 200);
  assert.equal((await store.collection(WEBHOOK_EVENTS_COLLECTION).get("msg_empty")).ledger, "ignored");
  assert.deepEqual(await store.versioned(FEE_LEDGER_COLLECTION).valuesWithPrefix(""), []);
});

test("an oversized delivery is refused", async () => {
  const store = durableStore();
  const id = "msg_bad", t = String(NOW_S);
  const big = "x".repeat(300_000);
  const huge = new Request("https://ryntra.io/api/predictions/webhooks", { method: "POST", headers: { "webhook-id": id, "webhook-timestamp": t, "webhook-signature": signWebhook(SECRET, id, t, big) }, body: big });
  assert.equal((await handleAggWebhook(huge, deps(store))).status, 413);
});

/* ------------------------------------------------------------------ */
/* The ledger against the order list                                   */
/* ------------------------------------------------------------------ */

test("the ledger built from the webhooks and the order list agrees with the order list on every trade", async () => {
  const store = durableStore();
  for (const event of WEBHOOKS) assert.equal((await handleAggWebhook(delivery(event), deps(store))).status, 200);
  const { fetchPage, asked } = fetchFrom(pages(ORDERS));
  const sync = await syncFeeLedger(store, fetchPage, { now: () => "2026-10-18T12:00:00.000Z" });
  assert.deepEqual(sync, { pages: 2, orders: 6, hasMore: false, stopped: null, unreadable: 0 });
  assert.deepEqual(asked, [null, "cur_4"]);

  const view = await readLedgerView(store);
  assert.equal(view.lines.length, 6);
  assert.deepEqual(view.unlinked, []);
  for (const line of view.lines) assert.equal(line.reconciliation, "matched", `${line.tradeKey}: ${line.issues.join(", ")}`);

  /* Each line's fee is exactly the order list's collected fee, and the placement is joined to it. */
  for (const o of ORDERS) {
    const line = lineOf(view, `r:${o.dagRunId}`);
    assert.equal(line.feeCollectedRaw, o.fees.actual.appFee.collectedRaw);
    assert.deepEqual([line.quoteId, line.outcomeSide], [o.quoteId, "yes"]);
  }

  const a = lineOf(view, "r:run_a");
  assert.deepEqual([a.outcome, a.feeBips, a.feeCollectedRaw, a.aggShareRaw, a.netRyntraRaw, a.referral, a.zeroWindow], ["filled", 30, "300000", "60000", "240000", null, false]);
  const b = lineOf(view, "r:run_b");
  assert.deepEqual([b.feeBips, b.feeCollectedRaw, b.aggShareRaw, b.netRyntraRaw, b.referral.kind, b.referral.paidRaw], [24, "240000", "48000", "192000", "friend", "60000"]);
  const c = lineOf(view, "r:run_c");
  assert.deepEqual([c.feeBips, c.aggShareRaw, c.netRyntraRaw, c.referral.kind], [20, "40000", "160000", "ambassador"]);
  const d = lineOf(view, "r:run_d");
  assert.deepEqual([d.zeroWindow, d.feeCollectedRaw, d.netRyntraRaw, d.referral], [true, "0", "0", null]);
  const e = lineOf(view, "r:run_e");
  assert.deepEqual([e.outcome, e.filledRaw, e.feeCollectedRaw, e.netRyntraRaw], ["partial", "50000000", "150000", "120000"]);
  const f = lineOf(view, "r:run_f");
  assert.deepEqual([f.outcome, f.filledRaw, f.feeCollectedRaw, f.netRyntraRaw], ["cancelled", "0", "0", "0"]);
  for (const line of view.lines) assert.deepEqual(line.issues, []);

  const totals = ledgerTotals(view);
  assert.equal(totals.trades, 6);
  assert.deepEqual(totals.byOutcome, { placed: 0, open: 0, filled: 4, partial: 1, cancelled: 1, failed: 0 });
  assert.equal(totals.feeCollectedRaw, String(300000 + 240000 + 200000 + 0 + 150000));
  assert.equal(totals.aggShareRaw, String(60000 + 48000 + 40000 + 30000));
  assert.equal(totals.netRyntraRaw, String(240000 + 192000 + 160000 + 120000));
  assert.equal(totals.referralPaidRaw, "160000");
  assert.equal(totals.zeroWindow, 1);
  assert.equal(totals.withReferral, 2);
  assert.deepEqual(totals.reconciliation, { matched: 6, differs: 0, awaiting_orders: 0 });

  /* The next pass starts where this one stopped. */
  const next = [];
  await syncFeeLedger(store, async (cursor) => { next.push(cursor); return parseOrdersPage({ data: [], nextCursor: "cur_8", hasMore: false }); });
  assert.deepEqual(next, ["cur_8"]);
});

test("a placed quote with no run yet is a trade waiting for its fill", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, placed("quote_w", "evt_pw"));
  const view = await readLedgerView(store);
  assert.deepEqual([view.lines.length, view.lines[0].tradeKey, view.lines[0].outcome, view.lines[0].reconciliation], [1, "q:quote_w", "placed", "awaiting_orders"]);
});

test("a fill the webhook and the order list report differently is shown, not settled by picking one", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, filled("a", "filled", "100000000", "evt_fa"));
  await applyAggOrder(store, order("a", { status: "partial_fill", filledAmountRaw: "60000000" }));
  const [line] = (await readLedgerView(store)).lines;
  assert.equal(line.reconciliation, "differs");
  assert.deepEqual(line.issues, ["status_differs:a", "filled_differs:a"]);
  /* The order list is the truth for the money on the line. */
  assert.equal(line.filledRaw, "60000000");
});

test("a self-custody trade's final fee names the aggregator's share, and a split trade is one line", async () => {
  const store = durableStore();
  assert.equal((await handleAggWebhook(delivery(reconciled()), deps(store))).status, 200);
  let view = await readLedgerView(store);
  assert.deepEqual([view.lines.length, view.lines[0].reconciliation], [1, "awaiting_orders"]);
  const split = { quoteId: "quote_s", dagRunId: "run_s", filledAmountRaw: "50000000", fees: { actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, referral: null } } };
  await applyAggOrder(store, order("s1", split));
  await applyAggOrder(store, order("s2", { ...split, venue: "limitless" }));
  view = await readLedgerView(store);
  assert.equal(view.lines.length, 1);
  const [line] = view.lines;
  assert.deepEqual(line.orderIds.slice().sort(), ["s1", "s2"]);
  assert.deepEqual(line.venues.slice().sort(), ["limitless", "polymarket"]);
  assert.equal(line.filledRaw, "100000000");
  /* The fee repeats on both orders and is counted once. */
  assert.equal(line.feeCollectedRaw, "300000");
  assert.deepEqual([line.aggShareSource, line.aggShareRaw, line.netRyntraRaw], ["reported", "54000", "246000"]);
  assert.equal(line.reconciliation, "matched");
});

test("an order the list shows without its quote still joins the run the final fee named — one line, the fee once", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, placed("quote_s", "evt_ps"));
  await applyLedgerEvent(store, reconciled());
  const runOnly = { quoteId: null, dagRunId: "run_s", filledAmountRaw: "50000000", fees: { actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, referral: null } } };
  await applyAggOrder(store, order("s1", runOnly));
  await applyAggOrder(store, order("s2", runOnly));
  const view = await readLedgerView(store);
  assert.equal(view.lines.length, 1);
  assert.deepEqual([view.lines[0].quoteId, view.lines[0].outcomeSide, view.lines[0].reconciliation], ["quote_s", "yes", "matched"]);
  assert.equal(ledgerTotals(view).feeCollectedRaw, "300000");
});

test("an order whose run the list and the final fee name differently is flagged", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, reconciled({ orders: [{ orderId: "s1", externalId: null }] }));
  await applyAggOrder(store, order("s1", { quoteId: "quote_s", dagRunId: "run_other" }));
  const view = await readLedgerView(store);
  const line = lineOf(view, "r:run_other");
  assert.ok(line.issues.includes("run_differs:s1"));
  assert.equal(line.reconciliation, "differs");
});

test("a quote that ran twice is two trades, each with its own fee", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, placed("quote_q", "evt_pq"));
  await applyAggOrder(store, order("q1", { quoteId: "quote_q", dagRunId: "run_1", status: "failed", filledAmountRaw: "0", fees: { actual: { appFee: { bips: 30, dueRaw: "0", collectedRaw: "0", status: "skipped_zero" }, referral: null } } }));
  await applyAggOrder(store, order("q2", { quoteId: "quote_q", dagRunId: "run_2" }));
  const view = await readLedgerView(store);
  assert.deepEqual(view.lines.map((l) => [l.tradeKey, l.outcome, l.feeCollectedRaw]).sort(), [["r:run_1", "failed", "0"], ["r:run_2", "filled", "300000"]]);
  assert.equal(ledgerTotals(view).feeCollectedRaw, "300000");
});

test("a final fee delivered out of order does not replace a later one", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, reconciled({}, "evt_late_confirmed"));
  await applyLedgerEvent(store, reconciled({ status: "failed", feeCollectedRaw: "0", appShareRaw: "0", platformShareRaw: "0", timestamp: "2026-10-18T12:00:01.000Z" }, "evt_early_failed"));
  const [line] = (await readLedgerView(store)).lines;
  assert.deepEqual([line.feeStatus, line.feeCollectedRaw, line.netRyntraRaw], ["confirmed", "300000", "246000"]);
});

test("a final fee without its shares falls back to the 20 % estimate and says so; shares that do not add up are flagged", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, reconciled({ appShareRaw: undefined, platformShareRaw: undefined }));
  let [line] = (await readLedgerView(store)).lines;
  assert.deepEqual([line.aggShareSource, line.aggShareRaw, line.netRyntraRaw], ["estimated", "60000", "240000"]);
  assert.ok(line.issues.includes("hook_fee_incomplete"));
  const other = durableStore();
  await applyLedgerEvent(other, reconciled({ appShareRaw: "290000", platformShareRaw: "54000" }));
  [line] = (await readLedgerView(other)).lines;
  assert.ok(line.issues.includes("shares_do_not_add_up"));
});

test("a fill redelivered with the same time never takes a full fill back to a partial one", async () => {
  const store = durableStore();
  await applyLedgerEvent(store, filled("t", "filled", "100000000", "evt_t2"));
  await applyLedgerEvent(store, filled("t", "partial_fill", "50000000", "evt_t1"));
  assert.equal((await readLedgerView(store)).unlinked[0].status, "filled");
});

test("the fee rules are checked on every line: an inviter in the 0 % window, a wrong rate, an inviter Ryntra paid, a fee on a sell", async () => {
  const ref = (feeBips, payer = "user") => ({ referrer: "0x3333333333333333333333333333333333333333", payer, feeBips, dueRaw: "60000", paidRaw: "60000", status: "confirmed" });
  const line = (over) => {
    const o = order("x", over);
    const api = { status: o.status, side: o.side, venue: o.venue, quoteId: o.quoteId, dagRunId: o.dagRunId, paper: false, amountRaw: o.amountRaw, filledAmountRaw: o.filledAmountRaw, quotedAppFeeBips: o.fees.quoted.appFeeBips, updatedAt: o.updatedAt };
    return buildTradeLine(
      { kind: "trade", version: 1, tradeKey: "r:run_x", quoteId: "quote_x", dagRunId: "run_x", userId: null, orderIds: ["x"], hookFee: null, apiFee: o.fees.actual.appFee, referral: o.fees.actual.referral, apiFeeAt: o.updatedAt, events: [] },
      [{ kind: "order", version: 1, orderId: "x", hookRun: null, userId: null, externalId: null, hook: { status: null, filledAmountRaw: null, at: null }, api, events: [] }],
    );
  };
  assert.deepEqual(line({ fees: { quoted: { appFeeBips: 0 }, actual: { appFee: { bips: 0, dueRaw: "0", collectedRaw: "0", status: "skipped_zero" }, referral: ref(6) } } }).issues, ["referral_in_zero_window"]);
  assert.deepEqual(line({ fees: { quoted: { appFeeBips: 30 }, actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, referral: ref(6) } } }).issues, ["fee_split_off_policy"]);
  assert.deepEqual(line({ fees: { quoted: { appFeeBips: 22 }, actual: { appFee: { bips: 22, dueRaw: "220000", collectedRaw: "220000", status: "confirmed" }, referral: ref(8) } } }).issues, ["referral_rate_off_policy"]);
  const paid = line({ fees: { quoted: { appFeeBips: 24 }, actual: { appFee: { bips: 24, dueRaw: "240000", collectedRaw: "240000", status: "confirmed" }, referral: ref(6, "app") } } });
  assert.deepEqual(paid.issues, ["referral_paid_by_ryntra"]);
  /* What Ryntra paid the inviter comes off its line: 0.24 − 0.048 − 0.06. */
  assert.equal(paid.netRyntraRaw, "132000");
  assert.deepEqual(line({ side: "sell", fees: { quoted: { appFeeBips: 10 }, actual: { appFee: { bips: 10, dueRaw: "100000", collectedRaw: "100000", status: "confirmed" }, referral: null } } }).issues, ["fee_on_sell"]);
  assert.deepEqual(line({ fees: { quoted: { appFeeBips: 30 }, actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "100000", status: "under_collected" }, referral: null } } }).issues, ["fee_under_collected"]);
  /* A sell at 0 is the rule, not the 0 % window. */
  const sell = line({ side: "sell", fees: { quoted: { appFeeBips: 0 }, actual: { appFee: { bips: 0, dueRaw: "0", collectedRaw: "0", status: "skipped_zero" }, referral: null } } });
  assert.deepEqual([sell.zeroWindow, sell.issues], [false, []]);
});

test("paper orders stay on the ledger as lines but never in the money", async () => {
  const store = durableStore();
  await applyAggOrder(store, order("p", { orderType: undefined }));
  await applyAggOrder(store, order("a"));
  const view = await readLedgerView(store);
  assert.equal(lineOf(view, "r:run_p").paper, true);
  const totals = ledgerTotals(view);
  assert.deepEqual([totals.trades, totals.paper, totals.feeCollectedRaw, totals.netRyntraRaw], [2, 1, "300000", "240000"]);
});

test("an older snapshot read late rolls back neither the order nor its trade's fee", async () => {
  const store = durableStore();
  const shared = { quoteId: "quote_m", dagRunId: "run_m" };
  await applyAggOrder(store, order("m2", { ...shared, updatedAt: "2026-10-18T12:05:00.000Z" }));
  /* The other order of the same run, read from an older page: fee still pending, nothing collected. */
  await applyAggOrder(store, order("m1", { ...shared, status: "open", filledAmountRaw: "0", updatedAt: "2026-10-18T12:00:00.000Z", fees: { actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "0", status: "pending" }, referral: null } } }));
  /* The first order itself, read again from that older page. */
  await applyAggOrder(store, order("m2", { ...shared, status: "open", filledAmountRaw: "0", updatedAt: "2026-10-18T12:01:00.000Z", fees: { actual: { appFee: { bips: 30, dueRaw: "300000", collectedRaw: "0", status: "pending" }, referral: null } } }));
  const line = lineOf(await readLedgerView(store), "r:run_m");
  assert.deepEqual([line.feeCollectedRaw, line.feeStatus], ["300000", "confirmed"]);
  const m2 = await store.versioned(FEE_LEDGER_COLLECTION).get("order:m2");
  assert.equal(m2.api.status, "filled");
});

test("the aggregator's estimated share is 20 % rounded up, so Ryntra's line is never overstated", () => {
  assert.equal(estimatedAggShare(300000n), 60000n);
  assert.equal(estimatedAggShare(3n), 1n);
  assert.equal(estimatedAggShare(0n), 0n);
});

test("the order list is read with the server key only, and a deployment without one reads nothing", async () => {
  assert.equal(aggOrdersFetcher({ appId: "app", apiKey: null, appSecret: null, baseUrl: "https://api.agg.market", wsUrl: "" }), null);
  assert.equal(aggOrdersFetcher({ appId: null, apiKey: "k", appSecret: null, baseUrl: "https://api.agg.market", wsUrl: "" }), null);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), key: init.headers["x-app-api-key"] }); return Response.json({ data: [order("a"), { id: 7 }], nextCursor: "cur_1", hasMore: false }); };
  const fetchPage = aggOrdersFetcher({ appId: "app id", apiKey: "k", appSecret: null, baseUrl: "https://api.agg.market", wsUrl: "" }, fetchImpl);
  const page = await fetchPage("cur_0");
  assert.equal(calls[0].url, "https://api.agg.market/apps/app%20id/orders?limit=100&cursor=cur_0");
  assert.equal(calls[0].key, "k");
  assert.deepEqual([page.orders.length, page.unreadable, page.nextCursor], [1, [{ id: 7 }], "cur_1"]);
  const failing = aggOrdersFetcher({ appId: "app", apiKey: "k", appSecret: null, baseUrl: "https://api.agg.market", wsUrl: "" }, async () => new Response("{}", { status: 401 }));
  await assert.rejects(failing(null), /401/);
});

test("an order the ledger cannot read is kept in quarantine and counted, and the pass moves on", async () => {
  const store = durableStore();
  const bad = { id: "bad", status: "filled", filledAmountRaw: 5 };
  const first = await syncFeeLedger(store, async () => parseOrdersPage({ data: [order("a"), bad], nextCursor: "cur_1", hasMore: false }));
  assert.deepEqual([first.stopped, first.unreadable], [null, 1]);
  const kept = await store.versioned(FEE_LEDGER_COLLECTION).get("unreadable:bad");
  assert.deepEqual(JSON.parse(kept.raw), bad);
  const asked = [];
  await syncFeeLedger(store, async (cursor) => { asked.push(cursor); return parseOrdersPage({ data: [], nextCursor: null, hasMore: false }); });
  assert.deepEqual(asked, ["cur_1"]);
  const view = await readLedgerView(store);
  assert.equal(lineOf(view, "r:run_a").feeCollectedRaw, "300000");
  assert.equal(ledgerTotals(view).unreadableOrders, 1);
});

for (const listFirst of [true, false]) {
  test(`an order the list shows without its run counts its fee once with the run its final fee names (${listFirst ? "list first" : "final fee first"})`, async () => {
    const store = durableStore();
    const runless = order("x", { quoteId: null, dagRunId: null, fees: { actual: { dagRunId: null, appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, referral: null } } });
    const fee = reconciled({ dagRunId: "run_r", quoteId: "quote_r", orders: [{ orderId: "x", externalId: null }] });
    if (listFirst) {
      await applyAggOrder(store, runless);
      await applyLedgerEvent(store, fee);
    } else {
      await applyLedgerEvent(store, fee);
      await applyAggOrder(store, runless);
    }
    const view = await readLedgerView(store);
    assert.deepEqual(view.lines.map((l) => l.tradeKey), ["r:run_r"]);
    assert.equal(view.lines[0].reconciliation, "matched", view.lines[0].issues.join(", "));
    assert.equal(ledgerTotals(view).feeCollectedRaw, "300000");
  });
}

test("the run the list names inside the fee stands in for a missing top-level one", async () => {
  const store = durableStore();
  await applyAggOrder(store, order("y", { dagRunId: null, fees: { actual: { dagRunId: "run_inner", appFee: { bips: 30, dueRaw: "300000", collectedRaw: "300000", status: "confirmed" }, referral: null } } }));
  assert.deepEqual((await readLedgerView(store)).lines.map((l) => l.tradeKey), ["r:run_inner"]);
});

test("a pass that finds the cursor moved by another pass stops instead of setting it back", async () => {
  const store = durableStore();
  let raced = false;
  const fetchPage = async (cursor) => {
    if (!raced) {
      raced = true;
      /* Another pass moves the cursor while this one reads. */
      await syncFeeLedger(store, async () => parseOrdersPage({ data: [], nextCursor: "cur_far", hasMore: false }));
    }
    return parseOrdersPage({ data: [], nextCursor: cursor === null ? "cur_near" : "cur_x", hasMore: true });
  };
  const sync = await syncFeeLedger(store, fetchPage);
  assert.equal(sync.stopped, "cursor_moved_elsewhere");
  const asked = [];
  await syncFeeLedger(store, async (cursor) => { asked.push(cursor); return parseOrdersPage({ data: [], nextCursor: null, hasMore: false }); });
  assert.deepEqual(asked, ["cur_far"]);
});

test("a page that says «more» without moving the cursor ends the pass instead of looping", async () => {
  const store = durableStore();
  let calls = 0;
  const sync = await syncFeeLedger(store, async () => { calls += 1; return parseOrdersPage({ data: [], nextCursor: null, hasMore: true }); });
  assert.equal(calls, 1);
  assert.deepEqual([sync.hasMore, sync.stopped], [true, "cursor_did_not_move"]);
});
