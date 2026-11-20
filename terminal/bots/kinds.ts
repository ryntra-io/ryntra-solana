import { ladderNetwork } from '../../lib/bots/ladder/network.ts';
import { engineGates } from '../shell/engine.ts';

/**
 * The bots of the terminal: a bot runs the rule a person set — a sum, a price, a
 * time, a condition — and decides nothing by itself; that is an agent's job (`../agents/`). Each bot is a screen of its
 * own at its own address under «Bots», in the menu's order (`../shell/menu.ts`): what it does in one line, its form, and
 * under it the person's bots of that kind — as many at once as she likes, each stopped on its own.
 *
 * - Recurring buys — the rule that buys a coin on a budget a day: the mandate's engine (`lib/mandate`, the city's
 *   `city/lib/autopilot` and `city/lib/bots/mandate*`), the card that was the Agents screen's «Trader».
 * - Grid — buys lower and sells higher inside a band of prices: two ladders of Meteora DLMM Pro limit orders placed
 *   with one signature, taken and placed again with a tap (`lib/grid`); drawn everywhere, signs where the
 *   deployment names the DLMM Pro orders' network.
 * - Order ladder — several limit orders at once on a coin's Meteora pool, signed once: the ladder's engine
 *   (`lib/bots/ladder`, the city's `city/lib/bots/ladder*`), where the deployment names its network.
 * - Signals — buys when the fast average crosses over the slow one and sells when it falls under; on paper.
 * - Money autopilot — one plan for the whole budget; where its engine is open.
 *
 * Pure: the doors are an argument; `botDoors()` reads this deployment's.
 */

export const BOT_IDS = ['recurring', 'grid', 'ladder', 'signals', 'autopilot'] as const;
export type BotId = (typeof BOT_IDS)[number];

/**
 * Each bot's page in its category. Every bot is a terminal with a chart — the whole working width, the
 * page «desk»: the Grid on its own desk
 * (`GridScreen`), the others on the section's (`BotsScreen`). `docs/terminal/DESIGN.md`, «Сторінка», holds the rule;
 * `terminal/styles/page.test.mjs` keeps it.
 */
export const BOT_PAGE = { recurring: 'chart', grid: 'chart', ladder: 'chart', signals: 'chart', autopilot: 'chart' } as const satisfies Record<BotId, 'form' | 'chart'>;

/** A bot drawn by the section's own desk (`BotsScreen.tsx`): every one but the Grid, which has a desk of its own. */
export type DeskBotId = Exclude<BotId, 'grid'>;

/** The bots' addresses: `/bots/<bot>`, each a page of its own on the Agents shelf. */
export const BOTS_PATH = '/bots';

export const botHref = (id: BotId): string => `${BOTS_PATH}/${id}`;

export const isBotId = (value: unknown): value is BotId => typeof value === 'string' && (BOT_IDS as readonly string[]).includes(value);

/** The bots that run on paper — in this browser, on the market's own week; no money, no signature — and the city's kind of each. */
export const PAPER_KIND = { signals: 'signal' } as const satisfies Partial<Record<BotId, string>>;
export type PaperBotId = keyof typeof PAPER_KIND;

export const isPaperBot = (id: BotId): id is PaperBotId => id in PAPER_KIND;

/** The engines a bot waits for on a deployment, besides the Agents shelf. */
export type BotDoors = Readonly<{ trader: boolean; ladder: boolean; pilot: boolean }>;

export const EVERY_BOT_DOOR: BotDoors = { trader: true, ladder: true, pilot: true };

/** Whether a bot stands: the paper ones and the grid everywhere (the grid signs only where its network is named); the others where their engines run. */
export function botOpen(id: BotId, doors: BotDoors): boolean {
  switch (id) {
    case 'recurring':
      return doors.trader;
    case 'ladder':
      return doors.ladder;
    case 'autopilot':
      return doors.pilot;
    case 'grid':
    case 'signals':
      return true;
  }
}

/** The bots that stand, in the menu's order. */
export function botsOpen(doors: BotDoors): BotId[] {
  return BOT_IDS.filter((id) => botOpen(id, doors));
}

/**
 * This deployment's doors: the mandate's engine as the agent's line opens it, the ladder's network as the city's window
 * reads it (`city/lib/bots/ladder.ts` `LADDER_NET`, written out here so a page does not load the ladder's store), the
 * money autopilot's switch.
 */
export function botDoors(): BotDoors {
  const gates = engineGates();
  return {
    trader: gates.agentTrade === true,
    ladder: ladderNetwork(process.env.NEXT_PUBLIC_RYNTRA_CITY_LADDER) !== null,
    pilot: gates.pilot === true,
  };
}
