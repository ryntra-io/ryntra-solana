import { test } from "node:test";
import assert from "node:assert/strict";

import { changeAcross, changeOver, frameOf, pathsOf, pointsOf, RANGE_ASK, RANGES, timeLabels } from "./chart.ts";
import { readDetail, readSettle, tradable } from "./detail.ts";
import { createPredictEngine } from "./engine.ts";
import { marketsOf } from "./markets.ts";
import { failureWords, readFunding, readLive, readOrder, readReview, readWithdrawPreview, realBuyRefusal, REAL_REFUSAL, usdcRaw, withdrawReason } from "./real.ts";
import { chartBody, discoverBody, discoverEvents, eventBody, fundingBody, liveBody, quoteBody } from "./test-fixtures.mjs";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const WALLET = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";
const HOUR = 3_600_000;

test("a market's page reads the event: the card's market, its live sides, and the venue's rules behind Details", () => {
  const card = marketsOf(discoverEvents(NOW), NOW).find((m) => m.eventId === "ev-btc");
  const detail = readDetail(eventBody("ev-btc", { now: NOW, yes: 0.61 }), card);
  assert.equal(detail.marketId, "ev-btc-m", "the market the card priced, not the event's first");
  assert.deepEqual(detail.sides.map((s) => [s.label, s.p]), [["Yes", 0.61], ["No", 0.39]]);
  assert.equal(detail.binary, true);
  assert.match(detail.rules, /23:59 UTC/);
  assert.match(detail.settlement, /above \$120,000/);
  assert.equal(detail.status, "open");
  assert.equal(tradable(detail, NOW), true);
  assert.equal(tradable({ ...detail, status: "resolved" }, NOW), false);
  assert.equal(tradable({ ...detail, closes: new Date(NOW - 1).toISOString() }, NOW), false);
  assert.equal(readDetail({ event: { id: "x", markets: [] } }), null, "an event with no priced market has no page");
  assert.equal(readDetail(null), null);
  assert.equal(readDetail({ error: { code: "NOT_FOUND" } }), null);
  const settled = readSettle(eventBody("ev-btc", { now: NOW, winner: "ev-btc-yes", status: "resolved" }));
  assert.deepEqual(settled.markets.find((m) => m.id === "ev-btc-m").outcomes.filter((o) => o.winner).map((o) => o.id), ["ev-btc-yes"]);
});

test("the chance over time: points in order, the day's change, a frame in whole tens, a line to draw", () => {
  const points = pointsOf(chartBody("ev-btc-yes", NOW));
  assert.equal(points.length, 288);
  assert.ok(points.every((p, i) => i === 0 || p.t > points[i - 1].t));
  const day = changeOver(points, 24, NOW);
  assert.ok(day > 4 && day < 8, `+${day} points today`);
  assert.equal(changeAcross(points), Math.round((points.at(-1).p - points[0].p) * 1000) / 10);
  const frame = frameOf(points);
  assert.ok(frame.low <= Math.min(...points.map((p) => p.p)) && frame.high >= Math.max(...points.map((p) => p.p)));
  assert.ok(frame.high - frame.low >= 0.2 - 1e-9);
  assert.ok(frame.ticks.length >= 3);
  const paths = pathsOf(points, frame, 600, 200);
  assert.match(paths.line, /^M0\.0 /);
  assert.ok(paths.end.x === 600);
  assert.equal(timeLabels(points, "1D").length, 5);
  assert.deepEqual(RANGES, ["1D", "1W", "1M", "ALL"]);
  for (const r of RANGES) assert.ok(["5m", "1h", "1d"].includes(RANGE_ASK[r].resolution) && RANGE_ASK[r].countBack <= 500, "every pill asks what the engine serves");
});

test("an empty or odd history says so: no points, no change, no line", () => {
  assert.deepEqual(pointsOf({ chart: { bars: [] } }), []);
  assert.equal(pointsOf({ error: { code: "NOT_FOUND" } }), null);
  assert.equal(pointsOf(null), null);
  assert.deepEqual(pointsOf({ chart: { bars: [{ t: 1, c: 58 }, { t: 2, c: 0.6 }, { t: 3, c: 7 }, { t: "x", c: 0.5 }, { t: 4, c: -1 }] } }).map((p) => p.p), [0.58, 0.6, 0.07], "cents read as a chance, nonsense left out");
  assert.equal(changeOver([], 24, NOW), null);
  assert.equal(changeOver([{ t: NOW - HOUR, p: 0.5 }, { t: NOW, p: 0.6 }], 24 * 7, NOW), null, "an hour of history says nothing of a week");
  assert.deepEqual(pathsOf([], frameOf([]), 100, 100), { line: "", area: "", end: null });
});

