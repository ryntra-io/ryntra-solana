import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_RANGES,
  feeValuation,
  ledgerGrossUsdMicros,
  maskWallet,
  movementUsdMicros,
  parUsdMicros,
  projectBusiness,
  rangeStart,
  tradeUsdMicros,
} from "./business.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const OWNER = "7BxQeV1WQx5Kf9L7jAGZLZmN2nRy3P6d8Qx4RhT9y1Pk";
const ALICE = "G6vA2mF8kQ1sLZ9pVbT4wJ7rN3xC5yH8dE2uK6nM3PcD";
const BOB = "8PkW3nQ7rT2yL5vB9zC4xF6hJ1mK8sD5gA2eR7tY42Wq";
const CAROL = "4NcT9xL2mK7pQ5vR8bW3zY6hJ1dF4sA9gE2uH7rM5Lq";
const SIG = "5".repeat(88);
const NOW = "2026-09-11T12:00:00.000Z";

function action(overrides) {
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: ALICE,
    actionId: SIG,
    lane: "SWAP",
    outcome: "DONE",
    out: { mint: USDC, amountRaw: "100000000", decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "500000000", decimals: null, symbol: null },
    destination: null,
    signature: SIG,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    startedAt: "2026-09-11T10:00:00.000Z",
    updatedAt: "2026-09-11T10:00:05.000Z",
    ...overrides,
  };
}

function inputs(overrides) {
  return {
    now: NOW,
    range: "24h",
    scope: "external",
    actions: [],
    orders: [],
    rewards: [],
    edges: [],
    presence: [],
    internalWallets: new Set(),
    sources: { actions: "measured", rewards: "measured", presence: "measured" },
    rewardsSince: "2026-09-10T15:25:00.000Z",
    ...overrides,
  };
}

test("ranges start where they say and 'all' has no start", () => {
  assert.deepEqual(BUSINESS_RANGES, ["24h", "7d", "30d", "all"]);
  assert.equal(rangeStart("24h", NOW), "2026-09-10T12:00:00.000Z");
  assert.equal(rangeStart("7d", NOW), "2026-09-04T12:00:00.000Z");
  assert.equal(rangeStart("30d", NOW), "2026-08-12T12:00:00.000Z");
  assert.equal(rangeStart("all", NOW), null);
});

test("par valuation rescales by decimals and refuses anything that is not a stablecoin", () => {
  assert.equal(parUsdMicros("1000000", 6), 1_000_000n);
  assert.equal(parUsdMicros("1000000000000000000", 18), 1_000_000n, "BNB USDC carries eighteen decimals");
  assert.equal(parUsdMicros("100", 2), 1_000_000n);
  assert.equal(movementUsdMicros({ mint: USDC, amountRaw: "2500000", decimals: null, symbol: null }), 2_500_000n);
  assert.equal(movementUsdMicros({ mint: SOL, amountRaw: "2500000", decimals: 9, symbol: "SOL" }), null);
  assert.equal(movementUsdMicros({ mint: null, amountRaw: "2537760", decimals: 6, symbol: "USDG" }), 2_537_760n);
  assert.equal(movementUsdMicros({ mint: null, amountRaw: "2537760", decimals: null, symbol: "USDG" }), null, "no decimals, no scale, no figure");
  assert.equal(movementUsdMicros(null), null);
  const usdcOut = action();
  assert.equal(tradeUsdMicros(usdcOut), 100_000_000n, "the leg that left is valued first");
  const solOut = action({ out: { mint: SOL, amountRaw: "68266385", decimals: null, symbol: null }, in: { mint: USDC, amountRaw: "6781742", decimals: null, symbol: null } });
  assert.equal(tradeUsdMicros(solOut), 6_781_742n, "else the leg that arrived");
  const noStable = action({ in: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amountRaw: "1", decimals: 5, symbol: "BONK" }, out: { mint: SOL, amountRaw: "1", decimals: 9, symbol: "SOL" } });
  assert.equal(tradeUsdMicros(noStable), null, "a pair with no stablecoin leg is unvalued, not priced");
});

