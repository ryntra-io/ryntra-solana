import assert from "node:assert/strict";
import test from "node:test";

import {
  dividendTells,
  EARN_HREF,
  EARN_NOTE_KINDS,
  earnNoteText,
  earnSubject,
  earnTelegramText,
  isEarnNote,
  loanGrade,
  loanTells,
  rangeTells,
  tickerList,
  unitsWords,
  weekendKey,
  weekendTell,
} from "./notes.ts";

/* CITY-100 (spec E9): Earn's four notes — out of range, the exchange's weekend, dividend dates, loan health — judged one
   way for the city, the server and the engine's delivery. */

const MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Friday 30 October 2026, 13:00 in New York (EDT, UTC−4). */
const FRIDAY_AFTERNOON = Date.UTC(2026, 9, 30, 17, 0);

test("out of range: told once until the position is back in range, then its next exit again", () => {
  const reads = [
    { address: "P1", pair: "JitoSOL–SOL", inRange: false },
    { address: "P2", pair: "SOL–USDC", inRange: true },
  ];
  const first = rangeTells(new Set(), reads);
  assert.deepEqual(first.out, ["P1"]);
  assert.deepEqual(first.tell, [{ kind: "range", id: "range:P1", pair: "JitoSOL–SOL" }]);
  assert.deepEqual(rangeTells(new Set(first.out), reads).tell, [], "known out of range: nothing new");
  const back = rangeTells(new Set(first.out), [{ ...reads[0], inRange: true }, reads[1]]);
  assert.deepEqual(back.out, [], "back in range leaves the set");
  assert.equal(rangeTells(new Set(back.out), reads).tell.length, 1, "its next exit is told again");
});

test("the weekend: from Friday noon in New York until Sunday ends, named by its Friday", () => {
  assert.equal(weekendKey(FRIDAY_AFTERNOON), "2026-10-30");
  assert.equal(weekendKey(Date.UTC(2026, 9, 30, 15, 0)), null, "Friday 11:00 in New York: not yet");
  assert.equal(weekendKey(Date.UTC(2026, 9, 31, 12, 0)), "2026-10-30", "Saturday");
  assert.equal(weekendKey(Date.UTC(2026, 10, 2, 3, 0)), "2026-10-30", "Sunday 22:00 in New York (EST after the clocks went back)");
  assert.equal(weekendKey(Date.UTC(2026, 10, 2, 6, 0)), null, "Monday 01:00 in New York");
  assert.equal(weekendKey(Date.UTC(2026, 10, 4, 18, 0)), null, "a Wednesday");
  assert.equal(weekendKey(Number.NaN), null);
  assert.deepEqual(weekendTell(FRIDAY_AFTERNOON, ["TSLAx", "NVDAx", "TSLAx"]), { kind: "weekend", id: "weekend:2026-10-30", tickers: ["NVDAx", "TSLAx"] });
  assert.equal(weekendTell(FRIDAY_AFTERNOON, []), null, "no stock, no weekend note");
  assert.equal(weekendTell(Date.UTC(2026, 10, 4, 18, 0), ["TSLAx"]), null);
});

test("dividends: a dividend the chain schedules within a week, and the day it is added — never a split", () => {
  const now = Date.UTC(2026, 9, 28, 12, 0);
  const held = [{ mint: MINT, ticker: "TSLAx", raw: 2_000_000_000n, decimals: 9 }];
  const ahead = { mint: MINT, multiplier: 1.0, newMultiplier: 1.004, newMultiplierEffectiveAt: new Date(now + 2 * DAY).toISOString() };
  const [event] = dividendTells([ahead], held, now);
  assert.equal(event.kind, "dividend");
  assert.equal(event.stage, "ahead");
  assert.equal(event.id, `dividend:${MINT}:${ahead.newMultiplierEffectiveAt}`);
  assert.equal(event.inMs, 2 * DAY);
  assert.deepEqual(dividendTells([{ ...ahead, newMultiplierEffectiveAt: new Date(now + 8 * DAY).toISOString() }], held, now), [], "past a week: not yet");
  assert.deepEqual(dividendTells([{ ...ahead, newMultiplier: 2 }], held, now), [], "a 2-for-1 split is no dividend");
  assert.deepEqual(dividendTells([{ ...ahead, newMultiplier: 0.9 }], held, now), [], "a fall is no dividend");
  assert.deepEqual(dividendTells([ahead], [{ ...held[0], raw: 0n }], now), [], "a stock not held earns nothing");

  const added = { ...ahead, newMultiplierEffectiveAt: new Date(now - DAY).toISOString() };
  const [paid] = dividendTells([added], held, now);
  assert.equal(paid.stage, "added");
  assert.equal(paid.id, `paid:${MINT}:${added.newMultiplierEffectiveAt}`);
  assert.ok(Math.abs(paid.units - 0.008) < 1e-12, "two shares × 0.004 = 0.008 TSLAx");
  assert.deepEqual(dividendTells([{ ...added, newMultiplierEffectiveAt: new Date(now - 4 * DAY).toISOString() }], held, now), [], "long added: old news");
});

