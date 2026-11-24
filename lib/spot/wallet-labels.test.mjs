import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bigTradeUsdOf,
  EMPTY_WALLET_BOOK,
  FRESH_HOURS_ENV,
  FRESH_TX_ENV,
  freshCandidates,
  freshRuleOf,
  isWalletLabel,
  labelBasisOf,
  labelTrades,
  ownersOf,
  topHoldersOf,
  walletAgeOf,
  walletLabelsOf,
  WALLET_LABEL_DEFAULTS,
  WALLET_LABELS,
} from "./wallet-labels.ts";
import { AGE_PER_DAY, AGE_PER_MINUTE, AGE_PER_READ, WALLET_AGE_DAILY_ENV, WALLET_AGE_ENV, knownAges, readWalletAges, resetWalletAges, ryntraAgents, walletAgesOpen, walletLabelSettings } from "./wallet-labels.server.ts";

/* A mark is a fact the engine read — creator, Ryntra's agent, top holder, pool or program, a big trade, a fresh wallet — never a guess. */

const DEV = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const WHALE = "MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const POOL = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj";
const LOCK = "Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgeyG";
const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const NOW = Date.parse("2026-11-19T12:00:00Z");

const trade = (wallet, side, usd, n = 1) => ({ signature: `${"5".repeat(80)}${String(n).padStart(8, "1")}`, at: new Date(NOW - n * 1000).toISOString(), side, wallet, tokenAmount: 10, usd, priceUsd: usd === null ? null : usd / 10, capUsd: null });

const holders = [
  { owner: POOL, labels: ["pool"] },
  { owner: WHALE, labels: [] },
  { owner: LOCK, labels: ["program"] },
  { owner: DEV, labels: ["creator"] },
  { owner: OTHER, labels: [] },
];

test("the marks are a closed list", () => {
  assert.deepEqual([...WALLET_LABELS], ["creator", "ryntra-agent", "top-holder", "pool", "program", "big", "fresh"]);
  assert.equal(isWalletLabel("big"), true);
  assert.equal(isWalletLabel("smart-money"), false, "no mark from other companies' lists");
  assert.equal(isWalletLabel("sniper"), false);
});

test("the big-trade bar comes from the environment within reason, else $1 000", () => {
  assert.equal(bigTradeUsdOf(undefined), 1_000);
  assert.equal(bigTradeUsdOf(""), 1_000);
  assert.equal(bigTradeUsdOf("2500"), 2_500);
  assert.equal(bigTradeUsdOf(" 250.5 "), 250.5);
  assert.equal(bigTradeUsdOf("5"), 1_000, "below the floor");
  assert.equal(bigTradeUsdOf("1e9"), 1_000, "above the ceiling");
  assert.equal(bigTradeUsdOf("lots"), 1_000);
  assert.equal(walletLabelSettings({ RYNTRA_SPOT_BIG_TRADE_USD: "5000" }).bigTradeUsd, 5_000);
  assert.equal(walletLabelSettings({}).bigTradeUsd, 1_000);
});

test("the largest people rank without pools and programs; their owners are kept apart", () => {
  const ranks = topHoldersOf(holders);
  assert.deepEqual([...ranks], [[WHALE, 1], [DEV, 2], [OTHER, 3]]);
  assert.deepEqual([...topHoldersOf(holders, 1)], [[WHALE, 1]]);
  const owners = ownersOf(holders);
  assert.deepEqual([...owners.pools], [POOL]);
  assert.deepEqual([...owners.programs], [LOCK]);
});

test("a wallet's marks, in one order, each from its own read", () => {
  const book = {
    dev: DEV,
    agents: new Set([AGENT]),
    topHolders: topHoldersOf(holders),
    poolOwners: new Set([POOL]),
    programOwners: new Set([LOCK]),
    ages: new Map([[OTHER, { fresh: true, firstAt: "2026-11-19T00:00:00.000Z", transactions: 3, whole: true }], [WHALE, { fresh: false, firstAt: null, transactions: 20, whole: false }]]),
  };
  assert.deepEqual(walletLabelsOf(DEV, book, 5_000), ["creator", "top-holder", "big"]);
  assert.deepEqual(walletLabelsOf(AGENT, book, 10), ["ryntra-agent"]);
  assert.deepEqual(walletLabelsOf(WHALE, book, 999.99), ["top-holder"], "below the bar is not big; a long history is not fresh");
  assert.deepEqual(walletLabelsOf(WHALE, book, 1_000), ["top-holder", "big"], "the bar itself is big");
  assert.deepEqual(walletLabelsOf(OTHER, book, null), ["top-holder", "fresh"]);
  assert.deepEqual(walletLabelsOf(POOL, book, null), ["pool"]);
  assert.deepEqual(walletLabelsOf(LOCK, book, null), ["program"]);
  assert.deepEqual(walletLabelsOf(OTHER, EMPTY_WALLET_BOOK, 50_000), ["big"], "nothing read — only the trade's own size");
  assert.deepEqual(walletLabelsOf(WHALE, book, 2_000, { ...WALLET_LABEL_DEFAULTS, bigTradeUsd: 5_000 }), ["top-holder"]);
});

