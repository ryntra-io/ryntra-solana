/**
 * Meteora DBC's SDK behind one adapter and one flag.
 *
 * Two versions are installed side by side, each pinned exactly: 1.5.13 under its own name, the path every deployment
 * takes by default, and 2.0.0 (program 0.2.2) under the alias `@meteora-ag/dynamic-bonding-curve-sdk-v2`. The flag
 * `RYNTRA_DBC_SDK=2` moves the venue's every client call to 2.0.0; anything else — unset included — keeps 1.5.13, so
 * a rollback is the flag removed.
 *
 * What moves with the flag: the client's reads, quotes and transaction builds, the program whose coder decodes the
 * events receipts read, and the curve builders of a new config. What does not move: the configs already on chain
 * (Classic, Protected, Micro, Demo, Community-JUP) — they are only read, traded and claimed on, never rebuilt — and
 * the pure constants and address derivations, which the comparison test (`./sdk-compare.test.mjs`) proves equal in
 * both versions.
 *
 * On 2.0.0 a new config is made by `createConfig2` without a transfer fee (`transferFeeParameters: null`, no
 * `TransferFeeConfig` on the token); `createConfig` is deprecated there. Everything else Ryntra calls keeps its
 * signature, as the comparison test shows on the mainnet accounts of 18.10. The one exception is «Комісія за переказ»
 * (SOL-L10): a «Розширений» config may name `transferFeeParameters`, only on 2.0.0 and only under Ryntra's rule
 * (`../../launch/transfer-fee.ts` — the creator collects, RevokeZeroFee at the DEX, at most the cap); 1.5.13 refuses
 * them, and anything else is refused here before a byte is built.
 *
 * A quote on a Token-2022 pair currency is 2.0.0's alone: it asks for the mint and the epoch to price the pair's own
 * transfer fee and refuses without them. No preset's pair is one (USDC, JUP); a checked pair currency (SOL-L11) is, and
 * the trade path passes both there. The owner's tools that make mainnet configs (`scripts/launch/mainnet-config.mjs`)
 * and the QA scripts keep 1.5.13 directly.
 */

import * as legacy from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as v2 from "@meteora-ag/dynamic-bonding-curve-sdk-v2";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Mint } from "@solana/spl-token";

import { transferFeeParametersProblems, type DbcTransferFeeParameters } from "../../launch/transfer-fee.ts";

/** The environment variable that moves the venue to SDK 2.0.0. */
export const DBC_SDK_FLAG = "RYNTRA_DBC_SDK";

export type DbcSdkVersion = "1.5.13" | "2.0.0";

/** The SDK this deployment speaks to DBC through: 2.0.0 only when the flag says `2`; 1.5.13 otherwise. */
export function dbcSdkOf(env: Readonly<Record<string, string | undefined>> = process.env): DbcSdkVersion {
  return (env[DBC_SDK_FLAG] ?? "").trim() === "2" ? "2.0.0" : "1.5.13";
}

/** The DBC program both versions speak to — the owner of every config, curve and token badge Ryntra reads. */
export const DBC_PROGRAM_ID = legacy.DYNAMIC_BONDING_CURVE_PROGRAM_ID;

/**
 * The account Meteora's token badge of a pair currency lives at (SOL-L11). Only Meteora's operator creates one, and the
 * program needs it for every quote mint that is not permissionless; Ryntra reads the account and nothing more. Derived
 * by the SDK named — both derive the same address, which the comparison test holds.
 */
export function dbcTokenBadgeAddress(mint: string, sdk: DbcSdkVersion = dbcSdkOf()): PublicKey {
  const derive = sdk === "2.0.0" ? v2.deriveTokenBadgeAddress : legacy.deriveTokenBadgeAddress;
  return derive(new PublicKey(mint));
}

type Legacy = legacy.DynamicBondingCurveClient;

/**
 * What Ryntra calls on a DBC client, typed as 1.5.13 writes it. Both versions fill it: 2.0.0's methods take the same
 * parameters for every call here (its required `PublicKey`s Ryntra already passes), and `createConfig` is mapped to
 * `createConfig2`. One field is 2.0.0's alone — the pair currency's mint and the epoch a quote on a Token-2022 pair
 * needs (SOL-L11); 1.5.13 cannot price such a fee and is never asked to.
 */
