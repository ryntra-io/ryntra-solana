/*
 * SOL-L10 — «Комісія за переказ»: the rule, the numbers and the build, without a network.
 *
 * - the flag: offered only with `RYNTRA_LAUNCH_TRANSFER_FEE=open` on DBC SDK 2.0.0, closed by default;
 * - the rule: RevokeZeroFee only, the creator collects, at most the cap (2 %), never 0 bps; Partner, Creator and
 *   Immutable refused before a byte is built — the mirror of the SDK's enums checked against SDK 2.0.0;
 * - the token program's math and the RevokeZeroFee timeline as a mint shows it;
 * - Quick Launch and every preset pass no transfer-fee parameters at all; «Розширений» with a rate builds `create_config2`
 *   with exactly Ryntra's parameters, on 2.0.0 only;
 * - the launch receipt: a TransferFeeConfig mint is Ryntra's only when its «Розширений» config set it under the rule, and
 *   it says «Комісія за переказ N % до виходу на DEX» in place of «Без правил на переказах».
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BorshInstructionCoder } from "@coral-xyz/anchor";
import * as v2 from "@meteora-ag/dynamic-bonding-curve-sdk-v2";
import { Keypair, Transaction } from "@solana/web3.js";
import BN from "bn.js";

import { createMeteoraDbcLaunchVenue, presetCurve } from "../venues/meteora-dbc/launch.server.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS, honestLaunchProblems } from "../venues/meteora-dbc/presets.ts";
import { createDbcClient, DBC_SDK_FLAG } from "../venues/meteora-dbc/sdk.server.ts";
import { fixtureConnection, plainValue } from "../venues/meteora-dbc/sdk-compare-kit.mjs";
import { launchObservationProblems, launchCreationProblems } from "../venues/meteora-dbc/receipt.ts";
import { DEVNET_ADVANCED_BOUNDS, ADVANCED_DEFAULT_CHOICE, advancedChoiceOf, advancedPreset, advancedProblems } from "./advanced.ts";
import { marketRules } from "./market-health.ts";
import {
  DBC_MIGRATED_TRANSFER_FEE_AUTHORITY,
  DBC_TRANSFER_FEE_PROGRAM_MAX_BPS,
  DBC_TRANSFER_FEE_WITHHELD,
  TRANSFER_FEE_FLAG,
  TRANSFER_FEE_MAX_BPS,
  TRANSFER_FEE_NEW_RATE_EPOCHS,
  configTransferFeeProblems,
  mintTransferFeeProblems,
  transferFeeActions,
  transferFeeBpsProblems,
  transferFeeFormat,
  transferFeeOffered,
  transferFeeOn,
  transferFeeParametersOf,
  transferFeeParametersProblems,
  transferFeeTimeline,
} from "./transfer-fee.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const seeded = (byte) => Keypair.fromSeed(Buffer.alloc(32, byte));
const POOL_AUTHORITY = v2.deriveDbcPoolAuthority().toBase58();
const CREATOR = seeded(41).publicKey.toBase58();
const fixture = JSON.parse(readFileSync(new URL("../venues/meteora-dbc/fixtures/mainnet-dbc-accounts-2026-10-18.json", import.meta.url), "utf8"));
const ACCOUNTS = Object.fromEntries(Object.entries(fixture.accounts).map(([address, entry]) => [address, { owner: entry.owner, data: Buffer.from(entry.data, "base64") }]));
const WITH_FEE_BOUNDS = { ...DEVNET_ADVANCED_BOUNDS, transferFeeMaxBps: TRANSFER_FEE_MAX_BPS };

const withSdk = async (sdk, run) => {
  const before = process.env[DBC_SDK_FLAG];
  if (sdk === "2.0.0") process.env[DBC_SDK_FLAG] = "2";
  else delete process.env[DBC_SDK_FLAG];
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env[DBC_SDK_FLAG];
    else process.env[DBC_SDK_FLAG] = before;
  }
};

test("SOL-L10: the format is closed by default and opens only with its flag on SDK 2.0.0", () => {
  assert.equal(TRANSFER_FEE_FLAG, "RYNTRA_LAUNCH_TRANSFER_FEE");
  assert.equal(transferFeeOffered({}, "2.0.0"), false, "no flag — closed");
  assert.equal(transferFeeOffered({ [TRANSFER_FEE_FLAG]: "1" }, "2.0.0"), false, "only `open` opens it");
  assert.equal(transferFeeOffered({ [TRANSFER_FEE_FLAG]: "open" }, "1.5.13"), false, "1.5.13 has no createConfig2 and does not price the fee");
  assert.equal(transferFeeOffered({ [TRANSFER_FEE_FLAG]: " open " }, "2.0.0"), true);
  assert.equal(transferFeeFormat(false), null);
  assert.deepEqual(transferFeeFormat(true), { maxBps: 200, mode: "REVOKE_ZERO_FEE", withheldBy: "CREATOR", newRateEpochs: 2 });
});

test("SOL-L10: the cap is 2 % and the rule — RevokeZeroFee, the creator collects; Partner, Creator, Immutable and 0 bps refused", () => {
  assert.equal(TRANSFER_FEE_MAX_BPS, 200);
  assert.ok(TRANSFER_FEE_MAX_BPS <= DBC_TRANSFER_FEE_PROGRAM_MAX_BPS);
  assert.deepEqual(transferFeeBpsProblems(1), []);
  assert.deepEqual(transferFeeBpsProblems(200), []);
  assert.deepEqual(transferFeeBpsProblems(201), ["BPS_ABOVE_CAP"]);
  assert.deepEqual(transferFeeBpsProblems(0), ["BPS_ZERO"], "0 bps is not «no fee»: no fee is no parameters");
  assert.deepEqual(transferFeeBpsProblems(50.5), ["BPS_NOT_WHOLE"]);
  assert.deepEqual(transferFeeParametersOf(100), { transferFeeBasisPoints: 100, withheldAuthority: 1, migratedTransferFeeAuthorityOption: 1 });
  assert.throws(() => transferFeeParametersOf(0));
  assert.throws(() => transferFeeParametersOf(300));
  const ok = { transferFeeBasisPoints: 100, withheldAuthority: DBC_TRANSFER_FEE_WITHHELD.CREATOR, migratedTransferFeeAuthorityOption: DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.REVOKE_ZERO_FEE };
  assert.deepEqual(transferFeeParametersProblems(ok), []);
  assert.equal(transferFeeParametersProblems({ ...ok, withheldAuthority: DBC_TRANSFER_FEE_WITHHELD.PARTNER }).length, 1, "Partner never collects");
  for (const mode of ["PARTNER", "CREATOR", "IMMUTABLE"]) {
    assert.equal(transferFeeParametersProblems({ ...ok, migratedTransferFeeAuthorityOption: DBC_MIGRATED_TRANSFER_FEE_AUTHORITY[mode] }).length, 1, `${mode} only by the owner's own word`);
  }
  assert.deepEqual(configTransferFeeProblems(null), []);
  assert.deepEqual(configTransferFeeProblems({ flag: 0, bps: 0, withheldAuthority: 0, migratedAuthorityOption: 0 }), []);
  assert.equal(configTransferFeeProblems({ flag: 1, bps: 100, withheldAuthority: 0, migratedAuthorityOption: 3 }).length, 2);
});

test("SOL-L10: the mirror of the SDK's numbers holds against SDK 2.0.0", () => {
  assert.equal(DBC_TRANSFER_FEE_WITHHELD.PARTNER, v2.TransferFeeWithheldAuthority.Partner);
  assert.equal(DBC_TRANSFER_FEE_WITHHELD.CREATOR, v2.TransferFeeWithheldAuthority.Creator);
  assert.equal(DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.IMMUTABLE, v2.MigratedTransferFeeAuthorityOption.Immutable);
  assert.equal(DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.REVOKE_ZERO_FEE, v2.MigratedTransferFeeAuthorityOption.RevokeZeroFee);
  assert.equal(DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.CREATOR, v2.MigratedTransferFeeAuthorityOption.Creator);
  assert.equal(DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.PARTNER, v2.MigratedTransferFeeAuthorityOption.Partner);
  assert.equal(DBC_TRANSFER_FEE_PROGRAM_MAX_BPS, v2.MAX_BASE_TRANSFER_FEE_BPS);
  /* Ryntra's parameters pass the SDK's own check of them, the way the program checks them. */
  assert.doesNotThrow(() => v2.validateTransferFeeParameters(transferFeeParametersOf(200), 1));
});

