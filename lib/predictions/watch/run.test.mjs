// Run from repo root: node --test lib/predictions/watch/run.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { getPredictionProvider, resetAggAdapterCache } from "../agg/adapter.ts";
import { listNotes, readPrefs, writePrefs } from "../notify/channel.ts";
import { predictionNoteWords } from "../notify/words.ts";
import { writeLink } from "../session.ts";
import { seal } from "../vault.ts";
import { sweepWatch } from "./run.ts";
import { normalizeRule } from "./rules.ts";
import { listWatchRules, listWatchSignals, markSignalsRead, putWatchRule, setWatchRuleOn, stopEveryWatchRule } from "./store.ts";

/*
 * Market watching end to end, replayed against the aggregator's own answers
 * (`fixtures/agg-watch.json`) through the real adapter and SDK. Every kind of
 * rule is set and made to ring; then the things that must never happen — a
 * gap in the watching announced as a crossing, one happening told twice, a
 * note sent inside a quiet hour, more notes in an hour than the person
 * allowed — and the signal's own states on the way from detected to stale.
 * The provider is a local server; nothing leaves this machine.
 */

const WATCH = JSON.parse(readFileSync(new URL("../fixtures/agg-watch.json", import.meta.url), "utf8"));
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const SECRET = "test-secret-of-sufficient-length";
process.env.BETA_TOKEN_SECRET = SECRET;
const ENV = { BETA_TOKEN_SECRET: SECRET };
const HOUR = 3_600_000;

const SUBJECT = { eventId: "ev1", eventTitle: "December rate decision", venueMarketId: "m1", question: "Will the rate hold in December?", outcomeId: "o-yes", outcomeLabel: "Yes" };

const rule = (kind, over = {}) => normalizeRule({ kind, subject: SUBJECT, direction: over.direction ?? "above", threshold: over.threshold ?? null, windowMinutes: over.windowMinutes ?? null, note: null });

/** Hourly bars ending at `now`; `from` is every earlier close, `close` the last. */
function bars(now, count, close, options = {}) {
  const data = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const c = i === 0 ? close : (options.from ?? close);
    data.push({ t: now - i * HOUR, o: c, h: c, l: c, c, v: i === 0 ? (options.lastVolume ?? 100) : (options.volume ?? 100) });
  }
  return { status: 200, body: { ...WATCH.chartShell, data, meta: { staleSeconds: 10, lastBarOpenTime: data.at(-1).t } } };
}

/** The news fixture with its moments filled in around the test's clock. */
function news(key, now) {
  const body = structuredClone(WATCH[key].body);
  for (const group of body.results) {
    for (const article of group.articles) {
      if (article.publishedAt === "{{fresh}}") article.publishedAt = new Date(now - 10 * 60_000).toISOString();
      if (article.publishedAt === "{{older}}") article.publishedAt = new Date(now - 5 * HOUR).toISOString();
    }
  }
  return { status: 200, body };
}

/** The midpoints fixture with the provider's stamp set to the test's clock. */
function midpoints(key, now) {
  const body = structuredClone(WATCH[key].body);
  for (const row of body.data) {
    if (row.timestamp === 1761480000000) {
      row.timestamp = now - 30_000;
      for (const matched of row.matched ?? []) matched.timestamp = now - 30_000;
    }
  }
  return { status: 200, body };
}

