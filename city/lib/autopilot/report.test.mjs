import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../../../lib/guard/store.ts";
import { viewOf } from "../../../lib/mandate/agent-service.server.ts";
import { dayOf, DAY_MS, lastDay, usdOf } from "../../../lib/mandate/report.ts";
import { deliverOutbox } from "../../../lib/monitoring/deliver.ts";
import { resolveInboxLink } from "../../../lib/monitoring/inbox.ts";
import { listInbox, outboxOf, preferencesOf } from "../../../lib/monitoring/store.ts";
import { agentCard } from "../launch/cards.ts";
import { cardFace, postText } from "../launch/card-words.ts";
import { readOpenAsk } from "../open/address.ts";
import {
  agentReportOpen,
  agentReportSends,
  clockOf,
  dayDetail,
  daySummary,
  isAgentReportNote,
  localClock,
  readReportCallback,
  reportCallback,
  reportDue,
  reportKeyboard,
  resultFigure,
  REPORT_HOUR,
} from "./report.ts";
import { askSince, AWAY_MIN_MS, keepSeen, readSeen, readSwitch } from "./report-client.ts";
import { pressReport } from "./report-telegram.ts";
import { entryFor, keepReport, readReport, reportKey, reportsOf, runReportPass } from "./report-watch.ts";

/* CITY-194: the agent's day — «3 trades, +0.012 SOL» — from its own book, in the city, in Telegram and on the phone. */

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ACCOUNT = "0b7c6f0e-3c1d-4e5a-9a5b-2f1e8d7c6b5a";
const COIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const POLICY = "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3";
/* 4 Nov 2026, 19:30 in Kyiv (UTC+2): the person's hour, 20:00, has not come yet. */
const T0 = Date.UTC(2026, 10, 4, 17, 30);
const H = 3_600_000;

const trade = (at, spent, received, extra = {}) => ({ at, status: "ok", signature: `s${at}`, spentRaw: String(spent), receivedRaw: received === null ? null : String(received), reason: null, ...extra });
/* Three buys of 0.01 SOL today, one yesterday; the coins worth 0.042 SOL for every 4,000 of them. */
const TRADES = [trade(T0 - 30 * H, 10_000_000, 1_000), trade(T0 - 6 * H, 10_000_000, 1_000), trade(T0 - 4 * H, 10_000_000, 1_000), trade(T0 - 2 * H, 10_000_000, 1_000), { at: T0 - H, status: "failed", signature: null, spentRaw: "10000000", receivedRaw: null, reason: "SLIPPAGE" }];
const HOLDING = { heldRaw: "4000", worthRaw: "56000000" };

test("the day: the span's trades that landed, what they spent and what their coins are worth at the price now", () => {
  const day = lastDay(TRADES, T0, HOLDING);
  assert.equal(day.trades, 3, "the failed trade and yesterday's are not today's");
  assert.equal(day.spentRaw, "30000000");
  assert.equal(day.boughtRaw, "3000");
  assert.equal(day.worthRaw, "42000000", "3,000 of 4,000 coins held, at the same price");
  assert.equal(day.earnedRaw, "12000000");
  assert.equal(day.since, T0 - DAY_MS);
  // A trade whose coins were not read, or one still in flight: the worth is unread, never guessed.
  assert.equal(dayOf([...TRADES, trade(T0 - H / 2, 10_000_000, null)], { since: T0 - DAY_MS, until: T0 }, HOLDING).worthRaw, null);
  assert.equal(dayOf([...TRADES, { ...trade(T0 - H / 2, 0, null), status: "failed", unsettledRaw: "10000000" }], { since: T0 - DAY_MS, until: T0 }, HOLDING).earnedRaw, null);
  // No price, no worth; nothing done, nothing earned.
  assert.equal(lastDay(TRADES, T0, { heldRaw: "4000", worthRaw: null }).worthRaw, null);
  assert.deepEqual({ ...lastDay([], T0, HOLDING), since: 0, until: 0 }, { since: 0, until: 0, trades: 0, spentRaw: "0", boughtRaw: "0", worthRaw: "0", earnedRaw: "0" });
  // A loss reads as one.
  assert.equal(lastDay(TRADES, T0, { heldRaw: "4000", worthRaw: "36000000" }).earnedRaw, "-3000000");
});

test("dollars at the SOL price, toward zero to the cent; none without a price", () => {
  assert.equal(usdOf("12000000", 150), 1.8);
  assert.equal(usdOf("-3000000", 150), -0.45);
  assert.equal(usdOf("12345678", 151.237), 1.86);
  assert.equal(usdOf("12000000", null), null);
  assert.equal(usdOf(null, 150), null);
  assert.equal(usdOf("1", 0), null);
});

