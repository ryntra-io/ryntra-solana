/**
 * Ryntra Launch presets on Meteora DBC — Класичний · Захищений · Спільнота.
 *
 * A preset is the whole shape of a launch that a creator picks by name: the
 * pair currency, the curve, the fees on the curve and after it, who earns
 * what, and what is locked. On chain each preset is one DBC config, and a DBC
 * config never changes once created: every token
 * launched on it carries these numbers for ever. So the numbers live here,
 * once, and both the devnet rehearsal and the mainnet config are built from
 * this file — the rehearsal proves exactly the fields that are signed.
 *
 * What it carries: the protected curve — a sniper fee that falls
 * exponentially and a volatility fee; a compounding DAMM v2 pool from
 * graduation, its fee falling with market cap; and «Чесний лаунч» — no pool
 * can be pulled by construction, and a dump is costly and visible.
 *
 * Pure and client-safe: numbers and rules only, no SDK, no network. The SDK's
 * enums are mirrored as plain numbers; `presets.test.mjs` checks the mirror
 * against the SDK so a renumbering upstream fails a test, not a launch.
 */

/* ------------------------------------------------- the SDK's numbers */

/** `TokenType` */
export const DBC_TOKEN_TYPE = { SPL: 0, TOKEN_2022: 1 } as const;
/** `TokenAuthorityOption` — who may update metadata or mint; `IMMUTABLE` is no one. */
export const DBC_TOKEN_AUTHORITY = { CREATOR_UPDATE: 0, IMMUTABLE: 1, PARTNER_UPDATE: 2, CREATOR_UPDATE_AND_MINT: 3, PARTNER_UPDATE_AND_MINT: 4 } as const;
/** `BaseFeeMode` on the curve. */
export const DBC_BASE_FEE_MODE = { SCHEDULER_LINEAR: 0, SCHEDULER_EXPONENTIAL: 1 } as const;
/** `CollectFeeMode` on the curve. */
export const DBC_COLLECT_FEE_MODE = { QUOTE: 0, OUTPUT: 1 } as const;
/** `MigrationOption` — DAMM v2 is the only target for a new config. */
export const DBC_MIGRATION_OPTION = { DAMM_V2: 1 } as const;
/** `MigrationFeeOption` — `CUSTOMIZABLE` lets the config set the graduated pool's fees. */
export const DBC_MIGRATION_FEE_OPTION = { CUSTOMIZABLE: 6 } as const;
/** `MigratedCollectFeeMode` — `COMPOUNDING` reinvests a share of LP fees into the pool. */
export const DAMM_V2_COLLECT_FEE_MODE = { QUOTE: 0, OUTPUT: 1, COMPOUNDING: 2 } as const;
/** `DammV2BaseFeeMode` — the graduated pool's fee falls as its market cap grows. */
export const DAMM_V2_BASE_FEE_MODE = { MARKET_CAP_LINEAR: 3, MARKET_CAP_EXPONENTIAL: 4 } as const;
/** `ActivationType` */
export const DBC_ACTIVATION = { SLOT: 0, TIMESTAMP: 1 } as const;

/* ----------------------------------------------------------- presets */

export const LAUNCH_PRESET_IDS = ["classic", "protected", "community"] as const;
export type LaunchPresetId = (typeof LAUNCH_PRESET_IDS)[number];

/** What the pair is quoted in: USDC, or — «Спільнота» — the community's own token. */
export type PairCurrency = "USDC" | "COMMUNITY_TOKEN";