test("trades carry their marks; one with none carries no field at all", () => {
  const book = { ...EMPTY_WALLET_BOOK, dev: DEV };
  const out = labelTrades([trade(DEV, "sell", 20), trade(OTHER, "buy", 3_000, 2), trade(OTHER, "buy", 5, 3), { ...trade(WHALE, "buy", 1, 4), labels: ["big"] }], book);
  assert.deepEqual(out[0].labels, ["creator"]);
  assert.deepEqual(out[1].labels, ["big"]);
  assert.equal("labels" in out[2], false);
  assert.equal("labels" in out[3], false, "a stale mark is dropped, not kept");
  assert.equal(out[2].usd, 5, "the trade's own fields stay as they were");
});

test("the basis says what the marks stand on — «no mark» is never «not the creator» when nothing was read", () => {
  assert.deepEqual(labelBasisOf(EMPTY_WALLET_BOOK, [DEV, OTHER]), {
    creator: false,
    topHolders: null,
    agents: false,
    fresh: 0,
    bigTradeUsd: 1_000,
    freshRule: { maxAgeHours: 72, maxTransactions: 40 },
  });
  const book = { ...EMPTY_WALLET_BOOK, dev: DEV, agents: new Set([AGENT]), topHolders: new Map([[WHALE, 1]]), ages: new Map([[OTHER, { fresh: true, firstAt: null, transactions: 1, whole: true }]]) };
  const basis = labelBasisOf(book, [OTHER, OTHER, WHALE]);
  assert.equal(basis.creator, true);
  assert.equal(basis.topHolders, 1);
  assert.equal(basis.agents, true);
  assert.equal(basis.fresh, 1);
});

test("a wallet's age: a short young history is fresh; a long one never is; nothing read says nothing", () => {
  const s = (hoursAgo) => ({ blockTime: Math.floor((NOW - hoursAgo * 3_600_000) / 1000) });
  assert.deepEqual(walletAgeOf([s(1), s(5)], 20, NOW), { fresh: true, firstAt: new Date(Math.floor((NOW - 5 * 3_600_000) / 1000) * 1000).toISOString(), transactions: 2, whole: true });
  assert.equal(walletAgeOf([s(1), s(80)], 20, NOW).fresh, false, "older than three days");
  assert.equal(walletAgeOf([s(1), s(72)], 20, NOW).fresh, true, "three days is still fresh");
  const full = Array.from({ length: 20 }, () => s(1));
  assert.deepEqual(walletAgeOf(full, 20, NOW), { fresh: false, firstAt: null, transactions: 20, whole: false });
  assert.equal(walletAgeOf([], 20, NOW), null);
  assert.equal(walletAgeOf([{ blockTime: null }], 20, NOW), null);
  assert.equal(walletAgeOf([s(-2)], 20, NOW).fresh, false, "a time in the future is no age");
});

test("the wallets worth an age read: buyers first, largest first, none already known or marked", () => {
  const book = { ...EMPTY_WALLET_BOOK, dev: DEV, agents: new Set([AGENT]), poolOwners: new Set([POOL]), ages: new Map([[LOCK, { fresh: false, firstAt: null, transactions: 20, whole: false }]]) };
  const list = [trade(OTHER, "sell", 9_000, 1), trade(WHALE, "buy", 10, 2), trade(DEV, "buy", 50_000, 3), trade(AGENT, "buy", 40_000, 4), trade(LOCK, "buy", 30_000, 5), trade(OTHER, "buy", 500, 6), trade(POOL, "buy", 1, 7)];
  assert.deepEqual(freshCandidates(list, book, 8), [OTHER, WHALE]);
  assert.deepEqual(freshCandidates(list, book, 1), [OTHER]);
  assert.deepEqual(freshCandidates(list, book, 0), []);

  /* The wallets whose age is known are passed over: each read goes on down the list, so a watched coin's every buyer is reached — the small ones too. */
  const w = (i) => `${"W".repeat(40)}${String(100 + i)}`;
  const buys = Array.from({ length: 20 }, (_, i) => trade(w(i), "buy", 100 * (20 - i), i + 1));
  const ages = new Map();
  const reads = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const next = freshCandidates(buys, { ...EMPTY_WALLET_BOOK, ages }, AGE_PER_READ);
    reads.push(next.length);
    for (const wallet of next) ages.set(wallet, { fresh: false, firstAt: null, transactions: 40, whole: false });
  }
  assert.deepEqual(reads, [8, 8, 4]);
  assert.equal(ages.size, 20);
});