test("the words: «3 trades, +0.012 SOL», with dollars where the report says them, Ukrainian in its own forms", () => {
  const day = lastDay(TRADES, T0, HOLDING);
  assert.equal(daySummary(day, "en"), "3 trades, +0.012 SOL");
  assert.equal(daySummary(day, "uk"), "3 угоди, +0,012 SOL");
  assert.equal(daySummary(day, "en", 150, true), "3 trades, +0.012 SOL (+$1.80)");
  assert.equal(daySummary(day, "uk", 150, true), "3 угоди, +0,012 SOL (+$1,80)");
  assert.equal(daySummary({ ...day, trades: 1, worthRaw: null, earnedRaw: null }, "en", 150, true), "1 trade", "unread worth: no figure, never a zero");
  assert.equal(daySummary({ ...day, trades: 5 }, "uk"), "5 угод, +0,012 SOL");
  assert.equal(resultFigure({ ...day, earnedRaw: "-3000000" }, "en", 150), "−0.003 SOL (−$0.45)");
  assert.equal(dayDetail(day, "en", "BONK"), "Spent 0.03 SOL · bought BONK · worth 0.042 SOL now");
  assert.equal(dayDetail({ ...day, worthRaw: null }, "uk", null), "Витрачено 0,03 SOL");
  for (const lang of ["en", "uk"]) assert.doesNotMatch(daySummary(day, lang) + dayDetail(day, lang, "BONK"), /x\d|guarantee|гарант|прибут|profit/iu, "no promise in the agent's day");
});

test("the agent's view answers its last day always and, asked with `since`, what it did since", () => {
  const entry = { v: 1, cluster: "mainnet", record: { owner: OWNER, settings: OWNER, vault: OWNER, policy: POLICY, budget: OWNER, perTrade: "10000000", perDay: "100000000", expiresAt: "0" }, preset: "small", strategy: "steady", said: null, receiveMint: COIN, status: "working", trades: TRADES, createdAt: T0 - 2 * DAY_MS, updatedAt: T0 - 2 * H };
  const sales = { heldRaw: "4000", gotRaw: "0", lastSale: null };
  const view = viewOf(entry, 56_000_000n, null, sales, { now: T0, since: T0 - 5 * H });
  assert.equal(view.day.trades, 3);
  assert.equal(view.day.earnedRaw, "12000000");
  assert.equal(view.away.trades, 2, "since five hours ago: two of today's three");
  assert.equal(view.away.worthRaw, "28000000");
  assert.equal(viewOf(entry, 56_000_000n, null, sales, { now: T0 }).away, undefined, "not asked, not answered");
  assert.equal(viewOf(entry, 56_000_000n).day, undefined, "the old callers' view is as it was");
  // Never more than a month back, whatever `since` says.
  assert.equal(viewOf(entry, 56_000_000n, null, sales, { now: T0, since: 1 }).away.since, T0 - 30 * DAY_MS);
});

test("the switches: the city shows it only with `open`, the server tells it only with `on`", () => {
  assert.equal(agentReportOpen("open"), true);
  for (const value of [undefined, "", "on", "true", "devnet"]) assert.equal(agentReportOpen(value), false);
  assert.equal(agentReportSends("on"), true);
  for (const value of [undefined, "", "open", "true"]) assert.equal(agentReportSends(value), false);
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.match(readme, /NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open/);
  assert.match(readme, /RYNTRA_AGENT_REPORT=on/);
});

test("her hour on her clock: due once her hour came today, and not again that day", () => {
  assert.equal(clockOf("Europe/Kyiv"), "Europe/Kyiv");
  assert.equal(clockOf("Mars/Olympus"), "UTC");
  assert.equal(clockOf("'; drop"), "UTC");
  assert.deepEqual(localClock(T0, "Europe/Kyiv"), { day: "2026-11-04", hour: 19 });
  assert.deepEqual(localClock(T0, "America/New_York"), { day: "2026-11-04", hour: 12 });
  const settings = { version: 1, owner: OWNER, on: true, hour: REPORT_HOUR, timezone: "Europe/Kyiv", locale: "uk", toldDay: null, toldAt: null, updatedAt: "" };
  assert.equal(reportDue(settings, T0), false, "19:30 in Kyiv: not yet");
  assert.equal(reportDue(settings, T0 + H), true, "20:30 in Kyiv");
  assert.equal(reportDue({ ...settings, toldDay: "2026-11-04" }, T0 + H), false, "told today");
  assert.equal(reportDue({ ...settings, toldDay: "2026-11-04" }, T0 + 25 * H), true, "the next day at her hour");
  assert.equal(reportDue({ ...settings, on: false }, T0 + H), false, "off");
});

