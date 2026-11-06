/**
 * CITY-204 — the money autopilot's plan: one sentence, one plan for the whole budget. «Work with my 2 SOL and 100 USDC:
 * some into savings, trade BONK with some, some into pools» becomes four parts:
 *
 * - `trade` — SOL the agent trades by itself, the mandate of CITY-174/186 with a strategy of CITY-193. Its size is one
 *   of the city's budgets open on the network: a larger share is
 *   capped and the rest stays in the person's wallet. The signed policy holds the caps; nothing here raises them.
 * - `save` — the dollar savings of CITY-192: USDC (first) and SOL into Jupiter Lend, a position of her own wallet.
 * - `pool` — SOL into a SOL pier of CITY-198 (Meteora Zap), a position of her own wallet.
 * - `reserve` — what stays in her wallet: at least the network's fees, and whatever a part could not take.
 *
 * Pure: no network, no wallet, no store. The city reads the sentence (`city/lib/pilot/read.ts`); the split, the shares
 * and the care rules are this file's, the same in the window, the server and the agent's pass (`./care.ts`).
 */

import { BUDGET_PRESETS, PRESETS_ON, type BudgetPresetId } from "../mandate/presets.ts";

export const PILOT_PARTS = ["trade", "save", "pool", "reserve"] as const;
export type PilotPart = (typeof PILOT_PARTS)[number];
/** The parts a person can ask for by name; the reserve is what is left. */
export type WorkPart = Exclude<PilotPart, "reserve">;
export const WORK_PARTS: readonly WorkPart[] = ["trade", "save", "pool"];

export type PilotNetwork = "devnet" | "mainnet";

export const LAMPORTS = 1_000_000_000n;
export const USDC_UNIT = 1_000_000n;

/** What stays in her wallet at least: the network's fees for the agent's and her own transactions. */
export const RESERVE_MIN_LAMPORTS = 50_000_000n;
/** … and at least this share of her SOL. */
export const RESERVE_SHARE_BPS = 500;
/** The smallest savings leg (Jupiter Lend's minimum is $1, `lib/earn/model.ts` `MIN_EARN_USD`). */
export const SAVE_MIN_USD = 1;
/** The smallest pier leg (`city/lib/earn/pier.ts` `PIER_MIN_LAMPORTS`). */
export const POOL_MIN_LAMPORTS = 50_000_000n;

/** The split when the sentence names no part or names a part without a share: of the budget past the reserve. */
export const DEFAULT_WEIGHTS: Readonly<Record<WorkPart, number>> = Object.freeze({ trade: 15, save: 55, pool: 30 });

/** What the sentence asks: the money given, the parts named — each with its share in basis points of the budget, or `true` when named without one. */
export type PilotWants = Readonly<{
  solRaw: bigint;
  usdcRaw: bigint;
  named: Readonly<Partial<Record<WorkPart, number | true>>>;
}>;

export type PilotLegs = Readonly<{
  trade: Readonly<{ solRaw: bigint }>;
  save: Readonly<{ solRaw: bigint; usdcRaw: bigint }>;
  pool: Readonly<{ solRaw: bigint }>;
  reserve: Readonly<{ solRaw: bigint; usdcRaw: bigint }>;
}>;

export type PilotSplit = Readonly<{
  legs: PilotLegs;
  /** Each part's share of the whole budget, basis points, summing to 10 000. */
  shares: Readonly<Record<PilotPart, number>>;
  /** The trade's budget — one of the city's — or null when there is no trade part. */
  preset: BudgetPresetId | null;
  /** More was asked to trade than a new agent trades: the rest stays in the wallet. */
  capped: boolean;
  /** Parts asked for that could not take money: too little, or not on this network. */
  dropped: readonly WorkPart[];
}>;

/** The parts each network moves money into: devnet has no Jupiter Lend and no SOL pier — there they run on paper. */
export const PARTS_LIVE: Readonly<Record<PilotNetwork, readonly WorkPart[]>> = Object.freeze({ devnet: ["trade"], mainnet: ["trade", "save", "pool"] });

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** USD of lamports or of USDC base units at the price. */
export const usdOfSol = (raw: bigint, solUsd: number) => (Number(raw) / 1e9) * solUsd;
export const usdOfUsdc = (raw: bigint) => Number(raw) / 1e6;
const solOfUsd = (usd: number, solUsd: number) => (usd > 0 && solUsd > 0 ? BigInt(Math.floor((usd / solUsd) * 1e9)) : 0n);
const usdcOfUsd = (usd: number) => (usd > 0 ? BigInt(Math.floor(usd * 1e6)) : 0n);

