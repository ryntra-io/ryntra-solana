import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WatchRuleSchema } from "../../lib/assistant/watch/rules.ts";
import { createMemoryGuardStore } from "../../lib/guard/store.ts";
import { walletView } from "../../lib/wallet-watch/read.ts";
import { FOLLOW_LIMIT as ENGINE_FOLLOW_LIMIT } from "../../lib/wallet-watch/store.ts";
import {
  PACE,
  PACE_START,
  FOLLOW_LIMIT,
  addressIn,
  agoOf,
  alertNotesOf,
  alertsOf,
  answerOf,
  coinNowOf,
  coinsMatching,
  feedOf,
  holdsOf,
  levelOf,
  listAdd,
  listRemove,
  listRename,
  localListOf,
  logoOf,
  nameOf,
  nextDue,
  refusalOf,
  restPace,
  resultShown,
  ruleFor,
  serverListOf,
  shareText,
  shortAddress,
  takeRead,
  toMove,
  tradeIcons,
  walletHref,
} from "./watch-view.ts";
import { ALERT_WORDS, WALLET_WORDS, WATCH_WORDS } from "./words.ts";

/* «Watch» and a wallet's own page: what a pasted text means, the engine's wallet read as the page reads it, the feed of
   the wallets one watches, the list kept in the browser, the pace of the reads under the visitor's share, and a coin's
   alert as a rule the engine already judges. Reads only — nothing here signs, sends or trades. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OWNER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const SOL = "So11111111111111111111111111111111111111112";
const T0 = Date.parse("2026-11-19T12:00:00Z");
const S0 = T0 / 1000;
const LAMPORTS = 1_000_000_000;

test("a pasted address, or a link with one in it, is the wallet; anything else is said so", () => {
  assert.equal(addressIn(`  ${WALLET} `), WALLET);
  assert.equal(addressIn(`https://solscan.io/account/${WALLET}?cluster=mainnet`), WALLET);
  assert.equal(addressIn(`https://gmgn.ai/sol/address/${WALLET}`), WALLET);
  assert.equal(addressIn("bonk"), null);
  assert.equal(addressIn("0x1111111111111111111111111111111111111111"), null, "an address of another network is not one");
  assert.equal(addressIn(`https://example.com/x/${WALLET}0`), null, "an address glued to more letters is not one");
  assert.equal(addressIn(`https://explorer.example/address/${WALLET}#tokens`), WALLET);
  assert.equal(addressIn(""), null);
  assert.equal(addressIn("x".repeat(500)), null);
  assert.equal(shortAddress(WALLET), "7xKX…gAsU");
  assert.equal(walletHref(WALLET), `/wallet/${WALLET}`);
});

test("a coin's logo comes through Ryntra's own logo routes, never straight from elsewhere", () => {
  const listed = logoOf(MEME, "https://ipfs.io/ipfs/abc");
  assert.ok(listed.src.startsWith(`/api/spot/icon?mint=${MEME}&u=`));
  assert.deepEqual(listed.also, [`/api/icon/${MEME}`]);
  const bare = logoOf(MEME, null);
  assert.equal(bare.src, `/api/icon/${MEME}`);
  assert.equal(logoOf(MEME, "http://example.com/a.png").src, `/api/icon/${MEME}`, "only an https address is passed on");
  // SOL and USDC by the pictures kept with the site: the logo routes answer nothing for them.
  assert.equal(logoOf(SOL, null).src, "/site/universe/SOL.png");
  assert.deepEqual(logoOf(SOL, null).also, [`/api/icon/${SOL}`, `/api/spot/icon?mint=${SOL}`]);
  assert.equal(logoOf("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", null).src, "/site/universe/USDC.png");
  // What a wallet holds is drawn by the picture its trades gave the coin — the first one given, each coin once.
  const icons = tradeIcons([
    { mint: MEME, icon: null },
    { mint: MEME, icon: "https://example.com/3fen.png" },
    { mint: MEME, icon: "https://example.com/other.png" },
    { mint: WIF, icon: null },
  ]);
  assert.deepEqual([...icons], [[MEME, "https://example.com/3fen.png"]]);
});

test("how long ago: seconds, minutes, hours, days; no time from the chain is «—»", () => {
  assert.deepEqual(agoOf(S0 - 12, T0), { unit: "s", n: 12 });
  assert.deepEqual(agoOf(S0 - 4 * 60, T0), { unit: "m", n: 4 });
  assert.deepEqual(agoOf(S0 - 3 * 3_600, T0), { unit: "h", n: 3 });
  assert.deepEqual(agoOf(S0 - 2 * 86_400, T0), { unit: "d", n: 2 });
  assert.equal(agoOf(null, T0), null);
});

/* A `jsonParsed` transaction as a node gives it: the wallet's SOL and token balances before and after. */
function tx({ sig, slot, at, sol = 0, tokens = [], fee = 5_000 }) {
  const pre = [10 * LAMPORTS];
  const post = [10 * LAMPORTS + Math.round(sol * LAMPORTS) - fee];
  const preTok = [];
  const postTok = [];
  tokens.forEach(([mint, before, after, decimals = 6], index) => {
    preTok.push({ accountIndex: 10 + index, mint, owner: WALLET, uiTokenAmount: { amount: String(before), decimals } });
    postTok.push({ accountIndex: 10 + index, mint, owner: WALLET, uiTokenAmount: { amount: String(after), decimals } });
  });
  return { slot, blockTime: at, meta: { err: null, fee, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok }, transaction: { signatures: [sig], message: { accountKeys: [{ pubkey: WALLET, signer: true }] } } };
}