test("SOL-L10: one transfer — gross, withheld rounded up, net — as the token program and the SDK count it", () => {
  assert.deepEqual(transferFeeOn(1_000_000n, 100), { grossRaw: 1_000_000n, withheldRaw: 10_000n, netRaw: 990_000n });
  assert.deepEqual(transferFeeOn(1n, 50), { grossRaw: 1n, withheldRaw: 1n, netRaw: 0n }, "a fraction of a unit is rounded up");
  assert.deepEqual(transferFeeOn(0n, 100), { grossRaw: 0n, withheldRaw: 0n, netRaw: 0n });
  assert.deepEqual(transferFeeOn(777n, 0), { grossRaw: 777n, withheldRaw: 0n, netRaw: 777n });
  for (const bps of [1, 50, 100, 200]) {
    for (const gross of [1n, 999n, 10_000n, 123_456_789n, 1_000_000_000_000_000n]) {
      /* A DBC base fee has no cap: the maximum fee is u64::MAX (`getBaseTransferFee` in the SDK). */
      const sdk = v2.calculateTransferFeeExcludedAmount({ transferFeeBasisPoints: bps, maximumFee: v2.U64_MAX }, new BN(gross.toString()));
      const ours = transferFeeOn(gross, bps);
      assert.equal(ours.netRaw.toString(), sdk.amount.toString(), `${bps} bps of ${gross}`);
      assert.equal(ours.withheldRaw.toString(), sdk.transferFee.toString(), `${bps} bps of ${gross}`);
    }
  }
});

