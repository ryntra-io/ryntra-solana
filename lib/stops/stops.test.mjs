// Run from repo root: node --test lib/stops/stops.test.mjs
//
// CITY-149 — stops on spot in the engine: the line the city and the cron both judge by, the routes' rules (the
// wallet's limit, a stop already reached, cancel and done), the store in memory and through the database's functions,
// the cron pass (one quote per pair and amount, «reached» written once, the expiry), and the note it writes and
// delivers — Telegram's text and link, the push's line — in English and Ukrainian.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { limitAmounts } from "../solana/limits/model.ts";
import { createStopsApi } from "./api.ts";
import { expiresAtOf, MAX_STOPS, stopReached, stopThreshold, stopView } from "./model.ts";
import { isStopNote, priceWords, STOP_NOTE_WORDS, stopHref, stopNoteId, stopNoteText } from "./notes.ts";
import { stopsReady, storeKind } from "./ready.ts";
import { runStopsPass, stopNote } from "./run.ts";
import { StopCreateSchema } from "./schema.ts";
import { createMemoryStopsStore, StopsStoreUnavailable } from "./store.ts";
import { createSupabaseStopsStore, stopOfRow } from "./supabase-store.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, name: "Solana" };
const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 };
const T0 = Date.parse("2026-10-29T12:00:00.000Z");

const sell = (over = {}) => ({ side: "sell", base: SOL, quote: USDC, amountRaw: "1000000000", price: "150.5", expiry: "7d", locale: "uk", ...over });

function api(over = {}) {
  let n = 0;
  let now = T0;
  const store = over.store ?? createMemoryStopsStore();
  const quotes = [];
  const deps = {
    store,
    open: () => over.open ?? true,
    quote: async (input) => {
      quotes.push(input);
      return over.quoteOut ?? null;
    },
    now: () => now,
    id: () => `stp_${String(++n).padStart(20, "0")}`,
  };
  return { api: createStopsApi(deps), store, quotes, tick: (ms) => (now += ms) };
}

test("the line: a sale of 1 SOL at 150.5 USDC is reached when a quote brings 150.5 USDC or less — the limits engine's own arithmetic", () => {
  const terms = sell();
  assert.equal(stopThreshold(terms), "150500000");
  assert.equal(stopReached({ thresholdRaw: "150500000" }, "150500001"), false);
  assert.equal(stopReached({ thresholdRaw: "150500000" }, "150500000"), true);
  assert.equal(stopReached({ thresholdRaw: "150500000" }, "149000000"), true);
  assert.equal(stopReached({ thresholdRaw: "150500000" }, "not a number"), false);
  /* A buy: 100 USDC «when it rises to» 150 — what 100 USDC brings of SOL at that price, by `limitAmounts`. */
  const buy = { side: "buy", base: SOL, quote: USDC, amountRaw: "100000000", price: "150" };
  const expected = limitAmounts({ pair: { baseMint: SOL.mint, baseDecimals: 9, quoteMint: USDC.mint, quoteDecimals: 6 }, side: "buy", amount: "100", price: "150" }).takingRaw;
  assert.equal(stopThreshold(buy), expected);
  assert.equal(stopThreshold({ ...buy, price: "0" }), null);
  assert.equal(stopThreshold({ ...buy, amountRaw: "0" }), null);
});

test("the city judges a stop by the very same two functions the cron does", () => {
  const city = read("city/lib/trade/stops.ts");
  assert.match(city, /from '\.\.\/\.\.\/\.\.\/lib\/stops\/model\.ts'/);
  assert.match(city, /stopThreshold/);
  assert.match(city, /stopReached/);
  assert.doesNotMatch(city, /export function stopThreshold|export function stopReached/);
});

test("expiry: 1d, 7d, 30d and never — a watched or reached stop past its time reads as expired before the cron writes it", () => {
  assert.equal(expiresAtOf("1d", T0), T0 + 86_400_000);
  assert.equal(expiresAtOf("7d", T0), T0 + 7 * 86_400_000);
  assert.equal(expiresAtOf("30d", T0), T0 + 30 * 86_400_000);
  assert.equal(expiresAtOf("never", T0), null);
  assert.equal(stopView({ state: "watching", expiresAt: T0 }, T0), "expired");
  assert.equal(stopView({ state: "reached", expiresAt: T0 }, T0 - 1), "reached");
  assert.equal(stopView({ state: "done", expiresAt: T0 }, T0 + 1), "done");
  assert.equal(stopView({ state: "watching", expiresAt: null }, T0 + 1e12), "watching");
});

