import assert from "node:assert/strict";
import test from "node:test";

import { FEE_POLICY_V2, ORDER_REFERRAL_PROVIDER_PERCENT } from "../core/fee-policy.ts";
import {
  LAUNCH_PAYOUT_CEILING_BPS,
  LAUNCH_PAYOUT_RATES_BPS,
  ORBIT_BONUS_LIVE,
  orbitBonusCourse,
  orbitBonusEntitlementRaw,
  orbitBonusTranche,
  payoutRoomRaw,
} from "../core/launch/orbit-bonus.ts";
import { PEOPLE_PRESET_TERMS, poolClaimingSplit, presetTerms } from "../core/launch/preset-terms.ts";
import { computePoolLines } from "../growth/network.ts";
import { launchServiceFee } from "../launch/record.server.ts";
import { builderFeeUsd, feeSplitOf } from "../phoenix/orders-model.ts";
import { AGG_PLATFORM_SHARE_BIPS, buildTradeLine, ledgerTotals, REFERRAL_FEE_BIPS, RYNTRA_BUY_FEE_BIPS } from "../predictions/fee-ledger.ts";
import { accrueRewards } from "../rewards/accrue.ts";
import { isParMint, usdMicrosFromStated, usdMicrosOf } from "../rewards/model.ts";
import { NETWORK_RULES_HISTORY, NETWORK_TIERS } from "../rewards/network-rules.ts";
import { recordOperationRewards } from "../rewards/record.server.ts";
import {
  FIRST_TEN_CEILING_BPS,
  maxPayoutBps,
  payoutCeilingBps,
  RANK_THRESHOLDS,
  rankForPoints,
  REWARD_RANKS,
  REWARD_RULES_CURRENT,
  REWARD_RULES_V1,
  REWARD_RULES_V2,
  REWARD_RULES_V2_1,
} from "../rewards/rules.ts";
import { RYNTRA_SERVICE_FEE_POLICY, serviceFeeAbsent, serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";

/*
 * The ceilings of every money flow the city shows, held on the engine's own rules.
 *
 * The city adds no payout of its own: whatever a person gets back is what the engine pays. This file proves that no
 * combination of ranks, windows and levels pays out of one fee more than its ceiling — 85 % of what Ryntra received
 * on a swap, all of it only inside «First $10 back», 70 % on a launch — and that Phoenix, the pools and predictions
 * on paper pay nobody anything out of Ryntra's money.
 *
 * The rules are imported to be read and nothing else: the last test checks they are exactly as they were before the
 * first one. The worked examples are the ones in docs/city/ECONOMY.md; when the engine's rates change, they fail here
 * first, and the table has to change with them.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const WBTC = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
const TRADER = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const FRIEND = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const FRIENDS_FRIEND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const AT = "2026-10-20T12:00:00.000Z";
const REWARDS_OPEN = { RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-10T15:25:00Z" };
const BPS = 10_000n;
/** $1 000 in micro-dollars, the size of every worked example. */
const THOUSAND = 1_000_000_000n;

const total = (values) => values.reduce((sum, value) => sum + value, 0n);
const shareOf = (raw, bps) => (raw * BigInt(bps)) / BPS;

/* Everything the engine's rules hold, written out before the first test; the last test reads it again. */
const written = (value) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? `${item}n` : item));
const engineRules = () =>
  written({
    rewards: [REWARD_RULES_V1, REWARD_RULES_V2, REWARD_RULES_V2_1, REWARD_RULES_CURRENT, RANK_THRESHOLDS, REWARD_RANKS, FIRST_TEN_CEILING_BPS],
    network: NETWORK_RULES_HISTORY,
    launch: [LAUNCH_PAYOUT_RATES_BPS, LAUNCH_PAYOUT_CEILING_BPS, ORBIT_BONUS_LIVE, PEOPLE_PRESET_TERMS],
    swap: [FEE_POLICY_V2, RYNTRA_SERVICE_FEE_POLICY, ORDER_REFERRAL_PROVIDER_PERCENT],
    predictions: [RYNTRA_BUY_FEE_BIPS, AGG_PLATFORM_SHARE_BIPS, REFERRAL_FEE_BIPS],
  });
const BEFORE = engineRules();

/* ------------------------------------------------------------------------------------------------------- swaps */

/** A fee the provider says it took: `grossRaw` paid, `retainedPct` of it kept by the provider, the rest reached Ryntra. */
function collectedFee({ grossRaw, asset = USDC, decimals = 6, retainedPct = 0, mechanism = "JUPITER_PLATFORM_FEE" }) {
  const providerRaw = (grossRaw * BigInt(retainedPct) + 99n) / 100n;
  const quoted = serviceFeeQuoted(mechanism, { basisPoints: 100, asset, symbol: "TOKEN", decimals, amountRaw: String(grossRaw), providerRetainedPercent: retainedPct });
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: String(grossRaw),
    settlement: {
      userPaidRaw: String(grossRaw),
      providerRaw: String(providerRaw),
      ryntraRaw: String(grossRaw - providerRaw),
      asset,
      symbol: "TOKEN",
      decimals,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
      operationRef: "city-economy",
    },
  });
}

/**
 * One fee as the rules see it, with what any part of it is worth in micro-dollars — null when it has no dollar figure —
 * and what one raw unit of it is worth when the provider states its dollars, rounded up.
 */
