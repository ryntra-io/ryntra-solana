import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf, SOL_COIN } from "../command/parse.ts";
import { orderView, review, scriptedLimits } from "../trade/limit-fixtures.mjs";
import { oneSentenceOpen } from "./flag.ts";
import { answer, linePrice, modeOf, planOf, priceText, scheduleOf, toRaw } from "./plan.ts";
import { readInstruction } from "./read.ts";
import { entriesKey, liveOf, NO_READS, parseEntries, setInstructEnv, useInstruct } from "./store.ts";

/* CITY-176: the agent's card hands each instruction to the engine that already does it — and only the person signs. */

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const ORDER = "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S";
const STOP_ID = "stp_0123456789abcdef0123456789abcdef";
const RULE_ID = "rule_0123456789abcdef";

const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol === "JUP" ? "Jupiter" : symbol, icon: null, mcap, liquidity: 1e6, verified: true });
const BOOK = bookOf([tower(JUP_MINT, "JUP", 1e9), tower(BONK_MINT, "BONK", 2e9)]);
const read = (text) => readInstruction(text, BOOK);
// 1 November 2026, 14:20 in Kyiv (12:20 UTC): a Sunday.
const NOW = Date.parse("2026-11-01T12:20:00.000Z");
const ENV = { now: NOW, timeZone: "Europe/Kyiv", locale: "uk" };
const FACTS = (changes = {}) => ({ price: 0.8, decimals: 6, holdingRaw: null, feeBps: 50, ...changes });

test("the switch: shut unless it says «open»", () => {
  assert.equal(oneSentenceOpen(undefined), false);
  assert.equal(oneSentenceOpen("closed"), false);
  assert.equal(oneSentenceOpen("true"), false);
  assert.equal(oneSentenceOpen("open"), true);
});

test("a regular purchase is one rule of the rules engine: dollars, the schedule on the person's clock, the first within the hour", () => {
  const planned = planOf(read("купуй SOL на $20 щотижня"), FACTS(), ENV);
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.body, {
    asset: { mint: SOL_COIN.mint },
    amountUsd: 20,
    kind: "schedule",
    schedule: { cadence: "weekly", weekday: 7, monthDay: null, time: "15:00", timeZone: "Europe/Kyiv" },
    locale: "uk",
  });
  assert.equal(new Date(planned.plan.firstAt).toISOString(), "2026-11-01T13:00:00.000Z", "today at 15:00 in Kyiv");
  // A weekday and a time said are kept; a month is counted from today's date.
  assert.deepEqual(scheduleOf("weekly", { weekday: 1, time: "09:30" }, NOW, "Europe/Kyiv"), { cadence: "weekly", weekday: 1, monthDay: null, time: "09:30", timeZone: "Europe/Kyiv" });
  assert.deepEqual(scheduleOf("monthly", { weekday: null, time: null }, NOW, "Europe/Kyiv"), { cadence: "monthly", weekday: null, monthDay: 1, time: "15:00", timeZone: "Europe/Kyiv" });
  // Late in the evening the next hour is tomorrow: the day follows it.
  assert.deepEqual(scheduleOf("weekly", { weekday: null, time: null }, Date.parse("2026-11-01T21:40:00.000Z"), "Europe/Kyiv").weekday, 1);
  assert.deepEqual(planOf(read("купуй SOL на 0.5 щотижня"), FACTS(), ENV), { ok: false, problem: "MIN" });
});

test("a limit: the price said or the move from the price now, dollars on a buy — the venue's $5 least", () => {
  const buy = planOf(read("купи JUP на $50, якщо впаде до 0,7"), FACTS(), ENV);
  assert.deepEqual(buy, { ok: true, plan: { kind: "limit", side: "buy", coin: BOOK.coins.find((c) => c.mint === JUP_MINT), price: "0.7", amount: "50", usd: 50 } });
  const dip = planOf(read("buy BONK for $20 if it dips 10%"), FACTS({ price: 0.00002 }), ENV);
  assert.equal(dip.plan.price, "0.000018");
  assert.deepEqual(planOf(read("buy BONK for $4 if it dips 10%"), FACTS({ price: 0.00002 }), ENV), { ok: false, problem: "MIN" });
  // A move needs the price now; the price said does not.
  assert.deepEqual(planOf(read("buy BONK for $20 if it dips 10%"), FACTS({ price: null }), ENV), { ok: false, problem: "PRICE" });
  // A buy limit over the price now would fill at once: said, never placed.
  assert.deepEqual(planOf(read("купи JUP на $50, якщо впаде до 0,9"), FACTS(), ENV), { ok: false, problem: "PASSED" });
});

