/**
 * SOL-L9: Meteora DBC SDK 1.5.13 and 2.0.0 side by side on the same accounts — mainnet's preset configs and curves as
 * the audit of 18.10 read them (`./fixtures/mainnet-dbc-accounts-2026-10-18.json`, written by
 * `scripts/launch-qa/dbc-sdk-fixtures.mjs`), and curves made from them at every stage of a launch. Quotes,
 * transaction builds and the events receipts read must be the same on both; a new config is the one place 2.0.0
 * differs (`createConfig2` and its curve builders), and that difference is bounded here. No network is reached.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BorshEventCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
import * as v1 from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as v2 from "@meteora-ag/dynamic-bonding-curve-sdk-v2";
import { getBase58Decoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionMessage, Transaction } from "@solana/web3.js";
import BN from "bn.js";

import { EXECUTOR_INSTRUCTIONS, executorSigningRefusal } from "../../../launch/executor-signing.server.ts";
import { dbcClientOf } from "../meteora-clients.server.ts";
import { observeCreatorClaim } from "./claim.server.ts";
import { createMeteoraDbcLaunchVenue, presetCurve } from "./launch.server.ts";
import { LAUNCH_PRESETS } from "./presets.ts";
import { DBC_SDK_FLAG, createDbcClient, dbcCurveBuilders, dbcSdkOf } from "./sdk.server.ts";
import { encodeAccount, fixtureConnection, plainInstruction, plainValue, typedFromPlain } from "./sdk-compare-kit.mjs";
import { createLaunchTradeVenue } from "./trade.server.ts";

const SDKS = ["1.5.13", "2.0.0"];
const fixture = JSON.parse(readFileSync(new URL("./fixtures/mainnet-dbc-accounts-2026-10-18.json", import.meta.url), "utf8"));
const PROGRAM = v1.DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58();
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const U64_MAX = new BN("18446744073709551615");
const seeded = (byte) => Keypair.fromSeed(Buffer.alloc(32, byte));
/* A throwaway wallet that trades, pays and receives in the builds. */
const WALLET = seeded(222).publicKey;
const withFlag = async (sdk, run) => {
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

/* The accounts: the fixture's, and — built from them below — a curve at every stage on each preset's config. */
const ACCOUNTS = Object.fromEntries(Object.entries(fixture.accounts).map(([address, entry]) => [address, { owner: entry.owner, data: Buffer.from(entry.data, "base64") }]));
const legacy = createDbcClient(fixtureConnection(ACCOUNTS).connection, "1.5.13");
const template = plainValue((await legacy.state.getPool(fixture.pools[0].address)).poolState);
const CONFIG_STATES = Object.fromEntries(await Promise.all(Object.entries(fixture.configs).map(async ([preset, address]) => [preset, await legacy.state.getPoolConfig(address)])));

/** A curve on `preset`'s config at `stage`, its account written into ACCOUNTS; returns its address and base mint. */
async function stagedCurve(preset, stage, byte) {
  const config = CONFIG_STATES[preset];
  const threshold = BigInt(config.migrationQuoteThreshold.toString());
  const baseMint = seeded(byte).publicKey;
  const activation = 1_791_300_000;
  const fresh = { ...template, config: fixture.configs[preset], baseMint: baseMint.toBase58(), sqrtPrice: config.sqrtStartPrice.toString(), quoteReserve: "0", activationPoint: String(activation), isMigrated: 0, hasSwap: 0, protocolQuoteFee: "0", partnerQuoteFee: "0", creatorQuoteFee: "0", volatilityTracker: { lastUpdateTimestamp: String(activation), sqrtPriceReference: config.sqrtStartPrice.toString(), volatilityAccumulator: "0", volatilityReference: "0" } };
  const address = seeded(byte + 100).publicKey.toBase58();
  const write = (poolState) => (ACCOUNTS[address] = { owner: PROGRAM, data: encodeAccount(v1.DynamicBondingCurveIdl, "VirtualPool", { poolState }) });
  write(fresh);
  let state = fresh;
  if (stage === "mid" || stage === "near") {
    /* The curve after a buy of a tenth — or all but a dollar — of what it raises, as the program would leave it. */
    const spend = stage === "mid" ? threshold / 10n : threshold - 1_000_000n;
    const quote = legacy.pool.swapQuote2({ virtualPool: await legacy.state.getPool(address), config, swapBaseForQuote: false, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(activation + 3_600), swapMode: v1.SwapMode.ExactIn, amountIn: new BN(spend.toString()) });
    state = { ...fresh, sqrtPrice: quote.nextSqrtPrice.toString(), quoteReserve: quote.excludedFeeInputAmount.toString(), hasSwap: 1, partnerQuoteFee: quote.tradingFee.divn(2).toString(), creatorQuoteFee: quote.tradingFee.divn(2).toString(), protocolQuoteFee: quote.protocolFee.toString(), volatilityTracker: { lastUpdateTimestamp: String(activation + 3_600), sqrtPriceReference: config.sqrtStartPrice.toString(), volatilityAccumulator: "90000", volatilityReference: "0" } };
  }
  if (stage === "full") state = { ...fresh, sqrtPrice: config.migrationSqrtPrice.toString(), quoteReserve: threshold.toString(), hasSwap: 1, partnerQuoteFee: "1000000", creatorQuoteFee: "1000000" };
  write(state);
  ACCOUNTS[baseMint.toBase58()] = { owner: TOKEN_2022_PROGRAM_ID.toBase58(), data: ACCOUNTS[template.baseMint].data };
  return { preset, stage, address, baseMint: baseMint.toBase58(), activation };
}

const STAGED = [];
let byte = 1;
for (const preset of Object.keys(fixture.configs)) for (const stage of ["fresh", "mid", "near", "full"]) STAGED.push(await stagedCurve(preset, stage, byte++));
const REAL = fixture.pools.map((pool) => ({ preset: pool.preset, stage: pool.migrated ? "migrated" : "real", address: pool.address }));
const CURVES = [...REAL, ...STAGED];
const clients = () => {
  const { connection, asked } = fixtureConnection(ACCOUNTS);
  return { connection, asked, by: Object.fromEntries(SDKS.map((sdk) => [sdk, createDbcClient(connection, sdk)])) };
};

/** Each SDK's answer — or its refusal — to the same call, as plain data. */
async function both(call) {
  const { by } = clients();
  const out = {};
  for (const sdk of SDKS) {
    try {
      out[sdk] = { value: plainValue(await call(by[sdk], sdk)) };
    } catch (error) {
      out[sdk] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return out;
}

test("the flag: 1.5.13 unless it says 2 — a rollback is the flag removed", () => {
  assert.equal(dbcSdkOf({}), "1.5.13");
  assert.equal(dbcSdkOf({ [DBC_SDK_FLAG]: "" }), "1.5.13");
  for (const other of ["1", "true", "on", "2.0", "v2", "two"]) assert.equal(dbcSdkOf({ [DBC_SDK_FLAG]: other }), "1.5.13", other);
  assert.equal(dbcSdkOf({ [DBC_SDK_FLAG]: "2" }), "2.0.0");
  assert.equal(dbcSdkOf({ [DBC_SDK_FLAG]: " 2 " }), "2.0.0");
  const { connection } = fixtureConnection({});
  assert.equal(dbcClientOf(connection).sdk, dbcSdkOf());
  assert.equal(dbcClientOf(connection, "2.0.0").sdk, "2.0.0");
  assert.equal(dbcClientOf(connection, "2.0.0"), dbcClientOf(connection, "2.0.0"), "one client per connection and version");
  assert.notEqual(dbcClientOf(connection, "2.0.0"), dbcClientOf(connection, "1.5.13"));
});

test("both versions are pinned exactly, and only the 2.0.0 alias was added", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies["@meteora-ag/dynamic-bonding-curve-sdk"], "1.5.13");
  assert.equal(manifest.dependencies["@meteora-ag/dynamic-bonding-curve-sdk-v2"], "npm:@meteora-ag/dynamic-bonding-curve-sdk@2.0.0");
  const installed = (name) => JSON.parse(readFileSync(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
  assert.equal(installed("@meteora-ag/dynamic-bonding-curve-sdk"), "1.5.13");
  assert.equal(installed("@meteora-ag/dynamic-bonding-curve-sdk-v2"), "2.0.0");
  const lock = JSON.parse(readFileSync(new URL("../../../../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.packages["node_modules/@meteora-ag/dynamic-bonding-curve-sdk-v2"].version, "2.0.0");
  assert.match(lock.packages["node_modules/@meteora-ag/dynamic-bonding-curve-sdk-v2"].integrity, /^sha512-/);
});

test("the constants, enums and addresses Ryntra imports from 1.5.13 are 2.0.0's own", () => {
  assert.equal(v2.DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), PROGRAM);
  assert.deepEqual(plainValue(v2.DAMM_V2_MIGRATION_FEE_ADDRESS), plainValue(v1.DAMM_V2_MIGRATION_FEE_ADDRESS));
  for (const name of ["SwapMode", "TokenType", "TokenAuthorityOption", "BaseFeeMode", "CollectFeeMode", "MigrationOption", "MigrationFeeOption", "MigratedCollectFeeMode", "DammV2BaseFeeMode", "ActivationType"]) {
    assert.deepEqual({ ...v2[name] }, { ...v1[name] }, name);
  }
  assert.equal(v2.deriveDbcPoolAuthority().toBase58(), v1.deriveDbcPoolAuthority().toBase58());
  assert.equal(v2.deriveDbcEventAuthority().toBase58(), v1.deriveDbcEventAuthority().toBase58());
  for (const [preset, address] of Object.entries(fixture.configs)) {
    const mint = seeded(200).publicKey;
    const config = new PublicKey(address);
    assert.equal(v2.deriveDbcPoolAddress(new PublicKey(USDC), mint, config).toBase58(), v1.deriveDbcPoolAddress(new PublicKey(USDC), mint, config).toBase58(), preset);
    assert.equal(v2.deriveDbcTokenVaultAddress(config, mint).toBase58(), v1.deriveDbcTokenVaultAddress(config, mint).toBase58(), preset);
    const damm = v1.DAMM_V2_MIGRATION_FEE_ADDRESS[CONFIG_STATES[preset].migrationFeeOption];
    assert.equal(v2.deriveDammV2PoolAddress(damm, mint, new PublicKey(USDC)).toBase58(), v1.deriveDammV2PoolAddress(damm, mint, new PublicKey(USDC)).toBase58(), preset);
  }
});

test("the IDL: every instruction Ryntra builds or the executor signs, and every account it reads, is the same in 0.2.2", () => {
  const without = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value, (key, inner) => (key === "docs" ? undefined : inner))));
  const shape = (idl, name) => without(idl.instructions.find((entry) => entry.name === name));
  const built = ["swap2", "initialize_virtual_pool_with_token2022", "claim_trading_fee", "claim_creator_trading_fee", "withdraw_migration_fee", "partner_withdraw_surplus", "migration_damm_v2", "transfer_pool_creator", "create_config"];
  for (const name of new Set([...built, ...EXECUTOR_INSTRUCTIONS.dbc])) {
    assert.ok(shape(v1.DynamicBondingCurveIdl, name), name);
    assert.deepEqual(shape(v2.DynamicBondingCurveIdl, name), shape(v1.DynamicBondingCurveIdl, name), name);
  }
  /* The rewards line reads claims by these discriminators (`lib/growth/pool-share.ts`). */
  const hex = (idl, name) => Buffer.from(idl.instructions.find((entry) => entry.name === name).discriminator).toString("hex");
  assert.equal(hex(v2.DynamicBondingCurveIdl, "claim_trading_fee"), "08ec5931987db151");
  assert.equal(hex(v2.DynamicBondingCurveIdl, "claim_trading_fee2"), "54bf473209a237c1");
  /* 0.2.2 adds `create_config2` and nothing Ryntra reads goes away. */
  assert.ok(shape(v2.DynamicBondingCurveIdl, "create_config2"));
  assert.ok(!shape(v1.DynamicBondingCurveIdl, "create_config2"));
});

test("the accounts decode the same: every field 1.5.13 names, and 2.0.0's new ones say a legacy config with no transfer fee", async () => {
  const out = [];
  for (const [preset, address] of Object.entries(fixture.configs)) {
    const result = await both((client) => client.state.getPoolConfig(address));
    const [a, b] = SDKS.map((sdk) => result[sdk].value);
    for (const [key, value] of Object.entries(a)) {
      if (/^padding/i.test(key)) continue;
      assert.deepEqual(b[key], value, `${preset}.${key}`);
    }
    /* The fixture is re-encoded with padding as zeros, so these two hold by its making; the live pass reads real bytes. */
    assert.equal(b.version, 0, `${preset}: a 1.5.13 config is version 0`);
    assert.equal(b.transferFeeFlag ?? 0, 0, preset);
    out.push(preset);
  }
  for (const curve of CURVES) {
    const result = await both((client) => client.state.getPool(curve.address));
    assert.deepEqual(result["2.0.0"], result["1.5.13"], curve.address);
  }
  assert.deepEqual(out, ["classic", "protected", "micro", "demo"]);
});

/* The trades a page quotes: buys that fill or overfill the curve, sells, exact outputs, with and without Ryntra's referral. */
function quoteCases(threshold) {
  const buy = [1n, 1_000n, 1_000_000n, 25_000_000n, threshold / 3n, threshold * 2n];
  const sell = [1n, 1_000_000n, 1_000_000_000_000n, 50_000_000_000_000n];
  return [
    ...buy.map((amount) => ({ swapBaseForQuote: false, swapMode: v1.SwapMode.PartialFill, amountIn: amount })),
    ...buy.slice(0, 4).map((amount) => ({ swapBaseForQuote: false, swapMode: v1.SwapMode.ExactIn, amountIn: amount })),
    ...sell.map((amount) => ({ swapBaseForQuote: true, swapMode: v1.SwapMode.ExactIn, amountIn: amount })),
    { swapBaseForQuote: false, swapMode: v1.SwapMode.ExactOut, amountOut: 1_000_000_000_000n },
  ];
}

test("quotes: every curve, every stage, every kind of trade, at the sniper fee's start and long after — the same numbers", async () => {
  let compared = 0;
  for (const curve of CURVES) {
    if (curve.stage === "migrated") continue;
    const { by } = clients();
    const accounts = {};
    for (const sdk of SDKS) {
      const pool = await by[sdk].state.getPool(curve.address);
      accounts[sdk] = { pool, config: await by[sdk].state.getPoolConfig(pool.poolState.config) };
    }
    const threshold = BigInt(CONFIG_STATES[curve.preset].migrationQuoteThreshold.toString());
    const activation = Number(accounts["1.5.13"].pool.poolState.activationPoint.toString());
    for (const point of [activation, activation + 10, activation + 3_600, activation + 30 * 86_400]) {
      for (const hasReferral of [false, true]) {
        for (const trade of quoteCases(threshold)) {
          const results = {};
          for (const sdk of SDKS) {
            try {
              const amount = trade.amountIn !== undefined ? { amountIn: new BN(trade.amountIn.toString()) } : { amountOut: new BN(trade.amountOut.toString()) };
              results[sdk] = { value: plainValue(by[sdk].pool.swapQuote2({ virtualPool: accounts[sdk].pool, config: accounts[sdk].config, swapBaseForQuote: trade.swapBaseForQuote, hasReferral, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(point), swapMode: trade.swapMode, ...amount })) };
            } catch (error) {
              results[sdk] = { error: error.message };
            }
          }
          const label = `${curve.preset}/${curve.stage} at +${point - activation}s ${JSON.stringify({ ...trade, amountIn: trade.amountIn?.toString(), amountOut: trade.amountOut?.toString(), hasReferral })}`;
          if ("error" in results["1.5.13"]) {
            /* What 1.5.13 refuses, 2.0.0 refuses too — its words are the program's own (`ProgramError`). */
            assert.ok("error" in results["2.0.0"], `${label}: 1.5.13 refused (${results["1.5.13"].error}), 2.0.0 quoted`);
            continue;
          }
          assert.ok(!("error" in results["2.0.0"]), `${label}: 2.0.0 refused (${results["2.0.0"]?.error})`);
          const { includedTransferFeeAmountIn, excludedTransferFeeAmountOut, ...rest } = results["2.0.0"].value;
          assert.deepEqual(rest, results["1.5.13"].value, label);
          /* No transfer fee on these mints: what leaves the wallet and what reaches it are the quote's own amounts. */
          assert.equal(excludedTransferFeeAmountOut, rest.outputAmount, label);
          assert.ok(includedTransferFeeAmountIn === rest.includedFeeInputAmount || includedTransferFeeAmountIn === (trade.amountIn ?? 0n).toString(), label);
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 1_500, `compared ${compared} quotes`);
});

/** The same quote on both, or a refusal on both (2.0.0 words it as the program does); 2.0.0's transfer-fee fields aside. */
function sameQuote(label, result) {
  if ("error" in result["1.5.13"]) {
    assert.ok("error" in result["2.0.0"], `${label}: 1.5.13 refused (${result["1.5.13"].error}), 2.0.0 quoted`);
    return;
  }
  assert.ok(!("error" in result["2.0.0"]), `${label}: 2.0.0 refused (${result["2.0.0"].error})`);
  const { includedTransferFeeAmountIn: _in, excludedTransferFeeAmountOut: _out, ...rest } = result["2.0.0"].value;
  assert.deepEqual(rest, result["1.5.13"].value, label);
}

test("the first buy on a fresh curve — the creator's cap and the most they may spend — quotes the same", async () => {
  for (const [preset, address] of Object.entries(fixture.configs)) {
    for (const amount of [1n, 1_000_000n, 100_000_000n, 5_000_000_000n]) {
      const input = await both(async (client) => client.pool.getQuoteFromInputAmount({ config: await client.state.getPoolConfig(address), swapBaseForQuote: false, amountIn: new BN(amount.toString()), eligibleForFirstSwapWithMinFee: true, slippageBps: 0 }));
      sameQuote(`${preset} in ${amount}`, input);
    }
    const output = await both(async (client) => client.pool.getQuoteFromOutputAmount({ config: await client.state.getPoolConfig(address), swapBaseForQuote: false, amountOut: new BN("50000000000000"), eligibleForFirstSwapWithMinFee: true, slippageBps: 0 }));
    sameQuote(`${preset} out`, output);
  }
  /* And through the venue, under the flag: the review's numbers. */
  const quotes = {};
  for (const sdk of SDKS) {
    quotes[sdk] = await withFlag(sdk, async () => {
      const venue = createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs });
      return Promise.all(["classic", "protected", "micro", "demo"].map((preset) => venue.firstBuyQuote(preset, "25000000")));
    });
  }
  assert.deepEqual(quotes["2.0.0"], quotes["1.5.13"]);
});

const sameBuild = (label, result, normalize = (list) => list) => {
  assert.ok(!("error" in result["1.5.13"]), `${label}: 1.5.13 ${result["1.5.13"].error}`);
  assert.ok(!("error" in result["2.0.0"]), `${label}: 2.0.0 ${result["2.0.0"].error}`);
  assert.deepEqual(normalize(result["2.0.0"].value), normalize(result["1.5.13"].value), label);
};
const instructionsOf = (tx) => tx.instructions.map(plainInstruction);

test("builds: a buy and a sale on every curve, with and without the referral account — the same instructions", async () => {
  const referral = getAssociatedTokenAddressSync(new PublicKey(USDC), seeded(250).publicKey, true, TOKEN_PROGRAM_ID);
  for (const curve of CURVES.filter((entry) => entry.stage !== "migrated" && entry.stage !== "full")) {
    for (const referralTokenAccount of [null, referral]) {
      for (const [swapBaseForQuote, swapMode, amount] of [[false, v1.SwapMode.PartialFill, 25_000_000], [true, v1.SwapMode.ExactIn, 1_000_000_000_000], [false, v1.SwapMode.ExactIn, 1_000_000]]) {
        const result = await both(async (client) => instructionsOf(await client.pool.swap2({ owner: WALLET, payer: WALLET, pool: new PublicKey(curve.address), swapBaseForQuote, referralTokenAccount, swapMode, amountIn: new BN(amount), minimumAmountOut: new BN(1) })));
        sameBuild(`${curve.preset}/${curve.stage} ${swapBaseForQuote ? "sell" : "buy"} ${swapMode} ${referralTokenAccount ? "referral" : ""}`, result);
      }
    }
  }
});

test("builds: a launch with and without the creator's first buy on every preset's config — the same instructions", async () => {
  const mint = seeded(240);
  for (const [preset, address] of Object.entries(fixture.configs)) {
    const createPoolParam = { name: "Lower Wick", symbol: "WICK", uri: "https://ryntra.io/api/launch/metadata/x", payer: WALLET, poolCreator: seeded(241).publicKey, config: new PublicKey(address), baseMint: mint.publicKey };
    sameBuild(`${preset} create`, await both(async (client) => instructionsOf(await client.creator.createPool(createPoolParam))));
    sameBuild(
      `${preset} create with first buy`,
      await both(async (client) => instructionsOf(await client.creator.createPoolWithFirstBuy({ createPoolParam, firstBuyParam: { buyer: createPoolParam.poolCreator, receiver: createPoolParam.poolCreator, buyAmount: new BN(25_000_000), minimumAmountOut: new BN(1), referralTokenAccount: null } }))),
    );
  }
});

test("builds: the partner's and the creator's claims, graduation fees, surplus, the move to DAMM v2 and the creator handover — the same", async () => {
  for (const curve of CURVES.filter((entry) => entry.stage === "real" || entry.stage === "mid" || entry.stage === "full")) {
    const config = CONFIG_STATES[curve.preset];
    const pool = new PublicKey(curve.address);
    const creator = new PublicKey(plainValue((await legacy.state.getPool(curve.address)).poolState.creator));
    sameBuild(`${curve.preset}/${curve.stage} partner claim`, await both(async (client) => instructionsOf(await client.partner.claimPartnerTradingFee({ feeClaimer: config.feeClaimer, payer: config.feeClaimer, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX }))));
    sameBuild(`${curve.preset}/${curve.stage} creator claim`, await both(async (client) => instructionsOf(await client.creator.claimCreatorTradingFee({ creator, payer: creator, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX }))));
    sameBuild(
      `${curve.preset}/${curve.stage} creator handover`,
      await both(async (client) => [plainInstruction(await client.state.program.methods.transferPoolCreator().accountsPartial({ virtualPool: pool, config: new PublicKey(fixture.configs[curve.preset]), creator, newCreator: seeded(242).publicKey }).instruction())]),
    );
    if (curve.stage === "full") {
      /* The position NFTs are fresh keys each build: both builds draw the same two, so their positions match too. */
      const result = await both(async (client) => {
        const generate = Keypair.generate;
        let drawn = 0;
        Keypair.generate = () => seeded(243 + drawn++);
        try {
          const built = await client.migration.migrateToDammV2({ payer: WALLET, pool, dammConfig: v1.DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption] });
          assert.equal(drawn, 2, "two position NFTs");
          return { instructions: instructionsOf(built.transaction), nfts: [built.firstPositionNftKeypair.publicKey.toBase58(), built.secondPositionNftKeypair.publicKey.toBase58()] };
        } finally {
          Keypair.generate = generate;
        }
      });
      sameBuild(`${curve.preset} migrate`, result);
    }
  }
  const migrated = REAL.find((entry) => entry.stage === "migrated");
  const pool = new PublicKey(migrated.address);
  const config = CONFIG_STATES[migrated.preset];
  const creator = new PublicKey(plainValue((await legacy.state.getPool(migrated.address)).poolState.creator));
  sameBuild("partner graduation fee", await both(async (client) => instructionsOf(await client.partner.partnerWithdrawMigrationFee({ pool, sender: config.feeClaimer }))));
  sameBuild("creator graduation fee", await both(async (client) => instructionsOf(await client.creator.creatorWithdrawMigrationFee({ pool, sender: creator }))));
  sameBuild("partner surplus", await both(async (client) => instructionsOf(await client.partner.partnerWithdrawSurplus({ feeClaimer: config.feeClaimer, pool }))));
});

test("the executor signs 2.0.0's claims exactly as 1.5.13's: Micro's and the demo market's partner fee", async () => {
  const dlmm = { address: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", instructions: [] };
  for (const curve of CURVES.filter((entry) => (entry.preset === "micro" || entry.preset === "demo") && entry.stage === "mid")) {
    const config = CONFIG_STATES[curve.preset];
    const executor = config.feeClaimer.toBase58();
    for (const sdk of SDKS) {
      const { by } = clients();
      const tx = await by[sdk].partner.claimPartnerTradingFee({ feeClaimer: config.feeClaimer, payer: config.feeClaimer, pool: new PublicKey(curve.address), maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX });
      assert.equal(executorSigningRefusal(tx.instructions, executor, dlmm), null, `${curve.preset} ${sdk}`);
    }
  }
});

test("through the trade venue under the flag: the same quote and the same bytes for the wallet", async () => {
  /* The wallet's USDC and token accounts, so the balance check passes; no referral account exists in the fixture. */
  const accounts = { ...ACCOUNTS };
  const tokenAccount = (mint, owner, amount) => {
    const data = Buffer.alloc(165);
    new PublicKey(mint).toBuffer().copy(data, 0);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    data.writeUInt8(1, 108);
    return data;
  };
  const results = {};
  for (const sdk of SDKS) {
    results[sdk] = await withFlag(sdk, async () => {
      const { connection } = fixtureConnection(accounts);
      const client = dbcClientOf(connection);
      assert.equal(client.sdk, sdk);
      const venue = createLaunchTradeVenue({ connection, referralOwner: null });
      const out = [];
      for (const curve of CURVES.filter((entry) => entry.stage === "real" || entry.stage === "mid" || entry.stage === "near")) {
        const virtual = await client.state.getPool(curve.address);
        const config = await client.state.getPoolConfig(virtual.poolState.config);
        const token = virtual.poolState.baseMint.toBase58();
        accounts[getAssociatedTokenAddressSync(new PublicKey(USDC), WALLET, true, TOKEN_PROGRAM_ID).toBase58()] = { owner: TOKEN_PROGRAM_ID.toBase58(), data: tokenAccount(USDC, WALLET, 10n ** 12n) };
        accounts[getAssociatedTokenAddressSync(new PublicKey(token), WALLET, true, TOKEN_2022_PROGRAM_ID).toBase58()] = { owner: TOKEN_2022_PROGRAM_ID.toBase58(), data: tokenAccount(token, WALLET, 10n ** 15n) };
        const state = { accounts: { curve: virtual, config }, curve: { pool: curve.address, pairMint: USDC, migrated: false, creatorTradingFeePct: config.creatorTradingFeePercentage }, graduated: null, tokenDecimals: 6, pairDecimals: 6 };
        for (const [side, amountRaw] of [["buy", "25000000"], ["buy", "1"], ["sell", "1000000"], ["sell", "1000000000000"]]) {
          try {
            const quote = await venue.quote({ state, side, amountRaw, slippageBps: 100 });
            const build = await venue.build({ state, token, side, amountRaw, slippageBps: 100, wallet: WALLET.toBase58() });
            /* The price fields are floats of the same integers; the quote's integers and the bytes are compared exactly. */
            out.push({ curve: curve.address, side, amountRaw, quote: { ...quote, priceBefore: quote.priceBefore.toPrecision(12), priceAfter: quote.priceAfter.toPrecision(12) }, wire: build.wireBase64 });
          } catch (error) {
            /* A sale the curve cannot pay is refused by both — the reason's words are each SDK's own. */
            out.push({ curve: curve.address, side, amountRaw, refused: error.code ?? error.message });
          }
        }
      }
      return out;
    });
  }
  assert.ok(results["1.5.13"].filter((entry) => entry.wire).length >= 20, "most trades build");
  assert.deepEqual(results["2.0.0"], results["1.5.13"]);
});

test("through the launch venue under the flag: progress and the claims' instructions of the mainnet curves", async () => {
  const results = {};
  for (const sdk of SDKS) {
    results[sdk] = await withFlag(sdk, async () => {
      const venue = createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs });
      const out = [];
      for (const curve of REAL.filter((entry) => entry.stage === "real")) {
        const token = plainValue((await legacy.state.getPool(curve.address)).poolState.baseMint);
        out.push(await venue.progress(token));
        for (const role of ["partner", "creator"]) out.push((await venue.claimFeeInstructions(role, token, "curve")).map(plainInstruction));
      }
      return out;
    });
  }
  assert.deepEqual(results["2.0.0"], results["1.5.13"]);
});

test("receipts: every DBC event 1.5.13 decodes, 2.0.0 decodes to the same fields — the three a receipt reads among them", () => {
  const coders = { "1.5.13": new BorshEventCoder(v1.DynamicBondingCurveIdl), "2.0.0": new BorshEventCoder(v2.DynamicBondingCurveIdl) };
  const removed = new Set(v1.DynamicBondingCurveIdl.events.filter((event) => !v2.DynamicBondingCurveIdl.events.some((other) => other.name === event.name)).map((event) => event.name));
  /* 0.2.2 no longer emits `EvtCreateConfig`; Ryntra reads it nowhere. */
  assert.deepEqual([...removed], ["EvtCreateConfig"]);
  let checked = 0;
  for (const event of v1.DynamicBondingCurveIdl.events) {
    if (removed.has(event.name)) continue;
    const sample = typedFromPlain(v1.DynamicBondingCurveIdl, event.name, sampleOf(v1.DynamicBondingCurveIdl, event.name));
    const layout = coders["1.5.13"].layouts.get(event.name);
    const body = Buffer.alloc(4096);
    const length = layout.layout.encode(sample, body);
    const bytes = Buffer.concat([Buffer.from(event.discriminator), body.subarray(0, length)]).toString("base64");
    const [a, b] = SDKS.map((sdk) => plainValue(coders[sdk].decode(bytes)));
    assert.ok(a, event.name);
    assert.deepEqual(b, a, event.name);
    checked += 1;
  }
  assert.ok(checked >= 20, `${checked} events`);
});

/** A struct of the IDL's type with every number different from zero and every key a fixed one, as the snapshot's plain JSON writes it. */
function sampleOf(idl, typeName) {
  const types = new Map(idl.types.map((entry) => [entry.name, entry.type]));
  let n = 1;
  const walk = (type) => {
    if (typeof type === "string") {
      n += 1;
      if (type === "pubkey") return seeded(n % 200).publicKey.toBase58();
      if (type === "bool") return n % 2 === 0;
      if (type === "u8" || type === "i8") return n % 100;
      if (type === "u16" || type === "i16") return n % 30_000;
      if (type === "u32" || type === "i32") return n * 1_003;
      return String(n * 1_000_003);
    }
    /* An option is filled, so its inner fields are compared too. */
    if (type.option) return walk(type.option);
    if (type.vec) return [walk(type.vec), walk(type.vec)];
    if (type.array) return Array.from({ length: type.array[1] }, () => walk(type.array[0]));
    if (type.defined) return walk(types.get(type.defined.name));
    if (type.kind === "struct") return Object.fromEntries(type.fields.map((field) => [field.name.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase()), walk(field.type)]));
    throw new Error(JSON.stringify(type));
  };
  return walk({ defined: { name: typeName } });
}