test("the body is strict: a line, an owner or an unknown field from the client is refused; the same mint twice too", () => {
  assert.equal(StopCreateSchema.safeParse(sell()).success, true);
  assert.equal(StopCreateSchema.safeParse({ ...sell(), thresholdRaw: "1" }).success, false);
  assert.equal(StopCreateSchema.safeParse({ ...sell(), owner: OTHER }).success, false);
  assert.equal(StopCreateSchema.safeParse({ ...sell(), quote: { ...USDC, mint: SOL.mint } }).success, false);
  assert.equal(StopCreateSchema.safeParse({ ...sell(), expiry: "2d" }).success, false);
  assert.equal(StopCreateSchema.safeParse({ ...sell(), amountRaw: "0" }).success, false);
  assert.equal(StopCreateSchema.parse({ ...sell(), locale: undefined }).locale, "en");
});

test("create: the engine works out the line, asks the quote once, and keeps the stop under the proven wallet", async () => {
  const { api: stops, store, quotes } = api({ quoteOut: "160000000" });
  const made = await stops.create(OWNER, StopCreateSchema.parse(sell()));
  assert.equal(made.status, 201);
  assert.equal(made.body.stop.thresholdRaw, "150500000");
  assert.equal(made.body.stop.state, "watching");
  assert.equal(made.body.stop.expiresAt, T0 + 7 * 86_400_000);
  assert.deepEqual(quotes, [{ inputMint: SOL.mint, outputMint: USDC.mint, amountRaw: "1000000000" }]);
  const kept = await store.list(OWNER, T0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].owner, OWNER);
  assert.equal(kept[0].locale, "uk");
  assert.equal((await store.list(OTHER, T0)).length, 0);
  const listed = await stops.list(OWNER);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.max, MAX_STOPS);
  assert.equal(listed.body.stops[0].id, made.body.stop.id);
  assert.equal("owner" in listed.body.stops[0], false);
});

test("create: a stop the quote says is already reached is a market order, refused as one; a quote that did not answer refuses nothing", async () => {
  const there = await api({ quoteOut: "150000000" }).api.create(OWNER, StopCreateSchema.parse(sell()));
  assert.equal(there.status, 409);
  assert.equal(there.body.error.code, "STOP_REACHED");
  const unknown = await api({ quoteOut: null }).api.create(OWNER, StopCreateSchema.parse(sell()));
  assert.equal(unknown.status, 201);
});

test(`the wallet's limit: ${MAX_STOPS} live stops; a cancelled, done or expired one makes room`, async () => {
  const { api: stops, tick } = api();
  for (let i = 0; i < MAX_STOPS; i += 1) assert.equal((await stops.create(OWNER, StopCreateSchema.parse(sell({ expiry: i === 0 ? "1d" : "never" })))).status, 201);
  const over = await stops.create(OWNER, StopCreateSchema.parse(sell()));
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, "STOP_LIMIT");
  assert.equal((await stops.create(OTHER, StopCreateSchema.parse(sell()))).status, 201, "another wallet has its own limit");
  const cancelled = await stops.cancel(OWNER, "stp_00000000000000000002");
  assert.equal(cancelled.body.stop.state, "cancelled");
  assert.equal((await stops.create(OWNER, StopCreateSchema.parse(sell()))).status, 201);
  assert.equal((await stops.create(OWNER, StopCreateSchema.parse(sell()))).status, 409);
  tick(86_400_000);
  assert.equal((await stops.create(OWNER, StopCreateSchema.parse(sell()))).status, 201, "the 1d stop expired");
});

test("cancel and done: only the wallet's own stop; done only after reached; a finished stop stays as it was", async () => {
  const { api: stops, store } = api();
  const id = (await stops.create(OWNER, StopCreateSchema.parse(sell()))).body.stop.id;
  assert.equal((await stops.cancel(OTHER, id)).status, 404);
  assert.equal((await stops.cancel(OWNER, "not-an-id")).status, 404);
  assert.equal((await stops.finish(OWNER, id)).body.stop.state, "watching", "a watched stop is not done");
  assert.equal(await store.reach(id, "150000000", T0 + 1), true);
  assert.equal((await stops.finish(OTHER, id)).status, 404);
  assert.equal((await stops.finish(OWNER, id)).body.stop.state, "done");
  assert.equal((await stops.cancel(OWNER, id)).body.stop.state, "done");
});

