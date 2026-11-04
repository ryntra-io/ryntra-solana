// Run from repo root: node --test lib/bots/ladder/ladder.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createRequire } from "node:module";

import { Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

import { BIN_ARRAY_RENT_LAMPORTS, costsRose, costVerdict, ladderCosts, orderAccountRent, sameCosts, SOL_RESERVE_LAMPORTS, solNeededLamports } from "./costs.ts";
import { canDoFromOrders, decodePlaceData, matchesRungs } from "./decode.ts";
import { EXIT_POLICIES, exitProposal, exitTrigger } from "./exit.ts";
import { DEVNET_USDC, ladderGate, ladderNetwork, ladderPools, ladderQuotes, LADDER_CHAIN } from "./network.ts";
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

test("the switch opens devnet only; mainnet is not a value it takes", () => {
  assert.equal(ladderNetwork(undefined), null, "closed by default");
  assert.equal(ladderNetwork(""), null);
  assert.equal(ladderNetwork("mainnet"), null);
  assert.equal(ladderNetwork("mainnet-beta"), null);
  assert.equal(ladderNetwork("open"), null);
  assert.equal(ladderNetwork(" devnet "), "devnet");
  assert.equal(LADDER_CHAIN, "solana:devnet");
  const pool = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj";
  assert.deepEqual(ladderPools({ RYNTRA_BOTS_LADDER_DEVNET_POOLS: pool }), [], "no pools while closed");
  assert.deepEqual(ladderPools({ RYNTRA_BOTS_LADDER: "devnet", RYNTRA_BOTS_LADDER_DEVNET_POOLS: `${pool}, not-an-address ,${pool}` }), [pool]);
  assert.deepEqual(ladderGate({}), { open: false });
  assert.deepEqual(ladderGate({ RYNTRA_BOTS_LADDER: "mainnet", RYNTRA_BOTS_LADDER_DEVNET_POOLS: pool }), { open: false });
  assert.ok(ladderQuotes({}).includes(DEVNET_USDC));
});

test("DLMM limit orders first; Trigger V1 is the fallback, and on devnet it is refused, not improvised", () => {
  assert.deepEqual(chooseVenue({ pool: true, takesLimitOrders: true, network: "devnet", stepUsd: [1] }), { venue: "dlmm", available: true });
  assert.deepEqual(chooseVenue({ pool: true, takesLimitOrders: false, network: "devnet", stepUsd: [10, 10] }), { venue: "trigger", available: false, reason: "MAINNET_ONLY" });
  assert.deepEqual(chooseVenue({ pool: false, takesLimitOrders: false, network: "devnet", stepUsd: [10, 3] }), { venue: "trigger", available: false, reason: "BELOW_MINIMUM" });
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
