/**
 * The provider's model notes on a market, as Ryntra shows them: theses of a
 * model, never advice — so without the side a note leans to, without the
 * model's name and prompt version, and only while they are fresh. Notes
 * written weeks before are about a different market from the one trading now.
 *
 * Pure.
 */

import type { PredictionSignals } from "./model.ts";

/** Older than this, the notes are not shown at all. */
export const THESES_FRESH_MS = 14 * 24 * 3_600_000;

export type Theses = Readonly<{ texts: readonly Readonly<{ id: string; text: string }>[]; writtenAt: string }>;

/** The notes worth a person's attention, or null — none, unreadable, or older than two weeks. */
export function freshTheses(batch: PredictionSignals | null | undefined, nowMs: number): Theses | null {
  if (!batch || batch.signals.length === 0) return null;
  const written = Date.parse(batch.createdAt);
  if (!Number.isFinite(written) || nowMs - written > THESES_FRESH_MS) return null;
  const texts = batch.signals.map((s) => ({ id: s.id, text: s.text.trim() })).filter((s) => s.text.length > 0);
  return texts.length > 0 ? { texts, writtenAt: batch.createdAt } : null;
}
