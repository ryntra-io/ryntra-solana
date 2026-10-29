/**
 * «Розширений лаунч» — the creator's own numbers, within the bounds the operator approves once.
 *
 * «Простий» is the form as it was: a preset picked by name. In «Розширені параметри» a creator may instead choose the
 * supply, the market cap at the start and at the DEX, their share of the curve's fee, how hard the curve is on snipers,
 * and the graduated pool's fee — each within the operator's bounds. Ryntra then makes a DBC config for that one launch:
 * the rules of «Чесний лаунч» hold on it exactly as on a preset (no mint, no freeze, fixed metadata, 100 % of the
 * graduated liquidity locked for ever, the same fee claimer — Ryntra's multisig), and only these numbers move.
 *
 * The main thing a person reads: the market cap does not grow because a zero was added to the supply — 1 B tokens at
 * $0.000005 and 10 B at $0.0000005 are the same $5 000.
 *
 * Pure and client-safe: the bounds, the check the form and the server both run, the preset a choice makes, the prices
 * it gives and what makes its tokenomics unusual. The config is built by `lib/launch/advanced.server.ts`.
 */

import { LAUNCH_PRESETS, type LaunchPreset } from "../venues/meteora-dbc/presets.ts";
import { transferFeeBpsProblems } from "./transfer-fee.ts";

/** The supplies offered — whole tokens, 6 decimals each; 1 B is recommended and is every preset's. */
export const ADVANCED_SUPPLIES = [1_000_000, 100_000_000, 1_000_000_000, 10_000_000_000] as const;
export const ADVANCED_RECOMMENDED_SUPPLY = 1_000_000_000;

/** How hard the curve is on snipers: «Звичайний» — Класичний's fee, «Сильний» — Захищений's. */
export const SNIPER_STRENGTHS = ["standard", "strong"] as const;
export type SniperStrength = (typeof SNIPER_STRENGTHS)[number];
export const SNIPER_FEES: Readonly<Record<SniperStrength, LaunchPreset["sniperFee"]>> = Object.freeze({
  standard: LAUNCH_PRESETS.classic.sniperFee,
  strong: LAUNCH_PRESETS.protected.sniperFee,
});

/** What a creator chooses in «Розширені параметри». */
export type AdvancedChoice = Readonly<{
  supply: number;
  startMarketCapUsd: number;
  graduationMarketCapUsd: number;
  /** The creator's share of the curve's fee after Meteora's 20 %, percent. */
  creatorTradingFeePct: number;
  sniper: SniperStrength;
  /** The graduated pool's fee: from `poolStartFeeBps` falling with its market cap to `poolEndFeeBps`. */
  poolStartFeeBps: number;
  poolEndFeeBps: number;
  /**
   * «Комісія за переказ» (SOL-L10): the token's fee on every transfer until the DEX, basis points; absent or 0 — none, and
   * the config passes no transfer-fee parameters at all. Offered only where the bounds carry `transferFeeMaxBps`.
   */
  transferFeeBps?: number;
  /**
   * The pair currency the curve runs in (SOL-L11): a mint of the checked register (`./quote-asset.ts`) instead of the
   * network's own pair. Absent — the network's pair, as every other launch. The mint is checked on chain before anything
   * is built; the market caps of the choice stay in dollars and are converted at the pair's price then.
   */
  quoteMint?: string;
}>;

type Range = Readonly<{ min: number; max: number }>;

/**
 * The bounds the operator approves once. On mainnet they come from `RYNTRA_LAUNCH_ADVANCED_BOUNDS` and without it
 * «Розширений» is not offered; the devnet stand has its own below. The fee of the move to the DEX and the creator's
 * first-purchase cap are not the creator's to choose: they are the bounds' own.
 */
export type AdvancedBounds = Readonly<{
  supplies: readonly number[];
  startMarketCapUsd: Range;
  graduationMarketCapUsd: Range;
  /** The DEX market cap as a multiple of the start. */
  multiple: Range;
  creatorTradingFeePct: Range;
  snipers: readonly SniperStrength[];
  poolStartFeeBps: Range;
  poolEndFeeBps: Range;
  graduationFee: Readonly<{ pct: number; creatorPct: number }>;
  firstBuyCapBps: number;
  /**
   * The ceiling of «Комісія за переказ» where the format is offered (`RYNTRA_LAUNCH_TRANSFER_FEE=open` on SDK 2.0.0 —
   * `./transfer-fee.ts`); absent — not offered. Never from the operator's JSON: the server adds it from the flag.
   */
  transferFeeMaxBps?: number;
}>;