const mintFee = (over = {}) => ({ olderBps: 100, olderEpoch: "800", newerBps: 100, newerEpoch: "800", configAuthority: POOL_AUTHORITY, withdrawAuthority: CREATOR, withheldOnMintRaw: "0", ...over });

test("SOL-L10: the RevokeZeroFee timeline by epoch — on the curve, 0 % scheduled at the DEX, 0 % with no authority", () => {
  const args = { curveBps: 100, poolAuthority: POOL_AUTHORITY };
  assert.deepEqual(transferFeeTimeline(mintFee(), { ...args, epoch: 810n, migrated: false }), { phase: "CURVE", bpsNow: 100, curveBps: 100, zeroFromEpoch: null, authorityLive: true });
  const moved = mintFee({ newerBps: 0, newerEpoch: String(820 + TRANSFER_FEE_NEW_RATE_EPOCHS), configAuthority: null });
  assert.deepEqual(transferFeeTimeline(moved, { ...args, epoch: 820n, migrated: true }), { phase: "ZERO_SCHEDULED", bpsNow: 100, curveBps: 100, zeroFromEpoch: "822", authorityLive: false });
  assert.deepEqual(transferFeeTimeline(moved, { ...args, epoch: 822n, migrated: true }), { phase: "ZERO", bpsNow: 0, curveBps: 100, zeroFromEpoch: "822", authorityLive: false });
  /* Anything else is outside the rule: a rate changed on the curve, an authority someone else holds, a fee kept after the DEX. */
  assert.equal(transferFeeTimeline(mintFee({ newerBps: 150, newerEpoch: "812" }), { ...args, epoch: 812n, migrated: false }).phase, "OUTSIDE_RULE");
  assert.equal(transferFeeTimeline(mintFee({ configAuthority: CREATOR }), { ...args, epoch: 810n, migrated: false }).phase, "OUTSIDE_RULE");
  assert.equal(transferFeeTimeline(mintFee({ configAuthority: CREATOR }), { ...args, epoch: 830n, migrated: true }).phase, "OUTSIDE_RULE");
  assert.equal(transferFeeTimeline(mintFee({ configAuthority: null }), { ...args, epoch: 830n, migrated: true }).phase, "OUTSIDE_RULE", "after the DEX the rate must be scheduled to 0");
  const judged = { ...args, creator: CREATOR, epoch: 810n, migrated: false };
  assert.deepEqual(mintTransferFeeProblems(mintFee(), judged), []);
  assert.equal(mintTransferFeeProblems(mintFee({ withdrawAuthority: seeded(42).publicKey.toBase58() }), judged).length, 1, "the withheld is the creator's");
  assert.equal(mintTransferFeeProblems(mintFee({ olderBps: 200, newerBps: 200 }), judged).length, 2, "the rate is the config's");
});

