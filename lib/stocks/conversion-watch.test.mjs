import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_REMINDER_GAP_MS,
  REMINDER_DAYS_BEFORE,
  SELL_FOR_USDC,
  daysLeft,
  deadlineDay,
  deadlineExact,
  eventLine,
  isWatched,
  reminderDue,
  reminderIdentity,
  reminderWords,
  shortEventLine,
  stageAt,
  stageDueAt,
  swapActionWord,
  swapHref,
  windowState,
} from "./conversion-watch.ts";
import { eventStateAt, lifecycleOf } from "./instrument.ts";
import { lifecycleEventFor } from "./lifecycle-events.ts";

const SPACEX = lifecycleEventFor("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh");
const XAI = lifecycleEventFor("PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx");
const at = (iso) => Date.parse(iso);
const DAY = 86_400_000;
const TODAY = at("2026-09-25T09:00:00Z");

test("SpaceX is watched: open until the issuer's cut-off, the swap into xStocks' SPCXx", () => {
  assert.ok(isWatched(SPACEX));
  assert.equal(windowState(SPACEX, TODAY), "open");
  assert.equal(SPACEX.watch.into.symbol, "SPCXx");
  assert.equal(SPACEX.watch.into.mint, "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8");
  assert.equal(SPACEX.watch.mechanics.url, "https://x.com/PreStocks/status/2063623768535363940");
  /* xAI's window closed on 12 September 2026: no purchase, no action. */
  assert.ok(isWatched(XAI));
  assert.equal(windowState(XAI, TODAY), "closed");
});

test("the window closes with the clock, not with an edit to the registry", () => {
  const before = at("2027-03-12T23:58:59Z");
  const after = at("2027-03-12T23:59:00Z");
  assert.equal(eventStateAt(SPACEX, before), "conversion-open");
  assert.equal(eventStateAt(SPACEX, after), "expired");
  assert.equal(eventStateAt(SPACEX), "conversion-open", "without a clock the registry's word stands");
  assert.equal(lifecycleOf({ paused: false, event: SPACEX, listedByIssuer: true, catalogueFetchedAt: null, chainObservedAt: null, nowMs: after }).tradable, false);
  assert.equal(windowState(SPACEX, after), "closed");
});

test("the reminders fall due 90, 30, 7 and 1 days before the deadline's day, at 09:00 UTC", () => {
  assert.deepEqual([...REMINDER_DAYS_BEFORE], [90, 30, 7, 1]);
  assert.equal(new Date(stageDueAt(SPACEX.deadline, "d90")).toISOString(), "2026-12-12T09:00:00.000Z");
  assert.equal(new Date(stageDueAt(SPACEX.deadline, "d30")).toISOString(), "2027-02-10T09:00:00.000Z");
  assert.equal(new Date(stageDueAt(SPACEX.deadline, "d7")).toISOString(), "2027-03-05T09:00:00.000Z");
  assert.equal(new Date(stageDueAt(SPACEX.deadline, "d1")).toISOString(), "2027-03-11T09:00:00.000Z");
});

test("the stage that stands: the event until 90 days before, then each milestone, none once closed", () => {
  assert.equal(stageAt(SPACEX, TODAY), "event");
  assert.equal(stageAt(SPACEX, at("2026-12-12T08:59:59Z")), "event");
  assert.equal(stageAt(SPACEX, at("2026-12-12T09:00:00Z")), "d90");
  assert.equal(stageAt(SPACEX, at("2027-02-10T09:00:00Z")), "d30");
  assert.equal(stageAt(SPACEX, at("2027-03-05T12:00:00Z")), "d7");
  assert.equal(stageAt(SPACEX, at("2027-03-11T09:00:00Z")), "d1");
  assert.equal(stageAt(SPACEX, at("2027-03-12T23:00:00Z")), "d1");
  assert.equal(stageAt(SPACEX, at("2027-03-12T23:59:00Z")), null);
  assert.equal(stageAt(XAI, TODAY), null);
});

test("a holder is told once on the first day, then on each milestone — the schedule end to end", () => {
  const sent = [];
  const walk = [];
  /* Every hour from today to the deadline: what a tick every five minutes would decide, at an hour's grain. */
  for (let now = TODAY; now < at("2027-03-13T00:00:00Z"); now += 60 * 60_000) {
    const stage = reminderDue(SPACEX, sent, now);
    if (stage) {
      sent.push({ stage, atMs: now });
      walk.push(`${stage}@${new Date(now).toISOString()}`);
    }
  }
  assert.deepEqual(walk, [
    "event@2026-09-25T09:00:00.000Z",
    "d90@2026-12-12T09:00:00.000Z",
    "d30@2027-02-10T09:00:00.000Z",
    "d7@2027-03-05T09:00:00.000Z",
    "d1@2027-03-11T09:00:00.000Z",
  ]);
});

