import assert from "node:assert/strict";
import test from "node:test";

import { projectFinance } from "./finance.ts";

const USDC = (value) => String(Math.round(value * 1_000_000));
const NOW = "2026-10-19T12:00:00.000Z";
const NOW_S = Date.parse(NOW) / 1000;
const DAY = 86_400;

/** A creator role's counters: the curve's total trading fee, 40 % to the creator, what the creator has not claimed. */
const counters = ({ total, unclaimed = "0", migrated = false, withdrawn = false, lp = null }) => ({
  roleOwner: "creator",
  curve: { totalTradingRaw: total, creatorPct: 40, unclaimedRaw: unclaimed },
  graduation: { migrated, thresholdRaw: USDC(15_454.411163), feePct: 2, creatorPct: 40, withdrawn },
  lp,
  sharing: null,
});

/** Three curve trades: 1, 2 and 0.5 USDC of trading fee, the creator's 40 % rounded down, Ryntra's part with a referral on one. */
function curveTrades() {
  const fees = [1_000_000n, 2_000_000n, 500_000n];
  return fees.map((fee, index) => {
    const creator = (fee * 40n) / 100n;
    const partner = fee - creator;
    const referral = index === 1 ? 100_000n : 0n;
    return { signature: `sig-${index}`, at: NOW_S - (index === 0 ? 40 * DAY : DAY), trader: index === 2 ? "trader-a" : `trader-${index}`, venue: "curve", creatorRaw: creator.toString(), ryntraRaw: (partner + referral).toString(), ownRaw: "0", maker: false };
  });
}

function launch(overrides = {}) {
  return {
    token: "TokenMint1111111111111111111111111111111111",
    symbol: "WICK",
    preset: "protected",
    creator: "creator",
    own: false,
    launchedAt: "2026-10-07T06:04:09.000Z",
    pair: { decimals: 6, dollar: true },
    trades: curveTrades(),
    tradesComplete: true,
    counters: counters({ total: "3500000", unclaimed: "1400000" }),
    partner: { curveUnclaimedRaw: "1100000", migrated: false, migration: { raw: "0", withdrawn: false }, surplus: { raw: "0", withdrawn: false }, lp: null, lpUnread: false, feeClaimer: "vault" },
    claims: [{ signature: "claim-1", at: NOW, source: "curve", pairRaw: "1000000", tokenRaw: "0" }],
    claimsComplete: true,
    ledgerClaims: null,
    creatorReceipts: [],
    ledgerTrades: [{ signature: "sig-1", ryntraRaw: String(1_200_000 + 100_000) }],
    ...overrides,
  };
}

function inputs(overrides = {}) {
  return {
    now: NOW,
    scope: "all",
    launches: [launch()],
    launchesUnread: 0,
    operations: [],
    terminalChain: { complete: true, readAt: NOW, credits: new Map(), balances: [] },
    rewards: { entries: [], payouts: new Map(), unparsed: 0 },
    costs: { wallets: [{ role: "executor", address: "exec", lamports: "1000000000", transactions: 3, complete: true }], executorLedgerLamports: "500000000", growthSpentMicros: "0" },
    prices: { So11111111111111111111111111111111111111112: 150 },
    internalWallets: new Set(["owner"]),
    internalComplete: true,
    readAt: NOW,
    ...overrides,
  };
}

test("a launch whose events, counters and claims agree: every sum matches, revenue on Protected is all of Ryntra's part", () => {
  const model = projectFinance(inputs());
  /* The partner's part: 3.5 − 1.4 (the creator's 40 %) = 2.1 USDC; the referral 0.1; claimed 1.0; claimable 1.1. */
  assert.deepEqual(model.differences, []);
  assert.equal(model.lines.earned.check, "MATCH");
  assert.equal(model.lines.earned.usd, 2.2);
  assert.equal(model.lines.claimed.usd, 1);
  assert.equal(model.lines.claimable.usd, 1.1);
  assert.equal(model.split.revenue.usd, 2.2);
  assert.equal(model.split.budget.usd, 0);
  /* The creator took nothing: the counter's 1.4 is all unclaimed. */
  assert.equal(model.lines.creators.usd, 0);
  assert.equal(model.lines.costs.usd, 150, "1 SOL of fees at $150");
  assert.equal(model.lines.net.usd, 2.2 - 150);
  assert.equal(model.allMatched, true);
});

