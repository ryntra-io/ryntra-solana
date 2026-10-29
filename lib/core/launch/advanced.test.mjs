import assert from "node:assert/strict";
import test from "node:test";

import { presetCurve } from "../venues/meteora-dbc/launch.server.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS, creatorFirstBuyCapRaw, honestLaunchProblems } from "../venues/meteora-dbc/presets.ts";
import {
  ADVANCED_DEFAULT_CHOICE,
  ADVANCED_SUPPLIES,
  DEVNET_ADVANCED_BOUNDS,
  advancedChoiceOf,
  advancedPreset,
  advancedPrices,
  advancedProblems,
  parseAdvancedBounds,
  unusualTokenomics,
} from "./advanced.ts";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, usdPrice: 1 };

test("SOL-L5: the default choice holds the devnet bounds and is Захищений's numbers", () => {
  assert.deepEqual(advancedProblems(ADVANCED_DEFAULT_CHOICE, DEVNET_ADVANCED_BOUNDS), []);
  const preset = advancedPreset(ADVANCED_DEFAULT_CHOICE, DEVNET_ADVANCED_BOUNDS);
  assert.equal(preset.id, "advanced");
  assert.deepEqual(preset.curve, { startMarketCapUsd: 5_000, graduationMarketCapUsd: 75_000 });
  assert.deepEqual(preset.sniperFee, LAUNCH_PRESETS.protected.sniperFee);
  assert.equal(preset.feeClaimer, "multisig");
  assert.deepEqual(unusualTokenomics(ADVANCED_DEFAULT_CHOICE), []);
});

test("SOL-L5: «Розширений» is never a preset to pick", () => {
  assert.ok(!PEOPLE_PRESET_IDS.includes("advanced"));
});

test("SOL-L5: every way out of the bounds is named", () => {
  const b = DEVNET_ADVANCED_BOUNDS;
  const at = (patch) => advancedProblems({ ...ADVANCED_DEFAULT_CHOICE, ...patch }, b);
  assert.deepEqual(at({ supply: 5_000_000 }), ["SUPPLY"]);
  assert.deepEqual(at({ startMarketCapUsd: 500, graduationMarketCapUsd: 10_000 }), ["START_CAP"]);
  assert.deepEqual(at({ graduationMarketCapUsd: 2_000_000 }), ["GRADUATION_CAP", "MULTIPLE"]);
  assert.deepEqual(at({ startMarketCapUsd: 10_000, graduationMarketCapUsd: 20_000 }), ["MULTIPLE"]);
  assert.deepEqual(at({ creatorTradingFeePct: 60 }), ["CREATOR_SHARE"]);
  assert.deepEqual(at({ creatorTradingFeePct: 10.5 }), ["CREATOR_SHARE"]);
  assert.deepEqual(at({ poolStartFeeBps: 600 }), ["POOL_START_FEE"]);
  assert.deepEqual(at({ poolStartFeeBps: 50, poolEndFeeBps: 80 }), ["POOL_FEE_ORDER"]);
  assert.deepEqual(at({ startMarketCapUsd: Number.NaN }), ["START_CAP", "MULTIPLE"]);
  assert.deepEqual(advancedProblems({ ...ADVANCED_DEFAULT_CHOICE, sniper: "standard" }, { ...b, snipers: ["strong"] }), ["SNIPER"]);
});

test("SOL-L5: the market cap does not grow with the supply — the price falls instead", () => {
  const one = advancedPrices({ supply: 1_000_000_000, startMarketCapUsd: 5_000, graduationMarketCapUsd: 75_000 });
  const ten = advancedPrices({ supply: 10_000_000_000, startMarketCapUsd: 5_000, graduationMarketCapUsd: 75_000 });
  assert.equal(one.startPriceUsd, 0.000005);
  assert.equal(ten.startPriceUsd, 0.0000005);
  assert.equal(one.multiple, 15);
  assert.equal(ten.multiple, 15);
  assert.deepEqual(unusualTokenomics({ ...ADVANCED_DEFAULT_CHOICE, supply: 10_000_000_000 }), ["SUPPLY"]);
  assert.deepEqual(unusualTokenomics({ ...ADVANCED_DEFAULT_CHOICE, startMarketCapUsd: 1_000, graduationMarketCapUsd: 50_000, creatorTradingFeePct: 50, sniper: "standard" }), [
    "STEEP",
    "LOW_START",
    "HIGH_CREATOR_SHARE",
    "SOFT_SNIPERS",
  ]);
});

test("SOL-L5: the first-purchase cap follows the launch's own supply", () => {
  const preset = advancedPreset({ ...ADVANCED_DEFAULT_CHOICE, supply: 10_000_000_000 }, DEVNET_ADVANCED_BOUNDS);
  assert.equal(creatorFirstBuyCapRaw(preset), 10_000_000_000n * 1_000_000n * 200n / 10_000n);
  assert.equal(creatorFirstBuyCapRaw(LAUNCH_PRESETS.advanced, 1_000_000n * 1_000_000n), 1_000_000n * 1_000_000n * 200n / 10_000n);
});

