import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { listInbox, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { cardIdOf, cardOf, cardPage, cardsOf, keepCard, postText, postUrl, readCard, shareWorthy } from "./card.ts";
import { DRIVE_KINDS, DriveEventSchema, PAUSE_WHYS, driveIdentity, topicOf, weekIdentity, xOf, xText } from "./events.ts";
import { coinName, heldText, solPlain, solSigned } from "./figures.ts";
import { cardOfHref, driveKeyboard, driveKindOf, driveNote, driveWords, isDriveNote, pulseHref, stopHref } from "./note.ts";
import { defaultDriveSettings, driveSettingsOf, DriveSettingsChangeSchema, keepDriveSettings, readDriveSettings } from "./settings.ts";
import { tellDrive } from "./tell.ts";
import { FRESH_MS, agentSoldEvents, exitFailedEvents, runDrivePass, soldEvent, stateEvent } from "./watch.ts";
import { isoWeek, runWeekPass, weekDue, weekSummary, weekWords } from "./week.ts";
import { DRIVE_WORDS } from "./words.ts";

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ACCOUNT = "0b7c6f0e-3c1d-4e5a-9a5b-2f1e8d7c6b5a";
const COIN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const POLICY = "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3";
const SALE_POLICY = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
/* Monday 23 Nov 2026, 10:30 in Kyiv (UTC+2). */
const T0 = Date.UTC(2026, 10, 23, 8, 30);
const MIN = 60_000;
const H = 60 * MIN;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sig = (n) => {
  let out = "";
  let left = n;
  do {
    out = B58[left % 58] + out;
    left = Math.floor(left / 58);
  } while (left > 0);
  return `5${"K".repeat(79)}${out.padStart(8, "1")}`;
};
const trade = (at, spent, received, n) => ({ at, status: "ok", signature: sig(n), spentRaw: String(spent), receivedRaw: received === null ? null : String(received), reason: null });
const entry = (patch = {}) => ({
  v: 1,
  cluster: "mainnet",
  record: { owner: OWNER, settings: OWNER, vault: OWNER, policy: POLICY, budget: OWNER, perTrade: "500000000", perDay: "1000000000", expiresAt: "0" },
  strategy: "steady",
  said: null,
  receiveMint: COIN,
  status: "working",
  trades: [],
  createdAt: T0 - 3 * 86_400_000,
  updatedAt: T0 - H,
  ...patch,
});

const telegramFake = () => {
  const sent = [];
  return {
    sent,
    telegram: {
      accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
      chatLocale: async () => null,
      send: async (chatId, text, keyboard) => {
        sent.push({ chatId, text, keyboard });
        return { message_id: sent.length };
      },
      buttons: () => [[{ text: "not the drive's", url: "https://example.invalid" }]],
    },
  };
};

async function stand() {
  const store = createMemoryGuardStore();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: new Date(T0).toISOString() });
  return store;
}

const bought = (patch = {}) => ({ kind: "bought", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: "JUP" }, at: T0, signature: sig(1), spentRaw: "500000000", receivedRaw: "1234000", ...patch });
const sold = (patch = {}) => ({ kind: "sold", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: "JUP" }, at: T0, signature: sig(2), entryRaw: "500000000", exitRaw: "620000000", openedAt: T0 - 3 * H, why: null, ...patch });

/* ------------------------------------------------------------------ figures */

test("the «×»: what came out over what went in, rounded down — a card never reads better than the trade", () => {
  assert.equal(xOf("500000000", "620000000"), 1.24);
  assert.equal(xOf("300000000", "1000000000"), 3.333);
  assert.equal(xOf("0", "1"), null);
  assert.equal(xText(3.333), "×3.33");
  assert.equal(xText(0.879, "uk"), "×0,87");
  assert.equal(xText(12.38), "×12.3");
  assert.equal(xText(1234.9), "×1234");
  assert.equal(solPlain("500000000", "uk"), "0,5");
  assert.equal(solPlain("12345678", "en"), "0.0123");
  assert.equal(solSigned("120000000", "en"), "+0.12 SOL");
  assert.equal(solSigned("-30001", "en"), "−0.0001 SOL", "a loss is never rounded away");
  assert.equal(heldText(3 * H, "en"), "3 h");
  assert.equal(heldText(90 * MIN, "uk"), "90 хв");
  assert.equal(heldText(3 * 86_400_000, "uk"), "3 дн");
  assert.equal(heldText(null, "en"), null);
  assert.equal(coinName({ mint: COIN, symbol: null }, "en"), "coin JUPy…");
});