test("receipts: a creator's claim read from its transaction is the same under the flag", async () => {
  const eventCoder = new BorshEventCoder(v1.DynamicBondingCurveIdl);
  const curve = REAL.find((entry) => entry.stage === "real");
  const encodeEvent = (name, plain) => {
    const event = v1.DynamicBondingCurveIdl.events.find((entry) => entry.name === name);
    const body = Buffer.alloc(512);
    const length = eventCoder.layouts.get(name).layout.encode(typedFromPlain(v1.DynamicBondingCurveIdl, name, plain), body);
    return getBase58Decoder().decode(Buffer.concat([Buffer.from("e445a52e51cb9a1d", "hex"), Buffer.from(event.discriminator), body.subarray(0, length)]));
  };
  const message = new TransactionMessage({ payerKey: WALLET, recentBlockhash: PublicKey.default.toBase58(), instructions: [{ programId: new PublicKey(PROGRAM), keys: [], data: Buffer.alloc(8) }] }).compileToV0Message();
  const programIndex = message.staticAccountKeys.findIndex((key) => key.toBase58() === PROGRAM);
  const tx = {
    slot: 400_000_001,
    blockTime: 1_791_400_000,
    transaction: { message },
    meta: {
      err: null,
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { programIdIndex: programIndex, accounts: [], data: encodeEvent("EvtClaimCreatorTradingFee", { pool: curve.address, tokenBaseAmount: "0", tokenQuoteAmount: "16021" }) },
            { programIdIndex: programIndex, accounts: [], data: encodeEvent("EvtWithdrawMigrationFee", { pool: curve.address, fee: "777", flag: 1 }) },
          ],
        },
      ],
      preTokenBalances: [{ accountIndex: 0, mint: USDC, owner: WALLET.toBase58(), uiTokenAmount: { amount: "100" } }],
      postTokenBalances: [{ accountIndex: 0, mint: USDC, owner: WALLET.toBase58(), uiTokenAmount: { amount: "16898" } }],
    },
  };
  const results = {};
  for (const sdk of SDKS) {
    results[sdk] = await withFlag(sdk, async () => {
      const { connection } = fixtureConnection(ACCOUNTS);
      connection.getTransaction = async () => tx;
      return observeCreatorClaim(connection, { signature: "sig", wallet: WALLET.toBase58(), pairMint: USDC, pool: curve.address, graduatedPool: null });
    });
  }
  assert.deepEqual(results["1.5.13"].paid, { curve: "16021", graduation: "777", lp: "0", surplus: "0" });
  assert.deepEqual(results["2.0.0"], results["1.5.13"]);
});