test("a quote is not a trade, a failure is not volume, and a reload counts once", () => {
  const model = projectBusiness(
    inputs({
      actions: [
        action(),
        action({ actionId: "6".repeat(88), signature: "6".repeat(88), outcome: "FAILED" }),
        action({ actionId: "7".repeat(88), signature: "7".repeat(88), outcome: "IN_FLIGHT" }),
        action({ version: 2, updatedAt: "2026-09-11T11:00:00.000Z" }),
        action({ actionId: "8".repeat(88), signature: "8".repeat(88), lane: "SEND", in: null }),
        action({ actionId: "9".repeat(88), signature: "9".repeat(88), lane: "RECEIVE", out: null }),
      ],
    }),
  );
  assert.equal(model.trading.trades.value, 1, "one finished swap; the duplicate row, the failure and the in-flight one do not count");
  assert.equal(model.trading.failed.value, 1);
  assert.equal(model.trading.volumeUsd.value, 100);
  assert.equal(model.trading.traders.value, 1);
  assert.equal(model.audience.active.value, 1, "send and receive make a wallet active");
  assert.equal(model.providers.find((row) => row.id === "JUPITER").operations, 1);
});

test("a Spot trade is the same row counted once, and its share is reported beside the whole", () => {
  const model = projectBusiness(
    inputs({
      actions: [
        action(),
        action({ actionId: "6".repeat(88), signature: "6".repeat(88), origin: { surface: "SPOT", side: "BUY" } }),
        action({ actionId: "7".repeat(88), signature: "7".repeat(88), origin: { surface: "SPOT", side: "SELL" }, out: { mint: SOL, amountRaw: "500000000", decimals: null, symbol: null }, in: { mint: USDC, amountRaw: "50000000", decimals: null, symbol: null } }),
      ],
    }),
  );
  assert.equal(model.trading.trades.value, 3, "Spot trades are trades");
  assert.equal(model.trading.volumeUsd.value, 250, "and their volume is volume");
  assert.equal(model.trading.spotTrades.value, 2);
  assert.equal(model.trading.spotVolumeUsd.value, 150, "the Spot share is part of the whole, not added to it");
  assert.deepEqual(
    model.recent.filter((item) => item.kind.startsWith("SPOT")).map((item) => item.kind).sort(),
    ["SPOT_BUY", "SPOT_SELL"],
    "the feed says what the person did",
  );
  assert.equal(model.recent.filter((item) => item.kind === "SWAP").length, 1);
});

test("the owner's wallets are out of the external figures and back in the all-activity scope", () => {
  const rows = [
    action({ wallet: OWNER, actionId: "a".repeat(88), signature: "a".repeat(88) }),
    action({ wallet: OWNER, actionId: "b".repeat(88), signature: "b".repeat(88) }),
    action({ wallet: ALICE }),
  ];
  const external = projectBusiness(inputs({ actions: rows, internalWallets: new Set([OWNER]) }));
  assert.equal(external.trading.trades.value, 1);
  assert.equal(external.trading.traders.value, 1);
  assert.equal(external.internalWallets, 1);
  assert.ok(external.recent.every((item) => !item.internal), "the external feed carries no internal row");
  const all = projectBusiness(inputs({ actions: rows, internalWallets: new Set([OWNER]), scope: "all" }));
  assert.equal(all.trading.trades.value, 3);
  assert.equal(all.trading.traders.value, 2);
  assert.equal(all.recent.filter((item) => item.internal).length, 2, "and the all-activity feed marks them");
  assert.equal(all.recent[0].wallet, "7BxQ…y1Pk");
  assert.equal(all.recent[0].walletFull, OWNER);
});

