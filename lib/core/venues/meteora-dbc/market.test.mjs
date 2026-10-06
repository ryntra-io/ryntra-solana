import assert from "node:assert/strict";
import test from "node:test";

import {
  SNIPER_SECONDS,
  accountPageReached,
  chartMarkers,
  creatorActivity,
  curveFeeSplit,
  holderGroups,
  launchRiskFacts,
  listsWhole,
  peopleHoldings,
  marketSeries,
  poolFeeSplit,
  priceFromSqrtX64,
  priceMoveBps,
  shareBps,
  creatorSoldShare,
  tradeOf,
  walletLabels,
  windowReadWhole,
} from "./market.ts";
import { minimumAfterSlippage, poolFeeAfter, poolFeeBefore, withPoolFee } from "./trade.server.ts";

/* Synthetic wallets and signatures only: no address of the stand's devnet runs. */
const CREATOR = "Creator1111111111111111111111111111111111111";
const ALICE = "A1ice11111111111111111111111111111111111111";
const BOB = "Bob111111111111111111111111111111111111111111";
const CAROL = "Caro1111111111111111111111111111111111111111";
const SUPPLY = 1_000_000_000_000_000n;

const trade = (over) => ({
  signature: `sig${over.n ?? 0}`.padEnd(88, "1"),
  slot: 100,
  at: 1_000,
  side: "buy",
  venue: "curve",
  trader: ALICE,
  payer: over.trader ?? ALICE,
  tokensRaw: "1000000",
  pairRaw: "1000000",
  feeRaw: "10000",
  priceAfter: 0.000005,
  ...over,
});

test("the price a Q64.64 square root names: the curve's opening price of a $5 000 cap over a billion tokens", () => {
  /* The stand's curve after a 50 USDC first buy: ≈ 5.09e-6 USDC a token, a cap of ≈ $5 093. */
  const price = priceFromSqrtX64("41627739639997535", 6, 6);
  assert.ok(Math.abs(price - 5.0925e-6) < 1e-9, `price ${price}`);
  assert.equal(priceFromSqrtX64(2n ** 64n, 6, 6), 1);
  assert.equal(priceFromSqrtX64(2n ** 64n, 9, 6), 1000, "base decimals above quote decimals scale up");
});

test("labels: the creator, a bundle in the creation's block, a sniper in the first two minutes — none on a guess", () => {
  const trades = [
    trade({ n: 1, trader: CREATOR, slot: 100, at: 1_000 }),
    trade({ n: 2, trader: ALICE, slot: 100, at: 1_000 }),
    trade({ n: 3, trader: BOB, slot: 101, at: 1_000 + SNIPER_SECONDS - 1 }),
    trade({ n: 4, trader: CAROL, slot: 150, at: 1_000 + SNIPER_SECONDS }),
    trade({ n: 5, trader: CAROL, slot: 151, at: 1_001, side: "sell" }),
  ];
  const labels = walletLabels({ trades, creator: CREATOR, createdSlot: 100, createdAt: 1_000 });
  assert.deepEqual(labels.get(CREATOR), ["creator"]);
  assert.deepEqual(labels.get(ALICE), ["bundle"], "bought in the creation's block");
  assert.deepEqual(labels.get(BOB), ["sniper"], "bought within two minutes");
  assert.equal(labels.get(CAROL), undefined, "bought after two minutes; a sale earns no label");
  const unknown = walletLabels({ trades, creator: CREATOR, createdSlot: null, createdAt: null });
  assert.equal(unknown.get(ALICE), undefined, "without the creation's block and time nobody is called a bundle or a sniper");
  /* The pool after graduation is not the curve's opening: no label from a pool trade. */
  const pool = walletLabels({ trades: [trade({ n: 6, trader: ALICE, venue: "pool" })], creator: CREATOR, createdSlot: 100, createdAt: 1_000 });
  assert.equal(pool.get(ALICE), undefined);
  /* Tokens the creator paid for, delivered to another wallet: that wallet is the creator's bundle, whenever it happened. */
  const funded = walletLabels({ trades: [trade({ n: 7, trader: CAROL, payer: CREATOR, slot: 900, at: 9_000 })], creator: CREATOR, createdSlot: 100, createdAt: 1_000 });
  assert.deepEqual(funded.get(CAROL), ["bundle"]);
});

