import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { launchesOf, moveOfParsed, movesOf, scanPageOf, ScanMalformed } from "./creator-chain.ts";
import { CREATOR_DAILY_CREDITS, creatorDaySpent, creatorOpen, creatorScanEndpoint, resetCreatorScan } from "./creator-scan.server.ts";
import { LAUNCH_CALLS, MOVE_CALLS, PEAK_READS, readCreator, resetCreatorReads } from "./creator.server.ts";
import {
  LAUNCH_PROGRAMS,
  balanceOfParsedAccounts,
  creatorActionOf,
  creatorCoinsOf,
  creatorCountsOf,
  launchesBody,
  movesBody,
  peakCandidates,
  peakOfBars,
} from "./creator.ts";

/*
 * The creator's tab: the coins the creator launched (the chain, through Helius's scan), how each went
 * (Jupiter, GeckoTerminal's daily bars), and what it did with this coin — read on recorded answers in the published
 * shape (`fixtures/creator-scan.json`), behind a closed switch, within a day's ceiling of credits.
 */

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/creator-scan.json", import.meta.url), "utf8"));
const A = FIXTURE.addresses;
const T0 = 1_795_000_000;
const ENDPOINT = "https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=0123abcd-4567-89ef-0123-456789abcdef";
const ON = { RYNTRA_SPOT_CREATOR: "on" };

const launchPages = () => [scanPageOf(FIXTURE.launches.first), scanPageOf(FIXTURE.launches.second)];
const movePages = () => [scanPageOf(FIXTURE.moves.first), scanPageOf(FIXTURE.moves.second)];

test("closed unless the deployment says on; the scan only where the node is Helius's with its key", () => {
  assert.equal(creatorOpen({}), false);
  assert.equal(creatorOpen({ RYNTRA_SPOT_CREATOR: "yes" }), false);
  assert.equal(creatorOpen({ RYNTRA_SPOT_CREATOR: " ON " }), true);
  assert.equal(creatorScanEndpoint({}, "https://mainnet.helius-rpc.com/?api-key=0123abcd-4567"), null);
  assert.equal(creatorScanEndpoint(ON, "https://mainnet.helius-rpc.com/?api-key=0123abcd-4567"), "https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=0123abcd-4567");
  assert.equal(creatorScanEndpoint(ON, "https://solana-rpc.publicnode.com"), null);
});

test("the scan is asked only what Helius knows: the creator's launches on the three curves, a wallet's moves of one coin since its birth", () => {
  const launches = launchesBody(A.CREATOR);
  assert.deepEqual(launches.match, { programs: LAUNCH_PROGRAMS.map((programId) => ({ programId, scope: "transaction" })) });
  assert.equal(launches.address, A.CREATOR);
  assert.equal(launches.returnShape, "transactions");
  assert.equal(launches.limit, 100);
  assert.equal(launches.tokenAccounts, "none");
  assert.deepEqual(launches.budget, { maxScannedTransactions: 10_000 });
  assert.equal("time" in launches, false);
  assert.equal(launchesBody(A.CREATOR, "next").paginationToken, "next");
  const moves = movesBody(A.H1, A.MINT, { sinceS: T0 - 60, limit: 50, budget: 3_000 });
  assert.deepEqual(moves.match, { mints: [{ mint: A.MINT, scope: "address" }] });
  assert.equal(moves.tokenAccounts, "balanceChanged", "a transfer in the wallet never signed is still its own");
  assert.deepEqual(moves.time, { gte: T0 - 60 });
  assert.equal(moves.limit, 50);
  assert.deepEqual(moves.budget, { maxScannedTransactions: 3_000 });
});

test("a page of the scan: its parsed transactions, its cursor and its cost; anything else is not a page", () => {
  const first = scanPageOf(FIXTURE.launches.first);
  assert.equal(first.items.length, 4);
  assert.equal(first.next, "cursor-launches-2");
  assert.equal(first.credits, 20);
  assert.equal(scanPageOf(FIXTURE.launches.second).next, null);
  assert.deepEqual(scanPageOf({ data: [] }), { items: [], next: null, scanned: 0, credits: 0 });
  assert.throws(() => scanPageOf({ data: {} }), ScanMalformed);
  assert.throws(() => scanPageOf({ data: [{ signature: "nope", parsed: {} }] }), ScanMalformed);
  assert.throws(() => scanPageOf(null), ScanMalformed);
});

test("the creator's launches: a new coin's supply minted in a transaction it paid for — not its trades, not a receipt, not another's launch", () => {
  const launches = launchesOf(launchPages(), A.CREATOR);
  assert.deepEqual(launches.map((launch) => launch.mint), [A.COIN_A, A.COIN_B, A.MINT]);
  assert.equal(launches[2].at, T0);
  assert.deepEqual(launchesOf(launchPages(), A.W1).map((launch) => launch.mint), [A.COIN_X], "the other wallet's launch is its own");
});