/* ------------------------------------------------------------------ events */

test("an event is told only in its shape, and once by its identity", () => {
  assert.deepEqual([...DRIVE_KINDS], ["bought", "sold", "paused", "stopped"]);
  assert.ok(DriveEventSchema.safeParse(bought()).success);
  assert.ok(DriveEventSchema.safeParse(sold()).success);
  assert.ok(!DriveEventSchema.safeParse({ ...sold(), entryRaw: "-1" }).success, "no negative figure");
  assert.ok(!DriveEventSchema.safeParse({ ...bought(), extra: 1 }).success, "nothing beside the shape");
  assert.ok(!DriveEventSchema.safeParse({ ...bought(), kind: "promised" }).success);
  assert.equal(driveIdentity(bought()), `agent-drive:bought:mainnet:${sig(1)}`);
  assert.equal(driveIdentity({ kind: "paused", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: null }, at: T0, why: "loss" }, 3), `agent-drive:paused:mainnet:${POLICY}:loss:3`);
  assert.equal(weekIdentity(OWNER, "2026-W48"), `agent-drive:week:${OWNER}:2026-W48`);
});

/** Hype the brand never says, and the technical words a person never reads. */
const NEVER = [/\bmoon/i, /\b100x\b|\b1000x\b|x1000|х1000/i, /guarantee|гарант/i, /risk-?free|без ризику/i, /get rich|lambo|passive income|can't lose|sure thing/i, /\bAPI\b|\bendpoint\b|\bengine\b|\bJSON\b|\bRPC\b|\bwebhook\b|\bcron\b|\bdevnet\b/i, /двигун|ендпоінт/i, /!/];

test("the words: both languages alike, only the trade's facts — no hype, no promise, no technical word", () => {
  assert.deepEqual(Object.keys(DRIVE_WORDS.uk).sort(), Object.keys(DRIVE_WORDS.en).sort());
  for (const lang of ["en", "uk"]) {
    for (const [key, value] of Object.entries(DRIVE_WORDS[lang])) {
      const said = typeof value === "string" ? value : value(...Array.from({ length: value.length }, (_, i) => (i ? "1" : "JUP")));
      for (const word of NEVER) assert.doesNotMatch(said, word, `${lang}.${key}: «${said}»`);
      if (typeof value === "function") assert.equal(value.length, DRIVE_WORDS.en[key].length, `${lang}.${key}: the same arguments`);
    }
  }
  assert.deepEqual(driveWords(bought(), "en"), { title: "Your agent bought JUP", reason: "Spent 0.5 SOL" });
  assert.deepEqual(driveWords(sold(), "uk"), { title: "Твій агент продав JUP · ×1,24", reason: "0,5 → 0,62 SOL за 3 год" });
  assert.deepEqual(driveWords(sold({ why: "take", openedAt: null }), "en"), { title: "Your agent sold JUP · ×1.24", reason: "0.5 → 0.62 SOL · half at 2x" });
  assert.deepEqual(driveWords({ kind: "paused", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: "JUP" }, at: T0, why: "unread" }, "en"), { title: "Your agent paused", reason: "JUP · The price could not be read" });
  assert.deepEqual(driveWords({ kind: "stopped", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: "JUP" }, at: T0, why: "you" }, "uk"), { title: "Твій агент зупинився", reason: "JUP · Натиснуто «Стоп» — нових угод не буде" });
});

/* ------------------------------------------------------------------ the note and its buttons */