test("«the creator sold»: a fact worth a look, with the share of what they bought and the last sale's transaction", () => {
  const trades = [
    trade({ n: 1, trader: CREATOR, tokensRaw: "1000", at: 1_000 }),
    trade({ n: 2, trader: CREATOR, tokensRaw: "250", side: "sell", at: 2_000 }),
    trade({ n: 3, trader: CREATOR, tokensRaw: "150", side: "sell", at: 3_000 }),
  ];
  const activity = creatorActivity(trades, CREATOR);
  assert.equal(activity.boughtRaw, 1000n);
  assert.equal(activity.soldRaw, 400n);
  const groups = holderGroups([{ owner: CREATOR, amountRaw: "600", shareBps: 0, labels: ["creator"] }], SUPPLY);
  const base = { creator: CREATOR, creatorAccount: "CreatorAta11111111111111111111111111111111111", groups, supplyRaw: SUPPLY, openingRead: true, holders: { count: 40, atLeast: false }, createdAt: 1_000, now: 200_000, historyComplete: true };
  const facts = launchRiskFacts({ ...base, activity, tradesRead: 3, creatorCurves: 1 });
  const sold = facts.find((fact) => fact.code === "CREATOR_SOLD");
  assert.ok(sold, "the sale is a fact");
  assert.equal(sold.level, "attention");
  assert.equal(sold.values.soldBps, 4_000);
  assert.equal(sold.values.sales, 2);
  assert.equal(sold.values.at, 3_000);
  assert.deepEqual(sold.source, { kind: "tx", id: trades[2].signature }, "it leads to the last sale on chain");
  assert.equal(facts[0].code, "CREATOR_SOLD", "worth a look first");
  /* Nothing sold, nothing said. */
  const kept = launchRiskFacts({ ...base, activity: creatorActivity(trades.slice(0, 1), CREATOR), tradesRead: 1, creatorCurves: null });
  assert.equal(kept.some((fact) => fact.code === "CREATOR_SOLD"), false);
  assert.equal(kept.some((fact) => fact.code === "CREATOR_OTHER_CURVES"), false, "an unread count says nothing");
  assert.deepEqual(kept.find((fact) => fact.code === "CREATOR_HOLDS").source, { kind: "account", id: base.creatorAccount }, "the creator's holding is seen in their token account");
  /* Sold more than they bought here (tokens that came another way): a share of the supply, never «100 % of what they bought». */
  const beyond = launchRiskFacts({ ...base, activity: creatorActivity([trade({ n: 1, trader: CREATOR, tokensRaw: "100" }), trade({ n: 2, trader: CREATOR, tokensRaw: "300", side: "sell" })], CREATOR), tradesRead: 2, creatorCurves: null });
  const soldBeyond = beyond.find((fact) => fact.code === "CREATOR_SOLD");
  assert.equal(soldBeyond.values.soldBps, undefined);
  assert.equal(soldBeyond.values.supplyBps, Number((300n * 10_000n) / SUPPLY));
});

