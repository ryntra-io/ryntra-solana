// Run from repo root: node --test lib/assistant/watch-ai05.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { AssistantWatchCreateSchema, AssistantWatchesResponseSchema, MONITOR_NOTE_SUBJECT_KINDS_V1 } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, monitorNotes, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { DEFAULT_CREDIT_PRICES, priceOf, resolveCreditsConfig } from "./credits/prices.ts";
import { judgeWatch } from "./watch/evaluate.ts";
import { addSample, composeMintRead, liquidityAgo, parseJupiterPrices } from "./watch/market.ts";
import { readWatchMarkets } from "./watch/reads.ts";
import { DELIVERIES_PER_HOUR, FREE_WATCHES, PRESET_WORDS, presetRule, ruleWords, WATCH_PRESETS } from "./watch/rules.ts";
import { runWatchPass, watchInboxId } from "./watch/run.ts";
import { createWatch, readWatchSurface, removeWatch, updateWatch } from "./watch/service.ts";
import { listWatches, readMarket, readRun, readWatch, writeWatch } from "./watch/store.ts";
import { noteWords } from "./watch/words.ts";

/**
 * AI-05 — «Стежити за токеном»: rules on one token judged without a model
 * (a price level with a band, a move over 5 min / 1 h / 24 h, a volume spike,
 * a change of liquidity), every token read once for everyone who watches it,
 * one note per crossing however often the pass runs or restarts, the inbox
 * always and Telegram and push as the person set, at most 20 an hour, held
 * through quiet hours, three watches free. On fakes and a memory store —
 * nothing here reaches the network.
 */

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OTHER = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const T0 = Date.parse("2026-10-20T12:00:00.000Z");
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function wallet(n) {
  let tail = "";
  let x = n;
  for (let i = 0; i < 4; i += 1) {
    tail = B58[x % 58] + tail;
    x = Math.floor(x / 58);
  }
  return `F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZ${tail}`;
}
const pairOf = (mint) => [...mint].reverse().join("");

/** A fake market: each token's figures, set by the test; the fetch answers Jupiter Price v3 and DexScreener tokens/v1 from them and counts the requests. */
function fakeMarket(initial) {
  const state = { m: structuredClone(initial), calls: { jupiter: 0, dex: 0 }, down: { jupiter: false, dex: false } };
  const fetchImpl = async (url) => {
    if (url.includes("/price/v3")) {
      state.calls.jupiter += 1;
      if (state.down.jupiter) return new Response("busy", { status: 503 });
      const ids = new URL(url).searchParams.get("ids").split(",");
      const body = {};
      for (const id of ids) if (state.m[id]) body[id] = { usdPrice: state.m[id].price, priceChange24h: state.m[id].h24 ?? null, decimals: 9 };
      return Response.json(body);
    }
    if (url.includes("/tokens/v1/solana/")) {
      state.calls.dex += 1;
      if (state.down.dex) return new Response("busy", { status: 429 });
      const ids = url.split("/tokens/v1/solana/")[1].split(",");
      const pairs = ids.flatMap((id) => {
        const row = state.m[id];
        if (!row) return [];
        return [
          {
            chainId: "solana",
            dexId: "raydium",
            pairAddress: pairOf(id),
            baseToken: { address: id, symbol: row.symbol },
            quoteToken: { address: USDC, symbol: "USDC" },
            priceUsd: String(row.price),
            liquidity: { usd: row.liq ?? 1_000_000 },
            volume: { m5: 1_000, h1: row.vol1 ?? 10_000, h6: 60_000, h24: row.vol24 ?? 240_000 },
            priceChange: { m5: row.m5 ?? 0, h1: row.h1 ?? 0, h6: 0, h24: row.h24 ?? 0 },
            txns: { h1: { buys: 10, sells: 10 }, h24: { buys: 100, sells: 100 } },
          },
        ];
      });
      return Response.json(pairs);
    }
    throw new Error(`unexpected ${url}`);
  };
  return state.fetchImpl = fetchImpl, state;
}

function passDeps(store, market, clock) {
  return { store, clock, read: (mints) => readWatchMarkets(mints, { fetchImpl: market.fetchImpl, jupiter: { url: "https://lite-api.jup.ag/price/v3", apiKey: null }, clock }) };
}

