import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Connection } from "@solana/web3.js";

import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";

import {
  DAMM_V2_BASE_FEE_MODE,
  DAMM_V2_COLLECT_FEE_MODE,
  DBC_ACTIVATION,
  DBC_BASE_FEE_MODE,
  DBC_COLLECT_FEE_MODE,
  DBC_MIGRATION_FEE_OPTION,
  DBC_MIGRATION_OPTION,
  DBC_TOKEN_AUTHORITY,
  DBC_TOKEN_TYPE,
  LAUNCH_PRESETS,
  LAUNCH_PRESET_IDS,
  creatorFirstBuyCapRaw,
  honestLaunchProblems,
  launchPreset,
  PEOPLE_PRESET_IDS,
  presetCurveInput,
  thresholdCurve,
} from "./presets.ts";
import { createMeteoraDbcLaunchVenue, presetCurve } from "./launch.server.ts";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, usdPrice: 1 };

test("the mirrored numbers are the SDK's own", () => {
  assert.equal(DBC_TOKEN_TYPE.TOKEN_2022, sdk.TokenType.Token2022);
  assert.equal(DBC_TOKEN_TYPE.SPL, sdk.TokenType.SPLToken);
  assert.equal(DBC_TOKEN_AUTHORITY.IMMUTABLE, sdk.TokenAuthorityOption.Immutable);
  assert.equal(DBC_TOKEN_AUTHORITY.CREATOR_UPDATE, sdk.TokenAuthorityOption.CreatorUpdateAuthority);
  assert.equal(DBC_BASE_FEE_MODE.SCHEDULER_EXPONENTIAL, sdk.BaseFeeMode.FeeSchedulerExponential);
  assert.equal(DBC_BASE_FEE_MODE.SCHEDULER_LINEAR, sdk.BaseFeeMode.FeeSchedulerLinear);
  assert.equal(DBC_COLLECT_FEE_MODE.QUOTE, sdk.CollectFeeMode.QuoteToken);
  assert.equal(DBC_MIGRATION_OPTION.DAMM_V2, sdk.MigrationOption.MET_DAMM_V2);
  assert.equal(DBC_MIGRATION_FEE_OPTION.CUSTOMIZABLE, sdk.MigrationFeeOption.Customizable);
  assert.equal(DAMM_V2_COLLECT_FEE_MODE.COMPOUNDING, sdk.MigratedCollectFeeMode.Compounding);
  assert.equal(DAMM_V2_BASE_FEE_MODE.MARKET_CAP_EXPONENTIAL, sdk.DammV2BaseFeeMode.FeeMarketCapSchedulerExponential);
  assert.equal(DAMM_V2_BASE_FEE_MODE.MARKET_CAP_LINEAR, sdk.DammV2BaseFeeMode.FeeMarketCapSchedulerLinear);
  assert.equal(DBC_ACTIVATION.TIMESTAMP, sdk.ActivationType.Timestamp);
});

test("five presets, each named in both languages — the demo market for Ryntra alone", () => {
  assert.deepEqual([...LAUNCH_PRESET_IDS], ["classic", "protected", "community", "micro", "demo"]);
  assert.deepEqual(
    LAUNCH_PRESET_IDS.map((id) => LAUNCH_PRESETS[id].name),
    [
      { uk: "Класичний", en: "Classic" },
      { uk: "Захищений", en: "Protected" },
      { uk: "Спільнота", en: "Community" },
      { uk: "Micro", en: "Micro" },
      { uk: "Демо-ринок", en: "Demo market" },
    ],
  );
  assert.deepEqual([...PEOPLE_PRESET_IDS], ["classic", "protected", "community", "micro"]);
  assert.equal(LAUNCH_PRESETS.demo.audience, "internal");
  assert.equal(launchPreset("classic"), LAUNCH_PRESETS.classic);
  assert.equal(launchPreset("pump"), null);
});

