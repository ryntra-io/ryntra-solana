/**
 * The Scout's switch and its ceilings on this deployment. Off unless the deployment turns it on:
 *
 *   RYNTRA_SCOUT=paper           the pass runs (the cron), on paper only — no money, no signature
 *   RYNTRA_SCOUT_DAY_USD=0.5     the model's day ceiling in dollars, lower than the code's (`SCOUT_THESIS.dayUsd`), never higher
 *   RYNTRA_SCOUT_MODEL=…         the model the thesis asks, else the assistant provider's everyday one
 *
 * The model is the assistant's provider (`RYNTRA_ASSISTANT_PROVIDER` with its key); without a key the pass still screens
 * and reads the chain, and every coin that reaches the thesis is journalled as «watch: the model is off» — the Scout
 * takes nothing without a thesis. There is no money mode here: buying with money is the person's mandate's, connected
 * once the agent sells by itself.
 *
 * Pure: the environment is handed in.
 */

import { SCOUT_THESIS } from "./rules.ts";

export const SCOUT_SWITCH_ENV = "RYNTRA_SCOUT";
export const SCOUT_DAY_USD_ENV = "RYNTRA_SCOUT_DAY_USD";
export const SCOUT_MODEL_ENV = "RYNTRA_SCOUT_MODEL";

export type ScoutMode = "off" | "paper";

type Env = Readonly<Record<string, string | undefined>>;

/** `paper` only when the switch says so; anything else is off. */
export function scoutModeOf(env: Env): ScoutMode {
  return env[SCOUT_SWITCH_ENV]?.trim().toLowerCase() === "paper" ? "paper" : "off";
}

/** The model's day ceiling in dollars: the deployment's, when it is lower than the code's. */
export function dayUsdOf(env: Env): number {
  const set = Number(env[SCOUT_DAY_USD_ENV]?.trim());
  return Number.isFinite(set) && set > 0 ? Math.min(set, SCOUT_THESIS.dayUsd) : SCOUT_THESIS.dayUsd;
}

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}(\/[a-z0-9][a-z0-9._:-]{1,63})?$/i;

/** The model the deployment names for the thesis, or null. */
export function namedScoutModel(env: Env): string | null {
  const named = env[SCOUT_MODEL_ENV]?.trim();
  return named && MODEL_NAME.test(named) ? named : null;
}

export type TokenPrice = Readonly<{ input: number; output: number }>;

/**
 * How many model calls a day may make: the day's dollars over the dearest one call can cost — its input at most
 * `inputTokens`, its output at most `outputTokens`, at the model's price per million tokens — and never more than
 * `dayCalls`. An unknown price is the dearest the book knows, never free.
 */
export function thesisCallsAllowed(input: Readonly<{ dayUsd: number; price: TokenPrice; inputTokens: number; outputTokens: number; dayCalls?: number }>): number {
  const perCall = (input.inputTokens * input.price.input + input.outputTokens * input.price.output) / 1_000_000;
  const ceiling = input.dayCalls ?? SCOUT_THESIS.dayCalls;
  if (!(perCall > 0)) return 0;
  return Math.max(0, Math.min(ceiling, Math.floor(input.dayUsd / perCall)));
}