export type DbcClient = Readonly<{
  sdk: DbcSdkVersion;
  state: Pick<Legacy["state"], "getPool" | "getPoolConfig" | "getPoolByBaseMint" | "getPoolsByCreator" | "program">;
  pool: Pick<Legacy["pool"], "swap2" | "getQuoteFromInputAmount" | "getQuoteFromOutputAmount"> & {
    /** A quote on the curve; `quoteMint` and `currentEpoch` only on 2.0.0, for a pair currency of the Token-2022 program. */
    swapQuote2(params: Parameters<Legacy["pool"]["swapQuote2"]>[0] & { quoteMint?: Mint; currentEpoch?: number }): ReturnType<Legacy["pool"]["swapQuote2"]>;
  };
  partner: Pick<Legacy["partner"], "claimPartnerTradingFee" | "partnerWithdrawMigrationFee" | "partnerWithdrawSurplus"> & {
    /** A new config; `transferFeeParameters` (SOL-L10) only on 2.0.0 and only under Ryntra's rule — absent or null, none. */
    createConfig(params: Parameters<Legacy["partner"]["createConfig"]>[0] & { transferFeeParameters?: DbcTransferFeeParameters | null }): ReturnType<Legacy["partner"]["createConfig"]>;
  };
  creator: Pick<Legacy["creator"], "createPool" | "createPoolWithFirstBuy" | "claimCreatorTradingFee" | "creatorWithdrawMigrationFee" | "creatorWithdrawSurplus">;
  migration: Pick<Legacy["migration"], "migrateToDammV2">;
}>;

/** Ryntra's rule on a config's transfer fee, checked once more where the bytes are built; null — none. */
function ruledTransferFee(params: DbcTransferFeeParameters | null | undefined): DbcTransferFeeParameters | null {
  if (!params) return null;
  const problems = transferFeeParametersProblems(params);
  if (problems.length) throw new Error(`A transfer fee outside Ryntra's rule: ${problems.join("; ")}.`);
  return { transferFeeBasisPoints: params.transferFeeBasisPoints, withheldAuthority: params.withheldAuthority, migratedTransferFeeAuthorityOption: params.migratedTransferFeeAuthorityOption };
}

function legacyClient(connection: Connection): DbcClient {
  const client = new legacy.DynamicBondingCurveClient(connection, "confirmed");
  const { partner, pool } = client;
  return {
    sdk: "1.5.13",
    state: client.state,
    pool: {
      /* 1.5.13 knows no Token-2022 pair currency: the two fields are dropped rather than handed to a version that would ignore them. */
      swapQuote2: ({ quoteMint: _quoteMint, currentEpoch: _currentEpoch, ...params }) => pool.swapQuote2(params),
      swap2: (params) => pool.swap2(params),
      getQuoteFromInputAmount: (params) => pool.getQuoteFromInputAmount(params),
      getQuoteFromOutputAmount: (params) => pool.getQuoteFromOutputAmount(params),
    },
    partner: {
      /* 1.5.13 has no `createConfig2`: a transfer fee is never built on it. */
      createConfig: ({ transferFeeParameters, ...params }) => {
        if (transferFeeParameters) throw new Error("A transfer fee needs DBC SDK 2.0.0 (RYNTRA_DBC_SDK=2).");
        return partner.createConfig(params);
      },
      claimPartnerTradingFee: (params) => partner.claimPartnerTradingFee(params),
      partnerWithdrawMigrationFee: (params) => partner.partnerWithdrawMigrationFee(params),
      partnerWithdrawSurplus: (params) => partner.partnerWithdrawSurplus(params),
    },
    creator: client.creator,
    migration: client.migration,
  };
}