test("new, returning and repeat rate are about people, in the window asked for", () => {
  const rows = [
    action({ wallet: ALICE, actionId: "a".repeat(88), signature: "a".repeat(88), startedAt: "2026-09-01T10:00:00.000Z" }),
    action({ wallet: ALICE, actionId: "b".repeat(88), signature: "b".repeat(88), startedAt: "2026-09-11T10:00:00.000Z" }),
    action({ wallet: BOB, actionId: "c".repeat(88), signature: "c".repeat(88), startedAt: "2026-09-11T09:00:00.000Z" }),
    action({ wallet: CAROL, actionId: "d".repeat(88), signature: "d".repeat(88), startedAt: "2026-09-11T08:00:00.000Z" }),
    action({ wallet: CAROL, actionId: "e".repeat(88), signature: "e".repeat(88), startedAt: "2026-09-11T08:30:00.000Z" }),
  ];
  const day = projectBusiness(inputs({ actions: rows }));
  assert.equal(day.trading.traders.value, 3);
  assert.equal(day.trading.newTraders.value, 2, "Bob and Carol traded for the first time today; Alice did not");
  assert.equal(day.trading.returningTraders.value, 2, "Alice came back and Carol traded twice");
  assert.equal(day.trading.repeatRate.value, 2 / 3);
  assert.equal(day.trading.repeatRate.n, 3);
  const all = projectBusiness(inputs({ actions: rows, range: "all" }));
  assert.equal(all.trading.traders.value, 3);
  assert.equal(all.trading.newTraders.value, 3);
  assert.equal(all.trading.returningTraders.value, 2);
  assert.equal(all.funnel.find((step) => step.id === "first_trade").wallets.value, 3);
  assert.equal(all.funnel.find((step) => step.id === "repeat_trade").wallets.value, 2);
  const empty = projectBusiness(inputs());
  assert.equal(empty.trading.repeatRate.status, "insufficient", "no traders, no rate");
});

test("revenue is only a fee a provider confirmed, split as the settlement recorded it", () => {
  const jupiter = action({
    fee: { collected: true, basisPoints: 25, amountRaw: "250000", decimals: 6, symbol: "USDC", usd: null, asset: USDC, providerRaw: "50000", ryntraRaw: "200000" },
  });
  const relay = action({
    wallet: BOB,
    lane: "CROSS_SWAP",
    actionId: "0x" + "ab".repeat(32),
    signature: null,
    sourceTx: "0x" + "cd".repeat(32),
    destination: "SOLANA",
    out: { mint: null, amountRaw: "5020909", decimals: 6, symbol: "USDC" },
    in: { mint: null, amountRaw: "49962401", decimals: 9, symbol: "SOL" },
    fee: { collected: true, basisPoints: 25, amountRaw: "12552", decimals: 6, symbol: "USDC", usd: 0.01255, asset: null, providerRaw: "0", ryntraRaw: "12552" },
  });
  const notCollected = action({
    wallet: CAROL,
    actionId: "f".repeat(88),
    signature: "f".repeat(88),
    fee: { collected: false, basisPoints: 25, amountRaw: null, decimals: null, symbol: null, usd: null, asset: null, providerRaw: null, ryntraRaw: null },
  });
  const noFee = action({ wallet: CAROL, actionId: "g".repeat(88), signature: "g".repeat(88) });
  const model = projectBusiness(inputs({ actions: [jupiter, relay, notCollected, noFee], orders: [{ intentDigest: relay.actionId, provider: "RELAY" }] }));
  assert.equal(model.revenue.grossUsd.value, 0.26255);
  assert.equal(model.revenue.providerUsd.value, 0.05, "Jupiter's fifth, read from the row, and none of Relay's");
  assert.equal(model.revenue.netBeforeRewardsUsd.value, 0.21255);
  assert.equal(model.revenue.feesNotRecorded, 1, "a finished trade with no fee record is counted, not zeroed");
  assert.equal(model.revenue.unvaluedFees, 0);
  const jup = model.providers.find((row) => row.id === "JUPITER");
  const rel = model.providers.find((row) => row.id === "RELAY");
  assert.equal(jup.grossUsd, 0.25);
  assert.equal(jup.ryntraNetUsd, 0.2);
  assert.equal(rel.grossUsd, 0.01255);
  assert.equal(rel.ryntraNetUsd, 0.01255);
  assert.equal(rel.operations, 1);
  assert.equal(rel.volumeUsd, 5.020909);
  assert.equal(model.providers.find((row) => row.id === "MAYAN").feeNote?.startsWith("fee 0"), true);
  assert.equal(model.providers.find((row) => row.id === "CCTP").feeNote?.startsWith("fee 0"), true);
});

