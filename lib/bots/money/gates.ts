/**
 * The switches of «Сітка» and «Сигнали» with money. Each bot opens by its own
 * server switch or by the shared one, and only by `on`; anything else, unset included, keeps it closed:
 *
 * - `RYNTRA_BOTS_GRID_MONEY` — the grid's: `on` opens, `off` closes whatever the shared switch says;
 * - `RYNTRA_BOTS_SIGNALS_MONEY` — the signals', the same way;
 * - `RYNTRA_BOTS_MONEY` — both at once, where a bot's own switch is unset.
 *
 * Closed, a budget is not signed for the bot's plan and the agent's book takes no new one (`app/api/bots/mandate/*`);
 * the week on paper stays open. The engine's own switch: the cron's route reads the same switches and hands
 * them to the agent's pass (`lib/mandate/tick.server.ts` `TickDeps.switches`); closed, a bot already signed buys no new
 * level and nothing on its signal, while its sales — her stop, a level's coins one step up, a signal's leave — go on, so
 * what it holds comes home by its rules. The point to roll back to is this switch, not a deployment: a bot's entry in the
 * agent's book is `v: 2` (`lib/mandate/book.server.ts`), which a build of before reads past — it neither buys nor sells
 * for it — and her «Stop» takes it home at any time, as every budget's.
 *
 * Pure: the environment is an argument.
 */

import { TRADER_EXIT, type ExitRules } from "../../mandate/exit.ts";
import type { StrategyPlan } from "../../mandate/plans.ts";

export const BOTS_MONEY_ENV = "RYNTRA_BOTS_MONEY";
export const BOTS_GRID_MONEY_ENV = "RYNTRA_BOTS_GRID_MONEY";
export const BOTS_SIGNALS_MONEY_ENV = "RYNTRA_BOTS_SIGNALS_MONEY";

/** The bots this task gives money: the grid that sells its levels, and signals. */
export const MONEY_BOTS = ["grid", "signals"] as const;
export type MoneyBot = (typeof MONEY_BOTS)[number];

const OWN_ENV: Readonly<Record<MoneyBot, string>> = { grid: BOTS_GRID_MONEY_ENV, signals: BOTS_SIGNALS_MONEY_ENV };

type Env = Readonly<Record<string, string | undefined>>;

const word = (value: string | undefined): "on" | "off" | null => {
  const text = value?.trim().toLowerCase();
  return text === "on" ? "on" : text === "off" ? "off" : null;
};

/** Whether the bot's money is open on this deployment: its own switch, or — unset — the shared one; only `on` opens. */
export function botMoneyOn(bot: MoneyBot, env: Env): boolean {
  const own = word(env[OWN_ENV[bot]]);
  if (own !== null) return own === "on";
  return word(env[BOTS_MONEY_ENV]) === "on";
}

/**
 * The bot a plan is: the grid that sells its levels (`grid:…,sell:1`), or a signal; null — a plan of the budget's own
 * (regular buys, a dip, a grid that only buys, an early launch), which this task does not touch.
 */
export function botOfPlan(plan: StrategyPlan | null): MoneyBot | null {
  if (!plan) return null;
  if (plan.id === "grid" && plan.sell === true) return "grid";
  if (plan.id === "signal") return "signals";
  return null;
}

/**
 * The switches the agent's pass runs by, as the cron's route read them from its environment: the agent's own
 * exit (`RYNTRA_AGENT_EXIT`) and each bot's money. The engine reads no environment; a pass handed none runs with all of
 * them closed.
 */
export type EngineSwitches = Readonly<{ agentExit: boolean; bots: Readonly<Record<MoneyBot, boolean>> }>;

/** Every switch closed: what a pass runs by when nothing was handed in. */
export const SWITCHES_CLOSED: EngineSwitches = Object.freeze({ agentExit: false, bots: Object.freeze({ grid: false, signals: false }) });

/**
 * Whether a bot buys on this pass: its money open and the agent's own exit open — a bot that cannot sell its levels or
 * leave on its signal does not pile up coins it has no way out of but her stop.
 */
export const botBuysOpen = (bot: MoneyBot, switches: EngineSwitches | undefined): boolean => switches?.agentExit === true && switches.bots?.[bot] === true;

/** Why a plan is not one a budget may be signed for here; null when it may. */
export function botMoneyRefusal(plan: StrategyPlan | null, env: Env): string | null {
  const bot = botOfPlan(plan);
  if (bot === null || botMoneyOn(bot, env)) return null;
  return bot === "grid" ? "The grid trades on paper here." : "Signals trade on paper here.";
}

/**
 * The person's exit rules a bot's budget is signed with (`../../mandate/exit.ts`), shown on its ticket before her
 * signature: the grid keeps only the stop — the agent's own autostop, −15 % — since its levels are its own way out, and
 * half at 2x or a fade would sell the levels from under it; a signal keeps the Trader's rules beside its own leave.
 */
export const GRID_EXIT: ExitRules = Object.freeze({ stopBps: 1_500, halfAtBps: null, fadeBps: null, holdH: null });

/** The exit rules a budget for this plan is signed with: a bot's own, or — any other plan — the Trader's. */
export const exitRulesOf = (plan: StrategyPlan | null): ExitRules => (botOfPlan(plan) === "grid" ? GRID_EXIT : TRADER_EXIT);
