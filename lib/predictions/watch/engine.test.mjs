// Run from repo root: node --test lib/predictions/watch/engine.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { WATCH_GAP_MS, WATCH_NEWS_FRESH_MS, WATCH_READ_STALE_MS, barsOverWindow, judgeRule, reviewSignal, volumePace } from "./engine.ts";
import { normalizeRule } from "./rules.ts";

/*
 * The engine, on its own: the figures go in, a verdict comes out. Every kind
 * is checked for the three things the product promises — it fires on the
 * thing it watches, it refuses to fire on a read it cannot vouch for, and it
 * will not claim a crossing it did not see.
 */

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const HOUR = 3_600_000;

const SUBJECT = { eventId: "ev1", eventTitle: "December rate decision", venueMarketId: "m1", question: "Will the rate hold in December?", outcomeId: "o-yes", outcomeLabel: "Yes" };

const rule = (kind, over = {}) => normalizeRule({ kind, subject: SUBJECT, direction: over.direction ?? "above", threshold: over.threshold ?? null, windowMinutes: over.windowMinutes ?? null, note: null });
const seen = (figure, overMs = 60_000, extra = {}) => ({ at: new Date(NOW - overMs).toISOString(), figure, cursor: null, mark: null, ...extra });

/** A flat series of hourly bars ending now, with the last `moves` applied to the close. */
function bars(count, close, options = {}) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const t = NOW - i * HOUR;
    const c = i === 0 ? close : (options.from ?? close);
    out.push({ t, o: c, h: c, l: c, c, v: i === 0 ? (options.lastVolume ?? 100) : (options.volume ?? 100) });
  }
  return out;
}

/* ------------------------------------------------------------------ the price through a level */

test("a price crossing the level fires, and the same level already passed does not", () => {
  const r = rule("price", { direction: "above", threshold: 0.6 });
  const reads = { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW - 30_000, venues: [{ venue: "polymarket", midpoint: 0.65 }] } };

  const crossed = judgeRule(r, reads, seen(0.52));
  assert.equal(crossed.outcome, "fired");
  assert.equal(crossed.event, "price:above:0.6");
  assert.deepEqual({ was: crossed.facts.was, now: crossed.facts.now, level: crossed.facts.level, way: crossed.facts.way }, { was: 0.52, now: 0.65, level: 0.6, way: "above" });

  /* Already above when the watch last looked: nothing crossed, and nothing is sent. */
  assert.equal(judgeRule(r, reads, seen(0.62)).outcome, "held");
});

test("the first pass writes the price down and sends nothing", () => {
  const verdict = judgeRule(rule("price", { threshold: 0.6 }), { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW, venues: [] } }, null);
  assert.equal(verdict.outcome, "rebased");
  assert.equal(verdict.observation.figure, 0.65);
  assert.equal(verdict.event, null);
});

test("a price the provider stamped too long ago is stale, never a crossing", () => {
  const verdict = judgeRule(rule("price", { threshold: 0.6 }), { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW - WATCH_READ_STALE_MS - 1_000, venues: [] } }, seen(0.52));
  assert.equal(verdict.outcome, "stale");
  assert.equal(verdict.facts, null);
});

test("a read that did not answer is unavailable, and the rule keeps what it last saw", () => {
  const was = seen(0.52);
  const verdict = judgeRule(rule("price", { threshold: 0.6 }), { readAt: NOW }, was);
  assert.equal(verdict.outcome, "unavailable");
  assert.deepEqual(verdict.observation, was);
});

test("after a gap in the watching the price is written down again rather than announced", () => {
  const reads = { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW, venues: [] } };
  /* The last look was longer ago than one stretch of watching: what the market did in between was not watched. */
  const afterGap = judgeRule(rule("price", { threshold: 0.6 }), reads, seen(0.52, WATCH_GAP_MS + 60_000));
  assert.equal(afterGap.outcome, "rebased");
  /* And the reader saying the stream was interrupted does the same, however recent the figure. */
  const afterReconnect = judgeRule(rule("price", { threshold: 0.6 }), { ...reads, reconnected: true }, seen(0.52));
  assert.equal(afterReconnect.outcome, "rebased");
});

/* ------------------------------------------------------------------ the probability over a period */