function feeCase({ grossRaw, asset = USDC, decimals = 6, retainedPct = 0, mechanism, price = null, usd = null }) {
  const fee = collectedFee({ grossRaw, asset, decimals, retainedPct, mechanism });
  const stated = usd === null ? null : usdMicrosFromStated(usd);
  const byProvider = !isParMint(asset, decimals) && stated !== null && stated > 0n;
  /* The same order the rules value in: a dollar at par, the provider's own figure, a price, nothing. */
  const dollarsOf = isParMint(asset, decimals)
    ? (raw) => raw
    : byProvider
      ? (raw) => (stated * raw) / grossRaw
      : price
        ? (raw) => usdMicrosOf({ raw, decimals, price: price.price })
        : () => null;
  const unitDollars = byProvider ? (stated + grossRaw - 1n) / grossRaw : 0n;
  return { fee, price, usd, gross: grossRaw, received: BigInt(fee.settlement.ryntraRaw), dollarsOf, byProvider, unitDollars };
}

const SOL_PRICE = { price: "187.25", sourceRef: "city-economy:price", observedAt: AT };

/* Fees of every shape: dollars at par through `/build` and through `/order` (Jupiter keeps a fifth), a token with a
   price, a token without one, a provider's own dollar figure — and amounts that round badly on purpose. */
const FEES = [
  ...[1n, 2n, 3n, 7n, 99n, 101n, 9_999n, 10_001n, 1_000_000n, 4_000_001n, 9_999_999n, 10_000_000n, 10_000_001n, 123_456_789n].flatMap((grossRaw) => [
    feeCase({ grossRaw, mechanism: "JUPITER_PLATFORM_FEE" }),
    feeCase({ grossRaw, mechanism: "JUPITER_REFERRAL", retainedPct: ORDER_REFERRAL_PROVIDER_PERCENT }),
  ]),
  ...[1n, 999n, 5_000_000n, 123_456_789n].map((grossRaw) => feeCase({ grossRaw, asset: SOL, decimals: 9, mechanism: "JUPITER_PLATFORM_FEE", price: SOL_PRICE })),
  ...[1n, 5_000_000n].map((grossRaw) => feeCase({ grossRaw, asset: SOL, decimals: 9, mechanism: "JUPITER_PLATFORM_FEE" })),
  feeCase({ grossRaw: 2_500_000n, asset: SOL, decimals: 9, mechanism: "RELAY_APP_FEE", usd: 2.5 }),
  feeCase({ grossRaw: 7n, asset: SOL, decimals: 9, mechanism: "RELAY_APP_FEE", usd: 0.0123 }),
  /* A bridge fee paid in an eight-decimal bitcoin: one raw unit is worth $0.0006. */
  feeCase({ grossRaw: 4_167n, asset: WBTC, decimals: 8, mechanism: "RELAY_APP_FEE", usd: 2.5 }),
];

/* «First $10 back»: none, not yet read, written before a price, and every place the cap can fall. */
const FIRST_TEN_STATES = [undefined, null, "FROZEN", ...[0n, 1n, 1_234_567n, 4_000_000n, 10_000_000n, 10_000_000_000n].map((remainingUsdMicros) => ({ remainingUsdMicros }))];
/* Who invited whom: nobody, a friend, a friend and theirs, and the shapes a graph should never take but a caller might pass. */
const LEVELS = [
  [null, null],
  [FRIEND, null],
  [FRIEND, FRIENDS_FRIEND],
  [null, FRIENDS_FRIEND],
  [TRADER, FRIENDS_FRIEND],
  [FRIEND, TRADER],
  [FRIEND, FRIEND],
];
const RANKS = [...REWARD_RANKS, null];
const VERSIONS = [...new Set([REWARD_RULES_V1, REWARD_RULES_V2, REWARD_RULES_V2_1, REWARD_RULES_CURRENT])];
const WELCOME = new Set(["FIRST_TEN", "FIRST_TEN_REST"]);