export type LaunchPreset = Readonly<{
  id: LaunchPresetId;
  /** The name a person reads, in Ukrainian and English. */
  name: Readonly<{ uk: string; en: string }>;
  pair: PairCurrency;
  token: Readonly<{
    /** Token-2022 with its metadata in the mint; no transfer hook. */
    type: (typeof DBC_TOKEN_TYPE)["TOKEN_2022"];
    decimals: 6;
    /** Whole tokens, fixed: the mint authority is revoked at creation. */
    supply: 1_000_000_000;
    /** Metadata no one can change. */
    authority: (typeof DBC_TOKEN_AUTHORITY)["IMMUTABLE"];
  }>;
  /** The curve by market cap in US dollars; for a community pair converted at the token's price when its config is made. */
  curve: Readonly<{ startMarketCapUsd: number; graduationMarketCapUsd: number }>;
  /** The fee on the curve: high for the first minutes and falling exponentially — snipers pay the creator and Ryntra. */
  sniperFee: Readonly<{ startBps: number; endBps: number; periods: number; seconds: number }>;
  /** A volatility fee on top of the base fee, on the curve and in the graduated pool. */
  dynamicFee: true;
  /** The creator's share of the curve's fee after Meteora's 20 %; Ryntra as partner keeps the rest (plan §4.3). */
  creatorTradingFeePct: number;
  /** A fee charged on graduation from the quote raised, split between creator and partner (plan §3.3: «помірна»). */
  graduationFee: Readonly<{ pct: number; creatorPct: number }>;
  /** The graduated DAMM v2 pool: compounding from its first trade, its fee falling with market cap. */
  graduatedPool: Readonly<{
    collectFeeMode: (typeof DAMM_V2_COLLECT_FEE_MODE)["COMPOUNDING"];
    /** Share of the LP fee reinvested into the pool, basis points of 10 000. */
    compoundingFeeBps: number;
    startFeeBps: number;
    endFeeBps: number;
    /** The fee reaches its end when the price has multiplied by this much since graduation… */
    priceMultiple: number;
    periods: number;
    /** …or when this long has passed, whichever is first. */
    expiresAfterSeconds: number;
  }>;
  /** Who owns the graduated pool's liquidity — every share locked for ever, the creator's and Ryntra's alike. */
  lp: Readonly<{ partnerLockedPct: number; creatorLockedPct: number }>;
  /** Ryntra's rule in the creation transaction, not a config field: the creator's first purchase receives at most this share of supply. */
  creatorFirstBuyCapBps: number;
  /** A creation fee paid by the person who launches; zero — launching costs only the network's rent. */
  poolCreationFeeLamports: 0;
}>;

const TOKEN = { type: DBC_TOKEN_TYPE.TOKEN_2022, decimals: 6, supply: 1_000_000_000, authority: DBC_TOKEN_AUTHORITY.IMMUTABLE } as const;
const CURVE = { startMarketCapUsd: 5_000, graduationMarketCapUsd: 75_000 } as const;
const GRADUATED_POOL = {
  collectFeeMode: DAMM_V2_COLLECT_FEE_MODE.COMPOUNDING,
  compoundingFeeBps: 5_000,
  startFeeBps: 200,
  endFeeBps: 50,
  priceMultiple: 10,
  periods: 20,
  expiresAfterSeconds: 30 * 24 * 60 * 60,
} as const;
const LP = { partnerLockedPct: 50, creatorLockedPct: 50 } as const;

export const LAUNCH_PRESETS: Readonly<Record<LaunchPresetId, LaunchPreset>> = Object.freeze({
  classic: {
    id: "classic",
    name: { uk: "Класичний", en: "Classic" },
    pair: "USDC",
    token: TOKEN,
    curve: CURVE,
    sniperFee: { startBps: 2_000, endBps: 100, periods: 30, seconds: 120 },
    dynamicFee: true,
    creatorTradingFeePct: 40,
    graduationFee: { pct: 2, creatorPct: 40 },
    graduatedPool: GRADUATED_POOL,
    lp: LP,
    creatorFirstBuyCapBps: 500,
    poolCreationFeeLamports: 0,
  },
  protected: {
    id: "protected",
    name: { uk: "Захищений", en: "Protected" },
    pair: "USDC",
    token: TOKEN,
    curve: CURVE,
    sniperFee: { startBps: 5_000, endBps: 100, periods: 60, seconds: 600 },
    dynamicFee: true,
    creatorTradingFeePct: 40,
    graduationFee: { pct: 2, creatorPct: 40 },
    graduatedPool: GRADUATED_POOL,
    lp: LP,
    creatorFirstBuyCapBps: 200,
    poolCreationFeeLamports: 0,
  },
  community: {
    id: "community",
    name: { uk: "Спільнота", en: "Community" },
    pair: "COMMUNITY_TOKEN",
    token: TOKEN,
    curve: CURVE,
    sniperFee: { startBps: 2_000, endBps: 100, periods: 30, seconds: 120 },
    dynamicFee: true,
    creatorTradingFeePct: 40,
    graduationFee: { pct: 2, creatorPct: 40 },
    graduatedPool: GRADUATED_POOL,
    lp: LP,
    creatorFirstBuyCapBps: 500,
    poolCreationFeeLamports: 0,
  },
});