test("a move over the period fires from the bars, and one window gives one signal", () => {
  const r = rule("probability_move", { direction: "any", threshold: 0.1, windowMinutes: 1_440 });
  const series = bars(30, 0.65, { from: 0.5 });
  const first = judgeRule(r, { readAt: NOW, bars: series }, null);
  assert.equal(first.outcome, "fired", "the bars carry their own history, so no earlier look is needed");
  assert.equal(first.facts.change, 0.15);
  /* Read again inside the same window: the same identity, so the signal is one. */
  const again = judgeRule(r, { readAt: NOW + 60_000, bars: series }, first.observation);
  assert.equal(again.event, first.event);
  /* A series shorter than the window cannot be judged. */
  assert.equal(judgeRule(r, { readAt: NOW, bars: bars(3, 0.65, { from: 0.5 }) }, null).outcome, "unavailable");
  /* A small move holds. */
  assert.equal(judgeRule(r, { readAt: NOW, bars: bars(30, 0.505, { from: 0.5 }) }, null).outcome, "held");
});

test("a move the wrong way for the rule holds", () => {
  const down = judgeRule(rule("probability_move", { direction: "above", threshold: 0.1, windowMinutes: 1_440 }), { readAt: NOW, bars: bars(30, 0.35, { from: 0.5 }) }, null);
  assert.equal(down.outcome, "held");
});

/* ------------------------------------------------------------------ the spike in trading */

test("an hour trading far above the period's pace fires, keyed by the bar that spiked", () => {
  const r = rule("volume_spike", { threshold: 3, windowMinutes: 1_440 });
  const series = bars(24, 0.5, { volume: 100, lastVolume: 500 });
  const verdict = judgeRule(r, { readAt: NOW, bars: series }, null);
  assert.equal(verdict.outcome, "fired");
  assert.equal(verdict.facts.pace, 5);
  assert.equal(verdict.event, `volume:${series.at(-1).t}`);
  /* The same bar read again is the same happening. */
  assert.equal(judgeRule(r, { readAt: NOW + 60_000, bars: series }, verdict.observation).event, verdict.event);
  /* A normal hour holds, and a series too short to tell a pace from is unavailable. */
  assert.equal(judgeRule(r, { readAt: NOW, bars: bars(24, 0.5) }, null).outcome, "held");
  assert.equal(judgeRule(r, { readAt: NOW, bars: bars(3, 0.5, { lastVolume: 500 }) }, null).outcome, "unavailable");
});

/* ------------------------------------------------------------------ the book */

test("a book gone thin or a spread gone wide fires once, not on every pass", () => {
  const r = rule("liquidity", { direction: "any", threshold: 250 });
  const full = { readAt: NOW, book: { bestBid: 0.51, bestAsk: 0.53, depthUsd: 2_520, stampedAt: NOW } };
  const thin = { readAt: NOW, book: { bestBid: 0.4, bestAsk: 0.6, depthUsd: 40, stampedAt: NOW } };

  /* A book that is fine says nothing, with or without an earlier look. */
  assert.equal(judgeRule(r, full, null).outcome, "held");
  assert.equal(judgeRule(r, full, seen(2_520, 60_000, { mark: "0.02" })).outcome, "held");
  /* Thin on the very first look: written down, not announced — Ryntra did not see it get that way. */
  assert.equal(judgeRule(r, thin, null).outcome, "rebased");

  const gone = judgeRule(r, thin, seen(2_520, 60_000, { mark: "0.02" }));
  assert.equal(gone.outcome, "fired");
  assert.equal(gone.facts.which, "both");
  /* Still thin on the next pass: the market's state, not a new happening. */
  assert.equal(judgeRule(r, thin, gone.observation).outcome, "held");
});

/* ------------------------------------------------------------------ the news */