function durableStore() {
  return { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
}

function jwt(expSeconds) {
  return `h.${Buffer.from(JSON.stringify({ sub: "u1", exp: expSeconds })).toString("base64url")}.s`;
}

async function linked(store, nowMs) {
  const stamp = new Date(nowMs).toISOString();
  await writeLink(
    store,
    {
      wallet: WALLET,
      externalId: `ryntra:solana:${WALLET}`,
      providerUserId: "agguser",
      providerWallet: WALLET,
      externalIdLinked: true,
      linkAttemptedAt: stamp,
      linkError: null,
      access: seal(jwt(nowMs / 1000 + 3600), { BETA_TOKEN_SECRET: SECRET }),
      refresh: seal("refresh-1", { BETA_TOKEN_SECRET: SECRET }),
      accessExpiresAt: new Date(nowMs + HOUR).toISOString(),
      state: "active",
      stateReason: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    null,
  );
  return store;
}

/**
 * The aggregator, answering from the fixtures. `plan` names the answer per
 * call kind; a function decides from what was seen, a list is answered in
 * turn (its last answer repeats), and `"drop"` closes the socket without an
 * answer. The plan can be swapped between passes, which is what a market that
 * moved looks like from the server's side.
 */
async function aggServer(t, plan = {}) {
  const seen = [];
  const current = { ...plan };
  const answerFor = (kind) => {
    const q = current[kind];
    if (typeof q === "function") return q(seen);
    if (Array.isArray(q)) return q.length > 1 ? q.shift() : q[0];
    return q;
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://agg");
      const body = raw ? JSON.parse(raw) : null;
      const query = Object.fromEntries(url.searchParams);
      seen.push({ method: request.method, path: url.pathname, query, body });
      const p = url.pathname;
      const kind =
        p === "/midpoints" ? "midpoints"
        : p === "/orderbooks" ? "book"
        : p === "/charts/bars" ? (query.venueMarketOutcomeId === "o-yes" ? "bars" : "linkedBars")
        : p === "/news-feed/market-news" ? "news"
        : p.startsWith("/correlated-markets/cascade/") ? "cascade"
        : p === "/venue-events/ev1" ? "event"
        : p === "/venue-events/ev2" ? "linkedEvent"
        : p === "/venue-markets" ? (query.venueEventId === "ev2" ? "linkedMarkets" : "markets")
        : p === "/execution/positions" ? (query.status === "closed" ? "positionsClosed" : "positionsActive")
        : p === "/app/config" ? "config"
        : null;
      const picked = kind ? answerFor(kind) : null;
      if (picked === "drop") {
        request.socket.destroy();
        return;
      }
      const answer = picked === null || picked === undefined ? { status: 404, body: { message: "not here" } } : typeof picked === "string" ? WATCH[picked] : picked;
      response.statusCode = answer.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer.body));
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
  /* The adapter keeps its reads for a few seconds; a pass meant to see a changed market must read it again. */
  return { seen, plan: current, reads: (path) => seen.filter((s) => s.path === path), fresh: () => resetAggAdapterCache() };
}

/** Transports that only record what they were asked to send. */
function spy() {
  const sent = [];
  return { sent, transports: { webpush: async () => "none", telegram: async (wallet, words) => (sent.push(words), "sent") } };
}

const kinds = (rows) => rows.map((r) => r.kind).sort();

/* ------------------------------------------------------------------ each kind of rule, on the provider's own answers */

test("every kind of rule rings on the aggregator's own answers, and nothing rings on the first look", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, {
    midpoints: midpoints("midpointsCalm", now),
    book: "bookFull",
    bars: bars(now, 30, 0.5, { from: 0.5 }),
    linkedBars: bars(now, 30, 0.44, { from: 0.44 }),
    news: news("newsOne", now - 6 * HOUR),
    event: "event",
    markets: "markets",
    linkedEvent: "linkedEvent",
    linkedMarkets: "linkedMarkets",
    cascade: "cascade",
    positionsActive: WATCH.positionsSmall,
    positionsClosed: WATCH.positionsNone,
    config: "appConfigPaper",
  });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();

  const set = [
    rule("price", { direction: "above", threshold: 0.6 }),
    rule("probability_move", { direction: "any", threshold: 0.1, windowMinutes: 1_440 }),
    rule("volume_spike", { threshold: 3, windowMinutes: 1_440 }),
    rule("liquidity", { direction: "any", threshold: 250 }),
    rule("news"),
    rule("resolution"),
    rule("position_value", { direction: "above", threshold: 50 }),
    rule("venue_spread", { threshold: 0.03 }),
    rule("related_move", { direction: "any", threshold: 0.1, windowMinutes: 1_440 }),
  ];
  for (const one of set) assert.equal((await putWatchRule(store, WALLET, one, now)).ok, true);

  /* The first pass is the market as it stands: everything is written down, and the person is told nothing. */
  const first = await sweepWatch(store, provider, WALLET, ENV, now, { transports: sent.transports, locale: "en" });
  assert.equal(first.ok, true);
  assert.equal(first.value.mode, "paper");
  assert.equal(first.value.tally.fired, 0, "a watch that has just started announces nothing that was already true");
  assert.equal(first.value.signals.length, 0);
  assert.equal(sent.sent.length, 0);
  assert.equal(first.value.rules.filter((r) => r.lastCheckedAt !== null).length, 9, "every rule was judged");

  /* Now the market moves: the price crosses, the probability jumps, an hour spikes, the book thins, news lands, the rules are rewritten, the position grows, the venues part, the linked market runs. */
  const later = now + 30 * 60_000;
  Object.assign(agg.plan, {
    midpoints: midpoints("midpointsCrossed", later),
    book: "bookThin",
    bars: bars(later, 30, 0.65, { from: 0.5, lastVolume: 500 }),
    linkedBars: bars(later, 30, 0.58, { from: 0.44 }),
    news: news("newsTwo", later),
    event: "eventRulesChanged",
    markets: "marketsRulesChanged",
    positionsActive: WATCH.positionsBig,
  });
  agg.fresh();

  const second = await sweepWatch(store, provider, WALLET, ENV, later, { transports: sent.transports, locale: "en" });
  assert.equal(second.ok, true);
  const rang = second.value.signals;
  assert.deepEqual(
    rang.map((s) => s.ruleKind).sort(),
    ["liquidity", "news", "position_value", "price", "probability_move", "related_move", "resolution", "venue_spread", "volume_spike"],
    "all nine kinds found their own thing",
  );
  assert.equal(rang.every((s) => s.state === "detected"), true);
  assert.equal(rang.every((s) => s.paper === true), true, "a simulated account is never printed as real money");
  assert.equal(rang.every((s) => s.said.length > 20 && !s.said.includes("undefined")), true, "each signal says what happened in words");
  assert.equal(rang.every((s) => s.explanation === null), true, "with no model switched on, the engine's own sentence stands alone");

  /* Each one reached the person once, in their own language, through the shared channel. */
  const notes = await listNotes(store, WALLET);
  assert.equal(notes.length, 9);
  assert.deepEqual(kinds(notes), ["watch_liquidity", "watch_news", "watch_position_value", "watch_price", "watch_probability_move", "watch_related_move", "watch_resolution", "watch_venue_spread", "watch_volume_spike"]);
  assert.equal(notes.every((n) => n.count === 1), true);
  assert.equal(notes.every((n) => n.delivery === "sent"), true);
  assert.equal(sent.sent.length, 9);

  /* The figures are the provider's, not invented. */
  const price = rang.find((s) => s.ruleKind === "price");
  assert.deepEqual({ was: price.facts.was, now: price.facts.now, level: price.facts.level }, { was: 0.52, now: 0.65, level: 0.6 });
  const headline = rang.find((s) => s.ruleKind === "news");
  assert.equal(headline.facts.headline, "Second statement lands");
  assert.equal(headline.facts.source, "AP");
  const venues = rang.find((s) => s.ruleKind === "venue_spread");
  assert.equal(venues.facts.high, "kalshi");
  const linkedMove = rang.find((s) => s.ruleKind === "related_move");
  assert.equal(linkedMove.facts.linkedQuestion, "Will inflation print above 3%?");
  assert.equal(linkedMove.facts.question, "Will the rate hold in December?", "the watched market keeps its own name beside the linked one");
  const terms = rang.find((s) => s.ruleKind === "resolution");
  assert.equal(terms.facts.which, "rules");
  assert.equal(terms.facts.moved, "text");

  /* And the words a chat carried are the watch's, in both languages. */
  const uk = predictionNoteWords(notes.find((n) => n.kind === "watch_price"), "uk");
  assert.match(uk.title, /Ціна перетнула вашу межу/);
  assert.match(uk.body, /65%/);
});

