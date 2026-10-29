/**
 * Meteora DBC as a launch venue of the core — Ryntra Launch's first venue.
 *
 * The adapter speaks to the dynamic bonding curve through Meteora's own SDK
 * and returns bytes for a wallet to sign, never a signature of its own: the
 * one key it ever holds is a fresh account's — the new token's mint, the new
 * config, a graduated position's NFT — made for that transaction and signed
 * into it. A launch's mint key is also handed back with the build: Ryntra
 * Launch takes that signature off the bytes the creator's wallet sees and signs
 * with the key only after the wallet (Phantom refuses bytes another key has
 * already signed).
 *
 * What it does:
 * - `buildConfig` — the partner's config for a preset (`./presets.ts`): the
 *   curve, the fees, the graduated pool, the locked LP, «Чесний лаунч»
 *   checked before the bytes are returned. A config never changes after it is
 *   made; its fee claimer is Ryntra's partner wallet (a Squads multisig on
 *   mainnet) and the payer is whoever signs.
 * - `create` — a token on a preset's config, paid for by Ryntra's own pool
 *   payer, with the creator's first purchase in the same transaction under
 *   Ryntra's cap: the purchase is priced on the fresh curve the transaction
 *   itself opens, so the cap is exact.
 * - `progress`, `migrate`, `claimFeeInstructions` — the curve's way to the DEX
 *   and every fee the partner and the creator earn on it: on the curve, at
 *   graduation, and from the locked LP after it.
 * - `observe`, `observeCreation` — the chain's own word on a launch: the
 *   mint, the curve, the config's preset, the creation transaction's payer and
 *   the creator's purchase in it, and after graduation the DAMM v2 pool and who
 *   owns its locked liquidity. The launch receipt (`./receipt.ts`) is built
 *   from these and nothing else.
 *
 * A config is public on chain: anyone can open a curve on it through the SDK
 * directly, with any first purchase. Such a token is not a Ryntra launch — the
 * receipt requires Ryntra's pool payer in the creation transaction and reads
 * the creator's purchase from that transaction itself.
 *
 * Server-only: it reads the chain through the connection it is given.
 */

import { CpAmm, getBaseFeeModeFromPodAlignedData } from "@meteora-ag/cp-amm-sdk";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  deriveDbcPoolAuthority,
  deriveDbcPoolAddress,
  type BuildCurveParams,
  type BuildCurveWithMarketCapParams,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionData,
  getExtensionTypes,
  getMetadataPointerState,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { cpAmmOf, dbcClientOf } from "../meteora-clients.server.ts";
import type { Address, CurveProgress, LaunchParams, LaunchVenue, UnsignedTx } from "../../contracts.ts";
import type { FeeShare } from "../../launch/fee-shares.ts";
import { ExitUnread, readExitPositions } from "./exit-positions.server.ts";
import { mintMetadataOf, type MintMetadata } from "./mint-metadata.ts";
import { dbcCurveBuilders, type DbcSdkVersion } from "./sdk.server.ts";
import { feeSharingSplitInstructions, feeSharingVaultOf, observeFeeSharing, type FeeSharingObservation } from "./fee-sharing.server.ts";
import {
  LAUNCH_PRESET_IDS,
  creatorFirstBuyCapRaw,
  honestLaunchProblems,
  launchPreset,
  presetCurveInput,
  type HonestConfigFields,
  type LaunchPreset,
  type LaunchPresetId,
  type PresetQuote,
} from "./presets.ts";
import { getTransactionAnyVersion } from "../../../solana/v1-tx.ts";
import { CURVE_RULES_PRESET_ID, type CurveRulesProgram, type MintTransferHook } from "../../launch/curve-rules.ts";
import { transferFeeParametersOf, type ConfigTransferFee, type MintTransferFee } from "../../launch/transfer-fee.ts";

/** Why the adapter refused to build; the caller decides what the person is told. */
export class LaunchRefusal extends Error {
  readonly code:
    | "UNKNOWN_PRESET"
    | "NO_CONFIG"
    | "CONFIG_NOT_HONEST"
    | "NO_POOL_PAYER"
    | "CREATOR_BUY_ABOVE_CAP"
    | "PAYER_NOT_COVERED"
    | "NO_POOL"
    | "NOT_GRADUATED"
    | "ALREADY_MIGRATED"
    | "MULTISIG_SIGNS"
    | "NO_POSITION";

  constructor(code: LaunchRefusal["code"], message: string) {
    super(message);
    this.name = "LaunchRefusal";
    this.code = code;
  }
}

/**
 * A built launch: the bytes, and the token and curve they create. When the
 * creator covers the pool payer, `payerCoveredLamports` is what the creator
 * hands the payer in the same transaction — the rent of every account the
 * creation opens and the network fee — and `payerNetLamports` is the payer's
 * own balance change the network simulated for the sealed bytes (never below
 * zero, or the build is refused).
 */
export type LaunchBuild = UnsignedTx &
  Readonly<{
    token: Address;
    pool: Address;
    config: Address;
    pairMint: Address;
    creatorFirstBuyOutRaw: string;
    payerCoveredLamports: string;
    payerNetLamports: string | null;
    /** The creator's SOL the network simulated the sealed bytes taking: the pool payer covered, the creator's own token accounts. */
    creatorSpendLamports: string | null;
    /**
     * «Спільнота» sharing the creator's fees: the second transaction, signed already by the new mint as the vault's seed
     * — the vault with the shares written for ever, and the curve's creator role handed to it. Sent once the creation
     * lands. `costLamports` is the rent of the vault's two accounts and the signature's fee.
     */
    split: Readonly<{ wireBase64: string; vault: Address; costLamports: string }> | null;
    /** The new token's fresh mint key, signed into the creation and the sharing: a caller whose wallet signs first takes that signature off and signs with it after. */
    mintKey: Keypair;
  }>;

/** What the creator's first purchase would buy on a fresh curve: the tokens for an amount, or the most it may spend under the cap. */
export type FirstBuyQuote = Readonly<{ preset: LaunchPresetId; config: Address; pairMint: Address; amountInRaw: string; tokensOutRaw: string; capRaw: string; maxAmountInRaw: string; withinCap: boolean }>;

/** A built config: the bytes, the config's address, and the curve's own numbers. */
export type ConfigBuild = UnsignedTx & Readonly<{ config: Address; migrationQuoteThresholdRaw: string; fields: HonestConfigFields }>;

/** Which fee a claim collects: the curve's trading fee, the graduation fee, or the locked LP's fee in the graduated pool. */
export type FeeKind = "curve" | "graduation" | "lp" | "surplus";
/** The locked position a claim of the LP's fee takes from — the exit position the move to the DEX opened for the signer. */
export type ExitPositionRef = Readonly<{ position: Address; positionNftAccount: Address }>;