function chainOf(rows, held = new Map()) {
  return {
    async signatures(_address, options) {
      return { rows: rows.slice().sort((a, b) => b.slot - a.slot).slice(0, options.limit).map((row) => ({ signature: row.sig, slot: row.slot, blockTime: row.at, failed: false })), whole: true };
    },
    async transaction(signature) {
      const row = rows.find((one) => one.sig === signature);
      return row ? tx(row) : null;
    },
    async holdings() {
      return held;
    },
  };
}

const FACTS = new Map([
  [MEME, { symbol: "3FEN", name: "Three Fen", icon: "https://example.com/3fen.png", priceUsd: 0.0004, creator: OTHER, createdAt: S0 - 30 * 86_400, liquidityUsd: 400_000 }],
  [SOL, { symbol: "SOL", name: "Solana", icon: null, priceUsd: 200, creator: null, createdAt: null, liquidityUsd: null }],
]);
const facts = async (mints) => new Map(mints.filter((mint) => FACTS.has(mint)).map((mint) => [mint, FACTS.get(mint)]));

test("the engine's wallet read, as the page reads it: the trades, the result by the honest count, the labels", async () => {
  const rows = [
    { sig: "b1", slot: 10, at: S0 - 3_600, sol: -1, tokens: [[MEME, 0, 5_000_000_000]] },
    { sig: "s1", slot: 11, at: S0 - 60, sol: 3, tokens: [[MEME, 5_000_000_000, 2_000_000_000]] },
  ];
  const view = await walletView(createMemoryGuardStore(), chainOf(rows, new Map([[MEME, 2_000]])), facts, WALLET, { nowMs: T0, freshMs: 0, maxNew: 40 });
  // Through the wire, as the route sends it.
  const answer = answerOf(200, JSON.parse(JSON.stringify({ ok: true, token: null, view })));
  assert.equal(answer.kind, "wallet");
  const got = answer.read;
  assert.equal(got.wallet, WALLET);
  assert.deepEqual(got.trades.map((t) => [t.side, t.symbol, t.quote, t.quoteAmount]), [
    ["sell", "3FEN", "SOL", 3],
    ["buy", "3FEN", "SOL", 1],
  ]);
  assert.equal(got.trades[0].tokens, 3_000, "whole coins from the raw amount and its decimals");
  assert.equal(got.trades[0].key, `${WALLET}:s1:${MEME}:sell`);
  assert.equal(got.oldestAt, S0 - 3_600);
  assert.equal(got.solUsd, 200);
  assert.equal(got.result.trades, 2);
  assert.ok(got.result.realized > 0, "sold 3/5 of what cost 1 SOL for 3 SOL: a closed gain");
  assert.equal(got.result.verdict, view.honest.pnl.whole.verdict);
  assert.equal(got.result.result, view.honest.pnl.whole.result);
  assert.equal(got.result.wins, view.pnl.wins);
  assert.deepEqual(Object.keys(got.badges).sort(), ["bundle", "creator", "sniper"]);
});

