// Run from repo root: node --test lib/predictions/market-map.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { actionSide, dayChange, factsOf, finishMarketMap, mapCandidates, sideOf } from "./market-map.ts";
import { readMarketMap } from "./market-map-read.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

const ripple = (mode, items) => ({
  mode,
  items: items.map(([eventId, score, action, reason, endDate = null, title = `Event ${eventId}`]) => ({ eventId, title, status: "open", score, action, reason, domain: "macro", endDate })),
});
const related = (venueMarketId, score, extra = {}) => ({ score, venue: "kalshi", venueMarketId, venueEventId: null, marketQuestion: `Q ${venueMarketId}`, eventTitle: `T ${venueMarketId}`, matchSource: "signal", matchedSignal: "Rates fall", ...extra });

function event(id, { markets = 1, status = "open", endDate = iso(NOW + 10 * 24 * H), yes = 0.4, labels = ["Yes", "No"] } = {}) {
  return {
    id,
    title: `Event ${id}`,
    venue: "polymarket",
    status,
    endDate,
    markets: Array.from({ length: markets }, (_, i) => ({
      id: `${id}-m${i}`,
      venue: "polymarket",
      question: `Question ${i} of ${id}`,
      status,
      endDate,
      matched: [{ id: `${id}-m${i}-k`, question: `Twin ${i} of ${id}` }],
      outcomes: [
        { id: `${id}-m${i}-y`, label: labels[0], probability: yes },
        { id: `${id}-m${i}-n`, label: labels[1], probability: 1 - yes },
      ],
    })),
  };
}

const base = { anchorEventId: "e0", anchorMarketIds: ["e0-m0", "e0-m0-k"], anchorTitles: ["Event e0", "Question 0 of e0", "Twin 0 of e0"] };

test("the side a model's action names, and the side a picked outcome is of its market", () => {
  assert.equal(actionSide("buy_yes"), "yes");
  assert.equal(actionSide("Buy No"), "no");
  assert.equal(actionSide("BUY_NO"), "no");
  assert.equal(actionSide("monitor"), null);
  assert.equal(actionSide("yes or no"), null);
  assert.equal(actionSide(null), null);
  const yesNo = event("a").markets[0];
  assert.equal(sideOf(yesNo, "a-m0-n"), "no");
  assert.equal(sideOf(yesNo, "a-m0-y"), "yes");
  /* Not Yes and No: the second outcome is the No-like one, as the provider lists them. */
  const named = event("b", { labels: ["Over", "Under"] }).markets[0];
  assert.equal(sideOf(named, "b-m0-n"), "no");
  assert.equal(sideOf(named, "b-m0-y"), "yes");
  assert.equal(sideOf(named, "missing"), "yes");
  /* Three or more outcomes not named Yes or No: the side is not known. */
  const three = { outcomes: [{ id: "a", label: "Harris" }, { id: "b", label: "Trump" }, { id: "c", label: "Other" }] };
  assert.equal(sideOf(three, "c"), null);
  assert.equal(sideOf(three, "a"), null);
});

test("a day's change reads the close a day back; short history is no change", () => {
  const bars = [0, 6, 12, 18, 24, 30].map((h) => ({ t: NOW - (30 - h) * H, o: 0, h: 0, l: 0, c: 0.3 + h / 100, v: null }));
  assert.ok(Math.abs(dayChange(bars, NOW) - 0.24) < 1e-9);
  assert.equal(dayChange(bars.slice(-2), NOW), null);
  assert.equal(dayChange([], NOW), null);
});