test("Micro: three quarters of the curve revenue, a quarter the market's budget, by the one rule", () => {
  const model = projectFinance(inputs({ launches: [launch({ preset: "micro", ledgerTrades: [] })] }));
  /* 2.1 partner ⇒ 1.575 revenue + 0.525 budget; the referral 0.1 stays revenue. */
  assert.equal(model.split.budget.usd, 0.525);
  assert.equal(model.split.revenue.usd, 1.675);
  assert.equal(model.launches[0].budget.usd, 0.525);
});

test("swap events that do not add up to Meteora's counter are a difference, named and kept out of nothing", () => {
  const model = projectFinance(inputs({ launches: [launch({ counters: counters({ total: "4500000", unclaimed: "1400000" }) })] }));
  const kinds = model.differences.map((difference) => difference.kind);
  assert.ok(kinds.includes("CURVE_EVENTS_VS_COUNTER"), kinds.join());
  assert.equal(model.lines.earned.check, "DIFF");
  assert.equal(model.allMatched, false);
});

test("claims seen against what the counter says was taken out", () => {
  const model = projectFinance(inputs({ launches: [launch({ claims: [] })] }));
  const difference = model.differences.find((entry) => entry.kind === "PARTNER_CLAIMS_VS_COUNTER");
  assert.ok(difference);
  assert.equal(difference.chainUsd, 1);
  assert.equal(difference.ledgerUsd, 0);
  assert.equal(model.lines.claimed.check, "DIFF");
});

test("the executor's ledger against its claims' transactions: missing, extra and a different amount", () => {
  const model = projectFinance(
    inputs({
      launches: [
        launch({
          preset: "micro",
          ledgerTrades: [],
          claims: [
            { signature: "claim-1", at: NOW, source: "curve", pairRaw: "600000", tokenRaw: "0" },
            { signature: "claim-2", at: NOW, source: "curve", pairRaw: "400000", tokenRaw: "0" },
          ],
          ledgerClaims: [
            { signature: "claim-1", source: "curve", pairRaw: "500000" },
            { signature: "claim-9", source: "curve", pairRaw: "100000" },
          ],
        }),
      ],
    }),
  );
  const kinds = model.differences.map((difference) => difference.kind).sort();
  assert.deepEqual(kinds, ["CHAIN_CLAIM_NOT_IN_LEDGER", "LEDGER_CLAIM_AMOUNT", "LEDGER_CLAIM_NOT_ON_CHAIN"]);
  assert.equal(model.lines.claimed.ledgerUsd, 0.6);
});

test("a migration fee marked withdrawn with no claim found is a difference; one not withdrawn is claimable", () => {
  const partner = { curveUnclaimedRaw: "1100000", migrated: true, migration: { raw: USDC(185.45), withdrawn: true }, surplus: { raw: "0", withdrawn: false }, lp: null, lpUnread: false, feeClaimer: "vault" };
  const withdrawn = projectFinance(inputs({ launches: [launch({ partner })] }));
  assert.ok(withdrawn.differences.some((entry) => entry.kind === "WITHDRAWN_WITHOUT_CLAIM"));
  const waiting = projectFinance(inputs({ launches: [launch({ partner: { ...partner, migration: { raw: USDC(185.45), withdrawn: false } } })] }));
  assert.equal(waiting.lines.claimable.usd, 186.55);
  assert.equal(waiting.differences.length, 0);
});

test("a trade sent through Ryntra whose recorded part differs from its transaction", () => {
  const model = projectFinance(inputs({ launches: [launch({ ledgerTrades: [{ signature: "sig-1", ryntraRaw: "999" }, { signature: "sig-404", ryntraRaw: "1" }] })] }));
  const kinds = model.differences.map((difference) => difference.kind).sort();
  assert.deepEqual(kinds, ["LAUNCH_TRADE_AMOUNT", "LAUNCH_TRADE_NOT_ON_CHAIN"]);
});

