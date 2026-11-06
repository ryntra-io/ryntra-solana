import type { AgentAsk } from '../autopilot/read.ts';
import type { DollarAsk } from '../earn/dollar-read.ts';
import type { PilotAsk } from '../pilot/read.ts';
import type { HireAsk } from '../crew/read.ts';
import type { Instruction } from '../instruct/types.ts';
import { learnAsk } from '../learn/ask.ts';
import { SOL, USDC } from '../trade/tiles.ts';

/**
 * The city's command line (CITY-85; helm SPEC §1, §8–9): what a person says — «buy SOL for 50», «стоп на JUP», «my
 * portfolio» — read into the window to open and the fields to fill in it. Pure: no store, no wallet, no network.
 *
 * A command only ever names a window and what to write in its fields; the person reads them and confirms there, in the
 * window's own button and then the wallet. Nothing here prepares, signs or sends anything, and anything not understood
 * becomes a question for Ryntra, who only advises. A word is never guessed into money: an amount the window cannot
 * take as said (two coins for one field, a comma that could mean two things) is left out, not rounded into one.
 */

/** A coin the command line can name: a tower of the city, or SOL and USDC, which every window takes. */
export type Coin = Readonly<{ mint: string; symbol: string; name: string; icon: string | null; tower: boolean }>;

/** The two coins every trade window pays with and is paid in. */
export type Base = 'SOL' | 'USDC';

export type Side = 'buy' | 'sell';

/** The trade window's two faces (`city/lib/trade/store.ts` `View`): the plain swap, or spot with its chart. */
export type View = 'swap' | 'spot';

/** The Money window's tabs (`city/lib/money/flag.ts`), and «bridge» — Send's way to another network. */
export type MoneyPlace = 'portfolio' | 'activity' | 'topup' | 'send' | 'paylink' | 'bridge';

export type Command =
  /** The coin's trade window on buying: `amount` is what is paid, in `pay` (null — the window's own choice). */
  | Readonly<{ kind: 'buy'; coin: Coin; view: View; amount: string | null; pay: Base | null; share: number | null }>
  /** The coin's trade window on selling: `amount` is of the coin itself; `into` is what the sale is paid in. */
  | Readonly<{ kind: 'sell'; coin: Coin; view: View; amount: string | null; into: Base | null; share: number | null }>
  /** A limit or a stop on the coin's Spot window, with the person's own price when they said one. */
  | Readonly<{ kind: 'order'; mode: 'limit' | 'stop'; side: Side; coin: Coin; price: string | null }>
  | Readonly<{ kind: 'chart'; coin: Coin }>
  /** The coin's own window, as a tap on its tower opens it. */
  | Readonly<{ kind: 'coin'; coin: Coin }>
  /** A pasted address the city does not know: the engine names it first (`city/lib/coin/open.ts`). */
  | Readonly<{ kind: 'mint'; mint: string }>
  | Readonly<{ kind: 'money'; place: MoneyPlace; send: Readonly<{ to: string | null; amount: string | null; asset: Coin | null }> | null }>
  | Readonly<{ kind: 'earn' }>
  | Readonly<{ kind: 'launch'; symbol: string | null; name: string | null }>
  /** The agent's card (CITY-176): a regular purchase, a limit or a stop read from the sentence — the person signs there. */
  | Readonly<{ kind: 'instruct'; instruction: Instruction }>
  /** What the agent set from sentences, with their state and «Cancel» (CITY-176). */
  | Readonly<{ kind: 'instructions' }>
  /** The agent on its word (CITY-175): «trade 1 SOL a day» — a budget and one signature; «launch me a token» — a launch it prepared. */
  | Readonly<{ kind: 'autopilot'; ask: AgentAsk }>
  /** The Dollar Saver on its word (CITY-192): «put my USDC to work» — its card with the coin and the amount; the person signs there. */
  | Readonly<{ kind: 'dollar'; ask: DollarAsk }>
  /** The money autopilot on its word (CITY-204): «work with my 2 SOL and 100 USDC: some into savings, trade some, some into pools» — one plan; the person signs in its card. */
  | Readonly<{ kind: 'pilot'; ask: PilotAsk }>
  /** A job for an agent (CITY-205): «trade for me», «доглядай мій пул», «запусти бота» — that agent's card, or the crew in «Bots». */
  | Readonly<{ kind: 'hire'; ask: HireAsk }>
  /** «Learn» (CITY-202): the guide, on the chapter the sentence names (null — the list of chapters). */
  | Readonly<{ kind: 'learn'; chapter: string | null }>
  /** Everything else: a question for Ryntra, who reads the market and advises — and does nothing else. */
  | Readonly<{ kind: 'ask'; question: string }>;

export type Kind = Command['kind'];

/** The coins a command can name, best first (the caller sorts the towers by their market). */
export type Book = Readonly<{ coins: readonly Coin[] }>;

/** What the person is looking at: the coin of the window in front, or the tower picked — «buy 50» means that one. */
export type Context = Readonly<{ subject: Coin | null }>;

/** The longest command read: a sentence, not a document. */
export const COMMAND_MAX = 140;

const SOL_MINT = SOL.mint;
const USDC_MINT = USDC.mint;

/* ------------------------------------------------------------------------------------------------ The words */

type Token = Readonly<{ text: string; raw: string }>;