export type MeteoraDbcLaunchVenue = LaunchVenue &
  Readonly<{
    buildConfig(args: Readonly<{
      preset: LaunchPresetId;
      quote: PresetQuote;
      feeClaimer: Address;
      leftoverReceiver: Address;
      payer: Address;
      /** The config account's own fresh key, kept by the caller so a retried signature keeps one address; absent, a new one. */
      configKey?: Keypair;
      /** «Розширений» only: the preset the creator's choice makes (`advancedPreset`) — its numbers, not the template's. */
      custom?: LaunchPreset;
    }>): Promise<ConfigBuild>;
    /**
     * The token and the creator's first purchase. With `creatorCoversPayer`
     * the creator's first instruction pays Ryntra's pool payer back the rent
     * and fee the simulation shows it spending, and the sealed bytes are
     * simulated again: a payer that would still lose lamports refuses the build.
     */
    create(
      params: LaunchParams,
      options?: Readonly<{ creatorCoversPayer?: boolean; feeShares?: readonly FeeShare[]; /** MC-2: the rows are a crew's — Classic and Protected share too. */ crew?: boolean; /** «Розширений»: its own terms' preset (SOL-L5). */ custom?: LaunchPreset }>,
    ): Promise<LaunchBuild>;
    /** `custom` — «Розширений»: the preset its launch's own terms make, whose first-purchase cap binds (SOL-L5). */
    firstBuyQuote(preset: LaunchPresetId, amountInRaw: string, pairMint?: Address, custom?: LaunchPreset): Promise<FirstBuyQuote>;
    /**
     * The instructions of a fee claim, for the signer to wrap — the partner's multisig wraps them in a vault transaction.
     * The locked LP's fee is taken from `position` — the signer's exit position —, or with `fromExit` from the exit
     * position the move to the DEX opened for the signer, read from the move's own transaction (SOL-L1d); without either,
     * from the first position a node's index lists for the signer — as it always was, the path «Забрати» keeps while
     * SOL-L1d's claims are closed on the network (`launchClaimsV2Open`).
     */
    claimFeeInstructions(role: "partner" | "creator", token: Address, kind?: FeeKind, options?: Readonly<{ position?: ExitPositionRef; fromExit?: boolean }>): Promise<readonly TransactionInstruction[]>;
    migrate(token: Address, payer: Address): Promise<UnsignedTx>;
    configFields(config: Address): Promise<ConfigFields>;
    configFieldsFromData(config: Address, data: Buffer): ConfigFields;
    /** Every field of a config account, plain — keys to base58, numbers to decimal strings — for a whole-account comparison. */
    plainConfigFromData(data: Buffer): Record<string, unknown>;
    /** A config account read from the chain (once per process: configs never change), every field plain — what the Market Constitution reads. */
    plainConfig(config: Address): Promise<Record<string, unknown>>;
    /**
     * `exitSignature`: the move to the DEX's signature when the caller knows it — the executor's receipt of the
     * graduation —, or a read of it asked only once the curve has graduated.
     */
    observe(token: Address, hints?: Readonly<{ exitSignature?: string | null | (() => Promise<string | null>) }>): Promise<LaunchObservation>;
    observeCreation(signature: string, token: Address): Promise<CreationObservation>;
    /** The token's curve when it sits on one of the presets' configs, in one read; null when none does — never a program scan. */
    presetCurveOf(token: Address): Promise<Address | null>;
  }>;

/** A config as the chain stores it: what «Чесний лаунч» judges, plus who claims and what the curve aims at. */
export type ConfigFields = HonestConfigFields &
  Readonly<{
    config: Address;
    quoteMint: Address;
    feeClaimer: Address;
    leftoverReceiver: Address;
    collectFeeMode: number;
    activationType: number;
    tokenDecimal: number;
    creatorTradingFeePercentage: number;
    migrationFeeOption: number;
    migrationFeePercentage: number;
    creatorMigrationFeePercentage: number;
    migrationQuoteThreshold: string;
    migratedDynamicFee: number;
    migratedPoolFeeBps: number;
    poolCreationFee: string;
    cliffFeeNumerator: string;
    feeSchedulerPeriods: number;
    dynamicFeeEnabled: boolean;
    sqrtStartPrice: string;
  }>;

/** How the token's metadata read went: present, absent, or not readable now — never taken as «fixed» unless read. */
export type MetadataRead = "OK" | "MISSING" | "FAILED" | "INVALID";

/** A launch as the chain shows it. */
export type LaunchObservation = Readonly<{
  token: Address;
  pool: Address;
  config: Address;
  /**
   * The preset whose configured config the curve sits on; «Розширений» for a config of its own whose fee claimer is
   * Ryntra's partner vault (SOL-L5); null for a config Ryntra did not name.
   */
  preset: LaunchPresetId | null;
  /** The supply the config was made for, raw — what the token launched with; absent on a read before it was kept. */
  configSupplyRaw?: string;
  /** What breaks «Чесний лаунч» in that config as the chain stores it. */
  configProblems: readonly string[];
  /** The config's base transfer fee (SOL-L10); absent or null — none. */
  configTransferFee?: ConfigTransferFee | null;
  /**
   * «Правила на кривій» (SOL-L8): the rule program a `ConfigWithTransferHook` fixes for ever; absent or null — the
   * config is no hook config.
   */
  configRuleProgram?: string | null;
  /**
   * The mint's `TransferHook` as read, with DBC's pool authority (which holds the hook while the token is on its
   * curve); absent or null — the mint carries no hook.
   */
  transferHook?: Readonly<{ mint: MintTransferHook; poolAuthority: Address }> | null;
  /**
   * The mint's transfer fee as read with the epoch of the read and DBC's pool authority (which holds the fee's config on
   * the curve); absent or null — the mint has no `TransferFeeConfig`.
   */
  transferFee?: Readonly<{ mint: MintTransferFee; epoch: string; poolAuthority: Address }> | null;
  /** Who holds the curve's creator role now: the creator's wallet, or — «Спільнота» sharing its fees — the vault. */
  creator: Address;
  /** The vault holding the creator role when it is the one found from this token's own mint; null otherwise. */
  feeSharing: FeeSharingObservation | null;
  mint: Readonly<{
    program: Address;
    supplyRaw: string;
    decimals: number;
    mintAuthority: Address | null;
    freezeAuthority: Address | null;
    extensions: readonly string[];
    transferHookProgram: Address | null;
    metadataPointerAuthority: Address | null;
    /** Where the metadata pointer points; a preset's mint points at itself. */
    metadataPointerAddress: Address | null;
    metadataRead: MetadataRead;
    metadataUpdateAuthority: Address | null;
    name: string | null;
    symbol: string | null;
    /** The metadata URI the mint names for ever. */
    uri: string | null;
  }>;
  curve: Readonly<{
    /** The curve's vault of the pair currency — where the buyers' money sits while the token is on the curve. */
    quoteVault?: Address;
    quoteReserveRaw: string;
    baseReserveRaw: string;
    migrationQuoteThresholdRaw: string;
    progressBps: number;
    migrated: boolean;
    migrationProgress: number;
    partnerQuoteFeeRaw: string;
    creatorQuoteFeeRaw: string;
  }>;
  /** After graduation: the DAMM v2 pool and the positions the move to the DEX opened in it — the exit — each with its owner now. */
  graduated: Readonly<{
    pool: Address;
    collectFeeMode: number;
    compoundingFeeBps: number;
    baseFeeMode: number;
    tokenAReserveRaw: string;
    tokenBReserveRaw: string;
    liquidity: string;
    poolPermanentLockedLiquidity: string;
    positions: readonly Readonly<{ position: Address; owner: Address; permanentLockedLiquidity: string; unlockedLiquidity: string; vestedLiquidity: string }>[];
    /** The exit positions were not read now: the pool's marks are not read, the rest of the receipt stands. */
    exitUnread?: boolean;
  }> | null;
}>;

/** The creation transaction as the chain recorded it: who paid and signed, and what the creator bought in it. */
export type CreationObservation = Readonly<{
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
  feePayer: Address;
  signers: readonly Address[];
  /** The curve initialization this transaction carries, from its instruction's accounts; null when it carries none. */
  initialized: Readonly<{ config: Address; creator: Address; baseMint: Address; pool: Address; payer: Address }> | null;
  /** The creator the initialization names. */
  creator: Address;
  /** Tokens the creator received in this transaction, raw — the first purchase. */
  creatorTokensOutRaw: string;
  /** What the creator paid for them in the pair currency, raw. */
  creatorQuoteInRaw: string;
}>;

const U64_MAX = new BN("18446744073709551615");
/** A fee vault account of Meteora's Dynamic Fee Sharing: its header and five users (the program's `8 + FeeVault::INIT_SPACE`). */
const FEE_VAULT_BYTES = 8 + 240 + 5 * 80;

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
/** The curve initialization instructions a preset launch uses, by their discriminators, with the place of each account the receipt reads. */
const DBC_INITIALIZE = [
  { discriminator: Buffer.from("a976334e916edc9b", "hex"), accounts: { config: 0, creator: 2, baseMint: 3, pool: 5, payer: 8 } },
  { discriminator: Buffer.from("8c55d7b06636684f", "hex"), accounts: { config: 0, creator: 2, baseMint: 3, pool: 5, payer: 10 } },
] as const;

