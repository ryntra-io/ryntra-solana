import { priceOff, readCondition } from '../../city/lib/command/condition.ts';
import { fit, keyOf, ROWS_MAX, suggest, type Book, type Command, type Context, type Gates } from '../../city/lib/command/parse.ts';
import { planCommand } from '../../city/lib/command/plan.ts';
import { readDraft, type SentenceNeed } from '../../lib/sentence/plan.ts';
import { agentRow, crewOpen, planRecurring } from '../agents/read.ts';
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

/**
 * The AI trader's plan: a budget a day said to the agent — «Trade JUP every day» — opens the
 * agent's plan on the Agents shelf, the coin, the budget, the trade, the term and the fee, «Practice first» and
 * «Connect and give the budget» — never a bot's card. A regular purchase on a schedule stays the bot's (a rule).
 */
export const AI_TRADER: AskTarget = { shelf: 'agents', mint: null, path: '/agent?ai=trader' };

/**
 * The market's new coins — the Launch's «New» tab — where a sentence about new coins opens (QA 19.11:
 * «Find new coins for me» opened Recurring buys on JUP with «New launches that pass the check» over it). Until the
 * scout buys new coins by itself, no card is filled with a plan the terminal cannot run: the person sees the
 * new coins, as the sentence asked, and picks.
 */
export const NEW_COINS: AskTarget = { shelf: 'launch', mint: null, path: '/launch?tab=fresh' };

/** The row a ready sentence about new coins opens: the market's new coins, at once — no model asked for it. */
export function newCoinsRow(said: string): AskRow {
  return { key: 'new-coins', command: { kind: 'ask', question: said }, target: NEW_COINS };
}

/** The Scout — the agent that finds new coins by itself, on the Agents shelf. */
export const SCOUT_AGENT: AskTarget = { shelf: 'agents', mint: null, path: '/agent?ai=scout' };

/**
 * The row the first screen's «Find new coins» opens once the Scout's screen stands: the agent that does just
 * that — a day and a trade of the person's, one tap to start it — rather than a list to pick from.
 */
export function scoutRow(said: string): AskRow {
  return { key: 'scout', command: { kind: 'ask', question: said }, target: SCOUT_AGENT };
}

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
    // A budget a day is Recurring buys; one plan for the whole budget is the money autopilot: bots, each on its page. New
    // launches bought early («купуй нові запуски», the model's scout) are no bot's yet: the market's new coins.
    case 'autopilot':
      return command.ask.kind === 'trade' && command.ask.plan?.id === 'early' ? NEW_COINS : AI_TRADER;
    case 'pilot':
      return bot('autopilot');
    // A hire names its worker: the bots on their pages, the pool keeper on Earn, the launcher on Launch; a hire of no
    // one, a question and an instruction are the Agents screen's.
    case 'hire':
      if (command.ask.role === 'trader') return AI_TRADER;
      if (command.ask.role === 'pilot') return bot('autopilot');
      if (command.ask.role === 'keeper') return at('earn');
      if (command.ask.role === 'launcher') return at('launch');
      return at('agents');
    // A regular purchase is Recurring buys.
    case 'instruct':
      return command.instruction.kind === 'recurring' ? bot('recurring') : at('agents');
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
  // «Buy ANT if it drops 5%»: one order that rests on the coin's screen, before any job — never a budget a day for it.
  const condition = readCondition(input, book, context);
  const ordered = condition?.kind === 'order' ? fit(condition.command, gates) : null;
  const job = ordered ? { key: keyOf(ordered), command: ordered } : on('agents') ? agentRow(input, book, context, gates, on('earn')) : null;
  const rows = job ? [job, ...listed.filter((row) => row.key !== job.key)].slice(0, ROWS_MAX) : listed;
  return rows.flatMap((row) => {
    const target = targetOf(row.command);
    return target && on(target.shelf) ? [{ key: row.key, command: row.command, target }] : [];
  });
}

/**
 * The rows as the screen in front takes them: a plain buy or sell said on the Swap screen fills that screen's form, and
 * the person stays on it (QA 19.11: «купи SOL на 10 USDC» on «Обмін» led to the Spot). A limit, a chart or a coin's own
 * screen still opens the coin's.
 */
export function stayOn(rows: readonly AskRow[], here: ShelfId | null, on: (id: ShelfId) => boolean): AskRow[] {
  if (here !== 'swap' || !on('swap')) return [...rows];
  return rows.map((row) => ((row.command.kind === 'buy' || row.command.kind === 'sell') && row.target.shelf === 'market' ? { ...row, target: at('swap') } : row));
}