test("each event once, never this one or its twin; the model's two lists agreeing are one link, disagreeing are marked", () => {
  const list = mapCandidates({
    ...base,
    expand: ripple("expand", [
      ["e1", 0.8, "buy_yes", "Cuts lift risk assets."],
      ["e0", 0.99, "buy_yes", "itself"],
      ["tw", 0.98, "buy_yes", "the same on another venue", null, "event e0?"],
      ["e2", 0.4, "buy_no", "Weak tie."],
      ["e2", 0.6, "buy_no", "Stronger tie."],
      ["e7", 0.5, "buy_yes", "With."],
      ["e9", 0.45, "monitor", "No side named."],
    ]),
    hedge: ripple("hedge", [
      ["e3", 0.7, "buy_no", "Opposite outcome."],
      /* Yes moves with this one, so No moves against it: the same claim. */
      ["e1", 0.5, "buy_no", "Also against."],
      /* With on Yes and against on Yes: the lists disagree. */
      ["e7", 0.55, "buy_yes", "Against."],
      /* A list naming no side says nothing either way. */
      ["e9", 0.3, "buy_yes", "Against, on Yes."],
    ]),
    related: [
      related("e0-m0-k", 0.95),
      related("e4-m0", 0.66, { venueEventId: "e4" }),
      related("e3-m0", 0.9, { venueEventId: "e3" }),
      related("x-m0", 0.5),
      related("e5-m0", 0.3, { venueEventId: "e5", matchSource: "title_fallback", matchedSignal: "ignored" }),
      related("tw2", 0.9, { venueEventId: "e8", marketQuestion: "Twin 0 of e0" }),
    ],
    relatedEvent: (r) => (r.venueMarketId === "x-m0" ? "e6" : null),
  });
  assert.deepEqual(
    list.map((c) => [c.group, c.eventId]),
    [
      ["with", "e1"],
      ["with", "e2"],
      ["with", "e9"],
      ["against", "e3"],
      ["against", "e7"],
      ["theme", "e4"],
      ["theme", "e6"],
      ["theme", "e5"],
    ],
  );
  const by = Object.fromEntries(list.map((c) => [c.eventId, c]));
  assert.equal(by.e1.bothWays, false);
  assert.equal(by.e1.reason, "Cuts lift risk assets.");
  assert.equal(by.e1.there, "yes");
  assert.equal(by.e7.bothWays, true);
  assert.equal(by.e7.reason, "Against.");
  assert.equal(by.e9.bothWays, false);
  assert.equal(by.e2.reason, "Stronger tie.");
  assert.equal(by.e5.titleOnly, true);
  assert.equal(by.e5.reason, null);
  assert.equal(by.e4.marketId, "e4-m0");
  assert.deepEqual(by.e1.fallback, { status: "open", endDate: null });
});

test("at most five a group, the strongest first", () => {
  const items = Array.from({ length: 9 }, (_, i) => [`e${i + 1}`, i / 10, "buy_yes", "r"]);
  const list = mapCandidates({ ...base, expand: ripple("expand", items), hedge: null, related: null });
  assert.deepEqual(
    list.map((c) => c.eventId),
    ["e9", "e8", "e7", "e6", "e5"],
  );
});

test("a linked market's facts: the market named, never another in its place; an event of several, none named, gives no price", () => {
  const one = factsOf(event("e1"), null, "no");
  assert.equal(one.marketId, "e1-m0");
  assert.equal(one.question, null);
  assert.equal(one.outcomeId, "e1-m0-n");
  assert.equal(one.label, "No");
  assert.ok(Math.abs(one.price - 0.6) < 1e-9);
  const several = factsOf(event("e2", { markets: 3 }), "e2-m2-k", "yes");
  assert.equal(several.marketId, "e2-m2");
  assert.equal(several.question, "Question 2 of e2");
  assert.equal(several.outcomeId, "e2-m2-y");
  /* Named, but not in this event (a namesake found by title): nothing is drawn from it. */
  assert.equal(factsOf(event("e2", { markets: 3 }), "elsewhere-m0", "yes"), null);
  const unnamed = factsOf(event("e3", { markets: 2 }), null, "yes");
  assert.equal(unnamed.marketId, null);
  assert.equal(unnamed.price, null);
  assert.equal(unnamed.status, "open");
  const theme = factsOf(event("e4", { labels: ["Over", "Under"] }), "e4-m0", null);
  assert.equal(theme.label, "Over");
});