test("the wallet's one figure: the result where it is called, else what is known with the share priced; «—» only when nothing is", () => {
  const base = { realized: null, unrealized: null, verdict: "UNKNOWN", trades: 9, wins: 1, losses: 5, approx: false };
  // The live wallet of the eyes' pass 20.11: «— SOL» over tiles with figures, «Known −7.574 SOL · 62%» small under it.
  assert.deepEqual(resultShown({ ...base, result: null, known: -7.574, realized: -6.1, unrealized: -1.474, completenessPct: 62.4 }), { value: -7.574, priced: 62.4 });
  assert.deepEqual(resultShown({ ...base, result: 3.2, known: 3.2, completenessPct: 100, verdict: "PLUS" }), { value: 3.2, priced: null }, "all of it priced: the result, nothing beside it");
  assert.deepEqual(resultShown({ ...base, result: 3.2, known: 3.2, completenessPct: 97.3, verdict: "PLUS" }), { value: 3.2, priced: 97.3 }, "a result called on less than all still says its share");
  assert.deepEqual(resultShown({ ...base, result: null, known: null, completenessPct: 0 }), { value: null, priced: null }, "nothing priced: «—»");
  assert.deepEqual(resultShown({ ...base, result: null, known: null, completenessPct: 40 }), { value: null, priced: null }, "only buys priced make no known part: «—», never a zero");
  assert.deepEqual(resultShown({ ...base, result: null, known: null, completenessPct: null, verdict: "EMPTY", trades: 0 }), { value: null, priced: null });
  assert.equal(shareText(62.4), "62%");
  assert.equal(shareText(0.3), "<1%", "a sliver is never «0%» beside a figure");
  assert.equal(shareText(99.4), "99%");
  // The page shows that figure — the known sum is no small line under a dash any more.
  const page = read("terminal/watch/WalletScreen.tsx");
  assert.match(page, /resultShown\(r\)/);
  assert.doesNotMatch(page, /ww\.known\(/);
  assert.equal(WALLET_WORDS.en.priced("62%"), "62% priced");
  // «In profit 1/6» says one of six what — the coins closed — and «з» stands in the words' face, never read as «3».
  assert.equal(WALLET_WORDS.uk.inProfit, "Закрито в плюс");
  assert.match(page, /<span className=\{v\.of\}>\{ww\.of\}<\/span>/);
});

test("a text that is no address, too many reads and nothing read are states of the page, not errors", () => {
  assert.deepEqual(answerOf(400, { error: "bad request", code: "NOT_AN_ADDRESS" }), { kind: "bad" });
  assert.deepEqual(answerOf(429, { code: "RATE_LIMITED" }), { kind: "busy" });
  assert.deepEqual(answerOf(503, { code: "CHAIN_UNREAD" }), { kind: "unread" });
  assert.deepEqual(answerOf(200, null), { kind: "unread" });
  const coin = answerOf(200, { ok: true, token: { mint: MEME, symbol: "3FEN", creator: OTHER }, view: null });
  assert.deepEqual(coin, { kind: "coin", mint: MEME, symbol: "3FEN", creator: OTHER, read: null });
  const fresh = answerOf(200, { ok: true, token: { mint: MEME, symbol: "4CJf", creator: null }, view: null });
  assert.equal(fresh.kind, "coin");
  assert.equal(fresh.creator, null, "a coin minted a minute ago: no creator known yet");
});

test("what a wallet holds: the portfolio's read by address, the biggest first, nothing borrowed or projected", () => {
  const body = {
    owner: WALLET,
    totals: { usd: 1_250, complete: true },
    positions: [
      { id: "coin:a", kind: "coin", origin: "chain", state: "read", value: { usd: 50 }, tokens: [{ mint: MEME, symbol: "3FEN", decimals: 6, amountRaw: "2000000000", role: "held" }] },
      { id: "pool:b", kind: "pool", origin: "chain", state: "read", label: "SOL–USDC", platform: "Meteora", value: { usd: 900 }, tokens: [] },
      { id: "borrow:c", kind: "borrow", origin: "provider", state: "read", value: { usd: -200 }, tokens: [] },
      { id: "proj:d", kind: "other", origin: "projection", state: "read", value: { usd: 10 }, tokens: [] },
      { id: "coin:e", kind: "coin", origin: "chain", state: "read", value: { usd: null }, tokens: [{ mint: WIF, symbol: null, decimals: 6, amountRaw: "5", role: "held" }] },
    ],
  };
  const holds = holdsOf(body, WALLET);
  assert.equal(holds.usd, 1_250);
  assert.deepEqual(holds.rows.map((row) => row.id), ["pool:b", "coin:a", "coin:e"], "the biggest first, an unpriced one last");
  assert.equal(holds.rows[1].amount, 2_000);
  assert.equal(holds.rows[0].label, "SOL–USDC");
  assert.equal(holds.rows[0].mint, null);
  assert.equal(holdsOf(body, OTHER), null, "another wallet's answer is not this page's");
  assert.equal(holdsOf({ owner: WALLET, positions: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, kind: "coin", origin: "chain", state: "read", value: { usd: i }, tokens: [] })) }, WALLET).more, 4);
});