/**
 * Whether the sentence asks for a buy or a sale on a condition the terminal cannot rest — a buy on a rise, a condition
 * with no level, on another coin: the line then asks which action, and no model is asked to guess a screen for it.
 */
export function conditionUnsure(input: string, book: Book, context: Context): boolean {
  return readCondition(input, book, context)?.kind === 'unsure';
}

/** A coin's price now as the line knows it, in dollars; null when it knows none. */
export type PriceOf = (mint: string) => number | null;

/**
 * A conditional order as its screen takes it: the price from the price now and the per cent said (`off`), in what the
 * pair is priced in — dollars, or SOL. A price the line does not know is left for the person to write: the order still
 * opens on its coin, with the amount said.
 */
export function pricedRow(row: AskRow, priceOf: PriceOf, solMint: string): AskRow {
  const command = row.command;
  if (command.kind !== 'order' || command.off === undefined || command.price !== null) return row;
  const unit = command.pay === 'SOL' ? priceOf(solMint) : 1;
  const price = unit === null ? null : priceOff(priceOf(command.coin.mint), command.off, unit);
  return { ...row, command: { ...command, price } };
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
  const command = planRecurring(reading.plan, gates) ?? planCommand(reading.plan, gates, crewOpen(gates, on('earn')));
  const target = command ? targetOf(command) : null;
  return command && target && on(target.shelf) ? { kind: 'row', row: { key: `plan:${keyOf(command)}`, command, target } } : null;
}

/* ------------------------------------------------------------------------------------- coins beyond the market's top */

/** A coin of the engine's own lists as the line needs it: the market-depth answer's fields it reads. */
export type ShelfCoin = Readonly<{ id: string; symbol: string; name: string; kind: string; verified: boolean; copyOf?: string | null }>;

/** A coin of a token search as the line needs it (`city/lib/search/rank.ts` `CatalogRow`, with its own-ticker check). */
export type FoundCoin = Readonly<{ mint: string; symbol: string | null; name: string | null; isVerified: boolean | null; isSuspicious: boolean; ownTicker: boolean }>;

const plainTicker = (symbol: string) => symbol.replace(/^\$+/u, '').trim();

/**
 * The book with the coins the market's top does not hold (release 20.11: «buy ANT for 1 SOL» — the Anthropic share fell
 * out of the city's top at night and the line said «ANT is not on the market»): the engine's own shelf of verified
 * stocks and private companies, by their real addresses. The market's coins come first and keep their tickers: a shelf
 * coin never takes a ticker the book already names, a coin the engine does not verify or marks as a copy never joins.
 * Pure: a book and the shelf's coins in, a book out.
 */
export function withShelf(book: Book, shelf: readonly ShelfCoin[]): Book {
  const mints = new Set(book.coins.map((coin) => coin.mint));
  const tickers = new Set(book.coins.map((coin) => coin.symbol.toUpperCase()));
  const added: Book['coins'][number][] = [];
  for (const coin of shelf) {
    const symbol = plainTicker(coin.symbol);
    if ((coin.kind !== 'stock' && coin.kind !== 'preipo') || !coin.verified || coin.copyOf || !symbol) continue;
    if (mints.has(coin.id) || tickers.has(symbol.toUpperCase())) continue;
    mints.add(coin.id);
    tickers.add(symbol.toUpperCase());
    added.push({ mint: coin.id, symbol, name: coin.name, icon: `/api/icon/${coin.id}`, tower: true });
  }
  return added.length ? { coins: [...book.coins, ...added] } : book;
}

/**
 * The one coin a token search names by this ticker exactly: verified, not called suspicious, wearing its own ticker
 * (not a known coin's on another address). Two such coins, or none — null: the line asks which coin.
 */
export function foundCoin(word: string, rows: readonly FoundCoin[]): Book['coins'][number] | null {
  const wanted = plainTicker(word).toUpperCase();
  if (!wanted) return null;
  const hits = rows.filter((row) => row.symbol && plainTicker(row.symbol).toUpperCase() === wanted && row.isVerified === true && !row.isSuspicious && row.ownTicker);
  const mints = new Set(hits.map((row) => row.mint));
  if (mints.size !== 1) return null;
  const row = hits[0]!;
  return { mint: row.mint, symbol: plainTicker(row.symbol!), name: row.name ?? row.symbol!, icon: `/api/icon/${row.mint}`, tower: true };
}
