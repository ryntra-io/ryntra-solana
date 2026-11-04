import { COMMAND_MAX, findCoin, isBase, LINE_WORDS, parse, tokens, type Book, type Coin, type Token } from '../command/parse.ts';
import { boundedPlan, type PlanId, type StrategyPlan } from '../../../lib/mandate/plans.ts';

/**
 * The agent on its word (CITY-175): one sentence — «торгуй на 1 SOL на день», «trade 1 SOL a day», «запусти бота на
 * 0,5 SOL», «запусти мені токен», «launch me a coin called Neon Fox» — read into what the agent is asked to do. English
 * and Ukrainian, with the Russian a Ukrainian phone often types. Pure: no store, no wallet, no network.
 *
 * Two asks, and nothing else:
 * - `trade` — the agent trades by itself within a budget a day; the amount is SOL, read only when it is said so;
 * - `launch` — the agent prepares a launch: a name, a ticker and a picture, with the rules the launch sheet shows.
 *
 * It reads the command line's way (`../command/parse.ts`): the same tokens and numbers, a word is never guessed into
 * money, and a question or a refusal is never an ask. A sentence that is not one of the two answers null and the line
 * reads it as before — a standing instruction («buy $20 of SOL every week») is CITY-176's reader's, not this one's.
 *
 * CITY-193 — the strategy, from the same sentence:
 * «купуй BONK на просіданнях», «buy the dip −10 %», «торгуй сіткою», «grid BONK 5 %», «фіксуй +20 %», «stop loss 10 %»,
 * «купуй нові запуски». Words become a plan (`lib/mandate/plans.ts`), its numbers drawn into the strategies' bounds; the
 * plan only decides when a buy the mandate allows is made — the budget stays what was said.
 */

export type AgentAsk =
  | Readonly<{
      kind: 'trade';
      said: string;
      /** The day's budget in SOL, as said («1», «0.5»); null when no amount in SOL was said. */
      perDaySol: string | null;
      /** The coin the agent is to buy, when the sentence names a tower («торгуй BONK на 0,1 SOL на день»); never SOL or USDC. */
      coin?: Coin | null;
      /** CITY-193: the strategy said, with its numbers; absent — the steady one. */
      plan?: StrategyPlan;
    }>
  | Readonly<{
      kind: 'launch';
      said: string;
      name: string | null;
      symbol: string | null;
    }>;

const { VERBS, QUESTION, NOT, AGENT, SOLS, NUMBER, NUMBER_UNIT, DOLLARS, CURRENCY } = LINE_WORDS;

/** «Trade» as a person tells an agent to: the verb, never «trades» or «торгівля» as a noun about the market. */
const TRADE = /^(trade|trading|торгуй|торгуйте|поторгуй|торгувати|поторгувати|торгуй-но|торгуєш|торгуй-ка|торгуй-ка|торгуй|торговать|поторгуй|поторгуйте)$/u;
/** Words of «go», «let», «start» that put an agent to work: «let my agent trade», «запусти агента». */
const PUT = /^(let|start|run|launch|set|put|увімкни|запусти|запустити|запустіть|запускай|постав|включи|включить|запусть|запустить|пусти|нехай|хай|пусть)$/u;
/** A day as a person says it with a budget. */
const DAY_WORD = /^(daily|everyday|щодня|щоденно|ежедневно)$/u;
const DAY_UNIT = /^(day|days|день|дня|добу|сутки|сутку)$/u;
const DAY_LEAD = /^(a|per|each|every|на|в|у|за|кожен|кожного|кожний|в день|каждый)$/u;
/** Any other span the budget could be said over: not a day's budget, so the card asks. */
const OTHER_SPAN = /^(week|weeks|month|months|hour|hours|тиждень|тижня|місяць|місяця|годину|година|годин|неделю|месяц|час|weekly|monthly|hourly|щотижня|щомісяця|щогодини)$/u;
/** The coin words of a launch: «токен», «монету», «мем». */
const COIN_WORD = /^(token|coin|meme|memecoin|токен\p{L}*|монет\p{L}*|мем\p{L}*|мемкоїн\p{L}*)$/u;
/** Words that ask the agent for itself: «for me», «за мене», «сам». */
const FOR_ME = /^(me|myself|мене|мені|мне|меня|сам|сама|само|самостійно|автоматично|automatically|auto|autopilot|автопілот\p{L}*)$/u;

const has = (list: readonly Token[], re: RegExp) => list.some((t) => re.test(t.text));

/* -------------------------------------------------- CITY-193: the strategy's words */

