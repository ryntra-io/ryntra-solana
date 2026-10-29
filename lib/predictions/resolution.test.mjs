// Run from repo root: node --test lib/predictions/resolution.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { historyOf, nextRulesRecord, observeRules, RULES_CHANGES_KEPT, venueMarketsOf } from "./rules-history.ts";
import { DEADLINE_WARN_MS, RESULT_GRACE_MS, resolutionBrief, rulesDiff, rulesFingerprint, rulesSnapshot, sentences, settlementPhase, SETTLEMENT_LATE_MS } from "./resolution.ts";
import { settlementDate, settlementPoints, settlementSeverity } from "./settlement.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const H = 3_600_000;

/* One event on three venues that settle it differently — the way the venues write their rules. */
const POLY_RULES =
  'This market will resolve to "Yes" if the upper bound of the target federal funds rate is lowered after the FOMC meeting scheduled for October 28-29, 2026. Otherwise, this market will resolve to "No". The resolution source for this market will be the FOMC statement published at https://www.federalreserve.gov/monetarypolicy.htm. If the meeting is postponed past November 15, 2026, this market will resolve to "No". If no statement is released by the end date, the market may be resolved 50-50.';
const KALSHI_PRIMARY = "If the Federal Reserve lowers the upper bound of the target rate at its October 2026 meeting, then the market resolves to Yes.";
const KALSHI_SECONDARY = "The market settles based on the official FOMC statement. If the meeting is cancelled, the market will settle to No. Source agencies: Federal Reserve.";
const LIMITLESS_DESC = "Will the Fed cut rates in October 2026? Resolves according to the Fed's press release. Trading ends at 18:00 UTC on October 29.";

function market(overrides = {}) {
  return {
    id: "m-poly",
    venue: "polymarket",
    question: "Fed cuts rates in October?",
    status: "open",
    outcomes: [
      { id: "y", label: "Yes", probability: 0.62, venueMarketId: "m-poly", winner: null, matched: [] },
      { id: "n", label: "No", probability: 0.38, venueMarketId: "m-poly", winner: null, matched: [] },
    ],
    volume: 1000,
    endDate: "2026-10-29T18:00:00.000Z",
    resolutionDate: "2026-10-30T00:00:00.000Z",
    description: null,
    rules: { primary: POLY_RULES, secondary: null },
    tickSize: 0.01,
    minOrderSize: null,
    aggKey: null,
    arbReturn: null,
    matched: [
      { id: "m-kalshi", venue: "kalshi", question: "Fed cut in October?", status: "open", outcomes: [], volume: 500, description: null, rules: { primary: KALSHI_PRIMARY, secondary: KALSHI_SECONDARY } },
      { id: "m-lim", venue: "limitless", question: "Fed cut October?", status: "open", outcomes: [], volume: 50, description: LIMITLESS_DESC, rules: { primary: null, secondary: null } },
    ],
    image: null,
    ...overrides,
  };
}

const SETTLEMENT = {
  sharedSummary: "All venues track an October 2026 cut of the upper bound of the target rate.",
  differences: [
    { type: "resolution_source", title: "Resolution source", summary: null, perVenue: { polymarket: "FOMC statement", kalshi: "FOMC statement", limitless: "Fed press release" } },
    { type: "end_date", title: "End date", summary: null, perVenue: { polymarket: "2026-10-29T18:00:00Z", kalshi: "2026-10-29T18:00:00.000Z", limitless: "2026-10-29" } },
    { type: "edge_cases", title: "Postponed meeting", summary: "Polymarket waits until Nov 15; Kalshi settles No.", perVenue: { polymarket: "Resolves No if postponed past Nov 15", kalshi: "Settles No if cancelled" } },
  ],
};

test("the brief picks the venue's own sentences: when Yes wins, who decides, the exceptions", () => {
  const brief = resolutionBrief(market());
  assert.match(brief.yesWhen, /^This market will resolve to "Yes" if the upper bound/);
  assert.match(brief.source.text, /^The resolution source for this market/);
  assert.equal(brief.source.url, "https://www.federalreserve.gov/monetarypolicy.htm");
  assert.equal(brief.exceptions.length, 2);
  assert.match(brief.exceptions[0], /postponed past November 15/);
  assert.match(brief.exceptions[1], /50-50/);
  assert.equal(brief.closesAt, "2026-10-29T18:00:00.000Z");
  assert.equal(brief.resolvesBy, "2026-10-30T00:00:00.000Z");
  /* «Otherwise … No» is neither the win condition nor an exception. */
  assert.ok(!brief.exceptions.some((s) => s.startsWith("Otherwise")));
});