test("never more than one reminder about a token a day, and nothing missed is caught up", () => {
  /* First seen as a holder an hour before the 30-day milestone: the stage that stands (90 days) is recorded, told in the event's words; the 30 days wait a day's gap. */
  const firstSeen = at("2027-02-10T08:00:00Z");
  assert.equal(reminderDue(SPACEX, [], firstSeen), "d90");
  const sent = [{ stage: "d90", atMs: firstSeen }];
  assert.equal(reminderDue(SPACEX, sent, at("2027-02-10T09:00:00Z")), null, "the 30-day reminder waits for a day's gap");
  assert.equal(reminderDue(SPACEX, sent, firstSeen + MIN_REMINDER_GAP_MS - 1), null);
  assert.equal(reminderDue(SPACEX, sent, firstSeen + MIN_REMINDER_GAP_MS), "d30");
  /* First seen five days before the deadline: the 7-day stage stands, told once — the event and the 90 and 30 days are not caught up. */
  const late = at("2027-03-07T10:00:00Z");
  assert.equal(reminderDue(SPACEX, [], late), "d7");
  assert.equal(reminderDue(SPACEX, [{ stage: "d7", atMs: late }], late + 2 * DAY), null);
  assert.equal(reminderDue(SPACEX, [{ stage: "d7", atMs: late }], at("2027-03-11T09:00:00Z")), "d1");
  /* A later stage sent covers an earlier one, whatever a clock says. */
  assert.equal(reminderDue(SPACEX, [{ stage: "d30", atMs: at("2027-02-10T09:00:00Z") }], at("2026-12-20T09:00:00Z")), null);
  /* Nothing once the window closed; nothing about xAI. */
  assert.equal(reminderDue(SPACEX, [], at("2027-03-13T09:00:00Z")), null);
  assert.equal(reminderDue(XAI, [], TODAY), null);
});

test("the Owner's line, word for word, and its English", () => {
  assert.equal(eventLine(SPACEX, "holder", "uk", TODAY), "SpaceX вийшла на біржу. Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.");
  assert.equal(eventLine(SPACEX, "holder", "en", TODAY), "SpaceX has gone public. Swap SPACEX by March 12, 2027 — after the deadline the token expires worthless.");
  assert.equal(eventLine(SPACEX, "everyone", "uk", TODAY), "SpaceX вийшла на біржу. SPACEX треба обміняти до 12 березня 2027 — після строку токен згорить.");
  assert.equal(eventLine(SPACEX, "buyer", "uk", TODAY), "SpaceX вийшла на біржу. Куплений SPACEX треба обміняти до 12 березня 2027 — після строку токен згорить.");
  assert.equal(eventLine(SPACEX, "buyer", "en", TODAY), "SpaceX has gone public. SPACEX you buy must be swapped by March 12, 2027 — after the deadline the token expires worthless.");
  assert.equal(eventLine(XAI, "holder", "uk", TODAY), "SpaceX купила xAI. Строк обміну XAI минув 12 вересня 2026 — емітент більше не підтримує токен.");
  assert.equal(eventLine(XAI, "holder", "en", TODAY), "xAI was acquired by SpaceX. The swap deadline for XAI passed on September 12, 2026 — the issuer no longer supports the token.");
});

test("the deadline's day is the UTC day of the cut-off — never the next one, never «р.»", () => {
  assert.equal(deadlineDay("2027-03-12T23:59:00.000Z", "uk"), "12 березня 2027");
  assert.equal(deadlineDay("2027-03-12T23:59:00.000Z", "en"), "March 12, 2027");
  assert.equal(deadlineExact("2027-03-12T23:59:00.000Z", "uk"), "23:59 UTC, 12 березня 2027");
  assert.equal(deadlineExact("2027-03-12T23:59:00.000Z", "en"), "23:59 UTC, March 12, 2027");
});

