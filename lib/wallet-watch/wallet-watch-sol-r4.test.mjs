// SOL-R4 «Стеження за гаманцями» (Smart Wallet Watch): a list of wallets, their trades and PnL from the chain, the
// creator, sniper and bundle labels; notes through the assistant's engine (lib/monitoring) — «творець продає» among
// them; no automatic trading anywhere.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MONITOR_NOTE_SUBJECT_KINDS_V1 } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, monitorNotes, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { burstNote, tradeNote } from "./notes.ts";
import { holdingsAcross, holdingsFromAccounts, refreshActivity, walletView } from "./read.ts";
import { DELIVERY_HOLD_MS, runWalletWatchPass } from "./run.ts";
import { changeFollows, claimChainRead, FOLLOW_LIMIT, readActivity, readFollows, SENT_PER_HOUR } from "./store.ts";
import { labelsOf, tradesOfTransaction, USDC_MINT, walletBadges, walletPnl, WRAPPED_SOL } from "./trades.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CREATOR = "Cr8tor1111111111111111111111111111111111111";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OWNER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const T0 = Date.parse("2026-10-21T12:00:00Z");
const S0 = T0 / 1000;
const LAMPORTS = 1_000_000_000;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A distinct valid address per number. */
const addressOf = (i, fill = "A") => `${fill.repeat(42)}${ALPHABET[Math.floor(i / 58)]}${ALPHABET[i % 58]}`;
/** Intl's spaces inside a number («1 тис.») as plain ones. */
const plain = (text) => text.replace(/[  ]/g, " ");

/** A `jsonParsed` transaction as a node gives it: the wallet's SOL and token balances before and after. */
function tx({ sig, slot, at, who = WALLET, payer = who, signer = true, sol = 0, tokens = [], fee = 5_000, err = null, extraKeys = [] }) {
  const keys = payer === who ? [{ pubkey: who, signer: true }, ...extraKeys] : [{ pubkey: payer, signer: true }, { pubkey: who, signer }, ...extraKeys];
  const walletIndex = keys.findIndex((key) => key.pubkey === who);
  const pre = keys.map(() => 10 * LAMPORTS);
  const post = [...pre];
  post[walletIndex] += Math.round(sol * LAMPORTS) - (payer === who ? fee : 0);
  if (payer !== who) post[0] -= Math.round(0.5 * LAMPORTS) + fee;
  const preTok = [];
  const postTok = [];
  tokens.forEach(([mint, before, after, decimals = 6, owner = who], index) => {
    preTok.push({ accountIndex: 10 + index, mint, owner, uiTokenAmount: { amount: String(before), decimals } });
    postTok.push({ accountIndex: 10 + index, mint, owner, uiTokenAmount: { amount: String(after), decimals } });
  });
  return { slot, blockTime: at, meta: { err, fee, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok }, transaction: { signatures: [sig], message: { accountKeys: keys } } };
}

/* ------------------------------------------------------------- trades */

test("a buy for SOL, a sale for SOL and a buy for USDC are read from the balances — any venue alike", () => {
  const buy = tradesOfTransaction(tx({ sig: "b1", slot: 100, at: S0, sol: -1.25, tokens: [[MEME, 0, 5_000_000_000]] }), WALLET);
  assert.deepEqual(buy.map((t) => [t.side, t.mint, t.tokensRaw, t.quote, t.quoteAmount]), [["buy", MEME, "5000000000", "SOL", 1.25]]);
  const sell = tradesOfTransaction(tx({ sig: "s1", slot: 101, at: S0, sol: 2, tokens: [[MEME, 5_000_000_000, 0]] }), WALLET);
  assert.deepEqual(sell.map((t) => [t.side, t.quote, t.quoteAmount]), [["sell", "SOL", 2]]);
  const usdc = tradesOfTransaction(tx({ sig: "u1", slot: 102, at: S0, sol: -0.000005, tokens: [[WIF, 0, 100_000_000], [USDC_MINT, 300_000_000, 50_000_000]] }), WALLET);
  assert.deepEqual(usdc.map((t) => [t.side, t.mint, t.quote, t.quoteAmount]), [["buy", WIF, "USDC", 250]]);
});

test("wrapped SOL counts as SOL; a refused transaction, a plain transfer and an unread one are no trade", () => {
  const routed = tradesOfTransaction(tx({ sig: "w1", slot: 1, at: S0, sol: 0, tokens: [[MEME, 0, 10], [WRAPPED_SOL, 2 * LAMPORTS, LAMPORTS, 9]] }), WALLET);
  assert.deepEqual(routed.map((t) => [t.side, t.quote, t.quoteAmount]), [["buy", "SOL", 1]]);
  assert.deepEqual(tradesOfTransaction(tx({ sig: "e1", slot: 2, at: S0, sol: -1, tokens: [[MEME, 0, 10]], err: { InstructionError: [0, 1] } }), WALLET), []);
  /* Tokens sent away with nothing back: a transfer, not a sale. */
  assert.deepEqual(tradesOfTransaction(tx({ sig: "t1", slot: 3, at: S0, sol: -0.000005, tokens: [[MEME, 10, 0]] }), WALLET), []);
  assert.deepEqual(tradesOfTransaction(null, WALLET), []);
});