test("a stop: a share of what the wallet holds, the engine's own body, never a share without the wallet", () => {
  const instruction = read("продай половину BONK, якщо впаде на 10 %");
  assert.deepEqual(planOf(instruction, FACTS({ price: 0.00002, decimals: 5 }), ENV), { ok: false, problem: "WALLET" });
  assert.deepEqual(planOf(instruction, FACTS({ price: 0.00002, decimals: 5, holdingRaw: "0" }), ENV), { ok: false, problem: "EMPTY" });
  const planned = planOf(instruction, FACTS({ price: 0.00002, decimals: 5, holdingRaw: "100000000001" }), ENV);
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.body, {
    side: "sell",
    base: { mint: BONK_MINT, symbol: "BONK", decimals: 5, name: "BONK" },
    quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
    amountRaw: "50000000000",
    price: "0.000018",
    expiry: "never",
    locale: "uk",
  });
  // A count of the coin over what is held is said, never trimmed into what is there.
  assert.deepEqual(planOf(read("sell 100 JUP if it falls below 0.6"), FACTS({ holdingRaw: "50000000" }), ENV), { ok: false, problem: "TOO_MUCH" });
  // A stop already reached is a sale now, not a stop.
  assert.deepEqual(planOf(read("stop loss on all my JUP at 0.9"), FACTS({ holdingRaw: "50000000" }), ENV), { ok: false, problem: "PASSED" });
});

test("said without a direction, the price now decides: a sale over it is a limit, under it a stop", () => {
  const hits = read("sell all JUP when it hits 1.2");
  assert.equal(modeOf(hits, 0.8), "limit");
  assert.equal(modeOf(hits, 1.5), "stop");
  assert.equal(modeOf(hits, null), null);
  assert.equal(linePrice(read("stop on JUP at -10%"), 0.8), "0.72");
  assert.equal(linePrice(read("sell half my JUP when it rises 20%"), 0.8), "0.96");
});

test("taps answer exactly what was missing", () => {
  assert.equal(answer(read("купуй SOL щотижня"), { field: "size", usd: "20" }).usd, "20");
  assert.equal(answer(read("купуй SOL регулярно на $20"), { field: "cadence", cadence: "daily" }).cadence, "daily");
  assert.deepEqual(answer(read("стоп на JUP"), { field: "trigger", pct: 10 }).trigger, { kind: "move", pct: 10 });
  assert.equal(answer(read("стоп на JUP по 0,8"), { field: "size", share: 50 }).share, 50);
  assert.deepEqual(answer(read("купи JUP якщо впаде до 0.7 або 0.6"), { field: "trigger", price: "0.6" }).trigger, { kind: "price", price: "0.6" });
});

test("numbers as the engines take them: plain decimals, never an exponent, never rounded into the coin", () => {
  assert.equal(priceText(0.0000182), "0.0000182");
  assert.equal(priceText(123.4567891), "123.457");
  assert.equal(priceText(0), null);
  assert.equal(toRaw("1.5", 6), "1500000");
  assert.equal(toRaw("1.1234567", 6), null);
  assert.equal(toRaw("0", 6), null);
});

/* The store on fixtures: the engines answer from a script, the wallet and the proof are spies. */

const quoteBody = (outAmountRaw, decimals) => ({ order: { outAmountRaw }, decimals, outputFee: { basisPoints: 50, feeRaw: "0", capApplied: false } });