let seq = 0;
function watchRecord(owner, mint, rule, extra = {}) {
  seq += 1;
  const at = iso(T0 - 10 * MIN);
  return {
    schema: "ryntra.assistant.watch",
    version: 1,
    id: `wch_${seq.toString(16).padStart(24, "0")}`,
    owner,
    mint,
    symbol: mint === SOL ? "SOL" : mint === JUP ? "JUP" : "BONK",
    rule,
    status: "active",
    cooldownMinutes: 60,
    channels: { telegram: true, push: true },
    locale: "uk",
    state: { armed: true, armedSince: at, lastFiredAt: null },
    last: null,
    fired: 0,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

const lookup = (prices) => async (mint) => (mint === SOL ? { symbol: "SOL", suspicious: false, priceUsd: prices?.[SOL] ?? 180 } : mint === JUP ? { symbol: "JUP", suspicious: false, priceUsd: 0.5 } : null);

const read = (over = {}) => ({
  mint: SOL,
  symbol: "SOL",
  observedAt: iso(T0),
  priceUsd: 180,
  changePct: { m5: 0, h1: 0, h24: 0 },
  changeSource: { m5: "DexScreener", h1: "DexScreener", h24: "Jupiter" },
  volumeUsd: { h1: 10_000, h24: 240_000 },
  liquidityUsd: 1_000_000,
  pools: {},
  jupiter: true,
  dex: true,
  ...over,
});

/* ---------------------------------------------------------------- the rules */

test("presets: one press each; a level is set from the price read now, four significant figures", () => {
  assert.deepEqual(presetRule("drop24h", null), { kind: "move", window: "h24", direction: "down", pct: 10 });
  assert.deepEqual(presetRule("below", 182.37), { kind: "price", direction: "below", level: 173.3 });
  assert.deepEqual(presetRule("above", 0.0012345), { kind: "price", direction: "above", level: 0.001296 });
  assert.equal(presetRule("below", null), null, "no price — no level is guessed");
  assert.deepEqual(presetRule("liquidityDrop", 1), { kind: "liquidity", window: "h1", direction: "drop", pct: 30, pool: null });
  for (const id of WATCH_PRESETS) assert.ok(PRESET_WORDS[id].uk && PRESET_WORDS[id].en);
  assert.equal(ruleWords({ kind: "move", window: "h24", direction: "down", pct: 10 }, "uk"), "Падіння на 10 % за добу");
  assert.equal(ruleWords({ kind: "price", direction: "below", level: 180 }, "uk"), "Ціна нижче $180,00");
  assert.equal(ruleWords({ kind: "price", direction: "below", level: 180 }, "en"), "Price below $180.00");
});

/* ---------------------------------------------------------------- the judgement */

test("a price level rings once, waits for the market to leave the 1 % band, and rings again only then", () => {
  const rule = { kind: "price", direction: "below", level: 180 };
  let state = { armed: true, armedSince: iso(T0 - MIN), lastFiredAt: null };
  const at = (n, price) => judgeWatch({ watchId: "wch_1", rule, state, cooldownMinutes: 5, read: read({ priceUsd: price, observedAt: iso(T0 + n * MIN) }), samples: [], nowMs: T0 + n * MIN });
  let j = at(0, 181);
  assert.equal(j.outcome, "quiet");
  j = at(1, 179.5);
  assert.equal(j.outcome, "fire");
  const first = j.identity;
  state = j.next;
  for (const [n, price] of [[2, 179], [3, 180.5], [4, 181.5], [5, 179.9]]) {
    j = at(n, price);
    assert.notEqual(j.outcome, "fire", `on the line at $${price}, no second note`);
    state = j.next;
  }
  j = at(20, 182);
  assert.equal(j.next.armed, true, "past the band it is armed again");
  state = j.next;
  j = at(30, 179);
  assert.equal(j.outcome, "fire");
  assert.notEqual(j.identity, first, "a new crossing — a new identity");
});

test("never twice within the pause, and a read that is stale or missing decides nothing", () => {
  const rule = { kind: "move", window: "h1", direction: "any", pct: 5 };
  const state = { armed: true, armedSince: iso(T0 - 2 * 3_600_000), lastFiredAt: iso(T0 - 10 * MIN) };
  const cooling = judgeWatch({ watchId: "w", rule, state, cooldownMinutes: 60, read: read({ changePct: { m5: 0, h1: -7, h24: 0 } }), samples: [], nowMs: T0 });
  assert.equal(cooling.outcome, "cooling");
  assert.equal(cooling.identity, null);
  const stale = judgeWatch({ watchId: "w", rule, state, cooldownMinutes: 5, read: read({ observedAt: iso(T0 - 10 * MIN), changePct: { m5: 0, h1: -50, h24: 0 } }), samples: [], nowMs: T0 });
  assert.equal(stale.outcome, "unread");
  assert.equal(judgeWatch({ watchId: "w", rule, state, cooldownMinutes: 5, read: undefined, samples: [], nowMs: T0 }).outcome, "unread");
  const noFigure = judgeWatch({ watchId: "w", rule, state, cooldownMinutes: 5, read: read({ changePct: { m5: null, h1: null, h24: null }, changeSource: { m5: null, h1: null, h24: null } }), samples: [], nowMs: T0 });
  assert.equal(noFigure.outcome, "unread", "a figure the source did not state is not a pass");
});

test("moves over 5 min, 1 h and 24 h; a volume spike against the day's hour, never on dust", () => {
  const armed = { armed: true, armedSince: iso(T0 - MIN), lastFiredAt: null };
  const j = (rule, over) => judgeWatch({ watchId: "w", rule, state: armed, cooldownMinutes: 5, read: read(over), samples: [], nowMs: T0 });
  assert.equal(j({ kind: "move", window: "m5", direction: "up", pct: 2 }, { changePct: { m5: 2.4, h1: 0, h24: 0 } }).outcome, "fire");
  assert.equal(j({ kind: "move", window: "h24", direction: "down", pct: 10 }, { changePct: { m5: 0, h1: 0, h24: -9.9 } }).outcome, "quiet");
  assert.equal(j({ kind: "move", window: "h24", direction: "down", pct: 10 }, { changePct: { m5: 0, h1: 0, h24: -10.4 } }).outcome, "fire");
  assert.equal(j({ kind: "volume", factor: 3 }, { volumeUsd: { h1: 40_000, h24: 240_000 } }).outcome, "fire", "×4 the usual hour");
  assert.equal(j({ kind: "volume", factor: 3 }, { volumeUsd: { h1: 4_000, h24: 24_000 } }).outcome, "quiet", "×4 of dust is no news");
});

test("liquidity against the token's own history: learning until an hour of reads, then the change", () => {
  const rule = { kind: "liquidity", window: "h1", direction: "drop", pct: 30, pool: null };
  const armed = { armed: true, armedSince: iso(T0 - MIN), lastFiredAt: null };
  let samples = [];
  for (let n = 0; n <= 40; n += 1) samples = addSample(samples, read({ observedAt: iso(T0 + n * MIN), liquidityUsd: 1_000_000 }), T0 + n * MIN, []);
  const early = judgeWatch({ watchId: "w", rule, state: armed, cooldownMinutes: 5, read: read({ observedAt: iso(T0 + 40 * MIN), liquidityUsd: 500_000 }), samples, nowMs: T0 + 40 * MIN });
  assert.equal(early.outcome, "learning", "forty minutes of history do not measure an hour");
  for (let n = 41; n <= 65; n += 1) samples = addSample(samples, read({ observedAt: iso(T0 + n * MIN), liquidityUsd: 1_000_000 }), T0 + n * MIN, []);
  const now = T0 + 66 * MIN;
  samples = addSample(samples, read({ observedAt: iso(now), liquidityUsd: 650_000 }), now, []);
  assert.equal(liquidityAgo(samples, 3_600_000, now, null), 1_000_000);
  const later = judgeWatch({ watchId: "w", rule, state: armed, cooldownMinutes: 5, read: read({ observedAt: iso(now), liquidityUsd: 650_000 }), samples, nowMs: now });
  assert.equal(later.outcome, "fire");
  assert.ok(Math.abs(later.figure.value + 35) < 1e-9, "−35 %");
});

test("a token's history whose write lost (a failed read, another pass) is written on the second try", async () => {
  const store = createMemoryGuardStore();
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "move", window: "h24", direction: "down", pct: 50 }), null);
  await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0));
  /* The store's read of the history fails once, as the stand's single socket does. */
  let failed = false;
  const flaky = { ...store, versioned: (name) => { const inner = store.versioned(name); return { ...inner, get: async (key) => { if (!failed && key.startsWith("market:")) { failed = true; throw new Error("read ECONNRESET"); } return inner.get(key); } }; } };
  await runWatchPass({ ...passDeps(flaky, fakeMarket({ [SOL]: { symbol: "SOL", price: 161 } }), () => T0 + MIN), concurrency: 1 });
  const market = await readMarket(store, SOL);
  assert.equal(market.read.observedAt, iso(T0 + MIN), "the minute's read is kept");
  assert.equal(market.samples.length, 2);
});