test("tokens the creator paid for, sent to this wallet in the swap itself, name their payer — the bundle's mark", () => {
  const got = tradesOfTransaction(tx({ sig: "p1", slot: 50, at: S0, payer: CREATOR, signer: false, tokens: [[MEME, 0, 1_000]] }), WALLET);
  assert.deepEqual(got.map((t) => [t.side, t.paidBy, t.quote]), [["buy", CREATOR, null]]);
  /* An airdrop someone sent for nothing (the payer paid only the fee) is not a purchase. */
  const drop = tradesOfTransaction({ ...tx({ sig: "a1", slot: 51, at: S0, payer: OTHER, signer: false, tokens: [[MEME, 0, 1_000]] }), meta: { ...tx({ sig: "a1", slot: 51, at: S0, payer: OTHER, signer: false, tokens: [[MEME, 0, 1_000]] }).meta, preBalances: [10 * LAMPORTS, 10 * LAMPORTS], postBalances: [10 * LAMPORTS - 5_000, 10 * LAMPORTS] } }, WALLET);
  assert.deepEqual(drop, []);
});

/* ---------------------------------------------------------------- PnL */

test("the result is at the average cost: a sale against it, what is left at the price now, in SOL", () => {
  const trades = [
    ...tradesOfTransaction(tx({ sig: "b1", slot: 1, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000]] }), WALLET),
    ...tradesOfTransaction(tx({ sig: "b2", slot: 2, at: S0 + 10, sol: -3, tokens: [[MEME, 1_000_000, 2_000_000]] }), WALLET),
    ...tradesOfTransaction(tx({ sig: "s1", slot: 3, at: S0 + 20, sol: 3, tokens: [[MEME, 2_000_000, 1_000_000]] }), WALLET),
  ];
  /* Average cost 2 SOL a token; one sold for 3 → +1; one left, now $400 at SOL $200 = 2 SOL → 0 open. */
  const pnl = walletPnl(trades, { solUsd: 200, usd: new Map([[MEME, 400]]) });
  const row = pnl.tokens[0];
  assert.equal(row.realizedSol, 1);
  assert.equal(row.unrealizedSol, 0);
  assert.equal(row.open, 1);
  assert.equal(row.partial, false);
  assert.equal(pnl.wins, 1);
  /* Held only half of it now (half sent away): the open half and half the cost. */
  const half = walletPnl(trades, { solUsd: 200, usd: new Map([[MEME, 400]]) }, new Map(), new Map([[MEME, 0.5]]));
  assert.equal(half.tokens[0].open, 0.5);
  assert.equal(half.tokens[0].unrealizedSol, 0);
});

test("a sale with no known cost is left out and said — never a profit from a zero cost; dollars are SOL at today's price", () => {
  const sold = tradesOfTransaction(tx({ sig: "s0", slot: 9, at: S0, sol: 5, tokens: [[MEME, 1_000_000, 0]] }), WALLET);
  const pnl = walletPnl(sold, { solUsd: 200, usd: new Map() });
  assert.equal(pnl.tokens[0].realizedSol, null);
  assert.equal(pnl.partial, true);
  assert.equal(pnl.realizedSol, null);
  const dollars = tradesOfTransaction(tx({ sig: "u1", slot: 1, at: S0, sol: -0.000005, tokens: [[WIF, 0, 1_000_000], [USDC_MINT, 400_000_000, 0]] }), WALLET);
  const approx = walletPnl(dollars, { solUsd: 200, usd: new Map([[WIF, 500]]) });
  assert.equal(approx.approx, true);
  assert.equal(approx.tokens[0].costSol, 2);
  assert.equal(approx.tokens[0].unrealizedSol, 0.5);
});

/* ------------------------------------------------------------- labels */

test("creator, sniper and bundle by the launch's own rules; an unknown creation calls nobody a sniper", () => {
  const early = tradesOfTransaction(tx({ sig: "e1", slot: 500, at: S0 + 30, sol: -1, tokens: [[MEME, 0, 10]] }), WALLET);
  const births = (birth) => new Map([[MEME, birth]]);
  assert.deepEqual(labelsOf(WALLET, early, births({ creator: CREATOR, createdAt: S0, createdSlot: 400 })).get(MEME), ["sniper"]);
  assert.deepEqual(labelsOf(WALLET, early, births({ creator: CREATOR, createdAt: S0, createdSlot: 500 })).get(MEME), ["bundle"]);
  assert.equal(labelsOf(WALLET, early, births({ creator: CREATOR, createdAt: S0 - 600, createdSlot: null })).get(MEME), undefined);
  assert.equal(labelsOf(WALLET, early, births({ creator: CREATOR, createdAt: null, createdSlot: null })).get(MEME), undefined);
  assert.deepEqual(labelsOf(WALLET, early, births({ creator: WALLET, createdAt: S0, createdSlot: 500 })).get(MEME), ["creator"]);
  const paid = tradesOfTransaction(tx({ sig: "p1", slot: 900, at: S0 + 9_000, payer: CREATOR, signer: false, tokens: [[MEME, 0, 1_000]] }), WALLET);
  assert.deepEqual(labelsOf(WALLET, paid, births({ creator: CREATOR, createdAt: S0, createdSlot: 400 })).get(MEME), ["bundle"]);
  assert.deepEqual(walletBadges(new Map([[MEME, ["creator"]], [WIF, ["sniper", "bundle"]]])), { creator: 1, sniper: 1, bundle: 1 });
});