/* ---------------------------------------------------------------- the server's pass */

const entry = (owner = OWNER, extra = {}) => ({ v: 1, cluster: "mainnet", record: { owner, settings: owner, vault: owner, policy: owner === OWNER ? POLICY : OTHER, budget: owner, perTrade: "10000000", perDay: "100000000", expiresAt: "0" }, preset: "small", strategy: "steady", said: null, receiveMint: COIN, status: "working", trades: TRADES, createdAt: T0 - 2 * DAY_MS, updatedAt: T0 - 2 * H, ...extra });

async function stand({ owners = [OWNER], timezone = "Europe/Kyiv" } = {}) {
  const store = createMemoryGuardStore();
  for (const owner of owners) {
    const row = entry(owner);
    await store.collection("agentMandates").set(`m:mainnet:${row.record.policy}`, row);
    await keepReport(store, { owner, timezone, locale: "uk" }, T0 - DAY_MS);
  }
  return store;
}

const reads = [];
const read = async (row, since, until) => {
  reads.push({ owner: row.record.owner, since, until });
  return { day: dayOf(row.trades, { since, until }, HOLDING), symbol: "BONK", solUsd: 150 };
};

test("the pass: at her hour one note — both languages, said in hers — with Telegram and the push as her preferences say", async () => {
  const store = await stand();
  // Before her hour, nothing.
  assert.equal((await runReportPass({ store, cluster: "mainnet", clock: () => T0, read })).due, 0);
  const pass = await runReportPass({ store, cluster: "mainnet", clock: () => T0 + H, read });
  assert.deepEqual({ due: pass.due, told: pass.told, queued: pass.queued }, { due: 1, told: 1, queued: 2 });
  const [note] = await listInbox(store, OWNER);
  assert.equal(note.title, "Твій агент сьогодні: 3 угоди, +0,012 SOL (+$1,80)");
  assert.equal(note.reason, "Витрачено 0,03 SOL · куплено BONK · зараз 0,042 SOL");
  assert.equal(note.text.en.title, "Your agent today: 3 trades, +0.012 SOL (+$1.80)");
  assert.equal(note.href, "/?open=agent");
  assert.ok(isAgentReportNote(note));
  assert.equal(await resolveInboxLink(store, OWNER, note.id), "/?open=agent");
  assert.deepEqual((await outboxOf(store).valuesWithPrefix("")).map((row) => row.channel).sort(), ["push", "telegram"]);
  // Her day is claimed: the next pass the same evening, or two at once, tell nothing.
  assert.equal((await runReportPass({ store, cluster: "mainnet", clock: () => T0 + 2 * H, read })).told, 0);
  assert.equal((await listInbox(store, OWNER)).length, 1);
  const told = await readReport(store, OWNER);
  assert.equal(told.toldDay, "2026-11-04");
  // The next day counts from the last report, never more than a day.
  reads.length = 0;
  await runReportPass({ store, cluster: "mainnet", clock: () => T0 + 25 * H, read });
  assert.equal(reads[0].since, T0 + H);
});

test("the pass: two passes at once tell her once; off, or a day without a trade, tells nothing", async () => {
  const store = await stand();
  const [a, b] = await Promise.all([runReportPass({ store, cluster: "mainnet", clock: () => T0 + H, read }), runReportPass({ store, cluster: "mainnet", clock: () => T0 + H, read })]);
  assert.equal(a.told + b.told, 1);

  const off = await stand();
  await keepReport(off, { owner: OWNER, on: false }, T0);
  assert.equal((await runReportPass({ store: off, cluster: "mainnet", clock: () => T0 + H, read })).due, 0);

  const idle = await stand();
  const quiet = await runReportPass({ store: idle, cluster: "mainnet", clock: () => T0 + H, read: async (row, since, until) => ({ day: dayOf([], { since, until }, HOLDING), symbol: null, solUsd: null }) });
  assert.deepEqual({ told: quiet.told, quiet: quiet.quiet }, { told: 0, quiet: 1 });
  assert.equal((await outboxOf(idle).valuesWithPrefix("")).length, 0);

  // The book did not answer: she stays due for the next hour.
  const blink = await stand();
  assert.equal((await runReportPass({ store: blink, cluster: "mainnet", clock: () => T0 + H, read: async () => null })).failed, 1);
  assert.equal((await readReport(blink, OWNER)).toldDay, null);
});