function toBase64(tx: Transaction): string {
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

const str = (value: { toString(): string } | number | bigint) => value.toString();

/** When the curve was filled for the DEX (`finish_curve_timestamp`, unix seconds); null while it is not. */
function finishedAtOf(state: Readonly<{ finishCurveTimestamp: { toString(): string } }>): number | null {
  const at = Number(state.finishCurveTimestamp.toString());
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** A decoded account, plain: keys to base58, big numbers to decimal strings, buffers to hex. */
export function plainOf(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return (value as BN).toString(10);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(plainOf);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, plainOf(inner)]));
  return value;
}

/**
 * The fields of a created config, read from its account. `transferHookProgram` — «Правила на кривій» (SOL-L8): the
 * program a `ConfigWithTransferHook` fixes for ever; null on every other config.
 */
export function configFieldsOf(config: Address, state: PoolConfig, hasTransferHook: boolean, transferHookProgram: string | null = null): ConfigFields {
  const partnerVesting = state.partnerLiquidityVestingInfo;
  const creatorVesting = state.creatorLiquidityVestingInfo;
  const locked = state.lockedVestingConfig;
  const lockedAmount = new BN(locked.amountPerPeriod).mul(new BN(locked.numberOfPeriod)).add(new BN(locked.cliffUnlockAmount));
  const baseFee = state.poolFees.baseFee;
  return {
    config,
    hasTransferHook,
    transferHookProgram,
    quoteMint: state.quoteMint.toBase58(),
    feeClaimer: state.feeClaimer.toBase58(),
    leftoverReceiver: state.leftoverReceiver.toBase58(),
    tokenType: state.tokenType,
    tokenUpdateAuthority: state.tokenUpdateAuthority,
    migrationOption: state.migrationOption,
    partnerLiquidityPercentage: state.partnerLiquidityPercentage,
    partnerPermanentLockedLiquidityPercentage: state.partnerPermanentLockedLiquidityPercentage,
    partnerVestingPercentage: partnerVesting.isInitialized ? partnerVesting.vestingPercentage : 0,
    creatorLiquidityPercentage: state.creatorLiquidityPercentage,
    creatorPermanentLockedLiquidityPercentage: state.creatorPermanentLockedLiquidityPercentage,
    creatorVestingPercentage: creatorVesting.isInitialized ? creatorVesting.vestingPercentage : 0,
    lockedVestingAmount: lockedAmount.toString(),
    baseFeeMode: baseFee.baseFeeMode,
    migratedCollectFeeMode: state.migratedCollectFeeMode,
    compoundingFeeBps: state.migratedCompoundingFeeBps,
    migratedPoolBaseFeeMode: state.migratedPoolBaseFeeMode,
    enableFirstSwapWithMinFee: state.enableFirstSwapWithMinFee === 1,
    preMigrationTokenSupply: str(state.preMigrationTokenSupply),
    postMigrationTokenSupply: str(state.postMigrationTokenSupply),
    transferFee: configTransferFeeOf(state),
    collectFeeMode: state.collectFeeMode,
    activationType: state.activationType,
    tokenDecimal: state.tokenDecimal,
    creatorTradingFeePercentage: state.creatorTradingFeePercentage,
    migrationFeeOption: state.migrationFeeOption,
    migrationFeePercentage: state.migrationFeePercentage,
    creatorMigrationFeePercentage: state.creatorMigrationFeePercentage,
    migrationQuoteThreshold: str(state.migrationQuoteThreshold),
    migratedDynamicFee: state.migratedDynamicFee,
    migratedPoolFeeBps: state.migratedPoolFeeBps,
    poolCreationFee: str(state.poolCreationFee),
    cliffFeeNumerator: str(baseFee.cliffFeeNumerator),
    feeSchedulerPeriods: baseFee.firstFactor,
    dynamicFeeEnabled: state.poolFees.dynamicFee.initialized === 1,
    sqrtStartPrice: str(state.sqrtStartPrice),
  };
}

/**
 * A config's base transfer fee (DBC 0.2.2, SOL-L10) as SDK 2.0.0 decodes it; null when the config has none — or when
 * 1.5.13 decoded it, whose layout has no such fields: a transfer-fee launch read so is refused by its mint's extension.
 */
export function configTransferFeeOf(state: PoolConfig): ConfigTransferFee | null {
  const fields = state as unknown as Partial<Record<"transferFeeFlag" | "transferFeeBasisPoints" | "transferFeeWithheldAuthority" | "migratedTransferFeeAuthorityOption", number>>;
  if (typeof fields.transferFeeFlag !== "number" || fields.transferFeeFlag === 0) return null;
  return { flag: fields.transferFeeFlag, bps: Number(fields.transferFeeBasisPoints ?? 0), withheldAuthority: Number(fields.transferFeeWithheldAuthority ?? -1), migratedAuthorityOption: Number(fields.migratedTransferFeeAuthorityOption ?? -1) };
}

/** A mint's `TransferFeeConfig`, plain; null — the mint has none. */
export function mintTransferFeeOf(mint: Mint): MintTransferFee | null {
  const config = getTransferFeeConfig(mint);
  if (!config) return null;
  const authority = (key: PublicKey | null | undefined) => (key && !key.equals(PublicKey.default) ? key.toBase58() : null);
  return {
    olderBps: config.olderTransferFee.transferFeeBasisPoints,
    olderEpoch: config.olderTransferFee.epoch.toString(),
    newerBps: config.newerTransferFee.transferFeeBasisPoints,
    newerEpoch: config.newerTransferFee.epoch.toString(),
    configAuthority: authority(config.transferFeeConfigAuthority),
    withdrawAuthority: authority(config.withdrawWithheldAuthority),
    withheldOnMintRaw: config.withheldAmount.toString(),
  };
}

/**
 * The SDK's curve for a preset, its enums cast from the mirrored numbers. By default 1.5.13's builders — the ones the
 * presets' configs on chain were made by, so a config read back compares to it; a new config is built on the SDK the
 * flag names (`./sdk.server.ts`).
 */
export function presetCurve(preset: LaunchPreset, quote: PresetQuote, sdk: DbcSdkVersion = "1.5.13") {
  const input = presetCurveInput(preset, quote);
  const { buildCurve, buildCurveWithMarketCap } = dbcCurveBuilders(sdk);
  /* A preset named by its threshold is built for exactly that amount raised; the others by their market caps. */
  if ("migrationQuoteThreshold" in input) return buildCurve(input as unknown as BuildCurveParams);
  return buildCurveWithMarketCap(input as unknown as BuildCurveWithMarketCapParams);
}

/**
 * The preset a build goes by: a preset's own, or — «Розширений» — the one its launch's terms make, whose cap binds; a
 * custom preset for any other id is refused.
 */
function customOr(id: string, custom: LaunchPreset | undefined): LaunchPreset | null {
  if (!custom) return launchPreset(id);
  if (id !== "advanced" || custom.id !== "advanced") throw new LaunchRefusal("UNKNOWN_PRESET", "Only «Розширений» is built from a creator's own numbers.");
  return custom;
}

/** The supply a config was made for — what a launch on it mints —, raw; undefined where the config does not say it. */
function supplyOf(fields: Pick<HonestConfigFields, "preMigrationTokenSupply">): bigint | undefined {
  const raw = BigInt(fields.preMigrationTokenSupply || "0");
  return raw > 0n ? raw : undefined;
}

/** A preset's configs on a network: one for a USDC preset, one per community token for «Спільнота», one per launch for «Розширений». */
export type PresetConfigs = Readonly<Partial<Record<LaunchPresetId, Address | readonly Address[]>>>;

export function configsOfPreset(configs: PresetConfigs, preset: LaunchPresetId): readonly Address[] {
  const entry = configs[preset];
  if (!entry) return [];
  return typeof entry === "string" ? [entry] : entry;
}

/*
 * A DBC config never changes once created, so its account is read once per
 * process and network: every launch and every token read names one of a
 * handful of configs, and a public RPC answers a burst of repeated reads with
 * 429. Keyed by the connection's endpoint and the address; a config that is
 * not there is not remembered.
 */