test("the fresh wallet's two bars are the deployment's to set, each within its range", () => {
  assert.deepEqual(freshRuleOf(undefined, undefined), { freshMaxAgeHours: 72, freshMaxTransactions: 40 });
  assert.deepEqual(freshRuleOf(" 168 ", "60"), { freshMaxAgeHours: 168, freshMaxTransactions: 60 });
  assert.deepEqual(freshRuleOf("0.5", "1"), { freshMaxAgeHours: 72, freshMaxTransactions: 40 }, "under the range");
  assert.deepEqual(freshRuleOf("9000", "5000"), { freshMaxAgeHours: 72, freshMaxTransactions: 40 }, "over the range: one list of the node is a thousand");
  assert.deepEqual(freshRuleOf("soon", "12.5"), { freshMaxAgeHours: 72, freshMaxTransactions: 40 }, "not a number; not a whole number of signatures");
  assert.equal(FRESH_HOURS_ENV, "RYNTRA_SPOT_FRESH_MAX_HOURS");
  assert.equal(FRESH_TX_ENV, "RYNTRA_SPOT_FRESH_MAX_TX");
  const set = walletLabelSettings({ [FRESH_HOURS_ENV]: "168", [FRESH_TX_ENV]: "100", RYNTRA_SPOT_BIG_TRADE_USD: "5000" });
  assert.deepEqual([set.freshMaxAgeHours, set.freshMaxTransactions, set.bigTradeUsd, set.topHolderRanks], [168, 100, 5_000, 20]);
  /* The rule set is the rule read by: a wallet of sixty signatures a week old. */
  const s = (hoursAgo) => ({ blockTime: Math.floor((NOW - hoursAgo * 3_600_000) / 1000) });
  const sixty = Array.from({ length: 60 }, (_, i) => s(i < 59 ? 1 : 150));
  assert.equal(walletAgeOf(sixty.slice(0, 20), 20, NOW).fresh, false, "by the default rule a list as long as the bar is a long history");
  assert.equal(walletAgeOf(sixty, 100, NOW, set).fresh, true);
  assert.equal(labelBasisOf(EMPTY_WALLET_BOOK, [], set).freshRule.maxTransactions, 100, "and the answer says which rule it read by");
});

/* Real wallets, read 20.11.2026 (`fixtures/wallet-ages-chain.json`): the mark did not show on any coin checked that day — is the reading wrong, or the rule? */
const agesChain = JSON.parse(readFileSync(new URL("./fixtures/wallet-ages-chain.json", import.meta.url), "utf8"));

test("a wallet that looks new by its last day is judged by its whole history — the reading is right", () => {
  const { blockTimes, readAt } = agesChain.quietButOld;
  const now = Date.parse(readAt);
  const listed = (limit) => blockTimes.slice(0, limit).map((blockTime) => ({ blockTime }));
  assert.equal(blockTimes.length, 139);
  /* What a node keeping a day and a half of history lists for it: twelve signatures, the oldest sixteen hours back. */
  const lastDay = blockTimes.filter((time) => now / 1000 - time < 33 * 3_600).map((blockTime) => ({ blockTime }));
  assert.equal(lastDay.length, 12);
  assert.equal(walletAgeOf(lastDay, 40, now).fresh, true, "by that alone the largest buyer of a coin three minutes old would pass for fresh");
  /* The engine's own node keeps everything: the list comes back as long as it was asked for — a long history, not fresh. */
  assert.deepEqual(walletAgeOf(listed(40), 40, now), { fresh: false, firstAt: null, transactions: 40, whole: false });
  assert.equal(walletAgeOf(listed(20), 20, now, { ...WALLET_LABEL_DEFAULTS, freshMaxTransactions: 20 }).fresh, false, "nor by the rule it was read by that day");
  /* Read whole under the widest bar there is, its first signature is sixteen months old. */
  const whole = walletAgeOf(listed(1_000), 1_000, now, { ...WALLET_LABEL_DEFAULTS, freshMaxTransactions: 1_000 });
  assert.deepEqual([whole.whole, whole.transactions, whole.fresh, whole.firstAt.slice(0, 7)], [true, 139, false, "2025-07"]);
});

