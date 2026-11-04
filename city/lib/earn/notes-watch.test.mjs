import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../../../lib/guard/store.ts";
import { deliverOutbox } from "../../../lib/monitoring/deliver.ts";
import { resolveInboxLink } from "../../../lib/monitoring/inbox.ts";
import { listInbox, outboxOf, preferencesOf } from "../../../lib/monitoring/store.ts";
import { earnIdentity, earnWatchesOf, earnWatchKey, judgeRead, registerEarnWatch, runEarnWatchPass, DROP_MS, EVERY_MS } from "./notes-watch.ts";

/* CITY-100: Ryntra's server watches Earn for the phone and Telegram — the wallets that asked under their own proof, read
   now and then, told through the engine's own inbox and delivery, each note once. */

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ACCOUNT = "0b7c6f0e-3c1d-4e5a-9a5b-2f1e8d7c6b5a";
const MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
/** Wednesday 4 November 2026, noon UTC: no weekend. */
const T0 = Date.UTC(2026, 10, 4, 12, 0);
const DAY = 24 * 3_600_000;

const nothing = { positions: null, stocks: null, loans: null };
const pools = (out) => ({ ...nothing, positions: [{ address: "P1", pair: "JitoSOL–SOL", inRange: !out }, { address: "P2", pair: "SOL–USDC", inRange: true }] });

function pass(guard, read, nowMs, deliver) {
  return runEarnWatchPass({ guard, read: async (owner) => read(owner), clock: () => nowMs, deliver });
}

test("a watch: only a Solana wallet, kept once, its language and time refreshed when the city asks again", async () => {
  const guard = createMemoryGuardStore();
  await assert.rejects(() => registerEarnWatch(guard, "not-a-wallet", "en", T0), TypeError);
  const first = await registerEarnWatch(guard, OWNER, "uk", T0);
  assert.equal(first.version, 1);
  assert.equal(first.out, null, "before the first read nothing is known");
  const again = await registerEarnWatch(guard, OWNER, "en", T0 + 1_000);
  assert.equal(again.version, 2);
  assert.equal(again.locale, "en");
  assert.equal((await earnWatchesOf(guard).valuesWithPrefix("")).length, 1);
});

test("out of range: the first read is known; a later exit is told once, to the inbox, Telegram and the phone", async () => {
  const guard = createMemoryGuardStore();
  await registerEarnWatch(guard, OWNER, "uk", T0);
  // Out of range at the first read: the city had just told it on screen.
  let report = await pass(guard, () => pools(true), T0);
  assert.equal(report.checked, 1);
  assert.equal(report.told, 0);
  assert.deepEqual((await earnWatchesOf(guard).get(earnWatchKey(OWNER))).out, ["P1"]);
  // Back in range, then out again: told.
  await pass(guard, () => pools(false), T0 + EVERY_MS);
  report = await pass(guard, () => pools(true), T0 + 2 * EVERY_MS);
  assert.equal(report.told, 1);
  assert.equal(report.queued, 2, "Telegram and the phone, as the wallet's preferences say");
  const [note] = await listInbox(guard, OWNER);
  assert.equal(note.title, "Поза діапазоном · JitoSOL–SOL");
  assert.equal(note.text.en.title, "Out of range · JitoSOL–SOL");
  assert.equal(note.href, "/?open=earn&tab=mine");
  assert.equal(note.cta, "Відкрити Заробіток");
  assert.match(note.triggerId, /^city-earn:/);
  // Still out of range on the next read: nothing more.
  report = await pass(guard, () => pools(true), T0 + 3 * EVERY_MS);
  assert.equal(report.told, 0);
  assert.equal((await listInbox(guard, OWNER)).length, 1);
});

test("a wallet is read at most every quarter hour, the longest unread first; a read that failed changes nothing it knew", async () => {
  const guard = createMemoryGuardStore();
  await registerEarnWatch(guard, OWNER, "en", T0);
  await registerEarnWatch(guard, OTHER, "en", T0);
  const asked = [];
  await pass(guard, (owner) => (asked.push(owner), pools(true)), T0);
  assert.deepEqual(asked.sort(), [OTHER, OWNER].sort());
  assert.equal((await pass(guard, () => pools(true), T0 + EVERY_MS - 1)).checked, 0, "too soon");
  const report = await pass(guard, () => nothing, T0 + EVERY_MS);
  assert.equal(report.failed, 2);
  assert.deepEqual((await earnWatchesOf(guard).get(earnWatchKey(OWNER))).out, ["P1"], "a failed read keeps what was known");
});

