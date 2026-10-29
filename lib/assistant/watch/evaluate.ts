/**
 * One watch judged against one read (AI-05). Pure: the rule, its state, the
 * token's read and history and the clock go in; whether it rings, the figure
 * it stood on and its next state come out. No model, no store, no send.
 *
 * A watch is armed until it rings; then it waits for the market to leave the
 * threshold by a band before it can ring again (a price on the line rings
 * once, not on every tick), and never twice within its pause. The crossing's
 * identity is the moment it was armed, so a pass retried after a crash — or
 * after a restart — names the same crossing and writes nothing new. A read
 * that is stale, missing or too short in history decides nothing: it is
 * «not read» or «learning», never «quiet».
 */

import { liquidityAgo, readIsFresh, type MintRead, type Sample } from "./market.ts";
import { PRICE_BAND_PCT, VOLUME_FLOOR_USD, type WatchRule } from "./rules.ts";

export type WatchState = Readonly<{
  armed: boolean;
  /** When it was (re)armed: the crossing's identity. */
  armedSince: string;
  lastFiredAt: string | null;
}>;

/** The figure a judgement stood on: what was measured, against what, from where and when. */
export type WatchFigure = Readonly<{
  /** The price (USD), the change (percent), the volume ratio (times) or the liquidity change (percent). */
  value: number;
  /** For a price, volume or liquidity rule, the figure beside it: the hour's volume (USD) or the liquidity now (USD). */
  beside: number | null;
  source: string;
  observedAt: string;
}>;

export type WatchJudgement = Readonly<{
  outcome: "fire" | "quiet" | "cooling" | "unread" | "learning";
  figure: WatchFigure | null;
  next: WatchState;
  /** Set when it rings: the crossing's identity, claimed once. */
  identity: string | null;
}>;

type Measured = Readonly<{ figure: WatchFigure; met: boolean; clear: boolean }> | "unread" | "learning";

function measure(rule: WatchRule, read: MintRead, samples: readonly Sample[], nowMs: number): Measured {
  const at = read.observedAt;
  switch (rule.kind) {
    case "price": {
      /* A level is judged on Jupiter's price only: a level crossed by switching sources is no crossing. */
      const price = read.jupiter ? read.priceUsd : null;
      if (price === null) return "unread";
      const band = PRICE_BAND_PCT / 100;
      const below = rule.direction === "below";
      return {
        figure: { value: price, beside: null, source: "Jupiter", observedAt: at },
        met: below ? price <= rule.level : price >= rule.level,
        clear: below ? price >= rule.level * (1 + band) : price <= rule.level * (1 - band),
      };
    }
    case "move": {
      const change = read.changePct[rule.window];
      const source = read.changeSource[rule.window];
      if (change === null || source === null) return "unread";
      const met = rule.direction === "down" ? change <= -rule.pct : rule.direction === "up" ? change >= rule.pct : Math.abs(change) >= rule.pct;
      const half = rule.pct / 2;
      const clear = rule.direction === "down" ? change > -half : rule.direction === "up" ? change < half : Math.abs(change) < half;
      return { figure: { value: change, beside: read.priceUsd, source, observedAt: at }, met, clear };
    }
    case "volume": {
      const hour = read.volumeUsd.h1;
      const day = read.volumeUsd.h24;
      if (hour === null || day === null) return "unread";
      const usual = day / 24;
      if (!(usual > 0)) return "learning";
      const ratio = hour / usual;
      return { figure: { value: ratio, beside: hour, source: "DexScreener", observedAt: at }, met: ratio >= rule.factor && hour >= VOLUME_FLOOR_USD, clear: ratio < rule.factor * 0.8 };
    }
    case "liquidity": {
      const now = rule.pool ? (read.pools[rule.pool] ?? null) : read.liquidityUsd;
      if (now === null) return "unread";
      const then = liquidityAgo(samples, rule.window === "h1" ? 3_600_000 : 86_400_000, nowMs, rule.pool);
      if (then === null) return "learning";
      const change = ((now - then) / then) * 100;
      const half = rule.pct / 2;
      const met = rule.direction === "drop" ? change <= -rule.pct : rule.direction === "rise" ? change >= rule.pct : Math.abs(change) >= rule.pct;
      const clear = rule.direction === "drop" ? change > -half : rule.direction === "rise" ? change < half : Math.abs(change) < half;
      return { figure: { value: change, beside: now, source: "DexScreener", observedAt: at }, met, clear };
    }
  }
}

export function judgeWatch(input: Readonly<{ watchId: string; rule: WatchRule; state: WatchState; cooldownMinutes: number; read: MintRead | undefined; samples: readonly Sample[]; nowMs: number }>): WatchJudgement {
  const { state } = input;
  if (!readIsFresh(input.read, input.nowMs)) return { outcome: "unread", figure: null, next: state, identity: null };
  const measured = measure(input.rule, input.read, input.samples, input.nowMs);
  if (measured === "unread" || measured === "learning") return { outcome: measured, figure: null, next: state, identity: null };
  const at = new Date(input.nowMs).toISOString();
  if (state.armed && measured.met) {
    const cooled = state.lastFiredAt === null || input.nowMs - Date.parse(state.lastFiredAt) >= input.cooldownMinutes * 60_000;
    if (!cooled) return { outcome: "cooling", figure: measured.figure, next: state, identity: null };
    return { outcome: "fire", figure: measured.figure, next: { armed: false, armedSince: state.armedSince, lastFiredAt: at }, identity: `token-watch:${input.watchId}:${state.armedSince}` };
  }
  if (!state.armed && measured.clear) return { outcome: "quiet", figure: measured.figure, next: { armed: true, armedSince: at, lastFiredAt: state.lastFiredAt }, identity: null };
  return { outcome: "quiet", figure: measured.figure, next: state, identity: null };
}