test("the rule on the buyers measured: under twenty signatures none is fresh; under forty and 72 hours three of 123 are", () => {
  const fresh = (rows, transactions, hours) => rows.filter((row) => !row.more && row.signatures < transactions && row.firstHoursAgo <= hours);
  const { hourOldCoin, sevenMinuteCoin } = agesChain.verified;
  /* An hour-old coin, 93 buyers: the twenty that looked quiet all have long histories — no rule of signatures marks any. */
  assert.equal(hourOldCoin.buyers, 93);
  assert.equal(Math.min(...hourOldCoin.candidates.map((row) => row.signatures)), 244);
  assert.equal(fresh(hourOldCoin.candidates, 200, Number.MAX_SAFE_INTEGER).length, 0);
  /* A seven-minute-old coin, 123 buyers. */
  assert.equal(sevenMinuteCoin.buyers, 123);
  assert.equal(fresh(sevenMinuteCoin.candidates, 20, 72).length, 0, "the rule of twenty: no mark at all");
  const marked = fresh(sevenMinuteCoin.candidates, WALLET_LABEL_DEFAULTS.freshMaxTransactions, WALLET_LABEL_DEFAULTS.freshMaxAgeHours);
  assert.deepEqual(marked.map((row) => [row.signatures, row.firstHoursAgo]), [[24, 3.3], [36, 20.7], [28, 69.2]]);
  assert.deepEqual([WALLET_LABEL_DEFAULTS.freshMaxTransactions, WALLET_LABEL_DEFAULTS.freshMaxAgeHours], [40, 72]);
  /* They are small buyers — 64th, 73rd and 83rd by size: eight wallets a read, the mark shows from the eighth to the eleventh read of a coin someone keeps open. */
  assert.deepEqual(marked.map((row) => row.rankBySize), [64, 73, 83]);
  assert.ok(marked.every((row) => row.buyUsd < 10));
  assert.deepEqual(marked.map((row) => Math.ceil(row.rankBySize / AGE_PER_READ)), [8, 10, 11]);
  /* A coin three minutes old: its largest buyers look quiet, and are wallets of fourteen months and more — no bar of age within the range marks them. */
  const { largest } = agesChain.verified.threeMinuteCoin;
  assert.deepEqual(largest.map((row) => row.rankBySize), [1, 3, 4, 5, 6, 7]);
  assert.ok(largest.every((row) => row.signaturesLast33h < 20 && row.signatures >= 68 && row.firstHoursAgo > 9_000));
  assert.equal(fresh(largest, 1_000, 720).length, 0);
});

test("the age read asks for as many signatures as the rule's bar, whatever the deployment sets", async () => {
  resetWalletAges();
  const asked = [];
  const list = async (wallet, limit) => {
    asked.push(limit);
    return Array.from({ length: 60 }, () => ({ blockTime: Math.floor(NOW / 1000) - 3_600 }));
  };
  const env = { [WALLET_AGE_ENV]: "on", [FRESH_TX_ENV]: "100" };
  await readWalletAges([OTHER], walletLabelSettings(env), { list, now: () => NOW, env });
  assert.deepEqual(asked, [100]);
  assert.equal(knownAges([OTHER], NOW).get(OTHER).fresh, true, "sixty signatures an hour old: fresh under a bar of a hundred");
  resetWalletAges();
});

test("Ryntra's agents are the registry's agent keys", () => {
  assert.equal(ryntraAgents().has(AGENT), true);
  assert.deepEqual([...ryntraAgents([{ role: "AGENT_SIGNER", network: "solana", address: OTHER }, { role: "FEE", network: "solana", address: WHALE }, { role: "AGENT_SIGNER", network: "solana", address: null }])], [OTHER]);
});

const OPEN = { [WALLET_AGE_ENV]: "on" };

