// Run from repo root: node --test lib/earn/earn.test.mjs
//
// Earn's own arithmetic and readers, on fixtures shaped like the documented Jupiter Lend answers.
//
// The cases here are the ones that decide whether the row is honest rather than merely working: a market with
// nothing left to pay a withdrawal, a withdrawal the market can only half pay, a rate that moved while a
// wallet was open, a provider that refuses, and a key that was never issued. Each of them is a figure a
// person would otherwise find out about after signing.
import assert from "node:assert/strict";
import test from "node:test";

import {
  availableRawOf,
  depositCheck,
  earnedRawOf,
  EARN_FEE_BPS,
  EARN_RATE_TOLERANCE_BPS,
  liquidityBand,
  minimumRawFor,
  rateDrift,
  rawFromText,
  rawOf,
  textFromRaw,
  usdOf,
  withdrawPlan,
} from "./model.ts";
import { earnProviders, earnProviderOn, jupiterLendKey, kaminoOn, earnNamed } from "./providers.ts";
import { admitEarn, withinCanary, EARN_CANARY_MAX_USD } from "./gate.ts";
import { marketsFrom, netDepositsFrom, positionFrom, positionReadsFrom, ratePercentOf, transactionFrom, unavailableFromStatus } from "./jupiter.ts";
import { kaminoMarketsFrom } from "./kamino.ts";
import { checkFreshAtSigning, earnCosts, planEarnAction } from "./review.ts";
import { stateFromStatus, buildEarnReceipt } from "./receipt.ts";
import {
  FIXTURE_HELD,
  JL_SOL_MINT,
  JL_USDC_MINT,
  JL_USDT_MINT,
  JUPITER_EARNINGS,
  JUPITER_POSITIONS,
  JUPITER_TOKENS,
  JUPITER_TOKENS_LIQUIDITY_GONE,
  JUPITER_TOKENS_RATE_FELL,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
} from "./fixtures.ts";

const READ_AT = "2026-10-26T10:00:00.000Z";
const markets = marketsFrom(JUPITER_TOKENS, READ_AT);
const usdc = markets.find((market) => market.id === USDC_MINT);
const usdt = markets.find((market) => market.id === USDT_MINT);
const sol = markets.find((market) => market.id === WSOL_MINT);

/* ------------------------------------------------------------------ amounts */

test("an amount a person typed survives the trip in both directions", () => {
  assert.equal(rawFromText("12.5", 6), 12_500_000n);
  assert.equal(rawFromText("12,50", 6), 12_500_000n);
  assert.equal(rawFromText(" 0.000001 ", 6), 1n);
  assert.equal(rawFromText("1.0000001", 6), null, "more decimals than the asset has is not an amount");
  assert.equal(rawFromText("-1", 6), null);
  assert.equal(rawFromText("", 6), null);
  assert.equal(textFromRaw(12_500_000n, 6), "12.5");
  assert.equal(textFromRaw("512400000", 6), "512.4");
  assert.equal(textFromRaw(1_000_000n, 6), "1");
  assert.equal(textFromRaw(512_400_000n, 6, 2), "512.4");
});

test("a malformed figure reads as unknown, never as zero", () => {
  assert.equal(rawOf("12000000"), 12_000_000n);
  assert.equal(rawOf(""), null);
  assert.equal(rawOf("12.5"), null);
  assert.equal(rawOf(-1), null);
  assert.equal(rawOf(null), null);
  assert.equal(usdOf("1000000", 6, 1), 1);
  assert.equal(usdOf("1000000", 6, null), null, "no price means no dollars, not zero dollars");
});

test("the minimum is a dollar of the asset, and nothing without a price", () => {
  assert.equal(minimumRawFor(6, 1), 1_000_000n);
  assert.equal(minimumRawFor(9, 180.5), 5_540_167n, "a dollar of SOL at 180.5 is about 0.00554 SOL");
  assert.equal(minimumRawFor(6, null), null);
  assert.equal(minimumRawFor(6, 0), null);
});