test("the history stays short: every read of 70 minutes, one an hour back to a day", () => {
  let samples = [];
  for (let n = 0; n < 30 * 60; n += 1) samples = addSample(samples, read({ observedAt: iso(T0 + n * MIN) }), T0 + n * MIN, []);
  assert.ok(samples.length <= 71 + 25, `${samples.length} reads kept`);
  const oldest = T0 + (30 * 60 - 1) * MIN - Date.parse(samples[0].at);
  assert.ok(oldest <= 25 * 3_600_000);
});

/* ---------------------------------------------------------------- one read for everyone */

test("the market is read in batches: 1 000 rules on SOL — one request to each source; 120 tokens — 3 to Jupiter and 4 to DexScreener", async () => {
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 180 } });
  const got = await readWatchMarkets(Array.from({ length: 1_000 }, () => SOL), { fetchImpl: market.fetchImpl, jupiter: { url: "https://lite-api.jup.ag/price/v3", apiKey: null }, clock: () => T0 });
  assert.deepEqual(got.requests, { jupiter: 1, dex: 1 });
  assert.equal(got.reads.get(SOL).priceUsd, 180);
  const many = Array.from({ length: 120 }, (_, n) => wallet(n));
  const wide = fakeMarket({});
  const read2 = await readWatchMarkets(many, { fetchImpl: wide.fetchImpl, jupiter: { url: "https://lite-api.jup.ag/price/v3", apiKey: null }, clock: () => T0 });
  assert.deepEqual(read2.requests, { jupiter: 3, dex: 4 });
});

