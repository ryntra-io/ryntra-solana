/**
 * Weight classes by the price of the brain (CITY-50, decision 72; `REVIEW.md`, «Ринг»). A match pairs two agents of
 * one class, so a cheap model never meets one that costs fifty times more.
 *
 * The class is read from one standard match: 20 moves of 2 000 tokens each — 1 800 read (the match so far), 200
 * written (the move) — at the price of the provider the agent is pinned to (`preflight`'s model, never the model-wide
 * figure). The review's figures for two agents (light ≈ $0.02, middle ≈ $0.25–0.32, heavy ≈ $0.64–1.60, prices of
 * 27.10) fall clear of the bounds below:
 *
 *   light   — under $0.04 a match for one agent   (0.9 × input + 0.1 × output under $1 per 1M tokens)
 *   middle  — under $0.24                          (under $6 per 1M)
 *   heavy   — up to $2.00                          (up to $50 per 1M)
 *
 * A model dearer than the heavy ceiling is not offered: one match would cost one agent more than $2 before any long
 * thinking. A model without a known price is never offered either (the gateway refuses it).
 *
 * Each agent's own OpenRouter key gets a dollar limit by its class, renewed monthly: the most it can ever spend.
 *
 * Pure: no store, no clock, no network.
 */

import { estimateCostMicroUsd, type Priced } from "../models/catalog.ts";
import type { Weight } from "./contract.ts";

/** One standard match for one agent. */
export const MATCH = { moves: 20, inputPerMove: 1_800, outputPerMove: 200 } as const;

/** Upper bounds of a class, micro-dollars a match for one agent: below `light` is light, below `middle` is middle. */
export const WEIGHT_BOUNDS = { light: 40_000, middle: 240_000, heavy: 2_000_000 } as const;

/** The monthly dollar limit of an agent's own key, by class (at most `KEY_LIMIT_MAX_USD` of the gateway). */
export const KEY_LIMIT_USD: Readonly<Record<Weight, number>> = { light: 1, middle: 5, heavy: 20 };

/** What one standard match costs one agent at these prices, micro-dollars rounded up; `null` when a price is unknown. */
export function matchCostMicroUsd(priced: Priced): number | null {
  const move = estimateCostMicroUsd(priced, { input: MATCH.inputPerMove, output: MATCH.outputPerMove });
  return move === null ? null : move * MATCH.moves;
}

/** The class of a match cost, or `null` above the heavy ceiling (or for a cost that is not a number). */
export function weightOf(matchMicroUsd: number | null): Weight | null {
  if (matchMicroUsd === null || !Number.isFinite(matchMicroUsd) || matchMicroUsd < 0) return null;
  if (matchMicroUsd < WEIGHT_BOUNDS.light) return "light";
  if (matchMicroUsd < WEIGHT_BOUNDS.middle) return "middle";
  if (matchMicroUsd <= WEIGHT_BOUNDS.heavy) return "heavy";
  return null;
}