test("the groups: the curve, the pool and the lock are not people — the top ten are people only", () => {
  const holders = [
    { owner: "Curve", amountRaw: (SUPPLY / 2n).toString(), shareBps: 5_000, labels: ["curve"] },
    { owner: "Lock", amountRaw: (SUPPLY / 10n).toString(), shareBps: 1_000, labels: ["lock"] },
    { owner: CREATOR, amountRaw: (SUPPLY / 50n).toString(), shareBps: 200, labels: ["creator"] },
    { owner: ALICE, amountRaw: (SUPPLY / 20n).toString(), shareBps: 500, labels: ["bundle"] },
    { owner: BOB, amountRaw: (SUPPLY / 100n).toString(), shareBps: 100, labels: ["sniper"] },
  ];
  const groups = holderGroups(holders, SUPPLY);
  assert.equal(groups.creator.shareBps, 1_200, "the creator's 2 % and their lock's 10 % — the locked tokens are theirs, only not free yet");
  assert.deepEqual(groups.bundle, { shareBps: 500, wallets: 1 });
  assert.deepEqual(groups.snipers, { shareBps: 100, wallets: 1 });
  assert.equal(groups.top10.shareBps, 1_800, "creator (with the lock) + bundle + sniper; never the curve");
  /* A creator whose whole buy is in the lock still holds: one person, at the lock's share. */
  const lockedOnly = holderGroups([holders[0], holders[1]], SUPPLY);
  assert.equal(lockedOnly.creator.shareBps, 1_000);
  assert.equal(peopleHoldings([holders[0], holders[1]]).length, 1);
  const base = { creator: CREATOR, creatorAccount: "CreatorAta11111111111111111111111111111111111", activity: creatorActivity([], CREATOR), groups, supplyRaw: SUPPLY, createdAt: 1_000, now: 1_600, historyComplete: false, tradesRead: 300, creatorCurves: 4 };
  const facts = launchRiskFacts({ ...base, openingRead: true, holders: { count: 3, atLeast: false } });
  const codes = facts.map((fact) => fact.code);
  assert.ok(codes.includes("BUNDLE_HOLDS") && codes.includes("SNIPERS_HOLD") && codes.includes("FEW_HOLDERS"));
  assert.deepEqual(facts.find((fact) => fact.code === "FEW_HOLDERS").values, { count: 3 });
  assert.deepEqual(facts.find((fact) => fact.code === "CREATOR_OTHER_CURVES"), { code: "CREATOR_OTHER_CURVES", level: "info", values: { count: 3 }, source: null }, "a count over many curves leads to no one account");
  /* A count the node could not finish is a lower bound: it proves nothing thin, and says it is only a floor. */
  const floor = launchRiskFacts({ ...base, openingRead: true, holders: { count: 3, atLeast: true } });
  assert.equal(floor.some((fact) => fact.code === "FEW_HOLDERS"), false);
  assert.deepEqual(floor.find((fact) => fact.code === "HOLDERS_UNCOUNTED"), { code: "HOLDERS_UNCOUNTED", level: "info", values: { count: 3 }, source: null });
  assert.equal(facts.some((fact) => fact.code === "HOLDERS_UNCOUNTED"), false, "a whole count is said as it is");
  /* Opening minutes unread: no sniper or bundle fact, one line saying so. */
  const unread = launchRiskFacts({ ...base, openingRead: false, holders: { count: 30, atLeast: false } });
  assert.equal(unread.some((fact) => fact.code === "SNIPERS_HOLD" || fact.code === "BUNDLE_HOLDS"), false);
  assert.ok(unread.some((fact) => fact.code === "OPENING_UNREAD"));
  assert.deepEqual(facts.find((fact) => fact.code === "HISTORY_PARTIAL").values, { trades: 300 });
  /* A history read in part: an unknown is context, not a finding; the bundle is a floor unless the creator's own accounts were read whole. */
  assert.equal(facts.find((fact) => fact.code === "HISTORY_PARTIAL").level, "info");
  assert.deepEqual(facts.find((fact) => fact.code === "BUNDLE_HOLDS").values, { shareBps: 500, wallets: 1, atLeast: 1 });
  const creatorWhole = launchRiskFacts({ ...base, bundleWhole: true, openingRead: true, holders: { count: 3, atLeast: false } });
  assert.deepEqual(creatorWhole.find((fact) => fact.code === "BUNDLE_HOLDS").values, { shareBps: 500, wallets: 1 }, "every buy the creator paid for read: a count, not a floor");
  assert.ok(creatorWhole.some((fact) => fact.code === "HISTORY_PARTIAL"), "the history itself is still said to be partial");
  const whole = launchRiskFacts({ ...base, historyComplete: true, bundleWhole: true, openingRead: true, holders: { count: 3, atLeast: false } });
  assert.equal(whole.some((fact) => fact.code === "HISTORY_PARTIAL"), false);
  assert.equal(facts.find((fact) => fact.code === "YOUNG").values.seconds, 600);
  for (const fact of facts) assert.ok(fact.level === "attention" || fact.level === "info");
  const levels = facts.map((fact) => fact.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === b ? 0 : a === "attention" ? -1 : 1)), "attention first");
});