test("the pass: Telegram off in her preferences — only the phone", async () => {
  const store = await stand();
  await preferencesOf(store).set(`solana:mainnet:${OWNER}`, { version: 1, owner: OWNER, inbox: true, telegram: false, push: true, quietHours: null, updatedAt: new Date(T0).toISOString() });
  await runReportPass({ store, cluster: "mainnet", clock: () => T0 + H, read });
  assert.deepEqual((await outboxOf(store).valuesWithPrefix("")).map((row) => row.channel), ["push"]);
});

test("her settings: a new report is on at 20:00 on her clock; a bad hour or address is refused", async () => {
  const store = createMemoryGuardStore();
  const kept = await keepReport(store, { owner: OWNER, timezone: "Nowhere/City", locale: "en" }, T0);
  assert.deepEqual({ on: kept.on, hour: kept.hour, timezone: kept.timezone }, { on: true, hour: 20, timezone: "UTC" });
  assert.equal((await keepReport(store, { owner: OWNER, hour: 8 }, T0)).hour, 8);
  assert.equal((await keepReport(store, { owner: OWNER, on: false }, T0)).hour, 8, "a tap changes only its switch");
  await assert.rejects(keepReport(store, { owner: OWNER, hour: 24 }, T0));
  await assert.rejects(keepReport(store, { owner: "not-a-wallet" }, T0));
  assert.equal((await reportsOf(store).get(reportKey(OWNER))).on, false);
});

test("the mandate a report speaks of: her newest at work", () => {
  const a = entry(OWNER, { status: "ended", updatedAt: T0 });
  const b = entry(OWNER, { status: "working", updatedAt: T0 - DAY_MS });
  assert.equal(entryFor([a, b, entry(OTHER)], OWNER), b);
  assert.equal(entryFor([a], OWNER), a);
  assert.equal(entryFor([entry(OTHER)], OWNER), null);
});

/* ---------------------------------------------------------------- Telegram */

test("delivery: Telegram says the day plainly, with the link to her agent and «Turn off daily report»", async () => {
  const store = await stand();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: new Date(T0).toISOString() });
  const sent = [];
  const telegram = {
    accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
    chatLocale: async () => "en",
    send: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    },
    buttons: () => [[{ text: "not the report's", url: "https://example.invalid" }]],
  };
  await runReportPass({ store, cluster: "mainnet", clock: () => T0 + H, read, deliver: (rows, atMs) => deliverOutbox(store, atMs, { telegram }) });
  assert.equal(sent.length, 1);
  // Said whole in the language the city kept for her, as Earn's notes are.
  assert.equal(sent[0].text, "Ryntra\nТвій агент сьогодні: 3 угоди, +0,012 SOL (+$1,80)\nВитрачено 0,03 SOL · куплено BONK · зараз 0,042 SOL");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Відкрити агента", url: "https://ryntra.io/?open=agent" }], [{ text: "Вимкнути щоденний звіт", callback_data: `agr:off:${OWNER}` }]]);
  assert.equal((await outboxOf(store).valuesWithPrefix("")).find((row) => row.channel === "telegram").state, "sent");
});

test("the button: one tap turns the report off — only from the chat her wallet's own account bound", async () => {
  assert.deepEqual(readReportCallback(reportCallback("off", OWNER)), { verb: "off", owner: OWNER });
  assert.ok(reportCallback("off", OWNER).length <= 64, "Telegram's 64 bytes");
  assert.equal(readReportCallback("agr:off:nope"), null);
  assert.equal(readReportCallback("a:c:brief"), null);
  assert.deepEqual(reportKeyboard({ owner: OWNER, locale: "uk" }, { text: "Відкрити агента", url: "u" })[1], [{ text: "Вимкнути щоденний звіт", callback_data: `agr:off:${OWNER}` }]);

  const store = await stand();
  const answered = [];
  const edited = [];
  const deps = (chatAccount) => ({
    store,
    accountOfChat: async () => chatAccount,
    accountOfWallet: async (owner) => (owner === OWNER ? ACCOUNT : null),
    answer: async (id, text) => answered.push(text),
    editKeyboard: async (chatId, messageId, keyboard) => edited.push(keyboard),
    link: () => ({ text: "Відкрити агента", url: "https://ryntra.io/?open=agent" }),
    now: () => T0,
  });
  const press = { id: "cb1", from: { id: 700000001 }, data: reportCallback("off", OWNER), message: { message_id: 5, chat: { id: 700000001 } } };
  assert.equal(await pressReport({ ...press, data: "confirm" }, deps(ACCOUNT)), false, "not the report's press");
  // Another account's chat: refused, nothing changes.
  assert.equal(await pressReport(press, deps("11111111-1111-4111-8111-111111111111")), true);
  assert.equal(answered.at(-1), "Спершу підключи цей Telegram у Ryntra");
  assert.equal((await readReport(store, OWNER)).on, true);
  // Her own chat: off, and the button turns into «Turn it back on».
  await pressReport(press, deps(ACCOUNT));
  assert.equal(answered.at(-1), "Щоденний звіт вимкнено");
  assert.equal((await readReport(store, OWNER)).on, false);
  assert.deepEqual(edited.at(-1)[1], [{ text: "Увімкнути знову", callback_data: `agr:on:${OWNER}` }]);
  await pressReport({ ...press, data: reportCallback("on", OWNER) }, deps(ACCOUNT));
  assert.equal((await readReport(store, OWNER)).on, true);
});