/* ------------------------------------------------------- the markets as read */

test("the documented answer reads into three markets, and the thin one says so", () => {
  assert.equal(markets.length, 3);
  assert.ok(usdc && usdt && sol);
  assert.equal(usdc.share.mint, JL_USDC_MINT);
  assert.equal(usdc.asset.symbol, "USDC");
  assert.equal(usdc.rateAnnualPercent, 4.12);
  assert.equal(usdc.liquidRaw, "2000000000000");
  assert.equal(usdc.minimumRaw, "1000000");
  assert.equal(liquidityBand(usdc), "full");
  assert.equal(liquidityBand(usdt), "partial", "40 USDT against 900 000 supplied is not a market you leave whole");
  assert.equal(liquidityBand(sol), "none");
});

test("a market with no liquidity is drawn as empty of liquidity, not as empty of information", () => {
  assert.ok(sol);
  assert.equal(sol.liquidRaw, "0");
  assert.equal(sol.rateAnnualPercent, 2.05, "the rate is still true while the door is shut");
  assert.equal(sol.suppliedRaw, "40000000000000");
  const refused = withdrawPlan({ askedRaw: 1_000_000_000n, positionRaw: 2_000_000_000n, liquidRaw: 0n });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "NO_LIQUIDITY");
});

test("a figure the answer does not carry is null rather than invented", () => {
  const [bare] = marketsFrom([{ address: JL_USDC_MINT, asset: { address: USDC_MINT, decimals: 6 } }], READ_AT);
  assert.ok(bare);
  assert.equal(bare.rateAnnualPercent, null);
  assert.equal(bare.liquidRaw, null);
  assert.equal(bare.suppliedRaw, null);
  assert.equal(bare.minimumRaw, null, "no price, no minimum — the form says so instead of guessing one");
  assert.equal(liquidityBand(bare), "unknown");
  assert.deepEqual(marketsFrom([{ address: JL_USDC_MINT }], READ_AT), [], "an entry without an asset is not a market");
  assert.deepEqual(marketsFrom({ nothing: true }, READ_AT), []);
});

test("a rate in the wrong unit is refused rather than drawn as hundreds of per cent", () => {
  assert.equal(ratePercentOf("4.12"), 4.12);
  assert.equal(ratePercentOf(0), 0);
  assert.equal(ratePercentOf("412"), null);
  assert.equal(ratePercentOf("-1"), null);
  assert.equal(ratePercentOf("not a number"), null);
});

/* ------------------------------------------------------------- the position */

test("a position is the chain's share count at the provider's exchange rate", () => {
  assert.ok(usdc);
  const read = positionReadsFrom(JUPITER_POSITIONS).find((entry) => entry.shareMint === JL_USDC_MINT);
  const net = netDepositsFrom(JUPITER_EARNINGS);
  const position = positionFrom({
    market: usdc,
    sharesOnChainRaw: BigInt(FIXTURE_HELD[JL_USDC_MINT]),
    read: read ?? null,
    netDepositRaw: net.get(JL_USDC_MINT) ?? null,
    readAt: READ_AT,
    readFrom: "solana-rpc.example",
  });
  assert.equal(position.underlyingRaw, "512400000");
  assert.equal(position.depositedRaw, "500000000");
  assert.equal(position.earnedRaw, "12400000", "earned is worth now less what went in");
  assert.equal(position.availableRaw, "512400000", "the whole position can leave while the market is liquid");
  assert.equal(position.readFrom, "solana-rpc.example");
});