test("Jupiter's price and day change, DexScreener's 5 min and 1 h, only against USDC, USDT or SOL", () => {
  const body = [
    { chainId: "solana", dexId: "meteora", pairAddress: pairOf(JUP), baseToken: { address: JUP, symbol: "JUP" }, quoteToken: { address: USDC, symbol: "USDC" }, priceUsd: "0.5", liquidity: { usd: 2_000_000 }, volume: { h1: 50_000, h24: 900_000 }, priceChange: { m5: -0.4, h1: -2.2, h24: -6 } },
    /* A pool against a fresh token printing any figure is counted out. */
    { chainId: "solana", dexId: "pump", pairAddress: pairOf(BONK), baseToken: { address: JUP, symbol: "JUP" }, quoteToken: { address: BONK, symbol: "X" }, priceUsd: "9", liquidity: { usd: 9e9 }, volume: { h1: 9e9, h24: 9e9 }, priceChange: { m5: 500, h1: 500, h24: 500 } },
  ];
  const r = composeMintRead({ mint: JUP, observedAt: iso(T0), jupiter: parseJupiterPrices({ [JUP]: { usdPrice: 0.51, priceChange24h: -5.5 } }).get(JUP), jupiterAnswered: true, dexBody: body, dexAnswered: true });
  assert.equal(r.priceUsd, 0.51);
  assert.deepEqual(r.changePct, { m5: -0.4, h1: -2.2, h24: -5.5 });
  assert.deepEqual(r.changeSource, { m5: "DexScreener", h1: "DexScreener", h24: "Jupiter" });
  assert.equal(r.liquidityUsd, 2_000_000);
  assert.deepEqual(r.volumeUsd, { h1: 50_000, h24: 900_000 });
});

/* ---------------------------------------------------------------- the pass */

test("1 000 people watching SOL: one read, a note each, and no second note after a restart or a second pass at once", async () => {
  const store = createMemoryGuardStore();
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 175, h24: -3 } });
  for (let n = 0; n < 1_000; n += 1) await writeWatch(store, watchRecord(wallet(n), SOL, { kind: "price", direction: "below", level: 180 }), null);
  const run = await runWatchPass(passDeps(store, market, () => T0));
  assert.deepEqual(run.requests, { jupiter: 1, dex: 1 }, "one read of SOL for all 1 000 rules");
  assert.equal(run.fired, 1_000);
  assert.equal((await listInbox(store, wallet(7))).length, 1);
  /* A restart: a new process, fresh caches, the same market a minute on — and two passes at the same time. */
  const again = await Promise.all([runWatchPass(passDeps(store, fakeMarket(market.m), () => T0 + MIN)), runWatchPass(passDeps(store, fakeMarket(market.m), () => T0 + MIN))]);
  assert.equal(again[0].fired + again[1].fired, 0);
  let notes = 0;
  for (let n = 0; n < 1_000; n += 1) notes += (await listInbox(store, wallet(n))).length;
  assert.equal(notes, 1_000, "one note each, after all three passes");
  assert.equal((await readRun(store)).tokens, 1);
});

test("a pass cut short after the note is finished by the next one without a second note", async () => {
  const store = createMemoryGuardStore();
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 175 } });
  const watch = watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 180 });
  await writeWatch(store, watch, null);
  await runWatchPass(passDeps(store, market, () => T0));
  /* The state write is lost (a crash): the watch is put back armed as it was. */
  const after = await readWatch(store, OWNER, watch.id);
  await writeWatch(store, { ...after, version: after.version + 1, state: watch.state, last: null, fired: 0 }, after.version);
  const run = await runWatchPass(passDeps(store, market, () => T0 + MIN));
  assert.equal(run.fired, 0, "the crossing's note is there — nothing new");
  assert.equal((await listInbox(store, OWNER)).length, 1);
  assert.equal((await readWatch(store, OWNER, watch.id)).state.armed, false, "and the state is finished");
});