test("Practice vs Real: a real buy is asked for only where live trading is open, within the cap and the balance", () => {
  const live = readLive(liveBody(WALLET));
  const base = { spendUsd: 10, access: live.access, available: live.available, tradable: true };
  assert.equal(realBuyRefusal(base), null);
  assert.equal(realBuyRefusal({ ...base, access: null }), "access");
  assert.equal(realBuyRefusal({ ...base, access: { ...live.access, state: "off" } }), "access");
  assert.equal(realBuyRefusal({ ...base, access: { ...live.access, state: "app_paper" } }), "access", "a provider app on paper has no real-money path");
  assert.equal(realBuyRefusal({ ...base, access: { ...live.access, state: "unknown" } }), "access");
  assert.equal(realBuyRefusal({ ...base, spendUsd: 0.5 }), "min");
  assert.equal(realBuyRefusal({ ...base, spendUsd: 26 }), "max", "above today's cap for one order");
  assert.equal(realBuyRefusal({ ...base, available: 5 }), "cash");
  assert.equal(realBuyRefusal({ ...base, tradable: false }), "closed");
  assert.equal(realBuyRefusal({ ...base, spendUsd: 0 }), "amount");
  for (const why of Object.values(REAL_REFUSAL)) assert.ok(why.length < 50, `short: ${why}`);
});

test("the live account reads its balance and positions; a side held on two venues is not sold as one", () => {
  const live = readLive(liveBody(WALLET));
  assert.equal(live.access.state, "open");
  assert.equal(live.access.maxOrderUsd, 25);
  assert.equal(live.linked, true);
  assert.equal(live.available, 1240);
  assert.equal(live.positions.length, 2);
  const [btc, sol] = live.positions;
  assert.equal(btc.pnl, 324.55);
  assert.equal(btc.pct, 24.3, "against the cost the engine's own figures give");
  assert.deepEqual(btc.sell, { outcomeId: "ev-btc-yes", marketId: "ev-btc-m" });
  assert.equal(sol.sell, null);
  const off = readLive(liveBody(WALLET, { state: "off" }));
  assert.equal(off.access.state, "off");
  assert.equal(off.linked, null);
  assert.deepEqual(off.positions, []);
  const unlinked = readLive(liveBody(WALLET, { linked: false }));
  assert.equal(unlinked.linked, false);
  assert.equal(unlinked.available, null, "no balance read is no balance, never zero");
  for (const bad of [null, {}, { wallet: WALLET }]) assert.equal(readLive(bad), null);
});