const trade = (wallet, sig, at, side = "buy", mint = MEME) => ({ key: `${wallet}:${sig}:${mint}:${side}`, wallet, signature: sig, at, side, mint, symbol: "3FEN", icon: null, tokens: 1, quote: "SOL", quoteAmount: 0.5 });
const readOf = (wallet, trades) => ({ wallet, readAt: null, oldestAt: null, complete: false, trades, result: {}, badges: { creator: 0, sniper: 0, bundle: 0 }, solUsd: 200 });

test("the feed: the watched wallets' trades newest first, each under the name the person gave, each once", () => {
  const follows = [
    { address: WALLET, name: "Whale", since: "" },
    { address: OTHER, name: null, since: "" },
  ];
  const reads = new Map([
    [WALLET, readOf(WALLET, [trade(WALLET, "a", S0 - 10), trade(WALLET, "b", null)])],
    [OTHER, readOf(OTHER, [trade(OTHER, "c", S0 - 5, "sell"), trade(OTHER, "d", S0 - 100)])],
  ]);
  const feed = feedOf(follows, reads);
  assert.deepEqual(feed.map((row) => row.signature), ["c", "a", "d", "b"], "a trade with no time stands last");
  assert.deepEqual(feed.map((row) => row.who), [shortAddress(OTHER), "Whale", shortAddress(OTHER), "Whale"]);
  assert.equal(feedOf(follows, reads, 2).length, 2);
  assert.deepEqual(feedOf([{ address: WALLET, name: null, since: "" }, { address: WALLET, name: null, since: "" }], reads).length, 2, "the same wallet twice — its trades once");
  assert.deepEqual(feedOf(follows, new Map()), [], "nothing read yet");
});