test("closed or unreachable: stops shut answer 503 STOPS_CLOSED; a store that does not answer is a 503, never a 500", async () => {
  const shut = await api({ open: false }).api.list(OWNER);
  assert.equal(shut.status, 503);
  assert.equal(shut.body.error.code, "STOPS_CLOSED");
  const broken = createMemoryStopsStore();
  broken.list = async () => {
    throw new StopsStoreUnavailable("down");
  };
  const down = await api({ store: broken }).api.list(OWNER);
  assert.equal(down.status, 503);
  assert.equal(down.body.error.code, "UNAVAILABLE");
});

test("ready: production opens stops only on the database and only behind the city's switch", () => {
  assert.equal(stopsReady({ durable: false }, "open", "production"), false);
  assert.equal(stopsReady({ durable: true }, "open", "production"), true);
  assert.equal(stopsReady({ durable: true }, undefined, "production"), false);
  assert.equal(stopsReady({ durable: false }, "open", "development"), true);
  const db = { SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k", BETA_APP_SECRET: "s" };
  assert.equal(storeKind({ ...db, NODE_ENV: "production" }), "database");
  assert.equal(storeKind({ NODE_ENV: "production" }), "memory");
  assert.equal(storeKind({ ...db, NODE_ENV: "development" }), "memory");
  assert.equal(storeKind({ ...db, NODE_ENV: "development", RYNTRA_STOPS_STORE: "database" }), "database");
});

test("the database's store: one function per question, its answers read strictly, a refusal is StopsStoreUnavailable", async () => {
  const calls = [];
  const row = { id: "stp_00000000000000000001", owner: OWNER, side: "sell", base: SOL, quote: USDC, amountRaw: "1000000000", price: "150.5", thresholdRaw: "150500000", locale: "uk", createdAt: T0, expiresAt: null, state: "watching", reachedAt: null, reachedOutRaw: null, updatedAt: T0 };
  const answers = {
    spot_stops_list: { ok: true, stops: [row, { id: "bad" }] },
    spot_stops_create: { ok: true, created: false, reason: "limit" },
    spot_stops_reach: { ok: true, reached: true },
    spot_stops_cancel: { ok: true, stop: null },
    spot_stops_due: { ok: false, error: "bad_request" },
  };
  const store = createSupabaseStopsStore(async (fn, args) => {
    calls.push({ fn, args });
    return { ok: true, data: answers[fn] };
  });
  const list = await store.list(OWNER, T0);
  assert.equal(list.length, 1, "a row that is not exactly a stop is left out");
  assert.deepEqual(list[0], { ...row, base: SOL });
  assert.deepEqual(await store.create(stopOfRow(row), MAX_STOPS, T0), { ok: false, reason: "limit" });
  assert.equal(await store.reach(row.id, "150000000", T0), true);
  assert.equal(await store.cancel(OWNER, row.id, T0), null);
  await assert.rejects(store.due(T0, 10), StopsStoreUnavailable);
  assert.deepEqual(calls.map((c) => c.fn), ["spot_stops_list", "spot_stops_create", "spot_stops_reach", "spot_stops_cancel", "spot_stops_due"]);
  assert.equal(calls[0].args.p_now, new Date(T0).toISOString());
  assert.equal("p_secret" in calls[0].args, false, "the transport adds the secret, never the store");
  const down = createSupabaseStopsStore(async () => ({ ok: false, error: "temporarily unavailable" }));
  await assert.rejects(down.list(OWNER, T0), StopsStoreUnavailable);
});

test("the note says one short line in the dictionary's words, EN and UA, and opens the city on the stop's sale", () => {
  const stop = { id: "stp_0123456789abcdef0123", side: "sell", base: SOL, quote: USDC, price: "150.50" };
  assert.deepEqual(stopNoteText(stop, "uk"), { title: "Стоп SOL досягнуто — продати?", reason: "Ціна дійшла до 150,5 USDC. Ордер підписує твій гаманець.", cta: "Відкрити продаж" });
  assert.deepEqual(stopNoteText(stop, "en"), { title: "Stop SOL reached — sell?", reason: "The price came to 150.5 USDC. Your wallet signs the order.", cta: "Open the sale" });
  assert.equal(stopNoteText({ ...stop, side: "buy", base: { ...SOL, symbol: "$bonk" } }, "uk").title, "Стоп BONK досягнуто — купити?");
  assert.equal(priceWords("150", "uk"), "150");
  assert.equal(stopHref(stop), `/c/${SOL.mint}?stop=stp_0123456789abcdef0123`);
  assert.match(stopNoteId(stop.id), /^inb_[0-9a-f]{24}$/);
  assert.deepEqual(Object.keys(STOP_NOTE_WORDS).sort(), ["en", "uk"]);
});

/** A cron pass over a memory store, its quotes counted. */
async function pass(stops, guard, outOf, at, deliver) {
  const asked = [];
  const report = await runStopsPass({
    stops,
    guard,
    quote: async (input) => {
      asked.push(input);
      return outOf(input);
    },
    clock: () => at,
    deliver,
  });
  return { report, asked };
}

test("the cron: one quote per pair and amount, «reached» written once, told once — a second pass tells nothing again", async () => {
  const { api: stops, store } = api();
  await stops.create(OWNER, StopCreateSchema.parse(sell()));
  await stops.create(OWNER, StopCreateSchema.parse(sell({ price: "140" })));
  await stops.create(OTHER, StopCreateSchema.parse(sell({ locale: "en" })));
  const guard = createMemoryGuardStore();
  const first = await pass(store, guard, () => "150000000", T0 + 60_000);
  assert.equal(first.asked.length, 1, "three stops of the same pair and amount, one quote");
  assert.equal(first.report.checked, 3);
  assert.equal(first.report.reached, 2, "150 is at or below 150.5 but above 140");
  assert.equal(first.report.told, 2);
  const mine = await listInbox(guard, OWNER);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, "Стоп SOL досягнуто — продати?");
  assert.equal(mine[0].href, `/c/${SOL.mint}?stop=stp_00000000000000000001`);
  assert.equal(isStopNote(mine[0]), true);
  assert.equal((await listInbox(guard, OTHER))[0].title, "Stop SOL reached — sell?");
  const rows = await outboxOf(guard).valuesWithPrefix("");
  assert.deepEqual(rows.map((row) => row.channel).sort(), ["push", "push", "telegram", "telegram"]);

  const second = await pass(store, guard, () => "100000000", T0 + 120_000);
  assert.equal(second.report.reached, 1, "only the 140 stop was still watched");
  assert.equal(second.report.told, 1);
  assert.equal((await listInbox(guard, OWNER)).length, 2);
  const third = await pass(store, guard, () => "100000000", T0 + 180_000);
  assert.deepEqual([third.report.checked, third.report.reached, third.report.told, third.asked.length], [0, 0, 0, 0]);
  assert.equal((await outboxOf(guard).valuesWithPrefix("")).length, 6);
});

