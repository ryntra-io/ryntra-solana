// Run from repo root: node --test "app/app/stocks/[ticker]/market-hours.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";

import { changeMoment, changePhrase, hoursLine, hoursState, hoursTone } from "./market-hours-words.ts";

/* The exchange's hours under a company's price (SOL-K1): the issuer's period, when it changes on the reader's clock,
   with the day when it is not today, and never a time that has passed. */

const KYIV = "Europe/Kyiv";
/* Tuesday 20.10.2026, 18:00 in Kyiv. */
const NOW = Date.parse("2026-10-20T15:00:00.000Z");

test("the period the issuer states, its tone, and nothing for a session nobody stated", () => {
  assert.equal(hoursState({ period: "market", exchangeOpen: true, nextChangeAt: null }), "open");
  assert.equal(hoursState({ period: "extended", exchangeOpen: false, nextChangeAt: null }), "extended");
  assert.equal(hoursState({ period: "overnight", exchangeOpen: false, nextChangeAt: null }), "overnight");
  assert.equal(hoursState({ period: "closed", exchangeOpen: false, nextChangeAt: null }), "closed");
  assert.equal(hoursState({ period: "unknown", exchangeOpen: true, nextChangeAt: null }), "open");
  assert.equal(hoursState({ period: "unknown", exchangeOpen: null, nextChangeAt: null }), null);
  assert.equal(hoursTone("overnight"), "extended");
  assert.equal(hoursLine({ period: "unknown", exchangeOpen: null, nextChangeAt: null }, "uk", null), null);
});

test("when the session changes: today a time, another day its weekday too, a passed time not at all", () => {
  const today = changeMoment("2026-10-20T20:00:00.000Z", NOW, "uk", KYIV);
  assert.deepEqual(today, { weekday: null, time: "23:00" });
  assert.equal(changePhrase("open", today, "uk"), "закриється о 23:00");
  assert.equal(changePhrase("open", changeMoment("2026-10-20T20:00:00.000Z", NOW, "en", KYIV), "en"), "closes at 23:00");
  const friday = changeMoment("2026-10-23T08:00:00.000Z", NOW, "uk", KYIV);
  assert.equal(changePhrase("closed", friday, "uk"), "наступна сесія пт о 11:00");
  assert.equal(changePhrase("extended", friday, "uk"), "до пт 11:00");
  assert.equal(changePhrase("closed", changeMoment("2026-10-23T08:00:00.000Z", NOW, "en", KYIV), "en"), "next session Fri at 11:00");
  assert.equal(changePhrase("overnight", today, "en"), "until 23:00");
  assert.equal(changeMoment("2026-10-20T14:59:00.000Z", NOW, "uk", KYIV), null);
  assert.equal(changeMoment(null, NOW, "uk", KYIV), null);
  assert.equal(changeMoment("not a time", NOW, "en", KYIV), null);
});

test("the line: open says when it closes; outside the session the token's price may part from the close", () => {
  const open = { period: "market", exchangeOpen: true, nextChangeAt: "2026-10-20T20:00:00.000Z" };
  assert.equal(hoursLine(open, "uk", { weekday: null, time: "23:00" }), "Біржа відкрита · закриється о 23:00");
  assert.equal(hoursLine(open, "en", { weekday: null, time: "23:00" }), "Exchange open · closes at 23:00");
  const extended = { period: "extended", exchangeOpen: false, nextChangeAt: "2026-10-21T00:00:00.000Z" };
  assert.equal(hoursLine(extended, "uk", { weekday: null, time: "03:00" }), "Подовжені торги · до 03:00 · ціна токена може відрізнятися від ціни закриття");
  const closed = { period: "closed", exchangeOpen: false, nextChangeAt: "2026-10-26T09:00:00.000Z" };
  assert.equal(hoursLine(closed, "en", { weekday: "Mon", time: "11:00" }), "Exchange closed · next session Mon at 11:00 · the token's price may differ from the last close");
  /* Before the page has the reader's clock — or with a passed time — the state alone. */
  assert.equal(hoursLine(closed, "uk", null), "Біржа зачинена · ціна токена може відрізнятися від ціни закриття");
});
