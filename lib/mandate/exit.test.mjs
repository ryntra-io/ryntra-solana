/* The agent's own exit: every rule, its order, its bounds, its text and the position it reads. Pure; no
   network, no key. */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_FADE_AFTER_MS,
  EXIT_UNREAD_MS,
  NO_MARKET,
  SCOUT_EXIT,
  TRADER_EXIT,
  costAfterSale,
  exitDecision,
  exitFrom,
  exitRefusal,
  exitText,
  faded,
  isFullExit,
  positionOf,
  positionTrades,
  saleRoom,
  withEvent,
  EVENTS_KEPT,
} from "./exit.ts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const SOL = 1_000_000_000n;

const position = (over = {}) => ({ heldRaw: 1_000n, costRaw: SOL, worthRaw: SOL, openedAt: NOW - HOUR, halfTaken: false, ...over });
const decide = (over = {}, rules = TRADER_EXIT, market = NO_MARKET, unreadSince = null) => exitDecision({ rules, position: position(over), market, now: NOW, unreadSince });

test("nothing held — nothing to sell, whatever the price", () => {
  assert.deepEqual(decide({ heldRaw: 0n, worthRaw: 0n }), { do: "hold" });
  assert.deepEqual(decide({ heldRaw: 0n, worthRaw: null }), { do: "hold" });
});

test("the stop sells everything at its line, not a lamport before", () => {
  /* −15 % exactly: sold. */
  assert.deepEqual(decide({ worthRaw: (SOL * 85n) / 100n }), { do: "sell", why: "stop", share: 100, amountRaw: 1_000n });
  /* −14.99 %: held. */
  assert.deepEqual(decide({ worthRaw: (SOL * 8501n) / 10_000n }), { do: "hold" });
  /* «Скаут»'s stop is −35 %. */
  assert.equal(decide({ worthRaw: (SOL * 70n) / 100n }, SCOUT_EXIT).do, "hold");
  assert.equal(decide({ worthRaw: (SOL * 65n) / 100n }, SCOUT_EXIT).why, "stop");
});

test("half at 2x, once — the half rounds down, and a single coin is not halved", () => {
  assert.deepEqual(decide({ worthRaw: 2n * SOL }), { do: "sell", why: "half", share: 50, amountRaw: 500n });
  assert.deepEqual(decide({ worthRaw: 2n * SOL - 1n }), { do: "hold" });
  assert.deepEqual(decide({ worthRaw: 3n * SOL, halfTaken: true }), { do: "hold" });
  assert.deepEqual(decide({ worthRaw: 3n * SOL, heldRaw: 1n }), { do: "hold" });
  assert.deepEqual(decide({ worthRaw: 3n * SOL }, { ...TRADER_EXIT, halfAtBps: null }), { do: "hold" });
});

test("the fade: the last 6 hours under a fifth of the day's pace, only after half an hour held", () => {
  const quiet = { volumeH6Usd: 1_000, volumeH24Usd: 100_000 };
  const busy = { volumeH6Usd: 30_000, volumeH24Usd: 100_000 };
  assert.equal(faded(quiet, 2_000), true);
  assert.equal(faded(busy, 2_000), false);
  /* Exactly a fifth of the pace (25 000 ÷ 4 × 0.2 = 1 250) is no fade. */
  assert.equal(faded({ volumeH6Usd: 1_250, volumeH24Usd: 25_000 }, 2_000), false);
  assert.equal(faded({ volumeH6Usd: 1_249, volumeH24Usd: 25_000 }, 2_000), true);
  assert.deepEqual(decide({}, TRADER_EXIT, quiet), { do: "sell", why: "fade", share: 100, amountRaw: 1_000n });
  assert.deepEqual(decide({ openedAt: NOW - EXIT_FADE_AFTER_MS + 1 }, TRADER_EXIT, quiet), { do: "hold" });
  assert.deepEqual(decide({}, { ...TRADER_EXIT, fadeBps: null }, quiet), { do: "hold" });
});

test("a volume not read is no fade, and never a sale", () => {
  for (const market of [NO_MARKET, { volumeH6Usd: 1, volumeH24Usd: null }, { volumeH6Usd: null, volumeH24Usd: 9 }, { volumeH6Usd: 0, volumeH24Usd: 0 }, { volumeH6Usd: Number.NaN, volumeH24Usd: 5 }]) {
    assert.equal(faded(market, 2_000), false);
    assert.deepEqual(decide({}, TRADER_EXIT, market), { do: "hold" });
  }
});