test("the weekend and a dividend date: each told once for good; the words in the wallet's language", async () => {
  const guard = createMemoryGuardStore();
  await registerEarnWatch(guard, OWNER, "en", T0);
  const friday = Date.UTC(2026, 10, 6, 18, 0);
  const configs = [{ mint: MINT, multiplier: 1, newMultiplier: 1.004, newMultiplierEffectiveAt: new Date(friday + 3 * DAY).toISOString() }];
  const stocks = { ...nothing, stocks: { configs, held: [{ mint: MINT, ticker: "TSLAx", raw: 1_000_000_000n, decimals: 9 }], exposed: ["TSLAx"] } };
  let report = await pass(guard, () => stocks, friday);
  assert.equal(report.told, 2);
  const titles = (await listInbox(guard, OWNER)).map((n) => n.title).sort();
  assert.deepEqual(titles, ["Dividend date · TSLAx", "Stock exchange weekend"]);
  report = await pass(guard, () => stocks, friday + EVERY_MS);
  assert.equal(report.told, 0, "the same weekend and the same date are not told again");
});

test("two passes reading the same version tell once; a watch with nothing in Earn for a month ends", async () => {
  const guard = createMemoryGuardStore();
  const record = await registerEarnWatch(guard, OWNER, "en", T0);
  const known = { ...record, out: [], checkedAt: new Date(T0).toISOString() };
  await earnWatchesOf(guard).set(earnWatchKey(OWNER), known);
  const event = judgeRead(known, pools(true), T0).tell[0];
  assert.equal(earnIdentity(OWNER, event, known.version), earnIdentity(OWNER, event, known.version), "an exit is named by the read it was seen at");
  const [a, b] = await Promise.all([pass(guard, () => pools(true), T0 + EVERY_MS), pass(guard, () => pools(true), T0 + EVERY_MS)]);
  assert.equal(a.told + b.told, 1);

  const quiet = createMemoryGuardStore();
  const old = await registerEarnWatch(quiet, OWNER, "en", T0);
  await earnWatchesOf(quiet).set(earnWatchKey(OWNER), { ...old, seenAt: new Date(T0).toISOString() });
  assert.equal((await pass(quiet, () => ({ positions: [], stocks: { configs: [], held: [], exposed: [] }, loans: null }), T0 + DROP_MS + 1)).dropped, 1);
  assert.equal(await earnWatchesOf(quiet).get(earnWatchKey(OWNER)), undefined);
});

test("the wallet's preferences decide the channels: Telegram off, only the phone", async () => {
  const guard = createMemoryGuardStore();
  await preferencesOf(guard).set(`solana:mainnet:${OWNER}`, { version: 1, owner: OWNER, inbox: true, telegram: false, push: true, quietHours: null, updatedAt: new Date(T0).toISOString() });
  await registerEarnWatch(guard, OWNER, "en", T0);
  await pass(guard, () => pools(false), T0);
  await pass(guard, () => pools(true), T0 + EVERY_MS);
  assert.deepEqual((await outboxOf(guard).valuesWithPrefix("")).map((row) => row.channel), ["push"]);
});

test("delivery: Telegram says the line plainly with the button to Earn; the note's link opens Earn in the city", async () => {
  const guard = createMemoryGuardStore();
  await guard.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: new Date(T0).toISOString() });
  const sent = [];
  const telegram = {
    accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
    chatLocale: async () => "uk",
    send: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    },
  };
  // The note is said in the language the city registered it in; a chat in another keeps it whole in that one.
  await registerEarnWatch(guard, OWNER, "uk", T0);
  await pass(guard, () => pools(false), T0);
  let delivered = null;
  await pass(guard, () => pools(true), T0 + EVERY_MS, async (rows, atMs) => {
    delivered = rows;
    await deliverOutbox(guard, atMs, { telegram });
  });
  assert.equal(delivered.size, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "Ryntra\nПоза діапазоном · JitoSOL–SOL\nКомісії не йдуть, доки ціна не повернеться.", "said whole in one language, no address in the text");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Відкрити Заробіток", url: "https://ryntra.io/?open=earn&tab=mine" }]]);
  const rows = await outboxOf(guard).valuesWithPrefix("");
  assert.equal(rows.find((row) => row.channel === "telegram").state, "sent");
  assert.match(rows.find((row) => row.channel === "push").state, /^skipped_/, "no phone registered here: the push row says so");
  const note = (await listInbox(guard, OWNER))[0];
  assert.equal(await resolveInboxLink(guard, OWNER, note.id), "/?open=earn&tab=mine");
});

test("the routes: the watch only for the proven wallet itself, the cron only with its bearer, both shut where Earn is closed", () => {
  const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  const register = read("app/api/city/earn/notes/route.ts");
  assert.match(register, /earnOpen\(process\.env\.NEXT_PUBLIC_RYNTRA_CITY_EARN\)/);
  assert.match(register, /requireWalletProof\(request, 'mutation'\)/);
  assert.match(register, /owner !== proof\.address/);
  const cron = read("app/api/cron/city-earn-notes/route.ts");
  assert.match(cron, /decideBearerAuth/);
  assert.match(cron, /earnOpen\(process\.env\.NEXT_PUBLIC_RYNTRA_CITY_EARN\)/);
  assert.match(cron, /guard\.writes\.allowed/);
  assert.match(read("vercel.json"), /"\/api\/cron\/city-earn-notes"/);
  // The browser's push opens an Earn note's own city address, as a stop's.
  assert.match(read("app/api/v1/assistant/push/latest/route.ts"), /isEarnNote\(newest\) \? newest\.href/);
});