test("SOL-L10: the cycle's steps — harvest while holders' accounts hold some, withdraw while the mint does", () => {
  assert.deepEqual(transferFeeActions({ inAccountsRaw: "0", accountsWithWithheld: 0, onMintRaw: "0", withdrawnRaw: "0" }), { harvest: false, withdraw: false });
  assert.deepEqual(transferFeeActions({ inAccountsRaw: "10", accountsWithWithheld: 2, onMintRaw: "0", withdrawnRaw: "0" }), { harvest: true, withdraw: false });
  assert.deepEqual(transferFeeActions({ inAccountsRaw: null, accountsWithWithheld: null, onMintRaw: "5", withdrawnRaw: "0" }), { harvest: false, withdraw: true }, "accounts not read: no harvest offered");
});

test("SOL-L10: Quick Launch and every preset carry no transfer fee — not even 0 bps", () => {
  for (const id of Object.keys(LAUNCH_PRESETS)) assert.equal(LAUNCH_PRESETS[id].transferFeeBps, undefined, id);
  for (const id of PEOPLE_PRESET_IDS) assert.equal("transferFeeParameters" in presetCurve(LAUNCH_PRESETS[id], { mint: USDC, decimals: 6, usdPrice: id === "community" ? 0.01 : 1 }), false, id);
  /* «Розширений» without a rate: the same — no field. */
  assert.equal(advancedPreset(ADVANCED_DEFAULT_CHOICE, WITH_FEE_BOUNDS).transferFeeBps, undefined);
  assert.equal(advancedChoiceOf({ ...ADVANCED_DEFAULT_CHOICE, transferFeeBps: 0 }).transferFeeBps, undefined, "0 is none");
});

test("SOL-L10: «Розширений» takes a rate only where the bounds offer it, within the cap", () => {
  const choice = { ...ADVANCED_DEFAULT_CHOICE, transferFeeBps: 100 };
  assert.deepEqual(advancedProblems(choice, DEVNET_ADVANCED_BOUNDS), ["TRANSFER_FEE"], "not offered without the flag");
  assert.deepEqual(advancedProblems(choice, WITH_FEE_BOUNDS), []);
  assert.deepEqual(advancedProblems({ ...choice, transferFeeBps: 201 }, WITH_FEE_BOUNDS), ["TRANSFER_FEE"]);
  assert.deepEqual(advancedProblems({ ...choice, transferFeeBps: 12.5 }, WITH_FEE_BOUNDS), ["TRANSFER_FEE"]);
  assert.equal(advancedPreset(choice, WITH_FEE_BOUNDS).transferFeeBps, 100);
  assert.deepEqual(advancedChoiceOf({ ...choice }), choice);
  assert.equal(advancedChoiceOf({ ...choice, transferFeeBps: "100" }), null);
});

test("SOL-L10: the transfer-fee config keeps «Чесний лаунч» and the program's restrictions — fixed supply, no vesting, Customizable, Compounding", () => {
  const preset = advancedPreset({ ...ADVANCED_DEFAULT_CHOICE, transferFeeBps: 200 }, WITH_FEE_BOUNDS);
  const curve = presetCurve(preset, { mint: USDC, decimals: 6, usdPrice: 1 }, "2.0.0");
  assert.equal(curve.tokenSupply.preMigrationTokenSupply.toString(), curve.tokenSupply.postMigrationTokenSupply.toString());
  assert.equal(curve.lockedVesting.amountPerPeriod.toString(), "0");
  assert.equal(curve.migrationFeeOption, 6);
  assert.equal(curve.migratedPoolFee.collectFeeMode, 2);
  assert.doesNotThrow(() => v2.validateConfigParameters({ ...curve, leftoverReceiver: seeded(9).publicKey }, { transferFeeParameters: transferFeeParametersOf(200), feeClaimer: seeded(9).publicKey }));
});