/** The devnet stand's bounds: wide enough to rehearse every edge, inside what the programs accept. */
export const DEVNET_ADVANCED_BOUNDS: AdvancedBounds = Object.freeze({
  supplies: [...ADVANCED_SUPPLIES],
  startMarketCapUsd: { min: 1_000, max: 50_000 },
  graduationMarketCapUsd: { min: 10_000, max: 1_000_000 },
  multiple: { min: 5, max: 50 },
  creatorTradingFeePct: { min: 0, max: 50 },
  snipers: [...SNIPER_STRENGTHS],
  poolStartFeeBps: { min: 25, max: 500 },
  poolEndFeeBps: { min: 10, max: 100 },
  graduationFee: { pct: 2, creatorPct: 40 },
  firstBuyCapBps: 200,
});

/** What the programs themselves allow — no bounds of the operator's may pass them. */
const PROGRAM_LIMITS = Object.freeze({
  creatorTradingFeePct: { min: 0, max: 100 },
  /* DAMM v2's own: a graduated pool's fee from 0.1 % to 10 %. */
  poolFeeBps: { min: 10, max: 1_000 },
  migrationFeePct: { min: 0, max: 99 },
});

/** The default choice the section opens on: Захищений's numbers. */
export const ADVANCED_DEFAULT_CHOICE: AdvancedChoice = Object.freeze({
  supply: ADVANCED_RECOMMENDED_SUPPLY,
  startMarketCapUsd: LAUNCH_PRESETS.protected.curve.startMarketCapUsd,
  graduationMarketCapUsd: LAUNCH_PRESETS.protected.curve.graduationMarketCapUsd,
  creatorTradingFeePct: LAUNCH_PRESETS.protected.creatorTradingFeePct,
  sniper: "strong",
  poolStartFeeBps: LAUNCH_PRESETS.protected.graduatedPool.startFeeBps,
  poolEndFeeBps: LAUNCH_PRESETS.protected.graduatedPool.endFeeBps,
});

export type AdvancedProblem =
  | "SUPPLY"
  | "START_CAP"
  | "GRADUATION_CAP"
  | "MULTIPLE"
  | "CREATOR_SHARE"
  | "SNIPER"
  | "POOL_START_FEE"
  | "POOL_END_FEE"
  | "POOL_FEE_ORDER"
  | "TRANSFER_FEE"
  | "QUOTE_ASSET";

const within = (value: number, range: Range) => Number.isFinite(value) && value >= range.min && value <= range.max;

/** Where a choice leaves the bounds, each by its code; empty — the choice holds. */
export function advancedProblems(choice: AdvancedChoice, bounds: AdvancedBounds): readonly AdvancedProblem[] {
  const problems: AdvancedProblem[] = [];
  if (!Number.isInteger(choice.supply) || !bounds.supplies.includes(choice.supply)) problems.push("SUPPLY");
  if (!within(choice.startMarketCapUsd, bounds.startMarketCapUsd)) problems.push("START_CAP");
  if (!within(choice.graduationMarketCapUsd, bounds.graduationMarketCapUsd)) problems.push("GRADUATION_CAP");
  const multiple = choice.graduationMarketCapUsd / choice.startMarketCapUsd;
  if (!within(multiple, bounds.multiple)) problems.push("MULTIPLE");
  if (!Number.isInteger(choice.creatorTradingFeePct) || !within(choice.creatorTradingFeePct, bounds.creatorTradingFeePct)) problems.push("CREATOR_SHARE");
  if (!bounds.snipers.includes(choice.sniper)) problems.push("SNIPER");
  if (!Number.isInteger(choice.poolStartFeeBps) || !within(choice.poolStartFeeBps, bounds.poolStartFeeBps)) problems.push("POOL_START_FEE");
  if (!Number.isInteger(choice.poolEndFeeBps) || !within(choice.poolEndFeeBps, bounds.poolEndFeeBps)) problems.push("POOL_END_FEE");
  if (choice.poolEndFeeBps > choice.poolStartFeeBps) problems.push("POOL_FEE_ORDER");
  if (transferFeeChosen(choice) && (!bounds.transferFeeMaxBps || transferFeeBpsProblems(choice.transferFeeBps!, bounds.transferFeeMaxBps).length > 0)) problems.push("TRANSFER_FEE");
  /* Whether this deployment carries the pair currency, and what its mint says now, is read on the server (SOL-L11). */
  if (choice.quoteMint !== undefined && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(choice.quoteMint)) problems.push("QUOTE_ASSET");
  return problems;
}