test("a note opens the agent's own page; Telegram carries «Stop agent», and «Share on X» under a closed trade worth it", () => {
  const note = driveNote(bought(), driveIdentity(bought()), "en", T0);
  assert.ok(isDriveNote(note));
  assert.equal(driveKindOf(note), "bought");
  assert.equal(note.href, pulseHref(POLICY));
  assert.equal(stopHref(note.href), `/agent/pulse?p=${POLICY}&do=stop`);
  assert.equal(note.text.uk.title, "Твій агент купив JUP");
  const link = { text: "Open my agent", url: `https://ryntra.io${note.href}` };
  assert.deepEqual(driveKeyboard(note, link, "https://ryntra.io"), [[{ text: "Stop agent", url: `https://ryntra.io/agent/pulse?p=${POLICY}&do=stop` }, link]]);
  const card = "a".repeat(20);
  const closed = driveNote(sold(), driveIdentity(sold()), "uk", T0, card);
  assert.equal(cardOfHref(closed.href), card);
  assert.deepEqual(driveKeyboard(closed, link, "https://ryntra.io")[0], [{ text: "Поділитися в X", url: `https://ryntra.io/api/v1/agent-drive/card/${card}/post?l=uk` }]);
  const stopped = driveNote({ kind: "stopped", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: null }, at: T0, why: "ended" }, "agent-drive:stopped:x", "en", T0);
  assert.deepEqual(driveKeyboard(stopped, link, "https://ryntra.io"), [[link]], "a stopped agent has nothing to stop");
});

/* ------------------------------------------------------------------ settings */

test("her settings: all on until she says otherwise, in her daily report's clock and language", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await readDriveSettings(store, OWNER), null);
  const plain = await driveSettingsOf(store, OWNER);
  assert.deepEqual(plain.topics, { bought: true, sold: true, paused: true, stopped: true, week: true });
  assert.equal(plain.locale, "en");
  await store.versioned("agentReports").set(`r:${OWNER}`, { version: 1, owner: OWNER, on: true, hour: 20, timezone: "Europe/Kyiv", locale: "uk", toldDay: null, toldAt: null, updatedAt: "" });
  assert.deepEqual([(await driveSettingsOf(store, OWNER)).locale, (await driveSettingsOf(store, OWNER)).timezone], ["uk", "Europe/Kyiv"]);
  const kept = await keepDriveSettings(store, OWNER, { topics: { bought: false }, push: false }, T0);
  assert.deepEqual([kept.topics.bought, kept.topics.sold, kept.push, kept.telegram, kept.locale, kept.version], [false, true, false, true, "uk", 1]);
  assert.equal((await keepDriveSettings(store, OWNER, { timezone: "Nowhere/City" }, T0)).timezone, "UTC");
  assert.ok(!DriveSettingsChangeSchema.safeParse({ topics: { everything: true } }).success);
  assert.ok(!DriveSettingsChangeSchema.safeParse({ owner: OTHER }).success, "a change never names a wallet: the proof does");
  await assert.rejects(keepDriveSettings(store, "nope", {}, T0));
  assert.equal(defaultDriveSettings(OWNER).version, 0);
});

/* ------------------------------------------------------------------ telling */

test("telling: once by identity, quiet when she turned it off, to each channel she and Ryntra allow", async () => {
  const store = await stand();
  const delivered = [];
  const first = await tellDrive(store, bought(), { clock: () => T0, deliver: async (rows) => delivered.push([...rows]) });
  assert.equal(first.told, true);
  assert.equal(first.rows.length, 2, "Telegram and the phone");
  assert.equal(delivered.length, 1, "sent at once");
  assert.deepEqual(await tellDrive(store, bought(), { clock: () => T0 }), { told: false, why: "told-before", card: null });
  assert.deepEqual(await tellDrive(store, { ...bought(), spentRaw: "x" }, { clock: () => T0 }), { told: false, why: "invalid", card: null });
  await keepDriveSettings(store, OWNER, { topics: { bought: false } }, T0);
  assert.equal((await tellDrive(store, bought({ signature: sig(9) }), { clock: () => T0 })).why, "muted");
  // Ryntra's own switch for Telegram off: only the phone.
  await preferencesOf(store).set(`solana:mainnet:${OWNER}`, { version: 1, owner: OWNER, inbox: true, telegram: false, push: true, quietHours: null, updatedAt: "" });
  const paused = await tellDrive(store, { kind: "paused", owner: OWNER, cluster: "mainnet", policy: POLICY, coin: { mint: COIN, symbol: "JUP" }, at: T0, why: "loss" }, { clock: () => T0 }, 2);
  assert.equal(paused.rows.length, 1);
  assert.match(paused.rows[0], /:push$/u);
  assert.equal((await listInbox(store, OWNER)).length, 2, "the inbox keeps what was told");
});