function harness({ limits = {}, holdings = null, proof = { ok: true } } = {}) {
  const store = new Map();
  const signed = [];
  const proved = [];
  const stopCalls = [];
  const ruleCalls = [];
  const quotes = [];
  const scripted = scriptedLimits({
    market: [{ status: 200, body: { price: 0.8, baseUsd: 0.8, quoteUsd: 1 } }],
    review: [{ status: 200, body: { review: review({ pair: { baseMint: JUP_MINT, baseDecimals: 6, quoteMint: USDC_MINT, quoteDecimals: 6 }, outputMint: JUP_MINT, price: "0.7", makingRaw: "50000000", takingRaw: "71428571" }) } }],
    submit: [{ status: 200, body: { state: "OPEN", signature: "sigPlace", settled: true } }],
    orders: [{ status: 200, body: { orders: [orderView({ baseMint: JUP_MINT, outputMint: JUP_MINT })], tokens: {}, complete: true } }],
    cancel: [{ status: 200, body: { transactionBase64: "CANCEL", requestId: null, signableMs: 25_000 } }],
    ...limits,
  });
  const connection = { wallet: "Phantom", address: OWNER };
  const wallet = { connection, holdings, refreshHoldings: () => {} };
  setInstructEnv({
    open: true,
    stopsEngine: true,
    limits: scripted.api,
    engine: {
      quote: async (input) => {
        quotes.push(input);
        return { ok: true, status: 200, value: quoteBody(input.outputMint === WSOL ? "100000000" : "25000000", { [input.outputMint]: input.outputMint === WSOL ? 9 : 6, [USDC_MINT]: 6 }) };
      },
    },
    stops: {
      list: async () => ({ ok: true, value: [{ id: STOP_ID, side: "sell", base: { mint: JUP_MINT, symbol: "JUP", decimals: 6, name: "Jupiter" }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "1", price: "0.7", thresholdRaw: "1", createdAt: NOW, expiresAt: null, state: "watching", reachedAt: null }] }),
      create: async (body) => {
        stopCalls.push(["create", body]);
        return { ok: true, value: { id: STOP_ID, state: "watching" } };
      },
      cancel: async (id) => {
        stopCalls.push(["cancel", id]);
        return { ok: true, value: { id, state: "cancelled" } };
      },
      finish: async () => ({ ok: false, failure: { code: "NO", status: 400 } }),
    },
    rules: {
      list: async () => ({ ok: true, value: [{ id: RULE_ID, status: "active", amountUsd: 20, asset: { mint: WSOL }, schedule: null, nextDueAt: "2026-11-01T13:00:00.000Z", occurrences: [] }] }),
      create: async (body) => {
        ruleCalls.push(["create", body]);
        return { ok: true, value: { id: RULE_ID, status: "active", amountUsd: body.amountUsd, asset: body.asset, schedule: body.schedule, nextDueAt: "2026-11-01T13:00:00.000Z", occurrences: [] } };
      },
      remove: async (id) => {
        ruleCalls.push(["remove", id]);
        return { ok: true, value: true };
      },
    },
    sign: async (_connection, wire) => {
      signed.push(wire);
      return { ok: true, signedWireBase64: `signed:${wire}` };
    },
    prove: async (c) => {
      proved.push(c.address);
      return proof;
    },
    wallet: () => wallet,
    storage: { read: (key) => store.get(key) ?? null, write: (key, value) => store.set(key, value) },
    now: () => NOW,
    locale: () => "en",
    timeZone: () => "Europe/Kyiv",
    id: (() => {
      let n = 0;
      return () => `local-${(n += 1)}`;
    })(),
  });
  useInstruct.setState({ open: false, instruction: null, facts: null, review: null, phase: "idle", notice: null, done: null, listOpen: false, owner: null, entries: [], reads: NO_READS, cancelling: null });
  return { store, signed, proved, stopCalls, ruleCalls, quotes, calls: scripted.calls, wallet };
}

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("a limit from one sentence: the engine's order is on the card before the wallet opens, and the wallet signs it once", async () => {
  const h = harness();
  useInstruct.getState().show(read("купи JUP на $50, якщо впаде до 0,7"));
  await flush();
  assert.deepEqual(h.calls.map((c) => c.route), ["market", "review"], "the price, then the exact order — nothing sent");
  assert.deepEqual(h.calls[1].body, { owner: OWNER, venue: "trigger", side: "buy", baseMint: JUP_MINT, quoteMint: USDC_MINT, amount: "50", price: "0.7", quoteUsd: 1 });
  assert.equal(h.signed.length, 0, "showing the card asks the wallet nothing");
  assert.equal(useInstruct.getState().review.review.fee.ryntraBps, 100, "the fee on the card is the engine's");
  await useInstruct.getState().sign();
  assert.deepEqual(h.signed, ["AQID"], "the wallet signed the bytes the card showed, once");
  assert.deepEqual(h.calls.map((c) => c.route), ["market", "review", "submit", "orders"], "placed once, then «My instructions» reads it");
  assert.equal(useInstruct.getState().phase, "done");
  const kept = parseEntries(h.store.get(entriesKey(OWNER)), OWNER);
  assert.equal(kept.length, 1);
  assert.deepEqual([kept[0].kind, kept[0].ref, kept[0].said], ["limit", { kind: "limit", venue: "trigger", order: ORDER }, "купи JUP на $50, якщо впаде до 0,7"]);
});

