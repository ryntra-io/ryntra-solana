// Run from repo root: node --test lib/predictions/settle.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { SETTLE_LATE_MS, SETTLE_WARN_MS, collectRequestId, marketPhase, redeemPhase, settleCalendar, settleRow } from "./settle.ts";

/*
 * Settlement read off the provider's own words: what the person is waiting
 * for, when, and what is overdue or disputed. Nothing here moves money.
 */

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const ahead = (ms) => new Date(NOW + ms).toISOString();
const behind = (ms) => new Date(NOW - ms).toISOString();

function position(over = {}) {
  return {
    eventId: "ev1",
    venueEventId: "vev1",
    question: "Will the test pass?",
    image: null,
    marketStatus: "open",
    status: "active",
    redeemStatus: "not_eligible",
    resolutionDate: ahead(30 * 86_400_000),
    outcomes: [{ label: "Yes", totalSize: 10, avgEntryPrice: 0.4, currentPrice: 0.5, totalValue: 5, unrealizedPnl: 1, unrealizedPnlPercent: 25, winner: null, venues: [{ venue: "polymarket", size: 10, venueMarketId: "m1", outcomeId: "o-yes" }] }],
    ...over,
  };
}

test("the provider's words become the product's, and a word nobody knows is never «paid»", () => {
  assert.equal(redeemPhase("eligible"), "eligible");
  assert.equal(redeemPhase("REDEEMED"), "paid");
  assert.equal(redeemPhase(" claiming "), "pending");
  assert.equal(redeemPhase("not_eligible"), "not_needed");
  assert.equal(redeemPhase("under_review"), "disputed");
  assert.equal(redeemPhase("something_new"), "unknown");
  assert.equal(redeemPhase(null), "unknown");
  assert.equal(marketPhase("pending_resolution"), "closed");
  assert.equal(marketPhase("finalized"), "resolved");
  assert.equal(marketPhase("whatever"), "unknown");
});

test("an open market is trading until the settlement moment is within the day", () => {
  assert.equal(settleRow(position(), NOW).phase, "trading");
  assert.equal(settleRow(position({ resolutionDate: ahead(SETTLE_WARN_MS - 60_000) }), NOW).phase, "due_soon");
  assert.equal(settleRow(position({ resolutionDate: null }), NOW).phase, "trading", "no stated moment is not a warning");
});

test("a market that stopped trading waits, and is late only past the moment it was promised for", () => {
  const closed = { marketStatus: "closed", status: "closed" };
  assert.equal(settleRow(position({ ...closed, resolutionDate: behind(3_600_000) }), NOW).phase, "awaiting");
  assert.equal(settleRow(position({ ...closed, resolutionDate: behind(SETTLE_LATE_MS + 60_000) }), NOW).phase, "late");
  assert.equal(settleRow(position({ ...closed, resolutionDate: null }), NOW).phase, "awaiting", "no moment stated: still waiting, never late");
});

test("a payout due is `payable` until Ryntra has asked, and `collecting` after", () => {
  const won = position({ marketStatus: "resolved", status: "closed", redeemStatus: "eligible", resolutionDate: behind(3_600_000), outcomes: [{ ...position().outcomes[0], winner: true, currentPrice: 1, totalValue: 10 }] });
  const before = settleRow(won, NOW);
  assert.equal(before.phase, "payable");
  assert.deepEqual(before.outcomeIds, ["o-yes"]);
  assert.equal(before.winningLabel, "Yes");
  assert.equal(before.valueUsd, 10);
  assert.equal(settleRow(won, NOW, true).phase, "collecting");
  assert.equal(settleRow({ ...won, redeemStatus: "redeemed" }, NOW).phase, "paid");
  assert.equal(settleRow({ ...won, redeemStatus: "not_eligible" }, NOW).phase, "venue_pays", "a venue that pays on its own leaves nothing to ask for");
  assert.equal(settleRow({ ...won, redeemStatus: "disputed" }, NOW).phase, "disputed");
  assert.equal(settleRow({ ...won, redeemStatus: "brand_new_word" }, NOW).phase, "unknown", "never «paid» on a word nobody knows");
});

test("a decided market the person's side lost is `lost`, with nothing to collect", () => {
  const lost = position({
    marketStatus: "resolved",
    status: "closed",
    redeemStatus: "not_eligible",
    outcomes: [{ ...position().outcomes[0], winner: false, currentPrice: 0, totalValue: 0 }],
  });
  const row = settleRow(lost, NOW);
  assert.equal(row.phase, "lost");
  assert.deepEqual(row.outcomeIds, []);
});

test("the calendar puts the soonest first, keeps the overdue, disputed and incoming apart, and leaves nothing settled in it", () => {
  const rows = [
    position({ venueEventId: "a", question: "A", resolutionDate: ahead(10 * 86_400_000) }),
    position({ venueEventId: "b", question: "B", resolutionDate: ahead(2 * 3_600_000) }),
    position({ venueEventId: "c", question: "C", resolutionDate: null }),
    position({ venueEventId: "d", question: "D", marketStatus: "closed", status: "closed", resolutionDate: behind(SETTLE_LATE_MS + 1) }),
    position({ venueEventId: "e", question: "E", redeemStatus: "void", marketStatus: "closed", status: "closed" }),
    position({ venueEventId: "f", question: "F", marketStatus: "resolved", status: "closed", redeemStatus: "eligible", resolutionDate: behind(60_000), outcomes: [{ ...position().outcomes[0], winner: true, totalValue: 7 }] }),
    position({ venueEventId: "g", question: "G", marketStatus: "resolved", status: "closed", redeemStatus: "redeemed", outcomes: [{ ...position().outcomes[0], winner: true, totalValue: 7 }] }),
  ];
  const calendar = settleCalendar(rows, NOW);
  assert.deepEqual(
    calendar.rows.map((r) => r.question),
    ["D", "F", "B", "A", "E", "C"],
    "overdue and decided moments first, then the soonest, a market with no moment last",
  );
  assert.deepEqual(calendar.late.map((r) => r.question), ["D"]);
  assert.deepEqual(calendar.disputed.map((r) => r.question), ["E"]);
  assert.deepEqual(calendar.dueSoon.map((r) => r.question), ["B"]);
  assert.deepEqual(calendar.collecting.map((r) => r.question), ["F"]);
  assert.equal(calendar.rows.some((r) => r.question === "G"), false, "a market already paid waits for nothing");
  assert.equal(calendar.readAt, new Date(NOW).toISOString());
});

test("a market's payout is always asked under the one request id", () => {
  assert.equal(collectRequestId("W", "vev1"), collectRequestId("W", "vev1"));
  assert.notEqual(collectRequestId("W", "vev1"), collectRequestId("W", "vev2"));
  assert.notEqual(collectRequestId("W", "vev1"), collectRequestId("V", "vev1"));
});