export function launchPreset(id: string): LaunchPreset | null {
  return (LAUNCH_PRESET_IDS as readonly string[]).includes(id) ? LAUNCH_PRESETS[id as LaunchPresetId] : null;
}

/* --------------------------------------------- the curve's input */

/** The quote a config is made for: its mint, decimals and — for a community pair — its dollar price. */
export type PresetQuote = Readonly<{ mint: string; decimals: number; usdPrice: number }>;

/**
 * The plain input of the SDK's `buildCurveWithMarketCap` for a preset and a
 * quote — enums as their numbers, amounts in whole units, market caps in the
 * quote. The server adapter hands it to the SDK as it is.
 */
export function presetCurveInput(preset: LaunchPreset, quote: PresetQuote) {
  if (!(quote.usdPrice > 0)) throw new Error("A config needs the pair currency's dollar price.");
  if (preset.pair === "USDC" && quote.usdPrice !== 1) throw new Error("A USDC pair is priced at one dollar.");
  const inQuote = (usd: number) => usd / quote.usdPrice;
  return {
    token: {
      tokenType: preset.token.type,
      tokenBaseDecimal: preset.token.decimals,
      tokenQuoteDecimal: quote.decimals,
      tokenAuthorityOption: preset.token.authority,
      totalTokenSupply: preset.token.supply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: DBC_BASE_FEE_MODE.SCHEDULER_EXPONENTIAL,
        feeSchedulerParam: {
          startingFeeBps: preset.sniperFee.startBps,
          endingFeeBps: preset.sniperFee.endBps,
          numberOfPeriod: preset.sniperFee.periods,
          totalDuration: preset.sniperFee.seconds,
        },
      },
      dynamicFeeEnabled: preset.dynamicFee,
      collectFeeMode: DBC_COLLECT_FEE_MODE.QUOTE,
      creatorTradingFeePercentage: preset.creatorTradingFeePct,
      poolCreationFee: preset.poolCreationFeeLamports,
      /* The creator's first purchase, in the creation transaction itself, pays the end fee, not the sniper fee. */
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: DBC_MIGRATION_OPTION.DAMM_V2,
      migrationFeeOption: DBC_MIGRATION_FEE_OPTION.CUSTOMIZABLE,
      migrationFee: { feePercentage: preset.graduationFee.pct, creatorFeePercentage: preset.graduationFee.creatorPct },
      migratedPoolFee: {
        collectFeeMode: preset.graduatedPool.collectFeeMode,
        dynamicFee: 1,
        poolFeeBps: preset.graduatedPool.startFeeBps,
        compoundingFeeBps: preset.graduatedPool.compoundingFeeBps,
        baseFeeMode: DAMM_V2_BASE_FEE_MODE.MARKET_CAP_EXPONENTIAL,
        marketCapFeeSchedulerParams: {
          endingBaseFeeBps: preset.graduatedPool.endFeeBps,
          numberOfPeriod: preset.graduatedPool.periods,
          priceMultiple: preset.graduatedPool.priceMultiple,
          schedulerExpirationDuration: preset.graduatedPool.expiresAfterSeconds,
        },
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: preset.lp.partnerLockedPct,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: preset.lp.creatorLockedPct,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: DBC_ACTIVATION.TIMESTAMP,
    initialMarketCap: inQuote(preset.curve.startMarketCapUsd),
    migrationMarketCap: inQuote(preset.curve.graduationMarketCapUsd),
  };
}

/* ------------------------------------------------ «Чесний лаунч» */

/**
 * The fields of a created config «Чесний лаунч» is judged on — as the program
 * stores them (`PoolConfig`), read back from the chain, numbers as numbers.
 */
export type HonestConfigFields = Readonly<{
  /** True for a `ConfigWithTransferHook`: a hook config is never a preset. */
  hasTransferHook: boolean;
  tokenType: number;
  tokenUpdateAuthority: number;
  migrationOption: number;
  partnerLiquidityPercentage: number;
  partnerPermanentLockedLiquidityPercentage: number;
  partnerVestingPercentage: number;
  creatorLiquidityPercentage: number;
  creatorPermanentLockedLiquidityPercentage: number;
  creatorVestingPercentage: number;
  /** Base tokens vested to the creator after graduation; zero — no allocation outside the curve. */
  lockedVestingAmount: string;
  baseFeeMode: number;
  migratedCollectFeeMode: number;
  compoundingFeeBps: number;
  migratedPoolBaseFeeMode: number;
  enableFirstSwapWithMinFee: boolean;
  /** The supply before and after graduation, raw: equal — graduation mints nothing. */
  preMigrationTokenSupply: string;
  postMigrationTokenSupply: string;
}>;

/**
 * What would break «Чесний лаунч» in a config, each in a plain line; an empty
 * list means the config keeps every rule. Checked before the mainnet config
 * is offered for signature and again on the config read back from the chain.
 */
export function honestLaunchProblems(config: HonestConfigFields): readonly string[] {
  const problems: string[] = [];
  if (config.hasTransferHook) problems.push("a transfer-hook config: the creator or partner could keep mint or update rights");
  if (config.tokenType !== DBC_TOKEN_TYPE.TOKEN_2022) problems.push("the token is not Token-2022");
  if (config.tokenUpdateAuthority !== DBC_TOKEN_AUTHORITY.IMMUTABLE) problems.push("the metadata can be changed");
  if (config.migrationOption !== DBC_MIGRATION_OPTION.DAMM_V2) problems.push("graduation is not to DAMM v2");
  if (config.partnerLiquidityPercentage !== 0 || config.creatorLiquidityPercentage !== 0) problems.push("part of the graduated liquidity is unlocked");
  if (config.partnerVestingPercentage !== 0 || config.creatorVestingPercentage !== 0) problems.push("part of the graduated liquidity only vests");
  if (config.partnerPermanentLockedLiquidityPercentage + config.creatorPermanentLockedLiquidityPercentage !== 100) problems.push("the locked liquidity is not 100 %");
  if (config.lockedVestingAmount !== "0") problems.push("tokens are allocated outside the curve");
  if (config.baseFeeMode !== DBC_BASE_FEE_MODE.SCHEDULER_EXPONENTIAL) problems.push("the sniper fee is not exponential");
  if (config.migratedCollectFeeMode !== DAMM_V2_COLLECT_FEE_MODE.COMPOUNDING || config.compoundingFeeBps <= 0) problems.push("the graduated pool does not compound");
  if (config.migratedPoolBaseFeeMode !== DAMM_V2_BASE_FEE_MODE.MARKET_CAP_EXPONENTIAL) problems.push("the graduated pool's fee does not fall with market cap");
  if (!config.enableFirstSwapWithMinFee) problems.push("the creator's first purchase would pay the sniper fee");
  if (config.preMigrationTokenSupply !== config.postMigrationTokenSupply) problems.push("the supply changes at graduation");
  return problems;
}

/** The most tokens, in raw units, the creator's first purchase may receive under a preset. */
export function creatorFirstBuyCapRaw(preset: LaunchPreset): bigint {
  const supplyRaw = BigInt(preset.token.supply) * 10n ** BigInt(preset.token.decimals);
  return (supplyRaw * BigInt(preset.creatorFirstBuyCapBps)) / 10_000n;
}