test("a stop and a regular purchase: one signed message proves the wallet, the engine keeps them — no transaction is signed", async () => {
  const h = harness({ holdings: { owner: OWNER, sol: { spendableRaw: "2000000000", decimals: 9 }, tokens: new Map([[BONK_MINT, { spendableRaw: "100000000000", decimals: 5 }]]), complete: true, at: NOW } });
  useInstruct.getState().show(read("продай половину BONK, якщо впаде на 10 %"));
  await flush();
  assert.equal(h.calls.filter((c) => c.route === "review").length, 0, "a stop asks for no order");
  await useInstruct.getState().sign();
  assert.deepEqual(h.proved, [OWNER]);
  assert.equal(h.stopCalls[0][0], "create");
  assert.equal(h.stopCalls[0][1].amountRaw, "50000000000");
  assert.equal(h.stopCalls[0][1].price, "0.72");
  assert.equal(h.signed.length, 0);

  useInstruct.getState().close();
  useInstruct.getState().show(read("купуй SOL на $20 щотижня"));
  await flush();
  await useInstruct.getState().sign();
  assert.deepEqual(h.ruleCalls[0], ["create", { asset: { mint: WSOL }, amountUsd: 20, kind: "schedule", schedule: { cadence: "weekly", weekday: 7, monthDay: null, time: "15:00", timeZone: "Europe/Kyiv" }, locale: "en" }]);
  assert.equal(h.signed.length, 0, "a rule is a reminder: each purchase is signed when it comes");
  assert.deepEqual(parseEntries(h.store.get(entriesKey(OWNER)), OWNER).map((e) => e.kind), ["recurring", "stop"]);
});

test("nothing is set without the person: a declined proof sets nothing, a card with something missing cannot be signed", async () => {
  const h = harness({ proof: { ok: false, state: "declined", message: "no" } });
  useInstruct.getState().show(read("купуй SOL на $20 щотижня"));
  await flush();
  await useInstruct.getState().sign();
  assert.equal(h.ruleCalls.length, 0);
  assert.equal(useInstruct.getState().phase, "idle");
  assert.equal(useInstruct.getState().notice.text, "Nothing signed");

  useInstruct.getState().close();
  useInstruct.getState().show(read("купуй SOL щотижня"));
  await flush();
  await useInstruct.getState().sign();
  assert.equal(h.ruleCalls.length, 0, "how much is the person's tap, never a default");
  useInstruct.getState().choose({ field: "size", usd: "10" });
  await flush();
  await useInstruct.getState().sign();
  assert.equal(h.ruleCalls.length, 0, "the proof was declined again: still nothing");
  assert.equal(h.proved.length, 2);
});