test("a new config: on 2.0.0 it is `create_config2` with no transfer fee, on the same accounts and the same parameters", async () => {
  const coder = (idl) => new BorshInstructionCoder(idl);
  const { by } = clients();
  const key = seeded(230);
  const curve = presetCurve(LAUNCH_PRESETS.classic, { mint: USDC, decimals: 6, usdPrice: 1 });
  const args = { config: key.publicKey, feeClaimer: seeded(231).publicKey, leftoverReceiver: seeded(231).publicKey, payer: WALLET, quoteMint: new PublicKey(USDC), ...curve };
  const [a] = (await by["1.5.13"].partner.createConfig(args)).instructions;
  const [b] = (await by["2.0.0"].partner.createConfig(args)).instructions;
  assert.deepEqual(plainInstruction(b).keys, plainInstruction(a).keys, "the same accounts, signers and writes");
  const name = (idl, ix) => idl.instructions.find((entry) => Buffer.from(entry.discriminator).equals(ix.data.subarray(0, 8)))?.name;
  assert.equal(name(v1.DynamicBondingCurveIdl, a), "create_config");
  assert.equal(name(v2.DynamicBondingCurveIdl, b), "create_config2");
  const da = coder(v1.DynamicBondingCurveIdl).decode(a.data);
  const db = coder(v2.DynamicBondingCurveIdl).decode(b.data);
  assert.equal(db.data.transfer_fee_parameters, null, "no transfer fee: the token gets no TransferFeeConfig");
  assert.deepEqual(plainValue(db.data.config_parameters), plainValue(da.data.config_parameters), "the curve, fees and supply as 1.5.13 sends them");
});
test("a new config's curve on 2.0.0: the same threshold, migration price, fees and supply; the start price within a millionth", () => {
  const usdc = { mint: USDC, decimals: 6, usdPrice: 1 };
  for (const id of ["classic", "protected", "micro", "demo", "community", "advanced"]) {
    const preset = LAUNCH_PRESETS[id];
    const quote = preset.pair === "USDC" ? usdc : { ...usdc, usdPrice: 0.01 };
    const a = plainValue(presetCurve(preset, quote, "1.5.13"));
    const b = plainValue(presetCurve(preset, quote, "2.0.0"));
    const { sqrtStartPrice: sa, curve: ca, ...restA } = a;
    const { sqrtStartPrice: sb, curve: cb, ...restB } = b;
    assert.deepEqual(restB, restA, `${id}: everything but the curve's points`);
    const start = (hex) => BigInt(`0x${hex}`);
    const drift = Number(start(sa) - start(sb)) / Number(start(sa));
    assert.ok(Math.abs(drift) < 1e-6, `${id}: start price drift ${drift}`);
    assert.equal(cb[0].sqrtPrice, ca[0].sqrtPrice, `${id}: the curve ends at the same migration price`);
    /* 1.5.13 adds a segment above graduation that no trade reaches; 2.0.0 ends at the migration price. */
    assert.equal(ca.length, 2, id);
    assert.equal(cb.length, 1, id);
  }
  /* The presets' configs on mainnet were built by 1.5.13: the default builder still reproduces them point for point. */
  for (const [id, address] of Object.entries(fixture.configs)) {
    const built = presetCurve(LAUNCH_PRESETS[id], { mint: USDC, decimals: 6, usdPrice: 1 });
    const stored = CONFIG_STATES[id];
    assert.equal(built.sqrtStartPrice.toString(), stored.sqrtStartPrice.toString(), `${id} ${address}`);
    assert.equal(built.migrationQuoteThreshold.toString(), stored.migrationQuoteThreshold.toString(), id);
    built.curve.forEach((point, index) => {
      assert.equal(point.sqrtPrice.toString(), stored.curve[index].sqrtPrice.toString(), `${id} point ${index}`);
      assert.equal(point.liquidity.toString(), stored.curve[index].liquidity.toString(), `${id} point ${index}`);
    });
  }
  assert.equal(dbcCurveBuilders("1.5.13").buildCurve, v1.buildCurve);
  assert.equal(dbcCurveBuilders("2.0.0").buildCurve, v2.buildCurve);
});