test("no combination of rules, ranks, windows and levels pays out of one swap fee more than its ceiling", () => {
  let combinations = 0;
  for (const rules of VERSIONS) {
    const windowed = rules.version === "2.1.0";
    const ceiling = BigInt(payoutCeilingBps(rules));
    const friendMost = Math.max(...REWARD_RANKS.map((rank) => rules.referralL1BpsByRank[rank]), rules.inviterWindow?.bps ?? 0);
    for (const fee of FEES) {
      const base = rules.base === "RECEIVED" ? fee.received : fee.gross;
      for (const firstTen of windowed ? FIRST_TEN_STATES : [undefined]) {
        for (const inviter of windowed ? [false, true] : [false]) {
          for (const [referrerL1, referrerL2] of LEVELS) {
            for (const rank of RANKS) {
              combinations += 1;
              const what = `${rules.version} · fee ${fee.gross} (${fee.received} received) · first $10 ${firstTen?.remainingUsdMicros ?? firstTen} · 90 days ${inviter} · ${referrerL1 === null ? "-" : referrerL1 === TRADER ? "self" : "L1"}/${referrerL2 === null ? "-" : "L2"} · ${rank}`;
              const result = accrueRewards({
                fee: fee.fee,
                trader: TRADER,
                referrerL1,
                referrerL2,
                settledAt: AT,
                now: AT,
                price: fee.price,
                providerUsd: fee.usd,
                rules,
                referrerL1Rank: rank,
                window: { firstTen, inviter },
              });
              if (!result.ok) {
                /* Only a fee of which nothing reached Ryntra is turned away — never one whose shares would pass the ceiling. */
                assert.equal(base, 0n, `${what}: ${result.reason}`);
                continue;
              }
              const rows = result.entries;
              const paid = total(rows.map((row) => BigInt(row.shareRaw)));
              const welcome = rows.filter((row) => WELCOME.has(row.window));
              const welcomeRaw = total(welcome.map((row) => BigInt(row.shareRaw)));

              /* Never more than reached Ryntra, under any rules: the gross rules of 1.0.0 pay 65 % of the gross, inside the
                 four fifths left after Jupiter's share. */
              assert.ok(paid <= fee.received, `${what}: ${paid} paid of ${fee.received} received`);
              /* «First $10 back» may return its part whole; the rest of the fee stays inside the ceiling. */
              assert.ok((paid - welcomeRaw) * BPS <= (base - welcomeRaw) * ceiling, `${what}: ${paid - welcomeRaw} of ${base - welcomeRaw} past the ceiling`);
              if (!windowed || !firstTen) assert.equal(welcomeRaw, 0n, `${what}: a welcome row outside the window`);

              for (const row of rows) {
                const recipientOk =
                  row.type === "CASHBACK"
                    ? row.recipient === TRADER
                    : row.type === "REFERRAL_L1"
                      ? row.recipient === referrerL1 && referrerL1 !== TRADER
                      : row.type === "REFERRAL_L2"
                        ? row.recipient === referrerL2 && referrerL2 !== TRADER && referrerL2 !== referrerL1
                        : false;
                assert.ok(recipientOk, `${what}: ${row.type} to ${row.recipient}`);
                const most =
                  row.type === "CASHBACK" ? (row.window === "FIRST_TEN_REST" ? FIRST_TEN_CEILING_BPS : rules.cashbackBps) : row.type === "REFERRAL_L1" ? friendMost : rules.referralL2Bps;
                assert.ok(row.rateBps <= most, `${what}: ${row.type} at ${row.rateBps} bps`);
                assert.ok(BigInt(row.shareRaw) >= 0n, `${what}: a share below zero`);
              }
              const kinds = rows.map((row) => `${row.type}:${row.window ?? ""}`);
              assert.equal(new Set(kinds).size, kinds.length, `${what}: one share paid twice`);

              /* In dollars too: never more than what reached Ryntra is worth. One known exception, a rounding and never a
                 share: inside «First $10 back» a fee valued by its provider's own dollar figure values its half by the
                 rate and its rest by the raw amount, so with an odd amount the two pass the fee by half of what one raw
                 unit is worth — $0.0003 on a fee in an eight-decimal bitcoin, nothing on SOL, ETH or a dollar. */
              const slack = fee.byProvider && welcome.length > 0 ? (fee.unitDollars + 1n) / 2n + 1n : 0n;
              const receivedDollars = fee.dollarsOf(fee.received);
              if (receivedDollars !== null) {
                const dollars = total(rows.filter((row) => row.usdMicros !== null && row.usdMicros !== undefined).map((row) => BigInt(row.usdMicros)));
                assert.ok(dollars <= receivedDollars + slack, `${what}: $${dollars} of $${receivedDollars}`);
              }
              /* What comes back inside the window never passes what is left of the $10, but for that same rounding. */
              if (windowed && firstTen && typeof firstTen === "object" && fee.dollarsOf(base) !== null) {
                const back = total(welcome.map((row) => BigInt(row.usdMicros ?? "0")));
                assert.ok(back <= firstTen.remainingUsdMicros + slack, `${what}: ${back} back past the cap`);
                assert.ok((result.firstTen?.returnedUsdMicros ?? 0n) <= firstTen.remainingUsdMicros + slack, `${what}: the window counts ${result.firstTen?.returnedUsdMicros} back`);
              }
              /* A trade wholly inside the window pays its friend nothing and has no second level. */
              if (welcome.length > 0 && !rows.some((row) => row.window === "FIRST_TEN_AFTER")) {
                assert.equal(total(rows.filter((row) => row.type !== "CASHBACK").map((row) => BigInt(row.shareRaw))), 0n, `${what}: a friend paid inside the window`);
                assert.ok(!rows.some((row) => row.type === "REFERRAL_L2"), `${what}: a second level inside the window`);
              }
            }
          }
        }
      }
    }
  }
  assert.ok(combinations > 30_000, `only ${combinations} combinations were tried`);
});

test("the rates themselves fit: the largest cashback, the largest share of a friend and the second level make the ceiling", () => {
  for (const rules of VERSIONS) {
    for (const rank of REWARD_RANKS) {
      for (const inviter of [false, true]) {
        for (const [friend, friendsFriend] of [[false, false], [true, false], [false, true], [true, true]]) {
          const friendBps = !friend ? 0 : inviter && rules.inviterWindow ? rules.inviterWindow.bps : rules.referralL1BpsByRank[rank];
          const bps = rules.cashbackBps + friendBps + (friendsFriend ? rules.referralL2Bps : 0);
          assert.ok(bps <= maxPayoutBps(rules), `${rules.version} ${rank}: ${bps} bps`);
          if (rules.base === "RECEIVED") assert.ok(bps <= payoutCeilingBps(rules), `${rules.version} ${rank}: ${bps} bps past the ceiling`);
        }
      }
    }
  }
  /* 1.0.0 shared the gross, so it stayed inside what reached Ryntra only while a provider kept at most 35 %: Jupiter keeps 20 %. */
  assert.ok(maxPayoutBps(REWARD_RULES_V1) + ORDER_REFERRAL_PROVIDER_PERCENT * 100 <= 10_000);
  /* Only «First $10 back» may return all of a fee. */
  assert.ok(FIRST_TEN_CEILING_BPS <= 10_000);
});

test("a rank follows its points, and no rank's share of a friend passes what the ceiling leaves after cashback and the second level", () => {
  const room = payoutCeilingBps(REWARD_RULES_CURRENT) - REWARD_RULES_CURRENT.cashbackBps - REWARD_RULES_CURRENT.referralL2Bps;
  const points = REWARD_RANKS.flatMap((rank) => [RANK_THRESHOLDS[rank] - 1n, RANK_THRESHOLDS[rank], RANK_THRESHOLDS[rank] + 1n]).filter((value) => value >= 0n);
  points.push(10n ** 12n);
  points.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let previous = -1;
  for (const value of points) {
    const share = REWARD_RULES_CURRENT.referralL1BpsByRank[rankForPoints(value)];
    assert.ok(share >= previous, `${value} points: a higher standing pays a friend less`);
    assert.ok(share <= room, `${value} points: ${share} bps to a friend`);
    previous = share;
  }
  assert.ok((REWARD_RULES_CURRENT.inviterWindow?.bps ?? 0) <= room, "the 90 days' share passes the room");
});