test("each venue's rules read in its own shape: Kalshi's If-then and source agencies, a description alone", () => {
  const kalshi = resolutionBrief({ description: null, rules: { primary: KALSHI_PRIMARY, secondary: KALSHI_SECONDARY }, endDate: null, resolutionDate: null }, "2026-10-29T18:00:00Z");
  assert.equal(kalshi.yesWhen, KALSHI_PRIMARY);
  assert.equal(kalshi.source.text, "The market settles based on the official FOMC statement.");
  assert.equal(kalshi.source.url, null);
  assert.deepEqual(kalshi.exceptions, ["If the meeting is cancelled, the market will settle to No."]);
  assert.equal(kalshi.closesAt, "2026-10-29T18:00:00Z", "the event's date stands in for a market without one");
  const lim = resolutionBrief({ description: LIMITLESS_DESC, rules: { primary: null, secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(lim.yesWhen, null, "no sentence says when Yes wins: unanswered, never guessed");
  assert.equal(lim.source.text, "Resolves according to the Fed's press release.");
  const none = resolutionBrief({ description: null, rules: { primary: null, secondary: null }, endDate: null, resolutionDate: null });
  assert.deepEqual(none, { yesWhen: null, source: null, exceptions: [], closesAt: null, resolvesBy: null });
});

test("sentences keep addresses, decimals, abbreviations and quoted periods whole", () => {
  assert.deepEqual(sentences("Rate at 4.25% or above. See https://a.b/c.d for data. Done!"), ["Rate at 4.25% or above.", "See https://a.b/c.d for data.", "Done!"]);
  assert.deepEqual(sentences('This market will resolve to "Yes" if the U.S. Senate passes the bill by Dec. 31, 2026. Otherwise "No".'), ['This market will resolve to "Yes" if the U.S. Senate passes the bill by Dec. 31, 2026.', 'Otherwise "No".']);
  assert.deepEqual(sentences("Resolves at 11:59 p.m. ET on Jan. 1. Source: AP."), ["Resolves at 11:59 p.m. ET on Jan. 1.", "Source: AP."]);
  assert.deepEqual(sentences('It will resolve to "Yes." if X happens. Otherwise, it will resolve to "No." The resolution source is AP.'), ['It will resolve to "Yes." if X happens.', 'Otherwise, it will resolve to "No."', "The resolution source is AP."]);
  assert.deepEqual(sentences("If not, the market resolves to No. The source is AP."), ["If not, the market resolves to No.", "The source is AP."]);
  /* A one-letter word or a company's «Inc.» before a sentence opener ends the sentence; an initial does not. */
  assert.deepEqual(sentences('Resolves to "Yes" if Team A wins in Group B. The market will resolve 50-50 in the event of a tie.'), ['Resolves to "Yes" if Team A wins in Group B.', "The market will resolve 50-50 in the event of a tie."]);
  assert.deepEqual(sentences("Resolves per Apple Inc. If not, No."), ["Resolves per Apple Inc.", "If not, No."]);
  assert.deepEqual(sentences("Named after John F. Kennedy airport. Done."), ["Named after John F. Kennedy airport.", "Done."]);
  assert.deepEqual(sentences("Wins in group B. Kalshi decides."), ["Wins in group B.", "Kalshi decides."]);
  assert.deepEqual(sentences("The U.S. Market closes at 4 p.m. ET."), ["The U.S. Market closes at 4 p.m. ET."]);
  assert.deepEqual(sentences(null), []);
});

test("the win condition is the condition: not the fallback, not an exception that also ends in Yes", () => {
  const fallback = resolutionBrief({ description: null, rules: { primary: 'This market will resolve to "No" if BTC does not reach $100k. Otherwise it resolves to "Yes".', secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(fallback.yesWhen, null, "a fallback names the outcome without a condition");
  const both = resolutionBrief({ description: null, rules: { primary: 'If no statement is released, this market will resolve to "Yes". This market will resolve to "Yes" if the Fed cuts.', secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(both.yesWhen, 'This market will resolve to "Yes" if the Fed cuts.');
  assert.deepEqual(both.exceptions, ['If no statement is released, this market will resolve to "Yes".'], "the exception stays an exception");
  /* The source's address is its own, trimmed; an address in another sentence is not the source. */
  const elsewhere = resolutionBrief({ description: null, rules: { primary: 'Resolves to "Yes" if the team wins. The result will be determined by the official league. More info at https://espn.com/x!', secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(elsewhere.source.text, "The result will be determined by the official league.");
  assert.equal(elsewhere.source.url, null);
  const group = resolutionBrief({ description: null, rules: { primary: 'This market will resolve to "Yes" if Team A wins in Group B. The market will resolve 50-50 in the event of a tie.', secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(group.yesWhen, 'This market will resolve to "Yes" if Team A wins in Group B.');
  assert.deepEqual(group.exceptions, ["The market will resolve 50-50 in the event of a tie."]);
  /* The win sentence that names its own source answers «who decides» too. */
  const cpi = resolutionBrief({ description: null, rules: { primary: "Resolves Yes if CPI YoY is 3.0% or more, per the BLS release (https://bls.gov/cpi).", secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(cpi.source.text, cpi.yesWhen);
  assert.equal(cpi.source.url, "https://bls.gov/cpi");
  const trimmed = resolutionBrief({ description: null, rules: { primary: 'Resolves to "Yes" if it rains. Resolved using data from https://weather.gov/x).', secondary: null }, endDate: null, resolutionDate: null });
  assert.equal(trimmed.source.url, "https://weather.gov/x");
});

test("a market with different rules on each venue: one answer per date, what can decide the payout first", () => {
  const points = settlementPoints(SETTLEMENT, ["polymarket", "kalshi", "limitless"]);
  /* Three spellings of one instant are one answer; a date alone at midnight is another. */
  const timing = points.find((p) => p.kind === "timing");
  assert.equal(timing.groups.length, 2);
  assert.deepEqual(timing.groups[0].venues, ["polymarket", "kalshi"]);
  assert.equal(timing.groups[0].date, "2026-10-29T18:00:00.000Z");
  assert.deepEqual(timing.differs, ["limitless"]);
  /* The deciding differences come before the one that only informs. */
  assert.deepEqual(points.map((p) => p.severity), ["critical", "critical", "info"]);
  assert.deepEqual(points.map((p) => p.kind), ["timing", "edge", "source"]);
  const edge = points.find((p) => p.kind === "edge");
  assert.equal(edge.groups.length, 3, "two different answers and the venue that says nothing");
  assert.deepEqual(edge.groups[2], { venues: ["limitless"], text: null });
  assert.equal(settlementSeverity("source", "resolution_source", "Conflicting sources", null), "critical");
  assert.equal(settlementSeverity("other", "wording", "Wording", null), "info");
  assert.equal(settlementDate("2026-10-29"), "2026-10-29T00:00:00.000Z");
  assert.equal(settlementDate("October 29"), null);
  assert.equal(settlementDate("2026-02-30"), null, "a day the calendar does not have is text");
});

test("the settlement clock: open, closing within a day, awaiting, past its date, delayed, resolved", () => {
  const m = market();
  const close = Date.parse(m.endDate);
  const result = Date.parse(m.resolutionDate);
  assert.equal(settlementPhase(m, null, NOW).phase, "open");
  assert.deepEqual(settlementPhase(m, null, close - 5 * H), { phase: "closing", closesInMs: 5 * H });
  assert.equal(settlementPhase(m, null, close - DEADLINE_WARN_MS - 1).phase, "open");
  /* Past the venue's date while it still lists the market as open: not «trading has stopped». */
  assert.deepEqual(settlementPhase(m, null, close + H), { phase: "past", pastByMs: H });
  const closed = market({ status: "closed" });
  assert.deepEqual(settlementPhase(closed, null, close + H), { phase: "awaiting", closedAgoMs: H });
  assert.equal(settlementPhase(closed, null, NOW).phase, "awaiting", "a venue that closes early is closed");
  /* Settling takes time: two days past the result date before it reads as late. */
  assert.equal(settlementPhase(closed, null, result + RESULT_GRACE_MS - H).phase, "awaiting");
  assert.deepEqual(settlementPhase(closed, null, result + RESULT_GRACE_MS + H), { phase: "delayed", lateByMs: RESULT_GRACE_MS + H, since: "resolution" });
  const sameDay = market({ status: "closed", resolutionDate: m.endDate });
  assert.equal(settlementPhase(sameDay, null, close + 5 * 60_000).phase, "awaiting", "a result date equal to the close is not late minutes after it");
  /* No result date: a week past the close reads as delayed, counted from the close — open or closed. */
  const noDate = market({ resolutionDate: null });
  assert.equal(settlementPhase(noDate, null, close + SETTLEMENT_LATE_MS - H).phase, "past");
  assert.deepEqual(settlementPhase(noDate, null, close + SETTLEMENT_LATE_MS + H), { phase: "delayed", lateByMs: SETTLEMENT_LATE_MS + H, since: "date" }, "still listed as open: the venue's date passed, not «trading closed»");
  assert.deepEqual(settlementPhase(market({ status: "closed", resolutionDate: null }), null, close + SETTLEMENT_LATE_MS + H), { phase: "delayed", lateByMs: SETTLEMENT_LATE_MS + H, since: "close" });
  /* A result date before the close is a placeholder: the close decides. */
  const placeholder = market({ status: "closed", resolutionDate: "2026-10-01T00:00:00Z" });
  assert.equal(settlementPhase(placeholder, null, close + H).phase, "awaiting");
  assert.equal(settlementPhase(placeholder, null, close + SETTLEMENT_LATE_MS + H).phase, "delayed");
  const won = market({ outcomes: [{ ...m.outcomes[0], winner: true }, m.outcomes[1]] });
  assert.deepEqual(settlementPhase(won, null, NOW), { phase: "resolved", winner: "Yes" });
  assert.deepEqual(settlementPhase(market({ status: "resolved" }), null, NOW), { phase: "resolved", winner: null });
  assert.deepEqual(settlementPhase(market({ endDate: null, resolutionDate: null }), null, NOW), { phase: "open", closesInMs: null });
});

test("a change in the rules is noticed, dated and read sentence by sentence", () => {
  const before = rulesSnapshot(market());
  const same = rulesSnapshot(market({ rules: { primary: `  ${POLY_RULES.replace(/ /g, "  ")} `, secondary: null } }));
  assert.equal(rulesFingerprint(before), rulesFingerprint(same), "whitespace alone is no change");
  assert.equal(rulesFingerprint(rulesSnapshot(market({ endDate: "2026-10-29T18:00:00Z" }))), rulesFingerprint(before), "one instant spelled twice is no change");
  const changed = market({ endDate: "2026-11-05T18:00:00.000Z", rules: { primary: POLY_RULES.replace("past November 15, 2026", "past November 30, 2026"), secondary: null } });
  const after = rulesSnapshot(changed);
  assert.notEqual(rulesFingerprint(after), rulesFingerprint(before));
  const diff = rulesDiff(before, after);
  assert.deepEqual(diff.closes, { before: "2026-10-29T18:00:00.000Z", after: "2026-11-05T18:00:00.000Z" });
  assert.equal(diff.resolves, null);
  assert.equal(diff.removed.length, 1);
  assert.match(diff.removed[0], /November 15/);
  assert.match(diff.added[0], /November 30/);
});

test("the rules history tracks every venue market and keeps the version before and after a change", () => {
  const first = market();
  assert.deepEqual(venueMarketsOf([first]).map((v) => v.id), ["m-poly", "m-kalshi", "m-lim"]);
  const r1 = nextRulesRecord(null, "e1", [first], NOW);
  assert.equal(r1.version, 1);
  assert.equal(Object.keys(r1.markets).length, 3);
  assert.deepEqual(historyOf(r1), {}, "a market seen for the first time has no history");
  assert.equal(nextRulesRecord(r1, "e1", [first], NOW + H), null, "nothing new, nothing to write");
  const kalshiChanged = market({ matched: [{ ...first.matched[0], rules: { primary: KALSHI_PRIMARY, secondary: KALSHI_SECONDARY.replace("settle to No", "settle to Yes") } }, first.matched[1]] });
  const r2 = nextRulesRecord(r1, "e1", [kalshiChanged], NOW + 2 * H);
  assert.equal(r2.version, 2);
  const h = historyOf(r2);
  assert.deepEqual(Object.keys(h), ["m-kalshi"]);
  assert.equal(h["m-kalshi"][0].venue, "kalshi");
  assert.equal(h["m-kalshi"][0].at, new Date(NOW + 2 * H).toISOString());
  assert.equal(h["m-kalshi"][0].venueMarketId, "m-kalshi");
  assert.deepEqual(h["m-kalshi"][0].diff.added, ["If the meeting is cancelled, the market will settle to Yes."]);
  assert.deepEqual(h["m-kalshi"][0].diff.removed, ["If the meeting is cancelled, the market will settle to No."]);
  /* A read that comes back with no text is the provider's gap, not a change. */
  const blank = { ...kalshiChanged, rules: { primary: null, secondary: null } };
  assert.equal(nextRulesRecord(r2, "e1", [blank], NOW + 3 * H), null);
  /* After a first read without text, a moved date is still a change; the sentences are not compared. */
  const empty = nextRulesRecord(null, "e2", [market({ rules: { primary: null, secondary: null }, matched: [] })], NOW);
  const filled = nextRulesRecord(empty, "e2", [market({ matched: [] })], NOW + H);
  assert.deepEqual(historyOf(filled), {}, "text arriving is the first real read, not a change");
  const emptyAgain = nextRulesRecord(null, "e3", [market({ rules: { primary: null, secondary: null }, matched: [] })], NOW);
  const movedFilled = nextRulesRecord(emptyAgain, "e3", [market({ endDate: "2026-11-05T18:00:00.000Z", matched: [] })], NOW + H);
  assert.deepEqual(historyOf(movedFilled)["m-poly"][0].diff, { closes: { before: "2026-10-29T18:00:00.000Z", after: "2026-11-05T18:00:00.000Z" }, resolves: null, removed: [], added: [] });
  /* Only the last few changes are kept, newest first. */
  let rec = r2;
  for (let i = 0; i < RULES_CHANGES_KEPT + 2; i += 1) {
    rec = nextRulesRecord(rec, "e1", [market({ rules: { primary: `${POLY_RULES} Revision ${i}.`, secondary: null } })], NOW + (3 + i) * H);
  }
  assert.equal(historyOf(rec)["m-poly"].length, RULES_CHANGES_KEPT);
  assert.deepEqual(historyOf(rec)["m-poly"][0].diff.added, ["Revision 4."]);
});

test("the page's read records what is new in the store and answers with the history", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await observeRules(store, "e1", [market()], NOW), {});
  const moved = market({ endDate: "2026-11-05T18:00:00.000Z" });
  const h = await observeRules(store, "e1", [moved], NOW + H);
  assert.deepEqual(Object.keys(h), ["m-poly"]);
  assert.deepEqual(h["m-poly"][0].diff.closes, { before: "2026-10-29T18:00:00.000Z", after: "2026-11-05T18:00:00.000Z" });
  /* Read again with nothing new: the same history, no new change. */
  const again = await observeRules(store, "e1", [moved], NOW + 2 * H);
  assert.equal(again["m-poly"].length, 1);
  /* A store that fails answers with no history; the page still draws. */
  const broken = { ...store, versioned: () => ({ get: async () => { throw new Error("down"); } }) };
  assert.deepEqual(await observeRules(broken, "e1", [moved], NOW), {});
  /* A write that keeps losing its race still answers with the history it read. */
  const real = store.versioned("predictionWatchlists");
  const contended = { ...store, versioned: () => ({ ...real, get: (k) => real.get(k), compareAndSet: async () => false, insertIfAbsent: async () => false }) };
  const third = market({ endDate: "2026-11-12T18:00:00.000Z" });
  assert.equal((await observeRules(contended, "e1", [third], NOW + 3 * H))["m-poly"].length, 1);
  /* An event whose markets all have their result is read, not written. */
  const resolved = market({ status: "resolved", endDate: "2026-12-01T00:00:00.000Z" });
  assert.equal((await observeRules(store, "e1", [resolved], NOW + 4 * H))["m-poly"].length, 1);
});