const CONFIG_ACCOUNTS = new Map<string, Promise<Buffer | null>>();

export function createMeteoraDbcLaunchVenue(args: Readonly<{
  connection: Connection;
  configs: PresetConfigs;
  /** Ryntra's pool payer — pays the rent of every pool Ryntra Launch creates and signs its creation; absent, nothing launches. */
  poolPayer?: Address | null;
  /** Asked for a transaction the main endpoint no longer keeps — a public node holds a day or two of them. */
  archive?: Connection | null;
  /** Whose signature lists reach back to a curve's move to the DEX — the exit positions are found from it. */
  history?: Connection | null;
  /**
   * «Розширений» (SOL-L5): Ryntra's partner vault, the fee claimer every such config names. A curve on a config that is
   * not a preset's is read as «Розширений» only when its config names this vault; absent — no config but the presets'
   * is Ryntra's.
   */
  advancedFeeClaimer?: Address | null;
  /**
   * «Правила на кривій» (SOL-L8): the audited rule program this deployment runs, when the preset is open here
   * (`../../launch/curve-rules.ts`). Without it a transfer-hook config is refused as it always was.
   */
  curveRules?: CurveRulesProgram | null;
}>): MeteoraDbcLaunchVenue {
  const { connection, configs } = args;
  const client = dbcClientOf(connection);
  const cpAmm = cpAmmOf(connection);
  const allConfigs = () => LAUNCH_PRESET_IDS.flatMap((id) => configsOfPreset(configs, id).map((config) => ({ preset: id, config })));
  const presetOfConfig = (config: Address, feeClaimer?: PublicKey): LaunchPresetId | null => {
    const named = allConfigs().find((entry) => entry.config === config)?.preset ?? null;
    if (named) return named;
    return args.advancedFeeClaimer && feeClaimer && feeClaimer.toBase58() === args.advancedFeeClaimer ? "advanced" : null;
  };

  async function seal(tx: Transaction, feePayer: PublicKey, signers: readonly Keypair[]): Promise<UnsignedTx> {
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = feePayer;
    tx.recentBlockhash = latest.blockhash;
    if (signers.length) tx.partialSign(...signers);
    return { network: "solana", wireBase64: toBase64(tx), validUntil: String(latest.lastValidBlockHeight) };
  }

  /** The lamports each account's balance loses when the network simulates these bytes; negative when it gains. */
  async function spendOf(tx: Transaction, accounts: readonly PublicKey[]): Promise<bigint[]> {
    const before = await Promise.all(accounts.map(async (account) => BigInt(await connection.getBalance(account, "confirmed"))));
    const simulated = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: accounts.map((account) => account.toBase58()) },
    });
    if (simulated.value.err) throw new LaunchRefusal("PAYER_NOT_COVERED", `The creation does not simulate: ${JSON.stringify(simulated.value.err)}.`);
    return accounts.map((_, index) => {
      const after = simulated.value.accounts?.[index]?.lamports;
      if (after === undefined || after === null) throw new LaunchRefusal("PAYER_NOT_COVERED", "The simulation did not return a balance.");
      return (before[index] ?? 0n) - BigInt(after);
    });
  }
  const payerSpend = async (tx: Transaction, payer: PublicKey) => (await spendOf(tx, [payer]))[0] ?? 0n;

  /** A config account's bytes, read once (configs are immutable). */
  function configAccount(config: PublicKey): Promise<Buffer | null> {
    const key = `${connection.rpcEndpoint}:${config.toBase58()}`;
    let read = CONFIG_ACCOUNTS.get(key);
    if (!read) {
      read = connection.getAccountInfo(config, "confirmed").then((info) => (info ? Buffer.from(info.data) : null));
      CONFIG_ACCOUNTS.set(key, read);
      read.then((data) => (data ? undefined : CONFIG_ACCOUNTS.delete(key))).catch(() => CONFIG_ACCOUNTS.delete(key));
    }
    return read;
  }

  /**
   * A config's `PoolConfig`. `ConfigWithTransferHook` (SOL-L8) wraps the very same struct beside the rule program it
   * fixes, so its own fields are unwrapped out of it — read as the account itself they would all be absent.
   */
  async function configOf(config: PublicKey): Promise<PoolConfig> {
    return (await configWithHookOf(config)).state;
  }

  /** The same, with the rule program the config fixes for ever; null — the config is no hook config. */
  async function configWithHookOf(config: PublicKey): Promise<{ state: PoolConfig; transferHookProgram: string | null }> {
    const data = await configAccount(config);
    if (!data) throw new LaunchRefusal("NO_CONFIG", `No DBC config at ${config.toBase58()}.`);
    const coder = accountsCoder();
    const head = Buffer.from(data.subarray(0, 8));
    if (!head.equals(Buffer.from(coder.accountDiscriminator("configWithTransferHook")))) {
      return { state: coder.decode<PoolConfig>("poolConfig", data), transferHookProgram: null };
    }
    const wrapped = coder.decode<{ config: PoolConfig; transferHookProgram: PublicKey }>("configWithTransferHook", data);
    return { state: wrapped.config, transferHookProgram: wrapped.transferHookProgram.toBase58() };
  }

  /** The token's curve on one of the presets' configs: its address follows from the config, so one read finds it. */
  async function curveOnPresets(token: Address, strict: boolean): Promise<PublicKey | null> {
    const baseMint = new PublicKey(token);
    /* A Ryntra launch sits on one of the presets' configs: its curve's address follows from it, read directly. */
    const candidates = (await Promise.all(allConfigs().map(async ({ config: address }) => {
      const config = await configOf(new PublicKey(address)).catch((error: unknown) => {
        if (strict) throw error;
        return null;
      });
      return config ? deriveDbcPoolAddress(config.quoteMint, baseMint, new PublicKey(address)) : null;
    }))).filter((address): address is PublicKey => address !== null);
    /* One read for every candidate curve: only the config the token was launched on has an account there. */
    const read = candidates.length ? connection.getMultipleAccountsInfo(candidates, "confirmed") : Promise.resolve([]);
    const accounts = strict ? await read : await read.catch(() => []);
    const found = accounts.findIndex((info) => info !== null);
    return found >= 0 ? candidates[found]! : null;
  }

  async function poolOf(token: Address) {
    const baseMint = new PublicKey(token);
    const curve = await curveOnPresets(token, false);
    if (curve) {
      const account = await client.state.getPool(curve).catch(() => null);
      if (account) return { publicKey: curve, account };
    }
    const pool = await client.state.getPoolByBaseMint(baseMint);
    if (!pool) throw new LaunchRefusal("NO_POOL", "No curve for this token.");
    return pool;
  }

  type AccountsCoder = { accountDiscriminator(name: string): Buffer; decode<T>(name: string, data: Buffer): T };
  const accountsCoder = () => (client.state.program as unknown as { coder: { accounts: AccountsCoder } }).coder.accounts;

  function decodeConfig(config: Address, data: Buffer): PoolConfig {
    const coder = accountsCoder();
    const head = Buffer.from(data.subarray(0, 8));
    if (head.equals(Buffer.from(coder.accountDiscriminator("configWithTransferHook")))) {
      throw new LaunchRefusal("CONFIG_NOT_HONEST", "a transfer-hook config: the creator or partner could keep mint or update rights");
    }
    if (!head.equals(Buffer.from(coder.accountDiscriminator("poolConfig")))) throw new LaunchRefusal("NO_CONFIG", `${config} is not a DBC config.`);
    return coder.decode<PoolConfig>("poolConfig", data);
  }

  /** A config's fields from its account bytes — a simulation's post-state, before anything is signed. */
  function configFieldsFromData(config: Address, data: Buffer): ConfigFields {
    return configFieldsOf(config, decodeConfig(config, data), false);
  }

  async function readConfig(config: Address): Promise<ConfigFields> {
    const data = await configAccount(new PublicKey(config));
    if (!data) throw new LaunchRefusal("NO_CONFIG", `No DBC config at ${config}.`);
    const hookDiscriminator = accountsCoder().accountDiscriminator("configWithTransferHook");
    if (Buffer.from(data.subarray(0, 8)).equals(Buffer.from(hookDiscriminator))) {
      const read = await configWithHookOf(new PublicKey(config));
      return configFieldsOf(config, read.state, true, read.transferHookProgram);
    }
    return configFieldsFromData(config, data);
  }

  /** The config a launch goes on: the preset's one, or — for «Спільнота» — the one quoted in the community's token. */
  async function configFor(preset: LaunchPreset, pairMint: Address | undefined): Promise<ConfigFields> {
    const candidates = configsOfPreset(configs, preset.id);
    if (candidates.length === 0) throw new LaunchRefusal("NO_CONFIG", `The preset «${preset.id}» has no config on this network.`);
    for (const address of candidates) {
      const fields = await readConfig(address);
      if (pairMint === undefined ? candidates.length === 1 : fields.quoteMint === pairMint) return fields;
    }
    throw new LaunchRefusal("NO_CONFIG", pairMint ? `The preset «${preset.id}» has no config for ${pairMint}.` : `The preset «${preset.id}» needs the pair currency named.`);
  }

  /**
   * The creator's first purchase on a fresh curve: the curve's output (gross) and what reaches the wallet (net). A fresh
   * curve's quote takes no fee from the config, so a transfer-fee launch names its rate (SOL-L10); the program holds
   * `minimum_amount_out` to the net.
   */
  function firstBuyQuoteOf(configState: PoolConfig, amountIn: BN, preset: LaunchPreset): Readonly<{ grossRaw: BN; netRaw: BN }> {
    const quote = client.pool.getQuoteFromInputAmount({
      config: configState,
      swapBaseForQuote: false,
      amountIn,
      eligibleForFirstSwapWithMinFee: true,
      slippageBps: 0,
      ...(preset.transferFeeBps !== undefined ? { baseTransferFeeBasisPoints: preset.transferFeeBps } : {}),
    } as Parameters<typeof client.pool.getQuoteFromInputAmount>[0]);
    const grossRaw = new BN(quote.outputAmount.toString());
    const excluded = (quote as { excludedTransferFeeAmountOut?: BN }).excludedTransferFeeAmountOut;
    return { grossRaw, netRaw: preset.transferFeeBps !== undefined && excluded ? new BN(excluded.toString()) : grossRaw };
  }

  const venue: MeteoraDbcLaunchVenue = {
    venue: "meteora-dbc",

    async buildConfig({ preset: presetId, quote, feeClaimer, leftoverReceiver, payer, configKey, custom }) {
      if (custom && (presetId !== "advanced" || custom.id !== "advanced")) throw new LaunchRefusal("UNKNOWN_PRESET", "Only «Розширений» is built from a creator's own numbers.");
      const preset = custom ?? launchPreset(presetId);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${presetId}».`);
      const curve = presetCurve(preset, quote, client.sdk);
      if (preset.transferFeeBps !== undefined && (preset.id !== "advanced" || client.sdk !== "2.0.0")) {
        throw new LaunchRefusal("CONFIG_NOT_HONEST", "a transfer fee is built only for «Розширений» on DBC SDK 2.0.0");
      }
      /*
       * «Правила на кривій» (SOL-L8): the config of such a launch is a `ConfigWithTransferHook` whose program enforces
       * the rules. Until the rule program exists, is audited (SEC-3) and the operator opens the preset, nothing here
       * builds one: the refusal says so rather than quietly building a launch with no rules in it.
       */
      if (preset.id === CURVE_RULES_PRESET_ID || preset.curveRules !== undefined) {
        throw new LaunchRefusal("UNKNOWN_PRESET", "«Правила на кривій» is not built here: the rule program is not audited and the preset is not open.");
      }
      const transferFee = preset.transferFeeBps !== undefined ? transferFeeParametersOf(preset.transferFeeBps) : null;
      const fields: HonestConfigFields = {
        hasTransferHook: false,
        transferHookProgram: null,
        tokenType: curve.tokenType,
        tokenUpdateAuthority: curve.tokenUpdateAuthority,
        migrationOption: curve.migrationOption,
        partnerLiquidityPercentage: curve.partnerLiquidityPercentage,
        partnerPermanentLockedLiquidityPercentage: curve.partnerPermanentLockedLiquidityPercentage,
        partnerVestingPercentage: curve.partnerLiquidityVestingInfo?.vestingPercentage ?? 0,
        creatorLiquidityPercentage: curve.creatorLiquidityPercentage,
        creatorPermanentLockedLiquidityPercentage: curve.creatorPermanentLockedLiquidityPercentage,
        creatorVestingPercentage: curve.creatorLiquidityVestingInfo?.vestingPercentage ?? 0,
        lockedVestingAmount: new BN(curve.lockedVesting.amountPerPeriod).mul(new BN(curve.lockedVesting.numberOfPeriod)).add(new BN(curve.lockedVesting.cliffUnlockAmount)).toString(),
        baseFeeMode: curve.poolFees.baseFee.baseFeeMode,
        migratedCollectFeeMode: curve.migratedPoolFee.collectFeeMode,
        compoundingFeeBps: curve.compoundingFeeBps,
        migratedPoolBaseFeeMode: curve.migratedPoolBaseFeeMode,
        enableFirstSwapWithMinFee: curve.enableFirstSwapWithMinFee,
        preMigrationTokenSupply: str(curve.tokenSupply?.preMigrationTokenSupply ?? "0"),
        postMigrationTokenSupply: str(curve.tokenSupply?.postMigrationTokenSupply ?? "0"),
        /* «Комісія за переказ» (SOL-L10): «Розширений» only, the creator's rate under Ryntra's rule; every other config none. */
        transferFee: transferFee ? { flag: 1, bps: transferFee.transferFeeBasisPoints, withheldAuthority: transferFee.withheldAuthority, migratedAuthorityOption: transferFee.migratedTransferFeeAuthorityOption } : null,
      };
      const problems = honestLaunchProblems(fields);
      if (problems.length) throw new LaunchRefusal("CONFIG_NOT_HONEST", problems.join("; "));
      const config = configKey ?? Keypair.generate();
      const tx = await client.partner.createConfig({
        config: config.publicKey,
        feeClaimer: new PublicKey(feeClaimer),
        leftoverReceiver: new PublicKey(leftoverReceiver),
        payer: new PublicKey(payer),
        quoteMint: new PublicKey(quote.mint),
        ...curve,
        ...(transferFee ? { transferFeeParameters: transferFee } : {}),
      });
      const sealed = await seal(tx, new PublicKey(payer), [config]);
      return { ...sealed, config: config.publicKey.toBase58(), migrationQuoteThresholdRaw: curve.migrationQuoteThreshold.toString(), fields };
    },

    async create(params: LaunchParams, options: Readonly<{ creatorCoversPayer?: boolean; feeShares?: readonly FeeShare[]; crew?: boolean; custom?: LaunchPreset }> = {}): Promise<LaunchBuild> {
      const preset = customOr(params.preset, options.custom);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${params.preset}».`);
      /* Ryntra's pool payer pays and signs every Ryntra launch: that signature is what makes a pool on a public config Ryntra's. */
      if (!args.poolPayer) throw new LaunchRefusal("NO_POOL_PAYER", "Ryntra's pool payer is not configured on this network.");
      if (params.payer && params.payer !== args.poolPayer) throw new LaunchRefusal("NO_POOL_PAYER", "A Ryntra launch is paid by Ryntra's pool payer only.");
      const fields = await configFor(preset, params.pairMint);
      const problems = honestLaunchProblems(fields);
      if (problems.length) throw new LaunchRefusal("CONFIG_NOT_HONEST", problems.join("; "));
      const config = new PublicKey(fields.config);
      const configState = await configOf(config);
      /* «Розширений»'s config is made for the launch: it is Ryntra's only when it names Ryntra's partner vault. */
      if (preset.id === "advanced" && (!args.advancedFeeClaimer || configState.feeClaimer.toBase58() !== args.advancedFeeClaimer)) {
        throw new LaunchRefusal("CONFIG_NOT_HONEST", "the config does not name Ryntra's partner vault as its fee claimer");
      }
      const mint = Keypair.generate();
      const creator = new PublicKey(params.creator);
      const payer = new PublicKey(args.poolPayer);
      const buyRaw = new BN(params.creatorFirstBuyRaw ?? "0");
      if (preset.transferFeeBps !== undefined && client.sdk !== "2.0.0") throw new LaunchRefusal("CONFIG_NOT_HONEST", "a transfer-fee launch is built only on DBC SDK 2.0.0");
      let outRaw = new BN(0);
      /* «Комісія за переказ» (SOL-L10): what reaches the creator's wallet — the curve's output less the fee withheld on it. */
      let netRaw = new BN(0);
      if (buyRaw.gtn(0)) {
        /* The purchase lands on the curve this same transaction opens: no trade can come before it, so the quote is the outcome. */
        const quote = firstBuyQuoteOf(configState, buyRaw, preset);
        outRaw = quote.grossRaw;
        netRaw = quote.netRaw;
        /* «Розширений»'s supply is its config's; every other preset's cap is its own, as before it. The cap holds the curve's output. */
        const cap = creatorFirstBuyCapRaw(preset, preset.id === "advanced" ? supplyOf(fields) : undefined);
        if (BigInt(outRaw.toString()) > cap) {
          throw new LaunchRefusal("CREATOR_BUY_ABOVE_CAP", `The creator's first purchase would receive ${outRaw.toString()} of a cap of ${cap.toString()}.`);
        }
      }
      const createPoolParam = { name: params.name, symbol: params.symbol, uri: params.metadataUri, payer, poolCreator: creator, config, baseMint: mint.publicKey };
      const tx = buyRaw.gtn(0)
        ? await client.creator.createPoolWithFirstBuy({
            createPoolParam,
            /* minimumAmountOut is the quoted amount itself: the transaction fails rather than land above or below it.
               No referral account, on purpose: with one the program does not grant the first swap its minimum fee, and the
               creator's purchase pays the curve's opening fee instead — on a protected curve about half the tokens
               (measured on devnet 2026-10-08: 99 990 699 114 raw instead of 197 960 754 204 for 1 USDC). A referral is a
               fifth of Meteora's part; it is never worth the creator's tokens. Every later trade carries it. */
            firstBuyParam: { buyer: creator, receiver: creator, buyAmount: buyRaw, minimumAmountOut: netRaw, referralTokenAccount: null },
          })
        : await client.creator.createPool(createPoolParam);
      let covered = 0n;
      let net: bigint | null = null;
      let creatorSpend: bigint | null = null;
      if (options.creatorCoversPayer) {
        /* What the payer spends is what the network says it spends: the simulated balance already counts the
           signatures' fee and the rent of each account the creation opens. The creator hands exactly that over first,
           in the same transaction; the sealed bytes are simulated again below and must leave the payer whole. */
        tx.feePayer = payer;
        tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
        covered = await payerSpend(tx, payer);
        tx.instructions.unshift(SystemProgram.transfer({ fromPubkey: creator, toPubkey: payer, lamports: covered }));
      }
      const sealed = await seal(tx, payer, [mint]);
      if (options.creatorCoversPayer) {
        const [payerSpent = 0n, creatorSpent = 0n] = await spendOf(Transaction.from(Buffer.from(sealed.wireBase64, "base64")), [payer, creator]);
        net = -payerSpent;
        creatorSpend = creatorSpent;
        /* Exactly even: the payer loses nothing and the creator hands over nothing beyond what the payer spends. */
        if (net !== 0n) throw new LaunchRefusal("PAYER_NOT_COVERED", `The pool payer's balance would change by ${net} lamports on this launch.`);
      }
      const poolAddress = deriveDbcPoolAddress(new PublicKey(fields.quoteMint), mint.publicKey, config).toBase58();
      let split: LaunchBuild["split"] = null;
      if (options.feeShares && options.feeShares.length > 0) {
        /* «Спільнота» shares the creator's fees in the community's token, and a crew (MC-2) on Classic and Protected in
           their pair: the vault's currency is the curve's pair either way. */
        const sharer = preset.id === "community" || (options.crew === true && (preset.id === "classic" || preset.id === "protected"));
        if (!sharer) throw new LaunchRefusal("CONFIG_NOT_HONEST", "Only «Спільнота» and a crew share the creator's fees.");
        const pairProgram = (await connection.getAccountInfo(new PublicKey(fields.quoteMint), "confirmed"))?.owner;
        if (!pairProgram) throw new LaunchRefusal("NO_CONFIG", "The pair currency could not be read.");
        const instructions = await feeSharingSplitInstructions({
          connection,
          token: mint.publicKey.toBase58(),
          pairMint: fields.quoteMint,
          pairProgram: pairProgram.toBase58(),
          creator: params.creator,
          pool: poolAddress,
          config: fields.config,
          shares: options.feeShares,
        });
        const splitTx = new Transaction().add(...instructions);
        splitTx.feePayer = creator;
        /* The creation's blockhash: both are signed in one wallet window and the split lands right after the creation. */
        splitTx.recentBlockhash = Transaction.from(Buffer.from(sealed.wireBase64, "base64")).recentBlockhash;
        splitTx.partialSign(mint);
        /* The vault's account and its token account, at the rent the network asks for their sizes, and one signature. */
        const tokenAccountBytes = pairProgram.equals(TOKEN_2022_PROGRAM_ID) ? 170 : 165;
        const rent = (await connection.getMinimumBalanceForRentExemption(FEE_VAULT_BYTES)) + (await connection.getMinimumBalanceForRentExemption(tokenAccountBytes));
        split = { wireBase64: toBase64(splitTx), vault: feeSharingVaultOf(mint.publicKey.toBase58(), fields.quoteMint), costLamports: String(rent + 5_000) };
      }
      return {
        ...sealed,
        split,
        token: mint.publicKey.toBase58(),
        pool: poolAddress,
        config: fields.config,
        pairMint: fields.quoteMint,
        /* What the creator's wallet holds after the creation — on a transfer-fee token the output less the fee withheld on it. */
        creatorFirstBuyOutRaw: netRaw.toString(),
        payerCoveredLamports: covered.toString(),
        payerNetLamports: net === null ? null : net.toString(),
        creatorSpendLamports: creatorSpend === null ? null : creatorSpend.toString(),
        mintKey: mint,
      };
    },

    async firstBuyQuote(presetId, amountInRaw, pairMint, custom) {
      const preset = customOr(presetId, custom);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${presetId}».`);
      const fields = await configFor(preset, pairMint);
      const configState = await configOf(new PublicKey(fields.config));
      const cap = creatorFirstBuyCapRaw(preset, preset.id === "advanced" ? supplyOf(fields) : undefined);
      const amount = new BN(amountInRaw);
      /* The curve's output, the gross of a transfer-fee token: the cap holds it, and the review says what the fee withholds of it. */
      const out = amount.gtn(0) ? firstBuyQuoteOf(configState, amount, preset).grossRaw : new BN(0);
      /* The most the creator may spend: the input that buys exactly the cap on the fresh curve, rounded down so it stays under. */
      const exact = client.pool.getQuoteFromOutputAmount({ config: configState, swapBaseForQuote: false, amountOut: new BN(cap.toString()), eligibleForFirstSwapWithMinFee: true, slippageBps: 0 });
      let maxIn = new BN(exact.includedFeeInputAmount.toString());
      while (maxIn.gtn(0)) {
        const got = BigInt(client.pool.getQuoteFromInputAmount({ config: configState, swapBaseForQuote: false, amountIn: maxIn, eligibleForFirstSwapWithMinFee: true, slippageBps: 0 }).outputAmount.toString());
        if (got <= cap) break;
        maxIn = maxIn.subn(1);
      }
      return {
        preset: preset.id,
        config: fields.config,
        pairMint: fields.quoteMint,
        amountInRaw: amount.toString(),
        tokensOutRaw: out.toString(),
        capRaw: cap.toString(),
        maxAmountInRaw: maxIn.toString(),
        withinCap: BigInt(out.toString()) <= cap,
      };
    },

    async progress(token: Address): Promise<CurveProgress> {
      const pool = await poolOf(token);
      const state = pool.account.poolState;
      const config = await configOf(state.config);
      const threshold = new BN(config.migrationQuoteThreshold.toString());
      const reserve = new BN(state.quoteReserve.toString());
      const progressBps = threshold.isZero() ? 0 : Math.min(10_000, reserve.muln(10_000).div(threshold).toNumber());
      return { token, progressBps, migrated: state.isMigrated === 1 };
    },

    async claimFeeInstructions(role, token, kind = "curve", options = {}) {
      const pool = await poolOf(token);
      const state = pool.account.poolState;
      const config = await configOf(state.config);
      const signer = role === "partner" ? config.feeClaimer : state.creator;
      if (kind === "curve") {
        const tx =
          role === "partner"
            ? await client.partner.claimPartnerTradingFee({ feeClaimer: signer, payer: signer, pool: pool.publicKey, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX })
            : await client.creator.claimCreatorTradingFee({ creator: signer, payer: signer, pool: pool.publicKey, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX });
        return tx.instructions;
      }
      if (kind === "graduation") {
        const tx =
          role === "partner"
            ? await client.partner.partnerWithdrawMigrationFee({ pool: pool.publicKey, sender: signer })
            : await client.creator.creatorWithdrawMigrationFee({ pool: pool.publicKey, sender: signer });
        return tx.instructions;
      }
      if (kind === "surplus") {
        /* What the last purchase raised above the threshold, the role's share by Meteora's formula: once the curve is full. */
        if (state.isMigrated !== 1 && Number(state.finishCurveTimestamp.toString()) <= 0) throw new LaunchRefusal("NOT_GRADUATED", "The curve is not full yet.");
        const tx =
          role === "partner"
            ? await client.partner.partnerWithdrawSurplus({ feeClaimer: signer, pool: pool.publicKey })
            : await client.creator.creatorWithdrawSurplus({ creator: signer, pool: pool.publicKey });
        return tx.instructions;
      }
      /* The locked LP's fee in the graduated pool: the position stays locked; only its fee moves, to its owner. */
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      if (!dammConfig || state.isMigrated !== 1) throw new LaunchRefusal("NOT_GRADUATED", "The curve has not graduated.");
      const dammPool = deriveDammV2PoolAddress(dammConfig, new PublicKey(token), config.quoteMint);
      let found = options.position ?? null;
      if (!found && !options.fromExit) {
        /* As before SOL-L1d: the node's index of the signer's positions in the graduated pool. */
        const indexed = (await cpAmm.getUserPositionByPool(dammPool, signer))[0];
        if (!indexed) throw new LaunchRefusal("NO_POSITION", `No position of ${signer.toBase58()} in the graduated pool.`);
        found = { position: indexed.position.toBase58(), positionNftAccount: indexed.positionNftAccount.toBase58() };
      }
      if (!found) {
        const finished = Number(state.finishCurveTimestamp.toString());
        const exit = await readExitPositions({ connection, curve: pool.publicKey.toBase58(), pool: dammPool.toBase58(), finishedAt: finished > 0 ? finished : null });
        const mine = exit.positions.find((position) => position.owner === signer.toBase58());
        found = mine ? { position: mine.position, positionNftAccount: mine.nftAccount } : null;
      }
      if (!found) throw new LaunchRefusal("NO_POSITION", `No exit position of ${signer.toBase58()} in the graduated pool.`);
      const poolState = await cpAmm.fetchPoolState(dammPool);
      const programOf = async (mint: PublicKey) => ((await connection.getAccountInfo(mint, "confirmed"))?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
      const tx = await cpAmm.claimPositionFee({
        owner: signer,
        position: new PublicKey(found.position),
        pool: dammPool,
        positionNftAccount: new PublicKey(found.positionNftAccount),
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram: await programOf(poolState.tokenAMint),
        tokenBProgram: await programOf(poolState.tokenBMint),
        feePayer: signer,
      });
      return tx.instructions;
    },

    async claimFees(role, token): Promise<UnsignedTx> {
      /* The partner is a multisig vault: it cannot sign a transaction, only execute one its members approved. */
      if (role === "partner") throw new LaunchRefusal("MULTISIG_SIGNS", "The partner claims through its multisig: wrap claimFeeInstructions in a vault transaction.");
      const pool = await poolOf(token);
      const instructions = await venue.claimFeeInstructions("creator", token, "curve");
      return seal(new Transaction().add(...instructions), pool.account.poolState.creator, []);
    },

    async migrate(token: Address, payer: Address): Promise<UnsignedTx> {
      const pool = await poolOf(token);
      const state = pool.account.poolState;
      if (state.isMigrated === 1) throw new LaunchRefusal("ALREADY_MIGRATED", "The curve has already graduated.");
      const config = await configOf(state.config);
      if (new BN(state.quoteReserve.toString()).lt(new BN(config.migrationQuoteThreshold.toString()))) {
        throw new LaunchRefusal("NOT_GRADUATED", "The curve has not reached its threshold.");
      }
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      if (!dammConfig) throw new LaunchRefusal("NO_CONFIG", "No DAMM v2 config for this migration fee option.");
      const built = await client.migration.migrateToDammV2({ payer: new PublicKey(payer), pool: pool.publicKey, dammConfig });
      return seal(built.transaction, new PublicKey(payer), [built.firstPositionNftKeypair, built.secondPositionNftKeypair]);
    },

    configFields: readConfig,
    configFieldsFromData,
    plainConfigFromData: (data: Buffer) => plainOf(decodeConfig("config", data)) as Record<string, unknown>,
    async plainConfig(config) {
      const data = await configAccount(new PublicKey(config));
      if (!data) throw new LaunchRefusal("NO_CONFIG", `No DBC config at ${config}.`);
      return plainOf(decodeConfig(config, data)) as Record<string, unknown>;
    },

    async observe(token: Address, hints = {}): Promise<LaunchObservation> {
      const pool = await poolOf(token);
      const state = pool.account.poolState;
      const config = await configOf(state.config);
      const configFields = await readConfig(state.config.toBase58());
      const mintKey = new PublicKey(token);
      const mintInfo = await connection.getAccountInfo(mintKey, "confirmed");
      if (!mintInfo) throw new LaunchRefusal("NO_POOL", `No mint at ${token}.`);
      const program = mintInfo.owner;
      /* The mint from the bytes just read: one read of the account, not a second one that may fail on its own. */
      const mint = unpackMint(mintKey, mintInfo, program);
      const extensions = getExtensionTypes(mint.tlvData).map((type) => ExtensionType[type] ?? String(type));
      const hook = getTransferHook(mint);
      const pointer = getMetadataPointerState(mint);
      /* «Комісія за переказ» (SOL-L10): the rate in force depends on the epoch — read once, only for such a mint. */
      const mintFee = mintTransferFeeOf(mint);
      const transferFee = mintFee ? { mint: mintFee, epoch: String((await connection.getEpochInfo("confirmed")).epoch), poolAuthority: deriveDbcPoolAuthority().toBase58() } : null;
      /*
       * «Правила на кривій» (SOL-L8): the mint's own hook, with DBC's pool authority, which holds it on the curve. The
       * extension stays on the mint after the DEX with no program in it, so it is read whenever the mint carries it.
       */
      const hookProgram = hook && !hook.programId.equals(PublicKey.default) ? hook.programId.toBase58() : null;
      const hookAuthority = hook && hook.authority && !hook.authority.equals(PublicKey.default) ? hook.authority.toBase58() : null;
      const transferHook = hook ? { mint: { program: hookProgram, authority: hookAuthority }, poolAuthority: deriveDbcPoolAuthority().toBase58() } : null;
      /*
       * The metadata from the same bytes (`./mint-metadata.ts`): no second request that could fail on its own and hide the
       * marks the first one read. Bytes that are not the interface's layout are refused, never «fixed».
       */
      let metadataRead: MetadataRead = "MISSING";
      let metadata: MintMetadata | null = null;
      if (program.equals(TOKEN_2022_PROGRAM_ID)) {
        const bytes = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
        if (bytes) {
          try {
            metadata = mintMetadataOf(bytes);
            metadataRead = "OK";
          } catch {
            /* The bytes were read and never change: metadata that is not the interface's layout is the chain's fact. */
            metadataRead = "INVALID";
          }
        }
      }
      const threshold = new BN(config.migrationQuoteThreshold.toString());
      const reserve = new BN(state.quoteReserve.toString());
      const migrated = state.isMigrated === 1;
      let graduated: LaunchObservation["graduated"] = null;
      if (migrated) {
        /* The graduated pool's address follows from the migration config and the two mints. Its locked liquidity is the
           exit — the positions the move to the DEX opened, found from the move itself —: a position anyone (the creator
           too) entered later is a holder's, never the exit's, and nothing here asks a node for a wallet's positions. */
        const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
        const dammPool = dammConfig ? deriveDammV2PoolAddress(dammConfig, mintKey, config.quoteMint) : null;
        /* Absent is a fact the receipt judges; a read that failed throws and the receipt is not read. */
        const poolState = dammPool ? await (cpAmm._program as unknown as { account: { pool: { fetchNullable(address: PublicKey): Promise<Awaited<ReturnType<CpAmm["fetchPoolState"]>> | null> } } }).account.pool.fetchNullable(dammPool) : null;
        if (dammPool && poolState) {
          /* The exit not read leaves the rest of the receipt standing: the mint's marks were read; the pool's are said unread. */
          const known = typeof hints.exitSignature === "function" ? await hints.exitSignature().catch(() => null) : (hints.exitSignature ?? null);
          const exit = await readExitPositions({
            connection,
            readers: [args.archive, args.history],
            indexed: args.archive,
            curve: pool.publicKey.toBase58(),
            pool: dammPool.toBase58(),
            finishedAt: finishedAtOf(state),
            known,
          }).catch((error: unknown) => {
            if (error instanceof ExitUnread) return null;
            throw error;
          });
          const positions = (exit?.positions ?? []).map((entry) => ({
            position: entry.position,
            owner: entry.owner,
            permanentLockedLiquidity: str(entry.state.permanentLockedLiquidity),
            unlockedLiquidity: str(entry.state.unlockedLiquidity),
            vestedLiquidity: str(entry.state.vestedLiquidity),
          }));
          graduated = {
            pool: dammPool.toBase58(),
            collectFeeMode: Number(poolState.collectFeeMode),
            compoundingFeeBps: Number(poolState.poolFees.compoundingFeeBps),
            baseFeeMode: Number(getBaseFeeModeFromPodAlignedData(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))),
            tokenAReserveRaw: str(poolState.tokenAAmount),
            tokenBReserveRaw: str(poolState.tokenBAmount),
            liquidity: str(poolState.liquidity),
            /* What is locked across the pool, including the dead liquidity a compounding pool keeps. */
            poolPermanentLockedLiquidity: str(poolState.permanentLockLiquidity),
            positions,
            exitUnread: exit === null,
          };
        }
      }
      const roleOwner = state.creator.toBase58();
      const isVault = roleOwner === feeSharingVaultOf(token, config.quoteMint.toBase58());
      const feeSharing = isVault ? await observeFeeSharing(connection, roleOwner) : null;
      /* A read that fails is a failed read, never «another creator». */
      if (isVault && !feeSharing) throw new LaunchRefusal("NO_POOL", "The vault sharing the creator's fees could not be read.");
      return {
        token,
        pool: pool.publicKey.toBase58(),
        config: state.config.toBase58(),
        preset: presetOfConfig(state.config.toBase58(), config.feeClaimer),
        configSupplyRaw: configFields.preMigrationTokenSupply,
        configProblems: honestLaunchProblems(configFields, { curveRules: args.curveRules ?? null }),
        configTransferFee: configFields.transferFee ?? null,
        configRuleProgram: configFields.transferHookProgram ?? null,
        transferFee,
        transferHook,
        creator: roleOwner,
        feeSharing,
        mint: {
          program: program.toBase58(),
          supplyRaw: mint.supply.toString(),
          decimals: mint.decimals,
          mintAuthority: mint.mintAuthority?.toBase58() ?? null,
          freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
          extensions,
          transferHookProgram: hookProgram,
          metadataPointerAuthority: pointer?.authority?.toBase58() ?? null,
          metadataPointerAddress: pointer?.metadataAddress?.toBase58() ?? null,
          metadataRead,
          metadataUpdateAuthority: metadata?.updateAuthority ?? null,
          name: metadata?.name ?? null,
          symbol: metadata?.symbol ?? null,
          uri: metadata?.uri ?? null,
        },
        curve: {
          quoteVault: state.quoteVault.toBase58(),
          quoteReserveRaw: reserve.toString(),
          baseReserveRaw: str(state.baseReserve),
          migrationQuoteThresholdRaw: threshold.toString(),
          progressBps: threshold.isZero() ? 0 : Math.min(10_000, reserve.muln(10_000).div(threshold).toNumber()),
          migrated,
          migrationProgress: state.migrationProgress,
          partnerQuoteFeeRaw: str(state.partnerQuoteFee),
          creatorQuoteFeeRaw: str(state.creatorQuoteFee),
        },
        graduated,
      };
    },

    async presetCurveOf(token: Address): Promise<Address | null> {
      return (await curveOnPresets(token, true))?.toBase58() ?? null;
    },

    async observeCreation(signature: string, token: Address): Promise<CreationObservation> {
      let tx = await getTransactionAnyVersion(connection, signature);
      if (!tx && args.archive) tx = await getTransactionAnyVersion(args.archive, signature).catch(() => null);
      if (!tx?.meta) throw new LaunchRefusal("NO_POOL", `No transaction ${signature}.`);
      const message = tx.transaction.message;
      const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const key = (index: number) => keys.get(index)?.toBase58() ?? "";
      const signers = Array.from({ length: message.header.numRequiredSignatures }, (_, index) => key(index));
      /* The curve's own initialization in this transaction, read from its instruction's accounts — what it created and for whom.
         Only a top-level instruction counts: a creation through another program's call is not a Ryntra launch and reads as none. */
      let initialized: CreationObservation["initialized"] = null;
      for (const ix of message.compiledInstructions) {
        if (key(ix.programIdIndex) !== DBC_PROGRAM) continue;
        const layout = DBC_INITIALIZE.find((entry) => Buffer.from(ix.data.subarray(0, 8)).equals(entry.discriminator));
        if (!layout) continue;
        const account = (name: keyof typeof layout.accounts) => key(ix.accountKeyIndexes[layout.accounts[name]] ?? -1);
        initialized = { config: account("config"), creator: account("creator"), baseMint: account("baseMint"), pool: account("pool"), payer: account("payer") };
        break;
      }
      const creator = initialized?.creator ?? "";
      const quoteMint = initialized ? (await configOf(new PublicKey(initialized.config)).catch(() => null))?.quoteMint.toBase58() ?? "" : "";
      /* The creator's balances before and after, from the chain's own record of the transaction. */
      const delta = (mint: string) => {
        const sum = (list: typeof tx.meta.postTokenBalances) => (list ?? []).filter((entry) => entry.owner === creator && entry.mint === mint).reduce((total, entry) => total + BigInt(entry.uiTokenAmount.amount), 0n);
        return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
      };
      const quoteMoved = quoteMint ? delta(quoteMint) : 0n;
      return {
        signature,
        slot: tx.slot,
        blockTime: tx.blockTime ?? null,
        failed: tx.meta.err !== null,
        feePayer: signers[0] ?? "",
        signers,
        initialized,
        creator,
        creatorTokensOutRaw: (initialized ? delta(token) : 0n).toString(),
        creatorQuoteInRaw: (quoteMoved < 0n ? -quoteMoved : 0n).toString(),
      };
    },
  };
  return venue;
}