test("a fee in a non-stable asset is valued through the rewards ledger or reported unvalued", () => {
  const solFee = action({
    fee: { collected: true, basisPoints: 25, amountRaw: "170665", decimals: 9, symbol: "SOL", usd: null, asset: SOL, providerRaw: null, ryntraRaw: null },
  });
  const ledger = [
    {
      type: "CASHBACK",
      recipient: ALICE,
      rateBps: 5000,
      shareRaw: "85332",
      usdMicros: "8533",
      valuation: { basis: "PRICED_AT_SETTLEMENT", price: "100.00", sourceRef: "catalog", observedAt: NOW },
      source: { mechanism: "JUPITER_REFERRAL", operationRef: SIG, trader: ALICE, grossRaw: "170665", asset: SOL, symbol: "SOL", decimals: 9, settledAt: "2026-09-11T10:00:05.000Z" },
      createdAt: "2026-09-11T10:00:06.000Z",
      claimId: null,
      signature: null,
    },
  ];
  assert.equal(ledgerGrossUsdMicros(ledger), 17_066n, "170665 lamports at $100 is $0.017066");
  const valued = feeValuation(solFee, "JUPITER", ledger);
  assert.equal(valued.basis, "LEDGER");
  assert.equal(valued.grossUsdMicros, 17_066n);
  assert.equal(valued.providerUsdMicros, 3_413n, "no split on the row, so Jupiter's documented 20%");
  const unvalued = feeValuation(solFee, "JUPITER", []);
  assert.equal(unvalued.basis, "UNVALUED");
  assert.equal(unvalued.grossUsdMicros, null);
  const model = projectBusiness(inputs({ actions: [solFee], rewards: ledger }));
  assert.equal(model.revenue.grossUsd.value, 0.017066);
  assert.equal(model.revenue.cashbackUsd.value, 0.008533);
  assert.equal(model.revenue.retainedUsd.value, 0.00512);
  const bare = projectBusiness(inputs({ actions: [solFee] }));
  assert.equal(bare.revenue.unvaluedFees, 1);
  assert.equal(bare.revenue.grossUsd.value, 0);
});