test("SOL-L10: buildConfig on 2.0.0 sends create_config2 with exactly Ryntra's parameters; on 1.5.13 it builds nothing", async () => {
  const preset = advancedPreset({ ...ADVANCED_DEFAULT_CHOICE, transferFeeBps: 150 }, WITH_FEE_BOUNDS);
  const args = { preset: "advanced", custom: preset, quote: { mint: USDC, decimals: 6, usdPrice: 1 }, feeClaimer: seeded(31).publicKey.toBase58(), leftoverReceiver: seeded(31).publicKey.toBase58(), payer: CREATOR, configKey: seeded(32) };
  const built = await withSdk("2.0.0", () => createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs }).buildConfig(args));
  const ix = Transaction.from(Buffer.from(built.wireBase64, "base64")).instructions.find((entry) => entry.programId.equals(v2.DYNAMIC_BONDING_CURVE_PROGRAM_ID));
  const decoded = new BorshInstructionCoder(v2.DynamicBondingCurveIdl).decode(ix.data);
  assert.equal(decoded.name, "create_config2");
  assert.deepEqual(plainValue(decoded.data.transfer_fee_parameters), { transfer_fee_basis_points: 150, withheld_authority: 1, migrated_transfer_fee_authority_option: 1 });
  assert.deepEqual(built.fields.transferFee, { flag: 1, bps: 150, withheldAuthority: 1, migratedAuthorityOption: 1 });
  assert.deepEqual(honestLaunchProblems(built.fields), []);
  /* Without a rate on 2.0.0: no parameters at all. */
  const plain = await withSdk("2.0.0", () => createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs }).buildConfig({ ...args, custom: advancedPreset(ADVANCED_DEFAULT_CHOICE, WITH_FEE_BOUNDS), configKey: seeded(33) }));
  const plainIx = Transaction.from(Buffer.from(plain.wireBase64, "base64")).instructions.find((entry) => entry.programId.equals(v2.DYNAMIC_BONDING_CURVE_PROGRAM_ID));
  assert.equal(new BorshInstructionCoder(v2.DynamicBondingCurveIdl).decode(plainIx.data).data.transfer_fee_parameters, null);
  /* 1.5.13 never builds a transfer fee. */
  await withSdk("1.5.13", () => assert.rejects(() => createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs }).buildConfig({ ...args, configKey: seeded(34) }), /SDK 2\.0\.0/));
});

