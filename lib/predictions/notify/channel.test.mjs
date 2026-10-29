// Run from repo root: node --test lib/predictions/notify/channel.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { deliverNotes, listNotes, markRead, note, pruneNotes, readPrefs, writePrefs } from "./channel.ts";
import { NOTES_PER_HOUR_DEFAULT, NOTE_GROUP_MS, defaultPrefs, deliveryDecision, mergePrefs } from "./notes.ts";
import { settleNoteWords } from "./words.ts";

/*
 * The channel PM-05 sends through and PM-14 will take as it is: one note per
 * thing that happened, the same thing again grouped rather than repeated, the
 * quiet hour honoured, a ceiling per hour, and one touch that stops it.
 * Nothing here knows what a market is.
 */

const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const NOW = Date.parse("2026-10-26T12:00:00.000Z");

const store = () => createMemoryGuardStore();
const draft = (over = {}) => ({ kind: "market_resolved", identity: "resolved:vev1", facts: { question: "Will the test pass?", won: 1 }, href: "/app/predictions/ev1", ...over });

/** Transports that only count what they were asked to send. */
function spy(answers = { webpush: "sent", telegram: "sent" }) {
  const calls = { webpush: [], telegram: [] };
  return {
    calls,
    transports: {
      webpush: async (wallet) => {
        calls.webpush.push(wallet);
        return answers.webpush;
      },
      telegram: async (wallet, words, href) => {
        calls.telegram.push({ wallet, words, href });
        return answers.telegram;
      },
    },
  };
}

const words = (row) => settleNoteWords(row, "uk");

test("a note is written once; the same thing again raises its count instead of a second note", async () => {
  const s = store();
  const first = await note(s, WALLET, draft(), NOW);
  assert.equal(first.fresh, true);
  assert.equal(first.note.count, 1);
  const again = await note(s, WALLET, draft(), NOW + 60_000);
  assert.equal(again.fresh, false);
  assert.equal(again.note.count, 2);
  assert.equal(again.note.id, first.note.id);
  assert.equal((await listNotes(s, WALLET)).length, 1);
  /* Past the grouping window the same thing is news again: the note starts over, undelivered. */
  const later = await note(s, WALLET, draft(), NOW + NOTE_GROUP_MS + 1);
  assert.equal(later.note.count, 1);
  assert.equal(later.note.delivery, null);
  assert.equal((await listNotes(s, WALLET)).length, 1, "one identity is one note, whatever the window");
});

test("a standing fact is said once, however many passes read it", async () => {
  const s = store();
  const standing = draft({ once: true });
  assert.equal((await note(s, WALLET, standing, NOW)).fresh, true);
  for (const at of [NOW + 60_000, NOW + NOTE_GROUP_MS + 1, NOW + 5 * NOTE_GROUP_MS]) {
    const again = await note(s, WALLET, standing, at);
    assert.equal(again.fresh, false);
    assert.equal(again.note.count, 1, "a market stays decided; it is not decided again");
  }
  assert.equal((await listNotes(s, WALLET)).length, 1);
});