test("the feed a market already had is never news, and each item after it fires once", () => {
  const r = rule("news");
  const item = (id, agoMs) => ({ id, title: `Headline ${id}`, source: "Reuters", publishedAt: NOW - agoMs });
  const history = { readAt: NOW, news: { items: [item("a", 5 * HOUR), item("b", 20 * HOUR)] } };

  const first = judgeRule(r, history, null);
  assert.equal(first.outcome, "rebased", "a first read carries a whole feed: none of it is news to send");
  assert.equal(first.observation.cursor, NOW - 5 * HOUR);

  const fresh = { readAt: NOW + HOUR, news: { items: [item("c", -HOUR), ...history.news.items] } };
  const rang = judgeRule(r, fresh, first.observation);
  assert.equal(rang.outcome, "fired");
  assert.equal(rang.event, "news:c");
  assert.equal(rang.facts.source, "Reuters");

  /* The same read again: nothing new, and the mark has moved past it. */
  assert.equal(judgeRule(r, fresh, rang.observation).outcome, "held");

  /* An item nobody saw but older than the freshness bound is not news either. */
  const old = { readAt: NOW + HOUR, news: { items: [item("d", WATCH_NEWS_FRESH_MS + HOUR)] } };
  assert.equal(judgeRule(r, old, { at: new Date(NOW).toISOString(), figure: null, cursor: NOW - 10 * HOUR, mark: null }).outcome, "held");
});

test("a feed that dropped an item cannot make the one before it news again", () => {
  const r = rule("news");
  const mark = { at: new Date(NOW - 60_000).toISOString(), figure: null, cursor: NOW - HOUR, mark: null };
  const shrunk = { readAt: NOW, news: { items: [{ id: "old", title: "Old", source: "AP", publishedAt: NOW - 3 * HOUR }] } };
  const verdict = judgeRule(r, shrunk, mark);
  assert.equal(verdict.outcome, "held");
  assert.equal(verdict.observation.cursor, NOW - HOUR, "the mark only ever moves forward");
});

/* ------------------------------------------------------------------ the rules and the settlement */

test("rules rewritten, and a result gone overdue, each fire once", () => {
  const r = rule("resolution");
  const before = { readAt: NOW, rules: { fingerprint: "aaaa1111", moved: [], phase: "open", lateByMs: null } };
  const first = judgeRule(r, before, null);
  assert.equal(first.outcome, "rebased");

  const rewritten = { readAt: NOW + HOUR, rules: { fingerprint: "bbbb2222", moved: ["text"], phase: "open", lateByMs: null } };
  const changed = judgeRule(r, rewritten, first.observation);
  assert.equal(changed.outcome, "fired");
  assert.equal(changed.facts.which, "rules");
  assert.equal(changed.event, "rules:bbbb2222");
  assert.equal(judgeRule(r, rewritten, changed.observation).outcome, "held");

  const late = { readAt: NOW + 2 * HOUR, rules: { fingerprint: "bbbb2222", moved: [], phase: "delayed", lateByMs: 5 * HOUR } };
  const overdue = judgeRule(r, late, changed.observation);
  assert.equal(overdue.outcome, "fired");
  assert.equal(overdue.facts.which, "late");
  assert.equal(overdue.facts.lateMinutes, 300);
});

test("a fingerprint that moved on something Ryntra does not keep makes no claim about what changed", () => {
  const was = { at: new Date(NOW - 60_000).toISOString(), figure: null, cursor: null, mark: "aaaa1111|open" };
  const verdict = judgeRule(rule("resolution"), { readAt: NOW, rules: { fingerprint: "cccc3333", moved: [], phase: "open", lateByMs: null } }, was);
  assert.equal(verdict.outcome, "held");
  assert.equal(verdict.observation.mark, "cccc3333|open");
});

/* ------------------------------------------------------------------ the person's own position */

test("a position crossing the level fires, and a wallet holding nothing is not watched", () => {
  const r = rule("position_value", { direction: "above", threshold: 50 });
  const held = { readAt: NOW, position: { valueUsd: 62.4, held: true } };
  const verdict = judgeRule(r, held, seen(30));
  assert.equal(verdict.outcome, "fired");
  assert.equal(verdict.facts.now, 62.4);
  assert.equal(judgeRule(r, { readAt: NOW, position: { valueUsd: 0, held: false } }, seen(30)).outcome, "held");
});

/* ------------------------------------------------------------------ the venues */