test("the event in a few words, for a row with room for a label only", () => {
  assert.equal(shortEventLine(SPACEX, "uk", TODAY), "Обміняй до 12 березня 2027");
  assert.equal(shortEventLine(SPACEX, "en", TODAY), "Swap by March 12, 2027");
  assert.equal(shortEventLine(XAI, "uk", TODAY), "Строк обміну минув");
  assert.equal(shortEventLine(SPACEX, "en", at("2027-03-13T00:00:00Z")), "Swap deadline passed");
});

test("one action and a quiet second", () => {
  assert.equal(swapActionWord(SPACEX.watch, "uk"), "Обміняти на SpaceX (SPCXx)");
  assert.equal(swapActionWord(SPACEX.watch, "en"), "Swap for SpaceX (SPCXx)");
  assert.equal(SELL_FOR_USDC.uk, "Продати за USDC");
  assert.equal(swapActionWord({ ...SPACEX.watch, into: null }, "uk"), null);
  assert.equal(swapHref("SPACEX"), "/app/stocks/SPACEX?convert=1&from=monitoring");
});

test("each reminder's words: the event itself first, then how long is left, the last day said as such", () => {
  const first = reminderWords(SPACEX, "event", TODAY, true);
  assert.equal(first.uk.title, "SpaceX вийшла на біржу");
  assert.equal(first.uk.reason, "Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.");
  assert.equal(`${first.uk.title}. ${first.uk.reason}`, eventLine(SPACEX, "holder", "uk", TODAY));
  assert.equal(first.uk.cta, "Обміняти на SpaceX (SPCXx)");
  assert.equal(first.en.title, "SpaceX has gone public");
  assert.equal(first.en.cta, "Swap for SpaceX (SPCXx)");
  /* On each milestone's own day the count is the milestone's. */
  const on = (stage) => stageDueAt(SPACEX.deadline, stage);
  assert.equal(reminderWords(SPACEX, "d90", on("d90"), false).uk.title, "Лишилося 90 днів, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d30", on("d30"), false).uk.title, "Лишилося 30 днів, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d7", on("d7"), false).uk.title, "Лишилося 7 днів, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d1", on("d1"), false).uk.title, "Завтра — останній день, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d1", at("2027-03-12T09:00:00Z"), false).uk.title, "Сьогодні — останній день, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d30", on("d30"), false).en.title, "30 days left to swap SPACEX");
  assert.equal(reminderWords(SPACEX, "d1", on("d1"), false).en.title, "Tomorrow is the last day to swap SPACEX");
  /* A reminder held back a day says the day's own count, never a stale one; Ukrainian counts agree with the number. */
  assert.equal(reminderWords(SPACEX, "d30", on("d30") + DAY, false).uk.title, "Лишилося 29 днів, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d30", at("2027-02-08T12:00:00Z"), false).uk.title, "Лишилося 32 дні, щоб обміняти SPACEX");
  assert.equal(reminderWords(SPACEX, "d30", at("2027-02-19T12:00:00Z"), false).uk.title, "Лишилося 21 день, щоб обміняти SPACEX");
  /* The first note a holder gets tells the event, whatever stage stood when they were first seen. */
  assert.equal(reminderWords(SPACEX, "d7", at("2027-03-07T10:00:00Z"), true).uk.title, "SpaceX вийшла на біржу");
  for (const stage of ["event", "d90", "d30", "d7", "d1"]) {
    const words = reminderWords(SPACEX, stage, stage === "event" ? TODAY : on(stage), false);
    for (const lang of ["en", "uk"]) {
      assert.ok(words[lang].title.length <= 120 && words[lang].reason.length <= 280, `${stage} ${lang} fits a note`);
      assert.doesNotMatch(`${words[lang].title} ${words[lang].reason}`, /UTC|1:1|гарант|guarant/i);
    }
  }
});

test("days left are the calendar's, and a reminder is one note per holder, token and stage", () => {
  assert.equal(daysLeft(SPACEX, at("2027-02-10T09:00:00Z")), 30);
  assert.equal(daysLeft(SPACEX, at("2027-02-10T23:59:00Z")), 30);
  assert.equal(daysLeft(SPACEX, at("2027-03-11T09:00:00Z")), 1);
  assert.equal(daysLeft(SPACEX, at("2027-03-12T23:00:00Z")), 0);
  assert.equal(daysLeft(SPACEX, at("2027-03-13T00:00:00Z")), 0);
  assert.equal(reminderIdentity("Owner1111111111111111111111111111", SPACEX.mint, "d30"), `issuer-event:${SPACEX.mint}:d30@Owner1111111111111111111111111111`);
});