test("a closed trade keeps its «×» card first; only a gain is offered for sharing", async () => {
  const store = await stand();
  const told = await tellDrive(store, sold(), { clock: () => T0 });
  assert.equal(told.card, cardIdOf(sold()));
  const card = await readCard(store, told.card);
  assert.deepEqual([card.entryRaw, card.exitRaw, card.x, card.closedAt, card.coin.symbol], ["500000000", "620000000", 1.24, T0, "JUP"]);
  assert.equal(cardOfHref((await listInbox(store, OWNER))[0].href), card.id);
  // The same trade, told again: the same card, nothing new.
  assert.equal((await tellDrive(store, sold(), { clock: () => T0 + MIN })).card, card.id);
  assert.equal((await cardsOf(store, OWNER)).length, 1);
  // A loss keeps its card too, but its note carries no «Share».
  const lost = sold({ signature: sig(3), exitRaw: "400000000" });
  const toldLost = await tellDrive(store, lost, { clock: () => T0 });
  assert.equal(shareWorthy(await readCard(store, toldLost.card)), false);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.filter((note) => cardOfHref(note.href)).length, 1);
  // Muted, the card is still kept: she can share it from her bots.
  await keepDriveSettings(store, OWNER, { topics: { sold: false } }, T0);
  const muted = await tellDrive(store, sold({ signature: sig(4) }), { clock: () => T0 });
  assert.equal(muted.why, "muted");
  assert.ok(await readCard(store, muted.card));
});

test("the card's post: the trade's own words and its page — and an id that says nothing but the trade", async () => {
  const card = cardOf(sold(), "en", T0);
  assert.match(card.id, /^[a-f0-9]{20}$/u);
  assert.equal(cardOf(sold(), "uk", T0 + H).id, card.id, "one trade, one card");
  assert.equal(postText(card, "en"), "My agent on Ryntra closed JUP: ×1.24 in 3 h.");
  assert.equal(postText(card, "uk"), "Мій агент у Ryntra закрив JUP: ×1,24 за 3 год.");
  assert.equal(cardPage(card.id), `https://ryntra.io/x/${card.id}`);
  const url = new URL(postUrl(card, "en"));
  assert.equal(url.origin, "https://x.com");
  assert.equal(url.searchParams.get("url"), `https://ryntra.io/x/${card.id}`);
  for (const word of NEVER) assert.doesNotMatch(postText(card, "en"), word);
  const store = createMemoryGuardStore();
  await keepCard(store, card);
  assert.equal((await readCard(store, card.id)).owner, OWNER);
  assert.equal(await readCard(store, "../x"), null);
});