/* --------------------------------------------------------------- read */

function fakeChain(history, { holdings = new Map(), refuse = new Set(), newestOnly = false } = {}) {
  const calls = { signatures: [], transaction: [] };
  return {
    calls,
    chain: {
      async signatures(address, options) {
        calls.signatures.push({ address, ...options });
        const list = (history.get(address) ?? []).slice().sort((a, b) => b.slot - a.slot);
        let rows = list;
        if (options.until) rows = rows.slice(0, Math.max(0, rows.findIndex((row) => row.sig === options.until)));
        if (options.before) rows = rows.slice(rows.findIndex((row) => row.sig === options.before) + 1);
        return { rows: rows.slice(0, options.limit).map((row) => ({ signature: row.sig, slot: row.slot, blockTime: row.at, failed: Boolean(row.err) })), whole: !newestOnly };
      },
      async transaction(signature) {
        calls.transaction.push(signature);
        if (refuse.has(signature)) return null;
        for (const list of history.values()) {
          const found = list.find((row) => row.sig === signature);
          if (found) return tx(found);
        }
        return null;
      },
      async holdings() {
        return holdings;
      },
    },
  };
}

const facts = (map) => async (mints) => new Map(mints.filter((mint) => map.has(mint)).map((mint) => [mint, map.get(mint)]));
const MEME_FACTS = { symbol: "3FEN", name: "Three Fen", icon: null, priceUsd: 0.0004, creator: CREATOR, createdAt: S0 - 86_400 };
const SOL_FACTS = { symbol: "SOL", name: "Solana", icon: null, priceUsd: 200, creator: null, createdAt: null };

test("a wallet is read once for all: the next read asks only for what came after, and a refused transaction is asked again", async () => {
  const store = createMemoryGuardStore();
  const history = new Map([[WALLET, [{ sig: "b1", slot: 10, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000]] }, { sig: "b2", slot: 11, at: S0 + 5, sol: -1, tokens: [[MEME, 1_000_000, 2_000_000]] }]]]);
  const { chain, calls } = fakeChain(history, { refuse: new Set(["b2"]) });
  const first = await refreshActivity(store, chain, WALLET, { nowMs: T0, freshMs: 30_000, maxNew: 40 });
  assert.equal(first.trades.length, 1);
  assert.deepEqual(first.pending, ["b2"]);
  assert.equal(first.complete, false, "a list with a transaction unread is not the whole history");
  /* Fresh: served from the record, the chain not asked. */
  await refreshActivity(store, chain, WALLET, { nowMs: T0 + 1_000, freshMs: 30_000, maxNew: 40 });
  assert.equal(calls.signatures.length, 1);
  history.get(WALLET).push({ sig: "s1", slot: 12, at: S0 + 60, sol: 3, tokens: [[MEME, 2_000_000, 0]] });
  const { chain: next, calls: nextCalls } = fakeChain(history);
  const second = await refreshActivity(store, next, WALLET, { nowMs: T0 + 60_000, freshMs: 30_000, maxNew: 40 });
  assert.equal(nextCalls.signatures[0].until, "b2");
  assert.deepEqual(nextCalls.transaction.sort(), ["b2", "s1"]);
  assert.deepEqual(second.trades.map((t) => t.signature), ["s1", "b2", "b1"]);
  assert.deepEqual(second.pending, []);
  assert.equal((await readActivity(store, WALLET)).version, 2);
});

test("the first read is the last transactions; a burst between reads is cut to the newest and the rest counted, not hidden", async () => {
  const store = createMemoryGuardStore();
  const history = new Map([[WALLET, Array.from({ length: 30 }, (_, i) => ({ sig: `m${i}`, slot: 100 + i, at: S0 + i, sol: -0.1, tokens: [[MEME, i, i + 1]] }))]]);
  const first = await refreshActivity(store, fakeChain(history).chain, WALLET, { nowMs: T0, freshMs: 0, maxNew: 10 });
  assert.equal(first.trades.length, 10);
  assert.equal(first.trades[0].signature, "m29");
  assert.equal(first.skipped, 0, "older history is not a gap");
  assert.equal(first.complete, false);
  history.get(WALLET).push(...Array.from({ length: 30 }, (_, i) => ({ sig: `n${i}`, slot: 200 + i, at: S0 + 100 + i, sol: -0.1, tokens: [[MEME, i, i + 1]] })));
  const second = await refreshActivity(store, fakeChain(history).chain, WALLET, { nowMs: T0 + 60_000, freshMs: 0, maxNew: 10 });
  assert.equal(second.trades[0].signature, "n29");
  assert.equal(second.skipped, 20);
});