/* ------------------------------------------------------------------ the same happening, twice */

test("one happening is one signal and one note, however many passes read it", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);

  await sweepWatch(store, provider, WALLET, ENV, now, { transports: sent.transports });
  const later = now + 20 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", later) });
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, later, { transports: sent.transports });
  assert.equal(sent.sent.length, 1);

  /* Two passes at once on the same crossing: one signal, one note, raised rather than doubled. */
  const again = later + 5 * 60_000;
  agg.fresh();
  await Promise.all([
    sweepWatch(store, provider, WALLET, ENV, again, { transports: sent.transports }),
    sweepWatch(store, provider, WALLET, ENV, again, { transports: sent.transports }),
  ]);
  const signals = await listWatchSignals(store, WALLET);
  assert.equal(signals.length, 1, "the happening names itself, so neither pass can make a second of it");
  const notes = await listNotes(store, WALLET);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].delivery, "sent");
  assert.equal(sent.sent.length, 1, "a delivery decided once is not taken again");
});

/* ------------------------------------------------------------------ both sides of one market */

test("both sides of one market are read on their own prices, not on each other's", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const no = { ...SUBJECT, outcomeId: "o-no", outcomeLabel: "No" };
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await putWatchRule(store, WALLET, normalizeRule({ kind: "price", subject: no, direction: "below", threshold: 0.4, windowMinutes: null, note: null }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});

  /* Yes to 65%, so No to 35%: one crossing up, one crossing down, on the same read. */
  const moved = now + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", moved) });
  agg.fresh();
  const pass = await sweepWatch(store, provider, WALLET, ENV, moved, {});
  assert.equal(pass.value.tally.fired, 2);
  const sides = pass.value.signals.map((s) => [s.subject.outcomeLabel, s.facts.now, s.facts.way]).sort();
  assert.deepEqual(sides, [["No", 0.35, "below"], ["Yes", 0.65, "above"]]);
});