test("the cron: a quote that did not answer reaches nothing; a stop past its time expires and is never reached", async () => {
  const { api: stops, store } = api();
  await stops.create(OWNER, StopCreateSchema.parse(sell({ expiry: "1d" })));
  const guard = createMemoryGuardStore();
  const silent = await pass(store, guard, () => null, T0 + 60_000);
  assert.deepEqual([silent.report.unquoted, silent.report.reached], [1, 0]);
  const late = await pass(store, guard, () => "1", T0 + 86_400_000);
  assert.equal(late.report.expired, 1);
  assert.equal(late.report.reached, 0);
  assert.equal((await store.list(OWNER, T0 + 86_400_000))[0].state, "expired");
  assert.equal((await listInbox(guard, OWNER)).length, 0);
});

test("the cron: a reached stop the pass could not tell is told by the next one; the person's settings choose the channels", async () => {
  const { api: stops, store } = api();
  await stops.create(OWNER, StopCreateSchema.parse(sell()));
  const guard = createMemoryGuardStore();
  await preferencesOf(guard).compareAndSet(`solana:mainnet:${OWNER}`, null, { version: 1, owner: OWNER, inbox: true, telegram: true, push: false, quietHours: null, updatedAt: new Date(T0).toISOString() });
  const told = store.told;
  store.told = async () => {
    throw new Error("lost");
  };
  await assert.rejects(pass(store, guard, () => "1", T0 + 60_000));
  store.told = told;
  const again = await pass(store, guard, () => "1", T0 + 120_000);
  assert.equal(again.report.told, 1);
  assert.equal((await listInbox(guard, OWNER)).length, 1, "the same note id: one note");
  assert.deepEqual((await outboxOf(guard).valuesWithPrefix("")).map((row) => row.channel), ["telegram"]);
});