test("the chain's count wins over the provider's cache", () => {
  assert.ok(usdc);
  const read = positionReadsFrom(JUPITER_POSITIONS).find((entry) => entry.shareMint === JL_USDC_MINT);
  const half = positionFrom({
    market: usdc,
    sharesOnChainRaw: 250_000_000n,
    read: read ?? null,
    netDepositRaw: 500_000_000n,
    readAt: READ_AT,
    readFrom: "solana-rpc.example",
  });
  assert.equal(half.underlyingRaw, "256200000", "half the shares are worth half the position");
  const gone = positionFrom({ market: usdc, sharesOnChainRaw: 0n, read: read ?? null, netDepositRaw: 500_000_000n, readAt: READ_AT, readFrom: "x" });
  assert.equal(gone.underlyingRaw, "0");
  assert.equal(gone.sharesRaw, "0");
});

test("a chain that could not be read leaves the position unknown rather than empty", () => {
  assert.ok(usdc);
  const read = positionReadsFrom(JUPITER_POSITIONS).find((entry) => entry.shareMint === JL_USDC_MINT);
  const unread = positionFrom({ market: usdc, sharesOnChainRaw: null, read: read ?? null, netDepositRaw: 500_000_000n, readAt: READ_AT, readFrom: "unread" });
  assert.equal(unread.sharesRaw, null, "«we could not look» is not «there is nothing there»");
  assert.equal(unread.underlyingRaw, null);
  assert.equal(unread.depositedRaw, null, "what went in means nothing beside a count nobody could read");
  assert.equal(unread.earnedRaw, null);
  assert.equal(unread.availableRaw, null);
});

test("earned and available are unknown when a side of them was not read", () => {
  assert.equal(earnedRawOf(512_400_000n, null), null);
  assert.equal(earnedRawOf(null, 500_000_000n), null);
  assert.equal(earnedRawOf(512_400_000n, 500_000_000n), 12_400_000n);
  assert.equal(availableRawOf(512_400_000n, null), null);
  assert.equal(availableRawOf(512_400_000n, 40_000_000n), 40_000_000n, "available is capped by what the market can pay");
});

/* --------------------------------------------------- deposits and withdrawals */

test("a partial withdrawal is planned as partial, with what stays behind", () => {
  const planned = withdrawPlan({ askedRaw: 100_000_000n, positionRaw: 121_000_000n, liquidRaw: 40_000_000n });
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.amountRaw, 40_000_000n);
  assert.equal(planned.plan.askedRaw, 100_000_000n);
  assert.equal(planned.plan.partial, true);
  assert.equal(planned.plan.leftRaw, 81_000_000n);
});

test("a withdrawal the market can pay whole is not called partial", () => {
  const planned = withdrawPlan({ askedRaw: 40_000_000n, positionRaw: 121_000_000n, liquidRaw: 40_000_000n });
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.partial, false);
  assert.equal(planned.plan.leftRaw, 81_000_000n);
});

test("a withdrawal is refused before anything is built when the figures refuse it", () => {
  assert.equal(withdrawPlan({ askedRaw: 1n, positionRaw: 0n, liquidRaw: 10n }).code, "NOTHING_IN_POSITION");
  assert.equal(withdrawPlan({ askedRaw: 11n, positionRaw: 10n, liquidRaw: 10n }).code, "OVER_POSITION");
  assert.equal(withdrawPlan({ askedRaw: 1n, positionRaw: null, liquidRaw: 10n }).code, "NOT_READ");
  assert.equal(withdrawPlan({ askedRaw: 1n, positionRaw: 10n, liquidRaw: null }).code, "NOT_READ");
});

test("a deposit is checked against the minimum and the wallet", () => {
  assert.equal(depositCheck({ askedRaw: 1_000_000n, minimumRaw: 1_000_000n, walletRaw: 1_000_000_000n }).ok, true);
  assert.equal(depositCheck({ askedRaw: 999_999n, minimumRaw: 1_000_000n, walletRaw: 1_000_000_000n }).code, "BELOW_MINIMUM");
  assert.equal(depositCheck({ askedRaw: 2_000_000_000n, minimumRaw: 1_000_000n, walletRaw: 1_000_000_000n }).code, "OVER_WALLET");
  assert.equal(depositCheck({ askedRaw: 2_000_000n, minimumRaw: 1_000_000n, walletRaw: null }).code, "NOT_READ");
});