test("the day against the link, the dates and the status against it", () => {
  const anchor = { eventId: "e0", marketId: "e0-m0", outcomeId: "e0-m0-y", side: "yes", endDate: iso(NOW + 10 * 24 * H), change24h: 0.05 };
  const c = (eventId, group, there, extra = {}) => ({ eventId, marketId: null, title: eventId, group, score: 0.7, reason: "r", domain: null, there, titleOnly: false, bothWays: false, fallback: null, ...extra });
  const f = (eventId, change24h, extra = {}) => [eventId, { marketId: `${eventId}-m0`, outcomeId: `${eventId}-m0-y`, question: null, venue: "kalshi", status: "open", endDate: iso(NOW + 10 * 24 * H), label: "Yes", price: 0.3, change24h, ...extra }];
  const map = finishMarketMap({
    anchor,
    candidates: [
      c("a", "with", "yes"),
      c("b", "with", "no"),
      c("c", "against", "no"),
      c("d", "against", "yes"),
      c("e", "with", "yes", { bothWays: true }),
      c("f", "theme", null, { titleOnly: true }),
      c("g", "with", "yes", { fallback: { status: "open", endDate: iso(NOW + 2 * 24 * H) } }),
      c("h", "with", "yes"),
      c("i", "against", "yes"),
      c("j", "with", "yes"),
      c("k", "theme", null),
    ],
    facts: new Map([
      f("a", 0.03),
      /* The No there rose with this Yes: as linked. */
      f("b", 0.04, { label: "No", price: 0.7 }),
      /* The No there rose with this Yes, where the link expects the other way. */
      f("c", 0.02, { label: "No", endDate: iso(NOW + 2 * 24 * H) }),
      f("d", -0.03, { status: "resolved", endDate: iso(NOW + 30 * 24 * H) }),
      f("e", 0.004),
      f("f", 0.02),
      /* An event of several markets, none named. */
      ["h", { marketId: null, outcomeId: null, question: null, venue: "kalshi", status: "open", endDate: iso(NOW + 9 * 24 * H), label: null, price: null, change24h: null }],
      f("i", -0.02, { endDate: iso(NOW + 30 * 24 * H) }),
      f("j", 0.02, { endDate: null }),
      f("k", 0.02, { status: "unknown" }),
    ]),
    parts: { with: "ok", against: "ok", theme: "failed" },
    readAt: iso(NOW),
  });
  const by = Object.fromEntries(map.links.map((l) => [l.eventId, l]));
  assert.equal(by.a.moved, "as-linked");
  assert.deepEqual(by.a.checks, []);
  assert.equal(by.a.scope, "market");
  assert.equal(by.b.moved, "as-linked");
  assert.equal(by.b.price, 0.7);
  assert.equal(by.c.moved, "against");
  assert.deepEqual(by.c.checks, [{ code: "endsBefore", days: 8 }, { code: "pricesAgainst" }]);
  /* Settled: no day's verdict and no dates. */
  assert.equal(by.d.moved, null);
  assert.deepEqual(by.d.checks, [{ code: "settled", status: "resolved" }]);
  assert.equal(by.e.moved, "flat");
  assert.deepEqual(by.e.checks, [{ code: "bothWays" }]);
  assert.equal(by.f.moved, null);
  assert.deepEqual(by.f.checks, [{ code: "titleOnly" }]);
  /* Not read: the model's own dates stand in, nothing priced or paired. */
  assert.equal(by.g.scope, "unread");
  assert.equal(by.g.price, null);
  assert.equal(by.g.there, null);
  assert.deepEqual(by.g.checks, [{ code: "endsBefore", days: 8 }]);
  assert.equal(by.h.scope, "event");
  assert.equal(by.h.there, null);
  assert.equal(by.h.moved, null);
  assert.deepEqual(by.i.checks, [{ code: "endsAfter", days: 20 }]);
  assert.equal(by.i.moved, "as-linked");
  /* No date on one side: said, not passed as fine. */
  assert.deepEqual(by.j.checks, [{ code: "datesUnknown" }]);
  /* A status not plainly open is said, not passed as fine. */
  assert.deepEqual(by.k.checks, [{ code: "statusUnknown" }]);
  assert.deepEqual(map.parts, { with: "ok", against: "ok", theme: "failed" });
});

test("a person on No reads the day from No's side", () => {
  const map = finishMarketMap({
    anchor: { eventId: "e0", marketId: "e0-m0", outcomeId: "e0-m0-n", side: "no", endDate: null, change24h: -0.05 },
    candidates: [{ eventId: "a", marketId: null, title: "a", group: "with", score: 0.7, reason: null, domain: null, there: "no", titleOnly: false, bothWays: false, fallback: null }],
    facts: new Map([["a", { marketId: "a-m0", outcomeId: "a-m0-n", question: null, venue: "kalshi", status: "open", endDate: null, label: "No", price: 0.8, change24h: -0.03 }]]),
    parts: { with: "ok", against: "ok", theme: "ok" },
    readAt: iso(NOW),
  });
  /* No here fell five points, No there fell three: together, as linked. */
  assert.equal(map.links[0].moved, "as-linked");
  assert.deepEqual(map.links[0].checks, [{ code: "datesUnknown" }]);
});

function stubProvider({ failRipple = false, slowEvent = null, slowAll = 0, namesake = false } = {}) {
  const calls = { ripple: [], event: [], search: 0, chart: [], live: 0, peak: 0 };
  const ok = (value) => ({ ok: true, value });
  const track = async (read) => {
    calls.live += 1;
    calls.peak = Math.max(calls.peak, calls.live);
    try {
      return await read();
    } finally {
      calls.live -= 1;
    }
  };
  return {
    calls,
    provider: {
      ripple: async (id, mode, limit, side) => {
        calls.ripple.push([id, mode, side]);
        if (failRipple) return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "down" };
        return ok(mode === "expand" ? ripple("expand", [["e1", 0.8, "buy_yes", "Cuts lift risk."], ["e4", 0.5, "buy_yes", "r"], ["e5", 0.4, "buy_yes", "r"]]) : ripple("hedge", [["e2", 0.6, "buy_no", "The other side."]]));
      },
      /* This market's twin comes without its event too: it must not spend a search. */
      related: async () => ok([related("e0-m0-k", 0.98), related("e3-m0", 0.5), related("e0-m0", 0.99, { venueEventId: "e0" })]),
      search: (q) =>
        track(async () => {
          calls.search += 1;
          if (slowAll) await new Promise((r) => setTimeout(r, slowAll));
          return ok([{ id: "zz", title: "Other" }, { id: namesake ? "n3" : "e3", title: q.toUpperCase() }]);
        }),
      event: (id) =>
        track(async () => {
          calls.event.push(id);
          if (id === slowEvent) await new Promise((r) => setTimeout(r, 400));
          if (slowAll) await new Promise((r) => setTimeout(r, slowAll));
          await new Promise((r) => setTimeout(r, 5));
          return ok(event(id));
        }),
      chart: async (outcomeId) => {
        calls.chart.push(outcomeId);
        return ok({ bars: [{ t: Date.now() - 30 * H, c: 0.3 }, { t: Date.now(), c: 0.35 }] });
      },
    },
  };
}

