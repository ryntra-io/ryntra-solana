import { ROWS_MAX, suggest, type Book, type Command, type Context, type Gates } from '../../city/lib/command/parse.ts';
import { agentRow } from '../agents/read.ts';
import { coinHref, shelfHref, type ShelfId, type View } from './shelves.ts';

/**
 * The agent's line in the terminal: the city's own reading of a sentence (`city/lib/command/parse.ts` — the same words,
 * coins and amounts, English and Ukrainian), and where in the terminal each reading opens. A window of the city is a
 * shelf here; a sentence never opens a shelf that is not on, and never signs anything — the screen it opens shows what
 * was said, and the person confirms there.
 *
 * Pure: the screens and the tests read it as it is.
 */

/** Where a reading opens: a shelf, and for a coin's own screen its mint. */
export type AskTarget = Readonly<{ shelf: ShelfId; mint: string | null }>;

const at = (shelf: ShelfId, mint: string | null = null): AskTarget => ({ shelf, mint });

/** The shelf a reading of the sentence opens, or null when the terminal has no place for it. */
export function targetOf(command: Command): AskTarget | null {
  switch (command.kind) {
    case 'buy':
    case 'sell':
      // The plain swap is the Swap shelf; a coin's trade with its chart is the coin's own screen.
      return command.view === 'swap' ? at('swap') : at('market', command.coin.mint);
    case 'order':
    case 'chart':
    case 'coin':
      return at('market', command.coin.mint);
    case 'ladder':
      return at('market', command.ask.coin.mint);
    case 'mint':
      return at('market', command.mint);
    case 'money':
      if (command.place === 'portfolio' || command.place === 'activity') return at('portfolio');
      // Top up, send and the bridge stand on the Swap shelf; a pay link has no place in the terminal yet.
      return command.place === 'paylink' ? null : at('swap');
    case 'earn':
    case 'dollar':
      return at('earn');
    case 'launch':
      return at('launch');
    case 'instruct':
    case 'instructions':
    case 'autopilot':
    case 'pilot':
    case 'hire':
    case 'ask':
      return at('agents');
    case 'learn':
      return null;
  }
}

/** A reading's address in this view. */
export function askHref(target: AskTarget, view: View): string {
  return target.mint ? coinHref(target.mint, view) : shelfHref(target.shelf, view);
}

/** Every gate open: the kit page, where every shelf shows its preview. */
export const EVERY_GATE: Gates = {
  trade: true,
  spot: true,
  money: true,
  earn: true,
  launch: true,
  instruct: true,
  agentTrade: true,
  agentLaunch: true,
  dollar: true,
  pilot: true,
  ladder: true,
};

/**
 * The city's command gates as the terminal opens them: each window's gate is its shelf being on, over the engine's own
 * switch. A limit where the coin's screen is off reads as the coin itself (the city's `fit`), which then is not offered.
 */
export function gatesFor(on: (id: ShelfId) => boolean, engine: Gates): Gates {
  return {
    trade: engine.trade && (on('market') || on('swap')),
    spot: engine.spot && on('market'),
    money: engine.money && (on('portfolio') || on('swap')),
    earn: engine.earn && on('earn'),
    launch: engine.launch && on('launch'),
    instruct: engine.instruct && on('agents'),
    agentTrade: engine.agentTrade === true && on('agents'),
    agentLaunch: engine.agentLaunch === true && on('agents'),
    dollar: engine.dollar === true && on('earn'),
    pilot: engine.pilot === true && on('agents'),
    ladder: engine.ladder === true && on('market'),
  };
}

export type AskRow = Readonly<{ key: string; command: Command; target: AskTarget }>;

/**
 * The rows under the agent's line: the city's list for the sentence, each row a shelf that is on. A job for an agent —
 * a budget a day, one plan for the money, a hire — stands first, as in the city's own line (`../agents/read.ts`): the
 * Agents shelf takes it.
 */
export function askRows(input: string, book: Book, context: Context, on: (id: ShelfId) => boolean, engine: Gates): AskRow[] {
  const gates = gatesFor(on, engine);
  const listed = suggest(input, book, context, gates);
  const job = on('agents') ? agentRow(input, book, context, gates, on('earn')) : null;
  const rows = job ? [job, ...listed.filter((row) => row.key !== job.key)].slice(0, ROWS_MAX) : listed;
  return rows.flatMap((row) => {
    const target = targetOf(row.command);
    return target && on(target.shelf) ? [{ key: row.key, command: row.command, target }] : [];
  });
}