function nextClient(connection: Connection): DbcClient {
  const client = new v2.DynamicBondingCurveClient(connection, "confirmed");
  const { state, pool, partner, creator, migration } = client;
  return {
    sdk: "2.0.0",
    state: {
      getPool: (address) => state.getPool(address),
      getPoolConfig: (address) => state.getPoolConfig(address),
      getPoolByBaseMint: (mint) => state.getPoolByBaseMint(mint),
      getPoolsByCreator: (creator) => state.getPoolsByCreator(creator),
      /* The same program and accounts; its IDL is 0.2.2's — a superset of 0.2.1's for every name Ryntra reads. */
      program: state.program as unknown as Legacy["state"]["program"],
    },
    /*
     * The quotes take the accounts this same client decoded — 2.0.0's `PoolConfig` carries the transfer-fee fields
     * 1.5.13's type has no names for — so the parameters pass as they are.
     */
    pool: {
      swapQuote2: (params) => pool.swapQuote2(params as unknown as Parameters<typeof pool.swapQuote2>[0]),
      swap2: (params) => pool.swap2(params),
      getQuoteFromInputAmount: (params) => pool.getQuoteFromInputAmount(params as unknown as Parameters<typeof pool.getQuoteFromInputAmount>[0]),
      getQuoteFromOutputAmount: (params) => pool.getQuoteFromOutputAmount(params as unknown as Parameters<typeof pool.getQuoteFromOutputAmount>[0]),
    },
    partner: {
      /*
       * A new config on 2.0.0 is `createConfig2`, with no transfer fee on the token unless «Комісія за переказ» names one
       * under Ryntra's rule; its addresses are required keys.
       */
      createConfig: ({ config, payer, feeClaimer, leftoverReceiver, quoteMint, transferFeeParameters, ...curve }) => {
        if (!config || !payer) throw new Error("A config is built with its own key and its payer named.");
        return partner.createConfig2({
          ...curve,
          config: new PublicKey(config),
          payer: new PublicKey(payer),
          feeClaimer: new PublicKey(feeClaimer),
          leftoverReceiver: new PublicKey(leftoverReceiver),
          quoteMint: new PublicKey(quoteMint),
          transferFeeParameters: ruledTransferFee(transferFeeParameters),
        });
      },
      claimPartnerTradingFee: (params) => partner.claimPartnerTradingFee(params),
      partnerWithdrawMigrationFee: (params) => partner.partnerWithdrawMigrationFee(params),
      partnerWithdrawSurplus: (params) => partner.partnerWithdrawSurplus(params),
    },
    creator: {
      createPool: (params) => creator.createPool(params),
      createPoolWithFirstBuy: (params) => creator.createPoolWithFirstBuy(params),
      claimCreatorTradingFee: (params) => creator.claimCreatorTradingFee(params),
      creatorWithdrawMigrationFee: (params) => creator.creatorWithdrawMigrationFee(params),
      creatorWithdrawSurplus: (params) => creator.creatorWithdrawSurplus(params),
    },
    migration: { migrateToDammV2: (params) => migration.migrateToDammV2(params) },
  };
}

/** A DBC client of `connection` on the SDK named, at `confirmed`. */
export function createDbcClient(connection: Connection, sdk: DbcSdkVersion = dbcSdkOf()): DbcClient {
  return sdk === "2.0.0" ? nextClient(connection) : legacyClient(connection);
}

/**
 * The curve builders of a new config on the SDK named. 2.0.0 reserves the program's own migration base and ends the
 * curve at the migration price, so its curve differs from 1.5.13's in the last digits of the start price and in the
 * unreachable segment above graduation — the comparison test bounds it. The presets' configs on chain were built by
 * 1.5.13 and are never rebuilt.
 */
export function dbcCurveBuilders(sdk: DbcSdkVersion): Readonly<{
  buildCurve: typeof legacy.buildCurve;
  buildCurveWithMarketCap: typeof legacy.buildCurveWithMarketCap;
}> {
  if (sdk === "2.0.0") {
    return {
      buildCurve: v2.buildCurve as unknown as typeof legacy.buildCurve,
      buildCurveWithMarketCap: v2.buildCurveWithMarketCap as unknown as typeof legacy.buildCurveWithMarketCap,
    };
  }
  return { buildCurve: legacy.buildCurve, buildCurveWithMarketCap: legacy.buildCurveWithMarketCap };
}