test("what was not read is unread and a floor — never a zero", () => {
  const model = projectFinance(inputs({ launches: [launch({ trades: null, tradesComplete: false, partner: null, claims: null, claimsComplete: false })], launchesUnread: 2 }));
  assert.equal(model.lines.claimable.usd, null);
  assert.equal(model.lines.claimable.check, "UNREAD");
  assert.equal(model.lines.earned.check, "UNREAD");
  assert.ok(model.unread.some((entry) => entry.kind === "LAUNCHES_NOT_REACHED" && entry.count === 2));
  assert.equal(model.allMatched, false);
  const none = projectFinance(inputs({ launches: null }));
  assert.equal(none.lines.claimed.usd, null);
});

test("the creators' side: paid by the counters; receipts above them are a difference, below them are not", () => {
  const paid = counters({ total: "3500000", unclaimed: "400000" });
  const fine = projectFinance(inputs({ launches: [launch({ counters: paid, creatorReceipts: [{ signature: "c-1", receivedRaw: "500000" }] })] }));
  assert.equal(fine.lines.creators.usd, 1);
  assert.equal(fine.lines.creators.check, "MATCH");
  const above = projectFinance(inputs({ launches: [launch({ counters: paid, creatorReceipts: [{ signature: "c-1", receivedRaw: "2000000" }] })] }));
  assert.ok(above.differences.some((entry) => entry.kind === "CREATOR_RECEIPTS_ABOVE_CHAIN"));
});

test("the terminal: a collected fee against its chain credit — matched, missing and a different amount", () => {
  const op = (id, signature, gross, ryntraUsd) => ({ id, signature, product: "SWAP", status: "CONFIRMED", internal: false, at: "2026-10-18T00:00:00.000Z", feeCollected: true, ryntraUsd, feeAsset: "USDC-mint", feeGrossRaw: gross, verification: "VERIFIED" });
  const credits = new Map([
    ["t-1", [{ mint: "USDC-mint", amountRaw: "1000" }]],
    ["t-2", [{ mint: "USDC-mint", amountRaw: "900" }]],
    ["t-9", [{ mint: "USDC-mint", amountRaw: "5" }]],
  ]);
  const model = projectFinance(inputs({ launches: [], operations: [op("a", "t-1", "1000", 0.0008), op("b", "t-2", "1000", 0.0008), op("c", "t-3", "1000", 0.0008)], terminalChain: { complete: true, readAt: NOW, credits, balances: [] } }));
  const kinds = model.differences.map((difference) => difference.kind).sort();
  assert.deepEqual(kinds, ["TERMINAL_CHAIN_NOT_IN_LEDGER", "TERMINAL_FEE_AMOUNT", "TERMINAL_FEE_NOT_ON_CHAIN"]);
  assert.equal(model.lines.earned.parts.find((part) => part.id === "terminal").usd, 0.0024);
});

test("rewards: accruals backed by verified operations match; a payout is checked against its transaction", () => {
  const entry = (type, usdMicros, ref, extra = {}) => ({ type, recipient: "wallet-1", rateBps: 1000, shareRaw: null, usdMicros, valuation: { basis: "STABLECOIN_PAR" }, source: ref ? { operationRef: ref } : null, createdAt: NOW, claimId: null, signature: null, ...extra });
  const operations = [{ id: "o", signature: "op-1", product: "SWAP", status: "CONFIRMED", internal: false, at: NOW, feeCollected: true, ryntraUsd: 1, feeAsset: null, feeGrossRaw: null, verification: "VERIFIED" }];
  const entries = [entry("CASHBACK", "100000", "op-1"), entry("REFERRAL_L1", "50000", "op-1"), entry("CASHBACK", "70000", "ghost"), entry("CLAIM", "-150000", null, { signature: "pay-1" }), entry("CLAIM", "-20000", null, { signature: "pay-2" })];
  const payouts = new Map([
    ["pay-1", { landed: true, receivedRaw: "150000" }],
    ["pay-2", { landed: false, receivedRaw: null }],
  ]);
  const model = projectFinance(inputs({ launches: [], operations, terminalChain: { complete: true, readAt: NOW, credits: new Map([["op-1", []]]), balances: [] }, rewards: { entries, payouts, unparsed: 0 } }));
  assert.equal(model.lines.cashback.usd, 0.17);
  assert.equal(model.lines.referrals.usd, 0.05);
  const kinds = model.differences.map((difference) => difference.kind).sort();
  assert.deepEqual(kinds, ["REWARD_PAYOUT_NOT_ON_CHAIN", "REWARD_WITHOUT_OPERATION"]);
  assert.equal(model.lines.cashback.ledgerUsd, 0.17);
  assert.equal(model.lines.cashback.chainUsd, 0.15);
});