test("the list in the browser: valid rows only, each wallet once, twenty at most; a new one on top, a known one keeps its place", () => {
  const raw = JSON.stringify([{ address: WALLET, name: "  Whale  " }, { address: WALLET, name: "again" }, { address: "nope" }, { address: OTHER, name: "x".repeat(50), since: "2026-11-19T10:00:00.000Z" }]);
  const list = localListOf(raw);
  assert.deepEqual(list.map((row) => [row.address, row.name]), [[WALLET, "Whale"], [OTHER, "x".repeat(32)]]);
  assert.deepEqual(localListOf("{broken"), []);
  assert.deepEqual(localListOf(null), []);
  assert.equal(nameOf("   "), null);
  const added = listAdd(list, OWNER, null, "2026-11-19T12:00:00.000Z");
  assert.deepEqual(added.list.map((row) => row.address), [OWNER, WALLET, OTHER]);
  const renamed = listAdd(added.list, OTHER, "Fund", "2026-11-19T12:00:00.000Z");
  assert.deepEqual(renamed.list.map((row) => [row.address, row.name]), [[OWNER, null], [WALLET, "Whale"], [OTHER, "Fund"]], "followed again: its place and its first time stay");
  assert.deepEqual(listRename(renamed.list, WALLET, null).find((row) => row.address === WALLET).name, null);
  assert.deepEqual(listRemove(renamed.list, WALLET).map((row) => row.address), [OWNER, OTHER]);
  const full = Array.from({ length: FOLLOW_LIMIT }, (_, i) => ({ address: `${"A".repeat(42)}${"123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}1`, name: null, since: "" }));
  assert.deepEqual(listAdd(full, WALLET, null, ""), { ok: false, code: "LIMIT" });
  assert.equal(FOLLOW_LIMIT, ENGINE_FOLLOW_LIMIT, "the browser keeps as many as the engine does");
});

test("the browser's wallets move to the wallet's list: only those it does not hold, as many as it has room for", () => {
  const local = [WALLET, OTHER, OWNER].map((address) => ({ address, name: null, since: "" }));
  assert.deepEqual(toMove(local, [{ address: OTHER, name: "Fund", since: "" }]).map((row) => row.address), [WALLET, OWNER]);
  const almost = Array.from({ length: FOLLOW_LIMIT - 1 }, (_, i) => ({ address: `${"B".repeat(42)}${"123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}1`, name: null, since: "" }));
  assert.equal(toMove(local, almost).length, 1);
  const server = serverListOf({ ok: true, wallets: [{ address: WALLET, name: "Whale", alerts: "all", since: "2026-11-19T10:00:00.000Z", via: null, lastTrade: null, trades24h: 0, readAt: null }] });
  assert.deepEqual(server.map((row) => [row.address, row.name]), [[WALLET, "Whale"]]);
  assert.equal(serverListOf({ error: "proof required" }), null);
});

test("the reads keep under the visitor's share: a few at once, then one every few seconds; a refusal rests them", () => {
  let pace = PACE_START;
  let now = T0;
  let started = 0;
  for (let i = 0; i < 40; i += 1) {
    const take = takeRead(pace, now);
    pace = take.pace;
    if (take.ok) started += 1;
  }
  assert.equal(started, PACE.burst, "the burst, then nothing at the same moment");
  // A minute of asking every second.
  for (let s = 1; s <= 60; s += 1) {
    now = T0 + s * 1_000;
    const take = takeRead(pace, now);
    pace = take.pace;
    if (take.ok) started += 1;
  }
  assert.ok(started <= 19, `at most ${started} reads in the first minute — the share is twenty`);
  assert.ok(started >= 15, "and the list keeps reading");
  const rested = restPace(now);
  const refused = takeRead(rested, now + 1_000);
  assert.equal(refused.ok, false);
  assert.ok(refused.wait >= PACE.restMs - 1_000);
  assert.equal(takeRead(rested, now + PACE.restMs + PACE.everyMs).ok, true, "after the rest, reads go on");
});

test("the next wallet to read: the one read longest ago past its freshness; one reading or fresh waits", () => {
  const asked = [WALLET, OTHER, OWNER];
  const lastAt = new Map([
    [WALLET, T0 - 70_000],
    [OTHER, T0 - 10_000],
  ]);
  const fresh = new Map(asked.map((address) => [address, 60_000]));
  assert.equal(nextDue(asked, lastAt, fresh, new Set(), T0), OWNER, "never read — first");
  assert.equal(nextDue(asked, lastAt, fresh, new Set([OWNER]), T0), WALLET);
  assert.equal(nextDue(asked, lastAt, fresh, new Set([OWNER, WALLET]), T0), null, "the other is fresh");
});