/** «Buy» as a person tells an agent: «купуй на просіданнях», «buy the dip». */
const BUY = LINE_WORDS.VERBS.buy;
/** A dip: «на просіданнях», «на падінні», «buy the dip», «buy low». */
const DIP = /^(dip|dips|dipping|просідан\p{L}*|просідає|просяде|просад\p{L}*|падінн\p{L}*|падіння|падени\p{L}*|откат\p{L}*|відкат\p{L}*|low|дешевше)$/u;
/** A grid: «торгуй сіткою», «grid». */
const GRID = /^(grid|grids|сітк\p{L}*|сітці|сетк\p{L}*|сетке)$/u;
/** Taking a profit: «фіксуй +20 %», «take profit 20 %», «забирай +30 %». */
const TAKE = /^(фіксуй|зафіксуй|фіксувати|фіксуй-но|фиксируй|зафиксируй|take|забирай|забери|profit|прибуток|профіт|tp)$/u;
/** A stop: «стоп −10 %», «stop loss 10 %», «стоп-лос 8 %» — only ever with a figure: «стоп» alone is no strategy. */
const STOP = /^(стоп|stop|stop-loss|stoploss|стоп-лос\p{L}*|стоплос\p{L}*|loss|лос|sl)$/u;
/** New launches, early: «купуй нові запуски», «buy new launches early», «заходь у запуски рано». */
const EARLY = /^(early|рано|ранн\p{L}*|снайп\p{L}*|snipe|sniping)$/u;
const LAUNCHES = /^(launches|launch|запуск\p{L}*|лаунч\p{L}*|new|нові|новий|нових|новинки)$/u;
/** Spacing: «кроком 5 %», «step 4 %», «every 5 %». */
const STEP = /^(step|крок\p{L}*|шаг\p{L}*|apart|levels|рівн\p{L}*|рівні)$/u;

/** The figures said in per cent, each with where it stands: «+20 %», «-10%», «20%», «на 8 %». */
function percents(list: readonly Token[]): Array<{ at: number; value: number }> {
  const out: Array<{ at: number; value: number }> = [];
  list.forEach((token, at) => {
    const joined = /^[+−-]?(\d+(?:[.,]\d+)?)%$/u.exec(token.text);
    const bare = /^[+−-]?(\d+(?:[.,]\d+)?)$/u.exec(token.text);
    const value = joined ? joined[1] : bare && list[at + 1]?.text === '%' ? bare[1] : null;
    if (value) out.push({ at, value: Number(value.replace(',', '.')) });
  });
  return out.filter((p) => Number.isFinite(p.value) && p.value > 0 && p.value <= 1000);
}

/** The figure nearest after a word — «фіксуй +20 %», «stop loss 10 %» — within three words, none of `taken`; null when none. */
function figureAfter(list: readonly Token[], word: RegExp, figures: ReadonlyArray<{ at: number; value: number }>, taken: ReadonlySet<number> = new Set()): { at: number; value: number } | null {
  for (let at = 0; at < list.length; at += 1) {
    if (!word.test(list[at]!.text)) continue;
    const next = figures.find((p) => p.at > at && p.at - at <= 3 && !taken.has(p.at));
    if (next) return next;
  }
  return null;
}

/** The strategy the sentence says, or null when it says none (the steady one, as before). */
export function planSaid(list: readonly Token[]): StrategyPlan | null {
  const figures = percents(list);
  const take = figureAfter(list, TAKE, figures);
  const stop = figureAfter(list, STOP, figures, new Set(take ? [take.at] : []));
  const id: PlanId | null = has(list, GRID) ? 'grid' : has(list, DIP) ? 'dip' : has(list, EARLY) || (has(list, LAUNCHES) && list.some((t) => /^(new|нові|новий|нових|новинки)$/u.test(t.text))) ? 'early' : take !== null || stop !== null ? 'steady' : null;
  if (!id) return null;
  /* The strategy's own figure — the dip's depth, the grid's step — is never one said for an exit. */
  const taken = new Set([take?.at, stop?.at].filter((v): v is number => v !== undefined));
  const free = figures.filter((p) => !taken.has(p.at));
  const own = id === 'grid' ? (figureAfter(list, STEP, free) ?? figureAfter(list, GRID, free)) : id === 'dip' ? (figureAfter(list, DIP, free) ?? free[0] ?? null) : null;
  const levels = id === 'grid' ? (list.map((t, at) => (/^\d{1,2}$/u.test(t.text) && /^(levels|рівн\p{L}*|рівні|уровн\p{L}*)$/u.test(list[at + 1]?.text ?? '') ? Number(t.text) : null)).find((v) => v !== null) ?? null) : null;
  const bps = (figure: { value: number } | null) => (figure === null ? null : Math.round(figure.value * 100));
  return boundedPlan({ id, dropBps: id === 'dip' ? bps(own) : null, stepBps: id === 'grid' ? bps(own) : null, levels, takeBps: bps(take), stopBps: bps(stop) });
}