/* ------------------------------------------------------------------ a gap in the watching */

test("a market that could not be read is not announced as a crossing when it comes back", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, { transports: sent.transports });

  /* The provider drops the connection: the rule is unavailable, and it keeps what it last saw. */
  Object.assign(agg.plan, { midpoints: "drop" });
  agg.fresh();
  const lost = await sweepWatch(store, provider, WALLET, ENV, now + 10 * 60_000, { transports: sent.transports });
  assert.equal(lost.value.tally.unavailable, 1);
  assert.equal((await listWatchRules(store, WALLET))[0].lastOutcome, "unavailable");

  /* It comes back with the level already crossed. What the market did while nobody could read it was not watched, so it is written down — not sent. */
  const back = now + 20 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", back) });
  agg.fresh();
  const resumed = await sweepWatch(store, provider, WALLET, ENV, back, { transports: sent.transports });
  assert.equal(resumed.value.tally.fired, 0, "reconnecting never announces an old crossing as a new one");
  assert.equal((await listWatchSignals(store, WALLET)).length, 0);
  assert.equal(sent.sent.length, 0);

  /* From there on it watches normally: the price falls back and crosses again, and that is news. */
  const dips = back + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCalm", dips) });
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, dips, { transports: sent.transports });
  const crosses = dips + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crosses) });
  agg.fresh();
  const rang = await sweepWatch(store, provider, WALLET, ENV, crosses, { transports: sent.transports });
  assert.equal(rang.value.tally.fired, 1);
  assert.equal(sent.sent.length, 1);
});

test("a long silence between passes is a gap too, however good the reads are", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});

  /* Two hours later — a deployment, an outage, a scheduler that missed its turn. */
  const after = now + 2 * HOUR;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", after) });
  agg.fresh();
  const resumed = await sweepWatch(store, provider, WALLET, ENV, after, {});
  assert.equal(resumed.value.tally.fired, 0);
  assert.equal((await listWatchRules(store, WALLET))[0].lastOutcome, "rebased");
});

/* ------------------------------------------------------------------ a stale read */

test("a price the provider stamped long ago is not a crossing", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});

  Object.assign(agg.plan, { midpoints: WATCH.midpointsStale });
  agg.fresh();
  const stale = await sweepWatch(store, provider, WALLET, ENV, now + 10 * 60_000, {});
  assert.equal(stale.value.tally.fired, 0);
  assert.equal((await listWatchRules(store, WALLET))[0].lastOutcome, "stale");
  assert.equal((await listWatchSignals(store, WALLET)).length, 0);
});

/* ------------------------------------------------------------------ the states of a signal */

test("a signal goes detected, then confirmed by a later read, then stale when the market leaves it behind", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});

  const crossed = now + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crossed) });
  agg.fresh();
  const detected = await sweepWatch(store, provider, WALLET, ENV, crossed, {});
  assert.equal(detected.value.signals[0].state, "detected");
  assert.equal(detected.value.signals[0].confirmedAt, null, "the read that raised it cannot also confirm it");

  /* Still above on the next pass: confirmed, and nothing is sent again. */
  const again = crossed + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", again) });
  agg.fresh();
  const confirmed = await sweepWatch(store, provider, WALLET, ENV, again, {});
  assert.equal(confirmed.value.signals[0].state, "confirmed");
  assert.ok(confirmed.value.signals[0].confirmedAt);
  assert.equal(confirmed.value.tally.fired, 0);

  /* The price comes back below: the figures behind the signal are no longer the market. */
  const back = again + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCalm", back) });
  agg.fresh();
  const stale = await sweepWatch(store, provider, WALLET, ENV, back, {});
  assert.equal(stale.value.signals[0].state, "stale");
  assert.equal(stale.value.signals[0].reason, "no_longer_there");

  /* A market that cannot be read says nothing either way, and age alone ends a signal. */
  const unread = back + 20 * 60_000;
  await markSignalsRead(store, WALLET, null, unread);
  assert.equal((await listWatchSignals(store, WALLET))[0].state, "read", "a signal the person has read is where they left it");
});

