import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adds, bestPool, coinPools, coinPositions, hasPool, positionTicket, rowTicket } from "./earn-here.ts";
import { EARN_HERE } from "./words.ts";

/* Liquidity on the coin's own screen: which of Earn's rows are the coin's, which ticket each opens, and that
   the screen lays out Earn's own tickets without a money path of its own. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";

const row = (address, x, y, act, tvlUsd, fees24hUsd = null, type = "dlmm") => ({
  key: `${type}:${address}`,
  type,
  address,
  name: `${x} · ${y}`,
  coins: [
    { mint: x, symbol: x.slice(0, 3) },
    { mint: y, symbol: y.slice(0, 3) },
  ],
  verified: true,
  tvlUsd,
  volume24hUsd: null,
  fees24hUsd,
  feeTvlPct: null,
  baseFeePct: null,
  feePct: 0.1,
  step: type === "damm-v2" ? null : 10,
  createdAt: null,
  page: null,
  act,
});

test("the coin's pools: only those that hold it, the deepest first, one row per pool", () => {
  const rows = [
    row("A", JUP, SOL, "view", 2_000_000),
    row("B", SOL, USDC, "add", 9_000_000),
    row("C", USDC, JUP, "view", 5_000_000, null, "damm-v2"),
    row("A", JUP, SOL, "view", 2_000_000),
    row("D", JUP, USDC, "pro", null, null, "pro"),
  ];
  assert.deepEqual(coinPools(rows, JUP).map((r) => r.address), ["C", "A", "D"]);
  assert.deepEqual(coinPools(rows, MET), []);
});

test("a pool that takes a deposit here stays in the list, even past the deepest few", () => {
  const rows = [row("A", JUP, SOL, "view", 3), row("B", JUP, USDC, "view", 2), row("C", JUP, MET, "add", 1)];
  assert.deepEqual(coinPools(rows, JUP, 1).map((r) => r.address), ["A", "C"]);
});

test("a row opens Earn's own ticket: the city's add, DLMM Pro's add, or the pool shown to compare", () => {
  assert.deepEqual(rowTicket({ act: "add", address: "A" }), { kind: "pool", address: "A" });
  assert.deepEqual(rowTicket({ act: "pro", address: "B" }), { kind: "pro", address: "B" });
  assert.deepEqual(rowTicket({ act: "view", address: "C" }), { kind: "view", address: "C" });
  assert.equal(adds({ act: "add" }), true);
  assert.equal(adds({ act: "pro" }), true);
  assert.equal(adds({ act: "view" }), false);
});

test("«Earn on it» opens the pool that paid the most of those that take a deposit; else the deepest; else none", () => {
  const rows = [row("A", JUP, SOL, "view", 9_000_000, 900), row("B", JUP, USDC, "add", 100_000, 40), row("C", JUP, MET, "pro", 50_000, 60, "pro")];
  assert.equal(bestPool(rows).address, "C");
  assert.equal(bestPool([row("A", JUP, SOL, "view", 1), row("B", JUP, USDC, "view", 5)]).address, "B");
  assert.equal(bestPool([]), null);
});

test("the person's pools with the coin: pool and DLMM Pro positions that hold it; staking and lending are not pools", () => {
  const positions = [
    { key: "pool:P1", kind: "pool", ref: "P1", name: "JUP · SOL", coins: [{ mint: JUP, symbol: "JUP" }, { mint: SOL, symbol: "SOL" }] },
    { key: "pro:N1", kind: "pro", ref: "N1", name: "SOL · JUP", coins: [{ mint: SOL, symbol: "SOL" }, { mint: JUP, symbol: "JUP" }] },
    { key: "pool:P2", kind: "pool", ref: "P2", name: "SOL · USDC", coins: [{ mint: SOL, symbol: "SOL" }, { mint: USDC, symbol: "USDC" }] },
    { key: "stake:jito", kind: "stake", ref: "jito", name: "JitoSOL", coins: [{ mint: JUP, symbol: "X" }] },
  ];
  assert.deepEqual(coinPositions(positions, JUP).map((p) => p.ref), ["P1", "N1"]);
});

test("«Take» opens the same ticket as Earn's «My positions»: fees where the city lets the wallet out, Pro collects or closes", () => {
  const pool = { kind: "pool", ref: "P1" };
  const pro = { kind: "pro", ref: "N1" };
  assert.deepEqual(positionTicket(pool, { exitOpen: true, proBoats: [] }), { kind: "position", address: "P1", act: "claim" });
  assert.equal(positionTicket(pool, { exitOpen: false, proBoats: [] }), null);
  assert.deepEqual(positionTicket(pro, { exitOpen: false, proBoats: [{ nftMint: "N1", empty: false }] }), { kind: "proPosition", nftMint: "N1", act: "collect" });
  assert.deepEqual(positionTicket(pro, { exitOpen: false, proBoats: [{ nftMint: "N1", empty: true }] }), { kind: "proPosition", nftMint: "N1", act: "close" });
  assert.equal(positionTicket(pro, { exitOpen: true, proBoats: [] }), null);
});

test("the quiet action after a buy stands only where the catalogue names a pool of the coin", () => {
  const pools = [{ x: { mint: JUP }, y: { mint: SOL } }];
  assert.equal(hasPool(pools, JUP), true);
  assert.equal(hasPool(pools, SOL), true);
  assert.equal(hasPool(pools, MET), false);
});

test("the words: the same keys and the same arguments in English and Ukrainian, nothing technical", () => {
  const { en, uk } = EARN_HERE;
  assert.ok(en && uk, "both languages are written");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(uk).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof en[key], typeof uk[key], key);
    if (typeof en[key] === "function") assert.equal(en[key].length, uk[key].length, key);
  }
  const all = JSON.stringify([en, uk].map((side) => Object.values(side).map((v) => (typeof v === "function" ? v("X", "Y") : v))));
  assert.doesNotMatch(all, /\b(API|endpoint|engine|RPC|devnet|JSON|DLX)\b|двигун|ендпоінт/i);
});

test("the screen lays out Earn's own tickets and reads: no signature, no fee, no route of its own", () => {
  const screen = read("./EarnHere.tsx");
  const store = read("./store.ts");
  for (const source of [screen, store]) {
    assert.doesNotMatch(source, /fetch\(|signTransaction|sendTransaction|\/api\/(?!v1\/earn\/pools)/);
  }
  assert.match(screen, /TicketBody/);
  assert.match(screen, /ViewTicket/);
  assert.match(store, /pick\(ticket, ON_COIN\)/);
  // The drawer never closes under a signature.
  assert.match(store, /if \(ticketHeld\(\)\) return false;/);
});

test("the coin's panel offers «Pools» on a desk and «My pools» with a wallet; a phone has «Pools» as a view of its own", () => {
  const under = read("../CoinUnder.tsx");
  const screen = read("../CoinScreen.tsx");
  assert.match(under, /\{ id: 'lp' as const, label: lw\.myPools \}/);
  assert.match(under, /earn === 'all' \? \[\{ id: 'pools' as const, label: lw\.pools \}\]/);
  assert.match(screen, /\{ id: 'pools', label: hw\.pools, draw: \(\) => <CoinPools mint=\{mint\} sym=\{sym\} phone \/> \}/);
  assert.match(screen, /<EarnDrawer mint=\{mint\} sym=\{sym\} \/>/);
  // «Earn on it» only after a buy of this coin, and only where a pool of it is.
  const ticket = read("../Ticket.tsx");
  assert.match(ticket, /onEarn && bought && trade\.outputMint === tower\.mint/);
  assert.match(screen, /withPool \? \(\) => openBest\(mint\) : undefined/);
});