test("a list from a node that keeps only the newest is never «the whole history», and finds no creation block", async () => {
  const store = createMemoryGuardStore();
  const history = new Map([[WALLET, [{ sig: "only", slot: 500, at: S0 - 86_400 + 30, sol: -1, tokens: [[MEME, 0, 10]] }]]]);
  const view = await walletView(store, fakeChain(history, { newestOnly: true }).chain, facts(new Map([[MEME, MEME_FACTS], [WRAPPED_SOL, SOL_FACTS]])), WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  assert.equal(view.complete, false);
  assert.deepEqual(view.trades[0].labels, ["sniper"], "no block read from a partial list — no bundle");
});

test("a record read long ago asks for the whole history; extended from the newest only, it says the gap", async () => {
  const store = createMemoryGuardStore();
  const history = new Map([[WALLET, [{ sig: "mon", slot: 10, at: S0 - 4 * 86_400, sol: -1, tokens: [[MEME, 0, 10]] }]]]);
  await refreshActivity(store, fakeChain(history).chain, WALLET, { nowMs: T0 - 4 * 86_400_000, freshMs: 0, maxNew: 40 });
  history.get(WALLET).push({ sig: "fri", slot: 20, at: S0, sol: -1, tokens: [[MEME, 10, 20]] });
  const asked = [];
  const { chain } = fakeChain(history, { newestOnly: true });
  const spying = { ...chain, signatures: (address, options) => (asked.push(options.mode), chain.signatures(address, options)) };
  const record = await refreshActivity(store, spying, WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  assert.deepEqual(asked, ["whole"]);
  assert.equal(record.gap, true, "Monday to Friday read from a node that keeps a day or two — the gap is said");
  /* Read again within hours: the newest is enough, and no gap is invented. */
  const again = await refreshActivity(createMemoryGuardStore(), spying, WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  assert.equal(again.gap, false);
  assert.equal(asked.at(-1), "race");
});

test("the wallet's view: trades with tickers, the result per token and in all, the labels earned", async () => {
  const store = createMemoryGuardStore();
  const history = new Map([[CREATOR, [{ sig: "c1", slot: 10, at: S0, payer: CREATOR, sol: 0, tokens: [] }]], [WALLET, [{ sig: "b1", slot: 10, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000_000]] }]]]);
  const { chain } = fakeChain(history, { holdings: new Map([[MEME, 1_000]]) });
  const view = await walletView(store, chain, facts(new Map([[MEME, MEME_FACTS], [WRAPPED_SOL, SOL_FACTS]])), WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  assert.equal(view.trades[0].symbol, "3FEN");
  assert.equal(view.tokens[0].heldNow, 1_000);
  /* 1 000 tokens at $0.0004 = $0.40 = 0.002 SOL against 1 SOL paid. */
  assert.ok(Math.abs(view.pnl.unrealizedSol - (0.002 - 1)) < 1e-9);
  assert.equal(view.solUsd, 200);
});

/* --------------------------------------------------------------- notes */

async function follow(store, { address = WALLET, alerts = "all", since = T0 - 3_600_000, name = "Кит", locale = "uk" } = {}) {
  const made = await changeFollows(store, OWNER, { kind: "add", follow: { address, name, alerts, since: new Date(since).toISOString(), via: null } }, locale, new Date(since).toISOString());
  assert.equal(made.ok, true);
}

async function pass(store, history, nowMs, extra = {}) {
  const { chain } = fakeChain(history);
  const delivered = [];
  const deliveredAt = [];
  const report = await runWalletWatchPass({ store, chain, facts: facts(new Map([[MEME, MEME_FACTS], [WRAPPED_SOL, SOL_FACTS]])), clock: () => nowMs, deliver: async (rows, atMs) => { delivered.push(...rows); deliveredAt.push(atMs); }, ...extra });
  return { report, delivered, deliveredAt };
}

test("a followed wallet's trade is a note in the inbox and a delivery — once, however many passes", async () => {
  const store = createMemoryGuardStore();
  await follow(store);
  const history = new Map([[WALLET, [{ sig: "b1", slot: 10, at: S0 - 60, sol: -1.25, tokens: [[MEME, 0, 5_000_000_000]] }]]]);
  const first = await pass(store, history, T0);
  assert.equal(first.report.notes, 1);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].subject.kind, "wallet-watch");
  assert.equal(notes[0].subject.id, WALLET);
  assert.equal(notes[0].title, "Кит купив 3FEN за 1,25 SOL");
  assert.match(notes[0].reason, /За даними ланцюга Solana, 11:59 UTC\./);
  assert.equal(notes[0].text.en.title, "Кит bought 3FEN for 1.25 SOL");
  assert.equal(first.delivered.length, 2, "Telegram and push, as Нагляд is set");
  assert.equal(monitorNotes(notes).length, 0, "not a plan's note");
  const again = await pass(store, history, T0 + 120_000);
  assert.equal(again.report.notes, 0);
  assert.equal((await listInbox(store, OWNER)).length, 1);
  assert.equal(await resolveInboxLink(store, OWNER, notes[0].id), `/app/markets?tab=wallets&wallet=${WALLET}&from=monitoring`);
});