test("the switch shut: no card opens and no engine is asked", async () => {
  const h = harness();
  setInstructEnv({ open: false });
  useInstruct.getState().show(read("купуй SOL на $20 щотижня"));
  await flush();
  assert.equal(useInstruct.getState().open, false);
  assert.equal(h.calls.length + h.quotes.length, 0);
  setInstructEnv({ open: true });
});

test("«My instructions»: each one's state from its engine, and «Cancel» in one tap through that engine", async () => {
  const h = harness();
  const entries = [
    { id: "a", owner: OWNER, kind: "limit", said: "купи JUP якщо впаде до 0,7", side: "buy", coin: { mint: JUP_MINT, symbol: "JUP", name: "Jupiter", icon: null }, amount: "50", price: "0.7", cadence: null, ref: { kind: "limit", venue: "trigger", order: ORDER }, createdAt: NOW },
    { id: "b", owner: OWNER, kind: "stop", said: "стоп на JUP по 0,7", side: "sell", coin: { mint: JUP_MINT, symbol: "JUP", name: "Jupiter", icon: null }, amount: "10", price: "0.7", cadence: null, ref: { kind: "stop", id: STOP_ID }, createdAt: NOW },
    { id: "c", owner: OWNER, kind: "recurring", said: "купуй SOL на $20 щотижня", side: "buy", coin: { mint: WSOL, symbol: "SOL", name: "Solana", icon: null }, amount: "20", price: null, cadence: "weekly", ref: { kind: "rule", id: RULE_ID }, createdAt: NOW },
  ];
  h.store.set(entriesKey(OWNER), JSON.stringify(entries));
  useInstruct.getState().openList();
  await flush();
  const { reads } = useInstruct.getState();
  assert.deepEqual(entries.map((e) => liveOf(e, reads, NOW).state), ["waiting", "watching", "next"]);
  assert.equal(liveOf(entries[2], reads, NOW).at, Date.parse("2026-11-01T13:00:00.000Z"));

  await useInstruct.getState().cancel("a");
  assert.deepEqual(h.signed, ["CANCEL"], "a limit's cancellation is the wallet's own signature");
  await useInstruct.getState().cancel("c");
  assert.deepEqual(h.ruleCalls, [["remove", RULE_ID]]);
  assert.deepEqual(useInstruct.getState().entries.map((e) => e.id), ["b"]);
});

test("states read from the engines: filled, reached, due, paused, ended — and «reading» until an engine answers", () => {
  const limit = { ref: { kind: "limit", venue: "trigger", order: ORDER } };
  const stop = { ref: { kind: "stop", id: STOP_ID } };
  const rule = { ref: { kind: "rule", id: RULE_ID } };
  assert.equal(liveOf(limit, NO_READS, NOW).state, "reading");
  assert.equal(liveOf(limit, { ...NO_READS, orders: [orderView({ state: "FILLED" })] }, NOW).state, "filled");
  assert.equal(liveOf(limit, { ...NO_READS, orders: [orderView({ state: "CANCELLED" })] }, NOW).state, "ended");
  assert.equal(liveOf(stop, { ...NO_READS, stops: [{ id: STOP_ID, state: "reached", expiresAt: null }] }, NOW).state, "reached");
  assert.equal(liveOf(stop, { ...NO_READS, stops: [] }, NOW).state, "ended");
  const due = { id: RULE_ID, status: "active", nextDueAt: null, occurrences: [{ dueAt: "2026-11-01T12:00:00.000Z", openUntil: "2026-11-02T12:00:00.000Z", state: "due" }] };
  assert.equal(liveOf(rule, { ...NO_READS, rules: [due] }, NOW).state, "due");
  assert.equal(liveOf(rule, { ...NO_READS, rules: [{ ...due, status: "paused" }] }, NOW).state, "paused");
});

