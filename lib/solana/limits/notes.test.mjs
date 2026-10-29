// Run from repo root: node --test lib/solana/limits/notes.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { MonitoringNoteSchema } from "../../api/v1/contract.ts";
import { USDC_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import { createMemoryGuardStore } from "../../guard/store.ts";
import { deliverOutbox } from "../../monitoring/deliver.ts";
import { resolveInboxLink } from "../../monitoring/inbox.ts";
import { devicesOf, listInbox, monitorNotes, outboxOf, preferencesOf } from "../../monitoring/store.ts";
import { baseSymbolOf, limitMonitorId, limitNoteIdentity, limitNoteWords, noteLimitTransition, noteLocaleOf, receiptEventOf, shortMint } from "./notes.server.ts";
import { advanceLimitOrder, beginLimitOrder, limitOrderKey, readLimitOrder } from "./store.server.ts";
import { LIMIT_RECONCILE_EVERY_MS, LIMIT_RECONCILE_MIN_AGE_MS, reconcileLimitOrders, syncWalletLimits, walletsInTurn } from "./sync.server.ts";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ORDER = "8bKHKzM64AwCjgkjEoTy76K79tzi6viBNeFawKVUWQZ7";
const SIGNATURE = "5UfDuX7hXbTiKFJqS1MzGsNpbXTzMKJe2bZP1zrd7DnFBSChKvF2FVDNAuqz7SJpaHXTB9E5DP6tMjfZmVDMJRs";
const FILL_SIGNATURE = "3kq8xXbTiKFJqS1MzGsNpbXTzMKJe2bZP1zrd7DnFBSChKvF2FVDNAuqz7SJpaHXTB9E5DP6tMjfZmVDMJRs";
const MEME = "DkgaAzZyjP3um9wDyWH8XETUuEj5W9VEK7hX8f5Npump";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const START = "2026-10-15T10:00:00.000Z";
const NOW = Date.parse("2026-10-16T10:00:00.000Z");

function input(overrides = {}) {
  return {
    wallet: WALLET,
    venue: "trigger",
    order: ORDER,
    pool: null,
    side: "buy",
    baseMint: WRAPPED_SOL_MINT,
    quoteMint: USDC_MINT,
    inputMint: USDC_MINT,
    outputMint: WRAPPED_SOL_MINT,
    makingRaw: "20000000",
    takingRaw: "200000000",
    price: "100",
    fillPrice: 99.9,
    fee: { ryntraBps: 10, venueBps: 0, account: "BDdSbE2s4fUtafn4u2Coy5XHKrUrXZMR8TyZBWBtzkhE" },
    state: "PLACING",
    placeSignature: SIGNATURE,
    cancelSignature: null,
    fills: [],
    reason: null,
    ...overrides,
  };
}

const KEY = limitOrderKey({ wallet: WALLET, venue: "trigger", order: ORDER });

async function seedDevice(store, locale, { revoked = false, updatedAt = START, id = "dev_000000000000000000000001" } = {}) {
  await devicesOf(store).compareAndSet(`solana:mainnet:${WALLET}:${id}`, null, {
    version: 0, deviceId: id, owner: WALLET, platform: "android", token: `push-token-${id}`, appVersion: "1.30.0", locale,
    categories: ["operation"], quietHours: null, registeredAt: START, updatedAt, revokedAt: revoked ? updatedAt : null,
  });
}

async function seedPreferences(store, { telegram, push }) {
  await preferencesOf(store).compareAndSet(`solana:mainnet:${WALLET}`, null, { version: 0, owner: WALLET, inbox: true, telegram, push, quietHours: null, updatedAt: START });
}

async function outboxRows(store) {
  return (await outboxOf(store).valuesWithPrefix("")).filter((row) => row.owner === WALLET);
}

/** Jupiter's Trigger book answering one order, completed with one fill; every other read fails quietly. */
function stubJupiter(t) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("getTriggerOrders") && text.includes("orderStatus=history")) {
      return new Response(JSON.stringify({ orders: [{
        orderKey: ORDER, inputMint: USDC_MINT, outputMint: WRAPPED_SOL_MINT, rawMakingAmount: "20000000", rawTakingAmount: "200000000",
        status: "Completed", createdAt: START, updatedAt: START, openTx: SIGNATURE, closeTx: null,
        trades: [{ action: "Fill", rawInputAmount: "20000000", rawOutputAmount: "200000000", rawFeeAmount: "200000", txId: FILL_SIGNATURE, confirmedAt: START }],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (text.includes("getTriggerOrders")) return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    throw new Error(`no network in a test: ${text}`);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
}

/* A connection that knows nothing: the DLMM read fails and is left for the next one. */
const NO_CHAIN = { getAccountInfo: async () => null, getProgramAccounts: async () => { throw new Error("no chain"); } };

test("an order the venue says filled: «Ордер виконано» once, in the device's language, with its deliveries — a second sync writes none", async (t) => {
  stubJupiter(t);
  const store = createMemoryGuardStore();
  await seedDevice(store, "uk");
  await beginLimitOrder(store, input({ state: "OPEN" }), START);
  const first = await syncWalletLimits(store, WALLET, { connection: NO_CHAIN });
  assert.equal(first.orders.find((order) => order.order === ORDER)?.state, "FILLED");
  assert.equal((await readLimitOrder(store, KEY)).state, "FILLED");
  const notes = await listInbox(store, WALLET);
  assert.equal(notes.length, 1);
  const [note] = notes;
  assert.equal(note.title, "Ордер виконано");
  assert.equal(note.reason, "Купівля SOL · Jupiter");
  assert.equal(note.cta, "Мої ордери");
  assert.equal(note.context, "SOL · Jupiter");
  assert.equal(note.locale, "uk");
  assert.deepEqual(note.text, { en: { title: "Limit order filled", reason: "Buy SOL · Jupiter" }, uk: { title: "Ордер виконано", reason: "Купівля SOL · Jupiter" } });
  assert.deepEqual(note.subject, { kind: "limit-order", id: ORDER });
  assert.equal(note.href, `/app/alerts/open?n=${note.id}`);
  assert.equal(note.triggerId, `limit:filled:${KEY}`);
  assert.equal(note.monitorId, limitMonitorId(WALLET, ORDER));
  assert.ok(MonitoringNoteSchema.safeParse(note).success, "the note is the contract's shape");
  assert.deepEqual(monitorNotes(notes), [], "a limit's note is not a monitor's");
  /* Both channels by the default preferences. */
  assert.deepEqual((await outboxRows(store)).map((row) => row.channel).sort(), ["push", "telegram"]);

  await syncWalletLimits(store, WALLET, { connection: NO_CHAIN });
  assert.equal((await listInbox(store, WALLET)).length, 1, "the second sync writes no second note");
  assert.equal((await outboxRows(store)).length, 2);

  /* The opener and Telegram land on the base token's Spot page, where «Мої ордери» lists it. */
  assert.equal(await resolveInboxLink(store, WALLET, note.id), `/app/spot?mint=${WRAPPED_SOL_MINT}&from=monitoring`);
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: START });
  const sent = [];
  await deliverOutbox(store, Date.now() + 60_000, { telegram: { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => sent.push({ text, keyboard }) } });
  assert.equal(sent.length, 1);
  const url = `https://ryntra.io/app/spot?mint=${WRAPPED_SOL_MINT}`;
  assert.equal(sent[0].text, `Ryntra\nОрдер виконано\nКупівля SOL · Jupiter\n\n${url}`);
  assert.deepEqual(sent[0].keyboard, [[{ text: "Мої ордери", url }]]);
});

test("a sync told to write no notes writes none", async (t) => {
  stubJupiter(t);
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input({ state: "OPEN" }), START);
  await syncWalletLimits(store, WALLET, { connection: NO_CHAIN, notes: null });
  assert.equal((await readLimitOrder(store, KEY)).state, "FILLED");
  assert.equal((await listInbox(store, WALLET)).length, 0);
});

function fakeConnection(status) {
  return { getSignatureStatuses: async () => ({ value: [status] }) };
}
const LANDED = { err: null, confirmationStatus: "confirmed" };
const LATER = Date.parse(START) + LIMIT_RECONCILE_MIN_AGE_MS + 1;

async function reconcileOnce(record, status) {
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input(record), START);
  const decisions = await reconcileLimitOrders(store, { nowMs: LATER, sync: async () => undefined, connection: fakeConnection(status) });
  /* Run again: what is settled is not settled twice, and no note is written twice. */
  await reconcileLimitOrders(store, { nowMs: LATER + 60_000, sync: async () => undefined, connection: fakeConnection(status) });
  return { store, decisions, notes: await listInbox(store, WALLET) };
}

test("the reconciler's receipts: placed, not placed, cancelled, taken back, not cancelled — each once, only for what it applied", async () => {
  const placed = await reconcileOnce({}, LANDED);
  assert.deepEqual(placed.decisions.map((row) => [row.before, row.after, row.applied]), [["PLACING", "OPEN", true]]);
  assert.deepEqual(placed.notes.map((note) => [note.title, note.reason, note.triggerId]), [["Receipt ready", "Order placed: buy SOL · Jupiter", `limit:placed:${KEY}`]]);
  assert.deepEqual(placed.notes[0].text.uk, { title: "Квитанція готова", reason: "Ордер розміщено: купівля SOL · Jupiter" });

  const failed = await reconcileOnce({}, null);
  assert.deepEqual(failed.notes.map((note) => [note.text.en.reason, note.text.uk.reason]), [["Order not placed: buy SOL · Jupiter", "Ордер не розміщено: купівля SOL · Jupiter"]]);

  const cancelled = await reconcileOnce({ state: "CANCELLING", cancelSignature: SIGNATURE, cancelFrom: "OPEN", side: "sell", inputMint: WRAPPED_SOL_MINT, outputMint: USDC_MINT }, LANDED);
  assert.deepEqual(cancelled.notes.map((note) => [note.text.en.reason, note.text.uk.reason]), [["Order cancelled: sell SOL · Jupiter", "Ордер скасовано: продаж SOL · Jupiter"]]);

  /* A DLMM order wholly converted and taken back: the receipt, and «Ордер виконано» without a word about taking it back. */
  const dlmmKey = limitOrderKey({ wallet: WALLET, venue: "dlmm", order: ORDER });
  const taken = await reconcileOnce({ venue: "dlmm", pool: ORDER, state: "CANCELLING", cancelSignature: SIGNATURE, cancelFrom: "OPEN", claim: { inputRaw: "20000000", outputRaw: "50000000" } }, LANDED);
  assert.deepEqual(taken.decisions.map((row) => row.after), ["FILLED"]);
  const byTrigger = new Map(taken.notes.map((note) => [note.triggerId, note]));
  assert.equal(byTrigger.size, 2);
  assert.deepEqual(byTrigger.get(`limit:filled:${dlmmKey}`).text.en, { title: "Limit order filled", reason: "Buy SOL · Meteora DLMM" });
  assert.deepEqual(byTrigger.get(`limit:taken-back:${dlmmKey}`).text, { en: { title: "Receipt ready", reason: "Taken back to the wallet: buy SOL · Meteora DLMM" }, uk: { title: "Квитанція готова", reason: "Забрано в гаманець: купівля SOL · Meteora DLMM" } });
  for (const note of taken.notes) assert.ok(MonitoringNoteSchema.safeParse(note).success);

  /* A cancellation that never landed: the order stands as it was, and the receipt says so — never «cancelled». */
  const stood = await reconcileOnce({ state: "CANCELLING", cancelSignature: SIGNATURE, cancelFrom: "OPEN" }, null);
  assert.deepEqual(stood.decisions.map((row) => row.after), ["OPEN"]);
  assert.deepEqual(stood.notes.map((note) => [note.text.en.reason, note.text.uk.reason]), [["Not cancelled, the order still waits: buy SOL · Jupiter", "Не скасовано, ордер чекає: купівля SOL · Jupiter"]]);
});

test("a DLMM order that converted says where to take it back; a transition is noted once", async () => {
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input({ venue: "dlmm", pool: ORDER, state: "OPEN" }), START);
  const key = limitOrderKey({ wallet: WALLET, venue: "dlmm", order: ORDER });
  const filled = await advanceLimitOrder(store, key, () => ({ state: "FILLED" }), START);
  const deps = { nowMs: () => NOW };
  assert.equal(await noteLimitTransition(store, "OPEN", filled.record, deps), 1);
  assert.equal(await noteLimitTransition(store, "PARTIAL", filled.record, deps), 0, "one note per event and order");
  const [note] = await listInbox(store, WALLET);
  assert.deepEqual(note.text, {
    en: { title: "Limit order filled", reason: "Buy SOL · Meteora DLMM — take it back in My orders" },
    uk: { title: "Ордер виконано", reason: "Купівля SOL · Meteora DLMM — забери в «Мої ордери»" },
  });
  assert.equal(note.locale, "en", "no device registered: English");
  assert.equal(note.createdAt, new Date(NOW).toISOString());
  /* A move into FILLED from FILLED, or one that is no receipt, writes nothing. */
  assert.equal(await noteLimitTransition(store, "FILLED", filled.record, { ...deps, receipts: true }), 0);
});

