/**
 * The figures «Ryntra попередить» sets on a position — client-safe, so the
 * sheet previews exactly what the server will count (`position-watch.ts`
 * counts them again from its own price on save). The presets are the
 * published ones of the purchase with a loss limit (В11): «Обережно» −5 % /
 * +10 %, «Збалансовано» −10 % / +20 %. Pure.
 */

import { LOSS_LIMIT_PRESETS, type LossLimitPreset } from "../plans/purchase.ts";

export const POSITION_WATCH_PRESETS = LOSS_LIMIT_PRESETS;
export type PositionWatchPreset = LossLimitPreset;
export const POSITION_WATCH_PRESET_IDS = Object.keys(LOSS_LIMIT_PRESETS) as readonly PositionWatchPreset[];

/** A per-unit dollar figure: cents from a dollar up, six significant digits below — a token of a few cents keeps its limit where the preset puts it. */
export function roundWatch(value: number): number {
  if (value >= 1) return Math.round(value * 100) / 100;
  return Number(value.toPrecision(6));
}

/** The limit and the target a preset makes of a price. */
export function watchFigures(preset: PositionWatchPreset, basisPerUnit: number): Readonly<{ limitPerUnit: number; targetPerUnit: number; stopPct: number; targetPct: number }> {
  const { stopPct, targetPct } = POSITION_WATCH_PRESETS[preset];
  return { limitPerUnit: roundWatch(basisPerUnit * (1 - stopPct / 100)), targetPerUnit: roundWatch(basisPerUnit * (1 + targetPct / 100)), stopPct, targetPct };
}