/** The largest of the network's budgets not above `lamports`; null when even the smallest is more. */
export function tradePresetFor(network: PilotNetwork, lamports: bigint): BudgetPresetId | null {
  const open = PRESETS_ON[network].map((id) => BUDGET_PRESETS[id]).sort((a, b) => (a.budget < b.budget ? -1 : 1));
  let picked: BudgetPresetId | null = null;
  /* The vault takes the budget and the agent's network fees: both come out of the trade part. */
  for (const preset of open) if (preset.budget + preset.agentFee <= lamports) picked = preset.id;
  return picked;
}

/** The SOL a trade part of this budget takes: the budget and the agent's network fees. */
export const tradeLamports = (preset: BudgetPresetId) => BUDGET_PRESETS[preset].budget + BUDGET_PRESETS[preset].agentFee;

/**
 * The parts' targets, in basis points of the budget past the reserve: the shares said, and the default weights for parts
 * named without one (or for all three when none was named), scaled into what the said shares left.
 */
export function targetsOf(named: PilotWants["named"]): Readonly<Record<WorkPart, number>> {
  const asked = WORK_PARTS.filter((part) => named[part] !== undefined);
  const parts = asked.length ? asked : WORK_PARTS;
  const said = parts.filter((part) => typeof named[part] === "number");
  let fixed = said.reduce((sum, part) => sum + (named[part] as number), 0);
  const out: Record<WorkPart, number> = { trade: 0, save: 0, pool: 0 };
  /* Shares said that add up to more than the whole are read as weights of it. */
  const scale = fixed > 10_000 ? 10_000 / fixed : 1;
  for (const part of said) out[part] = Math.floor((named[part] as number) * scale);
  fixed = Math.min(fixed, 10_000);
  const open = parts.filter((part) => typeof named[part] !== "number");
  const weight = open.reduce((sum, part) => sum + DEFAULT_WEIGHTS[part], 0);
  /* Nothing left for a part named without a share when the said ones took it all: that part gets nothing. */
  for (const part of open) out[part] = weight ? Math.floor(((10_000 - fixed) * DEFAULT_WEIGHTS[part]) / weight) : 0;
  return out;
}

/**
 * The split of the budget: the reserve first, then the trade (one of the city's budgets, capped), the pier (SOL), the
 * savings (USDC first, then SOL) — each from its target share of the budget's value; what a part cannot take stays in the
 * wallet. Null when SOL's price is not read and both SOL and USDC were given: the parts could not be weighed honestly.
 */
export function splitOf(wants: PilotWants, network: PilotNetwork, solUsd: number | null): PilotSplit | null {
  const S = wants.solRaw > 0n ? wants.solRaw : 0n;
  const U = wants.usdcRaw > 0n ? wants.usdcRaw : 0n;
  if (S === 0n && U === 0n) return null;
  const price = solUsd !== null && Number.isFinite(solUsd) && solUsd > 0 ? solUsd : null;
  if (price === null && S > 0n && U > 0n) return null;
  /* Without a price only one asset was given: its own units weigh the parts. */
  const p = price ?? 1;
  const reserveSol = min(S, max(RESERVE_MIN_LAMPORTS, (S * BigInt(RESERVE_SHARE_BPS)) / 10_000n));
  let solLeft = S - reserveSol;
  let usdcLeft = U;
  const budgetUsd = usdOfSol(solLeft, p) + usdOfUsdc(usdcLeft);
  const targets = targetsOf(wants.named);
  const dropped: WorkPart[] = [];
  const asked = (part: WorkPart) => targets[part] > 0;

  /* The trade: a budget of the city's, never more than its target. */
  let trade = 0n;
  let preset: BudgetPresetId | null = null;
  let capped = false;
  if (asked("trade")) {
    const want = min(solLeft, solOfUsd((budgetUsd * targets.trade) / 10_000, p));
    /* A trade said by name gets the smallest budget even under its share, when the SOL is there. */
    preset = tradePresetFor(network, want);
    const smallest = smallestPreset(network);
    if (!preset && wants.named.trade !== undefined && smallest && tradeLamports(smallest) <= solLeft) preset = smallest;
    if (preset) {
      trade = tradeLamports(preset);
      /* More than a tenth over what the budget takes: the card says the rest stays in the wallet. */
      capped = want * 10n > trade * 11n;
      solLeft -= trade;
    } else dropped.push("trade");
  }

  /* The pier: SOL only. */
  let pool = 0n;
  if (asked("pool")) {
    pool = min(solLeft, solOfUsd((budgetUsd * targets.pool) / 10_000, p));
    if (pool < POOL_MIN_LAMPORTS) {
      pool = 0n;
      dropped.push("pool");
    }
    solLeft -= pool;
  }

  /* The savings: USDC first, then SOL. What the trade's cap left over stays in the wallet. */
  let saveUsdc = 0n;
  let saveSol = 0n;
  if (asked("save")) {
    let want = (budgetUsd * targets.save) / 10_000;
    saveUsdc = min(usdcLeft, usdcOfUsd(want));
    want -= usdOfUsdc(saveUsdc);
    saveSol = min(solLeft, solOfUsd(want, p));
    if (price !== null && usdOfUsdc(saveUsdc) < SAVE_MIN_USD) saveUsdc = 0n;
    if (price !== null && usdOfSol(saveSol, price) < SAVE_MIN_USD) saveSol = 0n;
    if (price === null && saveUsdc > 0n && saveUsdc < USDC_UNIT) saveUsdc = 0n;
    if (saveUsdc === 0n && saveSol === 0n) dropped.push("save");
    usdcLeft -= saveUsdc;
    solLeft -= saveSol;
  }

  const legs: PilotLegs = {
    trade: { solRaw: trade },
    save: { solRaw: saveSol, usdcRaw: saveUsdc },
    pool: { solRaw: pool },
    reserve: { solRaw: reserveSol + solLeft, usdcRaw: usdcLeft },
  };
  return { legs, shares: sharesOf(legs, p), preset, capped, dropped };
}