test("scope «without Ryntra's own» leaves Ryntra's launches, operations and wallets out", () => {
  const model = projectFinance(inputs({ scope: "external", launches: [launch({ own: true })] }));
  assert.equal(model.launches.length, 0);
  assert.equal(model.lines.earned.usd, 0);
});

test("the business figures: median revenue, active creators, repeat traders, D7 and D30, execution success", () => {
  const ops = ["CONFIRMED", "CONFIRMED", "CONFIRMED", "FAILED", "IN_FLIGHT"].map((status, index) => ({ id: String(index), signature: `o-${index}`, product: index === 0 ? "LAUNCH" : "SWAP", status, internal: false, at: NOW, feeCollected: false, ryntraUsd: null, feeAsset: null, feeGrossRaw: null, verification: "NOT_APPLICABLE" }));
  const model = projectFinance(inputs({ operations: ops }));
  const metrics = model.metrics;
  assert.equal(metrics.medianRevenuePerLaunch.value, 2.2);
  assert.equal(metrics.activeCreators.value, 1);
  /* trader-0 traded 40 days ago; trader-1 and trader-a a day ago: three traders, none twice. */
  assert.equal(metrics.traders.value, 3);
  assert.equal(metrics.repeatTraders.value, 0);
  /* Only trader-0 is old enough for D7 and D30, and did not come back. */
  assert.deepEqual([metrics.d7.value, metrics.d7.n], [0, 1]);
  assert.deepEqual([metrics.d30.value, metrics.d30.n], [0, 1]);
  assert.equal(metrics.executionSuccess.value, 0.75);
  assert.equal(metrics.executionSuccess.n, 4);
  assert.equal(metrics.executionByProduct.LAUNCH.value, 1);
});

test("claims against the counter when the trades were read in part: less than the floor is a difference, more is only unread", () => {
  const partial = { trades: curveTrades().slice(1), tradesComplete: false };
  /* The floor: 3.5 − 1.4 = 2.1 partner, 1.1 unclaimed ⇒ at least 1.0 taken out. */
  const more = projectFinance(inputs({ launches: [launch({ ...partial, claims: [{ signature: "claim-1", at: NOW, source: "curve", pairRaw: "1000002", tokenRaw: "0" }] })] }));
  assert.equal(more.differences.filter((entry) => entry.kind === "PARTNER_CLAIMS_VS_COUNTER").length, 0);
  assert.equal(more.lines.claimed.check, "UNREAD");
  const unreadMarket = projectFinance(inputs({ launches: [launch({ trades: null, tradesComplete: false })] }));
  assert.equal(unreadMarket.differences.filter((entry) => entry.kind === "PARTNER_CLAIMS_VS_COUNTER").length, 0, "no market read is no difference");
  assert.equal(unreadMarket.lines.earned.atLeast, true);
  const less = projectFinance(inputs({ launches: [launch({ ...partial, claims: [{ signature: "claim-1", at: NOW, source: "curve", pairRaw: "900000", tokenRaw: "0" }] })] }));
  assert.ok(less.differences.some((entry) => entry.kind === "PARTNER_CLAIMS_VS_COUNTER"));
});