/* ---------------------------------------------------------------- the city */

test("on her return: the card only after twenty minutes away; a first visit only starts the clock", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(readSeen(storage, POLICY), null);
  assert.equal(askSince(null, T0), null);
  keepSeen(storage, POLICY, T0 - AWAY_MIN_MS + 1);
  assert.equal(askSince(readSeen(storage, POLICY), T0), null, "back too soon");
  keepSeen(storage, POLICY, T0 - 3 * H);
  assert.equal(askSince(readSeen(storage, POLICY), T0), T0 - 3 * H);
  assert.equal(readSeen({ getItem: () => "junk", setItem() {} }, POLICY), null);
  assert.equal(readSeen(null, POLICY), null);
  assert.deepEqual(readSwitch({ on: false, hour: 9, kept: true }), { on: false, hour: 9, kept: true });
  assert.equal(readSwitch({ on: "yes" }), null);
});

test("the card for X from the same real figures: «today» or «while I was away», never a promise", () => {
  const day = lastDay(TRADES, T0, HOLDING);
  const card = agentCard({ coin: { token: COIN, symbol: "BONK", logo: false }, trades: day.trades, spentRaw: day.spentRaw, worthRaw: day.worthRaw, tag: null, span: "away" });
  assert.equal(card.span, "away");
  assert.equal(card.gainRaw, "12000000");
  assert.deepEqual(cardFace(card, "uk").kicker, ["Поки мене не було, агент торгував."]);
  assert.equal(cardFace({ ...card, span: "today" }, "en").kicker[0], "My agent today.");
  assert.match(postText(card, "en"), /^While I was away, my agent on Ryntra made 3 trades, \+0\.01\d? SOL on \$BONK\.$/u);
  assert.match(postText({ ...card, span: "today" }, "uk"), /^Мій агент на Ryntra сьогодні: 3 угоди, \+0,01\d? SOL на \$BONK\./u);
  assert.equal(agentCard({ coin: { token: COIN, symbol: "BONK", logo: false }, trades: 3, spentRaw: "1", worthRaw: null, tag: null, span: "away" }), null, "unread worth: no card");
  // The card without a span stays the agent's whole result.
  assert.equal(agentCard({ coin: { token: COIN, symbol: "BONK", logo: false }, trades: 3, spentRaw: "1", worthRaw: "2", tag: null }).span, undefined);
});

test("the report's button opens her agent in the city: `/?open=agent`", () => {
  assert.deepEqual(readOpenAsk("?open=agent"), { window: "agent" });
});

test("the routes: settings only for the proven wallet, the cron only with its bearer, all shut behind their switches", () => {
  const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  const route = read("app/api/bots/mandate/report/route.ts");
  assert.match(route, /requireWalletProof\(request, "mutation"\)/);
  assert.match(route, /body\.owner !== proof\.address/);
  assert.match(route, /agentReportOpen\(process\.env\.NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT\)/);
  const cron = read("app/api/cron/agent-report/route.ts");
  assert.match(cron, /decideBearerAuth/);
  const server = read("city/lib/autopilot/report-watch.server.ts");
  assert.match(server, /agentReportSends\(env\[AGENT_REPORT_SEND_ENV\]\)/);
  assert.match(server, /guard\.writes\.allowed/);
  assert.match(read("vercel.json"), /"\/api\/cron\/agent-report", "schedule": "7 \* \* \* \*"/);
  assert.match(read("lib/telegram/handlers.ts"), /handleReportPress\(cb\)/);
  // Nothing of the report signs, sends money or trades.
  for (const path of ["city/lib/autopilot/report-watch.ts", "city/lib/autopilot/report-watch.server.ts", "city/lib/autopilot/report-telegram.ts", "city/lib/autopilot/report.ts", "lib/mandate/report.ts"]) {
    assert.doesNotMatch(read(path), /signTransaction|sendTransaction|Keypair|secretKey/u, path);
  }
});