test("SOL-L10: the SDK adapter refuses parameters outside the rule before a byte is built", async () => {
  const client = createDbcClient(fixtureConnection(ACCOUNTS).connection, "2.0.0");
  const curve = presetCurve(advancedPreset(ADVANCED_DEFAULT_CHOICE, WITH_FEE_BOUNDS), { mint: USDC, decimals: 6, usdPrice: 1 }, "2.0.0");
  const base = { config: seeded(35).publicKey, payer: seeded(36).publicKey, feeClaimer: seeded(36).publicKey, leftoverReceiver: seeded(36).publicKey, quoteMint: USDC, ...curve };
  for (const params of [
    { transferFeeBasisPoints: 100, withheldAuthority: 0, migratedTransferFeeAuthorityOption: 1 },
    { transferFeeBasisPoints: 100, withheldAuthority: 1, migratedTransferFeeAuthorityOption: 3 },
    { transferFeeBasisPoints: 100, withheldAuthority: 1, migratedTransferFeeAuthorityOption: 0 },
    { transferFeeBasisPoints: 0, withheldAuthority: 1, migratedTransferFeeAuthorityOption: 1 },
    { transferFeeBasisPoints: 500, withheldAuthority: 1, migratedTransferFeeAuthorityOption: 1 },
  ]) {
    assert.throws(() => client.partner.createConfig({ ...base, transferFeeParameters: params }), /outside Ryntra's rule/, JSON.stringify(params));
  }
  const legacy = createDbcClient(fixtureConnection(ACCOUNTS).connection, "1.5.13");
  assert.throws(() => legacy.partner.createConfig({ ...base, transferFeeParameters: transferFeeParametersOf(100) }), /SDK 2\.0\.0/);
});

/* ------------------------------------------------------------ the receipt */

const TOKEN = seeded(51).publicKey.toBase58();
const observation = (over = {}) => ({
  token: TOKEN,
  pool: seeded(52).publicKey.toBase58(),
  config: seeded(53).publicKey.toBase58(),
  preset: "advanced",
  configSupplyRaw: "1000000000000000",
  configProblems: [],
  configTransferFee: { flag: 1, bps: 100, withheldAuthority: 1, migratedAuthorityOption: 1 },
  transferFee: { mint: mintFee(), epoch: "810", poolAuthority: POOL_AUTHORITY },
  creator: CREATOR,
  feeSharing: null,
  mint: {
    program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    supplyRaw: "1000000000000000",
    decimals: 6,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: ["TransferFeeConfig", "MetadataPointer", "TokenMetadata"],
    transferHookProgram: null,
    metadataPointerAuthority: null,
    metadataPointerAddress: TOKEN,
    metadataRead: "OK",
    metadataUpdateAuthority: null,
    name: "Fee",
    symbol: "FEE",
    uri: null,
  },
  curve: { quoteReserveRaw: "0", baseReserveRaw: "0", migrationQuoteThresholdRaw: "1", progressBps: 0, migrated: false },
  graduated: null,
  ...over,
});

test("SOL-L10: a TransferFeeConfig mint is a Ryntra launch only on a «Розширений» config that set it under the rule", () => {
  assert.deepEqual(launchObservationProblems(observation()), []);
  assert.ok(launchObservationProblems(observation({ preset: "classic" })).some((line) => line.includes("TransferFeeConfig")), "never on a preset");
  assert.ok(launchObservationProblems(observation({ configTransferFee: null })).some((line) => line.includes("TransferFeeConfig")), "a mint fee the config did not set");
  assert.ok(launchObservationProblems(observation({ mint: { ...observation().mint, extensions: ["MetadataPointer", "TokenMetadata"] } })).includes("the config sets a transfer fee the mint does not carry"));
  const creation = { creator: CREATOR, failed: false, initialized: null, signers: [], feePayer: "", creatorTokensOutRaw: "0" };
  const lines = launchCreationProblems(observation({ transferFee: { mint: mintFee({ withdrawAuthority: seeded(43).publicKey.toBase58() }), epoch: "810", poolAuthority: POOL_AUTHORITY } }), creation, "payer");
  assert.ok(lines.includes("the withheld transfer fee is not the creator's to withdraw"));
});

test("SOL-L10: a market's rules say the transfer fee with its rate in place of «no rule on transfers»", () => {
  const rules = marketRules({
    migrated: false,
    tokenMarks: [{ code: "TRANSFER_FEE_UNTIL_DEX", account: TOKEN }],
    transferFeeBps: 100,
    config: "c",
    curve: "p",
    launchSignature: "s",
    thresholdRaw: "1",
    lockedPositions: [],
    creatorLock: null,
    feeVault: null,
    firstBuyCapBps: null,
    executor: null,
    ladderPool: null,
    concentrationRead: false,
    creatorSalesRead: false,
    now: 0,
  });
  const fee = rules.find((rule) => rule.code === "TRANSFER_FEE_UNTIL_DEX");
  assert.deepEqual(fee, { code: "TRANSFER_FEE_UNTIL_DEX", enforcement: "rule", by: "token-2022", source: { kind: "account", id: TOKEN }, values: { bps: 100 } });
  assert.equal(rules.some((rule) => rule.code === "NO_TRANSFER_HOOK"), false);
});

test("SOL-L10: a fresh curve's first buy names its rate — the SDK nets it as the token program does; without it, it sees no fee", async () => {
  /* `create` passes the launch's rate to the quote and holds `minimum_amount_out` to the net (the program checks the net). */
  const client = createDbcClient(fixtureConnection(ACCOUNTS).connection, "2.0.0");
  const config = await client.state.getPoolConfig(fixture.configs.micro);
  const amountIn = new BN(1_000_000);
  const plain = client.pool.getQuoteFromInputAmount({ config, swapBaseForQuote: false, amountIn, eligibleForFirstSwapWithMinFee: true, slippageBps: 0 });
  const named = client.pool.getQuoteFromInputAmount({ config, swapBaseForQuote: false, amountIn, eligibleForFirstSwapWithMinFee: true, slippageBps: 0, baseTransferFeeBasisPoints: 100 });
  assert.equal(named.outputAmount.toString(), plain.outputAmount.toString(), "the curve's output is the same");
  assert.equal(plain.excludedTransferFeeAmountOut.toString(), plain.outputAmount.toString(), "a fresh curve's quote takes no fee from the config");
  assert.equal(named.excludedTransferFeeAmountOut.toString(), transferFeeOn(BigInt(named.outputAmount.toString()), 100).netRaw.toString());
});