test("a terminal trade through a launch's curve: its own fee is the terminal's, never the launch's referral too", () => {
  /* sig-1 carries 0.3 of Ryntra's own fee in the same transaction (in ryntraRaw and in ownRaw). */
  const trades = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: String(BigInt(trade.ryntraRaw) + 300_000n), ownRaw: "300000" } : trade));
  const op = { id: "s", signature: "sig-1", product: "SPOT", status: "CONFIRMED", internal: false, at: NOW, feeCollected: true, ryntraUsd: 0.3, feeAsset: null, feeGrossRaw: null, verification: "VERIFIED" };
  const model = projectFinance(inputs({ launches: [launch({ trades, ledgerTrades: [] })], operations: [op], terminalChain: { complete: true, readAt: NOW, credits: new Map([["sig-1", []]]), balances: [] } }));
  assert.equal(model.lines.earned.parts.find((part) => part.id === "referral").usd, 0.1);
  assert.equal(model.lines.earned.parts.find((part) => part.id === "terminal").usd, 0.3);
  assert.equal(model.lines.earned.usd, 2.5);
  /* An Ultra swap through the same curve pays Jupiter's referral account, not the fee wallet: ownRaw 0, the terminal counts it. */
  const ultra = projectFinance(inputs({ launches: [launch({ ledgerTrades: [] })], operations: [{ ...op, product: "SWAP" }], terminalChain: { complete: true, readAt: NOW, credits: new Map([["sig-1", []]]), balances: [] } }));
  assert.equal(ultra.lines.earned.usd, 2.5);
  /* A trade decoded before its own fee was counted, that is one of the terminal's operations: not known — unread. */
  const old = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ownRaw: undefined } : trade));
  const unknown = projectFinance(inputs({ launches: [launch({ trades: old, ledgerTrades: [] })], operations: [op], terminalChain: { complete: true, readAt: NOW, credits: new Map([["sig-1", []]]), balances: [] } }));
  assert.equal(unknown.lines.earned.check, "UNREAD");
});

test("a market that traded minutes before the read: events against counters is unread, not a difference", () => {
  const trades = curveTrades().map((trade, index) => (index === 2 ? { ...trade, at: NOW_S - 60 } : trade));
  const model = projectFinance(inputs({ launches: [launch({ trades, counters: counters({ total: "4500000", unclaimed: "1400000" }) })] }));
  assert.equal(model.differences.filter((entry) => entry.kind === "CURVE_EVENTS_VS_COUNTER").length, 0);
  assert.ok(model.unread.some((entry) => entry.kind === "MARKET_MOVED" && entry.subject === "WICK"));
  assert.equal(model.lines.earned.check, "UNREAD");
});

test("a payout whose transaction never landed is a difference", () => {
  const entries = [{ type: "CLAIM", recipient: "wallet-1", rateBps: 0, shareRaw: null, usdMicros: "-150000", valuation: { basis: "STABLECOIN_PAR" }, source: null, createdAt: NOW, claimId: "c", signature: "pay-9" }];
  const model = projectFinance(inputs({ launches: [], rewards: { entries, payouts: new Map([["pay-9", { landed: false, receivedRaw: null }]]), unparsed: 0 } }));
  assert.ok(model.differences.some((entry) => entry.kind === "REWARD_PAYOUT_NOT_ON_CHAIN" && entry.ref === "pay-9"));
});

test("scope «without Ryntra's own»: an internal operation's chain credit is no difference", () => {
  const op = { id: "i", signature: "t-1", product: "SWAP", status: "CONFIRMED", internal: true, at: NOW, feeCollected: true, ryntraUsd: 0.1, feeAsset: "USDC-mint", feeGrossRaw: "1000", verification: "VERIFIED" };
  const model = projectFinance(inputs({ scope: "external", launches: [], operations: [op], terminalChain: { complete: true, readAt: NOW, credits: new Map([["t-1", [{ mint: "USDC-mint", amountRaw: "1000" }]]]), balances: [] } }));
  assert.deepEqual(model.differences, []);
  assert.equal(model.lines.earned.usd, 0);
});