test("«Творець продає» has its own note; a trade from before the follow is history, not news", async () => {
  const store = createMemoryGuardStore();
  await follow(store, { address: CREATOR, alerts: "sells", name: null, since: T0 - 600_000 });
  const history = new Map([[CREATOR, [
    { sig: "old", slot: 5, at: S0 - 3_000, who: CREATOR, sol: 1, tokens: [[MEME, 2_000_000_000, 1_000_000_000]] },
    { sig: "buy", slot: 8, at: S0 - 120, who: CREATOR, sol: -0.2, tokens: [[MEME, 1_000_000_000, 1_100_000_000]] },
    { sig: "sale", slot: 9, at: S0 - 60, who: CREATOR, sol: 4.2, tokens: [[MEME, 1_100_000_000, 100_000_000]] },
  ]]]);
  await pass(store, history, T0);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1, "sales only: the buy is not told, the sale before the follow neither");
  assert.equal(notes[0].title, "Творець 3FEN продає");
  assert.match(plain(notes[0].reason), /^Cr8t…1111 продав 1 тис\. 3FEN за 4,2 SOL\. За даними ланцюга Solana/);
  assert.equal(notes[0].text.en.title, "The creator of 3FEN is selling");
});

test("a burst is one note; «Вимкнено» and quiet hours keep the phone quiet; the hour's share is kept", async () => {
  const store = createMemoryGuardStore();
  await follow(store);
  const burst = Array.from({ length: 5 }, (_, i) => ({ sig: `x${i}`, slot: 20 + i, at: S0 - 100 + i, sol: i % 2 ? 0.5 : -0.5, tokens: [[MEME, i % 2 ? 10 : 0, i % 2 ? 0 : 10]] }));
  await pass(store, new Map([[WALLET, burst]]), T0);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Кит: 5 нових угод");
  assert.match(notes[0].reason, /^Купив 3FEN; продав 3FEN\./);

  const quiet = createMemoryGuardStore();
  await follow(quiet);
  await preferencesOf(quiet).compareAndSet(`solana:mainnet:${OWNER}`, null, { version: 1, owner: OWNER, inbox: true, telegram: true, push: true, quietHours: { start: "00:00", end: "23:59", timezone: "UTC" }, updatedAt: new Date(T0).toISOString() });
  const hushed = await pass(quiet, new Map([[WALLET, burst.slice(0, 1)]]), T0);
  assert.equal(hushed.report.notes, 1);
  assert.equal(hushed.report.quiet, 1);
  assert.equal((await outboxOf(quiet).valuesWithPrefix("")).length, 0);

  const off = createMemoryGuardStore();
  await follow(off, { alerts: "off" });
  assert.equal((await pass(off, new Map([[WALLET, burst]]), T0)).report.wallets, 0);

  const busy = createMemoryGuardStore();
  for (let i = 0; i < FOLLOW_LIMIT; i += 1) {
    await follow(busy, { address: addressOf(i), name: `W${i}` });
  }
  const many = new Map((await readFollows(busy, OWNER)).wallets.map((row, i) => [row.address, [{ sig: `q${i}`, slot: 30 + i, at: S0 - 30, who: row.address, sol: -0.1, tokens: [[MEME, 0, 10]] }, { sig: `r${i}`, slot: 60 + i, at: S0 - 20, who: row.address, sol: 0.1, tokens: [[MEME, 10, 0]] }]]));
  const capped = await pass(busy, many, T0);
  assert.equal(capped.report.notes, 2 * FOLLOW_LIMIT);
  assert.equal(capped.report.delivered, SENT_PER_HOUR);
  assert.equal(capped.report.capped, 2 * FOLLOW_LIMIT - SENT_PER_HOUR);
});

test("the list keeps twenty wallets; following again keeps the first time; the contract knows the note's kind", async () => {
  const store = createMemoryGuardStore();
  for (let i = 0; i < FOLLOW_LIMIT; i += 1) await follow(store, { address: addressOf(i, "B"), name: null });
  const over = await changeFollows(store, OWNER, { kind: "add", follow: { address: OTHER, name: null, alerts: "all", since: new Date(T0).toISOString(), via: null } }, "uk", new Date(T0).toISOString());
  assert.deepEqual(over, { ok: false, code: "LIMIT" });
  const first = (await readFollows(store, OWNER)).wallets.at(-1);
  await changeFollows(store, OWNER, { kind: "add", follow: { ...first, name: "Новий", since: new Date(T0 + 1).toISOString() } }, "uk", new Date(T0).toISOString());
  const kept = (await readFollows(store, OWNER)).wallets.find((row) => row.address === first.address);
  assert.equal(kept.name, "Новий");
  assert.equal(kept.since, first.since);
  assert.ok(MONITOR_NOTE_SUBJECT_KINDS_V1.includes("wallet-watch"));
});