test("the planner answers for the market it was given", () => {
  assert.ok(usdt && sol);
  const partial = planEarnAction({ action: "withdraw", market: usdt, askedRaw: 100_000_000n, walletRaw: null, positionRaw: 121_000_000n });
  assert.equal(partial.ok, true);
  assert.equal(partial.partial, true);
  assert.equal(partial.amountRaw, 40_000_000n);
  const dry = planEarnAction({ action: "withdraw", market: sol, askedRaw: 1_000_000n, walletRaw: null, positionRaw: 2_000_000n });
  assert.equal(dry.ok, false);
  assert.equal(dry.code, "NO_LIQUIDITY");
});

/* ------------------------------------------- the rate between quote and signature */

test("a rate that fell past the tolerance stops the bytes; one that rose does not", () => {
  const fell = marketsFrom(JUPITER_TOKENS_RATE_FELL, READ_AT).find((market) => market.id === USDC_MINT);
  assert.ok(fell);
  assert.equal(rateDrift(4.12, fell.rateAnnualPercent), -102);
  const stopped = checkFreshAtSigning({ action: "deposit", quotedRatePercent: 4.12, amountRaw: 10_000_000n, fresh: fell });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "RATE_MOVED");
  assert.equal(stopped.driftBps, -102);

  const rose = { ...fell, rateAnnualPercent: 5.5 };
  const allowed = checkFreshAtSigning({ action: "deposit", quotedRatePercent: 4.12, amountRaw: 10_000_000n, fresh: rose });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.driftBps, 138, "more than the person read is not a surprise worth refusing");
});

test("a move inside the tolerance passes, and the tolerance is the one the model names", () => {
  assert.ok(usdc);
  const nudged = { ...usdc, rateAnnualPercent: 4.12 - EARN_RATE_TOLERANCE_BPS / 100 };
  assert.equal(checkFreshAtSigning({ action: "deposit", quotedRatePercent: 4.12, amountRaw: 1n, fresh: nudged }).ok, true);
  const past = { ...usdc, rateAnnualPercent: 4.12 - (EARN_RATE_TOLERANCE_BPS + 1) / 100 };
  assert.equal(checkFreshAtSigning({ action: "deposit", quotedRatePercent: 4.12, amountRaw: 1n, fresh: past }).ok, false);
});

test("liquidity taken by somebody else stops a signed withdrawal", () => {
  const gone = marketsFrom(JUPITER_TOKENS_LIQUIDITY_GONE, READ_AT).find((market) => market.id === USDT_MINT);
  assert.ok(gone);
  const stopped = checkFreshAtSigning({ action: "withdraw", quotedRatePercent: 6.4, amountRaw: 40_000_000n, fresh: gone });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "NO_LIQUIDITY");
  /* The same market, the same moment, a deposit: nothing about a deposit depends on the exit being open. */
  assert.equal(checkFreshAtSigning({ action: "deposit", quotedRatePercent: 6.4, amountRaw: 40_000_000n, fresh: gone }).ok, true);
});

test("a market the provider no longer lists cannot confirm anything", () => {
  const stopped = checkFreshAtSigning({ action: "deposit", quotedRatePercent: 4.12, amountRaw: 1n, fresh: null });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "MARKET_GONE");
});

/* ------------------------------------------------------------------- the fee */

test("Ryntra's cut is zero and says so on its own line", () => {
  assert.equal(EARN_FEE_BPS, 0);
  const costs = earnCosts("jupiter");
  const ryntra = costs.find((line) => line.id === "ryntra");
  assert.ok(ryntra);
  assert.equal(ryntra.bps, 0);
  assert.match(ryntra.note, /Ryntra takes nothing/);
  assert.ok(costs.some((line) => line.id === "network"), "the network's own fee is named too");
});

/* -------------------------------------------------------------- the providers */