test("the note: inbox always, Telegram and push as set, the words with source and UTC time, the link to the watch", async () => {
  const store = createMemoryGuardStore();
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 160, h24: -11.2 } });
  const watch = watchRecord(OWNER, SOL, { kind: "move", window: "h24", direction: "down", pct: 10 });
  await writeWatch(store, watch, null);
  await runWatchPass(passDeps(store, market, () => T0));
  const [note] = await listInbox(store, OWNER);
  assert.equal(note.subject.kind, "token-watch");
  assert.equal(note.subject.id, watch.id);
  assert.equal(note.title, "SOL −11,2 % за добу");
  assert.match(note.reason, /Jupiter, 12:00 UTC/);
  assert.match(note.reason, /Твій поріг — падіння на 10 % за добу/);
  assert.equal(note.text.en.title, "SOL −11.2% in 24 hours");
  assert.equal(monitorNotes([note]).length, 0, "not a plan's note");
  assert.ok(MONITOR_NOTE_SUBJECT_KINDS_V1.includes("token-watch"));
  assert.equal(await resolveInboxLink(store, OWNER, note.id), `/app/ryn?watch=${watch.id}&from=monitoring`);
  const rows = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(rows.map((row) => row.channel).sort(), ["push", "telegram"]);
});

const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a22";

test("with the app closed: the monitoring cron sends the note to the person's Telegram, the button to the watch; no channel — the inbox alone", async () => {
  const store = createMemoryGuardStore();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: iso(T0) });
  const watch = watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 });
  await writeWatch(store, watch, null);
  await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0));
  const sent = [];
  const telegram = { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => (sent.push({ chatId, text, keyboard }), true) };
  /* The pass's own deliveries are held 90 s from the monitoring cron: none at once, then the cron's. */
  await deliverOutbox(store, T0 + MIN, { telegram });
  assert.equal(sent.length, 0, "held for the pass that wrote it");
  await deliverOutbox(store, T0 + 2 * MIN, { telegram });
  await deliverOutbox(store, T0 + 3 * MIN, { telegram });
  assert.equal(sent.length, 1, "one message, however often the cron runs");
  assert.equal(sent[0].chatId, 700000001);
  assert.match(sent[0].text, /^Ryntra\nSOL нижче \$170,00\nЦіна \$160,00 \(Jupiter, 12:00 UTC\)/);
  assert.equal(sent[0].keyboard[0][0].text, "Керувати стеженням");
  assert.equal(sent[0].keyboard[0][0].url, `https://ryntra.io/app/ryn?watch=${watch.id}`);
  const row = (await outboxOf(store).valuesWithPrefix("")).find((item) => item.channel === "telegram");
  assert.equal(row.state, "sent");

  const lonely = createMemoryGuardStore();
  await writeWatch(lonely, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  await runWatchPass(passDeps(lonely, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0));
  const none = [];
  await deliverOutbox(lonely, T0 + 2 * MIN, { telegram: { accountByWallet: async () => null, send: async (...args) => (none.push(args), true) } });
  assert.equal(none.length, 0);
  assert.equal((await outboxOf(lonely).valuesWithPrefix("")).find((item) => item.channel === "telegram").state, "skipped_no_destination");
  assert.equal((await listInbox(lonely, OWNER)).length, 1, "the inbox has it");
});

test("at most 20 deliveries an hour per person; past that the inbox alone", async () => {
  const store = createMemoryGuardStore();
  const mints = {};
  const owners = [];
  for (let n = 0; n < 25; n += 1) {
    const mint = wallet(1_000 + n);
    mints[mint] = { symbol: `T${n}`, price: 1, h24: -20 };
    owners.push(mint);
    await writeWatch(store, watchRecord(OWNER, mint, { kind: "move", window: "h24", direction: "down", pct: 10 }, { symbol: `T${n}` }), null);
  }
  const run = await runWatchPass(passDeps(store, fakeMarket(mints), () => T0));
  assert.equal(run.fired, 25);
  assert.equal(run.delivered, DELIVERIES_PER_HOUR);
  assert.equal(run.capped, 5);
  assert.equal((await listInbox(store, OWNER)).length, 25, "every note is in the inbox");
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, DELIVERIES_PER_HOUR * 2);
});

test("the pass sends its own alerts at once — not five minutes later — and the monitoring cron never sends them twice", async () => {
  const store = createMemoryGuardStore();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: iso(T0) });
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "move", window: "m5", direction: "down", pct: 2 }), null);
  const sent = [];
  const telegram = { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => (sent.push({ chatId, text, keyboard }), true) };
  const seen = [];
  const deps = { ...passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160, m5: -2.6 } }), () => T0), deliver: async (ids, atMs) => (seen.push([...ids]), deliverOutbox(store, atMs, { telegram })) };
  await runWatchPass(deps);
  assert.equal(sent.length, 1, "sent within the pass");
  assert.match(sent[0].text, /SOL −2,6 % за 5 хв/);
  assert.equal(seen[0].length, 2, "its two rows, Telegram and push");
  for (const at of [T0 + MIN, T0 + 3 * MIN, T0 + 6 * MIN]) await deliverOutbox(store, at, { telegram });
  assert.equal(sent.length, 1, "the monitoring cron finds it sent");
});

