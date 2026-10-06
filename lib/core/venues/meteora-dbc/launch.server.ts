/**
 * Meteora DBC as a launch venue of the core — Ryntra Launch's first venue.
 *
 * The adapter speaks to the dynamic bonding curve through Meteora's own SDK
 * and returns bytes for a wallet to sign, never a signature of its own: the
 * one key it ever holds is a fresh account's — the new token's mint, the new
 * config, a graduated position's NFT — made for that transaction and signed
 * into it before the bytes leave, so the wallet signs a complete message.
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
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  type BuildCurveWithMarketCapParams,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  getMetadataPointerState,
  getMint,
  getTokenMetadata,
  getTransferHook,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address, CurveProgress, LaunchParams, LaunchVenue, UnsignedTx } from "../../contracts.ts";
import type { FeeShare } from "../../launch/fee-shares.ts";
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
  }>;

/** What the creator's first purchase would buy on a fresh curve: the tokens for an amount, or the most it may spend under the cap. */
export type FirstBuyQuote = Readonly<{ preset: LaunchPresetId; config: Address; pairMint: Address; amountInRaw: string; tokensOutRaw: string; capRaw: string; maxAmountInRaw: string; withinCap: boolean }>;

/** A built config: the bytes, the config's address, and the curve's own numbers. */
export type ConfigBuild = UnsignedTx & Readonly<{ config: Address; migrationQuoteThresholdRaw: string; fields: HonestConfigFields }>;

/** Which fee a claim collects: the curve's trading fee, the graduation fee, or the locked LP's fee in the graduated pool. */
export type FeeKind = "curve" | "graduation" | "lp";