test("SOL-L5: Meteora's SDK builds an honest curve at every corner of the devnet bounds", () => {
  const b = DEVNET_ADVANCED_BOUNDS;
  const corners = [];
  for (const supply of ADVANCED_SUPPLIES) {
    for (const [start, graduation] of [
      [b.startMarketCapUsd.min, b.startMarketCapUsd.min * b.multiple.min * 2],
      [b.startMarketCapUsd.min, b.startMarketCapUsd.min * b.multiple.max],
      [b.startMarketCapUsd.max, Math.min(b.graduationMarketCapUsd.max, b.startMarketCapUsd.max * b.multiple.min)],
      [5_000, 75_000],
    ]) {
      corners.push({ ...ADVANCED_DEFAULT_CHOICE, supply, startMarketCapUsd: start, graduationMarketCapUsd: graduation });
    }
  }
  corners.push({ ...ADVANCED_DEFAULT_CHOICE, creatorTradingFeePct: 0, sniper: "standard", poolStartFeeBps: 25, poolEndFeeBps: 10 });
  corners.push({ ...ADVANCED_DEFAULT_CHOICE, creatorTradingFeePct: 50, poolStartFeeBps: 500, poolEndFeeBps: 100 });
  for (const choice of corners) {
    assert.deepEqual(advancedProblems(choice, b), [], JSON.stringify(choice));
    const curve = presetCurve(advancedPreset(choice, b), USDC);
    const supplyRaw = BigInt(choice.supply) * 1_000_000n;
    assert.equal(curve.tokenSupply.preMigrationTokenSupply.toString(), supplyRaw.toString(), JSON.stringify(choice));
    assert.equal(curve.tokenSupply.postMigrationTokenSupply.toString(), supplyRaw.toString());
    const problems = honestLaunchProblems({
      hasTransferHook: false,
      tokenType: curve.tokenType,
      tokenUpdateAuthority: curve.tokenUpdateAuthority,
      migrationOption: curve.migrationOption,
      partnerLiquidityPercentage: curve.partnerLiquidityPercentage,
      partnerPermanentLockedLiquidityPercentage: curve.partnerPermanentLockedLiquidityPercentage,
      partnerVestingPercentage: curve.partnerLiquidityVestingInfo?.vestingPercentage ?? 0,
      creatorLiquidityPercentage: curve.creatorLiquidityPercentage,
      creatorPermanentLockedLiquidityPercentage: curve.creatorPermanentLockedLiquidityPercentage,
      creatorVestingPercentage: curve.creatorLiquidityVestingInfo?.vestingPercentage ?? 0,
      lockedVestingAmount: "0",
      baseFeeMode: curve.poolFees.baseFee.baseFeeMode,
      migratedCollectFeeMode: curve.migratedPoolFee.collectFeeMode,
      compoundingFeeBps: curve.compoundingFeeBps,
      migratedPoolBaseFeeMode: curve.migratedPoolBaseFeeMode,
      enableFirstSwapWithMinFee: curve.enableFirstSwapWithMinFee,
      preMigrationTokenSupply: curve.tokenSupply.preMigrationTokenSupply.toString(),
      postMigrationTokenSupply: curve.tokenSupply.postMigrationTokenSupply.toString(),
    });
    assert.deepEqual(problems, []);
    assert.equal(curve.creatorTradingFeePercentage, choice.creatorTradingFeePct);
  }
});

test("SOL-L5: configured bounds are read only when every part holds the programs' limits", () => {
  const json = JSON.stringify(DEVNET_ADVANCED_BOUNDS);
  assert.deepEqual(parseAdvancedBounds(json), DEVNET_ADVANCED_BOUNDS);
  assert.equal(parseAdvancedBounds(undefined), null);
  assert.equal(parseAdvancedBounds("not json"), null);
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, poolStartFeeBps: { min: 5, max: 500 } })), null);
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, supplies: [7] })), null);
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, multiple: { min: 1, max: 5 } })), null);
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, firstBuyCapBps: 5_000 })), null);
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, firstBuyCapBps: 300 })), null, "never above the template's cap");
  assert.equal(parseAdvancedBounds(JSON.stringify({ ...DEVNET_ADVANCED_BOUNDS, firstBuyCapBps: 100 }))?.firstBuyCapBps, 100);
  const { graduationFee, ...missing } = DEVNET_ADVANCED_BOUNDS;
  assert.ok(graduationFee);
  assert.equal(parseAdvancedBounds(JSON.stringify(missing)), null);
});

test("SOL-L5: a choice from a request has every field and nothing else is read", () => {
  assert.deepEqual(advancedChoiceOf({ ...ADVANCED_DEFAULT_CHOICE, extra: 1 }), ADVANCED_DEFAULT_CHOICE);
  assert.equal(advancedChoiceOf({ ...ADVANCED_DEFAULT_CHOICE, sniper: "mild" }), null);
  assert.equal(advancedChoiceOf({ ...ADVANCED_DEFAULT_CHOICE, supply: "1000" }), null);
  assert.equal(advancedChoiceOf(null), null);
});