test("the creator's moves of the coin: bought at launch, moved to two wallets, sold on the curve", () => {
  const moves = movesOf(movePages(), A.CREATOR, A.MINT);
  assert.deepEqual(
    moves.map((move) => [move.dir, move.kind, move.amount, move.party]),
    [
      ["out", "transfer", 5_000_000, A.W2],
      ["out", "trade", 20_000_000, null],
      ["out", "transfer", 10_000_000, A.W1],
      ["in", "trade", 50_000_000, null],
    ],
  );
  assert.equal(moves.every((move) => move.paidBy === null), true, "the creator paid for its own moves");
  const item = scanPageOf(FIXTURE.moves.first).items[0];
  assert.equal(moveOfParsed(item, A.W1, A.MINT), null, "W1 did not move in W2's transfer");
  assert.equal(moveOfParsed(item, A.W2, A.MINT).dir, "in");
  assert.equal(moveOfParsed(item, A.W2, A.MINT).paidBy, A.CREATOR, "someone else paid for W2's coins");
  assert.equal(moveOfParsed({ ...item, parsed: { ...item.parsed, transactionStatus: "FAILED" } }, A.W2, A.MINT), null);
});

test("the balance of a wallet from the node's parsed accounts; any other shape says nothing, never zero", () => {
  assert.equal(balanceOfParsedAccounts(FIXTURE.balance), 15_000_000);
  assert.equal(balanceOfParsedAccounts([]), 0);
  assert.equal(balanceOfParsedAccounts(null), null);
  assert.equal(balanceOfParsedAccounts([{ account: { data: { parsed: { info: { tokenAmount: { amount: 12 } } } } } }]), null);
});

test("what the creator did: moving coins to other wallets stands over selling; then sold all, sold some, holds, never held", () => {
  const moves = movesOf(movePages(), A.CREATOR, A.MINT);
  const moved = creatorActionOf({ moves, balance: balanceOfParsedAccounts(FIXTURE.balance), supply: 1_000_000_000, whole: true });
  assert.equal(moved.did, "moved");
  assert.equal(moved.soldPct, 40);
  assert.equal(moved.movedPct, 30);
  assert.equal(moved.holds, 15_000_000);
  assert.equal(moved.holdsPct, 1.5);
  assert.deepEqual(moved.movedTo, [A.W1, A.W2]);
  assert.equal(moved.moves, 4);

  const bought = moves.filter((move) => move.dir === "in");
  const sale = moves.filter((move) => move.kind === "trade");
  assert.equal(creatorActionOf({ moves: bought, balance: 50_000_000, supply: 1e9, whole: true }).did, "holds");
  assert.equal(creatorActionOf({ moves: sale, balance: 30_000_000, supply: 1e9, whole: true }).did, "soldSome");
  assert.equal(creatorActionOf({ moves: sale, balance: 20, supply: 1e9, whole: true }).did, "soldAll", "dust is nothing left");
  assert.equal(creatorActionOf({ moves: sale, balance: null, supply: 1e9, whole: true }).did, "soldSome", "without a balance, a whole history's net stands for it");
  assert.equal(creatorActionOf({ moves: [], balance: 0, supply: 1e9, whole: true }).did, "never");
  assert.equal(creatorActionOf({ moves: [], balance: 0, supply: 1e9, whole: true }).soldPct, null);
  assert.equal(creatorActionOf({ moves: [], balance: 3_000, supply: 1e9, whole: false }).did, "holds", "a balance from before the span read still holds");
  assert.equal(creatorActionOf({ moves: bought, balance: 50_000_000, supply: null, whole: true }).holdsPct, null);
});

const market = (mint, symbol, cap, extra = {}) => ({ mint, symbol, name: `${symbol} coin`, icon: `https://img.example/${symbol}.png`, price: cap / 1e9, marketCapUsd: cap, category: null, ...extra });
const facts = (mint, extra = {}) => ({ mint, circulatingSupply: 1e9, totalSupply: 1e9, dev: A.CREATOR, devMints: null, devMigrations: null, launchpad: "pump.fun", graduatedAt: null, createdAt: null, windows: {}, socials: [], ...extra });