/* The table «Угода на $1 000» of docs/city/ECONOMY.md, micro-dollars: the fee, what reached Ryntra, the most paid out, the least Ryntra keeps. */
const SWAP_EXAMPLES = {
  MEME: [10_000_000n, 10_000_000n, 8_500_000n, 1_500_000n],
  TRENDING: [5_000_000n, 5_000_000n, 4_250_000n, 750_000n],
  MAJOR: [1_000_000n, 1_000_000n, 850_000n, 150_000n],
  XSTOCK: [2_500_000n, 2_500_000n, 2_125_000n, 375_000n],
  AS_NOW: [5_000_000n, 4_000_000n, 3_400_000n, 600_000n],
};

test("the doc's $1 000 swap examples are what the engine computes", () => {
  const most = (fee, extra = {}) =>
    accrueRewards({ fee, trader: TRADER, referrerL1: FRIEND, referrerL2: FRIENDS_FRIEND, settledAt: AT, now: AT, price: null, rules: REWARD_RULES_CURRENT, referrerL1Rank: "DIAMOND", window: { inviter: true }, ...extra });
  const paidOf = (result) => total(result.entries.map((row) => BigInt(row.usdMicros)));
  for (const [flow, expected] of Object.entries(SWAP_EXAMPLES)) {
    const rule = FEE_POLICY_V2[flow];
    const order = rule.lane === "ORDER";
    const fee = collectedFee({ grossRaw: shareOf(THOUSAND, rule.bps), retainedPct: order ? ORDER_REFERRAL_PROVIDER_PERCENT : 0, mechanism: order ? "JUPITER_REFERRAL" : "JUPITER_PLATFORM_FEE" });
    const received = BigInt(fee.settlement.ryntraRaw);
    const paid = paidOf(most(fee));
    assert.deepEqual([shareOf(THOUSAND, rule.bps), received, paid, received - paid], expected, `${flow}: the engine's rates changed — update docs/city/ECONOMY.md`);
  }
  /* The bridge: Relay's app fee, nothing kept by Relay. */
  const bridge = collectedFee({ grossRaw: shareOf(THOUSAND, RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE), mechanism: "RELAY_APP_FEE" });
  assert.deepEqual([BigInt(bridge.settlement.ryntraRaw), paidOf(most(bridge))], [2_500_000n, 2_125_000n]);
  /* A meme fee of $10: a Bronze friend outside the 90 days gets $1, inside them $3; the parts are $5, $3 and $0.50. */
  const meme = collectedFee({ grossRaw: 10_000_000n });
  const bronze = accrueRewards({ fee: meme, trader: TRADER, referrerL1: FRIEND, referrerL2: FRIENDS_FRIEND, settledAt: AT, now: AT, price: null, rules: REWARD_RULES_CURRENT, referrerL1Rank: "BRONZE" });
  assert.deepEqual(bronze.entries.map((row) => [row.type, row.usdMicros]), [["CASHBACK", "5000000"], ["REFERRAL_L1", "1000000"], ["REFERRAL_L2", "500000"]]);
  assert.deepEqual(most(meme).entries.map((row) => [row.type, row.usdMicros]), [["CASHBACK", "5000000"], ["REFERRAL_L1", "3000000"], ["REFERRAL_L2", "500000"]]);
  /* A new wallet inside «First $10 back»: all $10 come back — half at once, half after the cluster check — and the friend gets nothing. */
  const welcome = most(meme, { window: { firstTen: { remainingUsdMicros: 10_000_000n }, inviter: true } });
  assert.deepEqual(welcome.entries.map((row) => [row.type, row.window, row.usdMicros]), [["CASHBACK", "FIRST_TEN", "5000000"], ["CASHBACK", "FIRST_TEN_REST", "5000000"], ["REFERRAL_L1", "FIRST_TEN", "0"]]);
  /* The claim floor: $0.25 with a USDC account, $1 without. */
  assert.deepEqual([REWARD_RULES_CURRENT.claimFloor.withAccountUsdMicros, REWARD_RULES_CURRENT.claimFloor.withoutAccountUsdMicros], [250_000n, 1_000_000n]);
});

/* ------------------------------------------------------------------------------------------------------ launch */