/**
 * Bounds as configured — the operator's JSON — checked against the programs' own limits; null for anything that does not
 * hold, and then «Розширений» is not offered.
 */
export function parseAdvancedBounds(raw: string | undefined): AdvancedBounds | null {
  const text = raw?.trim();
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const range = (x: unknown, limit?: Range): Range | null => {
    if (!x || typeof x !== "object") return null;
    const { min, max } = x as Record<string, unknown>;
    if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max) || min > max || min < 0) return null;
    if (limit && (min < limit.min || max > limit.max)) return null;
    return { min, max };
  };
  const supplies = Array.isArray(v.supplies) && v.supplies.length > 0 && v.supplies.every((s) => (ADVANCED_SUPPLIES as readonly unknown[]).includes(s)) ? (v.supplies as number[]) : null;
  const snipers = Array.isArray(v.snipers) && v.snipers.length > 0 && v.snipers.every((s) => (SNIPER_STRENGTHS as readonly unknown[]).includes(s)) ? (v.snipers as SniperStrength[]) : null;
  const fee = v.graduationFee as Record<string, unknown> | undefined;
  const graduationFee =
    fee && typeof fee.pct === "number" && typeof fee.creatorPct === "number" && within(fee.pct, PROGRAM_LIMITS.migrationFeePct) && Number.isInteger(fee.creatorPct) && within(fee.creatorPct, { min: 0, max: 100 })
      ? { pct: fee.pct, creatorPct: fee.creatorPct }
      : null;
  /* Never above the template's: a launch's receipt, read from the chain alone, holds every «Розширений» to it. */
  const firstBuyCapBps =
    typeof v.firstBuyCapBps === "number" && Number.isInteger(v.firstBuyCapBps) && v.firstBuyCapBps > 0 && v.firstBuyCapBps <= LAUNCH_PRESETS.advanced.creatorFirstBuyCapBps ? v.firstBuyCapBps : null;
  const bounds = {
    supplies,
    startMarketCapUsd: range(v.startMarketCapUsd),
    graduationMarketCapUsd: range(v.graduationMarketCapUsd),
    multiple: range(v.multiple),
    creatorTradingFeePct: range(v.creatorTradingFeePct, PROGRAM_LIMITS.creatorTradingFeePct),
    snipers,
    poolStartFeeBps: range(v.poolStartFeeBps, PROGRAM_LIMITS.poolFeeBps),
    poolEndFeeBps: range(v.poolEndFeeBps, PROGRAM_LIMITS.poolFeeBps),
    graduationFee,
    firstBuyCapBps,
  };
  if (Object.values(bounds).some((part) => part === null)) return null;
  if (bounds.multiple!.min <= 1 || bounds.startMarketCapUsd!.min <= 0) return null;
  return Object.freeze(bounds) as AdvancedBounds;
}

/**
 * A launch's own numbers as its record keeps them: the creator's choice and the bounds' part that was in force when its
 * config was made — enough to say its terms for ever, whatever the bounds are later.
 */
export type AdvancedTerms = AdvancedChoice & Readonly<{ graduationFee: Readonly<{ pct: number; creatorPct: number }>; firstBuyCapBps: number }>;

export function advancedTermsOf(choice: AdvancedChoice, bounds: AdvancedBounds): AdvancedTerms {
  return { ...choice, graduationFee: { ...bounds.graduationFee }, firstBuyCapBps: bounds.firstBuyCapBps };
}

/**
 * The preset a choice makes: Захищений's shape with the creator's numbers — the curve, the snipers' fee, the creator's
 * share, the graduated pool's fee — and the bounds' own move to the DEX and first-purchase cap. Everything else —
 * Token-2022, fixed metadata, every graduated share locked, the compounding pool — is the presets'.
 */
export function advancedPreset(choice: AdvancedChoice, bounds: AdvancedBounds): LaunchPreset {
  return advancedPresetOf(advancedTermsOf(choice, bounds));
}

/** Whether a choice carries a transfer fee: a rate other than none. A 0 is none, never a 0 bps extension. */
export function transferFeeChosen(choice: Pick<AdvancedChoice, "transferFeeBps">): boolean {
  return choice.transferFeeBps !== undefined && choice.transferFeeBps !== 0;
}

