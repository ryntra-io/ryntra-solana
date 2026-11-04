import { bare, cleanNumber, COMMAND_MAX, findCoin, isBase, known, LINE_WORDS, tokens, type Book, type Coin, type Context, type Side, type Token } from '../command/parse.ts';
import type { Cadence, Instruction, Trigger } from './types.ts';

/**
 * The agent's reader (CITY-176): one sentence — «купуй SOL на $20 щотижня», «buy JUP if it drops to 0.7», «продай
 * половину BONK, якщо впаде на 10 %», «стоп на JUP по 0,8» — read into an instruction for the card. English and
 * Ukrainian, with the Russian a Ukrainian phone often types. Pure: no store, no wallet, no network.
 *
 * It reads only what it is sure of, the command line's way (`city/lib/command/parse.ts`): a word is never guessed into
 * money, a ticker the city has no tower for is never replaced by another coin, a question or a refusal is never an
 * instruction. What is missing or said two ways is left null for the card to ask with taps. A sentence that is not a
 * standing instruction — a plain «buy SOL for 50», a question — is not this reader's: it answers null and the command
 * line reads it as before.
 */

const { VERBS, QUESTION, IF, NOT, AGENT, CURRENCY, SHARE, DOLLARS, SOLS, NUMBER, NUMBER_UNIT, AT } = LINE_WORDS;

/* ------------------------------------------------------------------------------------------------ The words */

/** «Every week» in one word. */
const CADENCE_WORD: readonly [RegExp, Cadence][] = [
  [/^(daily|everyday|щодня|щоденно|щодень|ежедневно|каждодневно)$/u, 'daily'],
  [/^(weekly|щотижня|щотижнево|еженедельно)$/u, 'weekly'],
  [/^(monthly|щомісяця|щомісячно|ежемесячно)$/u, 'monthly'],
];

/** «Every week» in two: a lead word, then the unit. */
const CADENCE_LEAD = /^(every|each|per|a|an|once|кожен|кожного|кожний|кожну|кожної|раз|каждый|каждую|каждого|каждой)$/u;
const CADENCE_UNIT: readonly [RegExp, Cadence][] = [
  [/^(day|days|день|дня|дні|днів|сутки)$/u, 'daily'],
  [/^(week|weeks|тиждень|тижня|тижні|неделю|недели|неделя)$/u, 'weekly'],
  [/^(month|months|місяць|місяця|месяц|месяца)$/u, 'monthly'],
];