export type MeteoraDbcLaunchVenue = LaunchVenue &
  Readonly<{
    buildConfig(args: Readonly<{ preset: LaunchPresetId; quote: PresetQuote; feeClaimer: Address; leftoverReceiver: Address; payer: Address; /** The config account's own fresh key, kept by the caller so a retried signature keeps one address; absent, a new one. */ configKey?: Keypair }>): Promise<ConfigBuild>;
    /**
     * The token and the creator's first purchase. With `creatorCoversPayer`
     * the creator's first instruction pays Ryntra's pool payer back the rent
     * and fee the simulation shows it spending, and the sealed bytes are
     * simulated again: a payer that would still lose lamports refuses the build.
     */
    create(params: LaunchParams, options?: Readonly<{ creatorCoversPayer?: boolean; feeShares?: readonly FeeShare[] }>): Promise<LaunchBuild>;
    firstBuyQuote(preset: LaunchPresetId, amountInRaw: string, pairMint?: Address): Promise<FirstBuyQuote>;
    /** The instructions of a fee claim, for the signer to wrap — the partner's multisig wraps them in a vault transaction. */
    claimFeeInstructions(role: "partner" | "creator", token: Address, kind?: FeeKind): Promise<readonly TransactionInstruction[]>;
    migrate(token: Address, payer: Address): Promise<UnsignedTx>;
    configFields(config: Address): Promise<ConfigFields>;
    configFieldsFromData(config: Address, data: Buffer): ConfigFields;
    /** Every field of a config account, plain — keys to base58, numbers to decimal strings — for a whole-account comparison. */
    plainConfigFromData(data: Buffer): Record<string, unknown>;
    observe(token: Address): Promise<LaunchObservation>;
    observeCreation(signature: string, token: Address): Promise<CreationObservation>;
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
export type MetadataRead = "OK" | "MISSING" | "FAILED";

/** A launch as the chain shows it. */
export type LaunchObservation = Readonly<{
  token: Address;
  pool: Address;
  config: Address;
  /** The preset whose configured config the curve sits on; null for a config Ryntra did not name. */
  preset: LaunchPresetId | null;
  /** What breaks «Чесний лаунч» in that config as the chain stores it. */
  configProblems: readonly string[];
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
  /** After graduation: the DAMM v2 pool and each position with its owner. */
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

/** The fields of a created config, read from its account. */
export function configFieldsOf(config: Address, state: PoolConfig, hasTransferHook: boolean): ConfigFields {
  const partnerVesting = state.partnerLiquidityVestingInfo;
  const creatorVesting = state.creatorLiquidityVestingInfo;
  const locked = state.lockedVestingConfig;
  const lockedAmount = new BN(locked.amountPerPeriod).mul(new BN(locked.numberOfPeriod)).add(new BN(locked.cliffUnlockAmount));
  const baseFee = state.poolFees.baseFee;
  return {
    config,
    hasTransferHook,
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

/** The SDK's curve for a preset, its enums cast from the mirrored numbers. */
export function presetCurve(preset: LaunchPreset, quote: PresetQuote) {
  return buildCurveWithMarketCap(presetCurveInput(preset, quote) as unknown as BuildCurveWithMarketCapParams);
}

/** A preset's configs on a network: one for a USDC preset, one per community token for «Спільнота». */
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
}>): MeteoraDbcLaunchVenue {
  const { connection, configs } = args;
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const cpAmm = new CpAmm(connection);
  const allConfigs = () => LAUNCH_PRESET_IDS.flatMap((id) => configsOfPreset(configs, id).map((config) => ({ preset: id, config })));
  const presetOfConfig = (config: Address): LaunchPresetId | null => allConfigs().find((entry) => entry.config === config)?.preset ?? null;

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

  async function configOf(config: PublicKey): Promise<PoolConfig> {
    const data = await configAccount(config);
    if (!data) throw new LaunchRefusal("NO_CONFIG", `No DBC config at ${config.toBase58()}.`);
    const coder = accountsCoder();
    const head = Buffer.from(data.subarray(0, 8));
    const name = head.equals(Buffer.from(coder.accountDiscriminator("configWithTransferHook"))) ? "configWithTransferHook" : "poolConfig";
    return coder.decode<PoolConfig>(name, data);
  }

  async function poolOf(token: Address) {
    const baseMint = new PublicKey(token);
    /* A Ryntra launch sits on one of the presets' configs: its curve's address follows from it, read directly. */
    const candidates = (await Promise.all(allConfigs().map(async ({ config: address }) => {
      const config = await configOf(new PublicKey(address)).catch(() => null);
      return config ? deriveDbcPoolAddress(config.quoteMint, baseMint, new PublicKey(address)) : null;
    }))).filter((address): address is PublicKey => address !== null);
    /* One read for every candidate curve: only the config the token was launched on has an account there. */
    const accounts = candidates.length ? await connection.getMultipleAccountsInfo(candidates, "confirmed").catch(() => []) : [];
    const found = accounts.findIndex((info) => info !== null);
    if (found >= 0) {
      const account = await client.state.getPool(candidates[found]!).catch(() => null);
      if (account) return { publicKey: candidates[found]!, account };
    }
    const pool = await client.state.getPoolByBaseMint(baseMint);
    if (!pool) throw new LaunchRefusal("NO_POOL", "No curve for this token.");
    return pool;
  }

  type AccountsCoder = { accountDiscriminator(name: string): Buffer; decode<T>(name: string, data: Buffer): T };
  const accountsCoder = () => (client.state.getProgram() as unknown as { coder: { accounts: AccountsCoder } }).coder.accounts;

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
      return { ...configFieldsOf(config, await configOf(new PublicKey(config)), true) };
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

  const venue: MeteoraDbcLaunchVenue = {
    venue: "meteora-dbc",

    async buildConfig({ preset: presetId, quote, feeClaimer, leftoverReceiver, payer, configKey }) {
      const preset = launchPreset(presetId);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${presetId}».`);
      const curve = presetCurve(preset, quote);
      const fields: HonestConfigFields = {
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
        lockedVestingAmount: new BN(curve.lockedVesting.amountPerPeriod).mul(new BN(curve.lockedVesting.numberOfPeriod)).add(new BN(curve.lockedVesting.cliffUnlockAmount)).toString(),
        baseFeeMode: curve.poolFees.baseFee.baseFeeMode,
        migratedCollectFeeMode: curve.migratedPoolFee.collectFeeMode,
        compoundingFeeBps: curve.compoundingFeeBps,
        migratedPoolBaseFeeMode: curve.migratedPoolBaseFeeMode,
        enableFirstSwapWithMinFee: curve.enableFirstSwapWithMinFee,
        preMigrationTokenSupply: str(curve.tokenSupply?.preMigrationTokenSupply ?? "0"),
        postMigrationTokenSupply: str(curve.tokenSupply?.postMigrationTokenSupply ?? "0"),
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
      });
      const sealed = await seal(tx, new PublicKey(payer), [config]);
      return { ...sealed, config: config.publicKey.toBase58(), migrationQuoteThresholdRaw: curve.migrationQuoteThreshold.toString(), fields };
    },

    async create(params: LaunchParams, options: Readonly<{ creatorCoversPayer?: boolean; feeShares?: readonly FeeShare[] }> = {}): Promise<LaunchBuild> {
      const preset = launchPreset(params.preset);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${params.preset}».`);
      /* Ryntra's pool payer pays and signs every Ryntra launch: that signature is what makes a pool on a public config Ryntra's. */
      if (!args.poolPayer) throw new LaunchRefusal("NO_POOL_PAYER", "Ryntra's pool payer is not configured on this network.");
      if (params.payer && params.payer !== args.poolPayer) throw new LaunchRefusal("NO_POOL_PAYER", "A Ryntra launch is paid by Ryntra's pool payer only.");
      const fields = await configFor(preset, params.pairMint);
      const problems = honestLaunchProblems(fields);
      if (problems.length) throw new LaunchRefusal("CONFIG_NOT_HONEST", problems.join("; "));
      const config = new PublicKey(fields.config);
      const configState = await configOf(config);
      const mint = Keypair.generate();
      const creator = new PublicKey(params.creator);
      const payer = new PublicKey(args.poolPayer);
      const buyRaw = new BN(params.creatorFirstBuyRaw ?? "0");
      let outRaw = new BN(0);
      if (buyRaw.gtn(0)) {
        /* The purchase lands on the curve this same transaction opens: no trade can come before it, so the quote is the outcome. */
        const quote = client.pool.getQuoteFromInputAmount({ config: configState, swapBaseForQuote: false, amountIn: buyRaw, eligibleForFirstSwapWithMinFee: true, slippageBps: 0 });
        outRaw = new BN(quote.outputAmount.toString());
        const cap = creatorFirstBuyCapRaw(preset);
        if (BigInt(outRaw.toString()) > cap) {
          throw new LaunchRefusal("CREATOR_BUY_ABOVE_CAP", `The creator's first purchase would receive ${outRaw.toString()} of a cap of ${cap.toString()}.`);
        }
      }
      const createPoolParam = { name: params.name, symbol: params.symbol, uri: params.metadataUri, payer, poolCreator: creator, config, baseMint: mint.publicKey };
      const tx = buyRaw.gtn(0)
        ? await client.creator.createPoolWithFirstBuy({
            createPoolParam,
            /* minimumAmountOut is the quoted amount itself: the transaction fails rather than land above or below it. */
            firstBuyParam: { buyer: creator, receiver: creator, buyAmount: buyRaw, minimumAmountOut: outRaw, referralTokenAccount: null },
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
        /* Only «Спільнота» shares the creator's fees: its pair is the community's token, the vault's currency. */
        if (preset.id !== "community") throw new LaunchRefusal("CONFIG_NOT_HONEST", "Only «Спільнота» shares the creator's fees.");
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
        creatorFirstBuyOutRaw: outRaw.toString(),
        payerCoveredLamports: covered.toString(),
        payerNetLamports: net === null ? null : net.toString(),
        creatorSpendLamports: creatorSpend === null ? null : creatorSpend.toString(),
      };
    },

    async firstBuyQuote(presetId, amountInRaw, pairMint) {
      const preset = launchPreset(presetId);
      if (!preset) throw new LaunchRefusal("UNKNOWN_PRESET", `No preset «${presetId}».`);
      const fields = await configFor(preset, pairMint);
      const configState = await configOf(new PublicKey(fields.config));
      const cap = creatorFirstBuyCapRaw(preset);
      const amount = new BN(amountInRaw);
      const out = amount.gtn(0)
        ? new BN(client.pool.getQuoteFromInputAmount({ config: configState, swapBaseForQuote: false, amountIn: amount, eligibleForFirstSwapWithMinFee: true, slippageBps: 0 }).outputAmount.toString())
        : new BN(0);
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

    async claimFeeInstructions(role, token, kind = "curve") {
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
      /* The locked LP's fee in the graduated pool: the position stays locked; only its fee moves, to its owner. */
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      if (!dammConfig || state.isMigrated !== 1) throw new LaunchRefusal("NOT_GRADUATED", "The curve has not graduated.");
      const dammPool = deriveDammV2PoolAddress(dammConfig, new PublicKey(token), config.quoteMint);
      const found = (await cpAmm.getUserPositionByPool(dammPool, signer))[0];
      if (!found) throw new LaunchRefusal("NO_POSITION", `No position of ${signer.toBase58()} in the graduated pool.`);
      const poolState = await cpAmm.fetchPoolState(dammPool);
      const programOf = async (mint: PublicKey) => ((await connection.getAccountInfo(mint, "confirmed"))?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
      const tx = await cpAmm.claimPositionFee({
        owner: signer,
        position: found.position,
        pool: dammPool,
        positionNftAccount: found.positionNftAccount,
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

    async observe(token: Address): Promise<LaunchObservation> {
      const pool = await poolOf(token);
      const state = pool.account.poolState;
      const config = await configOf(state.config);
      const configFields = await readConfig(state.config.toBase58());
      const mintKey = new PublicKey(token);
      const mintInfo = await connection.getAccountInfo(mintKey, "confirmed");
      if (!mintInfo) throw new LaunchRefusal("NO_POOL", `No mint at ${token}.`);
      const program = mintInfo.owner;
      const mint = await getMint(connection, mintKey, "confirmed", program);
      const extensions = getExtensionTypes(mint.tlvData).map((type) => ExtensionType[type] ?? String(type));
      const hook = getTransferHook(mint);
      const pointer = getMetadataPointerState(mint);
      /* A read that fails is not «fixed metadata»: it is a read that failed, and the receipt refuses on it. */
      let metadataRead: MetadataRead = "MISSING";
      let metadata: Awaited<ReturnType<typeof getTokenMetadata>> = null;
      if (program.equals(TOKEN_2022_PROGRAM_ID)) {
        try {
          metadata = await getTokenMetadata(connection, mintKey, "confirmed");
          metadataRead = metadata ? "OK" : "MISSING";
        } catch {
          metadataRead = "FAILED";
        }
      }
      const threshold = new BN(config.migrationQuoteThreshold.toString());
      const reserve = new BN(state.quoteReserve.toString());
      const migrated = state.isMigrated === 1;
      let graduated: LaunchObservation["graduated"] = null;
      if (migrated) {
        /* The graduated pool's address follows from the migration config and the two mints; its positions belong to the
           two owners the config names — the partner's fee claimer and the curve's creator — so nothing scans a program. */
        const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
        const dammPool = dammConfig ? deriveDammV2PoolAddress(dammConfig, mintKey, config.quoteMint) : null;
        const poolState = dammPool ? await cpAmm.fetchPoolState(dammPool).catch(() => null) : null;
        if (dammPool && poolState) {
          const owners = [config.feeClaimer, state.creator];
          const positions = (
            await Promise.all(
              owners.map(async (holder) =>
                (await cpAmm.getUserPositionByPool(dammPool, holder)).map((entry) => ({
                  position: entry.position.toBase58(),
                  owner: holder.toBase58(),
                  permanentLockedLiquidity: str(entry.positionState.permanentLockedLiquidity),
                  unlockedLiquidity: str(entry.positionState.unlockedLiquidity),
                  vestedLiquidity: str(entry.positionState.vestedLiquidity),
                })),
              ),
            )
          ).flat();
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
        preset: presetOfConfig(state.config.toBase58()),
        configProblems: honestLaunchProblems(configFields),
        creator: roleOwner,
        feeSharing,
        mint: {
          program: program.toBase58(),
          supplyRaw: mint.supply.toString(),
          decimals: mint.decimals,
          mintAuthority: mint.mintAuthority?.toBase58() ?? null,
          freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
          extensions,
          transferHookProgram: hook && !hook.programId.equals(PublicKey.default) ? hook.programId.toBase58() : null,
          metadataPointerAuthority: pointer?.authority?.toBase58() ?? null,
          metadataPointerAddress: pointer?.metadataAddress?.toBase58() ?? null,
          metadataRead,
          metadataUpdateAuthority: metadata?.updateAuthority && !metadata.updateAuthority.equals(PublicKey.default) ? metadata.updateAuthority.toBase58() : null,
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

    async observeCreation(signature: string, token: Address): Promise<CreationObservation> {
      let tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx && args.archive) tx = await args.archive.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
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
