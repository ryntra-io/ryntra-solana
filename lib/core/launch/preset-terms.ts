/**
 * The terms of a launch preset — everything a creator agrees to for ever when they sign, as shares a person reads.
 *
 * A preset's config (`../venues/meteora-dbc/presets.ts`) stores its numbers the way Meteora's programs take them: the
 * creator's share of the curve's fee *after* Meteora's part, a compounding share of the LP fee, a migration fee split
 * between creator and partner. Read as they are, they mislead: «40 % of trading fees» is 32 % of every fee a trader pays.
 * This module turns them, once, into what each party receives of every fee — on the curve, at the move to the DEX and in
 * the DEX pool after it — with Meteora's own parts written in as their programs fix them. The form's «Market rules», the
 * launch's review, the docs and the creator's cabinet all read these terms from here; none of them counts a share again.
 *
 * Where the money goes, for one fee a trader pays (shares in basis points of that fee):
 * - **on the curve** — Meteora keeps its protocol part (`METEORA_PROTOCOL_PCT`); of the rest the creator takes the
 *   preset's share and Ryntra, the config's partner, the remainder. A trade sent through Ryntra names Ryntra's referral
 *   account, which takes a fifth of Meteora's part (`METEORA_REFERRAL_OF_PROTOCOL_PCT`);
 * - **at the move to the DEX** — once, a share of the pair currency the curve raised; the creator's share of it, Ryntra
 *   the rest. On Micro and the demo market Ryntra's executor holds the partner's role, and all of its part is the
 *   market's budget;
 * - **in the DEX pool** — Meteora keeps its protocol part, the same referral comes out of it; of the liquidity's part a
 *   share compounds back into the pool, growing all of its liquidity alike; the rest is paid to the pool's positions by
 *   their liquidity.
 *   The move to the DEX opens exactly two positions, the creator's and Ryntra's, half the liquidity each, both locked
 *   for ever. While they are the pool's only liquidity each takes half of that rest; a holder who adds liquidity later
 *   takes their part of it, and both locked positions' parts shrink alike.
 *
 * Pure and client-safe: numbers only. `preset-terms.test.mjs` holds these terms against Meteora's SDKs and against the
 * four configs and the graduated pool read from mainnet on 18.10.2026.
 */

import { BUDGET_RULE } from "./budget.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS, type LaunchPreset, type LaunchPresetId } from "../venues/meteora-dbc/presets.ts";

/** Meteora's protocol part of every fee — on the curve (DBC `PROTOCOL_FEE_PERCENT`) and in the pool (DAMM v2 `protocolFeePercent`). */
export const METEORA_PROTOCOL_PCT = 20;
/** The referral's part of Meteora's protocol part when a trade names a referral account (DBC `HOST_FEE_PERCENT`, DAMM v2 `referralFeePercent`). */
export const METEORA_REFERRAL_OF_PROTOCOL_PCT = 20;
/** Meteora's part of the liquidity that moves into the pool at graduation, basis points (DBC `protocolLiquidityMigrationFeeBps`). */
export const METEORA_MIGRATION_LIQUIDITY_BPS = 20;

const ALL = 10_000;

/** One fee split among those who receive it, basis points of the fee; the parts add up to 10 000. */
export type FeeShares = Readonly<{ creatorBps: number; ryntraBps: number; meteoraBps: number }>;