test("funding: the deposit address only when live money is on; withdrawals by their state", () => {
  const on = readFunding(fundingBody(WALLET));
  assert.equal(on.deposit.state, "ready");
  assert.equal(on.deposit.address, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  assert.equal(on.available, 1240);
  assert.equal(readFunding(fundingBody(WALLET, { enabled: false })).deposit.state, "off");
  assert.equal(readFunding({ ...fundingBody(WALLET), deposit: { state: "ready", address: "not-an-address" } }).deposit.state, "failed");
  assert.equal(readFunding(null), null);
  assert.equal(usdcRaw("10"), "10000000");
  assert.equal(usdcRaw("$2.5"), "2500000");
  assert.equal(usdcRaw("1,000.25"), "1000250000");
  assert.equal(usdcRaw("0"), null);
  assert.equal(usdcRaw("1.1234567"), null, "more than six decimals is refused, never rounded");
  assert.equal(usdcRaw("abc"), null);
  const preview = readWithdrawPreview({ preview: { status: "quoted", amountRaw: "10000000", receiveRaw: "9770000", feeRaw: "230000", reason: null } });
  assert.equal(preview.quoted, true);
  assert.equal(readWithdrawPreview({ preview: { status: "unviable", amountRaw: "500000", receiveRaw: null, feeRaw: null, reason: "below_minimum" } }).reason, "below_minimum");
  assert.equal(withdrawReason("below_minimum"), "At least $1.");
  assert.equal(readWithdrawPreview({}), null);
});

test("a Review is read only as a live one with its figures; an order by its state", () => {
  const review = readReview(quoteBody(WALLET, { spend: 10, price: 0.58 }));
  assert.equal(review.live, true);
  assert.equal(review.side, "buy");
  assert.equal(review.label, "Yes");
  assert.equal(review.price, 0.58);
  assert.equal(review.totalUsd, 10.03);
  assert.equal(review.feesUsd, 0.03);
  assert.equal(review.toWinUsd, 17.24);
  assert.equal(review.canPlace, true);
  assert.equal(readReview(quoteBody(WALLET, { mode: "paper" })).live, false, "a paper Review says it is paper");
  assert.equal(readReview(quoteBody(WALLET, { canPlace: false })).canPlace, false);
  assert.equal(readReview({ review: { quoteId: "q" } }), null);
  assert.deepEqual(readOrder({ order: { quoteId: "q", state: "filled" } }), { quoteId: "q", state: "filled" });
  assert.equal(readOrder({ order: { quoteId: "q", state: "weird" } }), null);
});

test("the engine's failures are said shortly; its own text never reaches the screen", () => {
  for (const code of ["NETWORK", "TIMEOUT", "UNAUTHORIZED", "NOT_LINKED", "RATE_LIMITED", "CHALLENGE_REQUIRED", "QUOTE_EXPIRED", "ORDER_REFUSED", "FUNDING_OFF", "WITHDRAWAL_OPEN", "SOMETHING_NEW"]) {
    const words = failureWords(code);
    assert.ok(words.length > 0 && words.length < 60, words);
    assert.doesNotMatch(words, /[A-Z]{3,}_|api|engine|route|http/i, `${code}: no technical word`);
  }
});

test("the engine is asked only on Predictions' own routes; an empty, failed or odd answer is a failure, never a fake", async () => {
  const asked = [];
  const answers = new Map();
  const fetchImpl = async (url, init) => {
    asked.push(`${init.method} ${url}`);
    const a = answers.get(url.split("?")[0]) ?? { status: 503, body: { error: { code: "PROVIDER_UNAVAILABLE", message: "down" } } };
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => (a.body === undefined ? Promise.reject(new Error("cut")) : a.body) };
  };
  const engine = createPredictEngine(fetchImpl);
  answers.set("/api/predictions/discover", { status: 200, body: discoverBody(NOW, { category: "crypto" }) });
  const listed = await engine.discover("crypto");
  assert.equal(listed.ok, true);
  assert.ok(listed.value.events.every((e) => e.categories.some((c) => c.slug === "crypto")));
  assert.match(asked.at(-1), /^GET \/api\/predictions\/discover\?sort=volume24h&limit=40&category=crypto$/);
  const down = await engine.event("ev-btc");
  assert.deepEqual(down, { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "down" } });
  answers.set("/api/predictions/events/ev-btc", { status: 200, body: { nothing: true } });
  assert.equal((await engine.event("ev-btc")).failure.code, "BAD_SHAPE");
  answers.set("/api/predictions/events/ev-btc", { status: 200, body: undefined });
  assert.equal((await engine.event("ev-btc")).failure.code, "NETWORK", "a body cut off is no answer");
  assert.equal((await engine.event("../x")).failure.code, "VALIDATION_ERROR");
  assert.equal((await engine.discover("bad slug!")).failure.code, "VALIDATION_ERROR");
  answers.set("/api/predictions/outcomes/ev-btc-yes/chart", { status: 200, body: chartBody("ev-btc-yes", NOW) });
  assert.equal((await engine.chart("ev-btc-yes", "1W")).value.length, 288);
  assert.match(asked.at(-1), /resolution=1h&countBack=168$/);
  answers.set("/api/predictions/orders", { status: 202, body: { order: { quoteId: "q", state: "submitted" } } });
  assert.equal((await engine.place("q")).ok, true, "202 is the engine still waiting on the fill");
  await engine.quote({ eventId: "ev-btc", venueMarketId: "ev-btc-m", outcomeId: "ev-btc-yes", side: "buy", spendUsd: 10, locale: "en", mode: "live" });
  await engine.live();
  await engine.funding();
  await engine.linkStart();
  await engine.withdrawPreview({ max: true });
  await engine.withdrawal("not-a-uuid");
  for (const call of asked) assert.match(call, /^(GET|POST) \/api\/predictions\//, `${call}: Predictions' own routes only`);
});