test("the clock sells everything once the position is as old as the rules say", () => {
  assert.deepEqual(decide({ openedAt: NOW - 24 * HOUR }, SCOUT_EXIT), { do: "sell", why: "time", share: 100, amountRaw: 1_000n });
  assert.deepEqual(decide({ openedAt: NOW - 24 * HOUR + 1 }, SCOUT_EXIT), { do: "hold" });
  /* The Trader has no clock. */
  assert.deepEqual(decide({ openedAt: NOW - 900 * HOUR }), { do: "hold" });
  /* A position whose start is not known has no age. */
  assert.deepEqual(decide({ openedAt: null }, SCOUT_EXIT, { volumeH6Usd: 1, volumeH24Usd: 1_000 }), { do: "hold" });
});

test("the losses' rules come before the gain's, the stop before all", () => {
  /* Down 40 % and old and faded: the stop names it. */
  assert.equal(decide({ worthRaw: (SOL * 60n) / 100n, openedAt: NOW - 48 * HOUR }, SCOUT_EXIT, { volumeH6Usd: 1, volumeH24Usd: 1_000 }).why, "stop");
  /* Up 3x but old: the clock, everything — not the half. */
  assert.equal(decide({ worthRaw: 3n * SOL, openedAt: NOW - 48 * HOUR }, SCOUT_EXIT).why, "time");
  assert.equal(decide({ worthRaw: 3n * SOL }, TRADER_EXIT, { volumeH6Usd: 1, volumeH24Usd: 1_000 }).why, "fade");
});

test("a price not read is never a sale: wait, then pause and tell", () => {
  assert.deepEqual(decide({ worthRaw: null }), { do: "wait", why: "unread" });
  assert.deepEqual(decide({ worthRaw: null }, TRADER_EXIT, NO_MARKET, NOW - EXIT_UNREAD_MS + 1), { do: "wait", why: "unread" });
  assert.deepEqual(decide({ worthRaw: null }, TRADER_EXIT, NO_MARKET, NOW - EXIT_UNREAD_MS), { do: "pause", why: "unread" });
  /* Even past its clock, with no price it does not sell. */
  assert.deepEqual(decide({ worthRaw: null, openedAt: NOW - 99 * HOUR }, SCOUT_EXIT, NO_MARKET, NOW - EXIT_UNREAD_MS), { do: "pause", why: "unread" });
});

test("the rules' text: round trip, bounds, and nothing loose", () => {
  assert.equal(exitText(TRADER_EXIT), "exit:1500:20000:2000:-");
  assert.equal(exitText(SCOUT_EXIT), "exit:3500:20000:2000:24");
  assert.deepEqual(exitFrom(exitText(TRADER_EXIT)), TRADER_EXIT);
  assert.deepEqual(exitFrom(exitText(SCOUT_EXIT)), SCOUT_EXIT);
  assert.deepEqual(exitFrom("exit:300:-:-:-"), { stopBps: 300, halfAtBps: null, fadeBps: null, holdH: null });
  for (const text of ["exit:299:-:-:-", "exit:5001:-:-:-", "exit:-:-:-:-", "exit:1500:11999:-:-", "exit:1500:-:499:-", "exit:1500:-:-:0", "exit:1500:-:-:2161", "exit:1500:-:-", "stop:1500:-:-:-", "exit:1500:-:-:-:", "exit:1.5:-:-:-", "exit:+1500:-:-:-", 42, null, "exit:1500:20000:2000:-".repeat(3)]) {
    assert.equal(exitFrom(text), null, String(text));
  }
  assert.equal(exitRefusal(TRADER_EXIT), null);
  assert.equal(exitRefusal(SCOUT_EXIT), null);
  assert.match(exitRefusal({ ...TRADER_EXIT, stopBps: 6_000 }), /stop/);
});

test("the cost a sale carries out of the position", () => {
  assert.equal(costAfterSale(SOL, 1_000n, 500n), SOL / 2n);
  assert.equal(costAfterSale(SOL, 1_000n, 1_000n), 0n);
  assert.equal(costAfterSale(SOL, 1_000n, 2_000n), 0n);
  assert.equal(costAfterSale(SOL, 0n, 1n), 0n);
  assert.equal(costAfterSale(10n, 3n, 1n), 7n);
});