test("The doc's $1 000 buy on Classic", () => {
  assert.deepEqual({ ...LAUNCH_PAYOUT_RATES_BPS }, { crewBonus: 2_000, cashback: 3_000, friend: 1_500, creatorPartner: 500 }, "the launch's rates changed — update docs/city/ECONOMY.md");
  assert.equal(LAUNCH_PAYOUT_CEILING_BPS, 7_000);
  assert.equal(Object.values(LAUNCH_PAYOUT_RATES_BPS).reduce((sum, bps) => sum + bps, 0), LAUNCH_PAYOUT_CEILING_BPS);

  /* $1 000 bought on Classic through Ryntra: a $10 fee — the creator $3.20, Meteora $1.60, Ryntra $0.40 at once and $4.80 after the claim. */
  const curve = presetTerms("classic").curve;
  const feeRaw = shareOf(THOUSAND, curve.baseFeeBps);
  const atOnce = shareOf(feeRaw, curve.splitThroughRyntra.ryntraBps - curve.split.ryntraBps);
  const afterClaim = shareOf(feeRaw, curve.splitThroughRyntra.ryntraBps);
  assert.deepEqual(
    [feeRaw, shareOf(feeRaw, curve.splitThroughRyntra.creatorBps), shareOf(feeRaw, curve.splitThroughRyntra.meteoraBps), atOnce, afterClaim - atOnce],
    [10_000_000n, 3_200_000n, 1_600_000n, 400_000n, 4_800_000n],
  );
  /* The ceiling counts only what is on Ryntra's account: $0.28 before the claim, $3.64 after. */
  assert.deepEqual([payoutRoomRaw(atOnce, 0n), payoutRoomRaw(afterClaim, 0n)], [280_000n, 3_640_000n]);
  const parts = Object.values(LAUNCH_PAYOUT_RATES_BPS).map((bps) => shareOf(afterClaim, bps));
  assert.deepEqual(parts, [1_040_000n, 1_560_000n, 780_000n, 260_000n]);
  assert.equal(afterClaim - total(parts), 1_560_000n);

  /* $1 000 traded in the pool after the move to the DEX, at its starting 2 %: $20 — Meteora $4 (of it Ryntra's referral $0.80),
     $8 stays in the pool for ever, $4 to the creator's locked position and $4 to Ryntra's. */
  const pool = presetTerms("classic").pool;
  const poolFee = shareOf(THOUSAND, pool.startFeeBps);
  assert.deepEqual(
    [poolFee, shareOf(poolFee, pool.meteoraBps), shareOf(shareOf(poolFee, pool.meteoraBps), 2_000), shareOf(poolFee, pool.compoundingBps), shareOf(poolFee, pool.creatorPositionBps), shareOf(poolFee, pool.ryntraPositionBps)],
    [20_000_000n, 4_000_000n, 800_000n, 8_000_000n, 4_000_000n, 4_000_000n],
  );
});

test("a launch's fee is shared by the creator, Ryntra and Meteora and nobody else, and the pool's split never invents a share", () => {
  const presets = [...PEOPLE_PRESET_TERMS, ...["advanced", "rules", "demo"].map((id) => presetTerms(id)).filter(Boolean)];
  assert.ok(presets.length >= 5);
  for (const terms of presets) {
    for (const split of [terms.curve.split, terms.curve.splitThroughRyntra]) {
      assert.equal(split.creatorBps + split.ryntraBps + split.meteoraBps, 10_000, `${terms.id}: the curve's fee`);
      assert.ok(split.creatorBps >= 0 && split.ryntraBps >= 0 && split.meteoraBps >= 0, `${terms.id}: a part below zero`);
    }
    assert.equal(terms.graduation.creatorBps + terms.graduation.ryntraBps, 10_000, `${terms.id}: the move to the DEX`);
    assert.equal(terms.pool.meteoraBps + terms.pool.compoundingBps + terms.pool.positionsBps, 10_000, `${terms.id}: the pool's fee`);
    assert.ok(terms.pool.creatorPositionBps + terms.pool.ryntraPositionBps <= terms.pool.positionsBps, `${terms.id}: the locked positions`);
  }
  for (const claimingRaw of [0n, 1n, 2n, 3n, 999n, 1_000_000_007n]) {
    for (const liquidity of [1n, 2n, 1_000_000n]) {
      for (const locked of [-1n, 0n, liquidity / 2n, liquidity, liquidity * 2n]) {
        const split = poolClaimingSplit({ claimingRaw, liquidity, permanentLockedLiquidity: locked });
        assert.ok(split.creatorRaw >= 0n && split.ryntraRaw >= 0n && split.othersRaw >= 0n);
        assert.equal(split.creatorRaw + split.ryntraRaw + split.othersRaw, claimingRaw, `${claimingRaw} over ${liquidity} with ${locked} locked`);
      }
    }
  }
});

/* The launch's payouts as the room rule takes them: each takes its rate, never more than the ceiling has left. */
const NETWORK_MOST_BPS = Math.max(...NETWORK_RULES_HISTORY.flatMap((rules) => NETWORK_TIERS.flatMap((tier) => rules.schedules[tier].map((step) => step.bps))));
const NETWORK_CAP_BPS = Math.max(...NETWORK_RULES_HISTORY.map((rules) => rules.poolCapBps));
const LAUNCH_PAYOUTS = {
  cashback: LAUNCH_PAYOUT_RATES_BPS.cashback,
  friend: LAUNCH_PAYOUT_RATES_BPS.friend,
  creatorPartner: LAUNCH_PAYOUT_RATES_BPS.creatorPartner,
  crewBonus: "bonus",
  /* The creator's partner at the Ryntra Network's highest rate in code, and at its cap. */
  networkPartner: NETWORK_MOST_BPS,
  networkCap: NETWORK_CAP_BPS,
  /* «First $10 back» as the swap rules would pay it: all of it. */
  firstTen: FIRST_TEN_CEILING_BPS,
};

function payLaunch(receivedRaw, kinds) {
  let paid = 0n;
  const given = {};
  for (const kind of kinds) {
    const rate = LAUNCH_PAYOUTS[kind];
    const give = rate === "bonus" ? orbitBonusEntitlementRaw(receivedRaw, paid).raw : [shareOf(receivedRaw, rate), payoutRoomRaw(receivedRaw, paid)].reduce((a, b) => (a < b ? a : b));
    given[kind] = give;
    paid += give;
  }
  return { paid, given };
}

test("any mix and any order of a launch's payouts stays inside 70 % of what Ryntra received, through the room rule", () => {
  const kinds = Object.keys(LAUNCH_PAYOUTS);
  const owners = ["cashback", "friend", "creatorPartner", "crewBonus"];
  for (const receivedRaw of [0n, 1n, 3n, 7n, 280_000n, 400_000n, 5_200_000n, 185_454_545n, 10n ** 15n]) {
    for (let mask = 1; mask < 1 << kinds.length; mask += 1) {
      const chosen = kinds.filter((_kind, index) => mask & (1 << index));
      for (const order of [chosen, [...chosen].reverse(), [...chosen.filter((kind) => kind === "crewBonus"), ...chosen.filter((kind) => kind !== "crewBonus")]]) {
        const { paid, given } = payLaunch(receivedRaw, order);
        assert.ok(paid * BPS <= receivedRaw * BigInt(LAUNCH_PAYOUT_CEILING_BPS), `${order.join(" → ")} on ${receivedRaw}: ${paid}`);
        /* The operator's four rates make the ceiling exactly, so among themselves none is ever cut. */
        if (order.every((kind) => owners.includes(kind))) {
          for (const kind of order) assert.equal(given[kind], shareOf(receivedRaw, kind === "crewBonus" ? LAUNCH_PAYOUT_RATES_BPS.crewBonus : LAUNCH_PAYOUTS[kind]), `${kind} cut in ${order.join(" → ")}`);
        }
      }
    }
  }
});