test("a signal older than the quote behind it goes stale by itself, even with the provider down", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});
  const crossed = now + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crossed) });
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, crossed, {});

  Object.assign(agg.plan, { midpoints: "drop" });
  agg.fresh();
  const old = await sweepWatch(store, provider, WALLET, ENV, crossed + 3 * HOUR, {});
  assert.equal(old.value.signals[0].state, "stale");
  assert.equal(old.value.signals[0].reason, "aged");
  assert.equal(old.value.signals[0].aged, true);
});

/* ------------------------------------------------------------------ the channel's own settings */

test("a quiet hour holds a watch note back, and the hour's ceiling leaves the rest in the list", async (t) => {
  const quietNow = Date.parse("2026-10-26T23:10:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", quietNow), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), quietNow);
  const provider = getPredictionProvider();
  const sent = spy();
  await writePrefs(store, WALLET, { quietHours: { start: "22:00", end: "08:00", timezone: "UTC" } }, quietNow);
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), quietNow);
  await sweepWatch(store, provider, WALLET, ENV, quietNow, { transports: sent.transports });

  const crossed = quietNow + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crossed) });
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, crossed, { transports: sent.transports });
  const held = await listNotes(store, WALLET);
  assert.equal(held.length, 1);
  assert.equal(held[0].delivery, "quiet", "a price at two in the morning is not news to send at two in the morning");
  assert.ok(held[0].deliverAfter);
  assert.equal(sent.sent.length, 0);

  /* Once the window has passed the same note leaves, and still only once. */
  const morning = Date.parse("2026-10-27T08:30:00.000Z");
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, morning, { transports: sent.transports });
  const after = await listNotes(store, WALLET);
  assert.equal(after.find((n) => n.kind === "watch_price").delivery, "sent");
  assert.equal(sent.sent.length, 1);
});

test("the person's own ceiling per hour bounds what a busy market can send", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, {
    midpoints: midpoints("midpointsCalm", now),
    book: "bookFull",
    bars: bars(now, 30, 0.5, { from: 0.5 }),
    news: news("newsOne", now - 6 * HOUR),
    event: "event",
    markets: "markets",
    config: "appConfigPaper",
  });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();
  await writePrefs(store, WALLET, { perHour: 1 }, now);
  for (const one of [rule("price", { direction: "above", threshold: 0.6 }), rule("liquidity", { direction: "any", threshold: 250 }), rule("news"), rule("volume_spike", { threshold: 3, windowMinutes: 1_440 })]) {
    await putWatchRule(store, WALLET, one, now);
  }
  await sweepWatch(store, provider, WALLET, ENV, now, { transports: sent.transports });

  const busy = now + 10 * 60_000;
  Object.assign(agg.plan, {
    midpoints: midpoints("midpointsCrossed", busy),
    book: "bookThin",
    bars: bars(busy, 30, 0.65, { from: 0.5, lastVolume: 500 }),
    news: news("newsTwo", busy),
  });
  agg.fresh();
  await sweepWatch(store, provider, WALLET, ENV, busy, { transports: sent.transports });

  const notes = await listNotes(store, WALLET);
  assert.equal(notes.length, 4, "everything that happened is in the list");
  assert.equal(notes.filter((n) => n.delivery === "sent").length, 1);
  assert.equal(notes.filter((n) => n.delivery === "capped").length, 3, "the rest are marked, not lost");
  assert.equal(sent.sent.length, 1);
  assert.equal((await readPrefs(store, WALLET)).perHour, 1);
});

