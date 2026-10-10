/**
 * Ryntra Launch presets on Meteora DBC — Класичний · Захищений · Спільнота ·
 * Micro, and the demo market Ryntra uses for its own technical validation.
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

export const LAUNCH_PRESET_IDS = ["classic", "protected", "community", "micro", "demo"] as const;
export type LaunchPresetId = (typeof LAUNCH_PRESET_IDS)[number];

/**
 * Who may launch on a preset: everyone, or only Ryntra's own wallets — the
 * demo market is a technical validation of the whole cycle, never offered to
 * people. On chain anyone can open a pool on a config, so Ryntra's own launch
 * is recognised by its creator, not by the config.
 */
export type PresetAudience = "people" | "internal";

/**
 * Who receives the partner's fees of a config: Ryntra's Squads vault, or —
 * Micro and the demo market — the launch executor's wallet, which takes the
 * migration fee, the partner's share of the surplus and of the trading fees and
 * the fees of the partner's locked DAMM v2 position itself, and keeps the
 * market's budget from them.
 */
export type PresetFeeClaimer = "multisig" | "executor";

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
  audience: PresetAudience;
  feeClaimer: PresetFeeClaimer;
  /**
   * The curve by market cap in US dollars; for a community pair converted at the token's price when its config is made.
   * A preset named by its threshold (`graduationQuote`) is built for that exact amount of the pair currency raised —
   * its market caps then follow from the threshold, the migration fee and the curve's multiple.
   */
  curve: Readonly<{ startMarketCapUsd: number; graduationMarketCapUsd: number; graduationQuote?: number }>;
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
  /**
   * Ryntra's rule beside the launch, not a config field: a creator's first purchase must go under the creator's lock
   * with at least this long before anything unlocks; null — the lock is the creator's choice.
   */
  creatorLockMinDays: number | null;
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

/** Classic's curve multiple: the graduation market cap is fifteen times the start. */
const CURVE_MULTIPLE = 15;

/**
 * The market caps of a curve that raises exactly `quote` of a USDC pair before graduation, with the migration fee
 * `feePct` taken from it and the graduation market cap `multiple` times the start — the inverse of the SDK's own
 * `buildCurveWithMarketCap`: the share of supply that migrates depends only on the multiple and the fee, so the
 * threshold fixes the market cap.
 */
export function thresholdCurve(quote: number, feePct: number, multiple: number) {
  const ratio = Math.sqrt(1 / multiple) * (1 - feePct / 100);
  const percentageSupplyOnMigration = (100 * ratio) / (1 + ratio);
  const graduationMarketCapUsd = (quote * (1 - feePct / 100) * 100) / percentageSupplyOnMigration;
  return { graduationQuote: quote, percentageSupplyOnMigration, graduationMarketCapUsd, startMarketCapUsd: graduationMarketCapUsd / multiple } as const;
}

/**
 * Micro — a small market for people: 750 USDC raised graduates it (Meteora's keepers migrate a USDC curve at 750 on
 * their own), the whole migration fee goes to the market's budget and none to the creator, the creator earns 40 % of the
 * curve's trading fees; the graduated pool's fee falls from 2 % to 0.25 % with its market cap and a quarter of the LP fee
 * compounds into the pool. Numbers of the operator's MarketOS document (§14), the creator's share.
 */
const MICRO_FEE = { pct: 8, creatorPct: 0 } as const;
const MICRO_CURVE = thresholdCurve(750, MICRO_FEE.pct, CURVE_MULTIPLE);
/** The demo market: as Micro, with 50 USDC to graduate and a 30 % migration fee, so a small market's budget lives on fees too. */
const DEMO_FEE = { pct: 30, creatorPct: 0 } as const;
const DEMO_CURVE = thresholdCurve(50, DEMO_FEE.pct, CURVE_MULTIPLE);
const MICRO_POOL = {
  collectFeeMode: DAMM_V2_COLLECT_FEE_MODE.COMPOUNDING,
  compoundingFeeBps: 2_500,
  startFeeBps: 200,
  endFeeBps: 25,
  priceMultiple: 10,
  periods: 20,
  expiresAfterSeconds: 30 * 24 * 60 * 60,
} as const;
/** Six months before any of a creator's first purchase unlocks. */
const CREATOR_LOCK_SIX_MONTHS = 180;

export const LAUNCH_PRESETS: Readonly<Record<LaunchPresetId, LaunchPreset>> = Object.freeze({
  classic: {
    id: "classic",
    audience: "people",
    feeClaimer: "multisig",
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
    creatorLockMinDays: null,
    poolCreationFeeLamports: 0,
  },
  protected: {
    id: "protected",
    audience: "people",
    feeClaimer: "multisig",
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
    creatorLockMinDays: null,
    poolCreationFeeLamports: 0,
  },
  community: {
    id: "community",
    audience: "people",
    feeClaimer: "multisig",
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
    creatorLockMinDays: null,
    poolCreationFeeLamports: 0,
  },
  micro: {
    id: "micro",
    name: { uk: "Micro", en: "Micro" },
    audience: "people",
    feeClaimer: "executor",
    pair: "USDC",
    token: TOKEN,
    curve: { startMarketCapUsd: MICRO_CURVE.startMarketCapUsd, graduationMarketCapUsd: MICRO_CURVE.graduationMarketCapUsd, graduationQuote: MICRO_CURVE.graduationQuote },
    sniperFee: { startBps: 2_000, endBps: 100, periods: 30, seconds: 120 },
    dynamicFee: true,
    creatorTradingFeePct: 40,
    graduationFee: MICRO_FEE,
    graduatedPool: MICRO_POOL,
    lp: LP,
    creatorFirstBuyCapBps: 200,
    creatorLockMinDays: CREATOR_LOCK_SIX_MONTHS,
    poolCreationFeeLamports: 0,
  },
  demo: {
    id: "demo",
    name: { uk: "Демо-ринок", en: "Demo market" },
    audience: "internal",
    feeClaimer: "executor",
    pair: "USDC",
    token: TOKEN,
    curve: { startMarketCapUsd: DEMO_CURVE.startMarketCapUsd, graduationMarketCapUsd: DEMO_CURVE.graduationMarketCapUsd, graduationQuote: DEMO_CURVE.graduationQuote },
    sniperFee: { startBps: 2_000, endBps: 100, periods: 30, seconds: 120 },
    dynamicFee: true,
    creatorTradingFeePct: 40,
    graduationFee: DEMO_FEE,
    graduatedPool: MICRO_POOL,
    lp: LP,
    creatorFirstBuyCapBps: 200,
    creatorLockMinDays: CREATOR_LOCK_SIX_MONTHS,
    poolCreationFeeLamports: 0,
  },
});

/** The presets a person may pick in the form: every one but the demo market. */
export const PEOPLE_PRESET_IDS: readonly LaunchPresetId[] = LAUNCH_PRESET_IDS.filter((id) => LAUNCH_PRESETS[id].audience === "people");

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
  const exact = preset.curve.graduationQuote === undefined ? null : thresholdCurve(preset.curve.graduationQuote, preset.graduationFee.pct, CURVE_MULTIPLE);
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
    /* A preset named by its threshold: the SDK's `buildCurve` takes the amount raised itself, exactly. */
    ...(exact ? { migrationQuoteThreshold: inQuote(exact.graduationQuote), percentageSupplyOnMigration: exact.percentageSupplyOnMigration } : {}),
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