test("the deliveries follow the wallet's preferences", async () => {
  const store = createMemoryGuardStore();
  await seedPreferences(store, { telegram: false, push: true });
  await beginLimitOrder(store, input({ state: "OPEN" }), START);
  const filled = await advanceLimitOrder(store, KEY, () => ({ state: "FILLED" }), START);
  assert.equal(await noteLimitTransition(store, "OPEN", filled.record), 1);
  assert.deepEqual((await outboxRows(store)).map((row) => row.channel), ["push"]);

  const quiet = createMemoryGuardStore();
  await seedPreferences(quiet, { telegram: false, push: false });
  await beginLimitOrder(quiet, input({ state: "OPEN" }), START);
  const quietFilled = await advanceLimitOrder(quiet, KEY, () => ({ state: "FILLED" }), START);
  assert.equal(await noteLimitTransition(quiet, "OPEN", quietFilled.record), 1);
  assert.equal((await listInbox(quiet, WALLET)).length, 1, "the inbox always has it");
  assert.deepEqual(await outboxRows(quiet), []);
});

test("a lock screen reads no amount and no price: the words carry no digit", () => {
  for (const event of ["filled", "placed", "not-placed", "cancelled", "taken-back", "not-cancelled"]) {
    for (const venue of ["trigger", "dlmm"]) {
      for (const side of ["buy", "sell"]) {
        for (const takeBack of [false, true]) {
          const words = limitNoteWords(event, { side, venue }, "SOL", takeBack);
          for (const text of [words.en.title, words.en.reason, words.uk.title, words.uk.reason, words.cta.en, words.cta.uk]) {
            assert.doesNotMatch(text, /\d/, `${event} ${venue} ${side}: ${text}`);
          }
        }
      }
    }
  }
  assert.equal(receiptEventOf("PLACING", "OPEN"), "placed");
  assert.equal(receiptEventOf("PLACING", "FAILED"), "not-placed");
  assert.equal(receiptEventOf("CANCELLING", "CANCELLED"), "cancelled");
  assert.equal(receiptEventOf("CANCELLING", "FILLED"), "taken-back");
  assert.equal(receiptEventOf("CANCELLING", "OPEN"), "not-cancelled");
  assert.equal(receiptEventOf("OPEN", "FILLED"), null);
  assert.equal(limitNoteIdentity("filled", { wallet: WALLET, venue: "trigger", order: ORDER }), `limit:filled:mainnet:${WALLET}:trigger:${ORDER}`);
});