test("a pass cut short between the note and its deliveries finishes them on its retry, and takes the hour's count once", async () => {
  const store = createMemoryGuardStore();
  const watch = watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 });
  await writeWatch(store, watch, null);
  await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0));
  /* The crash: the deliveries and the watch's state were never written. */
  for (const row of await outboxOf(store).valuesWithPrefix("")) await outboxOf(store).delete(row.id);
  const after = await readWatch(store, OWNER, watch.id);
  await writeWatch(store, { ...after, version: after.version + 1, state: watch.state, last: null, fired: 0 }, after.version);
  const run = await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0 + MIN));
  assert.equal(run.fired, 0, "no second note");
  assert.deepEqual((await outboxOf(store).valuesWithPrefix("")).map((row) => row.channel).sort(), ["push", "telegram"], "the deliveries are back");
  const rate = await store.versioned("assistantWatches").valuesWithPrefix("rate:");
  assert.equal(rate[0].count, 1, "the hour's count taken once");
});

test("quiet hours: the note is written to the inbox, nothing is queued — no night of alerts at 08:00", async () => {
  const store = createMemoryGuardStore();
  await preferencesOf(store).compareAndSet(`solana:mainnet:${OWNER}`, null, { version: 1, owner: OWNER, inbox: true, telegram: true, push: false, quietHours: { start: "23:00", end: "08:00", timezone: "Europe/Kyiv" }, updatedAt: iso(T0) });
  const night = Date.parse("2026-10-20T22:30:00.000Z"); /* 01:30 in Kyiv */
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  const run = await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => night));
  assert.equal(run.quiet, 1);
  assert.equal((await listInbox(store, OWNER)).length, 1);
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 0);
  /* Morning: a new crossing is sent again. */
  const morning = Date.parse("2026-10-21T06:30:00.000Z");
  const day = await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 180 } }), () => morning));
  assert.equal(day.fired, 0);
  const again = await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 165 } }), () => morning + 2 * 3_600_000));
  assert.equal(again.delivered, 1);
});

test("two passes at once send a crossing once — each sends only the rows it wrote", async () => {
  const store = createMemoryGuardStore();
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: iso(T0) });
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  const sent = [];
  const telegram = { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => (sent.push({ chatId, text, keyboard }), true) };
  /* The real narrowing: each pass's delivery sees only the identities it hands over. */
  const narrowed = (ids) => ({ ...store, collection: (name) => { const inner = store.collection(name); return name === "monitoringOutbox" ? { ...inner, valuesWithPrefix: async (prefix) => (await inner.valuesWithPrefix(prefix)).filter((row) => ids.has(row.id)) } : inner; } });
  const deps = () => ({ ...passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0), deliver: (ids, atMs) => deliverOutbox(narrowed(ids), atMs, { telegram }) });
  /* Telegram and push both on: two passes may split a crossing's two rows between them — each sends only its own. */
  for (let round = 0; round < 5; round += 1) await Promise.all([runWatchPass(deps()), runWatchPass(deps())]);
  for (const at of [T0 + 2 * MIN, T0 + 5 * MIN]) await deliverOutbox(store, at, { telegram });
  assert.equal(sent.length, 1, "one Telegram message for one crossing");
  assert.equal((await listInbox(store, OWNER)).length, 1);
  const rows = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(rows.map((row) => row.channel).sort(), ["push", "telegram"]);
  assert.ok(rows.every((row) => row.attempts <= 1), "each row tried once");
  const runtime = readFileSync(new URL("./watch/runtime.server.ts", import.meta.url), "utf8");
  assert.match(runtime, /rows\.has\(\(row as \{ id\?: string \}\)\.id/, "production narrows by the row's id, not the crossing");
});

test("a price level needs Jupiter's price: a token it does not price is refused a level, offered a move", async () => {
  const store = createMemoryGuardStore();
  const refused = await createWatch(store, OWNER, AssistantWatchCreateSchema.parse({ mint: BONK, rule: { kind: "price", direction: "below", level: 0.00001 }, locale: "uk" }), T0, async () => ({ symbol: "BONK", suspicious: false, priceUsd: null, priced: false }));
  assert.equal(refused.code, "PRICE_UNAVAILABLE");
  const move = await createWatch(store, OWNER, AssistantWatchCreateSchema.parse({ mint: BONK, preset: "drop24h", locale: "uk" }), T0, async () => ({ symbol: "BONK", suspicious: false, priceUsd: null, priced: false }));
  assert.equal(move.ok, true);
});