test("loan health: half of the live maximum, a buffer on the weekend for stocks, at risk past 80 %", () => {
  const loan = { id: "L1", coin: "TSLAx", ltv: 0.3, maxLtv: 0.7, stocks: true };
  assert.equal(loanGrade(loan, false), "ok", "0.3 of 0.7 is 43 % of the maximum");
  assert.equal(loanGrade(loan, true), "watch", "on the weekend a stock keeps a buffer below half");
  assert.equal(loanGrade({ ...loan, stocks: false }, true), "ok", "SOL collateral has no weekend");
  assert.equal(loanGrade({ ...loan, ltv: 0.4 }, false), "watch");
  assert.equal(loanGrade({ ...loan, ltv: 0.6 }, false), "danger");
  assert.equal(loanGrade({ ...loan, maxLtv: 0 }, false), null, "unreadable figures say nothing");
  assert.equal(loanGrade({ ...loan, ltv: Number.NaN }, false), null);

  const first = loanTells({}, [{ ...loan, ltv: 0.6 }], false);
  assert.deepEqual(first.tell, [{ kind: "loan", id: "loan:L1:danger", grade: "danger", coin: "TSLAx" }], "a loan first read at risk is told");
  assert.deepEqual(loanTells(first.grades, [{ ...loan, ltv: 0.6 }], false).tell, [], "still at risk: told once");
  const better = loanTells(first.grades, [{ ...loan, ltv: 0.4 }], false);
  assert.deepEqual(better.tell, [], "recovering says nothing");
  assert.equal(loanTells(better.grades, [{ ...loan, ltv: 0.6 }], false).tell.length, 1, "falling again is told again");
  assert.deepEqual(loanTells({ L1: "watch" }, [{ ...loan, maxLtv: 0 }], false).grades, { L1: "watch" }, "an unreadable read keeps the grade known");
});

test("the words: one short line each, both languages, numbers people read", () => {
  const range = { kind: "range", id: "range:P1", pair: "JitoSOL–SOL" };
  assert.deepEqual(earnNoteText(range, "en"), { title: "Out of range · JitoSOL–SOL", line: "No fees until the price comes back." });
  assert.deepEqual(earnNoteText(range, "uk"), { title: "Поза діапазоном · JitoSOL–SOL", line: "Комісії не йдуть, доки ціна не повернеться." });
  assert.equal(earnNoteText({ kind: "weekend", id: "w", tickers: ["AAPLx", "NVDAx", "SPYx", "TSLAx"] }, "en").line, "AAPLx, NVDAx, SPYx +1 can jump when it opens on Monday.");
  assert.equal(earnNoteText({ kind: "weekend", id: "w", tickers: ["TSLAx"] }, "uk").title, "Вихідні на біржі");
  const div = (inMs) => ({ kind: "dividend", id: "d", stage: "ahead", ticker: "TSLAx", inMs });
  assert.equal(earnNoteText(div(3 * HOUR), "en").line, "In 3 h");
  assert.equal(earnNoteText(div(DAY), "en").line, "In a day");
  assert.equal(earnNoteText(div(2 * DAY), "en").line, "In 2 days");
  assert.equal(earnNoteText(div(3 * HOUR), "uk").line, "Через 3 год");
  assert.equal(earnNoteText(div(2 * DAY), "uk").line, "Через 2 дні");
  assert.equal(earnNoteText(div(5 * DAY), "uk").line, "Через 5 днів");
  assert.equal(earnNoteText(div(2 * DAY), "uk").title, "Дата дивідендів · TSLAx");
  const paid = { kind: "dividend", id: "p", stage: "added", ticker: "TSLAx", units: 0.0081234 };
  assert.deepEqual(earnNoteText(paid, "en"), { title: "Dividend added · TSLAx", line: "+0.008123 TSLAx" });
  assert.equal(earnNoteText(paid, "uk").line, "+0,008123 TSLAx", "the decimal comma");
  assert.equal(earnNoteText({ ...paid, units: null }, "en").line, "", "a payout that cannot be measured says only that it came");
  assert.equal(earnNoteText({ kind: "loan", id: "l", grade: "danger", coin: "TSLAx" }, "en").title, "Loan at risk · TSLAx");
  assert.equal(earnNoteText({ kind: "loan", id: "l", grade: "watch", coin: "SOL" }, "uk").title, "Позика біля межі · SOL");
  assert.equal(unitsWords(1234.5678, "en"), "1235");
  assert.equal(unitsWords(1.23456, "uk"), "1,235");
  assert.equal(unitsWords(0, "en"), "0");
  assert.equal(tickerList(["A", "B"]), "A, B");
  assert.equal(earnSubject(range), "JitoSOL–SOL");
  // No promises, no technical words in what a person reads.
  for (const locale of ["en", "uk"]) {
    for (const event of [range, div(DAY), paid, { kind: "weekend", id: "w", tickers: ["TSLAx"] }, { kind: "loan", id: "l", grade: "watch", coin: "SOL" }]) {
      const text = earnNoteText(event, locale);
      assert.doesNotMatch(`${text.title} ${text.line}`, /\b(API|engine|LTV|guarantee|profit|x1000)\b|гарант|прибут/i);
    }
  }
});

test("the engine's delivery knows an Earn note by its trigger and says it plainly; it opens Earn on «Mine»", () => {
  assert.deepEqual([...EARN_NOTE_KINDS], ["range", "weekend", "dividend", "loan"]);
  assert.equal(isEarnNote({ triggerId: "city-earn:OWNER:range:P1:v3" }), true);
  assert.equal(isEarnNote({ triggerId: "spot-stop:s1" }), false);
  assert.equal(earnTelegramText({ title: "Out of range · JitoSOL–SOL", reason: "No fees until the price comes back." }), "Ryntra\nOut of range · JitoSOL–SOL\nNo fees until the price comes back.");
  assert.equal(earnTelegramText({ title: "Dividend added · TSLAx", reason: "" }), "Ryntra\nDividend added · TSLAx");
  assert.equal(EARN_HREF, "/?open=earn&tab=mine");
});