test("the kept list is read back strictly: another wallet's line or a broken one is left out", () => {
  const good = { id: "a", owner: OWNER, kind: "stop", said: "x", side: "sell", coin: { mint: JUP_MINT, symbol: "JUP", name: "Jupiter", icon: null }, amount: "1", price: "1", cadence: null, ref: { kind: "stop", id: STOP_ID }, createdAt: 1 };
  assert.equal(parseEntries(JSON.stringify([good]), OWNER).length, 1);
  assert.equal(parseEntries(JSON.stringify([{ ...good, owner: "x" }]), OWNER).length, 0);
  assert.equal(parseEntries(JSON.stringify([{ ...good, ref: { kind: "limit", venue: "trigger", order: "not-a-key" } }]), OWNER).length, 0);
  assert.equal(parseEntries("{broken", OWNER).length, 0);
});

test("the agent's code signs only through the engines' own flows, and the command line still signs nothing", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  // The only transactions the card hands to the wallet are the limits engine's order and its cancellation.
  assert.deepEqual([...store.matchAll(/\b(placeLimit|cancelLimit|reviewLimit)\(/g)].map((m) => m[1]).sort(), ["cancelLimit", "placeLimit", "reviewLimit"]);
  assert.doesNotMatch(store, /\b(sendTransaction|sendRawTransaction|signAllTransactions|execute)\(/);
  for (const file of ["./read.ts", "./plan.ts", "./types.ts", "./flag.ts"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(code, /fetch\(|sign\w*\(|from ['"][^'"]*(wallet|signer|app-bridge)/, `${file} is pure`);
  }
});

test("the card says it in one headline and one fee line, English and Ukrainian", async () => {
  const { INSTRUCT } = await import("./words.ts");
  const { headline, feeLine, entryHeadline } = await import("./face.ts");
  const en = INSTRUCT.en;
  const uk = INSTRUCT.uk;
  const facts = { price: 0.8, decimals: 6, holdingRaw: null, feeBps: 25 };
  assert.equal(headline(read("buy $20 of SOL every week"), facts, en), "Buy $20 of SOL every week");
  assert.equal(headline(read("купуй SOL на $20 щотижня"), facts, uk), "Купувати SOL на $20 щотижня");
  assert.equal(headline(read("купи JUP на $50, якщо впаде до 0,7"), facts, en), "Buy $50 of JUP at $0.7");
  assert.equal(headline(read("купи JUP на $50, якщо впаде до 0,7"), facts, uk), "Купити JUP на $50 по $0,7");
  assert.equal(headline(read("продай половину BONK, якщо впаде на 10 %"), facts, uk), "Продати половину BONK якщо впаде на 10 %");
  assert.equal(headline(read("sell half my BONK if it falls 10%"), facts, en), "Sell half of BONK if it falls 10%");
  assert.equal(headline(read("стоп на JUP по 0,8"), facts, uk), "Продати JUP якщо впаде до $0,8");
  assert.equal(headline(read("купи SOL на $30, якщо виросте до 200"), facts, en), "Buy $30 of SOL if it rises to $200");
  assert.equal(feeLine(read("buy $20 of SOL every week"), facts, null, en), "Fee 0.25% per buy · min $1 · you sign each buy");
  assert.equal(feeLine(read("купи JUP на $50, якщо впаде до 0,7"), facts, { ryntraBps: 100, venueBps: 0 }, uk), "Комісія 1 % · мінімум $5");
  assert.equal(feeLine(read("стоп на JUP по 0,7"), facts, null, en), "Fee 0.25% on the trade · you sign it when the price is there");
  assert.equal(feeLine(read("стоп на JUP по 0,7"), { ...facts, feeBps: null }, null, en), null, "no fee is written that the engine did not say");
  const entry = { kind: "recurring", amount: "20", coin: { symbol: "SOL" }, cadence: "weekly", side: "buy", price: null };
  assert.equal(entryHeadline(entry, en), "$20 of SOL · every week");
  assert.equal(entryHeadline({ ...entry, kind: "stop", side: "sell", amount: "920", price: "0.160521", coin: { symbol: "WIF" } }, uk), "Продати 920 WIF нижче $0,1605");
  assert.equal(entryHeadline({ ...entry, kind: "limit", side: "buy", amount: "50", price: "0.25", coin: { symbol: "JUP" } }, en), "Buy $50 of JUP at $0.25");
});