test("the net: costs read in part make it a ceiling (≤), revenue read in part a floor (≥), both — unknown", () => {
  const partCosts = { wallets: [{ role: "executor", address: "exec", lamports: "1000000000", transactions: 3, complete: false }], executorLedgerLamports: null, growthSpentMicros: "0" };
  const ceiling = projectFinance(inputs({ costs: partCosts }));
  assert.equal(ceiling.lines.net.atMost, true);
  assert.equal(ceiling.lines.net.atLeast, false);
  assert.equal(ceiling.lines.net.check, "UNREAD");
  const floor = projectFinance(inputs({ launches: [launch({ trades: null, tradesComplete: false })] }));
  assert.equal(floor.lines.net.atLeast, true);
  const both = projectFinance(inputs({ costs: partCosts, launches: [launch({ trades: null, tradesComplete: false })] }));
  assert.equal(both.lines.net.usd, null);
});

test("a payout a node would not give now is unread, not missing from the chain", () => {
  const entries = [{ type: "CLAIM", recipient: "wallet-1", rateBps: 0, shareRaw: null, usdMicros: "-150000", valuation: { basis: "STABLECOIN_PAR" }, source: null, createdAt: NOW, claimId: "c", signature: "pay-1" }];
  const model = projectFinance(inputs({ launches: [], rewards: { entries, payouts: new Map([["pay-1", { landed: null, receivedRaw: null }]]), unparsed: 0 } }));
  assert.deepEqual(model.differences, []);
  assert.equal(model.lines.cashback.check, "UNREAD");
});

test("metrics say unread when the launches were not read, and floors when some were not reached", () => {
  const none = projectFinance(inputs({ launches: null }));
  assert.equal(none.metrics.activeCreators.value, null);
  assert.equal(none.metrics.repeatTraders.value, null);
  assert.equal(none.metrics.d7.value, null);
  const some = projectFinance(inputs({ launchesUnread: 3 }));
  assert.equal(some.metrics.traders.atLeast, true);
  assert.equal(some.metrics.medianRevenuePerLaunch.atLeast, true);
});

test("«without Ryntra's own» with the list of own wallets unread says so", () => {
  const model = projectFinance(inputs({ scope: "external", internalComplete: false }));
  assert.ok(model.unread.some((entry) => entry.kind === "OWN_WALLETS"));
  assert.equal(model.allMatched, false);
});

test("a recorded trade whose chain part was not counted is unread, not a difference; rows the ledger schema refuses make rewards unread", () => {
  const trades = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: undefined } : trade));
  const model = projectFinance(inputs({ launches: [launch({ trades })] }));
  assert.equal(model.differences.filter((entry) => entry.kind === "LAUNCH_TRADE_AMOUNT").length, 0);
  const rows = projectFinance(inputs({ launches: [], rewards: { entries: [], payouts: new Map(), unparsed: 2 } }));
  assert.ok(rows.unread.some((entry) => entry.kind === "REWARD_ROWS" && entry.count === 2));
  assert.equal(rows.lines.cashback.check, "UNREAD");
});

test("a terminal trade decoded before its own fee was counted apart: the referral is a floor, nothing counted twice", () => {
  const legacy = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: String(BigInt(trade.ryntraRaw) + 300_000n), ownRaw: undefined } : trade));
  const op = { id: "s", signature: "sig-1", product: "SPOT", status: "CONFIRMED", internal: false, at: NOW, feeCollected: true, ryntraUsd: 0.3, feeAsset: null, feeGrossRaw: null, verification: "VERIFIED" };
  const model = projectFinance(inputs({ launches: [launch({ trades: legacy, ledgerTrades: [] })], operations: [op], terminalChain: { complete: true, readAt: NOW, credits: new Map([["sig-1", []]]), balances: [] } }));
  const referral = model.lines.earned.parts.find((part) => part.id === "referral");
  /* sig-1's 0.1 referral and 0.3 own fee are left out together: no referral is known — and the 0.3 is the terminal's alone. */
  assert.equal(referral.usd, null);
  assert.equal(model.lines.earned.parts.find((part) => part.id === "terminal").usd, 0.3);
  assert.ok(model.lines.earned.usd <= 2.4 + 1e-9, "never above the partner's part and the terminal's fee");
  assert.equal(model.lines.earned.check, "UNREAD");
});