test("without a key Jupiter Lend is unavailable, and the page is told which key", () => {
  const [jupiter] = earnProviders({});
  assert.equal(jupiter.provider, "jupiter");
  assert.equal(jupiter.blocked?.code, "NO_KEY");
  assert.match(jupiter.blocked?.reason ?? "", /RYNTRA_JUPITER_LEND_API_KEY/);
  assert.equal(earnProviderOn("jupiter", {}), false);
  assert.equal(jupiterLendKey({}), null);
});

test("the Lend key is the Lend key first, then the product's own Jupiter key", () => {
  assert.equal(jupiterLendKey({ RYNTRA_JUPITER_LEND_API_KEY: " lend ", RYNTRA_JUPITER_API_KEY: "swap" }), "lend");
  assert.equal(jupiterLendKey({ RYNTRA_JUPITER_API_KEY: "swap" }), "swap");
  assert.equal(jupiterLendKey({ RYNTRA_JUPITER_API_KEY: "   " }), null);
  assert.equal(earnProviderOn("jupiter", { RYNTRA_JUPITER_LEND_API_KEY: "k" }), true);
});

test("Kamino is built, switched off, and says which switch turns it on", () => {
  const [, kamino] = earnProviders({});
  assert.equal(kamino.provider, "kamino");
  assert.equal(kamino.name, "Kamino Lend");
  assert.equal(kamino.blocked?.code, "DISABLED");
  assert.match(kamino.blocked?.reason ?? "", /RYNTRA_EARN_KAMINO=on/);
  assert.equal(kaminoOn({}), false);
  assert.equal(kaminoOn({ RYNTRA_EARN_KAMINO: "ON" }), true);
  assert.equal(kaminoOn({ RYNTRA_EARN_KAMINO: "yes" }), false, "only «on» turns a provider on");
  assert.equal(earnProviders({ RYNTRA_EARN_KAMINO: "on" })[1].blocked, null);
});

test("Kamino's reserves read into the same market shape as Jupiter's", () => {
  const read = kaminoMarketsFrom(
    {
      reserves: [
        {
          reserveAddress: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
          liquidityToken: USDC_MINT,
          liquidityTokenDecimals: 6,
          symbol: "USDC",
          supplyInterestAPY: 0.0375,
          price: 1,
          totalSupply: "5000000000000",
          availableAmount: "900000000000",
        },
        { nothing: "readable" },
      ],
    },
    READ_AT,
  );
  assert.equal(read.length, 1, "an unreadable reserve is dropped, never filled in");
  assert.equal(read[0].provider, "kamino");
  assert.equal(read[0].rateAnnualPercent, 3.75);
  assert.equal(read[0].liquidRaw, "900000000000");
  assert.equal(read[0].minimumRaw, "1000000");
});

test("the menu row is drawn only where a deployment says Earn is reachable", () => {
  assert.equal(earnNamed(undefined), false);
  assert.equal(earnNamed(""), false);
  assert.equal(earnNamed("on"), true);
  assert.equal(earnNamed(" ON "), true);
  assert.equal(earnNamed("later"), false);
});

/* ------------------------------------------------------------------ failures */

test("a refused key is reported as the key's problem, not as an outage", () => {
  assert.equal(unavailableFromStatus(401).code, "NO_KEY");
  assert.equal(unavailableFromStatus(403).code, "NO_KEY");
  assert.match(unavailableFromStatus(403).reason, /Lend API access/);
  assert.equal(unavailableFromStatus(500).code, "PROVIDER_DOWN");
  assert.equal(unavailableFromStatus(429).code, "PROVIDER_DOWN");
});

test("a transaction is read only when it looks like one", () => {
  const long = "A".repeat(200);
  assert.equal(transactionFrom({ transaction: long }), long);
  assert.equal(transactionFrom({ transaction: "short" }), null);
  assert.equal(transactionFrom({ transaction: 42 }), null);
  assert.equal(transactionFrom({}), null);
  assert.equal(transactionFrom(null), null);
});