test("the base token's name: the known three by mint, the catalogue's otherwise, the short mint when it has none", async () => {
  let asked = 0;
  const never = async () => {
    asked += 1;
    return "NOPE";
  };
  assert.equal(await baseSymbolOf(WRAPPED_SOL_MINT, never), "SOL");
  assert.equal(await baseSymbolOf(USDC_MINT, never), "USDC");
  assert.equal(asked, 0, "the known three ask nothing");
  assert.equal(await baseSymbolOf(MEME, async () => "BONK"), "BONK");
  assert.equal(await baseSymbolOf(MEME, async () => null), "Dkga…");
  assert.equal(await baseSymbolOf(MEME, async () => { throw new Error("catalogue down"); }), shortMint(MEME));
  assert.equal(await baseSymbolOf(MEME, async () => " \n "), "Dkga…");
  /* The injected name reaches the note. */
  const store = createMemoryGuardStore();
  await beginLimitOrder(store, input({ state: "OPEN", baseMint: MEME, outputMint: MEME, quoteMint: WRAPPED_SOL_MINT, inputMint: WRAPPED_SOL_MINT }), START);
  const filled = await advanceLimitOrder(store, KEY, () => ({ state: "FILLED" }), START);
  await noteLimitTransition(store, "OPEN", filled.record, { symbolOf: async () => "BONK" });
  assert.equal((await listInbox(store, WALLET))[0].reason, "Buy BONK · Jupiter");
  assert.equal(await resolveInboxLink(store, WALLET, (await listInbox(store, WALLET))[0].id), `/app/spot?mint=${MEME}&from=monitoring`);
});