test("rewards, referrals and presence answer in the window, the balance owed does not", () => {
  const rewards = [
    { type: "CASHBACK", recipient: ALICE, rateBps: 5000, shareRaw: "125000", usdMicros: "125000", valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: NOW }, source: { mechanism: "JUPITER_REFERRAL", operationRef: SIG, trader: ALICE, grossRaw: "250000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: NOW }, createdAt: "2026-09-11T10:00:06.000Z", claimId: null, signature: null },
    { type: "REFERRAL_L1", recipient: BOB, rateBps: 1000, shareRaw: "25000", usdMicros: "25000", valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: NOW }, source: { mechanism: "JUPITER_REFERRAL", operationRef: SIG, trader: ALICE, grossRaw: "250000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: NOW }, createdAt: "2026-09-11T10:00:06.000Z", claimId: null, signature: null },
    { type: "CASHBACK", recipient: ALICE, rateBps: 5000, shareRaw: "3000000", usdMicros: "3000000", valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: NOW }, source: { mechanism: "JUPITER_REFERRAL", operationRef: "old", trader: ALICE, grossRaw: "6000000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: "2026-09-01T00:00:00.000Z" }, createdAt: "2026-09-01T00:00:00.000Z", claimId: null, signature: null },
    { type: "CLAIM", recipient: ALICE, rateBps: 0, shareRaw: null, usdMicros: "-2000000", valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "USDC", observedAt: NOW }, source: null, createdAt: "2026-09-05T00:00:00.000Z", claimId: "claim_1", signature: null },
  ];
  const edges = [
    { referrer: BOB, wallet: ALICE, level: 1, at: "2026-09-11T09:00:00.000Z" },
    { referrer: CAROL, wallet: ALICE, level: 2, at: "2026-09-11T09:00:00.000Z" },
    { referrer: BOB, wallet: CAROL, level: 1, at: "2026-09-02T09:00:00.000Z" },
  ];
  const presence = [
    { wallet: ALICE, firstSeenAt: "2026-09-01T00:00:00.000Z", lastSeenAt: "2026-09-11T09:30:00.000Z", sessions: 4, firstVerifiedAt: "2026-09-01T00:01:00.000Z", lastVerifiedAt: "2026-09-11T09:31:00.000Z", verifications: 2 },
    { wallet: BOB, firstSeenAt: "2026-09-11T11:00:00.000Z", lastSeenAt: "2026-09-11T11:00:00.000Z", sessions: 1, firstVerifiedAt: null, lastVerifiedAt: null, verifications: 0 },
    { wallet: CAROL, firstSeenAt: "2026-09-02T00:00:00.000Z", lastSeenAt: "2026-09-02T00:00:00.000Z", sessions: 1, firstVerifiedAt: "2026-09-02T00:00:00.000Z", lastVerifiedAt: "2026-09-02T00:00:00.000Z", verifications: 1 },
  ];
  const day = projectBusiness(inputs({ rewards, edges, presence }));
  assert.equal(day.rewards.accruedUsd.value, 0.15);
  assert.equal(day.rewards.entries, 2);
  assert.equal(day.rewards.claimedUsd.value, 0);
  assert.equal(day.rewards.outstandingUsd.value, 1.15, "accrued 3.15 all time, 2.00 paid");
  assert.equal(day.referrals.level1.value, 1);
  assert.equal(day.referrals.level2.value, 1);
  assert.equal(day.audience.connected.value, 2, "Alice and Bob were in the cabinet today");
  assert.equal(day.audience.verified.value, 1, "only Alice proved today");
  assert.equal(day.audience.newWallets.value, 1, "Bob is new");
  assert.equal(day.funnel.find((step) => step.id === "visited").wallets.status, "not_collected");
  assert.equal(day.funnel.find((step) => step.id === "connected").wallets.value, 2);
  assert.equal(day.lastSeen.connected.wallet, "8PkW…42Wq");
  assert.equal(day.lastSeen.verified.at, "2026-09-11T09:31:00.000Z");
  assert.equal(day.lastSeen.referral.at, "2026-09-11T09:00:00.000Z");
  assert.equal(day.lastSeen.visitor.status, "not_collected");
  assert.equal(day.coverage.presenceSince, "2026-09-01T00:00:00.000Z");
  const all = projectBusiness(inputs({ rewards, edges, presence, range: "all" }));
  assert.equal(all.rewards.accruedUsd.value, 3.15);
  assert.equal(all.rewards.claimedUsd.value, 2);
  assert.equal(all.rewards.claims, 1);
  assert.equal(all.referrals.level1.value, 2);
  assert.equal(all.audience.connected.value, 3);
});

test("a source that is missing or failing is never drawn as a zero", () => {
  const model = projectBusiness(inputs({ sources: { actions: "unavailable", rewards: "unavailable", presence: "unavailable" } }));
  assert.equal(model.trading.trades.status, "unavailable");
  assert.equal(model.trading.trades.value, undefined);
  assert.equal(model.revenue.retainedUsd.status, "unavailable");
  assert.equal(model.rewards.accruedUsd.status, "unavailable");
  assert.equal(model.audience.connected.status, "unavailable");
  assert.equal(model.audience.visitors.status, "not_collected");
  const half = projectBusiness(inputs({ sources: { actions: "measured", rewards: "unavailable", presence: "measured" } }));
  assert.equal(half.trading.trades.value, 0, "a measured zero is a zero");
  assert.equal(half.revenue.grossUsd.value, 0);
  assert.equal(half.revenue.cashbackUsd.status, "unavailable");
  assert.equal(half.revenue.retainedUsd.status, "unavailable", "retained needs both ledgers");
});

test("charts bucket by hour for a day and by day otherwise, the feed is newest first and masked", () => {
  const rows = [
    action({ startedAt: "2026-09-11T10:15:00.000Z" }),
    action({ actionId: "b".repeat(88), signature: "b".repeat(88), wallet: BOB, startedAt: "2026-09-11T10:45:00.000Z" }),
    action({ actionId: "c".repeat(88), signature: "c".repeat(88), wallet: BOB, startedAt: "2026-09-09T10:45:00.000Z" }),
  ];
  const day = projectBusiness(inputs({ actions: rows }));
  assert.equal(day.buckets.length, 24);
  assert.equal(day.buckets[day.buckets.length - 1].key, "2026-09-11T12");
  const ten = day.buckets.find((bucket) => bucket.key === "2026-09-11T10");
  assert.equal(ten.trades, 2);
  assert.equal(ten.traders, 2);
  assert.equal(ten.volumeUsd, 200);
  assert.equal(ten.label, "10:00");
  const week = projectBusiness(inputs({ actions: rows, range: "7d" }));
  assert.equal(week.buckets.length, 7);
  assert.equal(week.buckets.find((bucket) => bucket.key === "2026-09-09").trades, 1);
  assert.equal(week.buckets[0].label, "09.05");
  const all = projectBusiness(inputs({ actions: rows, range: "all" }));
  assert.equal(all.buckets.length, 30, "all time draws the last thirty days");
  assert.equal(all.recent.length, 3);
  assert.equal(all.recent[0].at, "2026-09-11T10:45:00.000Z");
  assert.equal(all.recent[0].kind, "SWAP");
  assert.equal(all.recent[0].route, "USDC → SOL");
  assert.equal(all.recent[0].valueUsd, 100);
  assert.equal(all.recent[0].provider, "JUPITER");
  assert.equal(all.recent[0].status, "DONE");
  assert.equal(all.recent[0].wallet, maskWallet(BOB));
  assert.match(all.recent[0].wallet, /^.{4}….{4}$/);
  assert.equal(all.recent[0].reference, "b".repeat(88));
});

test("a cross-chain row names both chains and its provider from the order book", () => {
  const relay = action({
    wallet: BOB,
    lane: "CROSS_SWAP",
    actionId: "0x" + "ab".repeat(32),
    signature: null,
    sourceTx: "0x" + "cd".repeat(32),
    destination: "SOLANA",
    out: { mint: null, amountRaw: "2537760", decimals: 6, symbol: "USDG" },
    in: { mint: null, amountRaw: "24741584", decimals: 9, symbol: "SOL" },
  });
  const mayan = action({
    wallet: CAROL,
    lane: "CROSS_SWAP",
    actionId: "0x" + "ef".repeat(32),
    signature: SIG,
    destination: "BASE",
    out: { mint: USDC, amountRaw: "1000000", decimals: 6, symbol: "USDC" },
    in: { mint: null, amountRaw: "1", decimals: 18, symbol: "ETH" },
  });
  const model = projectBusiness(
    inputs({ actions: [relay, mayan], orders: [{ intentDigest: relay.actionId, provider: "RELAY" }, { intentDigest: mayan.actionId, provider: "MAYAN" }], range: "all" }),
  );
  const feed = model.recent;
  assert.equal(feed.find((item) => item.walletFull === BOB).route, "USDG → SOL · → Solana");
  assert.equal(feed.find((item) => item.walletFull === BOB).provider, "RELAY");
  assert.equal(feed.find((item) => item.walletFull === CAROL).route, "USDC → ETH · Solana → Base");
  assert.equal(feed.find((item) => item.walletFull === CAROL).provider, "MAYAN");
  assert.equal(model.providers.find((row) => row.id === "MAYAN").operations, 1);
  assert.equal(model.providers.find((row) => row.id === "RELAY").volumeUsd, 2.53776);
});