test("delivery: Telegram says the move plainly, with «Stop agent» and the link to the agent", async () => {
  const store = await stand();
  const { sent, telegram } = telegramFake();
  await tellDrive(store, bought(), { clock: () => T0, deliver: (rows, atMs) => deliverOutbox(store, atMs, { telegram }) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "Ryntra\nYour agent bought JUP\nSpent 0.5 SOL");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Stop agent", url: `https://ryntra.io/agent/pulse?p=${POLICY}&do=stop` }, { text: "Open my agent", url: `https://ryntra.io/agent/pulse?p=${POLICY}` }]]);
  const rows = await outboxOf(store).valuesWithPrefix("");
  assert.equal(rows.find((row) => row.channel === "telegram").state, "sent");
  // The closed trade: «Share on X» first, then «Stop agent» and the link.
  await keepDriveSettings(store, OWNER, { locale: "uk" }, T0);
  await tellDrive(store, sold(), { clock: () => T0, deliver: (rows2, atMs) => deliverOutbox(store, atMs, { telegram }) });
  assert.equal(sent[1].text, "Ryntra\nТвій агент продав JUP · ×1,24\n0,5 → 0,62 SOL за 3 год");
  assert.equal(sent[1].keyboard[0][0].text, "Поділитися в X");
  assert.equal(sent[1].keyboard[1][0].text, "Зупинити агента");
});

/* ------------------------------------------------------------------ the watch */

const sale = (patch = {}) => ({ v: 1, kind: "sale", cluster: "mainnet", parent: POLICY, record: { owner: OWNER, policy: SALE_POLICY }, coin: COIN, amountRaw: "500", status: "sold", trade: trade(T0 - 2 * MIN, 0, 300_000_000, 50), updatedAt: T0, ...patch });

test("a sale as a closed trade: what the coins sold cost her (rounded up) and what came back", () => {
  const parent = entry({ trades: [trade(T0 - 3 * H, 100_000_000, 400, 1), trade(T0 - 2 * H, 100_000_000, 600, 2)] });
  const event = soldEvent(sale(), parent, T0);
  assert.deepEqual([event.entryRaw, event.exitRaw, event.openedAt, event.policy], ["100000000", "300000000", T0 - 3 * H, POLICY]);
  assert.equal(soldEvent(sale({ amountRaw: "333" }), parent, T0).entryRaw, "66600000");
  assert.equal(soldEvent(sale({ status: "signed" }), parent, T0), null, "not sold yet");
  assert.equal(soldEvent(sale({ trade: { ...trade(T0 - 2 * MIN, 0, null, 50) } }), parent, T0), null, "what came back not read yet");
  assert.equal(soldEvent(sale({ trade: trade(T0 - FRESH_MS - MIN, 0, 300_000_000, 50) }), parent, T0), null, "history, not news");
  assert.equal(soldEvent(sale({ record: { owner: OTHER, policy: SALE_POLICY } }), parent, T0), null, "another wallet's sale");
});

test("a state is told by its change: her «Stop», a pause and why, an end — never on first sight", () => {
  const was = { version: 1, kind: "cursor", cluster: "mainnet", policy: POLICY, owner: OWNER, status: "working", pausedBy: null, frozen: false, seenAt: T0 - MIN };
  assert.equal(stateEvent(entry({ status: "paused", pausedBy: "loss" }), null, false, T0), null);
  assert.equal(stateEvent(entry(), was, true, T0).why, "you");
  assert.equal(stateEvent(entry(), was, null, T0), null, "a switch not read tells nothing");
  assert.equal(stateEvent(entry({ status: "paused", pausedBy: "loss" }), was, false, T0).why, "loss");
  assert.equal(stateEvent(entry({ status: "paused", pausedBy: "loss" }), { ...was, status: "paused", pausedBy: "loss" }, false, T0), null);
  assert.equal(stateEvent(entry({ status: "paused", pausedBy: "market" }), { ...was, status: "paused", pausedBy: "loss" }, false, T0).why, "market");
  assert.equal(stateEvent(entry({ status: "ended" }), was, false, T0).why, "ended");
  assert.equal(stateEvent(entry({ status: "stopped" }), was, false, T0).why, "withdrawn");
  assert.equal(stateEvent(entry({ status: "spent" }), was, false, T0).kind, "stopped");
});

test("the watch: new trades and changes told once each; first sight only noted; old trades are history", async () => {
  const store = await stand();
  let book = [entry({ trades: [trade(T0 - 2 * H, 500_000_000, 1_000, 1)] })];
  let frozen = new Set();
  let sales = [];
  let now = T0;
  const { sent, telegram } = telegramFake();
  const pass = () =>
    runDrivePass({
      store,
      cluster: "mainnet",
      clock: () => now,
      book: async () => book,
      frozen: async () => frozen,
      sales: async () => sales,
      symbols: async (mints) => Object.fromEntries(mints.map((mint) => [mint, mint === COIN ? "JUP" : null])),
      deliver: (rows, atMs) => deliverOutbox(store, atMs, { telegram }),
    });
  // First sight: the old trade is history, the state only noted.
  assert.equal((await pass()).told, 0);
  assert.equal(sent.length, 0);
  // A new trade lands: told, once.
  now = T0 + 5 * MIN;
  book = [entry({ trades: [...book[0].trades, trade(T0 + 4 * MIN, 500_000_000, 1_000, 2)] })];
  assert.equal((await pass()).told, 1);
  assert.equal((await pass()).told, 0, "a second pass tells nothing new");
  assert.equal(sent.at(-1).text, "Ryntra\nYour agent bought JUP\nSpent 0.5 SOL");
  // A trade still being confirmed waits; once confirmed it is told.
  now = T0 + 10 * MIN;
  const open = { ...trade(T0 + 9 * MIN, 0, null, 3), status: "failed", unsettledRaw: "500000000" };
  book = [entry({ trades: [...book[0].trades, open] })];
  assert.equal((await pass()).told, 0);
  book = [entry({ trades: [...book[0].trades.slice(0, -1), trade(T0 + 9 * MIN, 500_000_000, 990, 3)] })];
  assert.equal((await pass()).told, 1);
  // She presses «Stop»: told once.
  frozen = new Set([POLICY]);
  assert.equal((await pass()).told, 1);
  assert.equal(sent.at(-1).text, "Ryntra\nYour agent stopped\nJUP · Stop pressed — no new trades");
  assert.deepEqual(sent.at(-1).keyboard.flat().map((button) => button.text), ["Open my agent"]);
  assert.equal((await pass()).told, 0);
  // She resumes, it pauses itself: told once, with why.
  frozen = new Set();
  await pass();
  book = [entry({ trades: book[0].trades, status: "paused", pausedBy: "losses" })];
  assert.equal((await pass()).told, 1);
  assert.equal(sent.at(-1).text, "Ryntra\nYour agent paused\nJUP · Several buys in a row are down");
  // A sale through it closes a trade: told with its «×».
  sales = [sale({ trade: trade(now - MIN, 0, 1_500_000_000, 60), amountRaw: "2000" })];
  assert.equal((await pass()).told, 1);
  assert.equal(sent.at(-1).text, `Ryntra\nYour agent sold JUP · ×1.49\n1.003 → 1.5 SOL in 2 h`, "the 2,000 coins sold cost their share of 1.5 SOL for 2,990");
  // A failed read of her switch never tells a «Stop».
  const failing = await runDrivePass({ store, cluster: "mainnet", clock: () => now, book: async () => book, frozen: async () => Promise.reject(new Error("down")), sales: async () => [], symbols: async () => ({}) });
  assert.equal(failing.told, 0);
});

/* ------------------------------------------------------------------ The agent's own exit */

const ownSale = (patch = {}) => ({ at: T0 - 2 * MIN, why: "stop", status: "ok", signature: sig(70), soldRaw: "1000", gotRaw: "400000000", costRaw: "500000000", reason: null, ...patch });

test("the agent's own sales by her rules are closed trades: the cost they carried, what reached her, why — and a sale that did not go is told too", async () => {
  const book = entry({ trades: [trade(T0 - 3 * H, 500_000_000, 1_000, 1)], sales: [ownSale()], events: [{ v: 1, kind: "exit_failed", at: T0 - MIN, policy: POLICY, owner: OWNER, coin: COIN, why: "half", tries: 3, retryAt: T0 + 29 * MIN }] });
  const [event] = agentSoldEvents(book, T0);
  assert.deepEqual([event.kind, event.entryRaw, event.exitRaw, event.openedAt, event.why], ["sold", "500000000", "400000000", T0 - 3 * H, "stop"]);
  assert.ok(DriveEventSchema.safeParse(event).success);
  assert.equal(agentSoldEvents(entry({ sales: [ownSale({ why: "half" })] }), T0)[0].why, "take", "half at 2x is the take");
  assert.deepEqual(agentSoldEvents(entry({ sales: [ownSale({ gotRaw: null })] }), T0), [], "what reached her not read yet");
  assert.deepEqual(agentSoldEvents(entry({ sales: [ownSale({ status: "failed" })] }), T0), []);
  assert.deepEqual(agentSoldEvents(entry({ sales: [ownSale({ at: T0 - FRESH_MS - MIN })] }), T0), [], "history, not news");
  const [failed] = exitFailedEvents(book, T0);
  assert.deepEqual([failed.kind, failed.why, failed.retryAt], ["exit_failed", "take", T0 + 29 * MIN]);
  assert.ok(DriveEventSchema.safeParse(failed).success);
  assert.equal(driveIdentity(failed), `agent-drive:exit_failed:mainnet:${POLICY}:${T0 - MIN}`);
  assert.equal(topicOf("exit_failed"), "sold", "told under «sold»: no switch of its own");
  assert.deepEqual(driveWords({ ...failed, coin: { mint: COIN, symbol: "JUP" } }, "en"), { title: "Your agent could not sell JUP", reason: "half at 2x · it tries again" });
  assert.deepEqual(driveWords({ ...failed, coin: { mint: COIN, symbol: "JUP" } }, "uk"), { title: "Твій агент не зміг продати JUP", reason: "половина на 2x · спробує ще" });
  for (const why of ["fade", "time", "blind"]) assert.ok(PAUSE_WHYS.includes(why), why);
  /* Through the watch: both told once, with «Stop agent» under each. */
  const store = await stand();
  const { sent, telegram } = telegramFake();
  const pass = () => runDrivePass({ store, cluster: "mainnet", clock: () => T0, book: async () => [book], frozen: async () => new Set(), sales: async () => [], symbols: async () => ({ [COIN]: "JUP" }), deliver: (rows, atMs) => deliverOutbox(store, atMs, { telegram }) });
  assert.equal((await pass()).told, 2);
  assert.equal((await pass()).told, 0, "once each");
  assert.deepEqual(sent.map((one) => one.text).sort(), ["Ryntra\nYour agent could not sell JUP\nhalf at 2x · it tries again", "Ryntra\nYour agent sold JUP · ×0.80\n0.5 → 0.4 SOL in 2 h · your stop"].sort());
  assert.ok(sent.every((one) => one.keyboard.flat().some((button) => button.text === "Stop agent")));
});

/* ------------------------------------------------------------------ A bot's own sales */

test("a grid's level and a signal's leave are closed trades told at once, with why and «Stop agent» under each", async () => {
  const grid = ownSale({ why: "grid", level: 2, soldRaw: "554", gotRaw: "52000000", costRaw: "50000000" });
  const signal = ownSale({ at: T0 - MIN, why: "signal", signature: sig(71), gotRaw: "45000000", costRaw: "50000000" });
  const book = entry({ trades: [trade(T0 - 3 * H, 50_000_000, 554, 1)], sales: [grid, signal] });
  const events = agentSoldEvents(book, T0);
  assert.deepEqual(events.map((event) => event.why), ["grid", "signal"]);
  for (const event of events) assert.ok(DriveEventSchema.safeParse(event).success);
  const named = (event) => ({ ...event, coin: { mint: COIN, symbol: "MET" } });
  assert.deepEqual(driveWords(named(events[0]), "en"), { title: "Your agent sold MET · ×1.04", reason: "0.05 → 0.052 SOL in 2 h · grid · one step up" });
  assert.deepEqual(driveWords(named(events[1]), "uk").reason, "0,05 → 0,045 SOL за 2 год · сигнал розвернувся");
  const store = await stand();
  const { sent, telegram } = telegramFake();
  const pass = () => runDrivePass({ store, cluster: "mainnet", clock: () => T0, book: async () => [book], frozen: async () => new Set(), sales: async () => [], symbols: async () => ({ [COIN]: "MET" }), deliver: (rows, atMs) => deliverOutbox(store, atMs, { telegram }) });
  assert.equal((await pass()).told, 2, "each sale once");
  assert.equal((await pass()).told, 0);
  assert.ok(sent.every((one) => one.keyboard.flat().some((button) => button.text === "Stop agent")));
});

/* ------------------------------------------------------------------ the week */

test("the week: her ISO week, Monday from 10:00 of her own clock", () => {
  assert.equal(isoWeek(2026, 11, 23), "2026-W48");
  assert.equal(isoWeek(2027, 1, 1), "2026-W53");
  assert.deepEqual(weekDue(T0, "Europe/Kyiv"), { due: true, week: "2026-W48" });
  assert.equal(weekDue(T0 - 2 * H, "Europe/Kyiv").due, false, "8:30 in Kyiv — not yet");
  assert.equal(weekDue(T0 + 86_400_000, "Europe/Kyiv").due, false, "Tuesday — passed");
});

test("the week's figures: trades, spend, the result after every fee, the best closed «×»", () => {
  const span = { since: T0 - 7 * 86_400_000, until: T0 };
  const day = (trades, spent, net) => ({ since: span.since, until: span.until, trades, spentRaw: String(spent), boughtRaw: "0", worthRaw: "0", earnedRaw: "0", netRaw: net === null ? null : String(net), holdRaw: null });
  const best = cardOf(sold({ signature: sig(7), exitRaw: "800000000" }), "en", T0);
  const week = weekSummary([day(10, 1_000_000_000, 80_000_000), day(2, 200_000_000, -10_000_000)], [cardOf(sold(), "en", T0), best], span);
  assert.deepEqual([week.trades, week.spentRaw, week.resultRaw, week.afterFees, week.closed, week.best.card], [12, "1200000000", "70000000", true, 2, best.id]);
  assert.deepEqual(weekWords(week, "en"), { title: "Your agent this week: 12 trades, +0.07 SOL", reason: "spent 1.2 SOL · 2 closed · best ×1.60 JUP · after all fees" });
  assert.equal(weekWords(week, "uk").title, "Твій агент за тиждень: 12 угод, +0,07 SOL");
  const unread = weekSummary([day(1, 1, null)], [], span);
  assert.equal(unread.resultRaw, null, "a result not read is not said");
  assert.equal(weekWords(unread, "en").title, "Your agent this week: 1 trade");
});

test("the week pass: once a week, on her Monday hour, only when an agent traded", async () => {
  const store = await stand();
  await keepDriveSettings(store, OWNER, { timezone: "Europe/Kyiv" }, T0 - 86_400_000);
  const entries = [entry({ trades: [trade(T0 - 86_400_000, 500_000_000, 1_000, 1)] })];
  const read = async (_entry, since, until) => ({ since, until, trades: 1, spentRaw: "500000000", boughtRaw: "1000", worthRaw: "520000000", earnedRaw: "20000000", netRaw: "15000000", holdRaw: null });
  const { sent, telegram } = telegramFake();
  const deliver = (rows, atMs) => deliverOutbox(store, atMs, { telegram });
  assert.equal((await runWeekPass({ store, clock: () => T0 - 2 * H, entries, read, deliver })).told, 0, "not her hour yet");
  assert.equal((await runWeekPass({ store, clock: () => T0, entries, read, deliver })).told, 1);
  assert.equal((await runWeekPass({ store, clock: () => T0 + H, entries, read, deliver })).told, 0, "once a week");
  assert.equal(sent[0].text, "Ryntra\nYour agent this week: 1 trade, +0.015 SOL\nspent 0.5 SOL · after all fees");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Open my agent", url: "https://ryntra.io/bots/recurring" }]]);
  // A price that did not answer: she stays due.
  const other = await stand();
  await keepDriveSettings(other, OWNER, { timezone: "Europe/Kyiv" }, T0);
  assert.equal((await runWeekPass({ store: other, clock: () => T0, entries, read: async () => null })).failed, 1);
  // Off: nothing.
  await keepDriveSettings(other, OWNER, { topics: { week: false } }, T0);
  assert.equal((await runWeekPass({ store: other, clock: () => T0, entries, read })).told, 0);
});

/* ------------------------------------------------------------------ where it is mounted */

test("the phone's push opens the agent's page and carries «Stop agent»; the delivery says the drive in its own words", () => {
  const worker = readFileSync(new URL("../../public/ryntra-push-sw.js", import.meta.url), "utf8");
  assert.match(worker, /\/agent\/pulse\?/u);
  assert.match(worker, /action: "stop"/u);
  assert.match(worker, /event\.action === "stop" \? `\$\{href\}&do=stop`/u);
  const latest = readFileSync(new URL("../../app/api/v1/assistant/push/latest/route.ts", import.meta.url), "utf8");
  assert.match(latest, /isDriveNote\(newest\) \? newest\.href/u);
  const deliver = readFileSync(new URL("../monitoring/deliver.ts", import.meta.url), "utf8");
  assert.match(deliver, /isDriveNote\(inbox\) \? driveKeyboard\(inbox, link, APP\)/u);
  assert.match(deliver, /isAgentReportNote\(inbox\) \|\| isDriveNote\(inbox\)\);/u);
  const cron = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons;
  assert.ok(cron.some((row) => row.path === "/api/v1/agent-drive/tick" && row.schedule === "* * * * *"), "every minute");
});