test("an alert is a price crossing the engine already judges; a cap is watched through the price", () => {
  assert.equal(levelOf("0,0042"), 0.0042);
  assert.equal(levelOf("1500000"), 1_500_000);
  assert.equal(levelOf("abc"), null);
  assert.equal(levelOf("0"), null);
  const now = { price: 0.002, cap: 2_000_000 };
  const up = ruleFor("price", 0.003, now);
  assert.deepEqual(up, { ok: true, rule: { kind: "price", direction: "above", level: 0.003 } });
  assert.equal(ruleFor("price", 0.001, now).rule.direction, "below");
  const cap = ruleFor("cap", 3_000_000, now);
  assert.deepEqual(cap, { ok: true, rule: { kind: "price", direction: "above", level: 0.003 } }, "a cap of 3M with 1B coins out is a price of 0.003");
  assert.equal(ruleFor("cap", 1_000_000, now).rule.direction, "below");
  assert.deepEqual(ruleFor("price", 0.002, now), { ok: false, code: "SAME" });
  assert.deepEqual(ruleFor("price", null, now), { ok: false, code: "LEVEL" });
  assert.deepEqual(ruleFor("cap", 1, { price: 0.002, cap: null }), { ok: false, code: "NOW" });
  assert.deepEqual(ruleFor("price", 1, { price: null, cap: null }), { ok: false, code: "NOW" });
  for (const outcome of [up, cap]) assert.equal(WatchRuleSchema.safeParse(outcome.rule).success, true, "the engine's own rule shape");
});

test("the person's alerts as the engine lists them, the notes of the ones set by a cap, and why one was refused", () => {
  const view = alertsOf({
    watches: [
      { id: "wch_aaaaaaaaaaaaaaaaaaaaaaaa", mint: MEME, symbol: "3FEN", rule: { kind: "price", direction: "above", level: 0.003 }, ruleText: "Price above $0.003", status: "active", now: { state: "armed" }, createdAt: "2026-11-19T10:00:00.000Z" },
      { id: "wch_bbbbbbbbbbbbbbbbbbbbbbbb", mint: WIF, symbol: "WIF", rule: { kind: "move", window: "h24", direction: "down", pct: 10 }, ruleText: "Down 10% in 24 hours", status: "paused", now: { state: "armed" }, createdAt: "2026-11-19T11:00:00.000Z" },
      { id: "not-a-watch", mint: WIF, symbol: "WIF" },
    ],
    limit: { free: 3, used: 2, left: 1 },
    channels: { inbox: true, telegram: true, push: false },
    deliveriesPerHour: 20,
  });
  assert.deepEqual(view.rows.map((row) => [row.symbol, row.state, row.price]), [
    ["WIF", "paused", null],
    ["3FEN", "armed", { direction: "above", level: 0.003 }],
  ]);
  assert.deepEqual([view.free, view.left, view.channels.telegram, view.channels.push, view.perHour], [3, 1, true, false, 20]);
  assert.deepEqual(alertNotesOf(JSON.stringify({ wch_aaaaaaaaaaaaaaaaaaaaaaaa: { basis: "cap", cap: 3_000_000, level: 0.003 }, nope: { basis: "cap", cap: 1, level: 1 } })), { wch_aaaaaaaaaaaaaaaaaaaaaaaa: { basis: "cap", cap: 3_000_000, level: 0.003 } });
  assert.deepEqual(alertNotesOf("{broken"), {});
  assert.equal(refusalOf(401, { error: { code: "UNAUTHORIZED" } }), "proof");
  assert.equal(refusalOf(409, { error: { code: "WATCH_LIMIT_REACHED" } }), "limit");
  assert.equal(refusalOf(422, { error: { code: "ASSET_UNCONFIRMED" } }), "coin");
  assert.equal(refusalOf(422, { error: { code: "PRICE_UNAVAILABLE" } }), "price");
  assert.equal(refusalOf(400, { error: { code: "VALIDATION_ERROR" } }), "same");
  assert.equal(refusalOf(503, null), "failed");
});

