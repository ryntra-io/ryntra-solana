import { GOAL_KINDS, KIND_FACTS, type BotKind, type Goal } from './kinds.ts';
import { fitOf, type Fit, type Sky, type Weather } from './weather.ts';
import type { DraftKind } from './draft.ts';

/**
 * The newcomer's second tap: for a goal and this week's weather, one bot and the two or three reasons for it. The goal
 * decides first; the engine's weather only chooses between a goal's bots — the one that fits best, the goal's first on a
 * tie — and is said as a reason. A goal whose bots all fit poorly keeps its first one, and the reason says so.
 */

export type Reason =
  | Readonly<{ id: 'goal'; goal: Goal }>
  | Readonly<{ id: 'weather'; sky: Sky; fit: Fit }>
  | Readonly<{ id: 'custody'; custody: (typeof KIND_FACTS)[BotKind]['custody'] }>
  | Readonly<{ id: 'tap' }>
  | Readonly<{ id: 'standalone' }>;

export type Recommendation = Readonly<{ kind: DraftKind; reasons: readonly Reason[] }>;

const RANK: Readonly<Record<Fit, number>> = { good: 2, fair: 1, poor: 0 };

/** The bots the newcomer is offered for each goal, the goal's own first; «Copy» and the signal bot wait for the hub. */
const OFFERED: Readonly<Record<Goal, readonly DraftKind[]>> = {
  swings: ['grid', 'lpRange'],
  accumulate: ['recurring', 'buyLadder'],
  profit: ['exitLadder', 'priceAlert'],
  balance: ['rebalancer'],
};

export function recommend(goal: Goal, weather: Weather | null): Recommendation {
  let kind = OFFERED[goal][0]!;
  if (weather) for (const other of OFFERED[goal].slice(1)) if (RANK[fitOf(other, weather)] > RANK[fitOf(kind, weather)]) kind = other;
  // A goal's bots only: the recommendation never wanders off the goal the person chose.
  if (!GOAL_KINDS[goal].includes(kind)) kind = GOAL_KINDS[goal][0] as DraftKind;
  const facts = KIND_FACTS[kind];
  const reasons: Reason[] = [{ id: 'goal', goal }];
  if (weather) reasons.push({ id: 'weather', sky: weather.sky, fit: fitOf(kind, weather) });
  reasons.push({ id: 'custody', custody: facts.custody });
  if (facts.drive === 'tap') reasons.push({ id: 'tap' });
  else if (facts.standalone) reasons.push({ id: 'standalone' });
  return { kind, reasons: reasons.slice(0, 3) };
}