test("the crew's bonus over days 7, 30 and 90 never passes 20 % of what came in, nor the room the other payouts leave", () => {
  const crews = [
    [["creator", 10_000]],
    [["creator", 5_000], ["mate", 5_000]],
    [["creator", 3_333], ["mate", 3_333], ["third", 3_334]],
    [["creator", 7_001], ["mate", 999], ["third", 1_000], ["fourth", 500], ["fifth", 500]],
  ].map((rows) => rows.map(([wallet, bps]) => ({ wallet, bps })));
  const STATES = ["waiting", "passed", "not-in-orbit", "lost"];
  const receipts = [
    [1_000_003n, 5_200_000n, 9_999_999n],
    [5_200_000n, 5_200_000n, 5_200_000n],
    [1n, 2n, 3n],
  ];
  /* What the other payouts took by each check, basis points of what came in: within their own rates — and past them. */
  const within = [0, 3_000, 4_500, 5_000];
  const past = [6_900, 7_000, 9_000, 10_000];
  for (const crew of crews) {
    for (const [r7, r30, r90] of receipts) {
      for (const othersBps of [...within, ...past]) {
        for (const a of STATES) for (const b of STATES) for (const c of STATES) {
          const received = { 7: r7, 30: r30, 90: r90 };
          const others = { 7: shareOf(r7, othersBps), 30: shareOf(r30, othersBps), 90: shareOf(r90, othersBps) };
          const checks = [[7, a], [30, b], [90, c]].map(([days, state]) => ({ days, state, receivedRaw: received[days], otherPayoutsRaw: others[days] }));
          const course = orbitBonusCourse(checks, crew);
          const what = `${crew.length} in the crew · ${r7}/${r30}/${r90} · others ${othersBps} bps · ${a}/${b}/${c}`;
          let bonus = 0n;
          let ended = false;
          for (const step of course.steps) {
            if (ended) assert.deepEqual([step.step, step.dueRaw], ["closed", 0n], `${what}: a check after the end`);
            if (step.step === "lost" || step.step === "waiting") ended = true;
            assert.ok(step.parts.every((part) => part.raw >= 0n), `${what}: a part below zero`);
            if (step.step !== "settled") {
              assert.equal(step.dueRaw, 0n, `${what}: ${step.step} paid`);
              continue;
            }
            const room = payoutRoomRaw(received[step.days], others[step.days]);
            /* Whatever is paid at a check fits the room the other payouts left at that check. */
            if (step.dueRaw > 0n) assert.ok(bonus + step.dueRaw <= room, `${what}: day ${step.days} pays ${step.dueRaw} on ${bonus} into a room of ${room}`);
            bonus += step.dueRaw;
            assert.ok(bonus <= shareOf(received[step.days], LAUNCH_PAYOUT_RATES_BPS.crewBonus), `${what}: ${bonus} past 20 % by day ${step.days}`);
            /* While the others keep to their rates, the bonus and the others together never pass 70 %. */
            if (within.includes(othersBps)) assert.ok(bonus + others[step.days] <= shareOf(received[step.days], LAUNCH_PAYOUT_CEILING_BPS), `${what}: past 70 % by day ${step.days}`);
          }
          assert.equal(course.paidRaw, bonus, `${what}: the course's sum`);
        }
      }
    }
    /* A check settled twice pays nothing twice. */
    const first = orbitBonusTranche({ receivedRaw: 5_200_000n, otherPayoutsRaw: 2_600_000n, crew });
    const again = orbitBonusTranche({ receivedRaw: 5_200_000n, otherPayoutsRaw: 2_600_000n, crew, paidRaw: new Map(first.parts.map((part) => [part.wallet, part.raw])) });
    assert.equal(again.dueRaw, 0n);
  }
});

test("a launch trade earns nothing from the swap rules: they would pass the launch's ceiling, and its fee counts money still in the pool", async () => {
  /* The swap rules return up to 85 %, and «First $10 back» all of a fee: both are above the launch's 70 %. */
  assert.ok(maxPayoutBps(REWARD_RULES_CURRENT) > LAUNCH_PAYOUT_CEILING_BPS);
  assert.ok(FIRST_TEN_CEILING_BPS > LAUNCH_PAYOUT_CEILING_BPS);
  /* A $1 000 buy on a launch curve, as the launch's record writes its fee: $5.20 «received», of which $4.80 still waits in the pool. */
  const fee = launchServiceFee({
    observed: { feeRaw: "10000000", ryntraRaw: "5200000", pairRaw: "1000000000", tokensRaw: "1", priceAfter: 1 },
    side: "buy",
    pair: { mint: USDC, symbol: "USDC", decimals: 6 },
    signature: "city-economy-launch-trade",
  });
  assert.deepEqual([fee.mechanism, fee.state, fee.settlement.ryntraRaw], ["METEORA_LAUNCH", "COLLECTED", "5200000"]);
  /* Were the swap rules asked, they would pay $4.42 of it while Ryntra holds $0.40. */
  const asked = accrueRewards({ fee, trader: TRADER, referrerL1: FRIEND, referrerL2: FRIENDS_FRIEND, settledAt: AT, now: AT, price: null, rules: REWARD_RULES_CURRENT, referrerL1Rank: "DIAMOND", window: { inviter: true } });
  assert.equal(total(asked.entries.map((row) => BigInt(row.shareRaw))), 4_420_000n);
  assert.ok(4_420_000n > payoutRoomRaw(400_000n, 0n));
  /* They are not asked: the record skips the fee before it reads anything at all. */
  for (const skipped of [fee, collectedFee({ grossRaw: 2_500_000n, mechanism: "MAYAN_REFERRER" }), serviceFeeAbsent("A direct CCTP transfer has no fee.")]) {
    const touched = [];
    const ledger = new Proxy({}, { get: (_target, key) => { touched.push(String(key)); throw new Error("the rewards ledger was read"); } });
    const outcome = await recordOperationRewards(ledger, { fee: skipped, trader: TRADER, settledAt: AT, now: AT, env: REWARDS_OPEN });
    assert.equal(outcome.state, "SKIPPED", skipped.mechanism);
    assert.doesNotMatch(outcome.reason, /ledger was read/, skipped.mechanism);
    assert.deepEqual(touched, [], `${skipped.mechanism}: the ledger was touched`);
  }
});