test("Ryntra's own fee in a launch trade that is no terminal operation stays the launch's", () => {
  const trades = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: String(BigInt(trade.ryntraRaw) + 300_000n), ownRaw: "300000" } : trade));
  const model = projectFinance(inputs({ launches: [launch({ trades, ledgerTrades: [] })] }));
  assert.equal(model.lines.earned.parts.find((part) => part.id === "referral").usd, 0.4);
});

test("the creators' side without every event is a ceiling (≤)", () => {
  const model = projectFinance(inputs({ launches: [launch({ trades: curveTrades().slice(1), tradesComplete: false, counters: counters({ total: "3500000", unclaimed: "400000" }) })] }));
  assert.equal(model.lines.creators.atMost, true);
  assert.equal(model.launches[0].creators.atMost, true);
});

test("an operation the terminal does not count (no fee collected) leaves the trade's own fee with the launch — counted once", () => {
  const trades = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: String(BigInt(trade.ryntraRaw) + 300_000n), ownRaw: "300000" } : trade));
  const op = { id: "s", signature: "sig-1", product: "SPOT", status: "CONFIRMED", internal: false, at: NOW, feeCollected: false, ryntraUsd: null, feeAsset: null, feeGrossRaw: null, verification: "NOT_ATTRIBUTABLE" };
  const model = projectFinance(inputs({ launches: [launch({ trades, ledgerTrades: [] })], operations: [op] }));
  assert.equal(model.lines.earned.parts.find((part) => part.id === "referral").usd, 0.4);
  assert.equal(model.lines.earned.parts.find((part) => part.id === "terminal").usd, 0);
});

test("SOL-L1d: the vault's revenue journal against its claims on chain — a claim outside the journal and a journal run the chain does not show are differences; the amount is the chain's", () => {
  const claims = [{ signature: "claim-1", at: NOW, source: "curve", pairRaw: "1000000", tokenRaw: "0" }];
  /* The journal names the claim's transaction, not its amount: matched by its signature, the chain's event says what it took. */
  const matched = projectFinance(inputs({ launches: [launch({ claims, ledgerClaims: [{ signature: "claim-1", source: "curve", pairRaw: null }] })] }));
  assert.deepEqual(matched.differences, []);
  assert.equal(matched.lines.claimed.ledgerUsd, 1, "Ryntra's record comes to what the chain shows");
  /* A claim the chain shows that no proposal of Ryntra's ran — made in Squads' own app, say — and a run that never landed. */
  const apart = projectFinance(inputs({ launches: [launch({ claims, ledgerClaims: [{ signature: "claim-7", source: "lp", pairRaw: null }] })] }));
  assert.deepEqual(apart.differences.map((entry) => entry.kind).sort(), ["CHAIN_CLAIM_NOT_IN_LEDGER", "LEDGER_CLAIM_NOT_ON_CHAIN"]);
  assert.equal(apart.differences.find((entry) => entry.kind === "LEDGER_CLAIM_NOT_ON_CHAIN").ledgerUsd, null, "no amount was ever written for it");
});

test("SOL-L1d: the creators' side counts the creator's surplus the curve's flag says was withdrawn", () => {
  const surplus = { full: true, reserveRaw: USDC(15_600), thresholdRaw: USDC(15_000), creatorPct: 40, withdrawn: true };
  const withSurplus = { ...counters({ total: "3500000", unclaimed: "400000" }), surplus };
  const model = projectFinance(inputs({ launches: [launch({ counters: withSurplus, creatorReceipts: [{ signature: "c-1", receivedRaw: String(500_000 + 192_000_000) }] })] }));
  /* 1 USDC from the curve and 600 × 0,8 × 0,4 = 192 USDC of surplus: the receipts up to that are no difference. */
  assert.equal(model.lines.creators.usd, 193);
  assert.ok(!model.differences.some((entry) => entry.kind === "CREATOR_RECEIPTS_ABOVE_CHAIN"));
});
