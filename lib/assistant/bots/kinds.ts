/**
 * The bots Ryntra names in the bots hub (CITY-133, B3) — the ones the engine
 * reads and replays end to end: its weather rates them (`lib/bots/weather`,
 * CITY-132) and its backtest plays them with their costs
 * (`lib/bots/backtest`). A bot the engine does not replay (a rebalancer, an
 * alert, a signal) is never suggested or simulated here: Ryntra says it does
 * not read it, rather than guess.
 *
 * The names are the city window's own draft kinds (`city/lib/bots/draft.ts`),
 * so a draft opens in the window's review as it is. Facts only; words live
 * in `words.ts`. Pure.
 */

import type { WeatherBot } from "../../bots/weather/weather.ts";

export const ASSISTANT_BOT_KINDS = ["grid", "buyLadder", "exitLadder", "recurring"] as const;
export type AssistantBotKind = (typeof ASSISTANT_BOT_KINDS)[number];

export function isAssistantBotKind(value: unknown): value is AssistantBotKind {
  return typeof value === "string" && (ASSISTANT_BOT_KINDS as readonly string[]).includes(value);
}

/** Each bot as the weather engine names it. */
export const ENGINE_WEATHER_BOT: Readonly<Record<AssistantBotKind, WeatherBot>> = {
  grid: "grid",
  buyLadder: "ladder_buy",
  exitLadder: "ladder_sell",
  recurring: "dca",
};

/** What a person wants — the window's goals; «Keep the balance» has no bot the engine replays yet. */
export const ASSISTANT_GOALS = ["swings", "accumulate", "profit"] as const;
export type AssistantGoal = (typeof ASSISTANT_GOALS)[number];

export const GOAL_BOTS: Readonly<Record<AssistantGoal, readonly AssistantBotKind[]>> = {
  swings: ["grid"],
  accumulate: ["recurring", "buyLadder"],
  profit: ["exitLadder"],
};

/** How long the person means to run it, and the days the engine replays for it. */
export const HORIZONS = { week: 7, month: 30, half_year: 180 } as const;
export type Horizon = keyof typeof HORIZONS;
export const HORIZON_KEYS = Object.keys(HORIZONS) as readonly Horizon[];

/** The windows a simulation covers, in days. */
export const SIM_DAYS = [7, 30, 180] as const;
export type SimDays = (typeof SIM_DAYS)[number];

/**
 * How well a bot suits a horizon, 0 … 2 — a product rule, not a market read: a grid earns on a range over days and
 * weeks; ladders wait for the price to come to them; buying in parts needs months to average anything.
 */
export const HORIZON_SUITS: Readonly<Record<AssistantBotKind, Readonly<Record<Horizon, 0 | 1 | 2>>>> = {
  grid: { week: 2, month: 2, half_year: 1 },
  buyLadder: { week: 1, month: 2, half_year: 2 },
  exitLadder: { week: 1, month: 2, half_year: 1 },
  recurring: { week: 0, month: 1, half_year: 2 },
};

/**
 * Where a live bot's money sits (the window's `KIND_FACTS`): a pool position or orders on the chain that only the
 * person's wallet takes back, or the wallet itself with one tap a purchase. Never a custodial vault.
 */
export const BOT_CUSTODY: Readonly<Record<AssistantBotKind, "position" | "order" | "wallet">> = {
  grid: "position",
  buyLadder: "order",
  exitLadder: "order",
  recurring: "wallet",
};