test("the creator's coins: the newest first, this coin always among them, the highest capitalisation never under today's", () => {
  const launches = launchesOf(launchPages(), A.CREATOR);
  const markets = new Map([
    [A.COIN_A, market(A.COIN_A, "AAA", 40_000)],
    [A.COIN_B, market(A.COIN_B, "BBB", 2_000_000, { icon: null })],
    [A.MINT, market(A.MINT, "THIS", 90_000)],
  ]);
  const factsBy = new Map([
    [A.COIN_A, facts(A.COIN_A)],
    [A.COIN_B, facts(A.COIN_B, { launchpad: "met-dbc", graduatedAt: "2026-11-18T00:00:00.000Z" })],
  ]);
  const peaks = new Map([[A.COIN_A, 1_250_000], [A.COIN_B, 1_000_000]]);
  const coins = creatorCoinsOf({ mint: A.MINT, launches, markets, facts: factsBy, peaks });
  assert.deepEqual(coins.map((coin) => coin.symbol), ["AAA", "BBB", "THIS"]);
  assert.equal(coins[0].launchedAt, new Date((T0 + 3 * 86_400) * 1000).toISOString());
  assert.equal(coins[0].peakCapUsd, 1_250_000);
  assert.equal(coins[1].peakCapUsd, 2_000_000, "a peak read under today's cap is today's cap");
  assert.equal(coins[1].icon, false);
  assert.equal(coins[1].listed, true);
  assert.equal(coins[0].listed, false, "on its curve still");
  assert.equal(coins[2].listed, null, "no facts: not known");
  assert.equal(coins[2].peakCapUsd, null, "not read: a dash, never a guess");
  assert.equal(coins[2].current, true);

  const many = Array.from({ length: 30 }, (_, i) => ({ mint: `${A.COIN_A.slice(0, -2)}${String(i).padStart(2, "A")}`, at: T0 + 10_000 + i, signature: "s" }));
  const capped = creatorCoinsOf({ mint: A.MINT, launches: many, markets, facts: factsBy, peaks, limit: 24 });
  assert.equal(capped.length, 24);
  assert.equal(capped.at(-1).mint, A.MINT, "this coin keeps its place even past the newest");

  assert.deepEqual(peakCandidates(coins, 2), [A.COIN_B, A.MINT], "those that left their curve first, then the largest now");
  assert.equal(peakOfBars([{ high: 0.0001 }, { high: 0.0004 }, { high: Number.NaN }], 1e9), 400_000);
  assert.equal(peakOfBars([], 1e9), null);
  assert.equal(peakOfBars([{ high: 1 }], null), null);
});

test("the counts the tab says: Jupiter's where it gives them, the larger of the two, and whether the list is every launch", () => {
  const coins = [{ listed: true }, { listed: false }, { listed: false }];
  assert.deepEqual(creatorCountsOf(facts(A.MINT, { devMints: 14, devMigrations: 1 }), coins, true), { launched: 14, listed: 1, whole: false });
  assert.deepEqual(creatorCountsOf(facts(A.MINT, { devMints: 2, devMigrations: 0 }), coins, true), { launched: 3, listed: 1, whole: true });
  assert.deepEqual(creatorCountsOf(facts(A.MINT), coins, true), { launched: 3, listed: 1, whole: true });
  assert.deepEqual(creatorCountsOf(facts(A.MINT), coins, false), { launched: null, listed: null, whole: false });
});

/** A scan that answers from the fixture by what it is asked: the launches or the moves, by cursor. */
function recordedScan(calls) {
  return async (url, init) => {
    assert.equal(url, ENDPOINT);
    const body = JSON.parse(init.body);
    calls.push(body);
    const kind = body.match.programs ? "launches" : "moves";
    const pageOf = body.paginationToken ? FIXTURE[kind].second : FIXTURE[kind].first;
    return new Response(JSON.stringify(pageOf), { status: 200 });
  };
}

function deps(calls, extra = {}) {
  let now = Date.UTC(2026, 10, 20, 12);
  return {
    env: ON,
    now: () => now,
    tick: (ms) => (now += ms),
    scan: { endpoint: ENDPOINT, fetch: recordedScan(calls) },
    facts: async () => ({ ok: true, market: market(A.MINT, "THIS", 90_000), facts: facts(A.MINT, { devMints: 3, devMigrations: 1, createdAt: new Date(T0 * 1000).toISOString() }), stale: false }),
    markets: async (mints) => ({
      ok: true,
      byMint: new Map(mints.map((mint) => [mint, market(mint, mint === A.COIN_A ? "AAA" : "BBB", mint === A.COIN_A ? 40_000 : 2_000_000)])),
      facts: new Map(mints.map((mint) => [mint, facts(mint, mint === A.COIN_B ? { graduatedAt: "2026-11-18T00:00:00.000Z" } : {})])),
    }),
    balance: async (owner, mint) => (owner === A.CREATOR && mint === A.MINT ? balanceOfParsedAccounts(FIXTURE.balance) : null),
    bars: async (mint) => (mint === A.COIN_B ? [{ high: 0.004 }] : [{ high: 0.0002 }]),
    ...extra,
  };
}