/** The words that carry the command, English and Ukrainian (with the Russian a Ukrainian phone often types). */
const VERBS = {
  buy: /^(buy|buying|purchase|ape|куп\p{L}*|придба\p{L}*)$/u,
  sell: /^(sell|selling|dump|прода\p{L}*)$/u,
  swap: /^(swap|exchange|convert|обмін\p{L}*|обміня\p{L}*|обмен\p{L}*|свап|конверт\p{L}*)$/u,
  stop: /^(stop|stop-loss|stoploss|sl|стоп|стоп-лос\p{L}*|стоплос\p{L}*)$/u,
  limit: /^(limit|лімітк\p{L}*|ліміт\p{L}*|лимит\p{L}*)$/u,
  chart: /^(chart|charts|graph|candles|графік\p{L}*|график\p{L}*|чарт\p{L}*|свічк\p{L}*)$/u,
  trade: /^(trade|торгуй|торгувати|торговать)$/u,
  portfolio: /^(portfolio|balance|balances|holdings|портфел\p{L}*|баланс\p{L}*|активи)$/u,
  activity: /^(history|activity|transactions|історі\p{L}*|активніст\p{L}*|транзакці\p{L}*|операці\p{L}*|истори\p{L}*)$/u,
  topup: /^(topup|top-up|deposit|fund|receive|поповн\p{L}*|пополн\p{L}*|депозит\p{L}*|отрима\p{L}*|получ\p{L}*)$/u,
  send: /^(send|transfer|надісл\p{L}*|надішл\p{L}*|відправ\p{L}*|переказ\p{L}*|пересл\p{L}*|перешл\p{L}*|отправ\p{L}*|перевед\p{L}*)$/u,
  paylink: /^(invoice|рахун\p{L}*|счет)$/u,
  bridge: /^(bridge|міст|мост)$/u,
  earn: /^(earn|earning|pool|pools|stake|staking|yield|farm|заробі\p{L}*|заробит\p{L}*|заробля\p{L}*|заработ\p{L}*|пул|пули|пулі|стейк\p{L}*)$/u,
  // The verb, never the noun: «нові запуски» (new launches) is a question about them, not a launch.
  launch: /^(launch|запусти|запустити|запустіть|запускай|запуск|запустим|запусть|запустить)$/u,
  create: /^(create|make|deploy|створ\p{L}*|зроби|зробити|созда\p{L}*)$/u,
} as const;

/** «Top up» and «pay link» in two words. */
const PAIRS: readonly [RegExp, RegExp, keyof typeof VERBS][] = [
  [/^top$/u, /^up$/u, 'topup'],
  [/^add$/u, /^(funds|money)$/u, 'topup'],
  [/^(pay|payment)$/u, /^link$/u, 'paylink'],
  [/^посиланн\p{L}*$/u, /^(на|для)$/u, 'paylink'],
];