/** The amounts said in SOL: «1 SOL», «0,5 сол», «1sol»; dollars or another money are not a SOL budget. */
function solAmounts(list: readonly Token[]): Readonly<{ sol: string[]; other: boolean }> {
  const sol: string[] = [];
  let other = false;
  list.forEach((token, at) => {
    const joined = NUMBER_UNIT.exec(token.text);
    if (joined) {
      if (joined[2] === 'sol') sol.push(clean(joined[1]!));
      else other = true;
      return;
    }
    const plain = NUMBER.exec(token.text);
    if (!plain) return;
    if (plain[2] === '%' || list[at + 1]?.text === '%') return;
    if (token.text.startsWith('$') || plain[2] === '$') {
      other = true;
      return;
    }
    const next = list[at + 1]?.text ?? '';
    const before = list[at - 1]?.text ?? '';
    if (SOLS.test(next) || SOLS.test(before) || before === '◎') sol.push(clean(plain[1]!));
    else if (DOLLARS.test(next) || CURRENCY.test(next) || CURRENCY.test(before) || before === '$') other = true;
    else other = true;
  });
  return { sol, other };
}

/** «0,5» → «0.5»; a number with more than one way to read it was already left out by the line's tokens. */
function clean(text: string): string {
  const value = text.replace(',', '.');
  return /^\d+(\.\d+)?$/u.test(value) && Number(value) > 0 ? value.replace(/^0+(?=\d)/u, '') : '';
}

/** Whether a budget was said over a day, or over nothing at all; another span — a week, a month — is not a day's. */
function dayly(list: readonly Token[]): 'day' | 'none' | 'other' {
  if (has(list, OTHER_SPAN)) return 'other';
  if (has(list, DAY_WORD)) return 'day';
  if (list.some((t, at) => DAY_UNIT.test(t.text) && (DAY_LEAD.test(list[at - 1]?.text ?? '') || /^\/?(day|д)$/u.test(t.text)))) return 'day';
  if (list.some((t) => /^\/(day|день|д)$/u.test(t.text))) return 'day';
  return 'none';
}

/** The one tower a sentence names, by its ticker; null when it names none, or two. SOL and USDC are what it pays with. */
function towerNamed(list: readonly Token[], book: Book): Coin | null {
  const named = new Map<string, Coin>();
  for (const token of list) {
    const coin = findCoin(token, book);
    if (coin?.tower && !isBase(coin)) named.set(coin.mint, coin);
  }
  return named.size === 1 ? [...named.values()][0]! : null;
}

/** The sentence as an ask of the agent, or null when it is not one. */
export function readAsk(input: string, book: Book): AgentAsk | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said) return null;
  const list = tokens(said);
  if (!list.length) return null;
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(said)) return null;
  if (has(list, NOT)) return null;

  const agent = has(list, AGENT);
  const trade = has(list, TRADE);
  const put = has(list, PUT) || has(list, VERBS.launch);
  /* CITY-193: a strategy said with a buy, a trade, the agent — or an exit on its own («фіксуй +20 %») — is the agent's. */
  const plan = planSaid(list);
  const strategyAsk = plan !== null && (trade || agent || has(list, BUY) || (plan.id === 'steady' && plan.exit !== null) || plan.id === 'grid');

  /* -------------------------------------------------- The agent to trade */
  // «торгуй на 1 SOL на день», «trade for me», «запусти бота на 0,5 SOL», «let my agent trade 1 SOL a day».
  if (trade || (agent && put) || strategyAsk) {
    // A plain trade of a coin («trade JUP») is the trade window's: the agent only when a budget, a day, «for me» or a strategy is said.
    const amounts = solAmounts(list);
    const span = dayly(list);
    if (!agent && !strategyAsk && amounts.sol.length === 0 && span === 'none' && !has(list, FOR_ME)) return null;
    const one = amounts.sol.length === 1 && !amounts.other && amounts.sol[0] !== '' && span !== 'other';
    // An early plan buys a launch the agent picks itself: a tower named is not it.
    const coin = plan?.id === 'early' ? null : towerNamed(list, book);
    return { kind: 'trade', said, perDaySol: one ? amounts.sol[0]! : null, coin, ...(plan ? { plan } : {}) };
  }

  /* -------------------------------------------------- The agent to launch a coin */
  // «запусти мені токен», «launch me a coin», «створи мемкоїн Neon Fox $NFOX» — never «launch a bot».
  if (agent) return null;
  if (has(list, VERBS.launch) || (has(list, VERBS.create) && has(list, COIN_WORD))) {
    // Without a coin word, a «for me» or a name, «launch» alone is the launch sheet's own row.
    const command = parse(said, book);
    if (command.kind !== 'launch') return null;
    if (!has(list, COIN_WORD) && !has(list, FOR_ME)) return null;
    // «для мене», «for me» name the person, not the coin.
    const name = command.name
      ?.split(/\s+/u)
      .filter((word) => !FOR_ME.test(word.toLowerCase()) && !/^(for|для|за)$/u.test(word.toLowerCase()))
      .join(' ');
    return { kind: 'launch', said, name: name || null, symbol: command.symbol };
  }
  return null;
}