test("the chart: one value a second, the last trade of a second winning, from the opening price to now", () => {
  const trades = [trade({ n: 1, at: 10, slot: 1, priceAfter: 2 }), trade({ n: 2, at: 10, slot: 2, priceAfter: 3 }), trade({ n: 3, at: 20, slot: 3, priceAfter: 4 })];
  const points = marketSeries({ trades, openedAt: 5, openingPrice: 1, priceNow: 5, now: 30, supply: 10, pairUsd: 1 });
  assert.deepEqual(points, [
    { t: 5, marketCapUsd: 10 },
    { t: 10, marketCapUsd: 30 },
    { t: 20, marketCapUsd: 40 },
    { t: 30, marketCapUsd: 50 },
  ]);
  assert.deepEqual(marketSeries({ trades, openedAt: 5, openingPrice: 1, priceNow: 5, now: 30, supply: 10, pairUsd: null }), [], "no price of the pair, no chart in dollars");
  const marks = chartMarkers([trade({ n: 1, trader: CREATOR, at: 10 }), trade({ n: 2, trader: CREATOR, at: 20, side: "sell" }), trade({ n: 3, at: 15 })], CREATOR, { at: 25, signature: "grad" });
  assert.deepEqual(marks.map((mark) => mark.kind), ["creator-buy", "creator-sell", "graduated"]);
});

test("who gets the fee: on the curve the creator 40 % of the trading fee, Ryntra the rest and the referral, Meteora its protocol fee", () => {
  /* A 10 USDC buy on the stand's curve, quoted by the SDK: trading 80 349, protocol 16 070, referral 4 017. */
  const split = curveFeeSplit({ tradingFeeRaw: 80_349n, protocolFeeRaw: 16_070n, referralFeeRaw: 4_017n, creatorPct: 40 });
  assert.deepEqual(split, { totalRaw: "100436", creatorRaw: "32139", ryntraRaw: "52227", meteoraRaw: "16070", liquidityRaw: null });
  assert.equal(BigInt(split.creatorRaw) + BigInt(split.ryntraRaw) + BigInt(split.meteoraRaw), 100_436n, "every unit of the fee is someone's");
  const pool = poolFeeSplit({ claimingFeeRaw: 8n, compoundingFeeRaw: 8n, protocolFeeRaw: 3n, referralFeeRaw: 1n });
  assert.deepEqual(pool, { totalRaw: "20", creatorRaw: null, ryntraRaw: "1", meteoraRaw: "3", liquidityRaw: "16" });
});

test("small sums: shares round down, a slippage minimum never rounds up, a price move is signed", () => {
  assert.equal(shareBps(1n, 3n), 3_333);
  assert.equal(shareBps(5n, 0n), 0);
  assert.equal(minimumAfterSlippage(1_000_001n, 100), 990_000n);
  assert.equal(priceMoveBps(1, 1.05), 500);
  assert.equal(priceMoveBps(1, 0.9), -1_000);
  assert.equal(priceMoveBps(0, 1), 0);
});