/* ---------------------------------------------------- the critic's cases */

const RENT = 2_039_280;
/** A transaction where token accounts open (absent before) or close (absent after), the rent in their own lamports. */
function rawTx({ sig = "r1", payer = WALLET, signer = true, walletSol = 0, payerSpent = 0, opened = [], closed = [], fee = 5_000 }) {
  const keys = payer === WALLET ? [{ pubkey: WALLET, signer: true }] : [{ pubkey: payer, signer: true }, { pubkey: WALLET, signer }];
  const accounts = [...opened, ...closed];
  const pre = [...keys.map(() => 10 * LAMPORTS), ...accounts.map((row) => (opened.includes(row) ? 0 : RENT))];
  const post = [...keys.map(() => 10 * LAMPORTS), ...accounts.map((row) => (opened.includes(row) ? RENT : 0))];
  const walletIndex = keys.findIndex((key) => key.pubkey === WALLET);
  post[walletIndex] += walletSol;
  if (payer !== WALLET) post[0] -= payerSpent + fee;
  const index = (row) => keys.length + accounts.indexOf(row);
  return {
    slot: 9, blockTime: S0, meta: { err: null, fee, preBalances: pre, postBalances: post,
      preTokenBalances: closed.map((row) => ({ accountIndex: index(row), mint: row.mint, owner: row.owner, uiTokenAmount: { amount: String(row.amount), decimals: 6 } })),
      postTokenBalances: opened.map((row) => ({ accountIndex: index(row), mint: row.mint, owner: row.owner, uiTokenAmount: { amount: String(row.amount), decimals: 6 } })) },
    transaction: { signatures: [sig], message: { accountKeys: [...keys, ...accounts.map((_, i) => ({ pubkey: `acct${i}`, signer: false }))] } },
  };
}

test("rent and fees are no price: a claimed airdrop, a closed account and a spam airdrop are not trades", () => {
  /* The wallet claims tokens: it pays the fee and the new account's rent — no «buy for 0.002 SOL». */
  assert.deepEqual(tradesOfTransaction(rawTx({ walletSol: -(5_000 + RENT), opened: [{ mint: MEME, owner: WALLET, amount: 1_000 }] }), WALLET), []);
  /* It burns what is left and closes the account: the rent comes back — no «sale». */
  assert.deepEqual(tradesOfTransaction(rawTx({ walletSol: RENT - 5_000, closed: [{ mint: MEME, owner: WALLET, amount: 1_000 }] }), WALLET), []);
  /* Someone sends tokens and opens the account for it: fees and rent only — not a purchase, not a bundle, not a note. */
  assert.deepEqual(tradesOfTransaction(rawTx({ payer: OTHER, signer: false, payerSpent: RENT, opened: [{ mint: MEME, owner: WALLET, amount: 1_000 }] }), WALLET), []);
  /* A real buy that opens the account: the price is what was paid for the tokens, the rent apart. */
  const buy = tradesOfTransaction(rawTx({ walletSol: -(5_000 + RENT + LAMPORTS / 2), opened: [{ mint: MEME, owner: WALLET, amount: 1_000 }] }), WALLET);
  assert.deepEqual(buy.map((t) => [t.side, t.quote, t.quoteAmount]), [["buy", "SOL", 0.5]]);
});

test("a token whose account is gone is held as 0 once holdings were read — no open result for a closed position", () => {
  const trades = tradesOfTransaction(tx({ sig: "b1", slot: 1, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000]] }), WALLET);
  const pnl = walletPnl(trades, { solUsd: 200, usd: new Map([[MEME, 400]]) }, new Map(), new Map([[WIF, 5]]));
  assert.equal(pnl.tokens[0].open, 0);
  assert.equal(pnl.tokens[0].unrealizedSol, null);
});

test("a trade a node gave late is still told; the creator's sales of a token at once are one note; deliveries go at once", async () => {
  const store = createMemoryGuardStore();
  await follow(store, { address: CREATOR, alerts: "all", name: null, since: T0 - 600_000 });
  const history = new Map([[CREATOR, [{ sig: "late", slot: 100, at: S0 - 90, who: CREATOR, sol: -0.1, tokens: [[WIF, 0, 10]] }, { sig: "next", slot: 101, at: S0 - 80, who: CREATOR, sol: -0.1, tokens: [[WIF, 10, 20]] }]]]);
  const { chain } = fakeChain(history, { refuse: new Set(["late"]) });
  const first = await runWalletWatchPass({ store, chain, facts: facts(new Map([[MEME, MEME_FACTS], [WRAPPED_SOL, SOL_FACTS]])), clock: () => T0, deliver: async () => {} });
  assert.equal(first.notes, 1);
  /* Next pass: the node gives the late one — it is told, though a newer one was told before it. */
  const second = await pass(store, history, T0 + 120_000);
  assert.equal(second.report.notes, 1);
  assert.equal(second.deliveredAt[0], T0 + 120_000 + DELIVERY_HOLD_MS, "sent as at its own time, not left to the monitoring cron");
  /* Five sales of 3FEN by its creator in one pass: one note, summed. */
  history.get(CREATOR).push(...Array.from({ length: 5 }, (_, i) => ({ sig: `cs${i}`, slot: 200 + i, at: S0 + 100 + i, who: CREATOR, sol: 0.2, tokens: [[MEME, 1_000_000_000, 800_000_000]] })));
  const third = await pass(store, history, T0 + 240_000);
  assert.equal(third.report.notes, 1);
  const sale = (await listInbox(store, OWNER)).find((note) => note.title === "Творець 3FEN продає");
  assert.match(plain(sale.reason), /продав 1 тис\. 3FEN за 1 SOL/);
});

