// Run from repo root: node --test lib/monitoring/telegram-locale.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { rememberChat } from "../assistant/telegram/link.ts";
import { reminderWords } from "../autoinvest/words.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { telegramText } from "./copy.ts";
import { deliverOutbox } from "./deliver.ts";
import { inboxKeyOf } from "./apply.ts";
import { inboxOf, outboxOf } from "./store.ts";
import { buttonIn, noteForChat, usdFromWord } from "./telegram-locale.ts";

/**
 * SOL-C15: a note reaches Telegram in the language the person reads the chat in — never «Time for your purchase» in
 * English among Ukrainian messages — and never half in one language and half in the other.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const CHAT = 700000001;
const NOW = Date.parse("2026-10-22T09:00:00.000Z");
const WEEKLY = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: "Europe/Kyiv" };

function reminderNote(locale, overrides = {}) {
  const words = reminderWords({ name: "Apple", amountUsd: 1234.5, schedule: WEEKLY });
  return {
    id: "inb_0123456789abcdef01234567",
    owner: OWNER,
    monitorId: "mon_0123456789abcdef01234567",
    triggerId: "autoinvest:rule_x:2026-10-22T16:00:00.000Z:AAPLx",
    title: words[locale].title,
    reason: words[locale].reason,
    context: "Apple",
    href: "/app/alerts/open?n=inb_0123456789abcdef01234567",
    cta: words[locale].cta,
    paper: false,
    unread: true,
    createdAt: new Date(NOW).toISOString(),
    locale,
    text: { en: { title: words.en.title, reason: words.en.reason }, uk: { title: words.uk.title, reason: words.uk.reason } },
    ...overrides,
  };
}

function planNote(overrides = {}) {
  return {
    id: "inb_abcdefabcdefabcdefabcdef",
    owner: OWNER,
    monitorId: "mon_abcdefabcdefabcdefabcdef",
    triggerId: "plan_x:plan.evidence:fail",
    title: "A condition in your plan is no longer met",
    reason: "Review the plan on today's figures.",
    context: "SOL",
    href: "/app/alerts/open?n=inb_abcdefabcdefabcdefabcdef",
    cta: "Review plan",
    paper: false,
    unread: true,
    createdAt: new Date(NOW).toISOString(),
    locale: "en",
    text: { en: { title: "A condition in your plan is no longer met", reason: "Review the plan on today's figures." }, uk: { title: "Умова твого плану більше не виконується", reason: "Переглянь план на сьогоднішніх цифрах." } },
    ...overrides,
  };
}

test("a figure usdWord wrote reads back in either language; anything else is not a figure", () => {
  assert.equal(usdFromWord("$10", "en"), 10);
  assert.equal(usdFromWord("$1,234.50", "en"), 1234.5);
  assert.equal(usdFromWord("$1 234,50", "uk"), 1234.5);
  assert.equal(usdFromWord("$1 234,5", "uk"), 1234.5);
  assert.equal(usdFromWord("$0,60", "uk"), 0.6);
  assert.equal(usdFromWord("10", "en"), null);
  assert.equal(usdFromWord("$1.2.3", "en"), null);
  assert.equal(usdFromWord("$abc", "en"), null);
});

test("a button is said in the chat's language: Нагляд's own words and a reminder's «Купити $N»; anything else is not", () => {
  assert.equal(buttonIn({ cta: "Review plan", locale: "en" }, "uk"), "Переглянути план");
  assert.equal(buttonIn({ cta: "Відкрити продаж", locale: "uk" }, "en"), "Open the sale");
  const words = reminderWords({ name: "Apple", amountUsd: 1234.5, schedule: WEEKLY });
  assert.equal(buttonIn({ cta: words.en.cta, locale: "en" }, "uk"), words.uk.cta);
  assert.equal(buttonIn({ cta: words.uk.cta, locale: "uk" }, "en"), words.en.cta);
  assert.equal(buttonIn({ cta: "Open brief", locale: "en" }, "uk"), null);
  assert.equal(buttonIn({ cta: "Open brief", locale: "en" }, "en"), "Open brief");
});

test("a note is said whole in the chat's language, or whole in its own — never half and half", () => {
  const en = reminderNote("en");
  const said = noteForChat(en, "uk");
  assert.equal(said.locale, "uk");
  assert.match(said.title, /^Час твоєї покупки/);
  assert.match(said.cta, /^Купити \$1/);
  assert.equal(noteForChat(en, null), en, "a chat with no language keeps the note as written");
  assert.equal(noteForChat(en, "en"), en);
  const noText = { ...en, text: undefined };
  assert.equal(noteForChat(noText, "uk"), noText, "a note without its words in both languages stays in its own");
  const strangeButton = { ...en, cta: "Open brief" };
  assert.equal(noteForChat(strangeButton, "uk"), strangeButton, "a button that cannot be said there keeps the note whole in its own language");
});

test("the plan's note in Telegram: its scaffold in the language it is said in", () => {
  assert.equal(telegramText({ label: "SOL", reason: "x", href: "https://ryntra.io/a", paper: false }), "Ryntra\nYour SOL plan needs attention.\nx\n\nReview plan\nhttps://ryntra.io/a");
  assert.equal(telegramText({ label: "SOL", reason: "x", href: "https://ryntra.io/a", paper: true }, "uk"), "Ryntra\nПапір\nТвій план «SOL» потребує уваги.\nx\n\nПереглянути план\nhttps://ryntra.io/a");
  assert.equal(telegramText({ label: null, reason: null, href: "https://ryntra.io/a", paper: false }, "uk"), "Ryntra\nТвій план потребує уваги.\n\nПереглянути план\nhttps://ryntra.io/a");
});

async function seed(note, chatLocale) {
  const store = createMemoryGuardStore();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: CHAT, username: "owner", connectedAt: new Date(NOW).toISOString() });
  if (chatLocale) assert.ok(await rememberChat(store, { telegramId: CHAT, accountId: ACCOUNT, locale: chatLocale, nowMs: NOW }));
  await inboxOf(store).insertIfAbsent(inboxKeyOf(OWNER, note.id), note);
  const at = new Date(NOW).toISOString();
  await outboxOf(store).set("out_1", { id: "out_1", owner: OWNER, triggerId: note.triggerId, inboxId: note.id, channel: "telegram", state: "pending", attempts: 0, nextAttemptAt: at, lastError: null, createdAt: at, updatedAt: at });
  return store;
}

const fakeTelegram = (sent) => ({
  accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
  send: async (chatId, text, keyboard) => {
    sent.push({ chatId, text, keyboard });
    return { message_id: sent.length };
  },
});

test("a reminder written on an English screen reaches a Ukrainian chat in Ukrainian — the words and the button", async () => {
  const store = await seed(reminderNote("en", { subject: { kind: "autoinvest-budget", id: "budget:2026-10" } }), "uk");
  const sent = [];
  await deliverOutbox(store, NOW, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Ryntra\nЧас твоєї покупки: \$1\s234,50 в Apple\n/u);
  assert.doesNotMatch(sent[0].text, /Time for your purchase/);
  assert.match(sent[0].keyboard[0][0].text, /^Купити \$1\s234,50$/u);
  assert.equal((await outboxOf(store).get("out_1")).state, "sent");
});

test("a plan's note from the English tick reaches a Ukrainian chat in Ukrainian; a chat with no language keeps the note's own", async () => {
  const sentUk = [];
  await deliverOutbox(await seed(planNote(), "uk"), NOW, { telegram: fakeTelegram(sentUk) });
  assert.equal(sentUk[0].text, "Ryntra\nТвій план «SOL» потребує уваги.\nПереглянь план на сьогоднішніх цифрах.\n\nПереглянути план\nhttps://ryntra.io/app/alerts/open?n=inb_abcdefabcdefabcdefabcdef");
  assert.equal(sentUk[0].keyboard[0][0].text, "Переглянути план");
  const sentNone = [];
  await deliverOutbox(await seed(planNote(), null), NOW, { telegram: fakeTelegram(sentNone) });
  assert.match(sentNone[0].text, /^Ryntra\nYour SOL plan needs attention\./);
  assert.equal(sentNone[0].keyboard[0][0].text, "Review plan");
});
