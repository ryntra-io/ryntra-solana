import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { recordRewards } from "../rewards/ledger.ts";
import { actionFeeFromServiceFee, recordSolanaAction, SolanaWalletActionSchema } from "../solana/action-ledger.ts";
import { serviceFeeNotApplied, serviceFeeQuoted, serviceFeeUnconfigured, settleServiceFee } from "../swap/service-fee.ts";
import { readBusinessModel } from "./business.server.ts";
import { addInternalWallet } from "./internal-wallets.ts";
import { recordWalletSeen, recordWalletVerified } from "./wallet-presence.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const OWNER = "7BxQeV1WQx5Kf9L7jAGZLZmN2nRy3P6d8Qx4RhT9y1Pk";
const ALICE = "G6vA2mF8kQ1sLZ9pVbT4wJ7rN3xC5yH8dE2uK6nM3PcD";
const BOB = "8PkW3nQ7rT2yL5vB9zC4xF6hJ1mK8sD5gA2eR7tY42Wq";
const SIG_A = "4".repeat(88);
const SIG_B = "3".repeat(88);
const SIG_OWNER = "2".repeat(88);
const NOW = "2026-09-11T12:00:00.000Z";
const ENV = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };

function settledJupiterFee(operationRef, userPaidRaw) {
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 25, asset: USDC, symbol: "USDC", decimals: 6, providerRetainedPercent: 20 });
  const provider = (BigInt(userPaidRaw) * 20n) / 100n;
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: userPaidRaw,
    settlement: {
      userPaidRaw,
      providerRaw: provider.toString(),
      ryntraRaw: (BigInt(userPaidRaw) - provider).toString(),
      asset: USDC,
      symbol: "USDC",
      decimals: 6,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
      operationRef,
    },
  });
}

test("a settled service fee becomes the row's fee with its split, and an unreported one leaves the row alone", () => {
  const settled = settledJupiterFee(SIG_A, "250000");
  assert.deepEqual(actionFeeFromServiceFee(settled), {
    collected: true,
    basisPoints: 25,
    amountRaw: "250000",
    decimals: 6,
    symbol: "USDC",
    usd: null,
    asset: USDC,
    providerRaw: "50000",
    ryntraRaw: "200000",
    state: "COLLECTED",
    note: null,
  });
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 25, asset: USDC });
  assert.equal(actionFeeFromServiceFee(quoted), undefined, "a quote is not a fee record");
  assert.equal(actionFeeFromServiceFee(null), undefined);
  const notTaken = settleServiceFee(quoted, { collected: false });
  assert.equal(actionFeeFromServiceFee(notTaken)?.collected, false, "a confirmed non-collection is written as such");
  assert.equal(actionFeeFromServiceFee(notTaken)?.state, "NOT_COLLECTED");
  /* A fee the provider never carried is written down with its reason, so a
     row without an on-chain marker names its cause instead of saying nothing. */
  const notApplied = actionFeeFromServiceFee(serviceFeeNotApplied("JUPITER_REFERRAL", "Jupiter did not apply the referral account on this order."));
  assert.deepEqual([notApplied?.collected, notApplied?.state, notApplied?.basisPoints, notApplied?.amountRaw], [false, "NOT_APPLIED", null, null]);
  assert.match(notApplied?.note ?? "", /did not apply the referral account/);
  const unconfigured = actionFeeFromServiceFee(serviceFeeUnconfigured("JUPITER_REFERRAL", "No Jupiter referral account is configured."));
  assert.equal(unconfigured?.state, "UNCONFIGURED");
});

test("a row written before the split existed still parses, with the new fields null", () => {
  const legacy = {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: ALICE,
    actionId: SIG_A,
    lane: "CROSS_SWAP",
    outcome: "DONE",
    out: { mint: null, amountRaw: "5020909", decimals: 6, symbol: "USDC" },
    in: null,
    destination: "SOLANA",
    signature: null,
    receiptHash: null,
    fee: { collected: true, basisPoints: 25, amountRaw: "12552", decimals: 6, symbol: "USDC", usd: 0.01255 },
    startedAt: NOW,
    updatedAt: NOW,
  };
  const parsed = SolanaWalletActionSchema.parse(legacy);
  assert.equal(parsed.fee.asset, null);
  assert.equal(parsed.fee.providerRaw, null);
  assert.equal(parsed.fee.ryntraRaw, null);
  assert.equal(parsed.sourceTx, null);
});