test("«Чесний лаунч» holds in every preset's curve as the SDK builds it", () => {
  for (const id of LAUNCH_PRESET_IDS) {
    const preset = LAUNCH_PRESETS[id];
    const quote = preset.pair === "USDC" ? USDC : { mint: USDC.mint, decimals: 6, usdPrice: 0.01 };
    const curve = presetCurve(preset, quote);
    assert.equal(curve.tokenType, sdk.TokenType.Token2022, id);
    assert.equal(curve.tokenUpdateAuthority, sdk.TokenAuthorityOption.Immutable, id);
    assert.equal(curve.migrationOption, sdk.MigrationOption.MET_DAMM_V2, id);
    assert.equal(curve.partnerLiquidityPercentage + curve.creatorLiquidityPercentage, 0, `${id}: nothing unlocked`);
    assert.equal(curve.partnerPermanentLockedLiquidityPercentage + curve.creatorPermanentLockedLiquidityPercentage, 100, `${id}: all locked`);
    assert.equal(curve.migratedPoolFee.collectFeeMode, sdk.MigratedCollectFeeMode.Compounding, id);
    assert.equal(curve.compoundingFeeBps, preset.graduatedPool.compoundingFeeBps, id);
    assert.equal(curve.migratedPoolBaseFeeMode, sdk.DammV2BaseFeeMode.FeeMarketCapSchedulerExponential, id);
    assert.equal(curve.poolFees.baseFee.baseFeeMode, sdk.BaseFeeMode.FeeSchedulerExponential, id);
    assert.ok(curve.poolFees.dynamicFee, `${id}: the dynamic fee is on`);
    assert.equal(curve.enableFirstSwapWithMinFee, true, id);
    assert.equal(curve.creatorTradingFeePercentage, preset.creatorTradingFeePct, id);
    assert.equal(curve.lockedVesting.amountPerPeriod.toString(), "0", `${id}: no allocation outside the curve`);
    assert.equal(curve.poolCreationFee.toString(), "0", id);
    assert.equal(curve.tokenSupply.preMigrationTokenSupply.toString(), "1000000000000000", `${id}: 1 000 000 000 tokens of 6 decimals`);
    /* The sniper fee starts where the preset says, in the program's numerator over 10⁹. */
    assert.equal(curve.poolFees.baseFee.cliffFeeNumerator.toString(), String(preset.sniperFee.startBps * 100_000), id);
  }
});

test("the curve graduates above the threshold Meteora's keepers migrate on their own", () => {
  const threshold = Number(presetCurve(LAUNCH_PRESETS.classic, USDC).migrationQuoteThreshold.toString()) / 1e6;
  /* A $5 000 → $75 000 curve raises about $15 000; the keepers migrate a verified quote above $750. */
  assert.ok(threshold > 750, `threshold ${threshold}`);
  assert.ok(threshold > 14_000 && threshold < 17_000, `threshold ${threshold}`);
});

test("a community pair converts the dollar curve at the token's price", () => {
  const input = presetCurveInput(LAUNCH_PRESETS.community, { mint: USDC.mint, decimals: 9, usdPrice: 0.5 });
  assert.equal(input.initialMarketCap, 10_000);
  assert.equal(input.migrationMarketCap, 150_000);
  assert.equal(input.token.tokenQuoteDecimal, 9);
  assert.throws(() => presetCurveInput(LAUNCH_PRESETS.classic, { ...USDC, usdPrice: 0.98 }), /USDC pair is priced at one dollar/);
  assert.throws(() => presetCurveInput(LAUNCH_PRESETS.community, { ...USDC, usdPrice: 0 }), /dollar price/);
});

test("honestLaunchProblems names each broken rule", () => {
  const good = {
    hasTransferHook: false,
    tokenType: 1,
    tokenUpdateAuthority: 1,
    migrationOption: 1,
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage: 50,
    partnerVestingPercentage: 0,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 50,
    creatorVestingPercentage: 0,
    lockedVestingAmount: "0",
    baseFeeMode: 1,
    migratedCollectFeeMode: 2,
    compoundingFeeBps: 5000,
    migratedPoolBaseFeeMode: 4,
    enableFirstSwapWithMinFee: true,
    preMigrationTokenSupply: "1000000000000000",
    postMigrationTokenSupply: "1000000000000000",
  };
  assert.deepEqual(honestLaunchProblems(good), []);
  const cases = [
    [{ hasTransferHook: true }, /transfer-hook/],
    [{ tokenUpdateAuthority: 0 }, /metadata can be changed/],
    [{ creatorLiquidityPercentage: 10, creatorPermanentLockedLiquidityPercentage: 40 }, /unlocked/],
    [{ creatorVestingPercentage: 10, creatorPermanentLockedLiquidityPercentage: 40 }, /vests/],
    [{ lockedVestingAmount: "1" }, /outside the curve/],
    [{ baseFeeMode: 0 }, /not exponential/],
    [{ migratedCollectFeeMode: 0 }, /does not compound/],
    [{ compoundingFeeBps: 0 }, /does not compound/],
    [{ migratedPoolBaseFeeMode: 1 }, /market cap/],
    [{ enableFirstSwapWithMinFee: false }, /sniper fee/],
    [{ tokenType: 0 }, /Token-2022/],
    [{ postMigrationTokenSupply: "1000000000000001" }, /supply changes at graduation/],
  ];
  for (const [change, message] of cases) {
    const problems = honestLaunchProblems({ ...good, ...change });
    assert.ok(problems.some((line) => message.test(line)), `${JSON.stringify(change)} → ${problems.join(" | ")}`);
  }
});

test("the creator's first-buy cap is a share of the fixed supply", () => {
  assert.equal(creatorFirstBuyCapRaw(LAUNCH_PRESETS.classic), 50_000_000_000_000n);
  assert.equal(creatorFirstBuyCapRaw(LAUNCH_PRESETS.protected), 20_000_000_000_000n);
  assert.equal(creatorFirstBuyCapRaw(LAUNCH_PRESETS.community), 50_000_000_000_000n);
  for (const id of LAUNCH_PRESET_IDS) assert.ok(LAUNCH_PRESETS[id].creatorFirstBuyCapBps <= 500, `${id}: at most 5 % of supply`);
});