test("a price level is judged on Jupiter's price alone: Jupiter down, DexScreener up — not read", async () => {
  const store = createMemoryGuardStore();
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } });
  market.down.jupiter = true;
  const run = await runWatchPass(passDeps(store, market, () => T0));
  assert.equal(run.fired, 0);
  assert.equal((await readWatchSurface(store, OWNER, T0, "uk", 2)).watches[0].now.state, "unread");
});

test("a paused watch is not judged; the person's channels off — the inbox alone; a source down — not read, no note", async () => {
  const store = createMemoryGuardStore();
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }, { status: "paused" }), null);
  await writeWatch(store, watchRecord(OTHER, SOL, { kind: "price", direction: "below", level: 170 }, { channels: { telegram: false, push: false } }), null);
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } });
  const run = await runWatchPass(passDeps(store, market, () => T0));
  assert.equal(run.fired, 1);
  assert.equal((await listInbox(store, OWNER)).length, 0);
  assert.equal((await listInbox(store, OTHER)).length, 1);
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 0);
  const third = createMemoryGuardStore();
  await writeWatch(third, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  const down = fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } });
  down.down.jupiter = true;
  down.down.dex = true;
  const quiet = await runWatchPass(passDeps(third, down, () => T0));
  assert.equal(quiet.fired, 0, "no answer is no crossing");
});

/* ---------------------------------------------------------------- the person's side */

test("three watches free: start from a preset, a fourth refused, an unknown mint refused, the same rule twice refused", async () => {
  const store = createMemoryGuardStore();
  const input = (over) => AssistantWatchCreateSchema.parse({ mint: SOL, preset: "drop24h", locale: "uk", ...over });
  assert.equal((await createWatch(store, OWNER, input({}), T0, lookup())).ok, true);
  const twice = await createWatch(store, OWNER, input({}), T0, lookup());
  assert.equal(twice.ok, false);
  assert.equal(twice.code, "VALIDATION_ERROR");
  assert.equal((await createWatch(store, OWNER, input({ preset: "below" }), T0, lookup({ [SOL]: 182.37 }))).watch.rule.level, 173.3);
  assert.equal((await createWatch(store, OWNER, input({ mint: JUP }), T0, lookup())).ok, true);
  const fourth = await createWatch(store, OWNER, input({ mint: JUP, preset: "volume3x" }), T0, lookup());
  assert.equal(fourth.code, "WATCH_LIMIT_REACHED");
  const unknown = await createWatch(createMemoryGuardStore(), OWNER, input({ mint: BONK }), T0, lookup());
  assert.equal(unknown.code, "ASSET_UNCONFIRMED");
  const flagged = await createWatch(createMemoryGuardStore(), OWNER, input({ mint: BONK }), T0, async () => ({ symbol: "BONK", suspicious: true, priceUsd: 0.00002 }));
  assert.equal(flagged.code, "ASSET_UNCONFIRMED", "a token Jupiter marks suspicious is not watched");
  const nameless = await createWatch(createMemoryGuardStore(), OWNER, input({ mint: BONK }), T0, async () => ({ symbol: "?", suspicious: false, priceUsd: 0.00002 }));
  assert.equal(nameless.watch.symbol, "DezX");
  assert.throws(() => AssistantWatchCreateSchema.parse({ mint: SOL }), "a preset or a rule");
  const surface = AssistantWatchesResponseSchema.parse(await readWatchSurface(store, OWNER, T0, "uk", 2));
  assert.deepEqual(surface.limit, { free: FREE_WATCHES, used: 3, left: 0 });
  assert.equal(surface.explainPriceCredits, 2);
  assert.equal(surface.presets.length, WATCH_PRESETS.length);
});