const smallestPreset = (network: PilotNetwork): BudgetPresetId | null => {
  const open = PRESETS_ON[network].map((id) => BUDGET_PRESETS[id]).sort((a, b) => (a.budget < b.budget ? -1 : 1));
  return open[0]?.id ?? null;
};

/** Each part's value in USD at the price. */
export function legsUsd(legs: PilotLegs, solUsd: number): Readonly<Record<PilotPart, number>> {
  return {
    trade: usdOfSol(legs.trade.solRaw, solUsd),
    save: usdOfSol(legs.save.solRaw, solUsd) + usdOfUsdc(legs.save.usdcRaw),
    pool: usdOfSol(legs.pool.solRaw, solUsd),
    reserve: usdOfSol(legs.reserve.solRaw, solUsd) + usdOfUsdc(legs.reserve.usdcRaw),
  };
}

/** Shares of values, basis points summing to 10 000 (the largest part takes the rounding). */
export function sharesFrom(values: Readonly<Record<PilotPart, number>>): Readonly<Record<PilotPart, number>> {
  const total = PILOT_PARTS.reduce((sum, part) => sum + Math.max(0, values[part]), 0);
  const out: Record<PilotPart, number> = { trade: 0, save: 0, pool: 0, reserve: 0 };
  if (!(total > 0)) return { ...out, reserve: 10_000 };
  for (const part of PILOT_PARTS) out[part] = Math.floor((Math.max(0, values[part]) / total) * 10_000);
  const rest = 10_000 - PILOT_PARTS.reduce((sum, part) => sum + out[part], 0);
  const largest = PILOT_PARTS.reduce((a, b) => (out[b] > out[a] ? b : a));
  out[largest] += rest;
  return out;
}

const sharesOf = (legs: PilotLegs, solUsd: number) => sharesFrom(legsUsd(legs, solUsd));

/* ---------------------------------------------------------------- care: the rules the agent keeps */

/**
 * How the agent looks after the plan (`./care.ts`), each bound in one place:
 * - `bandBps` — a part may drift this far (percentage points × 100) from its share before the agent acts;
 * - `crashBps` — SOL falling this far under its high of the last day pauses the trading;
 * - `calmBps` — the trading goes on once the fall is back under this;
 * - `pauseMinMs` — and no sooner than this after it paused.
 */
export const CARE = Object.freeze({
  bandBps: { min: 300, max: 3_000, default: 1_000 },
  crashBps: { min: 500, max: 3_000, default: 1_000 },
  pauseMinMs: 6 * 3_600_000,
  /** SOL's price is marked at most this often; the last two days are kept. */
  markEveryMs: 15 * 60_000,
  marksKeptMs: 2 * 86_400_000,
  /** A price older than this is not the price now. */
  markFreshMs: 45 * 60_000,
});