test("notes of one wallet never reach another", async () => {
  const s = store();
  await note(s, WALLET, draft(), NOW);
  assert.equal((await listNotes(s, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")).length, 0);
});

test("a note goes out once, on both channels, and the decision is kept on it", async () => {
  const s = store();
  const sent = spy();
  await note(s, WALLET, draft(), NOW);
  const tally = await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW);
  assert.deepEqual(tally, { sent: 1, quiet: 0, capped: 0, off: 0, noChannel: 0, failed: 0 });
  assert.deepEqual(sent.calls.webpush, [WALLET]);
  assert.equal(sent.calls.telegram.length, 1);
  assert.match(sent.calls.telegram[0].words.title, /Ринок розрахувано/);
  assert.match(sent.calls.telegram[0].words.body, /ваша сторона виграла/);
  assert.equal(sent.calls.telegram[0].href, "/app/predictions/ev1");
  /* A second pass sends nothing: the note carries what became of it. */
  const second = await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW + 1_000);
  assert.equal(second.sent, 0);
  assert.equal(sent.calls.webpush.length, 1);
  assert.equal((await listNotes(s, WALLET))[0].delivery, "sent");
});

test("the quiet hour keeps a note in the list and sends it when the window ends", async () => {
  const s = store();
  const sent = spy();
  /* 12:00 UTC is 02:00 in Anadyr (+12): inside a 22:00–08:00 window. */
  await writePrefs(s, WALLET, { quietHours: { start: "22:00", end: "08:00", timezone: "Asia/Anadyr" } }, NOW);
  await note(s, WALLET, draft(), NOW);
  const held = await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW);
  assert.deepEqual(held, { sent: 0, quiet: 1, capped: 0, off: 0, noChannel: 0, failed: 0 });
  assert.equal(sent.calls.telegram.length, 0, "nothing leaves in the quiet hour");
  const waiting = (await listNotes(s, WALLET))[0];
  assert.equal(waiting.delivery, "quiet");
  assert.ok(waiting.deliverAfter && Date.parse(waiting.deliverAfter) > NOW, "it says when it may go");
  /* A pass inside the window does not even look at it again: it waits, and nothing leaves. */
  assert.deepEqual(await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW + 60_000), { sent: 0, quiet: 0, capped: 0, off: 0, noChannel: 0, failed: 0 });
  assert.equal(sent.calls.telegram.length, 0);
  /* The window has passed: it goes out, once. */
  const after = Date.parse(waiting.deliverAfter) + 1_000;
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, after)).sent, 1);
  assert.equal(sent.calls.telegram.length, 1);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, after + 1_000)).sent, 0);
});

test("the hour's ceiling holds the rest in the list, and the next hour opens again", async () => {
  const s = store();
  const sent = spy();
  await writePrefs(s, WALLET, { perHour: 2 }, NOW);
  for (let i = 0; i < 4; i += 1) await note(s, WALLET, draft({ identity: `resolved:vev${i}` }), NOW);
  const tally = await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW);
  assert.equal(tally.sent, 2);
  assert.equal(tally.capped, 2);
  assert.equal(sent.calls.telegram.length, 2);
  assert.equal((await listNotes(s, WALLET)).filter((n) => n.delivery === "capped").length, 2, "the ones over the ceiling are still in the list");
  /* A note capped is not sent later by itself: the next thing that happens carries its own. */
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW + 3_600_000)).sent, 0);
  await note(s, WALLET, draft({ identity: "resolved:next-hour" }), NOW + 3_600_000);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW + 3_600_000)).sent, 1);
});

test("one touch stops every channel, and the notes are still written", async () => {
  const s = store();
  const sent = spy();
  const off = await writePrefs(s, WALLET, { on: false }, NOW);
  assert.equal(off.on, false);
  await note(s, WALLET, draft(), NOW);
  const tally = await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW);
  assert.deepEqual(tally, { sent: 0, quiet: 0, capped: 0, off: 1, noChannel: 0, failed: 0 });
  assert.equal(sent.calls.webpush.length, 0);
  assert.equal(sent.calls.telegram.length, 0);
  assert.equal((await listNotes(s, WALLET)).length, 1, "the list is still the record");
  /* Turned back on, the next thing that happens goes out. */
  await writePrefs(s, WALLET, { on: true }, NOW);
  await note(s, WALLET, draft({ identity: "resolved:vev2" }), NOW);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW)).sent, 1);
});

test("with no channel chosen, or none the deployment has, a note is `no_channel` and not a failure", async () => {
  const s = store();
  const sent = spy();
  await writePrefs(s, WALLET, { channels: [] }, NOW);
  await note(s, WALLET, draft(), NOW);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW)).noChannel, 1);
  assert.equal(sent.calls.telegram.length, 0);

  const bare = store();
  await note(bare, WALLET, draft(), NOW);
  assert.equal((await deliverNotes(bare, WALLET, { transports: {}, words }, NOW)).noChannel, 1);
});