test("Пауза, Змінити, Вимкнути: pause stops the judging, a changed rule starts afresh, a stale version is refused", async () => {
  const store = createMemoryGuardStore();
  const made = await createWatch(store, OWNER, AssistantWatchCreateSchema.parse({ mint: SOL, rule: { kind: "price", direction: "below", level: 170 }, locale: "uk" }), T0, lookup());
  const id = made.watch.id;
  const market = fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } });
  await runWatchPass(passDeps(store, market, () => T0));
  assert.equal((await listInbox(store, OWNER)).length, 1);
  /* Right after the alert the pass raised the version: a pause needs none to be honoured. */
  assert.ok((await readWatch(store, OWNER, id)).version > made.watch.version);
  const paused = await updateWatch(store, OWNER, id, { status: "paused" }, T0 + MIN);
  assert.equal(paused.watch.status, "paused");
  const same = await updateWatch(store, OWNER, id, {}, T0 + MIN);
  assert.equal(same.watch.version, paused.watch.version, "an empty change writes nothing");
  const stale = await updateWatch(store, OWNER, id, { ifVersion: 1, status: "active" }, T0 + MIN);
  assert.equal(stale.code, "WATCH_VERSION_CONFLICT");
  const changed = await updateWatch(store, OWNER, id, { rule: { kind: "price", direction: "below", level: 165 }, status: "active" }, T0 + 2 * MIN);
  assert.equal(changed.watch.state.armed, true);
  assert.equal(changed.watch.last, null);
  await runWatchPass(passDeps(store, market, () => T0 + 3 * MIN));
  assert.equal((await listInbox(store, OWNER)).length, 2, "the changed rule is a new crossing");
  const view = (await readWatchSurface(store, OWNER, T0 + 3 * MIN, "uk", 2)).watches[0];
  assert.equal(view.now.state, "rang");
  assert.equal(view.ruleText, "Ціна нижче $165,00");
  assert.match(view.explain.question, /^Поясни сповіщення: SOL нижче \$165,00/);
  assert.equal(view.explain.priceCredits, 2);
  assert.equal((await removeWatch(store, OWNER, id)).ok, true);
  assert.equal((await removeWatch(store, OWNER, id)).code, "WATCH_NOT_FOUND");
  assert.equal((await updateWatch(store, OTHER, id, { status: "paused" }, T0)).code, "WATCH_NOT_FOUND", "another wallet's watch is not found");
  assert.equal((await listInbox(store, OWNER)).length, 2, "its notes stay in the inbox");
  await runWatchPass(passDeps(store, market, () => T0 + 4 * MIN));
  assert.equal(await readMarket(store, SOL), null, "a token nobody watches keeps no history");
});

/* ---------------------------------------------------------------- credits and boundaries */

test("credits: a watch and its notes cost nothing and touch no ledger; «Чому?» shows the price a question is charged", async () => {
  /* «Чому?» is asked as a question in the conversation (`action: "question"`): the button shows that price, the one charged. */
  assert.equal(DEFAULT_CREDIT_PRICES.question, 2);
  assert.equal(priceOf(resolveCreditsConfig({ RYNTRA_ASSISTANT_CREDIT_PRICES: '{"question":3}' }), "question"), 3);
  const runtime = readFileSync(new URL("./watch/runtime.server.ts", import.meta.url), "utf8");
  assert.match(runtime, /return priceOf\(resolveCreditsConfig\(\), "question"\);/);
  const store = createMemoryGuardStore();
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  await runWatchPass(passDeps(store, fakeMarket({ [SOL]: { symbol: "SOL", price: 160 } }), () => T0));
  assert.equal((await store.collection("assistantCredits").valuesWithPrefix("")).length, 0, "no credit entry, no hold");
});

test("nothing that trades, signs, spends or calls a model: the watch files import only readers, the store and the inbox", () => {
  const dir = new URL("./watch/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), "utf8");
    const modules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).join("\n");
    assert.doesNotMatch(modules, /sign|submit|transaction|keypair|secret|swap|order|agent\/model|openai|credits\/ledger|wallet|limits|launch|pay\//i, `${file} imports only readers, the store and the inbox: ${modules}`);
    assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/, `${file} writes to no outside service`);
  }
});

test("the words: a fact, a number, a source and a time — no advice and no «Ryn»", () => {
  const figure = { value: 160.42, beside: null, source: "Jupiter", observedAt: "2026-10-20T14:05:09.000Z" };
  for (const locale of ["uk", "en"]) {
    for (const rule of [
      { kind: "price", direction: "below", level: 170 },
      { kind: "move", window: "m5", direction: "any", pct: 3 },
      { kind: "volume", factor: 3 },
      { kind: "liquidity", window: "h24", direction: "drop", pct: 30, pool: null },
    ]) {
      const words = noteWords(rule, "SOL", { ...figure, value: rule.kind === "volume" ? 4.2 : rule.kind === "price" ? 160.42 : -31.5, beside: rule.kind === "price" ? null : 40_000 }, locale);
      const all = `${words.title} ${words.reason}`;
      assert.match(all, /14:05 UTC/);
      assert.doesNotMatch(all, /\b(buy|sell|купи|продай|продавай|купуй)\b/i);
      assert.doesNotMatch(all, /\bRyn\b/);
      assert.ok(words.reason.length <= 200, `two lines on a phone: ${words.reason.length}`);
    }
  }
});

test("on its own: the watch's surface reads another wallet's watches as none", async () => {
  const store = createMemoryGuardStore();
  await writeWatch(store, watchRecord(OWNER, SOL, { kind: "price", direction: "below", level: 170 }), null);
  assert.equal((await listWatches(store, OTHER)).length, 0);
  assert.equal((await readWatchSurface(store, OTHER, T0, "en", 2)).watches.length, 0);
  assert.equal(watchInboxId("token-watch:a:b"), watchInboxId("token-watch:a:b"));
});