export type PresetTerms = Readonly<{
  id: LaunchPresetId;
  /** On the curve, until the move to the DEX. */
  curve: Readonly<{
    /** The fee for the first buyers: from `startBps` falling exponentially to `endBps` over `seconds`. */
    sniperFee: Readonly<{ startBps: number; endBps: number; seconds: number }>;
    /** The base fee once the sniper window has passed; a volatility fee rides on it when the price swings. */
    baseFeeBps: number;
    dynamicFee: boolean;
    /** Of every fee of a trade on the curve. */
    split: FeeShares;
    /** The same when the trade comes through Ryntra: Ryntra's referral takes its part of Meteora's. */
    splitThroughRyntra: FeeShares;
    /** The market cap in dollars the curve opens at and moves to the DEX at. */
    startMarketCapUsd: number;
    graduationMarketCapUsd: number;
    /** The pair currency the curve must raise to move to the DEX, when the preset is named by it (Micro: 750); null — by its market cap. */
    graduationQuote: number | null;
  }>;
  /** The fee taken once at the move to the DEX, from what the curve raised. */
  graduation: Readonly<{
    /** Of what the curve raised. */
    feeBps: number;
    /** Of that fee. */
    creatorBps: number;
    ryntraBps: number;
    /** Ryntra's part is the market's budget (Micro and the demo market), not Ryntra's revenue. */
    toBudget: boolean;
    /** Apart from the fee, Meteora's part of the liquidity that moves into the pool, basis points of it. */
    meteoraLiquidityBps: number;
  }>;
  /** The DAMM v2 pool after the move to the DEX. */
  pool: Readonly<{
    /** The pool's fee: from `startFeeBps` falling to `endFeeBps` as the price grows `priceMultiple` times, or after `expiresAfterSeconds`. */
    startFeeBps: number;
    endFeeBps: number;
    priceMultiple: number;
    expiresAfterSeconds: number;
    /** Of every fee of a trade in the pool: Meteora's part, the part compounded back into the pool, the part paid to its positions. */
    meteoraBps: number;
    compoundingBps: number;
    positionsBps: number;
    /** The two locked positions of the move to the DEX — the creator's and Ryntra's — while they are the only liquidity. */
    creatorPositionBps: number;
    ryntraPositionBps: number;
  }>;
  /** The liquidity the move to the DEX puts in the pool: two positions, locked for ever. */
  exitLiquidity: Readonly<{ creatorPct: number; ryntraPct: number }>;
  /**
   * Ryntra's executor's share of the market's budget from Ryntra's part of the curve's fees and of its locked position;
   * the executor presets only. `waitsInPool` — on a market launched by people the executor claims nothing while Ryntra's
   * operator keeps people's markets closed, so the budget
   * waits in Meteora's pool; while they are open (SOL-L6, `peopleServed`) — and always on Ryntra's own demo market — it
   * claims the budget for the ladder.
   */
  budget: Readonly<{ feeShareBps: number; waitsInPool: boolean }> | null;
  firstBuy: Readonly<{
    /** The most of the supply the creator's first purchase may receive. */
    capBps: number;
    /** Bought in the creation itself at the end fee, never the sniper fee. */
    atEndFee: true;
    /** Days before any of it unlocks when the preset locks it always (Micro: 180); null — the lock is the creator's choice. */
    lockMinDays: number | null;
  }>;
  token: Readonly<{ supply: number; decimals: number }>;
  /** What creating the launch costs beyond the network's rent: nothing. */
  creationFeeLamports: number;
  /**
   * «Правила на кривій» (SOL-L8): whether this preset's token carries Ryntra's verified transfer-hook rules until the
   * DEX — and so whether the mark «Без правил на переказах» holds on it. False on every other preset.
   */
  curveRules: boolean;
}>;

function shares(creatorOfRest: number, referral: boolean): FeeShares {
  const meteora = METEORA_PROTOCOL_PCT * 100;
  const referralBps = referral ? (meteora * METEORA_REFERRAL_OF_PROTOCOL_PCT) / 100 : 0;
  const creatorBps = ((ALL - meteora) * creatorOfRest) / 100;
  return { creatorBps, ryntraBps: ALL - meteora - creatorBps + referralBps, meteoraBps: meteora - referralBps };
}