test("a transport that failed leaves the note said-so, and is not tried again by itself", async () => {
  const s = store();
  const sent = spy({ webpush: "failed", telegram: "failed" });
  await note(s, WALLET, draft(), NOW);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW)).failed, 1);
  assert.equal((await listNotes(s, WALLET))[0].delivery, "failed");
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW + 1_000)).failed, 0);
  assert.equal(sent.calls.telegram.length, 1);
});

test("one channel sent is sent, whatever the other answered", async () => {
  const s = store();
  const sent = spy({ webpush: "failed", telegram: "sent" });
  await note(s, WALLET, draft(), NOW);
  assert.equal((await deliverNotes(s, WALLET, { transports: sent.transports, words }, NOW)).sent, 1);
});

test("the person's own settings are clamped to what the channel can honour", () => {
  const base = defaultPrefs(WALLET, NOW);
  assert.equal(base.on, true);
  assert.deepEqual(base.channels, ["webpush", "telegram"]);
  assert.equal(base.perHour, NOTES_PER_HOUR_DEFAULT);
  assert.deepEqual(mergePrefs(base, { channels: ["telegram", "smoke-signal"] }, NOW).channels, ["telegram"]);
  assert.equal(mergePrefs(base, { perHour: 0 }, NOW).perHour, 1);
  assert.equal(mergePrefs(base, { perHour: 9_000 }, NOW).perHour, 60);
  assert.equal(mergePrefs(base, { perHour: Number.NaN }, NOW).perHour, NOTES_PER_HOUR_DEFAULT, "an unreadable figure leaves the choice as it was");
  assert.equal(mergePrefs(base, { quietHours: { start: "25:00", end: "08:00", timezone: "UTC" } }, NOW).quietHours, null, "a clock nobody has is no window");
  assert.deepEqual(mergePrefs(base, { quietHours: { start: "22:00", end: "08:00", timezone: "Europe/Kyiv" } }, NOW).quietHours, { start: "22:00", end: "08:00", timezone: "Europe/Kyiv" });
  assert.equal(mergePrefs({ ...base, quietHours: { start: "22:00", end: "08:00", timezone: "UTC" } }, { quietHours: null }, NOW).quietHours, null);
  assert.equal(deliveryDecision(base, NOW).decision, "send");
  assert.equal(deliveryDecision({ ...base, on: false }, NOW).decision, "off");
  assert.equal(deliveryDecision({ ...base, channels: [] }, NOW).decision, "no_channel");
});

test("settings are kept for the wallet and read back; an unknown wallet reads the defaults", async () => {
  const s = store();
  await writePrefs(s, WALLET, { on: false, perHour: 3 }, NOW);
  const kept = await readPrefs(s, WALLET, NOW);
  assert.equal(kept.on, false);
  assert.equal(kept.perHour, 3);
  assert.equal((await readPrefs(s, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", NOW)).on, true);
});

test("notes are marked read, one by one or all at once, and the oldest are pruned", async () => {
  const s = store();
  for (let i = 0; i < 3; i += 1) await note(s, WALLET, draft({ identity: `resolved:vev${i}` }), NOW + i);
  const [newest] = await listNotes(s, WALLET);
  assert.equal(await markRead(s, WALLET, [newest.id], NOW), 1);
  assert.equal((await listNotes(s, WALLET)).filter((n) => n.readAt !== null).length, 1);
  assert.equal(await markRead(s, WALLET, null, NOW), 2);
  assert.equal((await listNotes(s, WALLET)).every((n) => n.readAt !== null), true);
  await pruneNotes(s, WALLET, NOW + 3 * 3_600_000);
  assert.equal((await listNotes(s, WALLET)).length, 3, "three notes are well inside what is kept");
});