test("the map read: the outcome's side to the cascade, its own bars, a same-theme event by its exact title, four at a time, kept a minute", async () => {
  const { provider, calls } = stubProvider();
  const anchor = event("e0");
  const map = await readMarketMap(provider, anchor, anchor.markets[0], "e0-m0-n");
  assert.deepEqual(calls.ripple, [
    ["e0-m0", "expand", "no"],
    ["e0-m0", "hedge", "no"],
  ]);
  assert.equal(calls.chart[0], "e0-m0-n");
  assert.ok(calls.chart.includes("e2-m0-n"));
  assert.deepEqual(
    map.links.map((l) => [l.group, l.eventId]),
    [
      ["with", "e1"],
      ["with", "e4"],
      ["with", "e5"],
      ["against", "e2"],
      ["theme", "e3"],
    ],
  );
  assert.equal(calls.search, 1);
  assert.ok(calls.peak <= 4);
  assert.equal(map.anchor.side, "no");
  assert.ok(Math.abs(map.anchor.change24h - 0.05) < 1e-9);
  const again = await readMarketMap(provider, anchor, anchor.markets[0], "e0-m0-n");
  assert.equal(again, map);
  assert.equal(calls.event.length, 5);
});

test("the map read: a failed read is its group's state and is kept only seconds; a slow market is drawn without its facts", async () => {
  const { provider, calls } = stubProvider({ failRipple: true, slowEvent: "e3" });
  const anchor = event("e9");
  const map = await readMarketMap(provider, anchor, anchor.markets[0], "e9-m0-y", { budgetMs: 100 });
  assert.deepEqual(map.parts, { with: "failed", against: "failed", theme: "ok" });
  const slow = map.links.find((l) => l.eventId === "e3");
  assert.equal(slow.scope, "unread");
  assert.equal(slow.price, null);
  assert.equal(map.links.find((l) => l.eventId === "e0").status, "open");
  await new Promise((r) => setTimeout(r, 10));
  const again = await readMarketMap(provider, anchor, anchor.markets[0], "e9-m0-y", { budgetMs: 100 });
  /* Within seconds the same answer, so an outage is not asked again on every view. */
  assert.equal(again, map);
  assert.equal(calls.ripple.length, 2);
});

test("the map read: a same-theme market found under a namesake event is left out, not drawn from the namesake", async () => {
  const { provider } = stubProvider({ namesake: true });
  const anchor = event("e8");
  const map = await readMarketMap(provider, anchor, anchor.markets[0], "e8-m0-y");
  assert.equal(map.links.some((l) => l.eventId === "n3"), false);
  assert.equal(map.links.some((l) => l.eventId === "e3"), false);
});

test("the map read: the whole map within its deadline, however slow each read is", async () => {
  const { provider } = stubProvider({ slowAll: 80 });
  const anchor = event("e7");
  const started = Date.now();
  const map = await readMarketMap(provider, anchor, anchor.markets[0], "e7-m0-y", { budgetMs: 100, deadlineMs: 150 });
  assert.ok(Date.now() - started < 400, `took ${Date.now() - started} ms`);
  assert.ok(map.links.some((l) => l.scope === "unread"));
});

test("the map read: an outcome whose side is not known asks only for the theme", async () => {
  const { provider, calls } = stubProvider();
  const anchor = event("e6");
  const market = { ...anchor.markets[0], outcomes: [{ id: "a", label: "A", probability: 0.3 }, { id: "b", label: "B", probability: 0.3 }, { id: "c", label: "C", probability: 0.4 }] };
  const map = await readMarketMap(provider, anchor, market, "c");
  assert.equal(calls.ripple.length, 0);
  assert.equal(map.anchor.side, null);
  assert.ok(map.links.length > 0);
  assert.ok(map.links.every((l) => l.group === "theme"));
});
