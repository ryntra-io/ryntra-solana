// Run from repo root: node --test lib/bots/ladder/ladder.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createRequire } from "node:module";

import { Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import { BIN_ARRAY_RENT_LAMPORTS, binArrayRent, costsRose, costVerdict, LADDER_MAINNET_CU_PRICE, ladderCosts, orderAccountRent, priorityLamports, sameCosts, SOL_RESERVE_LAMPORTS, solNeededLamports } from "./costs.ts";
import { addressOf, binIsEmpty, canDoFromOrders, decodeLimitOrderAccount, decodePlaceData, matchesRungs } from "./decode.ts";
import { EXIT_POLICIES, exitProposal, exitTrigger } from "./exit.ts";
import { DEVNET_USDC, LADDER_CHAINS, LADDER_MAX_USD_CEILING, LADDER_START_MAX_USD, ladderGate, ladderMaxUsd, ladderNetwork, ladderPools, ladderQuotes, MAINNET_USDC, networkOpen, takeBackOpen } from "./network.ts";
import { judgeCancel, judgePlacement, legReceives, tokenAmountOf } from "./promise.ts";
import { finishLegs, liveView, quotePerBase } from "./orders.ts";
import {
  arraysOf,
  bandOfPlan,
  binArrayIndex,
  binOfPrice,
  binPrice,
  chunkRungs,
  legAmountRaw,
  legIssues,
  legUsd,
  MAX_ARRAYS_PER_TX,
  planIssues,
  planLeg,
  splitRaw,
  stepPercents,
} from "./plan.ts";
import { dipFactor, smartSplit, timeLegBuyUsd } from "./smart.ts";
import { chooseVenue } from "./venue.ts";

/* A SOL/USDC pool: SOL (9 decimals) is X, USDC (6) is Y, 10-bps bins, the active bin at about $150. */
const SOL_USDC = {
  pool: "PooL1111111111111111111111111111111111111111",
  binStep: 10,
  activeId: 0,
  baseIsX: true,
  baseMint: "So11111111111111111111111111111111111111112",
  quoteMint: DEVNET_USDC,
  baseDecimals: 9,
  quoteDecimals: 6,
};
SOL_USDC.activeId = binOfPrice(150, false, SOL_USDC);
/* The same market, the pool's sides the other way round: USDC is X, SOL is Y. */
const USDC_SOL = { ...SOL_USDC, baseIsX: false, activeId: 0 };
USDC_SOL.activeId = binOfPrice(150, false, USDC_SOL);

const buy = (over = {}) => ({ side: "buy", steps: 5, firstPct: 2, lastPct: 20, shape: "even", amountRaw: "100000000", ...over });
const exit = (over = {}) => ({ side: "exit", steps: 4, firstPct: 5, lastPct: 30, shape: "even", amountRaw: "500000000", ...over });

test("a bin's price and a price's bin agree, rounded the person's way", () => {
  const ref = binPrice(SOL_USDC.activeId, SOL_USDC);
  assert.ok(Math.abs(ref - 150) / 150 < 0.002, `the active bin is near $150, got ${ref}`);
  for (const target of [91.3, 120, 147.77, 151.2, 222]) {
    const bid = binOfPrice(target, false, SOL_USDC);
    const ask = binOfPrice(target, true, SOL_USDC);
    assert.ok(binPrice(bid, SOL_USDC) <= target * (1 + 1e-9), "a buy never converts above its step");
    assert.ok(binPrice(ask, SOL_USDC) >= target * (1 - 1e-9), "a sell never converts below its step");
    assert.ok(ask - bid <= 1);
  }
  /* The base on the pool's Y side: a buy of the base is an ask of X, its price still never above the step. */
  for (const target of [120, 149]) {
    const id = binOfPrice(target, true, USDC_SOL);
    assert.ok(binPrice(id, USDC_SOL) <= target * (1 + 1e-9));
  }
});

test("a buy ladder sits under the price, nearest first, the amount split exactly", () => {
  const plan = planLeg(buy(), SOL_USDC);
  assert.ok(plan);
  assert.equal(plan.isAskSide, false);
  assert.equal(plan.inputMint, DEVNET_USDC);
  assert.equal(plan.rungs.length, 5);
  assert.ok(plan.rungs.every((rung) => rung.binId < SOL_USDC.activeId));
  assert.ok(plan.rungs.every((rung, i) => i === 0 || rung.binId < plan.rungs[i - 1].binId), "nearest the price first");
  assert.equal(plan.rungs.reduce((sum, rung) => sum + BigInt(rung.amountRaw), 0n), 100_000_000n);
  assert.ok(Math.abs(plan.rungs[0].pct + 2) < 0.2 && Math.abs(plan.rungs[4].pct + 20) < 0.2, "the steps land at −2 % … −20 %");
  assert.deepEqual(planIssues(plan, SOL_USDC), []);
});

test("an exit ladder sits over the price; «more further» puts more on the far steps", () => {
  const plan = planLeg(exit({ shape: "deeper" }), SOL_USDC);
  assert.ok(plan);
  assert.equal(plan.isAskSide, true);
  assert.equal(plan.inputMint, SOL_USDC.baseMint);
  assert.ok(plan.rungs.every((rung) => rung.binId > SOL_USDC.activeId));
  const amounts = plan.rungs.map((rung) => BigInt(rung.amountRaw));
  assert.ok(amounts.every((a, i) => i === 0 || a > amounts[i - 1]), "each step further holds more");
  assert.equal(amounts.reduce((a, b) => a + b, 0n), 500_000_000n);
});

test("with the base on the pool's Y side the sides turn, the prices do not", () => {
  const plan = planLeg(buy(), USDC_SOL);
  assert.ok(plan);
  assert.equal(plan.isAskSide, true, "buying Y is selling X");
  assert.ok(plan.rungs.every((rung) => rung.binId > USDC_SOL.activeId));
  assert.ok(plan.rungs.every((rung) => rung.price < plan.refPrice), "still under the price, in dollars per SOL");
});

test("a step on the active bin moves to its own side; steps sharing a bin become one", () => {
  const wide = { ...SOL_USDC, binStep: 500, activeId: 0 };
  wide.activeId = binOfPrice(150, false, wide);
  const plan = planLeg(buy({ steps: 4, firstPct: 0.1, lastPct: 0.4 }), wide);
  assert.ok(plan);
  assert.equal(plan.rungs.length, 1, "four steps inside one 5 % bin are one");
  assert.equal(plan.rungs[0].binId, wide.activeId - 1);
  assert.equal(plan.rungs[0].amountRaw, "100000000");
  /* A step a hair from the price would round onto the active bin: it moves to the first bin on its own side. */
  const hair = planLeg(exit({ steps: 2, firstPct: 1e-12, lastPct: 2e-12 }), wide);
  assert.deepEqual([hair.rungs.length, hair.rungs[0].binId, hair.moved], [1, wide.activeId + 1, 2]);
});

test("the leg's own settings are checked before any bin", () => {
  assert.deepEqual(legIssues(buy({ steps: 1 })), ["steps"]);
  assert.deepEqual(legIssues(buy({ firstPct: 10, lastPct: 5 })), ["percent"]);
  assert.deepEqual(legIssues(buy({ lastPct: 95 })), ["percent"]);
  assert.deepEqual(legIssues(buy({ amountRaw: "0" })), ["amount"]);
  assert.equal(planLeg(buy({ steps: 13 }), SOL_USDC), null);
});

test("dust steps and a ladder spread over too many transactions are refused", () => {
  const dust = planLeg(buy({ amountRaw: "3000000", steps: 5 }), SOL_USDC);
  assert.deepEqual(planIssues(dust, SOL_USDC), ["step_too_small"]);
  const spread = planLeg(buy({ steps: 12, firstPct: 1, lastPct: 85, amountRaw: "1000000000" }), SOL_USDC);
  assert.ok(planIssues(spread, SOL_USDC).includes("too_many_transactions"));
});

test("rungs are cut into transactions by bin array, two arrays at most each", () => {
  const plan = planLeg(buy({ steps: 8, firstPct: 1, lastPct: 30 }), SOL_USDC);
  const chunks = chunkRungs(plan.rungs);
  assert.equal(chunks.flat().length, plan.rungs.length);
  for (const chunk of chunks) assert.ok(arraysOf(chunk).length <= MAX_ARRAYS_PER_TX);
  assert.equal(new Set(chunks.flatMap((chunk) => arraysOf(chunk))).size, arraysOf(plan.rungs).length, "no array is split across transactions");
  assert.equal(binArrayIndex(-1), -1);
  assert.equal(binArrayIndex(69), 0);
  assert.equal(binArrayIndex(70), 1);
});

test("amounts: exact splits, dollars to raw units and back", () => {
  assert.deepEqual(splitRaw(10n, [1, 1, 1]), [3n, 3n, 4n]);
  assert.deepEqual(splitRaw(100n, [1, 2, 3, 4]), [10n, 20n, 30n, 40n]);
  assert.deepEqual(stepPercents(2, 10, 3), [2, 6, 10]);
  assert.equal(legAmountRaw("buy", 100, 150, SOL_USDC), "100000000");
  assert.equal(legAmountRaw("exit", 150, 150, SOL_USDC), "1000000000");
  assert.equal(legUsd("exit", "1000000000", 150, SOL_USDC), 150);
  assert.equal(legAmountRaw("buy", -1, 150, SOL_USDC), "0");
});

test("the one cost line: rent back, the pool's kept rent once per array, fees per signature, the reserve", () => {
  const plan = planLeg(buy({ steps: 8, firstPct: 1, lastPct: 30 }), SOL_USDC);
  const exitPlan = planLeg(exit(), SOL_USDC);
  const arrays = arraysOf(plan.rungs);
  const none = ladderCosts([plan], { existingArrays: new Set(arrays), bitmapExtension: true });
  const chunks = chunkRungs(plan.rungs);
  assert.equal(none.transactions, chunks.length);
  assert.equal(none.networkLamports, chunks.length * 2 * 5_000);
  assert.equal(none.rentBackLamports, chunks.reduce((sum, chunk) => sum + orderAccountRent(chunk.length), 0));
  assert.equal(none.rentKeptLamports, 0);
  assert.equal(none.minimumUsd, 0, "a DLMM limit order has no minimum");
  assert.equal(none.reserveLamports, SOL_RESERVE_LAMPORTS);
  const fresh = ladderCosts([plan, exitPlan], { existingArrays: new Set([binArrayIndex(SOL_USDC.activeId)]), bitmapExtension: true });
  const wanted = new Set([...arrays, ...arraysOf(exitPlan.rungs)]);
  wanted.delete(binArrayIndex(SOL_USDC.activeId));
  assert.equal(fresh.newArrays, wanted.size);
  assert.equal(fresh.rentKeptLamports, wanted.size * BIN_ARRAY_RENT_LAMPORTS);
  assert.ok(solNeededLamports(fresh) > solNeededLamports(none));
  assert.ok(sameCosts(none, { ...none }));
  assert.ok(costsRose(none, fresh) && !costsRose(fresh, none));
});

test("costs that eat the amount are not advised; an unknown SOL price is never advised", () => {
  const plan = planLeg(buy(), SOL_USDC);
  const cheap = ladderCosts([plan], { existingArrays: new Set(arraysOf(plan.rungs)), bitmapExtension: true });
  assert.equal(costVerdict(cheap, 100, 150).advised, true);
  const dear = ladderCosts([plan], { existingArrays: new Set(), bitmapExtension: true });
  const verdict = costVerdict(dear, 100, 150);
  assert.equal(verdict.advised, false);
  assert.ok(verdict.sharePct > 3);
  assert.equal(costVerdict(cheap, 100, 0).advised, false);
});

test("the exit policy proposes, never acts", () => {
  const band = { lower: 100, upper: 200 };
  const progress = { rungs: 5, filled: 1, partial: 0 };
  assert.equal(exitTrigger(band, 150, progress), null);
  assert.equal(exitTrigger(band, 90, progress), "below");
  assert.equal(exitTrigger(band, 210, progress), "above");
  assert.equal(exitTrigger(band, 150, { rungs: 5, filled: 5, partial: 0 }), "filled");
  assert.equal(exitTrigger(null, null, progress), null);
  for (const policy of EXIT_POLICIES) {
    for (const trigger of ["below", "above", "filled"]) {
      for (const side of ["buy", "exit"]) {
        const proposal = exitProposal(policy, trigger, side);
        if (!proposal) continue;
        assert.equal(proposal.auto, false, `${policy}/${trigger} is the person's tap`);
        assert.equal(proposal.builtAt, "tap", "built when tapped, never signed ahead");
        assert.ok(proposal.prompts >= 1);
      }
    }
  }
  assert.equal(exitProposal("wait", "below", "buy"), null, "«Wait» keeps the orders");
  assert.equal(exitProposal("wait", "filled", "buy").action, "takeBack");
  assert.equal(exitProposal("stop", "above", "buy").action, "takeBack");
  assert.equal(exitProposal("sellAll", "below", "buy").action, "takeBackAndSell");
  assert.equal(exitProposal("sellAll", "filled", "exit").action, "takeBack", "an exit ladder that sold everything has nothing to sell");
  assert.deepEqual([exitProposal("rebuild", "below", "buy").action, exitProposal("rebuild", "below", "buy").prompts], ["takeBackAndRebuild", 2]);
  assert.equal(exitProposal("stop", null, "buy"), null);
});

test("devnet's switch opens devnet only; mainnet opens by its own switch alone, closed by default", () => {
  assert.equal(ladderNetwork(undefined), null, "closed by default");
  assert.equal(ladderNetwork(""), null);
  assert.equal(ladderNetwork("mainnet-beta"), null);
  assert.equal(ladderNetwork("open"), null);
  assert.equal(ladderNetwork(" devnet "), "devnet");
  assert.equal(ladderNetwork("mainnet"), "mainnet", "the window may name mainnet; the server's own switch still decides");
  assert.deepEqual(LADDER_CHAINS, { devnet: "solana:devnet", mainnet: "solana:mainnet" });
  const pool = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj";
  assert.deepEqual(ladderPools({ RYNTRA_BOTS_LADDER_DEVNET_POOLS: pool }), [], "no pools while closed");
  assert.deepEqual(ladderPools({ RYNTRA_BOTS_LADDER: "devnet", RYNTRA_BOTS_LADDER_DEVNET_POOLS: `${pool}, not-an-address ,${pool}` }), [pool]);
  assert.deepEqual(ladderGate({}), { open: false });
  assert.deepEqual(ladderGate({}, "mainnet"), { open: false }, "mainnet closed by default");
  /* Devnet's switch never opens mainnet, whatever it says. */
  for (const value of ["mainnet", "devnet", "OPEN", "mainnet-beta"]) assert.equal(networkOpen({ RYNTRA_BOTS_LADDER: value }, "mainnet"), false, value);
  assert.deepEqual(ladderGate({ RYNTRA_BOTS_LADDER: "mainnet", RYNTRA_BOTS_LADDER_DEVNET_POOLS: pool }), { open: false });
  /* Mainnet's switch never opens devnet. */
  assert.equal(networkOpen({ RYNTRA_BOTS_LADDER_MAINNET: "OPEN" }, "devnet"), false);
  for (const value of ["", "1", "true", "yes", "mainnet", "OPENED"]) assert.equal(networkOpen({ RYNTRA_BOTS_LADDER_MAINNET: value }, "mainnet"), false, value);
  assert.equal(networkOpen({ RYNTRA_BOTS_LADDER_MAINNET: " open " }, "mainnet"), true);
  assert.deepEqual(ladderGate({ RYNTRA_BOTS_LADDER_MAINNET: "OPEN" }, "mainnet"), { open: true, network: "mainnet", pools: null, quotes: [MAINNET_USDC], maxUsd: LADDER_START_MAX_USD });
  assert.ok(ladderQuotes({}).includes(DEVNET_USDC));
  assert.deepEqual(ladderQuotes({ RYNTRA_BOTS_LADDER_DEVNET_QUOTES: pool }, "mainnet"), [MAINNET_USDC], "mainnet is quoted in Circle's USDC only");
  assert.equal(ladderGate({ RYNTRA_BOTS_LADDER: "devnet" }).maxUsd, null, "devnet's test money has no cap");
  /* The rollback: `CLOSING` keeps taking back on mainnet, places nothing. */
  assert.equal(networkOpen({ RYNTRA_BOTS_LADDER_MAINNET: "CLOSING" }, "mainnet"), false);
  assert.equal(takeBackOpen({ RYNTRA_BOTS_LADDER_MAINNET: "CLOSING" }, "mainnet"), true);
  assert.equal(takeBackOpen({ RYNTRA_BOTS_LADDER_MAINNET: "OPEN" }, "mainnet"), true);
  assert.equal(takeBackOpen({}, "mainnet"), false);
  assert.equal(takeBackOpen({ RYNTRA_BOTS_LADDER_MAINNET: "CLOSING" }, "devnet"), false);
  assert.deepEqual(ladderGate({ RYNTRA_BOTS_LADDER_MAINNET: "CLOSING" }, "mainnet"), { open: false });
  assert.equal(ladderGate({ RYNTRA_BOTS_LADDER_MAINNET: "CLOSING" }, "mainnet", { takeBack: true }).open, true);
});

test("the cap: $100 to start; the variable lowers or raises it up to $1 000, never above, never below $1", () => {
  assert.equal(LADDER_START_MAX_USD, 100);
  assert.equal(ladderMaxUsd({}), 100);
  assert.equal(ladderMaxUsd({ RYNTRA_BOTS_LADDER_MAINNET_MAX_USD: "25" }), 25);
  assert.equal(ladderMaxUsd({ RYNTRA_BOTS_LADDER_MAINNET_MAX_USD: "250.5" }), 250.5);
  assert.equal(ladderMaxUsd({ RYNTRA_BOTS_LADDER_MAINNET_MAX_USD: "50000" }), LADDER_MAX_USD_CEILING);
  for (const value of ["0", "0.5", "-5", "abc", "1e9", "", " "]) assert.equal(ladderMaxUsd({ RYNTRA_BOTS_LADDER_MAINNET_MAX_USD: value }), 100, value);
  assert.equal(ladderGate({ RYNTRA_BOTS_LADDER_MAINNET: "OPEN", RYNTRA_BOTS_LADDER_MAINNET_MAX_USD: "40" }, "mainnet").maxUsd, 40);
});

test("the chain's terms: rent per byte as the chain reads it, mainnet's priority per transaction", () => {
  const plan = planLeg(buy({ steps: 8, firstPct: 1, lastPct: 30 }), SOL_USDC);
  const arrays = arraysOf(plan.rungs);
  const legacy = ladderCosts([plan], { existingArrays: new Set(arrays), bitmapExtension: true });
  const mainnet = ladderCosts([plan], { existingArrays: new Set(arrays), bitmapExtension: true }, { rentPerByte: 5_080, priorityLamportsPerTx: priorityLamports(400_000, LADDER_MAINNET_CU_PRICE) });
  assert.equal(priorityLamports(400_000, LADDER_MAINNET_CU_PRICE), 20_000, "0.00002 SOL a transaction");
  assert.equal(mainnet.networkLamports, legacy.networkLamports + mainnet.transactions * 20_000);
  assert.equal(mainnet.rentBackLamports, chunkRungs(plan.rungs).reduce((sum, chunk) => sum + orderAccountRent(chunk.length, 5_080), 0));
  assert.ok(mainnet.rentBackLamports < legacy.rentBackLamports);
  /* The order account the program opens: 8 discriminator + 112 + 32 a bin — 152 bytes for one bin (read on the fork). */
  assert.equal(orderAccountRent(1, 5_080), (152 + 128) * 5_080);
  assert.equal(orderAccountRent(1), (152 + 128) * 6_960);
  assert.equal(binArrayRent(), BIN_ARRAY_RENT_LAMPORTS, "Meteora's own BIN_ARRAY_FEE at 6 960 a byte");
});

/* ------------------------------------------------------------ the promise */

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const POOL_KEY = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const b58 = (address) => {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(ALPHABET.indexOf(char));
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
};

/** A limit order account in the program's own layout (lb_clmm 0.12.0). */
function orderAccount({ pool = POOL_KEY, owner = OWNER, bins }) {
  const data = Buffer.alloc(8 + 112 + 32 * bins.length);
  Buffer.from("89b7d45b731d8de3", "hex").copy(data, 0);
  b58(pool).copy(data, 8);
  b58(owner).copy(data, 40);
  data.writeUInt16LE(bins.length, 72);
  bins.forEach((bin, i) => {
    const at = 120 + 32 * i;
    data.writeBigUInt64LE(BigInt(bin.amount), at);
    data.writeUInt32LE(bin.age ?? 0, at + 8);
    data.writeInt32LE(bin.id, at + 16);
    data[at + 20] = bin.isAsk ? 1 : 0;
  });
  return { lamports: 1, data: [data.toString("base64"), "base64"] };
}
function tokenAccount(amount) {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(BigInt(amount), 64);
  return { lamports: 2_039_280, data: [data.toString("base64"), "base64"] };
}

test("the order account reads as the program keeps it: pool, owner, each bin's amount, age and side", () => {
  const account = orderAccount({ bins: [{ id: -5669, amount: 12_500_000n }, { id: -5659, amount: 7n, age: 3, isAsk: true }] });
  const read = decodeLimitOrderAccount(Buffer.from(account.data[0], "base64"));
  assert.equal(read.pool, POOL_KEY);
  assert.equal(read.owner, OWNER);
  assert.deepEqual(read.bins, [{ id: -5669, amount: 12_500_000n, age: 0, isAsk: false }, { id: -5659, amount: 7n, age: 3, isAsk: true }]);
  assert.equal(addressOf(Buffer.alloc(32)), "11111111111111111111111111111111");
  assert.equal(binIsEmpty({ id: 1, amount: 0n, age: 0, isAsk: false }), true);
  assert.equal(binIsEmpty({ id: 1, amount: 0n, age: 2, isAsk: false }), false, "converted: something to take back");
  assert.equal(decodeLimitOrderAccount(Buffer.alloc(120)), null, "not a limit order");
  const short = Buffer.from(account.data[0], "base64").subarray(0, 140);
  assert.equal(decodeLimitOrderAccount(short), null, "fewer bins than it says");
});

test("the promise: the order stands as shown, exactly the amount leaves, SOL only as the line says", () => {
  const bins = [{ id: -5669, amount: 25_000_000n }, { id: -5659, amount: 25_000_000n }];
  const promise = { owner: OWNER, pool: POOL_KEY, limitOrder: OWNER, isAskSide: false, bins, inputIsSol: false, maxSolOutLamports: 1_940_080 };
  const before = { lamports: 2_000_000_000, input: 500_000_000n };
  const good = { wallet: { lamports: 2_000_000_000 - 1_940_080, data: ["", "base64"] }, input: tokenAccount(450_000_000), order: orderAccount({ bins }) };
  assert.deepEqual(judgePlacement(promise, before, good), { ok: true, solOutLamports: 1_940_080 });
  assert.equal(judgePlacement(promise, before, { ...good, order: null }).code, "ORDER_MISSING");
  assert.equal(judgePlacement(promise, before, { ...good, order: orderAccount({ owner: POOL_KEY, bins }) }).code, "ORDER_MISMATCH", "someone else's order");
  assert.equal(judgePlacement(promise, before, { ...good, order: orderAccount({ bins: [bins[0], { ...bins[1], id: -5600 }] }) }).code, "ORDER_MISMATCH", "a step at another price");
  assert.equal(judgePlacement(promise, before, { ...good, order: orderAccount({ bins: [bins[0], { ...bins[1], amount: 24_999_999n }] }) }).code, "ORDER_MISMATCH", "a step short");
  assert.equal(judgePlacement(promise, before, { ...good, order: orderAccount({ bins: bins.map((bin) => ({ ...bin, isAsk: true })) }) }).code, "ORDER_MISMATCH", "the other side");
  assert.equal(judgePlacement(promise, before, { ...good, input: tokenAccount(449_999_999) }).code, "INPUT_MISMATCH", "one unit more leaves the wallet");
  assert.equal(judgePlacement(promise, before, { ...good, wallet: { ...good.wallet, lamports: good.wallet.lamports - 1 } }).code, "SOL_ABOVE_LINE", "one lamport over the line");
  assert.equal(judgePlacement({ ...promise, inputIsSol: true }, { ...before, input: null }, { ...good, input: null }).ok, true, "SOL input: its account opens and closes inside the transaction");
  assert.equal(tokenAmountOf(tokenAccount(7)), 7n);
  assert.equal(tokenAmountOf(null), null);
  /* A cancellation: the order gone, SOL out only as fees and the wallet's own token accounts. */
  assert.equal(judgeCancel({ maxSolOutLamports: 25_000 }, { lamports: 1_000 }, { wallet: { lamports: 2_000_000, data: ["", "base64"] }, order: null }).ok, true);
  assert.equal(judgeCancel({ maxSolOutLamports: 25_000 }, { lamports: 1_000 }, { wallet: { lamports: 2_000_000, data: ["", "base64"] }, order: orderAccount({ bins }) }).code, "ORDER_STAYS");
  assert.equal(judgeCancel({ maxSolOutLamports: 25_000 }, { lamports: 100_000 }, { wallet: { lamports: 70_000, data: ["", "base64"] }, order: null }).code, "SOL_ABOVE_LINE");
});

test("what every step gives if all fill: the coin at each step's price for a buy, dollars for an exit", () => {
  const buyPlan = planLeg(buy({ steps: 2, firstPct: 2, lastPct: 4, amountRaw: "100000000" }), SOL_USDC);
  const expected = buyPlan.rungs.reduce((sum, rung) => sum + Number(rung.amountRaw) / 1e6 / rung.price, 0);
  assert.ok(Math.abs(legReceives(buyPlan, SOL_USDC) - expected) < 1e-12);
  assert.ok(legReceives(buyPlan, SOL_USDC) > 100 / 150, "buying under the price gives more than at it");
  const exitPlan = planLeg(exit({ amountRaw: "1000000000" }), SOL_USDC);
  assert.ok(legReceives(exitPlan, SOL_USDC) > 150, "selling over the price gives more than at it");
});

test("DLMM limit orders first; Trigger V1 is the fallback, and on devnet it is refused, not improvised", () => {
  assert.deepEqual(chooseVenue({ pool: true, takesLimitOrders: true, network: "devnet", stepUsd: [1] }), { venue: "dlmm", available: true });
  assert.deepEqual(chooseVenue({ pool: true, takesLimitOrders: false, network: "devnet", stepUsd: [10, 10] }), { venue: "trigger", available: false, reason: "MAINNET_ONLY" });
  assert.deepEqual(chooseVenue({ pool: false, takesLimitOrders: false, network: "devnet", stepUsd: [10, 3] }), { venue: "trigger", available: false, reason: "BELOW_MINIMUM" });
  assert.deepEqual(chooseVenue({ pool: true, takesLimitOrders: true, network: "mainnet", stepUsd: [] }), { venue: "dlmm", available: true });
  assert.deepEqual(chooseVenue({ pool: false, takesLimitOrders: false, network: "mainnet", stepUsd: [10] }), { venue: null, available: false, reason: "NO_POOL" }, "on mainnet no Trigger yet: no pool is no ladder");
});

test("Smart DCA: a ladder share and reminders that lean into dips and stop over the ceiling", () => {
  assert.deepEqual(smartSplit({ budgetUsd: 200, ladderPct: 50, everyHours: 24, buys: 4, ceilingPct: null }), { ladderUsd: 100, timeUsd: 100, perBuyUsd: 25 });
  assert.equal(dipFactor(50, 100), 2);
  assert.equal(dipFactor(200, 100), 0.5);
  assert.equal(dipFactor(100, 100), 1);
  assert.equal(timeLegBuyUsd({ perBuyUsd: 25, price: 100, average: 100, startPrice: 100, ceilingPct: 10, leftUsd: 100 }), 25);
  assert.equal(timeLegBuyUsd({ perBuyUsd: 25, price: 111, average: 100, startPrice: 100, ceilingPct: 10, leftUsd: 100 }), 0, "over the ceiling: no buy");
  assert.equal(timeLegBuyUsd({ perBuyUsd: 25, price: 80, average: 100, startPrice: 100, ceilingPct: null, leftUsd: 30 }), 30, "never past what is left");
});

/* ------------------------------------------------------------- decoding */

/* The SDK's own coder, from its CommonJS build (its ES build does not load under plain Node). */
const { createProgram } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const anchor = createProgram(new Connection("http://127.0.0.1:1"), { cluster: "devnet" });
const k = () => Keypair.generate().publicKey;

async function sdkPlace(params, slices) {
  const ix = await anchor.methods
    .placeLimitOrder({ ...params, padding: new Array(16).fill(0) }, { slices })
    .accountsPartial({ lbPair: k(), binArrayBitmapExtension: anchor.programId, reserve: k(), tokenMint: k(), tokenProgram: k(), limitOrder: k(), userToken: k(), sender: k(), payer: k(), owner: k() })
    .instruction();
  return Uint8Array.from(ix.data);
}

test("the decoder reads `place_limit_order` exactly as the SDK writes it", async () => {
  const bid = decodePlaceData(await sdkPlace({ isAskSide: false, relativeBin: null, bins: [{ id: -5, amount: new BN("123456789") }, { id: -900, amount: new BN("42") }] }, [{ accountsType: { transferHookY: {} }, length: 0 }]));
  assert.deepEqual(bid, { isAskSide: false, relativeBin: null, bins: [{ id: -5, amount: 123456789n }, { id: -900, amount: 42n }] });
  const ask = decodePlaceData(await sdkPlace({ isAskSide: true, relativeBin: { activeId: 7, maxActiveBinSlippage: 3 }, bins: [{ id: 12, amount: new BN("18446744073709551615") }] }, []));
  assert.deepEqual(ask, { isAskSide: true, relativeBin: { activeId: 7, maxSlippage: 3 }, bins: [{ id: 12, amount: 18446744073709551615n }] });
  assert.equal(decodePlaceData(Uint8Array.from([1, 2, 3])), null);
});

test("an order matches the plan only with the same side, bins and amounts", async () => {
  const plan = planLeg(buy({ steps: 3 }), SOL_USDC);
  const bins = plan.rungs.map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) }));
  const data = decodePlaceData(await sdkPlace({ isAskSide: false, relativeBin: null, bins }, []));
  assert.equal(matchesRungs(data, false, plan.rungs), true);
  assert.equal(matchesRungs(data, true, plan.rungs), false, "the other side");
  const more = decodePlaceData(await sdkPlace({ isAskSide: false, relativeBin: null, bins: bins.map((bin, i) => (i === 0 ? { ...bin, amount: bin.amount.addn(1) } : bin)) }, []));
  assert.equal(matchesRungs(more, false, plan.rungs), false, "one lamport more is not the plan");
  const moved = decodePlaceData(await sdkPlace({ isAskSide: false, relativeBin: { activeId: 0, maxActiveBinSlippage: 1 }, bins }, []));
  assert.equal(matchesRungs(moved, false, plan.rungs), false, "a relative order is not the plan");
});

