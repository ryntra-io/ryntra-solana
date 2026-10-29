/**
 * The plan draft Ryntra prepares on a prediction market: the entry, the most
 * the person can lose and the exit — numbers to start from, never a decision.
 * It opens in the plan builder, where the person writes their own reason,
 * changes anything and saves it; nothing is placed from here.
 *
 * Pure.
 */

export type PredictionPlanDraft = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  outcomeLabel: string;
  question: string;
  /** The whole stake: on a prediction market the most one can lose is what one puts in. */
  amountUsd: number;
  /** The outcome's price when the draft was made (0–1): the best ask on its venue where read, the midpoint otherwise. */
  entryProbability: number;
  /** The Review refuses a price above this — two points over the entry. */
  maxProbability: number;
  /** Where the person might call the thesis wrong — fifteen points under the entry; null where that leaves nothing. */
  invalidationBelow: number | null;
  /** The market's own close, the last moment the plan stands. */
  deadline: string | null;
  readAt: string;
}>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A draft from the outcome's price now and the stake; null when there is no price to start from. */
export function planDraftFrom(input: Readonly<{ eventId: string; venueMarketId: string; outcomeId: string; outcomeLabel: string; question: string; price: number | null; amountUsd: number | null; deadline: string | null; readAt: string }>): PredictionPlanDraft | null {
  const price = input.price;
  if (price == null || !Number.isFinite(price) || price <= 0 || price >= 1) return null;
  const entry = round2(price);
  if (entry <= 0 || entry >= 1) return null;
  const amount = input.amountUsd != null && Number.isFinite(input.amountUsd) && input.amountUsd > 0 ? Math.min(100_000, round2(input.amountUsd)) : 10;
  const below = round2(entry - 0.15);
  return {
    eventId: input.eventId,
    venueMarketId: input.venueMarketId,
    outcomeId: input.outcomeId,
    outcomeLabel: input.outcomeLabel,
    question: input.question,
    amountUsd: amount,
    entryProbability: entry,
    maxProbability: Math.min(0.99, round2(entry + 0.02)),
    invalidationBelow: below >= 0.02 ? below : null,
    deadline: input.deadline,
    readAt: input.readAt,
  };
}