/** A question, whatever it mentions: Ryntra answers it. «Should I buy JUP?» is advice asked, not a trade. */
const QUESTION =
  /^(what|whats|what's|why|how|which|who|when|where|is|are|should|can|could|will|would|do|does|explain|tell|ask|що|чому|як|який|яка|яке|які|хто|коли|де|чи|поясни|скажи|розкажи|порадь|навіщо|скільки|спитай|питання|что|почему|какой|стоит)$/u;

/** Words that join a sentence and name nothing. */
const FILLER = new Set([
  'a', 'an', 'the', 'for', 'of', 'worth', 'me', 'my', 'i', 'please', 'pls', 'token', 'tokens', 'coin', 'coins', 'on',
  'at', 'to', 'into', 'in', 'with', 'some', 'now', 'want', 'wanna', 'and', 'order', 'open', 'show', 'go', 'by', 'from',
  'на', 'за', 'мені', 'мій', 'моя', 'моє', 'мої', 'моїх', 'мой', 'мне', 'будь', 'ласка', 'токен', 'токена', 'токени',
  'монету', 'монети', 'монета', 'монеты', 'по', 'при', 'в', 'у', 'з', 'із', 'хочу', 'трохи', 'ордер', 'відкрий',
  'покажи', 'для', 'с', 'до', 'через', 'it', 'this', 'that', 'цю', 'цей', 'це', 'її', 'його', 'эту', 'этот',
]);

/** Words before a price: «stop JUP at 0.8», «стоп на JUP по 0.8». */
const AT = /^(at|@|price|по|при|ціна|ціною|цена)$/u;

/** Words before what a sale brings in: «sell SOL for 50», «продай SOL на 50» — never how much is sold. */
const FOR = /^(for|на|за)$/u;

/** A condition or a refusal is not an order to open: «buy JUP if it drops», «не купуй JUP» — Ryntra's to answer. */
const IF = /^(if|when|once|unless|якщо|коли|якби|если|когда)$/u;
const NOT = /^(не|ні|ніколи|never|don't|dont|do not|not|no|нет|никогда)$/u;

/** Agents and bots are not tokens to launch: «запусти бота», «launch an agent» are Ryntra's to answer. */
const AGENT = /^(bot|bots|agent|agents|бот\p{L}*|агент\p{L}*)$/u;

/** Money the line does not take: «на 50 гривень», «50 eur» — the amount is left out, never read as dollars. */
const CURRENCY = /^(грн|гривн\p{L}*|гривен\p{L}*|uah|eur|euro\p{L}*|євро|евро|rub|руб\p{L}*|gbp|фунт\p{L}*|₴|€|£|¥|usdt|tether)$/u;

/** Words between two coins in a swap: «SOL to JUP», «SOL на JUP». */
const TOWARD = /^(to|for|into|->|→|на|в|у|за)$/u;

/** A share of what can be spent. */
const SHARE: readonly [RegExp, number][] = [
  [/^(all|everything|max|все|усе|всі|весь|всю|максимум|всё)$/u, 100],
  [/^(half|половин\p{L}*|пів|половина)$/u, 50],
  [/^(quarter|чверть|четверть)$/u, 25],
];

/** The unit words an amount can carry. */
const DOLLARS = /^(\$|usd|usdc|dollar|dollars|bucks|дол|долар\p{L}*|доллар\p{L}*|бакс\p{L}*)$/u;
const SOLS = /^(sol|сол|солан\p{L}*|соль)$/u;

const NUMBER = /^\$?(\d+(?:[.,]\d+)?)(\$|%)?$/u;
const NUMBER_UNIT = /^(\d+(?:[.,]\d+)?)(sol|usdc|usd)$/u;

/** A Solana address as pasted (`city/lib/search/mint.ts`), and a `.skr` name Money resolves. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SKR = /^[a-z0-9][a-z0-9-]{0,62}\.skr$/i;

// A leading point stays: «.5» is not a number the line reads, so it can never turn into 5.
const PUNCT = /^[«»"'“”„`(),!;:]+|[«»"'“”„`(),!.;:?]+$/gu;

/** A sentence typed all in capitals. */
const shouted = (text: string) => /\p{L}/u.test(text) && text === text.toUpperCase();

function tokens(text: string): Token[] {
  // A sentence typed all in capitals is not a sentence of tickers: «BUY ME JUP» is «buy me jup». A `$` or an address
  // keeps its case.
  const shouting = shouted(text);
  return text
    .replace(/(\d)\s*\$/gu, '$1$')
    .replace(/\$\s+(\d)/gu, '$$$1')
    .split(/\s+/u)
    .map((raw) => raw.replace(PUNCT, ''))
    .filter(Boolean)
    .map((raw) => (shouting && !raw.startsWith('$') && !BASE58.test(raw) ? raw.toLowerCase() : raw))
    .map((raw) => ({ raw, text: raw.toLowerCase() }));
}

/**
 * An amount as the windows' fields take it: a point for decimals. A comma or a point that could be thousands («1,000»,
 * «1.000») is left out — the person writes it in the window.
 */
export function cleanNumber(text: string): string | null {
  if (/^\d{1,3},\d{3}$/u.test(text) || /^[1-9]\d{0,2}\.\d{3}$/u.test(text)) return null;
  const value = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/u.test(value) || Number(value) <= 0) return null;
  return value.replace(/^0+(?=\d)/u, '');
}

/** A number as written: its value, the unit beside it (the coin's mint when a coin's ticker follows), the tokens it took. */
type Num = { at: number; value: string | null; unit: Base | 'coin' | null; coin: string | null; share: number | null; used: number[] };

/** The numbers in the sentence, each with the unit written beside it and the tokens it took. */
function numbers(list: readonly Token[], book: Book): Num[] {
  const out: Num[] = [];
  list.forEach((token, at) => {
    // The second half of «1 000» is not a number of its own.
    if (out.some((n) => n.used.includes(at))) return;
    const joined = NUMBER_UNIT.exec(token.text);
    if (joined) {
      out.push({ at, value: cleanNumber(joined[1]!), unit: joined[2] === 'sol' ? 'SOL' : 'USDC', coin: null, share: null, used: [at] });
      return;
    }
    const plain = NUMBER.exec(token.text);
    if (!plain) return;
    const value = plain[1]!;
    if (plain[2] === '%') {
      const share = Number(value.replace(',', '.'));
      out.push({ at, value: null, unit: null, coin: null, share: share > 0 && share <= 100 ? share : null, used: [at] });
      return;
    }
    const dollar = token.text.startsWith('$') || plain[2] === '$' || list[at - 1]?.text === '$';
    const nextToken = list[at + 1];
    const next = nextToken?.text;
    const used = [at];
    let unit: Num['unit'] = dollar ? 'USDC' : null;
    let coin: string | null = null;
    // «1 000»: thousands written with a space — left out, never read as 1.
    const grouped = next !== undefined && /^\d{3}([.,]\d+)?$/u.test(next);
    // A unit the line does not take, beside the number: «50 гривень», «грн 50», «50 today» — left out.
    const foreign = CURRENCY.test(list[at - 1]?.text ?? '') || (nextToken !== undefined && !grouped && (CURRENCY.test(next!) || !known(nextToken, book)));
    if (grouped) used.push(at + 1);
    if (!unit && nextToken !== undefined && !grouped) {
      if (DOLLARS.test(next!)) unit = 'USDC';
      else if (SOLS.test(next!)) unit = 'SOL';
      else {
        const named = findCoin(nextToken, book);
        if (named) [unit, coin] = ['coin', named.mint];
      }
      if (unit === 'USDC' || unit === 'SOL') used.push(at + 1);
    }
    out.push({ at, value: grouped || foreign ? null : cleanNumber(value), unit, coin, share: null, used });
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------ The coins */

export const SOL_COIN: Coin = { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', icon: SOL.icon ?? null, tower: false };
export const USDC_COIN: Coin = { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', icon: null, tower: false };

const bare = (symbol: string) => symbol.trim().replace(/^\$+/u, '').toUpperCase();

/** A word of the sentence's own: joining, command, price or share words, and question words. */
function wordOfTheLine(text: string): boolean {
  return (
    FILLER.has(text) ||
    AT.test(text) ||
    FOR.test(text) ||
    IF.test(text) ||
    NOT.test(text) ||
    QUESTION.test(text) ||
    SHARE.some(([pattern]) => pattern.test(text)) ||
    Object.values(VERBS).some((pattern) => pattern.test(text))
  );
}

/**
 * A coin by its ticker («jup», «$JUP»), its one-word name or its address: the first in the book, so the best. A word of
 * the sentence itself names a coin only written as one — «$ME» or «ME», never the «me» of «buy me JUP».
 */
function findCoin(token: Token, book: Book): Coin | null {
  const word = token.raw.replace(/^\$+/u, '');
  if (!word) return null;
  const written = token.raw.startsWith('$') || (word.length >= 2 && word === word.toUpperCase() && /\p{Lu}/u.test(word));
  if (!written && wordOfTheLine(token.text)) return null;
  if (SOLS.test(token.text)) return book.coins.find((c) => c.mint === SOL_MINT) ?? SOL_COIN;
  if (BASE58.test(word)) return book.coins.find((c) => c.mint === word) ?? null;
  const symbol = word.toUpperCase();
  return book.coins.find((c) => bare(c.symbol) === symbol) ?? book.coins.find((c) => c.name.toLowerCase() === word.toLowerCase() && !/\s/u.test(c.name)) ?? null;
}

const isBase = (coin: Coin): Base | null => (coin.mint === SOL_MINT ? 'SOL' : coin.mint === USDC_MINT ? 'USDC' : null);

/**
 * The coins the agent offers to buy on mainnet when none was named: the city's best towers, never SOL or USDC, nor
 * SOL staked under another name (JitoSOL, bnSOL…) or a dollar coin — buying those is not what a person hires an agent for.
 */
export function agentCoins(book: Book, count = 4): readonly Coin[] {
  return book.coins.filter((c) => c.tower && !isBase(c) && !/^[A-Z0-9]*SOL$/u.test(c.symbol.toUpperCase()) && !/^(USD|PYUSD|EUR)/u.test(c.symbol.toUpperCase())).slice(0, count);
}

/* ------------------------------------------------------------------------------------------------ Reading */

type Verb = keyof typeof VERBS;

function verbsOf(list: readonly Token[]): Map<Verb, number> {
  const found = new Map<Verb, number>();
  list.forEach((token, at) => {
    for (const [verb, pattern] of Object.entries(VERBS) as [Verb, RegExp][]) if (!found.has(verb) && pattern.test(token.text)) found.set(verb, at);
  });
  PAIRS.forEach(([first, second, verb]) => {
    const at = list.findIndex((token, n) => first.test(token.text) && second.test(list[n + 1]?.text ?? ''));
    if (at >= 0 && !found.has(verb)) found.set(verb, at);
  });
  return found;
}

/** The coins the sentence names, in order, with where each stands. */
function coinsIn(list: readonly Token[], book: Book, skip: ReadonlySet<number>): { coin: Coin; at: number }[] {
  const out: { coin: Coin; at: number }[] = [];
  list.forEach((token, at) => {
    if (skip.has(at)) return;
    const coin = findCoin(token, book);
    if (coin && !out.some((seen) => seen.coin.mint === coin.mint)) out.push({ coin, at });
  });
  return out;
}

function shareIn(list: readonly Token[], nums: readonly Num[]): number | null {
  const percent = nums.find((n) => n.share !== null);
  if (percent) return percent.share;
  for (const token of list) for (const [pattern, share] of SHARE) if (pattern.test(token.text)) return share;
  return null;
}

/**
 * A word the line knows: a joining word, a command word, a number, a unit, a share, or a coin of the book. An address
 * the book does not hold is not known: it never lets the coin on screen stand in for it.
 */
function known(token: Token, book: Book): boolean {
  const t = token.text;
  return (
    FILLER.has(t) ||
    AT.test(t) ||
    TOWARD.test(t) ||
    DOLLARS.test(t) ||
    SOLS.test(t) ||
    NUMBER.test(t) ||
    NUMBER_UNIT.test(t) ||
    FOR.test(t) ||
    SHARE.some(([pattern]) => pattern.test(t)) ||
    Object.values(VERBS).some((pattern) => pattern.test(t)) ||
    PAIRS.some(([first, second]) => first.test(t) || second.test(t)) ||
    findCoin(token, book) !== null
  );
}

/**
 * What the sentence asks for. A question — a question word first, or a «?» at the end — is always Ryntra's to answer;
 * a sentence that names no window, or names one without what it needs (a trade without a coin), is too.
 */
export function parse(input: string, book: Book, context: Context = { subject: null }): Command {
  const text = input.slice(0, COMMAND_MAX).trim();
  const question = text;
  const list = tokens(text);
  if (!list.length) return { kind: 'ask', question };
  // «How does the agent work?» is the guide's to answer, before any question goes to Ryntra.
  const learn = learnAsk(text);
  if (learn !== undefined) return { kind: 'learn', chapter: learn };
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(text)) return { kind: 'ask', question };
  if (list.some((token) => IF.test(token.text) || NOT.test(token.text))) return { kind: 'ask', question };

  const verbs = verbsOf(list);
  const nums = numbers(list, book);
  const used = new Set(nums.flatMap((n) => n.used));
  // A word the line does not know — a ticker the city has no tower for — is never replaced by the coin on screen:
  // «buy XYZ 50» over JUP's window does not buy JUP. Without a coin named, it goes to Ryntra.
  // In capitals a ticker that is also a word of the line («BUY ME 50», with an ME tower) may have been meant: unsure.
  const unsure = shouted(text) && list.some((t) => findCoin(t, book) === null && book.coins.some((c) => bare(c.symbol) === t.text.toUpperCase()));
  const unknown = unsure || list.some((token) => !known(token, book));
  const subject = unknown ? null : context.subject;

  // A limit or a stop names its window even beside «buy» or «sell»: «limit buy JUP 0.8», «sell JUP stop 0.8».
  if (verbs.has('stop') || verbs.has('limit')) {
    const mode = verbs.has('stop') ? 'stop' : 'limit';
    const coins = coinsIn(list, book, new Set([verbs.get('stop') ?? -1, verbs.get('limit') ?? -1]));
    const coin = coins.find((c) => !isBase(c.coin))?.coin ?? coins[0]?.coin ?? subject;
    if (!coin) return { kind: 'ask', question };
    const side: Side = verbs.has('buy') ? 'buy' : verbs.has('sell') ? 'sell' : mode === 'stop' ? 'sell' : 'buy';
    const afterAt = nums.find((n) => AT.test(list[n.at - 1]?.text ?? ''));
    const said = afterAt ? dollarPrice(afterAt) : (nums.find((n) => n.value && n.unit !== 'coin' && n.unit !== 'SOL')?.value ?? null);
    // USDC's own price cannot be said in dollars: none is written for it.
    return { kind: 'order', mode, side, coin, price: isBase(coin) === 'USDC' ? null : said };
  }

  if (verbs.has('swap')) return swap(list, book, nums, subject, unknown) ?? { kind: 'ask', question };

  if (verbs.has('buy') || verbs.has('sell')) {
    const side: Side = verbs.has('buy') && (!verbs.has('sell') || verbs.get('buy')! < verbs.get('sell')!) ? 'buy' : 'sell';
    // «buy JUP at 0.5», «продай 100 JUP по 0.8»: a price said is a limit at that price, never a market order of that size.
    const atPrice = nums.find((n) => AT.test(list[n.at - 1]?.text ?? ''));
    if (atPrice) {
      // The coin is the one named — «sell 2 SOL at 150» is SOL — and only the price's own words are passed over.
      const named = coinsIn(list, book, new Set(atPrice.used));
      // «buy 50 USDC of SOL at 140»: with SOL and USDC both named, the coin is the one the amount is not said in.
      const paidIn = nums.find((n) => n !== atPrice && (n.unit === 'SOL' || n.unit === 'USDC'))?.unit ?? null;
      const coin = named.find((c) => !isBase(c.coin))?.coin ?? named.find((c) => isBase(c.coin) !== paidIn)?.coin ?? named[0]?.coin ?? subject;
      if (!coin) return { kind: 'ask', question };
      return { kind: 'order', mode: 'limit', side, coin, price: isBase(coin) === 'USDC' ? null : dollarPrice(atPrice) };
    }
    return trade(side, list, book, nums, used, subject, unknown) ?? { kind: 'ask', question };
  }

  if (verbs.has('launch') || (verbs.has('create') && list.some((t) => /^(token|coin|токен\p{L}*|монет\p{L}*|meme|мем\p{L}*)$/u.test(t.text)))) {
    if (list.some((t) => AGENT.test(t.text))) return { kind: 'ask', question };
    return launch(list, verbs);
  }

  if (verbs.has('send')) return { kind: 'money', place: 'send', send: sendFill(list, book, nums) };
  if (verbs.has('paylink')) return { kind: 'money', place: 'paylink', send: null };
  if (verbs.has('bridge')) return { kind: 'money', place: 'bridge', send: null };
  if (verbs.has('topup')) return { kind: 'money', place: 'topup', send: null };
  if (verbs.has('activity')) return { kind: 'money', place: 'activity', send: null };
  if (verbs.has('portfolio')) return { kind: 'money', place: 'portfolio', send: null };
  if (verbs.has('earn')) return { kind: 'earn' };

  if (verbs.has('chart') || verbs.has('trade')) {
    const coin = coinsIn(list, book, new Set())[0]?.coin ?? subject;
    if (!coin) return { kind: 'ask', question };
    return verbs.has('chart') ? { kind: 'chart', coin } : { kind: 'coin', coin };
  }

  // A coin alone — «JUP», «$bonk», its address — opens its window; a coin inside a sentence is a question about it.
  const words = list.filter((t) => !FILLER.has(t.text) || findCoin(t, book) !== null);
  if (words.length === 1) {
    const coin = findCoin(words[0]!, book);
    if (coin) return { kind: 'coin', coin };
    const raw = words[0]!.raw;
    if (BASE58.test(raw)) return { kind: 'mint', mint: raw };
  }
  return { kind: 'ask', question };
}

/** A price said after «at»: dollars, unless it was said in SOL or another coin — then none is written, never as dollars. */
function dollarPrice(n: Num): string | null {
  return n.unit === 'SOL' || n.unit === 'coin' ? null : n.value;
}

function trade(side: Side, list: readonly Token[], book: Book, nums: readonly Num[], used: ReadonlySet<number>, subject: Coin | null, unknown: boolean): Command | null {
  const named = coinsIn(list, book, used);
  // «buy JUP with USDC», «sell JUP into SOL»: a second coin that is SOL or USDC, after a joining word, is the other side.
  const otherSide = named.length > 1 ? named.find((c, n) => n > 0 && isBase(c.coin) && FILLER.has(list[c.at - 1]?.text ?? '')) : undefined;
  let coin = named.find((c) => c !== otherSide)?.coin ?? null;
  const amountNum = nums.find((n) => n.value !== null);
  // «buy 50 SOL»: the unit is the coin itself — unless another word named a coin the city does not know.
  if (!coin && !unknown && amountNum && (amountNum.unit === 'SOL' || amountNum.unit === 'USDC')) coin = amountNum.unit === 'SOL' ? SOL_COIN : USDC_COIN;
  coin ??= subject;
  if (!coin) return null;
  const share = shareIn(list, nums);
  const other = otherSide ? isBase(otherSide.coin) : null;
  const unit = amountNum?.unit ?? null;
  const own = isBase(coin);

  if (side === 'buy') {
    // What is bought is said in what is paid. A count of the coin bought («buy 50 SOL», «buy 100 JUP») cannot stand in
    // that field, so it is left for the person to write.
    let amount: string | null = null;
    let pay: Base | null = other;
    if (amountNum && share === null) {
      if (unit === 'coin' || (unit !== null && unit === own)) amount = null;
      else {
        // A bare number is dollars: «купити SOL на 50». Read the smaller way, a word never spends more than was meant.
        pay = unit === 'SOL' ? 'SOL' : 'USDC';
        amount = pay === own ? null : amountNum.value;
      }
    }
    if (pay === own) pay = null;
    return { kind: 'buy', coin, view: 'spot', amount, pay, share: amount ? null : share };
  }
  // A sale is said in the coin sold. Dollars or SOL beside it, or a number after «for» («sell SOL for 50»), say what it
  // brings in, never how much is sold; another coin's count («sell JUP for 100 WIF») is not this coin's.
  const brings = amountNum !== undefined && FOR.test(list[amountNum.at - 1]?.text ?? '');
  const ownCount = unit === null || unit === own || (unit === 'coin' && amountNum?.coin === coin.mint);
  const amount = amountNum && share === null && !brings && ownCount ? amountNum.value : null;
  let into: Base | null = other ?? (unit === 'USDC' || unit === 'SOL' ? unit : brings && unit === null ? 'USDC' : null);
  if (into === own) into = null;
  return { kind: 'sell', coin, view: 'spot', amount, into, share: amount ? null : share };
}

/**
 * «swap 1 SOL to JUP», «обміняти SOL на JUP», «swap 100 JUP to USDC»: the plain swap window, on the coin that is not SOL
 * or USDC — bought with them, or sold into them. The amount is of the coin given.
 */
function swap(list: readonly Token[], book: Book, nums: readonly Num[], subject: Coin | null, unknown: boolean): Command | null {
  const named = coinsIn(list, book, new Set());
  // «swap 1 SOL to XYZ» with no tower for XYZ: half a swap is not guessed into the other half.
  if (unknown && named.length < 2) return null;
  const amountNum = nums.find((n) => n.value !== null);
  const toward = named.findIndex((c, n) => n > 0 && TOWARD.test(list[c.at - 1]?.text ?? ''));
  const from = named[0]?.coin ?? null;
  const to = named.length > 1 ? named[toward > 0 ? toward : 1]!.coin : null;
  // The amount is of the coin given: «swap SOL to 100 JUP» names what is got, so it is left out.
  const given = amountNum && from && (amountNum.unit === null || (amountNum.unit === 'coin' ? amountNum.coin === from.mint : amountNum.unit === isBase(from)));
  const amount = given ? amountNum.value : null;
  if (!from) {
    const coin = subject ?? SOL_COIN;
    return isBase(coin) === 'USDC'
      ? { kind: 'buy', coin: SOL_COIN, view: 'swap', amount: null, pay: null, share: null }
      : { kind: 'buy', coin, view: 'swap', amount: null, pay: null, share: null };
  }
  if (!to) {
    // One coin: SOL or USDC given out goes to the other one; any other coin is bought.
    if (isBase(from) === 'SOL') return { kind: 'sell', coin: SOL_COIN, view: 'swap', amount, into: 'USDC', share: null };
    if (isBase(from) === 'USDC') return { kind: 'buy', coin: SOL_COIN, view: 'swap', amount, pay: 'USDC', share: null };
    return { kind: 'buy', coin: from, view: 'swap', amount: null, pay: null, share: null };
  }
  const fromBase = isBase(from);
  const toBase = isBase(to);
  if (fromBase && (!toBase || fromBase === 'USDC')) return { kind: 'buy', coin: to, view: 'swap', amount, pay: fromBase, share: null };
  if (toBase) return { kind: 'sell', coin: from, view: 'swap', amount, into: toBase, share: null };
  // Two coins that are neither: the window buys the one asked for and the person picks what pays.
  return { kind: 'buy', coin: to, view: 'swap', amount: null, pay: null, share: null };
}

/** «send 0.5 SOL to <address>», «надіслати 10 USDC на name.skr»: the recipient and the amount, the coin when said. */
function sendFill(list: readonly Token[], book: Book, nums: readonly Num[]): { to: string | null; amount: string | null; asset: Coin | null } {
  const to = list.find((t) => BASE58.test(t.raw) || SKR.test(t.raw))?.raw ?? null;
  const amountNum = nums.find((n) => n.value !== null);
  const named = coinsIn(
    list,
    book,
    new Set(list.flatMap((t, at) => (BASE58.test(t.raw) ? [at] : []))),
  );
  const asset = amountNum?.unit === 'SOL' ? SOL_COIN : amountNum?.unit === 'USDC' ? USDC_COIN : (named[0]?.coin ?? null);
  // An amount without its coin could be read in any coin the wallet holds: the window asks instead.
  return { to, amount: asset && amountNum ? amountNum.value : null, asset };
}

/** «launch $MOON», «запусти мені токен Moon Cat $MOON»: the ticker and the name, when said. */
function launch(list: readonly Token[], verbs: ReadonlyMap<Verb, number>): Command {
  const skip = new Set([verbs.get('launch') ?? -1, verbs.get('create') ?? -1]);
  const rest = list.filter(
    (t, at) => !skip.has(at) && !FILLER.has(t.text) && !/^(token|coin|meme|called|named|токен\p{L}*|монет\p{L}*|мем\p{L}*|назв\p{L}*|під|назвою)$/u.test(t.text),
  );
  const ticker = rest.find((t) => t.raw.startsWith('$'));
  const clean = (raw: string) => {
    const symbol = raw.replace(/^\$+/u, '').replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
    return symbol.length >= 1 && symbol.length <= 10 ? symbol : null;
  };
  const words = rest.filter((t) => t !== ticker).map((t) => t.raw.replace(/[\p{C}]/gu, ''));
  if (ticker) return { kind: 'launch', symbol: clean(ticker.raw), name: words.length ? words.join(' ').slice(0, 32) : null };
  // One word is both: «launch Moon» fills the name Moon and the ticker MOON, for the person to change.
  if (words.length === 1) return { kind: 'launch', symbol: clean(words[0]!), name: words[0]!.slice(0, 32) };
  return { kind: 'launch', symbol: null, name: words.length ? words.join(' ').slice(0, 32) : null };
}

/* ------------------------------------------------------------------------------------------------ What can open here */

/** The deployment's switches the windows stand on, as the menu reads them (`city/components/deck/Deck.tsx`). */
export type Gates = Readonly<{
  trade: boolean;
  spot: boolean;
  money: boolean;
  earn: boolean;
  launch: boolean;
  instruct: boolean;
  /** The agent on its word (CITY-175): trading within a budget — its switch and the mandate's — and preparing launches. */
  agentTrade?: boolean;
  agentLaunch?: boolean;
  /** The Dollar Saver (CITY-192): Earn's window and the Saver's own switch, both open. */
  dollar?: boolean;
  /** The money autopilot (CITY-204): its switch over the agent's and the mandate's. */
  pilot?: boolean;
}>;

/**
 * The command as this deployment can open it, or null when its window is shut here. A limit or a stop where Spot is
 * shut opens the coin's own window instead — never a «Soon» and never a window that pretends to take the order.
 */
export function fit(command: Command, gates: Gates): Command | null {
  switch (command.kind) {
    case 'buy':
    case 'sell':
      return gates.trade ? command : null;
    case 'order':
      return gates.trade && gates.spot ? command : { kind: 'coin', coin: command.coin };
    case 'money':
      return gates.money ? command : null;
    case 'earn':
      return gates.earn ? command : null;
    case 'launch':
      return gates.launch ? command : null;
    case 'instruct':
    case 'instructions':
      return gates.instruct === true ? command : null;
    case 'dollar':
      return gates.dollar === true ? command : null;
    case 'pilot':
      return gates.pilot === true ? command : null;
    case 'autopilot':
      return (command.ask.kind === 'trade' ? gates.agentTrade === true : gates.agentLaunch === true && gates.launch) ? command : null;
    default:
      return command;
  }
}

/* ------------------------------------------------------------------------------------------------ The list under the field */

/** The places the line offers while a word is typed, by the words that open them. */
const PLACES: readonly { command: Command; words: readonly string[] }[] = [
  { command: { kind: 'money', place: 'portfolio', send: null }, words: ['portfolio', 'balance', 'портфель', 'баланс'] },
  { command: { kind: 'money', place: 'send', send: null }, words: ['send', 'transfer', 'надіслати', 'переказ', 'відправити'] },
  { command: { kind: 'money', place: 'topup', send: null }, words: ['top up', 'deposit', 'receive', 'поповнити', 'отримати'] },
  { command: { kind: 'money', place: 'activity', send: null }, words: ['history', 'activity', 'історія', 'активність'] },
  { command: { kind: 'money', place: 'paylink', send: null }, words: ['pay link', 'invoice', 'посилання на оплату', 'рахунок'] },
  { command: { kind: 'earn' }, words: ['earn', 'pools', 'stake', 'заробіток', 'пули'] },
  { command: { kind: 'launch', symbol: null, name: null }, words: ['launch', 'create token', 'запустити', 'запуск'] },
  { command: { kind: 'learn', chapter: null }, words: ['learn', 'tutorial', 'guide', 'навчання', 'підручник'] },
  { command: { kind: 'instructions' }, words: ['my instructions', 'instructions', 'мої доручення', 'доручення', 'автоматика'] },
];

/** One row of the list: the command and a key that tells two rows apart. */
export type Row = Readonly<{ key: string; command: Command }>;

/** The most rows the list shows: the command, a few coins or places, and Ryntra. */
export const ROWS_MAX = 6;

export function keyOf(command: Command): string {
  switch (command.kind) {
    case 'buy':
    case 'sell':
    case 'chart':
    case 'coin':
      return `${command.kind}:${command.coin.mint}`;
    case 'order':
      return `order:${command.mode}:${command.coin.mint}`;
    case 'mint':
      return `mint:${command.mint}`;
    case 'instruct':
      return `instruct:${command.instruction.kind}:${command.instruction.coin?.mint ?? ''}`;
    case 'money':
      return `money:${command.place}`;
    case 'autopilot':
      return `autopilot:${command.ask.kind}`;
    case 'dollar':
      return `dollar:${command.ask.side}:${command.ask.asset}`;
    case 'pilot':
      return 'pilot';
    case 'learn':
      return `learn:${command.chapter ?? ''}`;
    case 'hire':
      return `hire:${command.ask.role ?? ''}`;
    case 'ask':
      return 'ask';
    default:
      return command.kind;
  }
}

/**
 * The list under the field as the person types: what the sentence says first; while it is one word, the coins and
 * places it starts; Ryntra last, for anything at all. Every row only opens a window or asks a question.
 */
export function suggest(input: string, book: Book, context: Context, gates: Gates): Row[] {
  const text = input.slice(0, COMMAND_MAX).trim();
  if (!text) return [];
  const rows: Row[] = [];
  const add = (command: Command | null) => {
    if (!command || command.kind === 'ask' || rows.some((r) => r.key === keyOf(command))) return;
    rows.push({ key: keyOf(command), command });
  };
  const parsed = parse(text, book, context);
  add(fit(parsed, gates));
  const lower = text.toLowerCase();
  if (parsed.kind === 'ask' && !/\s/u.test(lower) && !QUESTION.test(lower)) {
    const symbol = bare(lower);
    if (symbol) {
      for (const coin of book.coins) {
        if (rows.length >= 4) break;
        if (bare(coin.symbol).startsWith(symbol)) add({ kind: 'coin', coin });
      }
    }
  }
  if (parsed.kind === 'ask' && lower.length >= 2) {
    for (const place of PLACES) if (place.words.some((word) => word.startsWith(lower))) add(fit(place.command, gates));
  }
  const shown = rows.slice(0, ROWS_MAX - 1);
  if (text.length >= 2) shown.push({ key: 'ask', command: { kind: 'ask', question: text } });
  return shown;
}

/** The book from the city's towers: the named ones (verified) best first, with SOL and USDC always in it. */
export function bookOf(towers: readonly Readonly<{ id: string; symbol: string; name: string; icon: string | null; verified: boolean; mcap: number; liquidity: number }>[]): Book {
  const named = towers
    .filter((t) => t.verified && t.symbol)
    .slice()
    .sort((a, b) => b.mcap - a.mcap || b.liquidity - a.liquidity)
    .map((t): Coin => ({ mint: t.id, symbol: bare(t.symbol), name: t.name, icon: t.icon ? `/api/icon/${t.id}` : null, tower: true }));
  const has = (mint: string) => named.some((c) => c.mint === mint);
  return { coins: [...named, ...(has(SOL_MINT) ? [] : [SOL_COIN]), ...(has(USDC_MINT) ? [] : [USDC_COIN])] };
}

/**
 * Whether a question to Ryntra is about the coin on screen: it names its ticker, or points at it («is it risky?», «що з
 * нею?»). A question about the whole market asked over JUP's window stays about the market.
 */
export function aboutSubject(question: string, symbol: string): boolean {
  const ticker = bare(symbol);
  return tokens(question).some(
    (t) => bare(t.raw) === ticker || /^(it|its|it's|this|that|цю|цей|це|її|його|нею|ним|неї|нього|него|нее|неё|эта|этот|это)$/u.test(t.text),
  );
}

/* ------------------------------------------------------------------------------------------------ For the agent's reader */

/**
 * The line's own words and readers, for the agent's reader of one-sentence instructions (CITY-176,
 * `city/lib/instruct/read.ts`): the same tokens, coins and units, so the two never read a word two ways.
 */
export const LINE_WORDS = { VERBS, QUESTION, FILLER, AT, IF, NOT, AGENT, CURRENCY, SHARE, DOLLARS, SOLS, NUMBER, NUMBER_UNIT, BASE58 } as const;
export { tokens, findCoin, known, bare, isBase, type Token };