test("the alert's coin: a ticker of the market first, then a name; a coin's market read gives its price and cap", () => {
  const towers = [
    { id: MEME, symbol: "3FEN", name: "Three Fen", icon: null },
    { id: WIF, symbol: "WIF", name: "dogwifhat", icon: null },
    { id: SOL, symbol: "SOL", name: "Wrapped SOL", icon: null },
    { id: "not-a-mint", symbol: "WIFE", name: "x", icon: null },
  ];
  assert.deepEqual(coinsMatching(towers, "$wif").map((coin) => coin.symbol), ["WIF"]);
  assert.deepEqual(coinsMatching(towers, "sol").map((coin) => coin.symbol), ["SOL"]);
  assert.deepEqual(coinsMatching(towers, "hat").map((coin) => coin.symbol), ["WIF"]);
  assert.deepEqual(coinsMatching(towers, " "), []);
  const now = coinNowOf({ market: { mint: MEME, symbol: "3FEN", name: "Three Fen", icon: null, price: 0.002, marketCapUsd: 2_000_000 } }, MEME);
  assert.deepEqual([now.symbol, now.price, now.cap], ["3FEN", 0.002, 2_000_000]);
  assert.equal(coinNowOf({ market: null }, MEME), null);
  assert.equal(coinNowOf({ market: { mint: WIF } }, MEME), null);
});

test("the alerts ride the engine's own conditions: its notes reach the inbox, Telegram and push through monitoring", () => {
  const run = read("lib/assistant/watch/run.ts");
  assert.match(run, /from "\.\.\/\.\.\/monitoring\/store\.ts"/, "the token watch writes its note into monitoring's inbox");
  assert.match(read("lib/monitoring/store.ts"), /"token-watch"/, "monitoring knows the note's subject");
  assert.match(read("vercel.json"), /\/api\/v1\/assistant\/watches\/tick/, "the watches are judged every minute");
  assert.match(read("vercel.json"), /\/api\/cron\/wallet-watch/, "the watched wallets' trades are told");
  const alerts = read("terminal/watch/alerts-store.ts");
  assert.match(alerts, /'\/api\/v1\/assistant\/watches'/);
  assert.doesNotMatch(alerts, /signTransaction|sendTransaction|\/api\/v1\/swap|\/execute/, "an alert moves nothing");
});

test("the screens stand in the terminal's frame at their own addresses, behind its switch, and never offered to the index", () => {
  const watch = read("app/(terminal)/watch/page.tsx");
  assert.match(watch, /<WatchScreen \/>/);
  assert.match(watch, /if \(!shelfOn\("market"\)\) notFound\(\);/);
  assert.match(watch, /index: false/);
  const wallet = read("app/(terminal)/wallet/[address]/page.tsx");
  assert.match(wallet, /<WalletScreen key=\{address\} address=\{address\.trim\(\)\} \/>/);
  assert.match(wallet, /if \(!shelfOn\("market"\)\) notFound\(\);/);
  assert.match(wallet, /index: false/);
  for (const file of ["terminal/watch/WatchScreen.tsx", "terminal/watch/WalletScreen.tsx", "terminal/watch/Alerts.tsx", "terminal/watch/parts.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /signTransaction|sendTransaction|signAllTransactions/, `${file}: nothing here signs a transaction`);
    assert.doesNotMatch(source, /from ['"]@\/(app\/app|components|app\/solana\/workspace)\//, `${file}: nothing from the closed interface`);
  }
  // «Buy» is the coin page's own form: no ticket of this screen.
  assert.doesNotMatch(read("terminal/watch/parts.tsx"), /Ticket|useTicket/);
  assert.match(read("terminal/watch/parts.tsx"), /href=\{coinPageHref\(trade\.mint\)\}/);
});

test("the words: English and Ukrainian alike, no promise of a result", () => {
  for (const dict of [WATCH_WORDS, WALLET_WORDS, ALERT_WORDS]) {
    assert.deepEqual(Object.keys(dict.uk).sort(), Object.keys(dict.en).sort());
    for (const lang of ["en", "uk"]) {
      for (const value of Object.values(dict[lang])) {
        const said = typeof value === "string" ? value : value("1", "2");
        assert.doesNotMatch(said, /profit guaranteed|x100|x1000|ікс|гарант|прибуток гарантовано/i);
      }
    }
  }
});
