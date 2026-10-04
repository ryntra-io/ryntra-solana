/**
 * The wallet's company positions as Нагляд sees them: every company the
 * wallet holds — a listed stock or a private one — with its exit, the state
 * it is in and its one action (`watch-state.ts`). Composed here from facts
 * read elsewhere: what the chain says the wallet holds, the universe's row for
 * the token, the plans the wallet bought under, «Ryntra попередить» turned on
 * for a position, the issuer's events and whether a channel is connected.
 * Pure, so a test composes exactly what the route answers.
 *
 * A position's exit is the one written last: the plan it was bought under
 * while that plan is watched as a position (`position.ts`), or «Ryntra
 * попередить» on the position. Dust — a known value under a cent — is not a
 * position; a value that cannot be counted is not called dust.
 */

import type { PositionWatchPreset, PositionWatchRecord } from "./position-watch.ts";
import { judgeWatch, type WatchAction, type WatchReason, type WatchSource, type WatchState } from "./watch-state.ts";

/** Below this a holding is dust (the same cent Portfolio folds away). */
export const POSITION_DUST_USD = 0.01;

/** What the universe says of one token, for Нагляд. */
export type PositionRowFacts = Readonly<{
  mint: string;
  symbol: string;
  /** The company, as the issuer names it; the token's own name where the issuer names none. */
  name: string;
  /** A private company (pre-IPO) — no exchange, and its own cap in the portfolio's risk. */
  privateCompany?: boolean;
  /** The listed company's ticker, so its tokens count as one asset; null where the issuer names none. */
  company?: string | null;
  icon: string | null;
  unitBasis: "share" | "token";
  decimals: number | null;
  /** The Scaled UI multiplier in force; 1 where the mint has none. */
  multiplier: number;
  /** USD per unit as the wallet shows the token, and when the venue observed it. */
  price: number | null;
  observedAt: string | null;
  /** The token against the exchange's current reference, percent; null where the reference is not current. */
  deviationPct: number | null;
  /** The issuer says its exchange is closed now. */
  exchangeClosed: boolean;
  /** While closed, when the source says it opens again (ISO); null where it does not say — a day off tells itself from a night by it. */
  closedUntil?: string | null;
  /** The issuer says trading of the token is halted. */
  halted: boolean;
}>;

/** An exit a plan gives the position: the plan's loss limit and target, while the plan is watched as a position. */
export type PlanExit = Readonly<{ planId: string; limit: number; target: number | null; writtenAt: string }>;

export type PositionExitView = Readonly<{
  source: WatchSource;
  limit: number;
  target: number | null;
  /** The preset «Ryntra попередить» was turned on with; null for a plan's exit. */
  preset: PositionWatchPreset | null;
  /** The plan the exit is from; null for «Ryntra попередить». */
  planId: string | null;
}>;

export type PositionView = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  unitBasis: "share" | "token";
  /** Raw units the wallet holds, as the chain states them. */
  amountRaw: string;
  /** What the holding is worth at `price`; null where a figure it needs is unknown. */
  valueUsd: number | null;
  price: number | null;
  observedAt: string | null;
  /** The token against the exchange's current reference, per cent; null where there is none — the figure «Увага» names when it is above. */
  deviationPct: number | null;
  exit: PositionExitView | null;
  state: WatchState;
  reason: WatchReason;
  action: WatchAction | null;
  toLimitPct: number | null;
}>;

export type ComposePositionsInput = Readonly<{
  /** Raw units per mint the chain says the wallet holds. */
  held: ReadonlyMap<string, bigint>;
  /** The universe's facts per mint — a mint the universe does not know is not a company position. */
  rows: ReadonlyMap<string, PositionRowFacts>;
  planExits: ReadonlyMap<string, PlanExit>;
  /** «Ryntra попередить» — open watches only. */
  watches: readonly PositionWatchRecord[];
  /** Whether an issuer's event the holder must act on is open for the token. */
  eventOpen: (mint: string) => boolean;
  channel: boolean;
  nowMs: number;
}>;

/** What a raw holding is worth: raw ÷ 10^decimals × the multiplier × the price per unit as the wallet shows it. */
export function valueOf(raw: bigint, row: PositionRowFacts): number | null {
  if (row.decimals === null || row.price === null || !Number.isFinite(row.price) || !(row.multiplier > 0)) return null;
  const value = (Number(raw) / 10 ** row.decimals) * row.multiplier * row.price;
  return Number.isFinite(value) ? value : null;
}

/** The exit written last, of the plan's and the watch's. */
function exitOf(plan: PlanExit | undefined, watch: PositionWatchRecord | undefined): PositionExitView | null {
  const fromWatch = watch ? { source: "watch" as const, limit: watch.limitPerUnit, target: watch.targetPerUnit, preset: watch.preset, planId: null, at: watch.updatedAt } : null;
  const fromPlan = plan ? { source: "plan" as const, limit: plan.limit, target: plan.target, preset: null, planId: plan.planId, at: plan.writtenAt } : null;
  const chosen = fromWatch && fromPlan ? (Date.parse(fromWatch.at) >= Date.parse(fromPlan.at) ? fromWatch : fromPlan) : (fromWatch ?? fromPlan);
  if (!chosen) return null;
  const { at: _at, ...exit } = chosen;
  return exit;
}

export function composePositions(input: ComposePositionsInput): readonly PositionView[] {
  const watchByMint = new Map(input.watches.filter((row) => row.closedAt === null).map((row) => [row.mint, row]));
  const out: PositionView[] = [];
  for (const [mint, raw] of input.held) {
    if (raw <= 0n) continue;
    const row = input.rows.get(mint);
    if (!row) continue;
    const valueUsd = valueOf(raw, row);
    if (valueUsd !== null && valueUsd < POSITION_DUST_USD) continue;
    const exit = exitOf(input.planExits.get(mint), watchByMint.get(mint));
    const judged = judgeWatch({
      price: row.price,
      observedAt: row.observedAt,
      nowMs: input.nowMs,
      exit: exit ? { source: exit.source, limit: exit.limit, target: exit.target } : null,
      issuerPaused: row.halted,
      issuerEvent: input.eventOpen(mint),
      deviationPct: row.deviationPct,
      exchangeClosed: row.exchangeClosed,
      channel: input.channel,
    });
    out.push({
      mint,
      symbol: row.symbol,
      name: row.name,
      icon: row.icon,
      unitBasis: row.unitBasis,
      amountRaw: raw.toString(),
      valueUsd,
      price: row.price,
      observedAt: row.observedAt,
      deviationPct: row.deviationPct,
      exit,
      state: judged.state,
      reason: judged.reason,
      action: judged.action,
      toLimitPct: judged.toLimitPct,
    });
  }
  /* The one that needs the person first, then by what it is worth. */
  const rank = (state: WatchState): number => ({ action: 0, "issuer-paused": 1, "exit-not-set": 2, attention: 3, unknown: 4, "on-plan": 5 })[state];
  return out.sort((a, b) => rank(a.state) - rank(b.state) || (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.symbol.localeCompare(b.symbol));
}