test("alerts turned back on tell from that moment, not the hours they were off", async () => {
  const store = createMemoryGuardStore();
  await follow(store, { alerts: "off", since: T0 - 3_600_000 });
  const back = await changeFollows(store, OWNER, { kind: "update", address: WALLET, alerts: "all" }, "uk", new Date(T0).toISOString());
  assert.equal(back.record.wallets[0].since, new Date(T0).toISOString());
  const history = new Map([[WALLET, [{ sig: "during", slot: 10, at: S0 - 600, sol: -1, tokens: [[MEME, 0, 10]] }]]]);
  assert.equal((await pass(store, history, T0 + 60_000)).report.notes, 0);
  /* Following again without saying what to be told keeps the person's choice. */
  const again = await changeFollows(store, OWNER, { kind: "add", follow: { address: WALLET, name: null, alerts: "all", since: new Date(T0).toISOString(), via: null }, alertsGiven: false }, "uk", new Date(T0).toISOString());
  await changeFollows(store, OWNER, { kind: "update", address: WALLET, alerts: "sells" }, "uk", new Date(T0).toISOString());
  const kept = await changeFollows(store, OWNER, { kind: "add", follow: { ...again.record.wallets[0], alerts: "all" }, alertsGiven: false }, "uk", new Date(T0).toISOString());
  assert.equal(kept.record.wallets[0].alerts, "sells");
});

test("a node that does not keep the buy calls nobody a bundle", async () => {
  const store = createMemoryGuardStore();
  const buyAt = S0 - 86_400 + 30;
  const history = new Map([[WALLET, [{ sig: "early", slot: 500, at: buyAt, sol: -1, tokens: [[MEME, 0, 10]] }]]]);
  const view = await walletView(store, fakeChain(history).chain, facts(new Map([[MEME, MEME_FACTS], [WRAPPED_SOL, SOL_FACTS]])), WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  assert.deepEqual(view.trades[0].labels, ["sniper"]);
});

test("a token bought after the accounts were read is not known as held — never «0»; new trades read the accounts again", async () => {
  const trades = tradesOfTransaction(tx({ sig: "b1", slot: 1, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000]] }), WALLET);
  const unknown = walletPnl(trades, { solUsd: 200, usd: new Map([[MEME, 400]]) }, new Map(), new Map([[MEME, null]]));
  assert.equal(unknown.tokens[0].open, 1);
  const store = createMemoryGuardStore();
  const history = new Map([[WALLET, [{ sig: "b1", slot: 10, at: S0, sol: -1, tokens: [[MEME, 0, 1_000_000]] }]]]);
  let reads = 0;
  const { chain } = fakeChain(history);
  const counted = { ...chain, holdings: async () => (reads++, new Map()) };
  await refreshActivity(store, counted, WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  history.get(WALLET).push({ sig: "b2", slot: 11, at: S0 + 5, sol: -1, tokens: [[WIF, 0, 10]] });
  await refreshActivity(store, counted, WALLET, { nowMs: T0 + 10_000, freshMs: 0, maxNew: 40 });
  assert.equal(reads, 2, "the second read brought a trade: the accounts are read again within the minute");
});

test("a burst's delivery key stays short however many trades it names; the chain's reads are counted across instances", async () => {
  const store = createMemoryGuardStore();
  await follow(store);
  const burst = Array.from({ length: 40 }, (_, i) => ({ sig: `z${i}`.padEnd(88, "z"), slot: 300 + i, at: S0 - 300 + i, sol: -0.1, tokens: [[MEME, i, i + 1]] }));
  await pass(store, new Map([[WALLET, burst]]), T0);
  const rows = await outboxOf(store).valuesWithPrefix("");
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(row.id.length < 200, row.id.length);
  const budget = createMemoryGuardStore();
  for (let i = 0; i < 3; i += 1) assert.equal(await claimChainRead(budget, T0, "first", 3), true);
  assert.equal(await claimChainRead(budget, T0, "first", 3), false);
  assert.equal(await claimChainRead(budget, T0, "refresh", 3), true, "polls of kept wallets have their own share");
  assert.equal(await claimChainRead(budget, T0 + 60_000, "first", 3), true, "a new minute, a new share");
});

