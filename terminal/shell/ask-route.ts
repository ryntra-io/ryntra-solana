import { keyOf, ROWS_MAX, suggest, type Book, type Command, type Context, type Gates } from '../../city/lib/command/parse.ts';
import { planCommand } from '../../city/lib/command/plan.ts';
import { readDraft, type SentenceNeed } from '../../lib/sentence/plan.ts';
import { agentRow, crewOpen } from '../agents/read.ts';
import { coinHref, shelfHref, type ShelfId, type View } from './shelves.ts';

/**
 * The agent's line in the terminal: the city's own reading of a sentence (`city/lib/command/parse.ts` — the same words,
 * coins and amounts, English and Ukrainian), and where in the terminal each reading opens. A window of the city is a
 * shelf here; a sentence never opens a shelf that is not on, and never signs anything — the screen it opens shows what
 * was said, and the person confirms there.
 *
 * Pure: the screens and the tests read it as it is.
 */

/**
 * Where a reading opens: a shelf, and for a coin's own screen its mint; `path` — a screen of the shelf at an address of
 * its own (a bot's page under «Bots»).
 */
export type AskTarget = Readonly<{ shelf: ShelfId; mint: string | null; path?: string }>;

const at = (shelf: ShelfId, mint: string | null = null): AskTarget => ({ shelf, mint });

/** A bot's own page on the Agents shelf: a rule a person sets is a bot's, not an agent's (decision 109). */
const bot = (id: 'recurring' | 'autopilot'): AskTarget => ({ shelf: 'agents', mint: null, path: `/bots/${id}` });

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
    // A budget a day is Recurring buys; one plan for the whole budget is the money autopilot: bots, each on its page.
    case 'autopilot':
      return bot('recurring');
    case 'pilot':
      return bot('autopilot');
    // A hire names its worker: the bots on their pages, the pool keeper on Earn, the launcher on Launch; a hire of no
    // one, a question and an instruction are the Agents screen's.
    case 'hire':
      if (command.ask.role === 'trader') return bot('recurring');
      if (command.ask.role === 'pilot') return bot('autopilot');
      if (command.ask.role === 'keeper') return at('earn');
      if (command.ask.role === 'launcher') return at('launch');
      return at('agents');
    case 'instruct':
    case 'instructions':
    case 'ask':
      return at('agents');
    case 'learn':
      return null;
  }
}

/** A reading's address in this view: the kit page has one preview a shelf. */
export function askHref(target: AskTarget, view: View): string {
  if (target.path && view === 'live') return target.path;
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

/* ------------------------------------------------------------------------------------------------ The model */

/** Words that hand the work over or put it on a schedule: a plain trade read with one of them is the agent's job. */
const HANDED = /(?<![\p{L}\p{N}])(за мене|замість мене|для мене|сам|сама|самостійно|автоматично|щодня|щотижня|щомісяця|кожен|кожного|кожну|щоранку|for me|on my behalf|instead of me|by itself|automatically|daily|weekly|monthly|every|each|агент\p{L}*|бот\p{L}*|agent|agents|bot|bots|доглядай|look after|знаходь|шукай|find|scout)(?![\p{L}\p{N}])/iu;

/**
 * Whether the line asks the model for a sentence (registry: the rules first and free, the model when they did
 * not understand): nothing read, or only a question for Ryntra that is not asked as a question; an agent's job read
 * without the digits the sentence typed, or without the agent it names; a plain trade said with words that hand it over
 * or put it on a schedule («купуй SOL щодня»). A sentence that ends with «?» is a question: Ryntra answers it.
 */
export function modelWanted(sentence: string, first: AskRow | null): boolean {
  const said = sentence.trim();
  if (!said || /\?\s*$/u.test(said)) return false;
  if (!first || first.command.kind === 'ask') return true;
  const command = first.command;
  if (command.kind === 'autopilot' && command.ask.kind === 'trade') return command.ask.perDaySol === null && /\d/u.test(said);
  if (command.kind === 'hire') return command.ask.role === null;
  if (command.kind === 'buy' || command.kind === 'sell' || command.kind === 'coin' || command.kind === 'earn') return HANDED.test(said);
  return false;
}

/** What the model's draft gives the line: the row of the shelf that fills the card, a question back, or nothing it can open. */
export type PlanAnswer = Readonly<{ kind: 'row'; row: AskRow }> | Readonly<{ kind: 'clarify'; need: SentenceNeed; word?: string }> | null;

/**
 * The model's draft for a sentence, checked by the engine against the person's words and the book (`readDraft`), as the
 * row of the shelf whose card it fills — on the shelves that are on, by the gates the line itself opens. Null when the
 * plan has no shelf here: the line then reads the sentence by its own rules.
 */
export function planAnswer(draft: unknown, sentence: string, book: Book, on: (id: ShelfId) => boolean, engine: Gates): PlanAnswer {
  const reading = readDraft(draft, sentence, book.coins);
  if (reading.kind === 'clarify') return reading.word ? { kind: 'clarify', need: reading.need, word: reading.word } : { kind: 'clarify', need: reading.need };
  const gates = gatesFor(on, engine);
  const command = planCommand(reading.plan, gates, crewOpen(gates, on('earn')));
  const target = command ? targetOf(command) : null;
  return command && target && on(target.shelf) ? { kind: 'row', row: { key: `plan:${keyOf(command)}`, command, target } } : null;
}
