import { test } from "node:test";
import assert from "node:assert/strict";

import { coverSrc, COVER_ROUTE, isCover } from "./cover.ts";
import { pickRow, readDetail } from "./detail.ts";
import { readLive, readReview } from "./real.ts";
import { blockedWords, doneNotice, practiceView, realView, reviewLine } from "./ticket.ts";
import { eventBody, fedEventBody, liveBody, quoteBody } from "./test-fixtures.mjs";

/*
 * The ticket's one orange button and the one line under it, in every state it can be in (CITY-77). Practice is taken at
 * once and never charges; real money goes wallet → proof → account → USDC → the engine's Review, whose fee and payout
 * stand in one line before anything is signed, → the order confirmed on it.
 */

const A = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";
const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const live = (opts) => readLive(liveBody(A, opts));
const review = (opts = {}) => readReview(quoteBody(A, { spend: 10, price: 0.58, expiresAt: new Date(NOW + 60_000).toISOString(), ...opts }));
const base = { action: "buy", sideLabel: "Yes", amount: 10, tradable: true, connected: true, connecting: false, walletName: "Phantom", opening: false, liveRead: "ready", live: live(), openError: null, trade: null, sellable: false, spread: false, now: NOW };

test("Practice: buy at once, no fee; a refusal says why under the button", () => {
  assert.deepEqual(practiceView({ action: "buy", sideLabel: "Yes", refusal: null, sellBack: null, held: false }), { label: "Buy Yes", act: "buy", disabled: false, waiting: false, note: "Practice · no fee", warn: false });
  const cash = practiceView({ action: "buy", sideLabel: "No", refusal: "cash", sellBack: null, held: false });
  assert.equal(cash.disabled, true);
  assert.equal(cash.note, "Not enough practice dollars.");
  assert.equal(cash.warn, true);
  assert.equal(practiceView({ action: "buy", sideLabel: null, refusal: "side", sellBack: null, held: false }).label, "Pick a side");
  assert.equal(practiceView({ action: "sell", sideLabel: "Yes", refusal: null, sellBack: null, held: false }).label, "Nothing to sell");
  const sell = practiceView({ action: "sell", sideLabel: "Yes", refusal: null, sellBack: 12.5, held: true });
  assert.equal(sell.label, "Sell Yes");
  assert.equal(sell.act, "sell");
  assert.equal(practiceView({ action: "sell", sideLabel: "Yes", refusal: null, sellBack: null, held: true }).disabled, true, "no fresh price, no sale");
});

test("Real: wallet, proof, account, USDC — each step is the one button", () => {
  assert.equal(realView({ ...base, connected: false }).act, "connect");
  assert.equal(realView({ ...base, connected: false, connecting: true }).label, "Connecting…");
  assert.deepEqual(
    (({ label, disabled, waiting }) => ({ label, disabled, waiting }))(realView({ ...base, opening: true })),
    { label: "Confirm in Phantom", disabled: true, waiting: true },
  );
  assert.equal(realView({ ...base, live: null, liveRead: "reading" }).label, "Reading your account…");
  const sign = realView({ ...base, live: null, openError: "Nothing was signed." });
  assert.equal(sign.act, "start");
  assert.equal(sign.note, "Nothing was signed.");
  assert.equal(realView({ ...base, live: live({ state: "off" }) }).label, "Real money opens soon");
  assert.equal(realView({ ...base, live: live({ linked: false }) }).label, "Open your account");
  assert.equal(realView({ ...base, live: live({ cash: 0.4 }) }).act, "deposit");
});

test("Real: the Review's fee and payout stand in one line before the signature", () => {
  const r = review();
  assert.equal(reviewLine(r), "Fee $0.03 · wins $17.24 · max loss $10.03");
  const v = realView({ ...base, trade: { step: "review", key: "k", review: r, ask: {} } });
  assert.equal(v.label, "Confirm · $10.03");
  assert.equal(v.act, "place");
  assert.equal(v.note, "Fee $0.03 · wins $17.24 · max loss $10.03");
  assert.equal(v.disabled, false);
  const placing = realView({ ...base, trade: { step: "placing", key: "k", review: r, ask: {} } });
  assert.deepEqual([placing.label, placing.disabled, placing.waiting], ["Placing…", true, true]);
  assert.equal(placing.note, reviewLine(r), "the line stays while the order goes");
});

test("Real: an old price asks again; a Review that will not place says why and cannot be confirmed", () => {
  const old = realView({ ...base, trade: { step: "review", key: "k", review: review({ expiresAt: new Date(NOW - 1).toISOString() }), ask: {} } });
  assert.equal(old.label, "Get a new price");
  assert.equal(old.act, "quote");
  const blocked = realView({ ...base, trade: { step: "review", key: "k", review: review({ canPlace: false }), ask: {} } });
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.note, "Not enough USDC for this order.");
  assert.equal(blockedWords(["live_venues"]), "Not open for real money here yet.");
});