test("ages are read only where the deployment opens them: closed by default, nothing is asked of the node", async () => {
  resetWalletAges();
  const asked = [];
  const list = async (wallet) => (asked.push(wallet), []);
  assert.equal(walletAgesOpen({}), false);
  assert.equal(walletAgesOpen({ [WALLET_AGE_ENV]: "1" }), false, "only exactly «on» opens it");
  assert.equal(walletAgesOpen(OPEN), true);
  await readWalletAges([OTHER, WHALE], WALLET_LABEL_DEFAULTS, { list, now: () => NOW, env: {} });
  assert.deepEqual(asked, []);
  resetWalletAges();
});

test("ages are read a few at a time, within a minute's budget, and kept", async () => {
  resetWalletAges();
  const asked = [];
  const young = [{ blockTime: Math.floor(NOW / 1000) - 60 }];
  const list = async (wallet, limit) => {
    asked.push([wallet, limit]);
    if (wallet === LOCK) throw new Error("node down");
    return wallet === WHALE ? Array.from({ length: limit }, () => young[0]) : young;
  };
  const wallets = [OTHER, WHALE, LOCK, ...Array.from({ length: 20 }, (_, i) => `${"A".repeat(40)}${String(1_000 + i)}`)];
  await readWalletAges(wallets, WALLET_LABEL_DEFAULTS, { list, now: () => NOW, env: OPEN });
  assert.equal(asked.length, AGE_PER_READ);
  assert.deepEqual(asked[0], [OTHER, 40]);
  const known = knownAges([OTHER, WHALE, LOCK], NOW);
  assert.equal(known.get(OTHER).fresh, true);
  assert.equal(known.get(WHALE).fresh, false);
  assert.equal(known.has(LOCK), false, "a wallet the node did not list is not known");
  asked.length = 0;
  await readWalletAges([OTHER, WHALE], WALLET_LABEL_DEFAULTS, { list, now: () => NOW, env: OPEN });
  assert.deepEqual(asked, [], "known ages are not read again");
  assert.equal(knownAges([OTHER], NOW + 31 * 60_000).has(OTHER), false, "a fresh wallet is read again after half an hour");
  assert.equal(knownAges([WHALE], NOW + 23 * 3_600_000).has(WHALE), true, "a settled one is kept for a day");

  resetWalletAges();
  asked.length = 0;
  const many = Array.from({ length: 200 }, (_, i) => `${"B".repeat(40)}${String(1_000 + i)}`);
  for (let start = 0; start < many.length; start += AGE_PER_READ) await readWalletAges(many.slice(start, start + AGE_PER_READ), WALLET_LABEL_DEFAULTS, { list, now: () => NOW, env: OPEN });
  assert.equal(asked.length, AGE_PER_MINUTE, "the minute's budget holds");
  await readWalletAges([`${"C".repeat(43)}`], WALLET_LABEL_DEFAULTS, { list, now: () => NOW + 61_000, env: OPEN });
  assert.equal(asked.length, AGE_PER_MINUTE + 1, "a new minute, a new budget");
  resetWalletAges();
});

test("ages have a day's ceiling per instance too: past it no wallet is aged until the next UTC day", async () => {
  resetWalletAges();
  assert.equal(WALLET_AGE_DAILY_ENV, "RYNTRA_SPOT_WALLET_AGES_DAILY_READS");
  assert.equal(AGE_PER_DAY, 5_000);
  const asked = [];
  const list = async (wallet) => {
    asked.push(wallet);
    return [{ blockTime: Math.floor(NOW / 1000) - 60 }];
  };
  const env = { ...OPEN, [WALLET_AGE_DAILY_ENV]: "10" };
  const wallets = Array.from({ length: 40 }, (_, i) => `${"D".repeat(40)}${String(1_000 + i)}`);
  /* A new minute each time, so only the day's ceiling can stop the reads. */
  for (let turn = 0; turn < 5; turn += 1) await readWalletAges(wallets.slice(turn * AGE_PER_READ, (turn + 1) * AGE_PER_READ), WALLET_LABEL_DEFAULTS, { list, now: () => NOW + turn * 61_000, env });
  assert.equal(asked.length, 10, "ten reads in the day, however many minutes pass");
  await readWalletAges(wallets.slice(30), WALLET_LABEL_DEFAULTS, { list, now: () => Date.parse("2026-11-19T23:59:59Z"), env });
  assert.equal(asked.length, 10);
  await readWalletAges(wallets.slice(30), WALLET_LABEL_DEFAULTS, { list, now: () => Date.parse("2026-11-20T00:00:00Z"), env });
  assert.equal(asked.length, 10 + AGE_PER_READ, "midnight UTC: a new day");
  resetWalletAges();
});