test("buildConfig under the flag: 2.0.0's config passes «Чесний лаунч» and is built by createConfig2; 1.5.13's stays create_config", async () => {
  const names = {};
  for (const sdk of SDKS) {
    names[sdk] = await withFlag(sdk, async () => {
      const venue = createMeteoraDbcLaunchVenue({ connection: fixtureConnection(ACCOUNTS).connection, configs: fixture.configs });
      const built = await venue.buildConfig({ preset: "micro", quote: { mint: USDC, decimals: 6, usdPrice: 1 }, feeClaimer: seeded(231).publicKey.toBase58(), leftoverReceiver: seeded(231).publicKey.toBase58(), payer: WALLET.toBase58(), configKey: seeded(232) });
      const ix = Transaction.from(Buffer.from(built.wireBase64, "base64")).instructions.find((entry) => entry.programId.toBase58() === PROGRAM);
      const idl = sdk === "2.0.0" ? v2.DynamicBondingCurveIdl : v1.DynamicBondingCurveIdl;
      return { name: idl.instructions.find((entry) => Buffer.from(entry.discriminator).equals(ix.data.subarray(0, 8))).name, threshold: built.migrationQuoteThresholdRaw, fields: built.fields };
    });
  }
  assert.equal(names["1.5.13"].name, "create_config");
  assert.equal(names["2.0.0"].name, "create_config2");
  assert.equal(names["2.0.0"].threshold, names["1.5.13"].threshold);
  assert.deepEqual(names["2.0.0"].fields, names["1.5.13"].fields);
});