test("the language is the newest live device's; a revoked one does not speak", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await noteLocaleOf(store, WALLET), "en");
  await seedDevice(store, "en", { updatedAt: "2026-10-14T10:00:00.000Z", id: "dev_000000000000000000000001" });
  await seedDevice(store, "uk", { updatedAt: "2026-10-15T10:00:00.000Z", id: "dev_000000000000000000000002" });
  assert.equal(await noteLocaleOf(store, WALLET), "uk");
  await seedDevice(store, "en", { updatedAt: "2026-10-16T10:00:00.000Z", id: "dev_000000000000000000000003", revoked: true });
  assert.equal(await noteLocaleOf(store, WALLET), "uk");
});

test("a cancellation that never landed says the order still waits — never read as «cancelled»", () => {
  assert.equal(receiptEventOf("CANCELLING", "OPEN"), "not-cancelled");
  assert.equal(receiptEventOf("CANCELLING", "PARTIAL"), "not-cancelled");
  const words = limitNoteWords("not-cancelled", { side: "sell", venue: "trigger" }, "SOL");
  assert.equal(words.uk.reason, "Не скасовано, ордер чекає: продаж SOL · Jupiter");
  assert.doesNotMatch(`${words.en.reason}${words.uk.reason}`, /\d/);
});

test("the reconciler reads every wallet with open orders in turn — the oldest orders never keep the rest from their «Ордер виконано»", async () => {
  const wallets = Array.from({ length: 40 }, (_, index) => `wallet-${String(index).padStart(2, "0")}`);
  const seen = new Set();
  for (let pass = 0; pass < Math.ceil(40 / 15); pass += 1) {
    const turn = walletsInTurn(wallets, NOW + pass * LIMIT_RECONCILE_EVERY_MS, 15);
    assert.equal(turn.length, 15);
    for (const wallet of turn) seen.add(wallet);
  }
  assert.equal(seen.size, 40, "every wallet within ⌈40 / 15⌉ passes");
  assert.deepEqual(walletsInTurn(["b", "a", "a"], NOW, 15), ["a", "b"], "few wallets: all of them, once");

  const store = createMemoryGuardStore();
  for (let index = 0; index < 30; index += 1) {
    const order = `${ORDER.slice(0, -2)}${String(index).padStart(2, "0")}`;
    const wallet = `${WALLET.slice(0, -2)}${String(index).padStart(2, "0")}`;
    await beginLimitOrder(store, input({ wallet, order, state: "OPEN" }), START);
  }
  const synced = [];
  await reconcileLimitOrders(store, { nowMs: NOW, sync: async (wallet) => void synced.push(wallet), connection: fakeConnection(null), notes: null });
  assert.equal(synced.length, 15, "a slice of the open orders' wallets each pass, not the same oldest 25 records");
});
