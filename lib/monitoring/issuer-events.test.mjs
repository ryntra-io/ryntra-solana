import assert from "node:assert/strict";
import test from "node:test";

import { MonitoringNoteSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { deliverOutbox } from "./deliver.ts";
import { resolveInboxLink } from "./inbox.ts";
import { heldFromParsedAccounts } from "./issuer-balance.server.ts";
import { MAX_READS_PER_TICK, READ_EVERY_MS, TICK_BUDGET_MS, TICK_EVERY_MS, checkIssuerEvents, checkIssuerPages, issuerMonitorId, knownWallets, openWatchedEvents, tickIssuerEvents } from "./issuer-events.ts";
import { issuerNoticeChecksOf, issuerWatchKey, issuerWatchOf, listInbox, monitorNotes, outboxOf, preferencesOf } from "./store.ts";

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const OWNER = "So11111111111111111111111111111111111111112";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const NOW = Date.parse("2026-09-25T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

/** A chain that answers what each wallet holds of SPACEX, and counts the reads. */
function chain(balances) {
  const reads = [];
  const readHeld = async (owner, mints) => {
    reads.push(owner);
    return new Map(mints.map((mint) => [mint, mint === SPACEX && owner in balances ? balances[owner] : 0n]));
  };
  return { reads, readHeld };
}

async function seedPreferences(store, owner, telegram = true) {
  await preferencesOf(store).compareAndSet(`solana:mainnet:${owner}`, null, { version: 0, owner, inbox: true, telegram, push: false, quietHours: null, updatedAt: new Date(NOW).toISOString() });
}

test("today the watch speaks about SpaceX alone: its window is open, xAI's closed", () => {
  assert.deepEqual(openWatchedEvents(NOW).map((event) => event.watch.symbol), ["SPACEX"]);
  assert.deepEqual(openWatchedEvents(Date.parse("2027-03-13T00:00:00Z")), []);
});

test("a holder is told once, in the language their app reads — the note, the link to the swap, the Telegram button", async () => {
  const store = createMemoryGuardStore();
  await seedPreferences(store, OWNER);
  const { reads, readHeld } = chain({ [OWNER]: 16_907n });
  const first = await checkIssuerEvents(store, OWNER, NOW, { readHeld, everyMs: READ_EVERY_MS, locale: "uk" });
  assert.deepEqual(first, { read: true, reminded: 1 });
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  const [note] = notes;
  assert.equal(note.title, "SpaceX вийшла на біржу");
  assert.equal(note.reason, "Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.");
  assert.equal(note.cta, "Обміняти на SpaceX (SPCXx)");
  assert.equal(note.context, "SpaceX");
  assert.equal(note.locale, "uk");
  assert.deepEqual(note.subject, { kind: "issuer-event", id: SPACEX });
  assert.equal(note.monitorId, issuerMonitorId(OWNER, SPACEX));
  assert.equal(note.text.en.title, "SpaceX has gone public");
  assert.equal(note.text.en.reason, "Swap SPACEX by March 12, 2027 — after the deadline the token expires worthless.");
  assert.ok(MonitoringNoteSchema.safeParse(note).success, "the note is the contract's shape");
  /* An issuer's event is not a monitor's: plan memory and the agent's note reads leave it out. */
  assert.deepEqual(monitorNotes(notes), []);
  /* One tap: the token's page with the swap's Review opening. */
  assert.equal(await resolveInboxLink(store, OWNER, note.id), "/app/stocks/SPACEX?convert=1&from=monitoring");
  /* Telegram carries the same words and the button straight to the swap. */
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: new Date(NOW).toISOString() });
  const sent = [];
  await deliverOutbox(store, NOW + MINUTE, { telegram: { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => sent.push({ text, keyboard }) } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "Ryntra\nSpaceX вийшла на біржу\nОбміняй SPACEX до 12 березня 2027 — після строку токен згорить.\n\nhttps://ryntra.io/app/stocks/SPACEX?convert=1&from=monitoring");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Обміняти на SpaceX (SPCXx)", url: "https://ryntra.io/app/stocks/SPACEX?convert=1&from=monitoring" }]]);
  /* The next read within two minutes asks the chain nothing; a later one reads and writes no second note. */
  assert.deepEqual(await checkIssuerEvents(store, OWNER, NOW + MINUTE, { readHeld, everyMs: READ_EVERY_MS, locale: "uk" }), { read: false, reminded: 0 });
  assert.deepEqual(await checkIssuerEvents(store, OWNER, NOW + 3 * MINUTE, { readHeld, everyMs: READ_EVERY_MS, locale: "uk" }), { read: true, reminded: 0 });
  assert.equal(reads.length, 2);
  assert.equal((await listInbox(store, OWNER)).length, 1);
  const record = await issuerWatchOf(store).get(issuerWatchKey(OWNER, SPACEX));
  assert.equal(record.heldRaw, "16907");
  assert.deepEqual(record.sent.map((entry) => entry.stage), ["event"]);
});

test("a wallet that holds none is told nothing, and a read that failed says nothing either", async () => {
  const store = createMemoryGuardStore();
  const none = await checkIssuerEvents(store, OTHER, NOW, { readHeld: chain({}).readHeld, everyMs: READ_EVERY_MS });
  assert.deepEqual(none, { read: true, reminded: 0 });
  assert.equal((await issuerWatchOf(store).get(issuerWatchKey(OTHER, SPACEX))).heldRaw, "0");
  const failed = await checkIssuerEvents(store, OWNER, NOW, { readHeld: async (_owner, mints) => new Map(mints.map((mint) => [mint, null])), everyMs: READ_EVERY_MS });
  assert.deepEqual(failed, { read: true, reminded: 0 });
  assert.equal((await issuerWatchOf(store).get(issuerWatchKey(OWNER, SPACEX))).heldRaw, null);
  assert.equal((await listInbox(store, OWNER)).length + (await listInbox(store, OTHER)).length, 0);
});

test("the tick reads every known wallet at most every six hours, and reminds on each milestone once", async () => {
  const store = createMemoryGuardStore();
  await seedPreferences(store, OWNER);
  await seedPreferences(store, OTHER, false);
  assert.deepEqual(await knownWallets(store), [OWNER, OTHER].sort());
  const { reads, readHeld } = chain({ [OWNER]: 5_000_000n });
  const first = await tickIssuerEvents(store, NOW, { readHeld });
  assert.deepEqual(first, { wallets: 2, read: 2, reminded: 1, failed: 0 });
  /* Five minutes later nobody is read again; six hours later both are, and nothing new is due. */
  assert.deepEqual(await tickIssuerEvents(store, NOW + 5 * MINUTE, { readHeld }), { wallets: 2, read: 0, reminded: 0, failed: 0 });
  assert.deepEqual(await tickIssuerEvents(store, NOW + TICK_EVERY_MS, { readHeld }), { wallets: 2, read: 2, reminded: 0, failed: 0 });
  assert.equal(reads.length, 4);
  /* 12 December, 09:00 UTC — ninety days before the cut-off: one reminder, in the language the record keeps. */
  const d90 = Date.parse("2026-12-12T09:00:00.000Z");
  assert.deepEqual(await tickIssuerEvents(store, d90, { readHeld }), { wallets: 2, read: 2, reminded: 1, failed: 0 });
  const notes = await listInbox(store, OWNER);
  assert.deepEqual(notes.map((note) => note.title), ["90 days left to swap SPACEX", "SpaceX has gone public"]);
  assert.equal(notes[0].text.uk.title, "Лишилося 90 днів, щоб обміняти SPACEX");
  /* The same day again: nothing — one a day, each stage once. */
  assert.equal((await tickIssuerEvents(store, d90 + TICK_EVERY_MS, { readHeld })).reminded, 0);
  /* The wallet without Telegram gets no outbox row; the holder's two notes each have one. */
  const outbox = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(outbox.map((row) => row.owner), [OWNER, OWNER]);
  /* After the cut-off the watch is silent and reads nothing. */
  assert.deepEqual(await tickIssuerEvents(store, Date.parse("2027-03-13T09:00:00.000Z"), { readHeld }), { wallets: 0, read: 0, reminded: 0, failed: 0 });
});

test("a tick reads at most its cap of wallets; the rest wait for the next pass", async () => {
  const store = createMemoryGuardStore();
  const owners = Array.from({ length: 5 }, (_, index) => `${"W".repeat(31)}${index}${"x".repeat(10)}`.slice(0, 43));
  for (const owner of owners) await seedPreferences(store, owner);
  const { readHeld } = chain({});
  assert.equal((await tickIssuerEvents(store, NOW, { readHeld, maxReads: 3 })).read, 3);
  assert.equal((await tickIssuerEvents(store, NOW + 5 * MINUTE, { readHeld, maxReads: 3 })).read, 2);
  assert.equal(MAX_READS_PER_TICK, 20);
  /* A slow chain never eats the cron's minute: past the budget, the rest wait for the next pass. */
  const slow = createMemoryGuardStore();
  for (const owner of owners) await seedPreferences(slow, owner);
  const sluggish = async (owner, mints) => {
    await new Promise((settle) => setTimeout(settle, 30));
    return chain({}).readHeld(owner, mints);
  };
  const bounded = await tickIssuerEvents(slow, NOW, { readHeld: sluggish, budgetMs: 45 });
  assert.ok(bounded.read >= 1 && bounded.read < owners.length, `read ${bounded.read} of ${owners.length} within the budget`);
  assert.equal(TICK_BUDGET_MS, 20_000);
});

test("a token account answer is added up in raw units; any other shape is no answer", () => {
  const account = (amount) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });
  assert.equal(heldFromParsedAccounts([account("16907"), account("3")]), 16_910n);
  assert.equal(heldFromParsedAccounts([]), 0n);
  assert.equal(heldFromParsedAccounts([account(12)]), null);
  assert.equal(heldFromParsedAccounts({ value: [] }), null);
});

