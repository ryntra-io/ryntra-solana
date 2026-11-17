import { COMMAND_MAX, LINE_WORDS, parse, tokens, type Base, type Book, type Coin, type Context, type Token } from '../command/parse.ts';

/**
 * «Buy cheaper», «sell higher» on the agent's word: one sentence — «купи BONK дешевше на 20 % за 1 SOL»,
 * «buy JUP 15% cheaper for $50», «продай половину BONK на 2x», «sell half my WIF higher», «драбина на продаж BONK до
 * 3x» — read into a ladder for the coin's window. English and Ukrainian, with the Russian a Ukrainian phone often
 * types. Pure: no store, no wallet, no network.
 *
 * It reads the command line's way (`../command/parse.ts`): the coin, the amount and what it is paid in are the line's
 * own reading of the sentence without the ladder's words, so a word is never guessed into money here either. What the
 * ladder adds is only how far from the price, and whether it is one price or many:
 *
 * - «cheaper» with a buy, «higher» with a sell — a ladder from the price to as far as was said («на 20 %», «by 20%»),
 *   or as far as the window's own slider stands when nothing was said;
 * - «at 2x», «на 2x», «x3» with a sell — one price at that multiple; with «higher», «up to» or «ladder» — a ladder
 *   up to it.
 *
 * A sentence that is not one of these — a plain «buy SOL for 50», a question, a refusal, a buy «higher», a sale
 * «cheaper» — is not this reader's: it answers null and the line reads it as before. The person reads the ladder in
 * the coin's window and signs there; nothing here prepares, signs or sends anything.
 */

export type LadderAsk = Readonly<{
  said: string;
  action: 'buy' | 'sell';
  coin: Coin;
  /** How far the ladder reaches, basis points of the coin's price; null — not said: the window's own. */
  farBps: number | null;
  /** One price, where a multiple was said on its own («at 2x»); null — as many as fit. */
  rungs: 1 | null;
  /** A buy: what is paid, in `pay`. A sale: how much of the coin. Null — not said; `share` is a part of what the wallet holds instead. */
  amount: string | null;
  pay: Base | null;
  share: number | null;
}>;

const { QUESTION, NOT } = LINE_WORDS;

const CHEAPER = /^(cheaper|cheap|lower|дешевше|дешевш\p{L}*|нижче|дешевле|ниже)$/u;
const HIGHER = /^(higher|dearer|дорожче|дорожч\p{L}*|вище|дороже|выше)$/u;
const LADDER = /^(ladder|laddered|ladders|драбин\p{L}*|лесенк\p{L}*|лестниц\p{L}*)$/u;
/** «Up to» before a far end: «до 3x», «up to 50 %». */
const UP_TO = /^(to|upto|до)$/u;
/** A word that leads a distance: «на 20 %», «by 20%», «at 2x», «по 2x». */
const LEAD = /^(by|at|на|по|в|у|to|до|up|upto)$/u;
/** A multiple of the price: «2x», «2х» (Cyrillic), «x2», «×3», «1.5x». */
const MULTIPLE = /^(?:[xх×](\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)[xх×])$/u;
const PERCENT_JOINED = /^[+−-]?(\d+(?:[.,]\d+)?)%$/u;
const PERCENT_BARE = /^[+−-]?(\d+(?:[.,]\d+)?)$/u;

/** The farthest a sentence may ask for: 99 % under the price, a hundred times over it. */
const MAX_BUY_BPS = 9_900;
const MAX_SELL_BPS = 990_000;

const has = (list: readonly Token[], re: RegExp) => list.some((token) => re.test(token.text));
const numberOf = (text: string) => Number(text.replace(',', '.'));

/** A per-cent figure standing at `at` — «20%», or «20» with «%» after it — and how many tokens it takes; null when none. */
function percentAt(list: readonly Token[], at: number): Readonly<{ value: number; length: number }> | null {
  const token = list[at];
  if (!token) return null;
  const joined = PERCENT_JOINED.exec(token.text);
  if (joined) return { value: numberOf(joined[1]!), length: 1 };
  const bare = PERCENT_BARE.exec(token.text);
  if (bare && list[at + 1]?.text === '%') return { value: numberOf(bare[1]!), length: 2 };
  return null;
}