/* ---------------------------------------------------------------- the gate */

test("Earn actions are closed until a deployment opens them", () => {
  assert.equal(admitEarn("Rb1Wa11et1111111111111111111111111111111111", {}).ok, false);
  assert.equal(admitEarn(null, { RYNTRA_EARN_ACTIONS: "CANARY", RYNTRA_EARN_CANARY_WALLET: "w" }).ok, false);
  const open = admitEarn("Rb1Wa11et1111111111111111111111111111111111", { RYNTRA_EARN_ACTIONS: "open" });
  assert.equal(open.ok, true);
  assert.equal(open.mode, "OPEN");
  assert.equal(open.maxUsd, null);
});

test("a canary admits one wallet, up to a ceiling in dollars", () => {
  const env = { RYNTRA_EARN_ACTIONS: "CANARY", RYNTRA_EARN_CANARY_WALLET: "Rb1Wa11et1111111111111111111111111111111111" };
  const stranger = admitEarn("Rb2Wa11et1111111111111111111111111111111111", env);
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, "ACTIONS_CLOSED", "a stranger under a canary is told what a stranger under a closed gate is told");
  const admitted = admitEarn(env.RYNTRA_EARN_CANARY_WALLET, env);
  assert.equal(admitted.ok, true);
  assert.equal(admitted.maxUsd, EARN_CANARY_MAX_USD);
  assert.equal(withinCanary(admitted, 4.5), true);
  assert.equal(withinCanary(admitted, 5.01), false);
  assert.equal(withinCanary(admitted, null), false, "a ceiling that cannot be evaluated is not a ceiling");
  assert.equal(withinCanary(admitEarn("w", { RYNTRA_EARN_ACTIONS: "OPEN" }), null), true, "open takes any amount");
});

/* ---------------------------------------------------------------- receipts */

test("a signature nobody has seen is unknown, not failed", () => {
  assert.deepEqual(stateFromStatus(null), { state: "UNKNOWN", reason: null });
  assert.deepEqual(stateFromStatus({ err: null, confirmationStatus: "confirmed" }), { state: "LANDED", reason: null });
  assert.equal(stateFromStatus({ err: { InstructionError: [0, "Custom"] } }).state, "FAILED");
  assert.equal(stateFromStatus({ err: null, confirmationStatus: null }).state, "UNKNOWN");
});

test("the receipt carries the zero fee and the rate the person signed", () => {
  const receipt = buildEarnReceipt({
    provider: "jupiter",
    action: "deposit",
    signature: "5".repeat(64),
    state: "LANDED",
    amountRaw: 10_000_000n,
    asset: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
    rateAnnualPercent: 4.12,
    rateDriftBps: -3,
    sentAt: Date.parse(READ_AT),
  });
  assert.equal(receipt.feeBps, 0);
  assert.equal(receipt.amountRaw, "10000000");
  assert.equal(receipt.rateAnnualPercent, 4.12);
  assert.equal(receipt.rateDriftBps, -3);
  assert.equal(receipt.sentAt, READ_AT);
  assert.equal(receipt.reason, null);
});

test("the fixtures name the three markets the tests need", () => {
  assert.equal(Object.keys(FIXTURE_HELD).includes(JL_SOL_MINT), true);
  assert.equal(JUPITER_TOKENS.length, 3);
  assert.equal(JUPITER_TOKENS_RATE_FELL.length, 3);
  assert.equal(JUPITER_TOKENS_LIQUIDITY_GONE.length, 3);
  assert.equal(marketsFrom(JUPITER_TOKENS_RATE_FELL, READ_AT).find((market) => market.id === USDC_MINT)?.rateAnnualPercent, 3.1);
  assert.equal(marketsFrom(JUPITER_TOKENS_LIQUIDITY_GONE, READ_AT).find((market) => market.id === USDT_MINT)?.liquidRaw, "0");
  assert.equal(JL_USDT_MINT.length <= 44, true);
});