/** The terms of one preset, from its config's numbers. */
export function termsOf(preset: LaunchPreset, options: Readonly<{ peopleServed?: boolean }> = {}): PresetTerms {
  const executor = preset.feeClaimer === "executor";
  const meteoraPool = METEORA_PROTOCOL_PCT * 100;
  const liquidity = ALL - meteoraPool;
  const compoundingBps = (liquidity * preset.graduatedPool.compoundingFeeBps) / ALL;
  const positionsBps = liquidity - compoundingBps;
  return {
    id: preset.id,
    curve: {
      sniperFee: { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds },
      baseFeeBps: preset.sniperFee.endBps,
      dynamicFee: preset.dynamicFee,
      split: shares(preset.creatorTradingFeePct, false),
      splitThroughRyntra: shares(preset.creatorTradingFeePct, true),
      startMarketCapUsd: preset.curve.startMarketCapUsd,
      graduationMarketCapUsd: preset.curve.graduationMarketCapUsd,
      graduationQuote: preset.curve.graduationQuote ?? null,
    },
    graduation: {
      feeBps: preset.graduationFee.pct * 100,
      creatorBps: preset.graduationFee.creatorPct * 100,
      ryntraBps: ALL - preset.graduationFee.creatorPct * 100,
      toBudget: executor,
      meteoraLiquidityBps: METEORA_MIGRATION_LIQUIDITY_BPS,
    },
    pool: {
      startFeeBps: preset.graduatedPool.startFeeBps,
      endFeeBps: preset.graduatedPool.endFeeBps,
      priceMultiple: preset.graduatedPool.priceMultiple,
      expiresAfterSeconds: preset.graduatedPool.expiresAfterSeconds,
      meteoraBps: meteoraPool,
      compoundingBps,
      positionsBps,
      creatorPositionBps: (positionsBps * preset.lp.creatorLockedPct) / 100,
      ryntraPositionBps: (positionsBps * preset.lp.partnerLockedPct) / 100,
    },
    exitLiquidity: { creatorPct: preset.lp.creatorLockedPct, ryntraPct: preset.lp.partnerLockedPct },
    budget: executor ? { feeShareBps: BUDGET_RULE.feeShareBps, waitsInPool: preset.audience === "people" && options.peopleServed !== true } : null,
    firstBuy: { capBps: preset.creatorFirstBuyCapBps, atEndFee: true, lockMinDays: preset.creatorLockMinDays },
    token: { supply: preset.token.supply, decimals: preset.token.decimals },
    creationFeeLamports: preset.poolCreationFeeLamports,
    curveRules: preset.curveRules === true,
  };
}

/**
 * The terms of a preset by its id; null for an id that is no preset. `peopleServed` — Ryntra's executor claims the budget
 * on people's Micro markets on this network now (the operator's switch, SOL-L6).
 */
export function presetTerms(id: string, options: Readonly<{ peopleServed?: boolean }> = {}): PresetTerms | null {
  const preset = (Object.keys(LAUNCH_PRESETS) as LaunchPresetId[]).includes(id as LaunchPresetId) ? LAUNCH_PRESETS[id as LaunchPresetId] : null;
  return preset ? termsOf(preset, options) : null;
}

/** The terms of every preset a person may launch on. */
export const PEOPLE_PRESET_TERMS: readonly PresetTerms[] = PEOPLE_PRESET_IDS.map((id) => termsOf(LAUNCH_PRESETS[id]));

/**
 * One trade's fee in the DAMM v2 pool, split by the pool's own state: the liquidity's claiming part between the two
 * locked positions of the move to the DEX (half each of the pool's permanently locked liquidity) and every other
 * position, by liquidity; the compounding part stays in the pool. On a Ryntra pool the exit's two positions are the only
 * permanent locks as read on 18.10; a position someone else locks for ever later would be counted with them — an
 * estimate the review says as «≈», never a payment. Rounded down for the locked positions and the rest to the others;
 * with no other liquidity, the odd unit to Ryntra's, so no line shows a share nobody holds.
 */
export function poolClaimingSplit(args: Readonly<{ claimingRaw: bigint; liquidity: bigint; permanentLockedLiquidity: bigint }>): Readonly<{ creatorRaw: bigint; ryntraRaw: bigint; othersRaw: bigint }> {
  if (args.claimingRaw <= 0n || args.liquidity <= 0n) return { creatorRaw: 0n, ryntraRaw: 0n, othersRaw: args.claimingRaw > 0n ? args.claimingRaw : 0n };
  const locked = args.permanentLockedLiquidity > args.liquidity ? args.liquidity : args.permanentLockedLiquidity < 0n ? 0n : args.permanentLockedLiquidity;
  const each = (args.claimingRaw * locked) / (2n * args.liquidity);
  if (locked === args.liquidity) return { creatorRaw: each, ryntraRaw: args.claimingRaw - each, othersRaw: 0n };
  return { creatorRaw: each, ryntraRaw: each, othersRaw: args.claimingRaw - 2n * each };
}