/** The sentence as a ladder for a coin's window, or null when it is not one. */
export function readLadderAsk(input: string, book: Book, context: Context = { subject: null }): LadderAsk | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said) return null;
  const list = tokens(said);
  if (!list.length) return null;
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(said)) return null;
  if (has(list, NOT)) return null;

  const cheaper = has(list, CHEAPER);
  const higher = has(list, HIGHER);
  const ladder = has(list, LADDER);
  const multiples = list.flatMap((token, at) => {
    const match = MULTIPLE.exec(token.text);
    return match ? [{ at, value: numberOf((match[1] ?? match[2])!) }] : [];
  });
  if (!cheaper && !higher && !ladder && multiples.length === 0) return null;
  /* Said two ways — cheaper and higher, two multiples — is not read into one. */
  if ((cheaper && higher) || multiples.length > 1) return null;

  /* The ladder's own words, taken out of the sentence: the mark, a distance beside it, and the word that leads the distance. */
  const mine = new Set<number>();
  list.forEach((token, at) => {
    if (CHEAPER.test(token.text) || HIGHER.test(token.text) || LADDER.test(token.text)) mine.add(at);
  });
  let percent: number | null = null;
  for (const at of [...mine]) {
    /* «20% cheaper», or «cheaper by 20 %» — within three words after the mark. */
    const before = percentAt(list, at - 1) ?? (list[at - 1]?.text === '%' ? percentAt(list, at - 2) : null);
    if (before && percent === null) {
      percent = before.value;
      for (let n = 1; n <= before.length; n += 1) mine.add(at - n);
      continue;
    }
    for (let next = at + 1; next <= at + 3 && next < list.length; next += 1) {
      const after = percentAt(list, next);
      if (!after) continue;
      if (percent !== null) return null;
      percent = after.value;
      for (let n = 0; n < after.length; n += 1) mine.add(next + n);
      for (let between = at + 1; between < next; between += 1) if (LEAD.test(list[between]!.text)) mine.add(between);
      break;
    }
  }
  const multiple = multiples[0] ?? null;
  if (multiple) {
    mine.add(multiple.at);
    if (LEAD.test(list[multiple.at - 1]?.text ?? '')) mine.add(multiple.at - 1);
    if (LEAD.test(list[multiple.at - 2]?.text ?? '') && mine.has(multiple.at - 1)) mine.add(multiple.at - 2);
  }
  if (multiple && percent !== null) return null;

  /* The rest is the line's own: a buy or a sale of a coin, with what is paid or how much is sold. */
  const rest = list.filter((_, at) => !mine.has(at)).map((token) => token.raw).join(' ');
  const command = parse(rest, book, context);
  if (command.kind !== 'buy' && command.kind !== 'sell') return null;
  const action = command.kind;
  /* A buy is cheaper, a sale is higher: the other way round is a stop or a chase, not a ladder that rests. */
  if ((action === 'buy' && (higher || multiple !== null)) || (action === 'sell' && cheaper)) return null;
  if (!command.coin.tower) return null;

  let farBps: number | null = null;
  if (multiple) {
    if (!(multiple.value > 1)) return null;
    farBps = Math.round((multiple.value - 1) * 10_000);
  } else if (percent !== null) {
    if (!(percent > 0)) return null;
    farBps = Math.round(percent * 100);
  }
  if (farBps !== null && (farBps < 1 || farBps > (action === 'buy' ? MAX_BUY_BPS : MAX_SELL_BPS))) return null;
  /* A multiple on its own is one price; with «higher», «up to» or «ladder» it is where the ladder ends. */
  const upTo = multiple !== null && UP_TO.test(list[multiple.at - 1]?.text ?? '');
  const rungs = multiple !== null && !higher && !ladder && !upTo ? 1 : null;

  return {
    said,
    action,
    coin: command.coin,
    farBps,
    rungs,
    amount: command.amount,
    pay: action === 'buy' ? command.pay : command.into,
    share: command.share,
  };
}