test("a swap as a trade: the trader is whose tokens moved, the payer apart; what moved counts Ryntra's fee of the same transaction", () => {
  const swap = {
    signature: "sigSwap".padEnd(88, "1"),
    slot: 7,
    at: 1_500,
    venue: "pool",
    side: "buy",
    inRaw: 9_900_000n,
    outRaw: 128_941n,
    feesRaw: 99_000n,
    input: { account: "PayerUsdcAccount111111111111111111111111111", owner: CREATOR },
    output: { account: "Recipient7okenAccount11111111111111111111111", owner: ALICE },
    payer: CREATOR,
    ryntraFeeRaw: 100_000n,
    priceAfter: 0.0000753,
  };
  /* The creator pays, the tokens land with another wallet: that wallet is the trader, and its exact account is kept. */
  const bought = tradeOf(swap);
  assert.equal(bought.trader, ALICE);
  assert.equal(bought.payer, CREATOR);
  assert.equal(bought.account, "Recipient7okenAccount11111111111111111111111");
  assert.equal(bought.pairRaw, "10000000", "the buyer paid the swap's 9.9 and Ryntra's 0.1: 10 in all");
  assert.equal(bought.feeRaw, "199000", "the pool's fees and Ryntra's");
  assert.equal(bought.tokensRaw, "128941");
  /* A sale: the tokens left the seller's account; the seller kept the output less Ryntra's fee. */
  const sold = tradeOf({ ...swap, side: "sell", inRaw: 128_941n, outRaw: 9_800_000n, input: { account: "Se11erTokenAccount1111111111111111111111111", owner: BOB }, output: { account: null, owner: BOB }, payer: BOB, ryntraFeeRaw: 98_000n });
  assert.equal(sold.trader, BOB);
  assert.equal(sold.account, "Se11erTokenAccount1111111111111111111111111");
  assert.equal(sold.pairRaw, "9702000");
  assert.equal(sold.tokensRaw, "128941");
  /* Without Ryntra's fee and without a named owner: the swap's own figures, the payer as the trader. */
  const plain = tradeOf({ ...swap, venue: "curve", output: { account: null, owner: null }, ryntraFeeRaw: 0n });
  assert.equal(plain.trader, CREATOR);
  assert.equal(plain.pairRaw, "9900000");
  assert.equal(plain.feeRaw, "99000");
});

test("Ryntra's fee in the pool: its share of a buy leaves first, of a sale's quoted output last, and the sale's least is the swap's least less it", () => {
  assert.deepEqual(poolFeeBefore("buy", 10_000_000n, 100), { feeRaw: 100_000n, swapInRaw: 9_900_000n });
  assert.deepEqual(poolFeeBefore("sell", 128_941n, 100), { feeRaw: 0n, swapInRaw: 128_941n });
  assert.deepEqual(poolFeeAfter("buy", 128_941n, 100, 100), { feeRaw: 0n, amountOutRaw: 128_941n, minimumOutRaw: 127_651n, swapMinimumRaw: 127_651n });
  /* A sale quoted at 9.8: Ryntra's 1 % is 0.098, fixed at the quote; at 1 % slippage the swap must give at least 9.702, the seller at least 9.604. */
  assert.deepEqual(poolFeeAfter("sell", 9_800_000n, 100, 100), { feeRaw: 98_000n, amountOutRaw: 9_702_000n, minimumOutRaw: 9_604_000n, swapMinimumRaw: 9_702_000n });
  assert.equal(poolFeeAfter("sell", 10n, 100, 5_000).minimumOutRaw, 5n, "a least never goes below nothing");
  assert.deepEqual(poolFeeBefore("buy", 10_000_000n, 0), { feeRaw: 0n, swapInRaw: 10_000_000n }, "no fee where none is charged");
  /* The transfer's place: first on a buy — paid from what the wallet spends — last on a sale, from the proceeds. */
  assert.deepEqual(withPoolFee(["swap"], "fee", "buy"), ["fee", "swap"]);
  assert.deepEqual(withPoolFee(["setup", "swap"], "fee", "sell"), ["setup", "swap", "fee"]);
});

