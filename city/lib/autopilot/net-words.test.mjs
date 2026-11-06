import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AUTOPILOT } from "./words.ts";
import { dayDetail, daySummary, holdFigure, resultFigure, resultRaw, shareWorth, toneOf } from "./report.ts";
import { rhythmOf } from "./plan.ts";

/* CITY-197: the agent's day and card say the result after every fee, with plain holding beside it — no rate a day, no promise. */

const DAY = { since: 0, until: 1, trades: 3, spentRaw: "30000000", boughtRaw: "3000", worthRaw: "42000000", earnedRaw: "12000000" };
const NET = { ...DAY, netRaw: "-1200000", holdRaw: "4000000" };

test("the day's figure is after every fee once the book counted them; before, what the trades did", () => {
  assert.equal(resultRaw(DAY), "12000000");
  assert.equal(resultRaw(NET), "-1200000");
  assert.equal(resultRaw({ ...NET, netRaw: null }), null, "counted but not read: nothing, never the gross");
  assert.equal(daySummary(NET, "en"), "3 trades, −0.0012 SOL");
  assert.equal(daySummary(NET, "uk"), "3 угоди, −0,0012 SOL");
  assert.equal(resultFigure(NET, "en", 150), "−0.0012 SOL (−$0.18)");
  assert.equal(toneOf("-1"), "down");
  assert.equal(toneOf("0"), undefined);
});

test("the detail line: after all fees, holding beside it, and the whole since the start", () => {
  assert.equal(dayDetail(NET, "en", "BONK", { netRaw: "-5000000" }), "Spent 0.03 SOL · bought BONK · after all fees · holding: +0.004 SOL · since start −0.005 SOL");
  assert.equal(dayDetail(NET, "uk", "BONK"), "Витрачено 0,03 SOL · куплено BONK · після всіх комісій · тримання: +0,004 SOL");
  assert.equal(dayDetail({ ...NET, holdRaw: null }, "en", null), "Spent 0.03 SOL · after all fees");
  assert.equal(dayDetail(DAY, "en", "BONK"), "Spent 0.03 SOL · bought BONK · worth 0.042 SOL now", "an older view says what it said");
  assert.equal(holdFigure(null, "en"), null);
});

test("the share card prices the span after every fee: its «x» is honest too", () => {
  assert.equal(shareWorth(NET), "28800000");
  assert.equal(shareWorth(DAY), "42000000");
  assert.equal(shareWorth({ ...NET, netRaw: null }), null);
});

test("the calm rhythm the card shows: one buy a day at the default pace", () => {
  assert.deepEqual(rhythmOf("small", 1), { buys: 1, everyHours: 24, perTrade: 0.02, perDay: 0.1, days: 30 });
  assert.equal(rhythmOf("small").buys, 5);
});

test("no rate a day and no promise in the agent's words", () => {
  for (const lang of ["en", "uk"]) {
    const w = AUTOPILOT[lang];
    for (const line of [w.earnedNet, w.factNet, w.factHold, w.netLine("0.06", "+0.002 SOL")]) {
      assert.doesNotMatch(line, /%|guarantee|гарант|profit|прибут|x\d/iu);
    }
  }
  const card = readFileSync(new URL("../../components/autopilot/AutopilotCard.tsx", import.meta.url), "utf8");
  assert.match(card, /w\.factNet, w\.factHold/u, "the fees counted, behind «Details»");
});