test("the creator's tab read whole: four scan calls at most, the balance, one search, a few daily bars — then kept", async () => {
  resetCreatorReads();
  resetCreatorScan();
  const calls = [];
  const d = deps(calls);
  const read = await readCreator(A.MINT, d);
  assert.equal(read.ok, true);
  assert.equal(read.creator, A.CREATOR);
  assert.deepEqual(read.coins.map((coin) => coin.mint), [A.COIN_A, A.COIN_B, A.MINT]);
  assert.equal(read.launched, 3);
  assert.equal(read.listed, 1);
  assert.equal(read.coinsWhole, true);
  assert.equal(read.action.did, "moved");
  assert.equal(read.action.holdsPct, 1.5);
  assert.equal(read.coins.find((coin) => coin.mint === A.COIN_B).peakCapUsd, 4_000_000);
  assert.equal(read.coins.find((coin) => coin.mint === A.MINT).peakCapUsd, 200_000);
  assert.equal(read.stale, false);
  assert.equal(calls.length, LAUNCH_CALLS + MOVE_CALLS);
  assert.deepEqual(calls.filter((body) => body.match.mints).map((body) => body.time), [{ gte: T0 - 60 }, { gte: T0 - 60 }], "the creator's moves since the coin's birth");
  assert.equal(creatorDaySpent(d.now()), 20 + 15 + 13 + 11, "what the four calls were charged");
  assert.ok(PEAK_READS >= 3);

  calls.length = 0;
  assert.deepEqual(await readCreator(A.MINT, d), read, "kept: nothing asked again");
  assert.equal(calls.length, 0);
});

test("closed, a coin without a creator, SOL: an answer about the coin, nothing asked of the chain", async () => {
  resetCreatorReads();
  resetCreatorScan();
  const calls = [];
  assert.equal((await readCreator(A.MINT, { ...deps(calls), env: {} })).code, "CLOSED");
  assert.equal((await readCreator("So11111111111111111111111111111111111111112", deps(calls))).code, "NOT_READ");
  const noDev = deps(calls, { facts: async () => ({ ok: true, market: market(A.MINT, "THIS", 1), facts: facts(A.MINT, { dev: null }), stale: false }) });
  assert.equal((await readCreator(A.MINT, noDev)).code, "NO_CREATOR");
  const stock = deps(calls, { facts: async () => ({ ok: true, market: market(A.MINT, "AAPLx", 1, { category: "stock" }), facts: facts(A.MINT), stale: false }) });
  assert.equal((await readCreator(A.MINT, stock)).code, "NO_CREATOR");
  const unlisted = deps(calls, { facts: async () => ({ ok: true, market: null, facts: null, stale: false }) });
  assert.equal((await readCreator(A.MINT, unlisted)).code, "NO_CREATOR");
  const down = deps(calls, { facts: async () => ({ ok: false, code: "RATE_LIMITED", reason: "spent", retryAfterMs: 3_000 }) });
  assert.deepEqual(await readCreator(A.MINT, down), { ok: false, code: "RATE_LIMITED", reason: "spent", retryAfterMs: 3_000 });
  assert.equal(calls.length, 0);
});

test("the chain quiet: the creator and this coin still named, what it did not said; the scan rests and the answer is not kept", async () => {
  resetCreatorReads();
  resetCreatorScan();
  let asked = 0;
  const quiet = deps([], { scan: { endpoint: ENDPOINT, fetch: async () => (asked++, new Response("busy", { status: 500 })) } });
  const read = await readCreator(A.MINT, quiet);
  assert.equal(read.ok, true);
  assert.equal(read.action, null);
  assert.deepEqual(read.coins.map((coin) => coin.mint), [A.MINT]);
  assert.equal(read.launched, 3, "Jupiter's count still stands");
  assert.equal(read.coinsWhole, false);
  assert.ok(asked <= 2, "one failure rests the scan: the other read is not made");
  quiet.tick(30_000);
  await readCreator(A.MINT, quiet);
  assert.ok(asked <= 2, "resting: not asked again within the minute");
});

test("a day's ceiling: past it the scan is not asked, and the tab says what the catalogue says", async () => {
  resetCreatorReads();
  resetCreatorScan();
  const calls = [];
  const tight = deps(calls, { env: { ...ON, RYNTRA_SPOT_CREATOR_DAILY_CREDITS: "50" } });
  const read = await readCreator(A.MINT, tight);
  assert.equal(calls.length, 0, "four calls' worst cost (80) does not fit under 50");
  assert.equal(read.action, null);
  assert.equal(CREATOR_DAILY_CREDITS, 15_000);
});