/** A day of the week; «щопонеділка» and «по понеділках» are weekly on it. */
const WEEKDAYS: readonly [RegExp, number][] = [
  [/^(monday|mondays|понеділ\p{L}*|понедельник\p{L}*)$/u, 1],
  [/^(tuesday|tuesdays|вівтор\p{L}*|вторник\p{L}*)$/u, 2],
  [/^(wednesday|wednesdays|серед[аиуі]|середам|середах|сред[аыу]|средам)$/u, 3],
  [/^(thursday|thursdays|четвер\p{L}*|четверг\p{L}*)$/u, 4],
  [/^(friday|fridays|п[ʼ'’]?ятниц\p{L}*|пятниц\p{L}*)$/u, 5],
  [/^(saturday|saturdays|субот\p{L}*|суббот\p{L}*)$/u, 6],
  [/^(sunday|sundays|неділ\p{L}*|воскресень\p{L}*)$/u, 7],
];
const EVERY_WEEKDAY = /^що(понеділ|вівтор|серед|четвер|п[ʼ'’]?ятниц|субот|неділ)\p{L}*$/u;

/** «Regularly», said without how often: a regular purchase whose cadence the card asks for. */
const REGULAR = /^(regularly|recurring|regular|dca|регулярно|регулярні|регулярна|регулярну|регулярний|постійно|регулярно)$/u;

/** Buying words the command line does not need, but a regular purchase is often said with. */
const BUYISH = /^(invest|investing|stack|інвест\p{L}*|вкладай|вкладати|відкладай|откладывай|инвест\p{L}*)$/u;

/** The price going down, up, or just reaching a level. */
const DOWN = /^(drops?|dropped|dropping|dips?|dipped|falls?|fell|falling|down|below|under|lower|crash\p{L}*|впаде|впав|впала|падає|падатиме|опуститься|знизиться|нижче|просяде|просіла|просяде|упадет|упадёт|упал|падает|опустится|ниже|просядет|подешевшає|подешевеет)$/u;
const UP = /^(rises?|rose|rising|up|above|over|higher|pumps?|moons?|виросте|зросте|підніметься|вище|злетить|подорожчає|вырастет|поднимется|выше|взлетит|подорожает)$/u;
const REACH = /^(hits?|reach\p{L}*|touch\p{L}*|gets|дійде|досягне|торкнеться|стане|коштуватиме|дойдет|дойдёт|достигнет|станет)$/u;

/** Words before a trigger's price: «to», «до», «at», «по», «below». */
const TO = /^(to|до|below|under|above|over|нижче|вище|ниже|выше)$/u;
/** «By» before a move: «falls by 10%», «впаде на 10 %». */
const BY = /^(by|на)$/u;
/** Two prices said: «до 0,7 або 0,6». */
const OR = /^(or|або|чи|или)$/u;
/** A condition that means the opposite: «unless it drops» is not an order on a drop. */
const UNLESS = /^(unless|хіба|хиба|якщо не|разве)$/u;

/** «Take profit» and «тейк-профіт»: a sale above the price now. */
const TAKE = /^(take|тейк|тейк-профіт|тейк-профит|тейкпрофіт|tp)$/u;
const PROFIT = /^(profit|профіт|профит)$/u;

/** The words of a standing instruction that are not coins, numbers or the line's own words. */
const OWN = /^(it|its|it's|goes|go|gets|price|ціна|ціни|цена|loss|лос|my|all|me|the|then|time|times|раз|тоді|тогда|of|worth|for|кожен|кожного|кожний|агенте|agent|please|будь|ласка|ціною|автоматично|automatically|auto|сам|сама|само)$/u;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/u;

const isWord = (re: RegExp, token: Token | undefined) => token !== undefined && re.test(token.text);

function ownWord(text: string): boolean {
  return (
    CADENCE_WORD.some(([re]) => re.test(text)) ||
    CADENCE_LEAD.test(text) ||
    CADENCE_UNIT.some(([re]) => re.test(text)) ||
    WEEKDAYS.some(([re]) => re.test(text)) ||
    EVERY_WEEKDAY.test(text) ||
    REGULAR.test(text) ||
    BUYISH.test(text) ||
    DOWN.test(text) ||
    UP.test(text) ||
    REACH.test(text) ||
    TO.test(text) ||
    BY.test(text) ||
    OR.test(text) ||
    TAKE.test(text) ||
    PROFIT.test(text) ||
    OWN.test(text) ||
    TIME.test(text) ||
    IF.test(text) ||
    AGENT.test(text)
  );
}

/** A coin named: the line's own lookup, never a word of the instruction's that is not written as a ticker. */
function coinAt(token: Token, book: Book): Coin | null {
  const written = token.raw.startsWith('$') || (token.raw.length >= 2 && token.raw === token.raw.toUpperCase() && /\p{Lu}/u.test(token.raw));
  if (!written && ownWord(token.text)) return null;
  return findCoin(token, book);
}

/** A ticker typed as one that no tower of the city carries: never replaced by another coin. */
function strangeTicker(token: Token, book: Book): boolean {
  if (coinAt(token, book)) return false;
  const word = token.raw.replace(/^\$+/u, '');
  if (!/^[\p{L}\d]{2,12}$/u.test(word) || /^\d/u.test(word)) return false;
  return token.raw.startsWith('$') || (word === word.toUpperCase() && /\p{Lu}/u.test(word) && !ownWord(token.text) && !known(token, book));
}

/* ------------------------------------------------------------------------------------------------ The numbers */

type Fig = { at: number; value: string | null; unit: 'USDC' | 'SOL' | 'coin' | null; coin: string | null; pct: number | null; minus: boolean; used: number[] };

/** «10 %», «10 відсотків», «−10%» → «10%»; the minus kept as its own mark. */
function normalise(text: string): string {
  return text
    .replace(/[−–—]/gu, '-')
    .replace(/(\d)\s*(?:%|відсот\p{L}*|процент\p{L}*|percent|pct)/giu, '$1%')
    .replace(/(^|\s)-\s*(\d)/gu, '$1-$2');
}

function figures(list: readonly Token[], book: Book): Fig[] {
  const out: Fig[] = [];
  list.forEach((token, at) => {
    if (out.some((f) => f.used.includes(at))) return;
    const minus = token.text.startsWith('-');
    const text = minus ? token.text.slice(1) : token.text;
    const joined = NUMBER_UNIT.exec(text);
    if (joined) {
      out.push({ at, value: minus ? null : cleanNumber(joined[1]!), unit: joined[2] === 'sol' ? 'SOL' : 'USDC', coin: null, pct: null, minus, used: [at] });
      return;
    }
    const plain = NUMBER.exec(text);
    if (!plain) return;
    if (plain[2] === '%') {
      const pct = Number(plain[1]!.replace(',', '.'));
      out.push({ at, value: null, unit: null, coin: null, pct: pct > 0 && pct <= 100 ? pct : null, minus, used: [at] });
      return;
    }
    const used = [at];
    const next = list[at + 1];
    const grouped = next !== undefined && /^\d{3}([.,]\d+)?$/u.test(next.text);
    if (grouped) used.push(at + 1);
    let unit: Fig['unit'] = text.startsWith('$') || plain[2] === '$' || list[at - 1]?.text === '$' ? 'USDC' : null;
    let coin: string | null = null;
    let foreign = CURRENCY.test(list[at - 1]?.text ?? '');
    if (next && !grouped) {
      if (CURRENCY.test(next.text)) foreign = true;
      else if (!unit && DOLLARS.test(next.text)) {
        unit = 'USDC';
        used.push(at + 1);
      } else if (!unit && SOLS.test(next.text)) {
        unit = 'SOL';
        used.push(at + 1);
      } else if (!unit) {
        const named = coinAt(next, book);
        if (named) {
          unit = isBase(named) ?? 'coin';
          coin = isBase(named) ? null : named.mint;
        }
        // A word beside the number that neither the line nor the instruction knows: a unit it does not take.
        else if (!known(next, book) && !ownWord(next.text)) foreign = true;
      }
    }
    out.push({ at, value: grouped || foreign || minus ? null : cleanNumber(plain[1]!), unit, coin, pct: null, minus, used });
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------ Reading */

function cadenceIn(list: readonly Token[]): { cadences: Cadence[]; weekday: number | null } {
  const found: Cadence[] = [];
  let weekday: number | null = null;
  const add = (c: Cadence) => {
    if (!found.includes(c)) found.push(c);
  };
  list.forEach((token, at) => {
    for (const [re, c] of CADENCE_WORD) if (re.test(token.text)) add(c);
    for (const [re, c] of CADENCE_UNIT) {
      if (!re.test(token.text)) continue;
      // «every week», «once a week», «раз на тиждень», «кожного тижня» — never «for a week».
      const lead = [list[at - 1], list[at - 2]].find((t) => t && CADENCE_LEAD.test(t.text));
      if (lead && !(list[at - 1]?.text === 'a' && list[at - 2]?.text === 'for')) add(c);
    }
    const every = EVERY_WEEKDAY.exec(token.text);
    const day = WEEKDAYS.find(([re]) => re.test(every ? token.text.slice(2) : token.text))?.[1] ?? null;
    if (day !== null && (every || /s$/u.test(token.text) || /х$/u.test(token.text) || CADENCE_LEAD.test(list[at - 1]?.text ?? '') || /^(on|в|у|по|во)$/u.test(list[at - 1]?.text ?? ''))) {
      // A weekday said beside «every week» names its day; alone, «every Monday» is weekly on it.
      weekday = weekday === null || weekday === day ? day : -1;
      if (every || /s$/u.test(token.text) || /х$/u.test(token.text) || CADENCE_LEAD.test(list[at - 1]?.text ?? '') || list[at - 1]?.text === 'по') add('weekly');
    }
  });
  return { cadences: found, weekday: weekday === -1 ? null : weekday };
}

/**
 * The sentence as a standing instruction, or null when it is not one. `context.subject` — the coin on screen — stands
 * in only when no coin was named and every word was understood.
 */
export function readInstruction(input: string, book: Book, context: Context = { subject: null }): Instruction | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said) return null;
  const list = tokens(normalise(said));
  if (!list.length) return null;
  // A question, a refusal or a condition that means the opposite is Ryntra's to answer.
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(said)) return null;
  if (list.some((t) => NOT.test(t.text) || UNLESS.test(t.text))) return null;
  // «Launch a bot that buys…» is the agent with a budget (CITY-175), not an order set here.
  if (list.some((t) => VERBS.launch.test(t.text) || VERBS.create.test(t.text)) && list.some((t) => AGENT.test(t.text))) return null;
  // «Торгуй на 1 SOL щодня» is the agent trading by itself within a budget (CITY-175), not a regular purchase.
  if (list.some((t) => VERBS.trade.test(t.text))) return null;
  if (list.some((t) => strangeTicker(t, book))) return null;

  const first = (re: RegExp) => list.findIndex((t) => re.test(t.text));
  const buyAt = list.findIndex((t) => VERBS.buy.test(t.text) || BUYISH.test(t.text));
  const sellAt = first(VERBS.sell);
  const stopAt = first(VERBS.stop);
  const limitAt = first(VERBS.limit);
  const takeAt = list.findIndex((t, n) => TAKE.test(t.text) && (t.text !== 'take' || isWord(PROFIT, list[n + 1])));
  // «once a month» is how often, not «once it drops».
  const ifAt = list.findIndex((t, n) => IF.test(t.text) && !(t.text === 'once' && /^(a|an|per|every)$/u.test(list[n + 1]?.text ?? '')));
  const downAt = first(DOWN);
  const upAt = first(UP);
  const reachAt = first(REACH);
  const { cadences, weekday } = cadenceIn(list);
  const regular = list.some((t) => REGULAR.test(t.text));
  const moveAt = [ifAt, downAt, upAt, reachAt].filter((n) => n >= 0);
  const condAt = moveAt.length ? Math.min(...moveAt) : -1;
  // The direction said; both, or a direction and a «when it hits» — the price now decides, never a guess.
  const dir: 'down' | 'up' | null = downAt >= 0 && upAt < 0 ? 'down' : upAt >= 0 && downAt < 0 ? 'up' : null;

  const figs = figures(list, book);
  const used = new Set(figs.flatMap((f) => f.used));
  const named = list.flatMap((t, at) => {
    if (used.has(at)) return [];
    const coin = coinAt(t, book);
    return coin ? [{ coin, at }] : [];
  });
  const coins = named.filter((c, n) => named.findIndex((o) => o.coin.mint === c.coin.mint) === n);
  // The coin is the one that is not what pays: «buy JUP with USDC» is JUP; SOL alone is SOL.
  const named1 = coins.find((c) => !isBase(c.coin))?.coin ?? coins.find((c) => isBase(c.coin) === 'SOL')?.coin ?? null;
  if (coins.filter((c) => !isBase(c.coin)).length > 1) return null;
  const strange = list.some((t, at) => !used.has(at) && !known(t, book) && !ownWord(t.text));
  // «buy 1 SOL every week»: the unit is the coin itself, when nothing else was named.
  const unitCoin = figs.some((f) => f.unit === 'SOL') ? (book.coins.find((c) => isBase(c) === 'SOL') ?? null) : null;
  const coin = named1 ?? (strange ? null : unitCoin) ?? (strange ? null : context.subject && !isBase(context.subject) ? context.subject : context.subject?.symbol === 'SOL' ? context.subject : null);

  /* -------------------------------------------------- A regular purchase */
  const timed = cadences.length > 0 || regular || weekday !== null;
  if (timed && condAt < 0 && stopAt < 0 && limitAt < 0 && takeAt < 0) {
    // A regular sale is not something the engine keeps: Ryntra's to answer.
    if (sellAt >= 0 && (buyAt < 0 || sellAt < buyAt)) return null;
    if (coin && isBase(coin) === 'USDC') return null;
    const dollars = figs.filter((f) => f.value !== null && (f.unit === 'USDC' || f.unit === null));
    const other = figs.some((f) => f.value !== null && (f.unit === 'SOL' || f.unit === 'coin')) || figs.some((f) => f.value === null && f.pct === null);
    const usd = dollars.length === 1 && !other ? dollars[0]!.value : null;
    const time = list.map((t) => TIME.exec(t.text)).find(Boolean);
    const cadence = cadences.length === 1 ? cadences[0]! : null;
    return {
      kind: 'recurring',
      said,
      coin,
      usd,
      cadence,
      weekday: cadence === null || cadence === 'weekly' ? weekday : null,
      time: time ? `${time[1]!.padStart(2, '0')}:${time[2]}` : null,
      options: cadences.length > 1 ? { cadences } : {},
    };
  }

  /* -------------------------------------------------- An order that waits for a price */
  if (timed) return null;
  const anchor = condAt >= 0 ? condAt : [stopAt, limitAt, takeAt].filter((n) => n >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (anchor < 0) return null;
  const sideOf = (): Side | null => {
    if (takeAt >= 0) return 'sell';
    if (buyAt >= 0 && (sellAt < 0 || buyAt < sellAt)) return 'buy';
    if (sellAt >= 0) return 'sell';
    if (stopAt >= 0) return 'sell';
    if (limitAt >= 0) return 'buy';
    return null;
  };
  const side = sideOf();
  // «If JUP drops to 0.7» without what to do: Ryntra's to answer.
  if (!side) return null;
  if (coin && isBase(coin) === 'USDC') return null;

  // The trigger: a number after the condition (or after «stop»/«limit»), said after «to», «at», «by», or as a move.
  // Without a condition, a price said after «at» counts wherever it stands: «sell JUP at 1.5 limit».
  const after = condAt >= 0 ? figs.filter((f) => f.at > condAt) : figs;
  const introduced = (f: Fig) => {
    const before = list[f.at - 1];
    const before2 = list[f.at - 2];
    return isWord(TO, before) || isWord(AT, before) || isWord(OR, before) || isWord(DOWN, before) || isWord(UP, before) || isWord(REACH, before) || (isWord(BY, before) && (isWord(DOWN, before2) || isWord(UP, before2)));
  };
  const filler = (token: Token | undefined) => token !== undefined && LINE_WORDS.FILLER.has(token.text);
  const moves = after.filter((f) => f.pct !== null && (f.minus || introduced(f) || condAt >= 0));
  const prices = after.filter((f) => f.value !== null && f.unit !== 'SOL' && f.unit !== 'coin' && (introduced(f) || (condAt < 0 && f.at > anchor && !isWord(BY, list[f.at - 1]) && !filler(list[f.at - 1]))));
  const distinct = [...new Set(prices.map((f) => f.value!))];

  let mode: 'limit' | 'stop' | null = stopAt >= 0 ? 'stop' : limitAt >= 0 || takeAt >= 0 ? 'limit' : dir === null ? null : (side === 'buy') === (dir === 'down') ? 'limit' : 'stop';
  // «−10%» with no word of direction is a fall.
  if (mode === null && dir === null && moves.length === 1 && moves[0]!.minus) mode = side === 'buy' ? 'limit' : 'stop';
  let trigger: Trigger | null = null;
  let options: { prices?: string[] } = {};
  if (moves.length === 1 && distinct.length === 0) {
    // A move whose direction the sentence does not settle is asked for; a minus never names a rise.
    const towards = mode === null ? null : (side === 'buy') === (mode === 'limit') ? 'down' : 'up';
    if (towards !== null && !(moves[0]!.minus && towards === 'up')) trigger = { kind: 'move', pct: moves[0]!.pct! };
  } else if (moves.length === 0 && distinct.length === 1) trigger = { kind: 'price', price: distinct[0]! };
  else if (moves.length === 0 && distinct.length > 1) options = { prices: distinct.slice(0, 3) };

  // How much: what is left — dollars on a buy; a share or a count of the coin on a sale.
  const triggerFigs = new Set<Fig>([...moves, ...prices]);
  const rest = figs.filter((f) => !triggerFigs.has(f));
  let usd: string | null = null;
  let share: number | null = null;
  let count: string | null = null;
  if (side === 'buy') {
    const dollars = rest.filter((f) => f.value !== null && (f.unit === 'USDC' || f.unit === null));
    if (dollars.length === 1 && !rest.some((f) => f.value === null || f.unit === 'SOL' || f.unit === 'coin')) usd = dollars[0]!.value;
  } else {
    const pcts = rest.filter((f) => f.pct !== null);
    const words = list.flatMap((t) => SHARE.filter(([re]) => re.test(t.text)).map(([, n]) => n));
    const shares = [...pcts.map((f) => f.pct!), ...words];
    const counts = rest.filter((f) => f.value !== null && (f.unit === null || (f.unit === 'coin' && f.coin === coin?.mint) || (f.unit === 'SOL' && coin && isBase(coin) === 'SOL')));
    const bad = rest.some((f) => (f.value === null && f.pct === null) || f.unit === 'USDC' || (f.unit === 'coin' && f.coin !== coin?.mint));
    if (!bad && shares.length === 1 && counts.length === 0) share = shares[0]!;
    else if (!bad && shares.length === 0 && counts.length === 1) count = counts[0]!.value;
  }

  return { kind: 'order', said, mode, side, coin, trigger, usd, share, count, options };
}

/** The coins the card offers when none was said: the coin on screen first, then the city's best, then SOL. */
export function coinChoices(book: Book, context: Context, max = 4): readonly Coin[] {
  const list: Coin[] = [];
  const add = (coin: Coin | null | undefined) => {
    if (coin && !list.some((c) => c.mint === coin.mint) && isBase(coin) !== 'USDC') list.push(coin);
  };
  add(context.subject);
  add(book.coins.find((c) => bare(c.symbol) === 'SOL'));
  for (const coin of book.coins) if (list.length < max) add(coin);
  return list.slice(0, max);
}