test("the creator's partner never takes more than 40 % of the pool's part, on any tier and day, and with the crew's bonus a launch stays inside 70 %", () => {
  const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
  const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
  const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
  const T0 = Date.parse("2026-10-20T00:00:00.000Z");
  const day = (n) => new Date(T0 + n * 86_400_000).toISOString();
  const binding = {
    schema: 1, network: "solana", factory: PROTECTED, pool: POOL, creator: TRADER, creationTx: "5".repeat(88), launchedAt: day(-1), partner: FRIEND,
    partnerCode: "BCDFGHJKLMNP", source: "inviter", decided: true, rulesVersion: NETWORK_RULES_HISTORY[0].version, checks: { status: "measured", reasons: [], at: day(-1) }, recordedAt: day(-1), version: 1,
  };
  let serial = 0;
  const claim = (n, usd, source) => ({
    kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: TRADER, source, claimer: SAFE,
    claim: { tx: `claim${++serial}`, index: "1.0", block: serial, at: day(n), finality: "finalized" },
    asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: String(usd), receivedRaw: String(usd), tokenRaw: "0", rule: "ALL", usdMicros: String(usd),
    valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: day(n),
  });
  const stream1 = (n, usd) => ({
    kind: "STREAM1", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, config: PROTECTED, venue: "curve", operationRef: `trade${++serial}`, trader: FRIENDS_FRIEND, entries: 2,
    usdMicros: String(usd), settledAt: day(n), recordedAt: day(n),
  });
  /* Claims on the days the schedules turn, Standard and Founding, with and without the rewards already paid on the pool's trades. */
  const DAYS = [0, 89, 90, 91, 179, 180, 181, 364, 365, 366, 1_000];
  const seats = [null, { seat: 1, wallet: FRIEND, approvedAt: day(-1), approvedBy: "owner" }, { seat: 2, wallet: FRIEND, approvedAt: day(150), approvedBy: "owner" }];
  let lines = 0;
  for (const seat of seats) {
    for (const amount of [1n, 3n, 999_999n, 4_800_000n, 123_456_789n]) {
      for (const tradeRewards of [0n, 1n, 2_340_000n, 10_000_000n]) {
        const claims = DAYS.map((n, index) => claim(n, amount + BigInt(index), index % 3 === 2 ? "lp" : "curve"));
        const computed = computePoolLines({ binding, claims, stream1: tradeRewards ? DAYS.map((n) => stream1(n, tradeRewards)) : [], seat, eligible: true, configs: null });
        assert.equal(computed.state, "OK");
        let base = 0n;
        let paid = 0n;
        let received = 0n;
        for (const line of computed.lines) {
          lines += 1;
          const what = `${seat ? `Founding from ${seat.approvedAt.slice(0, 10)}` : "Standard"} · ${amount} a claim · ${tradeRewards} trade rewards · day ${line.day}`;
          base += line.baseUsdMicros;
          paid += line.usdMicros;
          received += line.receivedUsdMicros;
          /* The rewards already paid on the pool's trades only ever lower the partner's base. */
          assert.ok(line.baseUsdMicros >= 0n && line.baseUsdMicros <= line.receivedUsdMicros, `${what}: base ${line.baseUsdMicros} of ${line.receivedUsdMicros}`);
          assert.ok(line.rateBps <= NETWORK_MOST_BPS, `${what}: ${line.rateBps} bps`);
          assert.ok(line.usdMicros >= 0n && line.usdMicros <= line.baseUsdMicros, `${what}: ${line.usdMicros} of a base of ${line.baseUsdMicros}`);
          /* The cap holds on the pool's running sums, line by line. */
          assert.ok(paid * BPS <= base * BigInt(NETWORK_CAP_BPS), `${what}: ${paid} past 40 % of ${base}`);
          /* With no reward on the pool's trades, the partner and the crew's bonus on top, through the room rule, stay inside 70 %. */
          if (tradeRewards === 0n) {
            const bonus = orbitBonusEntitlementRaw(received, paid).raw;
            assert.ok((paid + bonus) * BPS <= received * BigInt(LAUNCH_PAYOUT_CEILING_BPS), `${what}: ${paid} + ${bonus} past 70 % of ${received}`);
          }
        }
      }
    }
  }
  assert.ok(lines > 500, `only ${lines} lines`);
  /* The doc's $1 000 buy: of the $4.80 the claim brings, Standard $0.96, Founding $1.44, the cap $1.92 — where the operator's rate of 25.10 is $0.26. */
  assert.deepEqual([shareOf(4_800_000n, 2_000), shareOf(4_800_000n, NETWORK_MOST_BPS), shareOf(4_800_000n, NETWORK_CAP_BPS), shareOf(5_200_000n, LAUNCH_PAYOUT_RATES_BPS.creatorPartner)], [960_000n, 1_440_000n, 1_920_000n, 260_000n]);
});