test("the model reads every ledger through the store and leaves the owner out by default", async () => {
  const store = createMemoryGuardStore();
  const write = async (wallet, actionId, at, fee) => {
    const result = await recordSolanaAction(store, {
      network: "mainnet",
      wallet,
      actionId,
      lane: "SWAP",
      outcome: "DONE",
      out: { mint: USDC, amountRaw: "100000000", decimals: null, symbol: null },
      in: { mint: SOL, amountRaw: "500000000", decimals: null, symbol: null },
      signature: actionId,
      ...(fee ? { fee } : {}),
      now: at,
    });
    assert.equal(result.ok, true);
  };
  await write(ALICE, SIG_A, "2026-09-11T10:00:00.000Z", actionFeeFromServiceFee(settledJupiterFee(SIG_A, "250000")));
  await write(BOB, SIG_B, "2026-09-11T11:00:00.000Z", actionFeeFromServiceFee(settledJupiterFee(SIG_B, "250000")));
  await write(OWNER, SIG_OWNER, "2026-09-11T11:30:00.000Z", actionFeeFromServiceFee(settledJupiterFee(SIG_OWNER, "250000")));
  await recordRewards(
    store,
    [
      {
        type: "CASHBACK",
        recipient: ALICE,
        rateBps: 5000,
        shareRaw: "125000",
        usdMicros: "125000",
        valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: NOW },
        source: { mechanism: "JUPITER_REFERRAL", operationRef: SIG_A, trader: ALICE, grossRaw: "250000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: "2026-09-11T10:00:00.000Z" },
        createdAt: "2026-09-11T10:00:01.000Z",
        claimId: null,
        signature: null,
      },
      {
        type: "REFERRAL_L1",
        recipient: BOB,
        rateBps: 1000,
        shareRaw: "25000",
        usdMicros: "25000",
        valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: USDC, observedAt: NOW },
        source: { mechanism: "JUPITER_REFERRAL", operationRef: SIG_A, trader: ALICE, grossRaw: "250000", asset: USDC, symbol: "USDC", decimals: 6, settledAt: "2026-09-11T10:00:00.000Z" },
        createdAt: "2026-09-11T10:00:01.000Z",
        claimId: null,
        signature: null,
      },
    ],
    `JUPITER_REFERRAL:${SIG_A}`,
  );
  await store.collection("rewardReferralEdges").set(`${BOB}:L1:${ALICE}`, { referrer: BOB, wallet: ALICE, level: 1, at: "2026-09-11T09:00:00.000Z" });
  await store.collection("solanaCrossSwapOrders").set("0x" + "ab".repeat(32), { intentDigest: "0x" + "ab".repeat(32), provider: "RELAY", state: "COMPLETED" });
  await recordWalletSeen(store, { wallet: ALICE, now: "2026-09-11T09:50:00.000Z" });
  await recordWalletVerified(store, { wallet: ALICE, now: "2026-09-11T09:51:00.000Z" });
  await recordWalletSeen(store, { wallet: OWNER, now: "2026-09-11T11:20:00.000Z" });
  await addInternalWallet(store, { wallet: OWNER, label: "founder", now: NOW });

  const external = await readBusinessModel(store, { now: NOW, range: "24h", scope: "external", env: ENV });
  assert.deepEqual(external.sources, { actions: "measured", rewards: "measured", presence: "measured" });
  assert.equal(external.coverage.rewardsSince, "2026-09-10T15:25:00.000Z");
  assert.equal(external.coverage.actionsSince, "2026-09-11T10:00:00.000Z");
  assert.equal(external.internalWallets, 1);
  assert.equal(external.trading.trades.value, 2);
  assert.equal(external.trading.traders.value, 2);
  assert.equal(external.trading.volumeUsd.value, 200);
  assert.equal(external.revenue.grossUsd.value, 0.5);
  assert.equal(external.revenue.providerUsd.value, 0.1);
  assert.equal(external.revenue.netBeforeRewardsUsd.value, 0.4);
  assert.equal(external.revenue.cashbackUsd.value, 0.125);
  assert.equal(external.revenue.referralL1Usd.value, 0.025);
  assert.equal(external.revenue.retainedUsd.value, 0.25);
  assert.equal(external.rewards.accruedUsd.value, 0.15);
  assert.equal(external.referrals.level1.value, 1);
  assert.equal(external.audience.connected.value, 1);
  assert.equal(external.audience.verified.value, 1);
  assert.equal(external.lastSeen.trade.wallet, "8PkW…42Wq");
  assert.ok(external.recent.every((item) => item.walletFull !== OWNER));

  const all = await readBusinessModel(store, { now: NOW, range: "24h", scope: "all", env: ENV });
  assert.equal(all.trading.trades.value, 3);
  assert.equal(all.audience.connected.value, 2);
  assert.equal(all.lastSeen.trade.wallet, "7BxQ…y1Pk");
  assert.equal(all.lastSeen.trade.internal, true);
  assert.equal(all.recent.filter((item) => item.internal).length, 1, "the owner's swap is in the feed and marked; a cabinet visit is not an event");
});

test("a store that cannot be read yields unavailable figures rather than zeros", async () => {
  const broken = {
    ...createMemoryGuardStore(),
    collection() {
      return { valuesWithPrefix: async () => { throw new Error("down"); } };
    },
  };
  const model = await readBusinessModel(broken, { now: NOW, range: "7d", scope: "external", env: ENV });
  assert.deepEqual(model.sources, { actions: "unavailable", rewards: "unavailable", presence: "unavailable" });
  assert.equal(model.trading.trades.status, "unavailable");
  assert.equal(model.revenue.grossUsd.status, "unavailable");
  assert.equal(model.audience.connected.status, "unavailable");
});