test("a config read back from the chain is judged on the program's own fields — the rehearsal's real account bytes", () => {
  const { config, dataBase64 } = JSON.parse(readFileSync(new URL("./fixtures/devnet-classic-config.json", import.meta.url), "utf8"));
  /* Decoding needs no network: the connection is never called. */
  const venue = createMeteoraDbcLaunchVenue({ connection: new Connection("http://127.0.0.1:9"), configs: {} });
  const data = Buffer.from(dataBase64, "base64");
  const fields = venue.configFieldsFromData(config, data);
  assert.deepEqual(honestLaunchProblems(fields), []);
  const curve = presetCurve(LAUNCH_PRESETS.classic, USDC);
  assert.equal(fields.migrationQuoteThreshold, curve.migrationQuoteThreshold.toString(), "the threshold the preset builds is the one stored");
  assert.equal(fields.cliffFeeNumerator, curve.poolFees.baseFee.cliffFeeNumerator.toString());
  assert.equal(fields.creatorTradingFeePercentage, 40);
  assert.equal(fields.compoundingFeeBps, 5000);
  assert.equal(fields.dynamicFeeEnabled, true);
  /* The whole account, plain: what the mainnet tool compares field by field. */
  const plain = venue.plainConfigFromData(data);
  assert.equal(plain.sqrtStartPrice, curve.sqrtStartPrice.toString());
  assert.equal(plain.curve.length, 20, "every stored curve slot is compared, not only the used ones");
  /* A transfer-hook config or another account is refused, not read as a preset. */
  assert.throws(() => venue.configFieldsFromData(config, Buffer.concat([Buffer.alloc(8), data.subarray(8)])), /is not a DBC config/);
});

test("Micro graduates at exactly 750 USDC and the demo market at 50 — the migration fee all to the market's budget", () => {
  const micro = presetCurve(LAUNCH_PRESETS.micro, USDC);
  const demo = presetCurve(LAUNCH_PRESETS.demo, USDC);
  assert.equal(micro.migrationQuoteThreshold.toString(), "750000000", "Meteora's keepers migrate a USDC curve at 750");
  assert.equal(demo.migrationQuoteThreshold.toString(), "50000000");
  assert.deepEqual(micro.migrationFee, { feePercentage: 8, creatorFeePercentage: 0 });
  assert.deepEqual(demo.migrationFee, { feePercentage: 30, creatorFeePercentage: 0 });
  for (const curve of [micro, demo]) {
    assert.equal(curve.creatorTradingFeePercentage, 40);
    assert.equal(curve.compoundingFeeBps, 2500);
    assert.equal(curve.migratedPoolFee.poolFeeBps, 200);
    assert.equal(curve.partnerPermanentLockedLiquidityPercentage + curve.creatorPermanentLockedLiquidityPercentage, 100);
    assert.equal(curve.poolFees.baseFee.cliffFeeNumerator.toString(), String(2_000 * 100_000));
  }
  /* The same curve shape as Classic: graduation fifteen times the start. */
  for (const id of ["micro", "demo"]) {
    const { startMarketCapUsd, graduationMarketCapUsd } = LAUNCH_PRESETS[id].curve;
    assert.ok(Math.abs(graduationMarketCapUsd / startMarketCapUsd - 15) < 1e-9, id);
  }
  assert.ok(Math.abs(LAUNCH_PRESETS.micro.curve.graduationMarketCapUsd - 3594.74) < 0.01);
  /* The inverse is the SDK's own: Classic's threshold gives Classic's market caps back. */
  const back = thresholdCurve(15_454.411163, 2, 15);
  assert.ok(Math.abs(back.graduationMarketCapUsd - 75_000) < 0.01 && Math.abs(back.startMarketCapUsd - 5_000) < 0.01);
});

test("Micro and the demo market: the executor claims the partner's fees, the creator's lock is required for six months", () => {
  for (const id of ["micro", "demo"]) {
    const preset = LAUNCH_PRESETS[id];
    assert.equal(preset.feeClaimer, "executor", id);
    assert.equal(preset.creatorFirstBuyCapBps, 200, id);
    assert.equal(preset.creatorLockMinDays, 180, id);
    assert.equal(preset.graduatedPool.endFeeBps, 25, id);
  }
  for (const id of ["classic", "protected", "community"]) {
    assert.equal(LAUNCH_PRESETS[id].feeClaimer, "multisig", id);
    assert.equal(LAUNCH_PRESETS[id].creatorLockMinDays, null, id);
  }
  /* Classic, Protected and Community stay the configs signed on mainnet: their threshold has not moved. */
  assert.equal(presetCurve(LAUNCH_PRESETS.classic, USDC).migrationQuoteThreshold.toString(), "15454411163");
});