test("what a wallet holds: the first node that answers both programs; a refused node is passed with its reason, never an empty wallet", async () => {
  const account = (mint, amount, decimals) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals, uiAmount: null } } } } } });
  const answers = { classic: { value: [account(MEME, "12500000", 6), account(MEME, "500000", 6)] }, t22: { value: [account(WIF, "250000000000000000000", 9)] } };
  const asked = [];
  const rpc = async (url, method, params) => {
    asked.push(new URL(url).host);
    assert.equal(method, "getTokenAccountsByOwner");
    if (url.includes("refusing")) throw new Error("Request blocked");
    return params[1].programId.startsWith("Tokenz") ? answers.t22 : answers.classic;
  };
  const read = await holdingsAcross(["https://refusing.example", "https://answering.example"], WALLET, rpc);
  assert.equal(read.held.get(MEME), 13);
  assert.equal(read.held.get(WIF), 250_000_000_000, "an amount past uiAmount's reach is read from the exact one");
  assert.deepEqual(read.reasons, ["refusing.example: Request blocked"]);
  const none = await holdingsAcross(["https://refusing.example"], WALLET, rpc);
  assert.equal(none.held, null);
  assert.throws(() => holdingsFromAccounts([{ nothing: true }]), /malformed/);
  /* Asked from the newest trade's slot on: a node behind it does not answer «0» of what was just bought. */
  let config = null;
  await holdingsAcross(["https://answering.example"], WALLET, async (url, method, params) => ((config = params[2]), answers.classic), 4242);
  assert.equal(config.minContextSlot, 4242);
});

test("words: Ukrainian plurals, a payer named, no advice", () => {
  const trade = { signature: "s", slot: 1, at: S0, side: "buy", mint: MEME, tokensRaw: "1000", decimals: 0, quote: null, quoteAmount: null, paidBy: CREATOR };
  assert.equal(plain(tradeNote(trade, "Кит", "3FEN", ["bundle"], "uk").reason), "1 тис. 3FEN — заплатив гаманець Cr8t…1111. За даними ланцюга Solana, 12:00 UTC. Позначка: бандл.");
  const four = Array.from({ length: 4 }, (_, i) => ({ ...trade, slot: i, paidBy: null }));
  assert.equal(burstNote(four, "Кит", () => "3FEN", "uk").title, "Кит: 4 нові угоди");
  const twentyOne = Array.from({ length: 21 }, (_, i) => ({ ...trade, slot: i, paidBy: null }));
  assert.equal(burstNote(twentyOne, "Кит", () => "3FEN", "uk").title, "Кит: 21 нова угода");
  for (const words of [tradeNote(trade, "Кит", "3FEN", [], "uk"), tradeNote(trade, "Kit", "3FEN", [], "en")]) assert.doesNotMatch(`${words.title} ${words.reason}`, /\b(should|buy now|купуй|продавай|рекоменд|guaranteed|safe)\b/i);
});

/* ---------------------------------------------------------- the surface */

test("«Ринки» → «Гаманці»: a tab of its own, both languages, read-only — nothing here buys, sells or signs", () => {
  const screener = read("lib/markets/screener.ts");
  assert.match(screener, /SCREENER_TABS = \[[^\]]*"wallets"\]/);
  const view = read("app/app/markets/markets-screener.tsx");
  assert.match(view, /\) : wallets \? \(\s*<WalletWatch locale=\{locale\} \/>/);
  const component = read("app/app/markets/wallets/wallet-watch.tsx");
  const words = read("app/app/markets/wallets/wallet-words.ts");
  assert.match(words, /readOnly: bi\("Read-only: following a wallet buys and sells nothing\.", "Лише читання: стеження нічого не купує й не продає\."\)/);
  assert.doesNotMatch(`${component}\n${words}`, /\bRyn\b|RYN /);
  /* No swap, order, sign or send: the only writes are the person's own list and the assistant's watch. */
  const fetched = [...component.matchAll(/fetch\(\s*[`"]([^`"]+)/g)].map((m) => m[1].split("?")[0]);
  assert.deepEqual([...new Set(fetched)].sort(), ["/api/v1/assistant/watches", "/api/wallet-watch", "/api/wallet-watch/wallet"]);
  for (const file of ["lib/wallet-watch/trades.ts", "lib/wallet-watch/read.ts", "lib/wallet-watch/run.ts", "lib/wallet-watch/store.ts", "lib/wallet-watch/notes.ts", "lib/wallet-watch/chain.server.ts", "app/api/wallet-watch/route.ts", "app/api/wallet-watch/wallet/route.ts", "app/app/markets/wallets/wallet-watch.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /sendTransaction|sendRawTransaction|signTransaction|signAllTransactions|\/swap|jupiter\/order|\/execute|Keypair|secretKey/, `${file} must not trade or sign`);
  }
  assert.match(read("vercel.json"), /"\/api\/cron\/wallet-watch", "schedule": "\*\/2 \* \* \* \*"/);
  assert.match(read("app/api/cron/wallet-watch/route.ts"), /decideBearerAuth[\s\S]*legacy-rejected/);
});