test("the position: buys since the last full exit, less the sales — never more than the vault holds", () => {
  const buy = (at, spent, got) => ({ at, status: "ok", spentRaw: String(spent), receivedRaw: got === null ? null : String(got) });
  const sale = (at, why, sold, cost, status = "ok") => ({ at, why, status, signature: "s", soldRaw: String(sold), gotRaw: "1", costRaw: String(cost), reason: null });
  const buys = [buy(1, 100, 1_000), { ...buy(2, 100, 1_000), status: "failed" }, buy(3, 100, 1_000)];
  assert.deepEqual(positionOf({ buys, sales: [], vaultRaw: 5_000n }), { heldRaw: 2_000n, costRaw: 200n, openedAt: 1, halfTaken: false, unread: false });
  /* The vault holds less than the book: the vault's figure. */
  assert.equal(positionOf({ buys, sales: [], vaultRaw: 1_500n }).heldRaw, 1_500n);
  /* Half sold: half the coins and half the cost leave. */
  const half = positionOf({ buys, sales: [sale(4, "half", 1_000, 100)], vaultRaw: 5_000n });
  assert.deepEqual(half, { heldRaw: 1_000n, costRaw: 100n, openedAt: 1, halfTaken: true, unread: false });
  /* A full exit closes the position: what is bought after is a new one. */
  const after = positionOf({ buys: [...buys, buy(9, 50, 700)], sales: [sale(5, "stop", 2_000, 200)], vaultRaw: 5_000n });
  assert.deepEqual(after, { heldRaw: 700n, costRaw: 50n, openedAt: 9, halfTaken: false, unread: false });
  /* A failed sale took nothing; one sent and unread may have. */
  assert.equal(positionOf({ buys, sales: [sale(4, "half", 1_000, 100, "failed")], vaultRaw: 5_000n }).heldRaw, 2_000n);
  const flying = positionOf({ buys, sales: [{ ...sale(4, "half", 1_000, 100, "failed"), unsettled: true }], vaultRaw: 5_000n });
  assert.equal(flying.heldRaw, 1_000n);
  assert.equal(flying.unread, true);
  /* A buy whose coins were not read, or a vault not read: unread. */
  assert.equal(positionOf({ buys: [buy(1, 100, null)], sales: [], vaultRaw: 5n }).unread, true);
  assert.equal(positionOf({ buys, sales: [], vaultRaw: null }).unread, true);
});

test("only the half is not a full exit; the book keeps the newest events", () => {
  assert.equal(isFullExit("half"), false);
  for (const why of ["stop", "fade", "time"]) assert.equal(isFullExit(why), true);
  let events;
  for (let i = 0; i < EVENTS_KEPT + 5; i += 1) events = withEvent(events, { v: 1, kind: "paused", at: i, policy: "p", owner: "o", coin: "c", why: "unread" });
  assert.equal(events.length, EVENTS_KEPT);
  assert.equal(events[0].at, 5);
  assert.equal(events.at(-1).at, EVENTS_KEPT + 4);
});

test("the sale's day: what its policy still lets out over the last whole day, and a part of a stop closes no position", () => {
  const DAY = 24 * 3_600_000;
  const at = 10 * DAY;
  const row = (when, sold, patch = {}) => ({ at: when, why: "stop", status: "ok", signature: "s", soldRaw: String(sold), gotRaw: "1", costRaw: "1", reason: null, ...patch });
  assert.equal(saleRoom([], 600n, at), 600n);
  assert.equal(saleRoom([row(at - 60_000, 400)], 600n, at), 200n);
  assert.equal(saleRoom([row(at - DAY - 1, 400)], 600n, at), 600n, "a sale over a day ago is back in the day's room");
  assert.equal(saleRoom([row(at - 60_000, 400, { status: "failed", unsettled: true })], 600n, at), 200n, "in flight, its coins may have left");
  assert.equal(saleRoom([row(at - 60_000, 400, { status: "failed" })], 600n, at), 600n, "refused, nothing left");
  assert.equal(saleRoom([row(at - 60_000, 900)], 600n, at), 0n, "never below zero");
  /* A part of a stop the day's limit held back: the position stays open, its rest sold the next day. */
  const buys = [{ at: at - 3 * DAY, status: "ok", spentRaw: "100", receivedRaw: "1000" }];
  const part = row(at - DAY, 600, { costRaw: "60", partial: true });
  assert.equal(positionTrades(buys, [part]).length, 1);
  const open = positionOf({ buys, sales: [part], vaultRaw: 400n });
  assert.deepEqual([open.heldRaw, open.costRaw, open.openedAt], [400n, 40n, at - 3 * DAY]);
  const closed = positionOf({ buys, sales: [part, row(at, 400, { costRaw: "40" })], vaultRaw: 0n });
  assert.deepEqual([closed.heldRaw, closed.costRaw], [0n, 0n]);
});