test("venues pulling apart fire once while the gap stays open", () => {
  const r = rule("venue_spread", { threshold: 0.03 });
  const apart = { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW, venues: [{ venue: "polymarket", midpoint: 0.65 }, { venue: "kalshi", midpoint: 0.7 }] } };
  const together = { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW, venues: [{ venue: "polymarket", midpoint: 0.65 }, { venue: "kalshi", midpoint: 0.66 }] } };
  assert.equal(judgeRule(r, together, seen(0.01)).outcome, "held");
  const opened = judgeRule(r, apart, seen(0.01));
  assert.equal(opened.outcome, "fired");
  assert.equal(opened.facts.high, "kalshi");
  assert.equal(judgeRule(r, apart, opened.observation).outcome, "held", "a gap already open is the market's state");
  /* One venue is nothing to compare. */
  assert.equal(judgeRule(r, { readAt: NOW, prices: { outcome: 0.65, stampedAt: NOW, venues: [{ venue: "polymarket", midpoint: 0.65 }] } }, seen(0.01)).outcome, "unavailable");
});

/* ------------------------------------------------------------------ the linked market */

test("a linked market moving fires on the biggest of them, and says how many more", () => {
  const r = rule("related_move", { direction: "any", threshold: 0.1, windowMinutes: 1_440 });
  const reads = { readAt: NOW, related: { items: [{ venueMarketId: "m2", question: "Will inflation print above 3%?", change: 0.14, eventId: "ev2" }, { venueMarketId: "m3", question: "Another market", change: -0.12, eventId: "ev3" }] } };
  const verdict = judgeRule(r, reads, null);
  assert.equal(verdict.outcome, "fired");
  assert.equal(verdict.facts.linkedQuestion, "Will inflation print above 3%?");
  assert.equal(verdict.facts.more, 1);
  assert.equal(judgeRule(r, { readAt: NOW, related: { items: [{ venueMarketId: "m2", question: "q", change: 0.01, eventId: "ev2" }] } }, null).outcome, "held");
});

/* ------------------------------------------------------------------ a rule stored without what it needs */

test("a rule missing the figure or the period it compares is not judged", () => {
  const broken = { kind: "price", subject: SUBJECT, direction: "above", threshold: null, windowMinutes: null, note: null };
  assert.equal(judgeRule(broken, { readAt: NOW, prices: { outcome: 0.9, stampedAt: NOW, venues: [] } }, seen(0.1)).outcome, "unavailable");
});

/* ------------------------------------------------------------------ the helpers */

test("the bar pair and the pace are read off the series, never guessed", () => {
  assert.equal(barsOverWindow(bars(30, 0.6, { from: 0.5 }), 24 * HOUR, NOW).from.c, 0.5);
  assert.equal(barsOverWindow(bars(2, 0.6), 24 * HOUR, NOW), null);
  assert.equal(volumePace(bars(24, 0.5, { lastVolume: 400 }), 24 * HOUR, NOW).pace, 4);
  assert.equal(volumePace(bars(24, 0.5, { volume: 0, lastVolume: 0 }), 24 * HOUR, NOW), null, "nothing traded is no pace to beat");
});

/* ------------------------------------------------------------------ checking a signal again */

test("a later read confirms a signal, says it is stale, or cannot say", () => {
  const price = rule("price", { direction: "above", threshold: 0.6 });
  const facts = { was: 0.52, now: 0.65, level: 0.6, way: "above" };
  assert.equal(reviewSignal(price, facts, { readAt: NOW, prices: { outcome: 0.64, stampedAt: NOW, venues: [] } }), "confirmed");
  assert.equal(reviewSignal(price, facts, { readAt: NOW, prices: { outcome: 0.55, stampedAt: NOW, venues: [] } }), "stale");
  assert.equal(reviewSignal(price, facts, { readAt: NOW }), "unavailable");
  assert.equal(reviewSignal(price, facts, { readAt: NOW, prices: { outcome: 0.64, stampedAt: NOW - WATCH_READ_STALE_MS - 1 , venues: [] } }), "unavailable");

  /* A published item stays published; a delay that ended does not. */
  assert.equal(reviewSignal(rule("news"), { headline: "x" }, { readAt: NOW, news: { items: [] } }), "confirmed");
  assert.equal(reviewSignal(rule("resolution"), { which: "late", phase: "delayed" }, { readAt: NOW, rules: { fingerprint: "a", moved: [], phase: "resolved", lateByMs: null } }), "stale");
  assert.equal(reviewSignal(rule("resolution"), { which: "rules", phase: "open" }, { readAt: NOW, rules: { fingerprint: "b", moved: [], phase: "open", lateByMs: null } }), "confirmed");
});