test("delivery: Telegram says the line with the link to the city on the sale; push opens the same address; the note's link resolves to it", async () => {
  const { api: stops, store } = api();
  await stops.create(OWNER, StopCreateSchema.parse(sell()));
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
  let delivered = null;
  await pass(store, guard, () => "1", T0 + 60_000, async (rows, atMs) => {
    delivered = { rows, atMs };
    await deliverOutbox(guard, atMs, { telegram });
  });
  assert.equal(delivered.rows.size, 2);
  assert.equal(sent.length, 1);
  const link = `https://ryntra.io/c/${SOL.mint}?stop=stp_00000000000000000001`;
  assert.equal(sent[0].text, "Ryntra\nСтоп SOL досягнуто — продати?\nЦіна дійшла до 150,5 USDC. Ордер підписує твій гаманець.", "no address in the text: the button opens it");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Відкрити продаж", url: link }]]);
  const rows = await outboxOf(guard).valuesWithPrefix("");
  assert.equal(rows.find((row) => row.channel === "telegram").state, "sent");
  /* No phone registered and no browser key here: the push row says so honestly. */
  assert.match(rows.find((row) => row.channel === "push").state, /^skipped_/);
  const note = (await listInbox(guard, OWNER))[0];
  assert.equal(await resolveInboxLink(guard, OWNER, note.id), `/c/${SOL.mint}?stop=stp_00000000000000000001`);
  assert.equal(stopNote({ ...(await store.list(OWNER, T0))[0] }, T0).href, note.href);
});

test("push to a computer's browser opens the stop's own city address; every other note keeps its page", () => {
  const latest = read("app/api/v1/assistant/push/latest/route.ts");
  /* CITY-100: an Earn note opens its own city address the same way. */
  assert.match(latest, /isStopNote\(newest\)(?: \|\| isEarnNote\(newest\))? \? newest\.href : `\/app\/alerts\/open\?n=/);
  const deliver = read("lib/monitoring/deliver.ts");
  assert.match(deliver, /stop \? inbox\.href :/);
});

test("the routes: a read takes the wallet's proof, every change the wallet's own signature; the cron its bearer and the switch", () => {
  const list = read("app/api/v1/stops/route.ts");
  assert.match(list, /export async function GET[\s\S]*requireWalletProof\(request, "read"\)/);
  assert.match(list, /export async function POST[\s\S]*requireWalletProof\(request, "mutation"\)/);
  const one = read("app/api/v1/stops/[stopId]/route.ts");
  assert.match(one, /export async function DELETE[\s\S]*requireWalletProof\(request, "mutation"\)/);
  assert.match(one, /export async function PATCH[\s\S]*requireWalletProof\(request, "mutation"\)/);
  const cron = read("app/api/cron/spot-stops/route.ts");
  assert.match(cron, /decideBearerAuth/);
  assert.match(cron, /if \(!stopsOpen\(\)\) return/);
  const crons = JSON.parse(read("vercel.json")).crons;
  assert.ok(crons.some((row) => row.path === "/api/cron/spot-stops" && row.schedule === "* * * * *"));
  /* Nothing on this path signs, sends or reads a key. */
  for (const file of ["lib/stops/api.ts", "lib/stops/run.ts", "lib/stops/quote.server.ts", "lib/stops/server.ts", "lib/stops/runtime.server.ts", "app/api/cron/spot-stops/route.ts"]) {
    assert.doesNotMatch(read(file), /signTransaction|sendTransaction|sendRawTransaction|Keypair|secretKey|privateKey/, file);
  }
});

test("the migration: a file only, one transaction, one private table under forced row security, every function asks for the secret", () => {
  const sql = read("supabase/migrations/20261029200000_spot_stops_v1.sql");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.match(sql, /create table private\.spot_stops/);
  assert.match(sql, /alter table private\.spot_stops force row level security;/);
  assert.match(sql, /revoke all privileges on table private\.spot_stops from public, anon, authenticated, service_role;/);
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(code, /^\s*(drop|truncate)\s/im);
  const fns = [...code.matchAll(/create function public\.(spot_stops_\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ["spot_stops_list", "spot_stops_create", "spot_stops_cancel", "spot_stops_finish", "spot_stops_due", "spot_stops_reach", "spot_stops_untold", "spot_stops_told", "spot_stops_expire"]);
  for (const body of code.split(/create function public\./).slice(1)) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/);
  }
  for (const fn of fns) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\(`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\(`), fn);
  }
  /* The table's limit and the engine's agree; «reached» is one conditional update. */
  assert.match(code, /where s\.id = p_id and s\.state = 'watching' and \(s\.expires_at is null or s\.expires_at > p_now\)/);
  const rollback = read("supabase/prepared/20261029_spot_stops_v1_rollback.sql");
  for (const fn of fns) assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}\\(`), fn);
});