test("Real: limits before the Review, and a failed ask says so", () => {
  assert.equal(realView({ ...base, amount: 0.5 }).note, "At least $1.");
  assert.equal(realView({ ...base, amount: 30 }).note, "Above the limit for one order.", "the engine's cap of one order (25)");
  assert.equal(realView({ ...base, tradable: false }).note, "This market is closed.");
  const failed = realView({ ...base, trade: { step: "failed", key: "k", text: "The price moved. Try again." } });
  assert.equal(failed.act, "quote");
  assert.equal(failed.note, "The price moved. Try again.");
  assert.equal(failed.warn, true);
  assert.equal(realView({ ...base, trade: { step: "quoting", key: "k" } }).label, "Getting the price…");
});

test("Real: sell only a position held on one venue", () => {
  assert.equal(realView({ ...base, action: "sell" }).label, "Nothing to sell");
  assert.equal(realView({ ...base, action: "sell", spread: true }).label, "Not sellable here yet");
  const sell = realView({ ...base, action: "sell", sellable: true });
  assert.equal(sell.label, "Sell Yes");
  assert.equal(sell.act, "quote");
});

test("what an order came to, in one line", () => {
  const r = review();
  assert.deepEqual(doneNotice("filled", r), { tone: "ok", text: "Bought Yes · $10.03" });
  assert.equal(doneNotice("submitted", r).text, "Order sent. It shows in your positions.");
  assert.equal(doneNotice("failed", r).tone, "warn");
});

test("an event of several markets lists each as a row, the likeliest first, and the page shows the one picked", () => {
  const card = { eventId: "ev-fed", marketId: "fed-hike25", title: "Fed decision in December?", question: "25 bps increase", image: null, sides: [], binary: true, volume: null, closes: null, venues: [], categories: [], marketCount: 5 };
  const d = readDetail(fedEventBody(NOW), card);
  assert.deepEqual(
    d.rows.map((r) => [r.label, r.sides[0].p]),
    [
      ["25 bps increase", 0.765],
      ["No change", 0.215],
      ["50+ bps increase", 0.024],
      ["25 bps decrease", 0.0045],
      ["50+ bps decrease", 0.0025],
    ],
  );
  assert.equal(d.marketId, "fed-hike25", "the bracket the card led with");
  assert.equal(d.question, "25 bps increase");
  assert.deepEqual(d.matched, ["k-hike25-yes", "p-hike25-yes"], "where else its history may be read");
  const hold = pickRow(d, "fed-hold");
  assert.equal(hold.marketId, "fed-hold");
  assert.equal(hold.question, "No change");
  assert.deepEqual(hold.sides.map((x) => x.id), ["fed-hold-yes", "fed-hold-no"]);
  assert.equal(hold.title, d.title, "the same event");
  assert.equal(hold.description, "This market resolves Yes on «No change».");
  assert.equal(pickRow(d, "nope"), d, "a row it does not have leaves the page as it was");
  const single = readDetail(eventBody("ev-btc", { now: NOW }));
  assert.ok(single.rows.length >= 1);
});

test("covers come through the city's own route, AGG's covers only, sharp at the size drawn", () => {
  const cover = "https://assets.agg.market/events/polymarket/32225/cover/original.webp";
  assert.equal(isCover(cover), true);
  assert.equal(coverSrc(cover), `${COVER_ROUTE}?u=${encodeURIComponent(cover)}`);
  // AGG serves the squares 44, 48 and 60 only (80, 96 and 120 answer 403, read 29.10): a row at 56 px takes the original.
  assert.equal(coverSrc(cover, 56), `${COVER_ROUTE}?u=${encodeURIComponent(cover)}`, "no square AGG serves is sharp at twice a row: the original");
  assert.equal(coverSrc(cover, 24), `${COVER_ROUTE}?u=${encodeURIComponent(cover.replace("original.webp", "48.webp"))}`, "a small place takes the square sharp at twice its size");
  for (const px of [1, 10, 22, 24, 30, 56, 92, 200]) {
    const src = decodeURIComponent(coverSrc(cover, px).split("?u=")[1]);
    assert.match(src, /\/cover\/(?:original|44|48|60)\.webp$/, `${px} px asks only for a size AGG serves`);
  }
  assert.equal(coverSrc(cover, 92), `${COVER_ROUTE}?u=${encodeURIComponent(cover)}`, "no square is sharp enough: the original");
  assert.ok(isCover("https://assets.agg.market/markets/kalshi/KXFEDDECISION-26DEC-H26/cover/original.webp"));
  for (const bad of [
    null,
    "",
    "http://assets.agg.market/events/polymarket/1/cover/original.webp",
    "https://assets.agg.market.evil.test/events/polymarket/1/cover/original.webp",
    "https://evil.test/events/polymarket/1/cover/original.webp",
    "https://assets.agg.market/events/polymarket/1/cover/original.svg",
    "https://assets.agg.market/events/polymarket/../../x/cover/original.webp",
    "https://assets.agg.market/events/polymarket/1/cover/original.webp?x=1",
    "https://user@assets.agg.market/events/polymarket/1/cover/original.webp",
  ]) {
    assert.equal(isCover(bad), false, String(bad));
    assert.equal(coverSrc(bad), null);
  }
});