export type PilotRules = Readonly<{ bandBps: number; crashBps: number }>;

export const DEFAULT_RULES: PilotRules = Object.freeze({ bandBps: CARE.bandBps.default, crashBps: CARE.crashBps.default });

const clampInt = (value: unknown, bound: Readonly<{ min: number; max: number; default: number }>) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(bound.max, Math.max(bound.min, Math.round(value))) : bound.default;

/** The rules drawn into their bounds; anything else — the defaults. */
export function rulesOf(value: unknown): PilotRules {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return { bandBps: clampInt(v.bandBps, CARE.bandBps), crashBps: clampInt(v.crashBps, CARE.crashBps) };
}

/** The trading resumes once SOL's fall is back under half the crash. */
export const calmOf = (rules: PilotRules) => Math.floor(rules.crashBps / 2);

/* ---------------------------------------------------------------- the plan as data */

/** The plan as the store and the routes carry it: base units as strings, nothing else. */
export type PilotPlanData = Readonly<{
  v: 1;
  legs: Readonly<{
    trade: Readonly<{ solRaw: string }>;
    save: Readonly<{ solRaw: string; usdcRaw: string }>;
    pool: Readonly<{ solRaw: string }>;
    reserve: Readonly<{ solRaw: string; usdcRaw: string }>;
  }>;
  shares: Readonly<Record<PilotPart, number>>;
  preset: BudgetPresetId | null;
  rules: PilotRules;
}>;

const RAW = /^\d{1,24}$/u;

export function planData(split: PilotSplit, rules: PilotRules = DEFAULT_RULES): PilotPlanData {
  const l = split.legs;
  return {
    v: 1,
    legs: {
      trade: { solRaw: l.trade.solRaw.toString() },
      save: { solRaw: l.save.solRaw.toString(), usdcRaw: l.save.usdcRaw.toString() },
      pool: { solRaw: l.pool.solRaw.toString() },
      reserve: { solRaw: l.reserve.solRaw.toString(), usdcRaw: l.reserve.usdcRaw.toString() },
    },
    shares: { ...split.shares },
    preset: split.preset,
    rules,
  };
}

/** A plan read back from a body or the store; null when any part of it is not one this file writes. */
export function planFromData(value: unknown): PilotPlanData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return null;
  const legs = v.legs as Record<string, Record<string, unknown>> | undefined;
  const raw = (leg: string, field: string) => {
    const x = legs?.[leg]?.[field];
    return typeof x === "string" && RAW.test(x) ? x : null;
  };
  const fields = [raw("trade", "solRaw"), raw("save", "solRaw"), raw("save", "usdcRaw"), raw("pool", "solRaw"), raw("reserve", "solRaw"), raw("reserve", "usdcRaw")];
  if (fields.some((x) => x === null)) return null;
  const sharesIn = v.shares as Record<string, unknown> | undefined;
  const shares = {} as Record<PilotPart, number>;
  for (const part of PILOT_PARTS) {
    const x = sharesIn?.[part];
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 10_000) return null;
    shares[part] = x;
  }
  if (PILOT_PARTS.reduce((sum, part) => sum + shares[part], 0) !== 10_000) return null;
  const preset = v.preset === null ? null : typeof v.preset === "string" && v.preset in BUDGET_PRESETS ? (v.preset as BudgetPresetId) : undefined;
  if (preset === undefined) return null;
  const [ts, ss, su, ps, rs, ru] = fields as string[];
  if ((preset === null) !== (BigInt(ts!) === 0n)) return null;
  if (preset !== null && BigInt(ts!) !== tradeLamports(preset)) return null;
  return { v: 1, legs: { trade: { solRaw: ts! }, save: { solRaw: ss!, usdcRaw: su! }, pool: { solRaw: ps! }, reserve: { solRaw: rs!, usdcRaw: ru! } }, shares, preset, rules: rulesOf(v.rules) };
}

/** The legs of a plan as numbers again. */
export function legsOf(plan: PilotPlanData): PilotLegs {
  const l = plan.legs;
  return {
    trade: { solRaw: BigInt(l.trade.solRaw) },
    save: { solRaw: BigInt(l.save.solRaw), usdcRaw: BigInt(l.save.usdcRaw) },
    pool: { solRaw: BigInt(l.pool.solRaw) },
    reserve: { solRaw: BigInt(l.reserve.solRaw), usdcRaw: BigInt(l.reserve.usdcRaw) },
  };
}
