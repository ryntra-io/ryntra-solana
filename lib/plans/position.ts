/**
 * The position a plan's own executions add up to — `RYN-RESULTS-MEMORY-001`.
 *
 * An entry establishes a position, an exit reduces it, and a plan with no
 * settled entry has none. That is the whole model: there is no second
 * portfolio here and nothing is priced. Holdings answers *what do I hold
 * now* off the chain; this answers *what did this plan do*, off the plan's
 * own results and nothing else, so the two can never disagree about a
 * number because neither computes the other's.
 *
 * **A realised figure is the exception, not the rule.** It is stated only
 * when the position is closed, every entry and every exit carries a dollar
 * value, and every leg states a fee — and then `realisedMethod` names how it
 * was computed, in one sentence a person can check. In every other case it
 * is null and `unknowns` says exactly what is missing. A plan that is still
 * open has no profit and loss, and saying so is the answer, not a gap.
 *
 * Units are summed as integers in the plan's own unit at six places — the
 * places `scaledAmountString` writes — so a sum never drifts the way adding
 * floats would. Pure.
 */

import type { PlanPosition, PlanResult } from "../api/v1/contract.ts";

const PLACES = 6;
const SCALE = 10n ** BigInt(PLACES);

/** A decimal string at six places as an integer of micro-units; anything unreadable is null rather than zero. */
function microsOf(text: string | null): bigint | null {
  if (text === null) return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (!match) return null;
  const frac = (match[2] ?? "").slice(0, PLACES).padEnd(PLACES, "0");
  return BigInt(match[1]) * SCALE + BigInt(frac);
}

function textOf(micros: bigint): string {
  const whole = micros / SCALE;
  const frac = (micros % SCALE).toString().padStart(PLACES, "0");
  return `${whole}.${frac}`;
}

/** Why no realised figure is stated. Stable ids; the client says them in the reader's language. */
export const POSITION_UNKNOWNS = ["position-open", "no-entry", "side-not-established", "entry-not-valued", "exit-not-valued", "units-not-countable", "fee-not-recorded"] as const;
export type PositionUnknown = (typeof POSITION_UNKNOWNS)[number];

const EMPTY: PlanPosition = {
  state: "none",
  unitsIn: "0.000000",
  unitsOut: "0.000000",
  unitsHeld: "0.000000",
  entries: 0,
  exits: 0,
  costBasisUsd: null,
  proceedsUsd: null,
  feesUsd: null,
  realisedUsd: null,
  realisedMethod: null,
  unknowns: ["no-entry"],
};

/**
 * The position of one plan, from its own results. Only settled executions
 * count: a failed or unsettled one changes nothing but is remembered as an
 * unknown when its side was never established, because a leg nobody can
 * place is exactly the reason a realised figure may not be stated.
 */
export function positionOf(results: readonly PlanResult[]): PlanPosition {
  const settled = results.filter((result) => result.actual.outcome === "DONE");
  if (settled.length === 0) return EMPTY;

  const unknowns = new Set<PositionUnknown>();
  let inMicros = 0n;
  let outMicros = 0n;
  let entries = 0;
  let exits = 0;
  let cost = 0;
  let proceeds = 0;
  let fees = 0;
  let costKnown = true;
  let proceedsKnown = true;
  let feesKnown = true;

  for (const result of settled) {
    const actual = result.actual;
    if (actual.leg === null) {
      unknowns.add("side-not-established");
      continue;
    }
    if (actual.feeUsd === null) {
      feesKnown = false;
      unknowns.add("fee-not-recorded");
    } else fees += actual.feeUsd;

    if (actual.leg === "entry") {
      entries += 1;
      const micros = microsOf(actual.amount);
      if (micros === null) unknowns.add("units-not-countable");
      else inMicros += micros;
      if (actual.usd === null) {
        costKnown = false;
        unknowns.add("entry-not-valued");
      } else cost += actual.usd;
    } else {
      exits += 1;
      const micros = microsOf(actual.unitsOut);
      if (micros === null) unknowns.add("units-not-countable");
      else outMicros += micros;
      if (actual.proceedsUsd === null) {
        proceedsKnown = false;
        unknowns.add("exit-not-valued");
      } else proceeds += actual.proceedsUsd;
    }
  }

  if (entries === 0) return { ...EMPTY, exits, unitsOut: textOf(outMicros), unknowns: [...new Set<string>(["no-entry", ...unknowns])].slice(0, 6) };

  const heldMicros = inMicros > outMicros ? inMicros - outMicros : 0n;
  /* Closed when the exits have taken back everything the entries brought — the rounding of the sixth place is the plan's own unit, not a tolerance invented here. */
  const closed = exits > 0 && outMicros >= inMicros;
  const state: PlanPosition["state"] = closed ? "closed" : "open";
  if (!closed) unknowns.add("position-open");

  const costBasisUsd = costKnown ? Math.round(cost * 1e6) / 1e6 : null;
  const proceedsUsd = exits === 0 ? null : proceedsKnown ? Math.round(proceeds * 1e6) / 1e6 : null;
  const feesUsd = feesKnown ? Math.round(fees * 1e6) / 1e6 : null;

  const realisable = closed && costBasisUsd !== null && proceedsUsd !== null && feesUsd !== null && unknowns.size === 0;
  return {
    state,
    unitsIn: textOf(inMicros),
    unitsOut: textOf(outMicros),
    unitsHeld: textOf(heldMicros),
    entries,
    exits,
    costBasisUsd,
    proceedsUsd,
    feesUsd,
    realisedUsd: realisable ? Math.round((proceedsUsd - costBasisUsd - feesUsd) * 100) / 100 : null,
    realisedMethod: realisable ? "proceeds-minus-cost-basis-and-fees" : null,
    unknowns: [...unknowns].slice(0, 6),
  };
}