test("how much the creator sold: of what they bought here, or of the supply when they sold more — never 100 % on a guess", () => {
  const bought = (raw) => trade({ n: 1, trader: CREATOR, tokensRaw: String(raw) });
  const sold = (raw, n = 2) => trade({ n, trader: CREATOR, side: "sell", tokensRaw: String(raw) });
  assert.equal(creatorSoldShare(creatorActivity([bought(1_000)], CREATOR), SUPPLY), null);
  assert.deepEqual(creatorSoldShare(creatorActivity([bought(1_000), sold(300)], CREATOR), SUPPLY), { bps: 3_000, of: "bought" });
  assert.deepEqual(creatorSoldShare(creatorActivity([sold(SUPPLY / 50n)], CREATOR), SUPPLY), { bps: 200, of: "supply" }, "sold without buying here: 2 % of the supply, not «100 %»");
});

test("the day's volume is exact only when every trade of the day was read — judged by the listed times, never by the oldest trade read", () => {
  const day = 1_000_000;
  assert.equal(windowReadWhole({ complete: true, coveredFrom: null, gaps: [] }, day), true);
  /* The lists reach past the day and the only unread transaction is older than it: the day is whole. */
  assert.equal(windowReadWhole({ complete: false, coveredFrom: day - 500, gaps: [day - 10] }, day), true);
  /* A transaction of the day not read: a floor, though the creation's buy (read first) is older than the day. */
  assert.equal(windowReadWhole({ complete: false, coveredFrom: null, gaps: [day + 60] }, day), false);
  /* The lists were cut inside the day: what came before the cut is not known. */
  assert.equal(windowReadWhole({ complete: false, coveredFrom: day + 3_600, gaps: [] }, day), false);
});

test("a signature list is whole only when it reaches its account's first transaction, never because it is short", () => {
  const list = (...names) => names.map((signature) => ({ signature }));
  /* Newest first; the curve's first is the creation. */
  assert.deepEqual(listsWhole({ curve: list("c3", "c2", "create"), pool: null, creationSignature: "create", limit: 100 }), { curveWhole: true, poolWhole: true });
  /* A node that keeps a day returns three signatures of a week-old token: short, and not whole. */
  assert.deepEqual(listsWhole({ curve: list("c9", "c8", "c7"), pool: null, creationSignature: "create", limit: 100 }), { curveWhole: false, poolWhole: true });
  /* A full page may hide more beyond it, the creation included. */
  assert.equal(listsWhole({ curve: list("c2", "create"), pool: null, creationSignature: "create", limit: 2 }).curveWhole, false);
  /* Graduated: the pool's first is the migration, which the curve's whole list holds too. */
  const curve = list("migrate", "c2", "create");
  assert.deepEqual(listsWhole({ curve, pool: list("p2", "p1", "migrate"), creationSignature: "create", limit: 100 }), { curveWhole: true, poolWhole: true });
  /* A pool list cut short by the node: its oldest is not the migration. */
  assert.equal(listsWhole({ curve, pool: list("p9", "p8"), creationSignature: "create", limit: 100 }).poolWhole, false);
  /* A wallet's page: past the opening only with the creation, an older transaction or the whole history on it. */
  const opened = 1_000_000;
  const page = (...times) => times.map((blockTime, index) => ({ signature: `w${index}`, blockTime }));
  assert.equal(accountPageReached({ page: page(opened + 500, opened + 20), whole: false, creationSignature: "create", since: opened - 60 }), false, "the 200th signature 20 s after the opening: the first seconds' buys may lie beyond");
  assert.equal(accountPageReached({ page: page(opened + 500, opened - 3_600), whole: false, creationSignature: "create", since: opened - 60 }), true);
  assert.equal(accountPageReached({ page: [...page(opened + 500), { signature: "create", blockTime: opened }], whole: false, creationSignature: "create", since: opened - 60 }), true);
  assert.equal(accountPageReached({ page: page(opened + 500), whole: true, creationSignature: "create", since: opened - 60 }), true, "the whole history of the account");
  assert.equal(accountPageReached({ page: page(opened + 500), whole: false, creationSignature: null, since: null }), false);
  /* The curve's list not whole: the pool's is not trusted either. */
  assert.equal(listsWhole({ curve: list("migrate", "c2"), pool: list("p1", "migrate"), creationSignature: "create", limit: 100 }).poolWhole, false);
});