test("«What this bot can do» is read from the orders: one pool, one owner, one side", () => {
  const owner = k().toBase58();
  const pool = k().toBase58();
  const order = (isAskSide, amounts, over = {}) => ({ pool, limitOrder: k().toBase58(), owner, data: { isAskSide, relativeBin: null, bins: amounts.map((amount, i) => ({ id: i, amount })) }, ...over });
  const card = canDoFromOrders([order(false, [5n, 6n]), order(false, [7n])], true, ["LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"]);
  assert.deepEqual([card.side, card.orders, card.steps, card.maxInputRaw, card.withdraw, card.close, card.source], ["buy", 2, 3, "18", "wallet", "cancel", "transaction"]);
  assert.equal(canDoFromOrders([order(true, [1n])], true, []).side, "exit");
  assert.equal(canDoFromOrders([order(true, [1n])], false, []).side, "buy");
  assert.equal(canDoFromOrders([order(false, [1n]), order(false, [1n], { owner: k().toBase58() })], true, []), null);
  assert.equal(canDoFromOrders([order(false, [1n]), order(true, [1n])], true, []), null);
  assert.equal(canDoFromOrders([], true, []), null);
});

/* ------------------------------------------------------- placed ladders */

test("a placed ladder's view: placing, not finished, working, due, filled, closed", () => {
  const plan = planLeg(buy({ steps: 4 }), SOL_USDC);
  const band = bandOfPlan(plan);
  const leg = (state, rungs = plan.rungs) => ({ limitOrder: k().toBase58(), side: "buy", state, signature: state === "failed" ? null : "sig", rungs });
  const a = leg("confirmed");
  const base = { band, price: plan.refPrice, policy: "stop", closed: false };
  assert.equal(liveView({ ...base, legs: [leg("sent")], reads: {} }).state, "placing");
  assert.equal(liveView({ ...base, legs: [leg("failed")], reads: {} }).state, "failed");
  const half = liveView({ ...base, legs: [a, leg("failed")], reads: {} });
  assert.equal(half.state, "incomplete");
  assert.equal(half.missing.length, 1);
  assert.equal(liveView({ ...base, legs: [a], reads: {} }).state, "working");
  const fell = liveView({ ...base, legs: [a], reads: {}, price: band.lower * 0.9 });
  assert.deepEqual([fell.state, fell.proposal.action, fell.proposal.auto], ["due", "takeBack", false]);
  assert.equal(liveView({ ...base, policy: "wait", legs: [a], reads: {}, price: band.lower * 0.9 }).state, "working");
  const read = (state, filled) => ({ [a.limitOrder]: { limitOrder: a.limitOrder, pool: SOL_USDC.pool, state, rungs: 4, filled, partial: 0 } });
  assert.equal(liveView({ ...base, policy: "wait", legs: [a], reads: read("partial", 2) }).progress.filled, 2);
  assert.equal(liveView({ ...base, legs: [a], reads: read("closed", 0) }).state, "closed");
  assert.deepEqual(liveView({ ...base, legs: [a], reads: read("closed", 0) }).holding, []);
  assert.equal(liveView({ ...base, legs: [a], reads: {}, closed: true }).state, "closed");
  assert.equal(quotePerBase(4, false), 0.25);
});

test("finishing a half-landed ladder places its missing steps again, the same amounts", () => {
  const plan = planLeg(buy({ steps: 8, firstPct: 1, lastPct: 30 }), SOL_USDC);
  const chunks = chunkRungs(plan.rungs);
  assert.ok(chunks.length >= 2);
  const missing = [{ limitOrder: k().toBase58(), side: "buy", state: "failed", signature: null, rungs: chunks[1] }];
  const [leg] = finishLegs(missing);
  assert.equal(leg.side, "buy");
  assert.equal(leg.steps, chunks[1].length);
  assert.equal(leg.amountRaw, chunks[1].reduce((sum, rung) => sum + BigInt(rung.amountRaw), 0n).toString());
  assert.ok(leg.firstPct < leg.lastPct);
});