test("one touch stops every watch, and the rules are still there to turn back on", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, { transports: sent.transports });

  assert.equal(await stopEveryWatchRule(store, WALLET, now), 1);
  const crossed = now + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crossed) });
  agg.fresh();
  const quiet = await sweepWatch(store, provider, WALLET, ENV, crossed, { transports: sent.transports });
  assert.equal(quiet.value.tally.fired, 0);
  assert.equal(quiet.value.rules[0].on, false);
  assert.equal(sent.sent.length, 0);

  /* Turned back on, it starts from where the market stands now rather than from the crossing it slept through. */
  await setWatchRuleOn(store, WALLET, quiet.value.rules[0].id, true, crossed);
  agg.fresh();
  const resumed = await sweepWatch(store, provider, WALLET, ENV, crossed + 5 * 60_000, { transports: sent.transports });
  assert.equal(resumed.value.tally.fired, 0);
  assert.equal(sent.sent.length, 0);
});

/* ------------------------------------------------------------------ a read is a read */

test("reading the watch judges nothing and sends nothing", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCrossed", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  const sent = spy();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);

  const read = await sweepWatch(store, provider, WALLET, ENV, now, { judge: false, transports: sent.transports });
  assert.equal(read.ok, true);
  assert.equal(read.value.rules.length, 1);
  assert.equal(read.value.rules[0].lastCheckedAt, null, "looking at the page does not judge a rule");
  assert.equal(agg.reads("/midpoints").length, 0, "and it does not even read the market");
  assert.equal(sent.sent.length, 0);
});

/* ------------------------------------------------------------------ the model's sentence */

test("a model's sentence is kept only when it stands on the figures the engine read", async (t) => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const agg = await aggServer(t, { midpoints: midpoints("midpointsCalm", now), event: "event", markets: "markets", config: "appConfigPaper" });
  const store = await linked(durableStore(), now);
  const provider = getPredictionProvider();
  await putWatchRule(store, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  await sweepWatch(store, provider, WALLET, ENV, now, {});

  const crossed = now + 10 * 60_000;
  Object.assign(agg.plan, { midpoints: midpoints("midpointsCrossed", crossed) });

  /* A model that invents a read: the sentence goes, and the engine's own words carry the signal. */
  agg.fresh();
  const invented = await sweepWatch(store, provider, WALLET, ENV, crossed, { explain: async () => "That is the fourth such move in 9 sessions" });
  assert.equal(invented.value.tally.fired, 1);
  assert.equal(invented.value.tally.explained, 0);
  assert.equal(invented.value.signals[0].explanation, null);
  assert.ok(invented.value.signals[0].said.includes("65%"));

  /* A model that stays on them: the sentence stands beside the figures, and reaches the chat with them. */
  const store2 = await linked(durableStore(), now);
  const sent = spy();
  await putWatchRule(store2, WALLET, rule("price", { direction: "above", threshold: 0.6 }), now);
  agg.plan.midpoints = midpoints("midpointsCalm", now);
  agg.fresh();
  await sweepWatch(store2, provider, WALLET, ENV, now, {});
  agg.plan.midpoints = midpoints("midpointsCrossed", crossed);
  agg.fresh();
  const kept = await sweepWatch(store2, provider, WALLET, ENV, crossed, {
    transports: sent.transports,
    explain: async () => "Crossing 60% puts the market past the level its own terms never mention",
  });
  assert.equal(kept.value.tally.explained, 1);
  assert.match(kept.value.signals[0].explanation, /never mention\.$/);
  assert.match(sent.sent[0].body, /never mention/);
});

/* ------------------------------------------------------------------ it buys nothing */

test("nothing in the watch can reach a quote, an order, a signature or a payout", async () => {
  const { readdirSync, readFileSync: read } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL(".", import.meta.url));
  /* The modules that move money, by the names a watch would have to import to reach them. */
  const forbidden = [/from "\.\.\/paper\.ts"/, /from "\.\.\/redeem\.ts"/, /from "\.\.\/settle(-run)?\.ts"/, /from "\.\.\/agg-orders\.ts"/, /from "\.\.\/fee-ledger\.ts"/, /from "\.\.\/vault\.ts"/, /\bquotePaper\b/, /\bplacePaper\b/, /\bprovider\.execute\b/, /\bprovider\.route\b/, /\bprovider\.redeem\b/, /\bprovider\.withdraw\b/, /\bcollectMarkets\b/];
  const sources = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  assert.ok(sources.length >= 7, "the watch's own modules were found");
  for (const name of sources) {
    const text = read(`${dir}${name}`, "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${name} must not reach ${pattern}`);
  }
  /* The money switches are read for one reason only — to mark a simulated account — and never set. */
  const pass = read(`${dir}run.ts`, "utf8");
  assert.equal(/PREDICTIONS_LIVE_\w+\s*=/.test(pass), false, "the watch never switches live money on");
});
