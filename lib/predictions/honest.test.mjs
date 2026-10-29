// Run from repo root: node --test lib/predictions/honest.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { cadenceLabel, cardPhase, durationMs, hubList, seriesKey, shortRound } from "./hub-lists.ts";
import { IN_PLAY_MS, eventInPlay, gameLengthMs, eventStatus, eventTradable, leadMarket, mapEventSummary, marketTradable } from "./model.ts";
import { DEFAULT_PREFS, changePrefs, parsePrefs } from "./preferences.ts";
import { THESES_FRESH_MS, freshTheses } from "./theses.ts";
import { chanceHero, chanceSecond } from "./units.ts";

const NOW = Date.parse("2026-10-21T20:00:00Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const H = 3_600_000;

const outcome = (id, label, price, winner = null) => ({ id, label, price, winner, venueMarketId: id.split(":")[0] });
const vmarket = (id, status, yes, winner = null) => ({ id, status, question: id, venueMarketOutcomes: [outcome(`${id}:y`, "Yes", yes, winner), outcome(`${id}:n`, "No", 1 - yes, winner == null ? null : !winner)] });
const vevent = (over) => ({ id: "e", title: "Event", venue: "polymarket", venues: ["polymarket"], status: "open", volume: 1, endDate: at(10 * H), categories: [], ...over });

test("the card leads with a market still trading, not a settled one's leftover price", () => {
  const markets = [vmarket("a", "resolved", 0.995, true), vmarket("b", "open", 0.48)];
  assert.equal(leadMarket(markets).id, "b");
  assert.equal(leadMarket([vmarket("a", "closed", 0.01)]).id, "a");
  assert.equal(leadMarket([]), undefined);
  const summary = mapEventSummary(vevent({ venueMarkets: markets, marketCount: 2 }), new Map([["b", 0.48]]));
  assert.equal(summary.leading[0].venueMarketId, "b");
  assert.equal(summary.leadingQuestion, "b");
  assert.equal(summary.status, "open");
});

test("an event every market of which stopped is not open, whatever the venue says of the event", () => {
  assert.equal(eventStatus({ status: "open", venueMarkets: [vmarket("a", "resolved", 0.01, false), vmarket("b", "resolved", 0.02, false)] }), "resolved");
  assert.equal(eventStatus({ status: "open", venueMarkets: [vmarket("a", "resolved", 0.01, false), vmarket("b", "closed", 0.02)] }), "closed");
  assert.equal(eventStatus({ status: "open", venueMarkets: [vmarket("a", "resolved", 0.01, false), vmarket("b", "open", 0.4)] }), "open");
  /* A partial list says nothing of the markets left out. */
  assert.equal(eventStatus({ status: "open", marketCount: 5, venueMarkets: [vmarket("a", "resolved", 0.01, false)] }), "open");
  assert.equal(eventStatus({ status: "open", venueMarkets: [] }), "open");
  assert.equal(eventStatus({ status: "settled", venueMarkets: [vmarket("a", "open", 0.4)] }), "resolved");
});

test("past its close an event is awaiting a result, never an offer", () => {
  assert.equal(eventTradable({ status: "open", endDate: at(H) }, NOW), true);
  assert.equal(eventTradable({ status: "open", endDate: at(-31 * 60_000) }, NOW), false);
  assert.equal(eventTradable({ status: "unknown", endDate: null }, NOW), true);
  assert.equal(eventTradable({ status: "closed", endDate: at(H) }, NOW), false);
  assert.equal(cardPhase({ title: "x", status: "open", endDate: at(-60_000) }, NOW), "awaiting");
  assert.equal(cardPhase({ title: "x", status: "resolved", endDate: at(H) }, NOW), "resolved");
  assert.equal(cardPhase({ title: "x", status: "open", endDate: at(H) }, NOW), "live");
  assert.equal(marketTradable({ status: "open", outcomes: [{ winner: null }, { winner: null }] }), true);
  assert.equal(marketTradable({ status: "open", outcomes: [{ winner: true }, { winner: false }] }), false);
  assert.equal(marketTradable({ status: "closed", outcomes: [{ winner: null }] }), false);
});

test("a five-minute or hourly «Up or Down» round is short; a daily one and other titles are not", () => {
  assert.equal(shortRound({ title: "BNB Up or Down - October 21, 10:10PM-10:15PM ET" }), true);
  assert.equal(shortRound({ title: "Bitcoin Up or Down - October 21, 10PM ET" }), true);
  assert.equal(shortRound({ title: "Ethereum up or down - Oct 21, 9:00 a.m. ET" }), true);
  assert.equal(shortRound({ title: "Bitcoin Up or Down on October 22?" }), false);
  assert.equal(shortRound({ title: "Fed decision at 2PM ET?" }), false);
  assert.equal(shortRound({ title: "Will stocks go up or down this year?" }), false);
});

test("browsed tabs list only what trades; New holds the short rounds back unless asked; search and the watchlist keep all", () => {
  const live = { title: "Fed decision", status: "open", endDate: at(10 * H) };
  const ended = { title: "MTSU vs FIU", status: "open", endDate: at(-31 * 60_000) };
  const settled = { title: "Settled", status: "resolved", endDate: at(H) };
  const round = { title: "XRP Up or Down - October 21, 10:10PM-10:15PM ET", status: "open", endDate: at(14 * 60_000) };
  const all = [live, ended, settled, round];
  assert.deepEqual(hubList(all, { tab: "trending", searching: false, rounds: false }, NOW).events, [live, round]);
  assert.deepEqual(hubList(all, { tab: "category:crypto", searching: false, rounds: false }, NOW).events, [live, round]);
  const fresh = hubList(all, { tab: "newest", searching: false, rounds: false }, NOW);
  assert.deepEqual(fresh.events, [live]);
  assert.equal(fresh.heldRounds, 1);
  assert.deepEqual(hubList(all, { tab: "newest", searching: false, rounds: true }, NOW).events, [live, round]);
  assert.deepEqual(hubList(all, { tab: "newest", searching: true, rounds: false }, NOW).events, all);
  assert.deepEqual(hubList(all, { tab: "watchlist", searching: false, rounds: false }, NOW).events, all);
});

test("the large figure is the market's estimate; a payout leads only when chosen, and never for a long shot", () => {
  assert.deepEqual(chanceHero(0.87, "percent", 10), { text: "87%", units: "percent" });
  assert.deepEqual(chanceHero(0.87, "payout", 10), { text: "$10 → ≈$11.49", units: "payout" });
  assert.deepEqual(chanceHero(0.034, "payout", 10), { text: "3.4%", units: "percent" });
  assert.deepEqual(chanceHero(0.62, "cents", 10), { text: "62¢", units: "cents" });
  assert.equal(chanceSecond(0.87, "percent", 10, "Yes", "en"), "$10 → ≈$11.49 if Yes");
  assert.equal(chanceSecond(0.87, "percent", 10, "Так", "uk"), "$10 → ≈$11.49, якщо «Так»");
  assert.equal(chanceSecond(0.87, "payout", 10, "Yes", "en"), "87% chance");
  assert.equal(chanceSecond(0.034, "payout", 10, "Yes", "en"), "$10 → ≈$294.12 if Yes");
  assert.equal(chanceSecond(0.87, "percent", 10, "", "en"), "$10 → ≈$11.49");
  assert.equal(chanceSecond(null, "percent", 10, "Yes", "en"), "");
  assert.equal(chanceSecond(0, "percent", 10, "Yes", "en"), "");
});

test("the market's estimate is the default; a payout kept only as the old default gives way, a chosen one stays", () => {
  assert.equal(DEFAULT_PREFS.units, "percent");
  assert.equal(parsePrefs({ v: 1, units: "payout", density: "compact", at: { density: 5 }, updatedAt: 5 }).units, "percent");
  assert.equal(parsePrefs({ v: 1, units: "payout", updatedAt: 5 }).units, "percent");
  const chosen = changePrefs(DEFAULT_PREFS, { units: "payout" }, 9);
  assert.equal(parsePrefs(JSON.parse(JSON.stringify(chosen))).units, "payout");
  assert.equal(parsePrefs({ v: 1, units: "odds", updatedAt: 5 }).units, "odds");
});

test("model notes: shown only while fresh, without the side they lean to or the model's name", () => {
  const batch = (createdAt) => ({ sourceModel: "gemini/x", promptVersion: 4, createdAt, signals: [{ id: "1", text: " A thesis. ", side: "YES", direction: "more_likely", domain: "real_estate" }, { id: "2", text: "  ", side: "NO", direction: "more_likely", domain: "x" }] });
  assert.deepEqual(freshTheses(batch(at(-2 * 24 * H)), NOW), { texts: [{ id: "1", text: "A thesis." }], writtenAt: at(-2 * 24 * H) });
  assert.equal(freshTheses(batch(at(-THESES_FRESH_MS - 1)), NOW), null);
  assert.equal(freshTheses(batch("2026-06-18T09:00:00Z"), NOW), null);
  assert.equal(freshTheses(batch("not a date"), NOW), null);
  assert.equal(freshTheses(null, NOW), null);
  assert.equal(freshTheses({ ...batch(at(-H)), signals: [] }, NOW), null);
});

test("a market page offers a market only while it trades and its close is ahead, the same rule as the hub", async () => {
  const { marketLive } = await import("./resolution.ts");
  const m = (over) => ({ status: "open", outcomes: [{ label: "Yes", winner: null }, { label: "No", winner: null }], endDate: at(10 * H), resolutionDate: null, ...over });
  assert.equal(marketLive(m({}), null, NOW), true);
  /* The venue still lists it open, but its date passed: awaiting, never an offer. */
  assert.equal(marketLive(m({ endDate: at(-31 * 60_000) }), null, NOW), false);
  assert.equal(marketLive(m({ endDate: null }), at(-H), NOW), false);
  assert.equal(marketLive(m({ outcomes: [{ label: "Yes", winner: true }, { label: "No", winner: false }] }), null, NOW), false);
  assert.equal(marketLive(m({ status: "closed" }), null, NOW), false);
  /* A status the product cannot read takes no order, as before. */
  assert.equal(marketLive(m({ status: "unknown" }), null, NOW), false);
});

test("a winner named on an «open» market settles it; a lead with nothing still trading carries no price", () => {
  const winnerOpen = vmarket("w", "open", 0.995, true);
  assert.equal(leadMarket([winnerOpen, vmarket("b", "open", 0.4)]).id, "b");
  assert.equal(eventStatus({ status: "open", venueMarkets: [winnerOpen] }), "resolved");
  /* A partial list whose markets in hand all stopped: the event stays open, its card shows no leftover price. */
  const partial = mapEventSummary(vevent({ marketCount: 50, venueMarkets: [vmarket("a", "resolved", 0.995, true)] }), new Map([["a", 0.995]]));
  assert.equal(partial.status, "open");
  assert.deepEqual(partial.leading.map((o) => o.probability), [null, null]);
});

test("a 24-hour clock window is a short round too", () => {
  assert.equal(shortRound({ title: "Solana Up or Down - October 21, 22:10–22:15 ET" }), true);
  assert.equal(shortRound({ title: "Solana Up or Down in October" }), false);
  assert.equal(shortRound({ title: "Bitcoin Up or Down on October 21 (12:00 ET)" }), false);
});

test("a card and its page read the same close: a market past its own date never leads a card or prices it", () => {
  const byOct21 = { ...vmarket("d21", "open", 0.02), endDate: at(-30 * 60_000) };
  const byOct25 = { ...vmarket("d25", "open", 0.31), endDate: at(4 * 24 * H) };
  assert.equal(leadMarket([byOct21, byOct25], NOW).id, "d25");
  const summary = mapEventSummary(vevent({ endDate: at(4 * 24 * H), marketCount: 2, venueMarkets: [byOct21, byOct25] }), new Map([["d21", 0.02], ["d25", 0.31]]), NOW);
  assert.equal(summary.leading[0].venueMarketId, "d25");
  assert.equal(summary.leading[0].probability, 0.31);
  /* Only the passed one in hand, more markets left out: no leftover price on the card. */
  const alone = mapEventSummary(vevent({ endDate: at(4 * 24 * H), marketCount: 3, venueMarkets: [byOct21] }), new Map([["d21", 0.02]]), NOW);
  assert.equal(alone.status, "open");
  assert.deepEqual(alone.leading.map((o) => o.probability), [null, null]);
});

test("the series cadence decides a round before the title does; a daily or one-off series is never short", () => {
  assert.equal(durationMs("PT5M"), 5 * 60_000);
  assert.equal(durationMs("PT1H"), 3_600_000);
  assert.equal(durationMs("P1D"), 24 * H);
  assert.equal(durationMs("P1W"), 7 * 24 * H);
  assert.equal(durationMs("pt"), null);
  assert.equal(shortRound({ title: "BTC Up or Down - week of Oct 20, 4PM ET", recurrence: "P1W" }), false);
  assert.equal(durationMs("nonsense"), null);
  assert.equal(shortRound({ title: "Bitcoin price at noon", recurrence: "PT15M" }), true);
  assert.equal(shortRound({ title: "BNB Up or Down - October 21, 10:10PM-10:15PM ET", recurrence: "P1D" }), false);
  assert.equal(shortRound({ title: "BNB Up or Down - October 21, 10:10PM-10:15PM ET", recurrence: null }), true);
  assert.equal(cadenceLabel("PT5M", "en"), "5 min");
  assert.equal(cadenceLabel("PT4H", "uk"), "4 год");
  assert.equal(cadenceLabel("P1D", "en"), null);
  assert.equal(seriesKey({ title: "BNB Up or Down - October 21, 10:10PM-10:15PM ET", recurrence: "PT5M" }), "PT5M|bnb up or down");
  assert.notEqual(seriesKey({ title: "Bitcoin Up or Down - 10PM ET", recurrence: "PT1H" }), seriesKey({ title: "Bitcoin Up or Down - 10:10PM-10:15PM ET", recurrence: "PT5M" }));
});

test("asked for, the short rounds stand one card per series, the round that closes soonest", () => {
  const round = (coin, mins) => ({ title: `${coin} Up or Down - October 21, ${mins}`, status: "open", endDate: at(Number(mins) * 60_000), recurrence: "PT5M" });
  const live = { title: "ECB cuts", status: "open", endDate: at(50 * 24 * H), recurrence: null };
  const all = [round("BNB", "10"), round("BNB", "5"), round("XRP", "15"), live];
  const held = hubList(all, { tab: "newest", searching: false, rounds: false }, NOW);
  assert.deepEqual(held.events, [live]);
  assert.equal(held.heldRounds, 3);
  const shown = hubList(all, { tab: "newest", searching: false, rounds: true }, NOW).events.map((e) => e.title);
  assert.deepEqual(shown, ["BNB Up or Down - October 21, 5", "XRP Up or Down - October 21, 15", "ECB cuts"]);
});

test("a game under way trades through play: the venue's date is the kick-off, not the end", () => {
  const game = { status: "open", sport: "basketball", gameStartTime: at(-40 * 60_000), endDate: at(3 * H) };
  assert.equal(eventInPlay(game, NOW), true);
  assert.equal(eventTradable(game, NOW), true);
  assert.equal(cardPhase({ title: "x", ...game }, NOW), "live");
  /* The game's own end has passed: over, whatever the venue still lists — never a live offer. */
  assert.equal(eventInPlay({ ...game, gameStartTime: at(-150 * 60_000), endDate: at(-31 * 60_000) }, NOW), false);
  assert.equal(eventTradable({ ...game, gameStartTime: at(-150 * 60_000), endDate: at(-31 * 60_000) }, NOW), false);
  /* The event dated to the settlement day: a basketball game seven hours after tip-off is over, its leftover prices no offer. */
  assert.equal(eventInPlay({ ...game, gameStartTime: at(-7 * H), endDate: at(17 * H) }, NOW), false);
  assert.equal(eventInPlay({ ...game, gameStartTime: at(-3 * H), endDate: at(17 * H) }, NOW), true);
  /* Each sport its own length: a tennis match five hours in still plays, a soccer match does not. */
  assert.equal(eventInPlay({ ...game, sport: "tennis", gameStartTime: at(-5 * H) }, NOW), true);
  assert.equal(eventInPlay({ ...game, sport: "soccer", gameStartTime: at(-5 * H) }, NOW), false);
  assert.equal(gameLengthMs("american_football"), gameLengthMs("football"));
  assert.equal(eventInPlay({ ...game, sport: "darts", endDate: null, gameStartTime: at(-IN_PLAY_MS - 1) }, NOW), false);
  assert.equal(eventInPlay({ ...game, gameStartTime: at(10 * 60_000) }, NOW), false);
  assert.equal(eventInPlay({ ...game, status: "resolved" }, NOW), false);
  assert.equal(eventInPlay({ ...game, sport: null }, NOW), false);
  /* Its open market past the kick-off leads the card with its price; a resolved one still never does. */
  const moneyline = { ...vmarket("ml", "open", 0.61), endDate: at(-40 * 60_000) };
  const settled = { ...vmarket("sp", "resolved", 0.99, true), endDate: at(-40 * 60_000) };
  const summary = mapEventSummary(vevent({ ...game, marketCount: 2, venueMarkets: [settled, moneyline] }), new Map([["ml", 0.61]]), NOW);
  assert.equal(summary.leading[0].venueMarketId, "ml");
  assert.equal(summary.leading[0].probability, 0.61);
  assert.equal(summary.sport, "basketball");
  assert.equal(eventStatus({ ...game, venueMarkets: [moneyline] }, NOW), "open");
});

test("a market page keeps a game's market live through play, and only then", async () => {
  const { marketLive } = await import("./resolution.ts");
  const m = { status: "open", outcomes: [{ label: "Yes", winner: null }, { label: "No", winner: null }], endDate: at(-40 * 60_000), resolutionDate: null };
  assert.equal(marketLive(m, null, NOW, true), true);
  assert.equal(marketLive(m, null, NOW, false), false);
  assert.equal(marketLive({ ...m, outcomes: [{ label: "Yes", winner: true }, { label: "No", winner: false }] }, null, NOW, true), false);
});