/** The preset of a launch's kept terms. */
export function advancedPresetOf(terms: AdvancedTerms): LaunchPreset {
  const template = LAUNCH_PRESETS.advanced;
  return {
    ...template,
    ...(transferFeeChosen(terms) ? { transferFeeBps: terms.transferFeeBps } : {}),
    /* A launch on a checked pair currency is not priced at a dollar: its curve is converted at the pair's own price. */
    ...(terms.quoteMint === undefined ? {} : { pair: "QUOTE_ASSET" as const }),
    token: { ...template.token, supply: terms.supply },
    curve: { startMarketCapUsd: terms.startMarketCapUsd, graduationMarketCapUsd: terms.graduationMarketCapUsd },
    sniperFee: SNIPER_FEES[terms.sniper],
    creatorTradingFeePct: terms.creatorTradingFeePct,
    graduationFee: { ...terms.graduationFee },
    graduatedPool: { ...template.graduatedPool, startFeeBps: terms.poolStartFeeBps, endFeeBps: terms.poolEndFeeBps },
    creatorFirstBuyCapBps: terms.firstBuyCapBps,
  };
}

/** Kept terms as they come back from the store or a response: a choice and the bounds' part, each of its type; null otherwise. */
export function advancedTermsFrom(value: unknown): AdvancedTerms | null {
  const choice = advancedChoiceOf(value);
  if (!choice) return null;
  const v = value as Record<string, unknown>;
  const fee = v.graduationFee as Record<string, unknown> | undefined;
  if (!fee || typeof fee.pct !== "number" || typeof fee.creatorPct !== "number" || typeof v.firstBuyCapBps !== "number") return null;
  return { ...choice, graduationFee: { pct: fee.pct, creatorPct: fee.creatorPct }, firstBuyCapBps: v.firstBuyCapBps };
}

/** The token's price at the start and at the DEX, in dollars — the market cap over the supply. */
export function advancedPrices(choice: Pick<AdvancedChoice, "supply" | "startMarketCapUsd" | "graduationMarketCapUsd">) {
  return { startPriceUsd: choice.startMarketCapUsd / choice.supply, graduationPriceUsd: choice.graduationMarketCapUsd / choice.supply, multiple: choice.graduationMarketCapUsd / choice.startMarketCapUsd };
}

export const UNUSUAL_REASONS = ["SUPPLY", "STEEP", "FLAT", "LOW_START", "HIGH_CREATOR_SHARE", "SOFT_SNIPERS"] as const;
export type UnusualReason = (typeof UNUSUAL_REASONS)[number];

/**
 * What makes a choice's tokenomics unusual — said in the form and on the token page as «Незвична токеноміка» with the
 * reason, never as a verdict. Empty — as ordinary as the presets.
 */
export function unusualTokenomics(choice: AdvancedChoice): readonly UnusualReason[] {
  const reasons: UnusualReason[] = [];
  const { multiple } = advancedPrices(choice);
  if (choice.supply !== ADVANCED_RECOMMENDED_SUPPLY) reasons.push("SUPPLY");
  if (multiple > 30) reasons.push("STEEP");
  if (multiple < 8) reasons.push("FLAT");
  if (choice.startMarketCapUsd < 2_500) reasons.push("LOW_START");
  if (choice.creatorTradingFeePct > 40) reasons.push("HIGH_CREATOR_SHARE");
  if (choice.sniper === "standard") reasons.push("SOFT_SNIPERS");
  return reasons;
}

/** A choice as it arrives from a request or the store: every field present and of its type; null otherwise. */
export function advancedChoiceOf(value: unknown): AdvancedChoice | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const numbers = ["supply", "startMarketCapUsd", "graduationMarketCapUsd", "creatorTradingFeePct", "poolStartFeeBps", "poolEndFeeBps"] as const;
  if (!numbers.every((key) => typeof v[key] === "number" && Number.isFinite(v[key]))) return null;
  if (!(SNIPER_STRENGTHS as readonly unknown[]).includes(v.sniper)) return null;
  if (v.transferFeeBps !== undefined && (typeof v.transferFeeBps !== "number" || !Number.isFinite(v.transferFeeBps))) return null;
  if (v.quoteMint !== undefined && typeof v.quoteMint !== "string") return null;
  return {
    ...(v.transferFeeBps !== undefined && v.transferFeeBps !== 0 ? { transferFeeBps: v.transferFeeBps as number } : {}),
    ...(v.quoteMint === undefined ? {} : { quoteMint: v.quoteMint as string }),
    supply: v.supply as number,
    startMarketCapUsd: v.startMarketCapUsd as number,
    graduationMarketCapUsd: v.graduationMarketCapUsd as number,
    creatorTradingFeePct: v.creatorTradingFeePct as number,
    sniper: v.sniper as SniperStrength,
    poolStartFeeBps: v.poolStartFeeBps as number,
    poolEndFeeBps: v.poolEndFeeBps as number,
  };
}