/* ----------------------------------------------------------------------------------------------------- Phoenix */

test("Ryntra's Phoenix fee is the builder's bps on fills that take liquidity, rounded up to a micro-dollar, and maker fills bring it nothing", () => {
  for (const bps of [0, 1, 2, 5, 10]) {
    for (const notional of [0, 0.01, 1, 96.970888, 1_000, 123_456.78]) {
      const fee = builderFeeUsd(notional, bps);
      const exact = (notional * bps) / 10_000;
      assert.ok(fee >= exact - 1e-9 && fee <= exact + 0.000_001 + 1e-9, `${bps} bps on $${notional}: $${fee}`);
    }
  }
  const rates = { takerRate: 0.000_35, makerRate: 0.000_05, builderBps: 2 };
  const fill = (liquidity, sizeUnits = 10, priceUsd = 100) => ({ sizeUnits, priceUsd, feeUsd: null, realizedPnlUsd: null, liquidity });
  /* $1 000 as a market order: Phoenix 0.035 % = $0.35, Ryntra 2 bps = $0.20; resting as a limit: Phoenix 0.005 % = $0.05, Ryntra nothing. */
  const taker = feeSplitOf([fill("taker")], rates);
  const maker = feeSplitOf([fill("maker")], rates);
  assert.deepEqual([taker.phoenixUsd, taker.ryntraUsd, maker.phoenixUsd, maker.ryntraUsd], [0.35, 0.2, 0.05, 0]);
  /* A limit that fills partly at once: Ryntra's part rides only on the taker half. */
  const mixed = feeSplitOf([fill("taker", 5), fill("maker", 5)], rates);
  assert.ok(Math.abs(mixed.ryntraUsd - 0.1) < 1e-9, `$${mixed.ryntraUsd}`);
  assert.equal(feeSplitOf([fill("taker"), fill("maker")], { ...rates, builderBps: 0 }).ryntraUsd, 0);
});

/* ------------------------------------------------------------------------------------------------- predictions */

test("predictions on paper move no money, and a live buy pays Ryntra its fee less the aggregator's fifth, with no inviter paid by Ryntra", () => {
  assert.deepEqual([RYNTRA_BUY_FEE_BIPS, AGG_PLATFORM_SHARE_BIPS, { ...REFERRAL_FEE_BIPS }], [30, 2_000, { friend: 6, ambassador: 10 }], "the rates of predictions changed — update docs/city/ECONOMY.md");
  const line = ({ paper = false, bips = RYNTRA_BUY_FEE_BIPS, referral = null }) => {
    const due = shareOf(THOUSAND, bips);
    const api = { status: "filled", side: "buy", venue: "polymarket", quoteId: "quote", dagRunId: "run", paper, amountRaw: String(THOUSAND), filledAmountRaw: String(THOUSAND), quotedAppFeeBips: bips, updatedAt: AT };
    return buildTradeLine(
      { kind: "trade", version: 1, tradeKey: "r:run", quoteId: "quote", dagRunId: "run", userId: null, orderIds: ["order"], hookFee: null, apiFee: { bips, dueRaw: String(due), collectedRaw: String(due), status: due > 0n ? "confirmed" : "skipped_zero" }, referral, apiFeeAt: AT, events: [] },
      [{ kind: "order", version: 1, orderId: "order", hookRun: null, userId: null, externalId: null, hook: { status: null, filledAmountRaw: null, at: null }, api, events: [] }],
    );
  };
  const inviter = (kind) => {
    const due = String(shareOf(THOUSAND, REFERRAL_FEE_BIPS[kind]));
    return { referrer: "0x3333333333333333333333333333333333333333", payer: "user", feeBips: REFERRAL_FEE_BIPS[kind], dueRaw: due, paidRaw: due, status: "confirmed" };
  };
  /* $1 000 bought live: alone, with a friend, with an ambassador, and inside the first 30 days at 0 %. */
  const live = [
    line({}),
    line({ bips: RYNTRA_BUY_FEE_BIPS - REFERRAL_FEE_BIPS.friend, referral: inviter("friend") }),
    line({ bips: RYNTRA_BUY_FEE_BIPS - REFERRAL_FEE_BIPS.ambassador, referral: inviter("ambassador") }),
    line({ bips: 0 }),
  ];
  assert.deepEqual(
    live.map((row) => [row.feeCollectedRaw, row.aggShareRaw, row.netRyntraRaw, row.issues]),
    [
      ["3000000", "600000", "2400000", []],
      ["2400000", "480000", "1920000", []],
      ["2000000", "400000", "1600000", []],
      ["0", "0", "0", []],
    ],
  );
  for (const row of live) assert.ok(BigInt(row.netRyntraRaw) <= BigInt(row.feeCollectedRaw) - BigInt(row.aggShareRaw));
  /* The same orders on paper are lines and nothing else. */
  const paper = [line({ paper: true }), line({ paper: true, bips: RYNTRA_BUY_FEE_BIPS - REFERRAL_FEE_BIPS.friend, referral: inviter("friend") })];
  const totals = ledgerTotals({ lines: paper, unlinked: [], unreadableOrders: 0 });
  assert.deepEqual([totals.paper, totals.filledRaw, totals.feeCollectedRaw, totals.aggShareRaw, totals.referralPaidRaw, totals.netRyntraRaw], [2, "0", "0", "0", "0", "0"]);
});

/* ------------------------------------------------------------------------------------------------------ the end */

test("the engine's rules were only read: they are as they were before the first test", () => {
  assert.equal(engineRules(), BEFORE);
});