const PAGES = {
  "https://www.prestocks.com/spacex": `<span class="block">⚠️ SpaceX has gone public!</span><span class="block">SpaceX PreStocks tokens must be swapped into <a>$SPCXx</a> or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless.</span>`,
  "https://www.prestocks.com/xai": `<span class="block">🚨 xAI was acquired by SpaceX.</span><span class="block">Each XAI token must be swapped into <!-- -->0.7165<!-- --> SPACEX before 11:59pm UTC on 12 September 2026, or it will expire worthless.</span>`,
};

test("once a day the issuer's pages are read against the registry; a drift is logged for a person to verify", async () => {
  const store = createMemoryGuardStore();
  const logged = [];
  const quiet = async (url) => PAGES[url] ?? "<div>Price Token Price Mark</div>";
  const today = await checkIssuerPages(store, NOW, { fetchPage: quiet, log: (line) => logged.push(line) });
  assert.equal(today.pages.length, 9);
  assert.ok(today.pages.every((page) => page.finding === "agrees"), JSON.stringify(today.pages.filter((page) => page.finding !== "agrees")));
  assert.equal(today.pages.find((page) => page.symbol === "SPACEX").deadline, "2027-03-12T23:59:00.000Z");
  assert.deepEqual(logged, []);
  /* The same day is not read twice. */
  assert.equal(await checkIssuerPages(store, NOW + 5 * MINUTE, { fetchPage: quiet }), null);
  /* The next day OpenAI's page carries a notice the registry does not: kept, and logged. */
  const moved = async (url) => (url.endsWith("/openai") ? PAGES["https://www.prestocks.com/spacex"].replaceAll("SpaceX", "OpenAI") : quiet(url));
  const tomorrow = await checkIssuerPages(store, NOW + DAY, { fetchPage: moved, log: (line) => logged.push(line) });
  assert.equal(tomorrow.pages.find((page) => page.symbol === "OPENAI").finding, "new-notice");
  assert.equal(logged.length, 1);
  assert.match(logged[0], /lifecycle-events\.ts/);
  assert.ok(await issuerNoticeChecksOf(store).get(new Date(NOW + DAY).toISOString().slice(0, 10)));
  /* A day a page could not be read is read again — within the hour, not every five minutes. */
  const dark = async () => null;
  const later = NOW + 2 * DAY;
  assert.ok((await checkIssuerPages(store, later, { fetchPage: dark })).pages.every((page) => page.finding === "unreadable"));
  assert.equal(await checkIssuerPages(store, later + 5 * MINUTE, { fetchPage: quiet }), null);
  assert.ok((await checkIssuerPages(store, later + 61 * MINUTE, { fetchPage: quiet })).pages.every((page) => page.finding === "agrees"));
});

test("the registry's SpaceX entry is what the notes are written from", () => {
  const event = lifecycleEventFor(SPACEX);
  assert.equal(event.deadline, "2027-03-12T23:59:00.000Z");
  assert.equal(event.watch.into.symbol, "SPCXx");
});
