import { COMMAND_MAX, findCoin, isBase, LINE_WORDS, parse, tokens, type Base, type Book, type Command, type Context } from './parse.ts';

/**
 * A buy or a sale said with a condition — «buy ANT if it drops 5%», «купи JUP, якщо впаде на 10 %», «sell JUP if it
 * rises 20%», «продай SOL, коли подорожчає до 250» — read into the order a coin's screen rests: a limit under the price
 * for a buy on a fall, a limit over it for a sale on a rise, a stop under it for a sale on a fall. English and
 * Ukrainian, with the Russian a Ukrainian phone often types. Pure: no store, no wallet, no network.
 *
 * The rest of the sentence is the line's own reading (`./parse.ts`): the coin, the amount and what pays, so a word is
 * never guessed into money here either. The condition adds only the level: a per cent from the price now (`off`, in
 * basis points, signed), or a price said in dollars after «to» / «до».
 *
 * What the terminal cannot rest — a buy on a rise (a breakout), a condition with no level, a condition on another coin —
 * is `unsure`: the line asks which action instead of opening a screen that would do something else. A sentence without
 * a condition, or without a buy or a sale, is not this reader's: null, and the line reads it as before.
 */

export type ConditionReading = Readonly<{ kind: 'order'; command: Extract<Command, { kind: 'order' }> }> | Readonly<{ kind: 'unsure' }>;

const { VERBS, QUESTION, NOT } = LINE_WORDS;

/** The words that open a condition: «if», «when», «якщо», «коли». */
const IF_WORD = /(?<![\p{L}\p{N}])(if|when|once|якщо|коли|если|когда)(?![\p{L}\p{N}])/iu;

/** A fall: «drops», «dips», «falls», «впаде», «подешевшає», «просяде». */
const FALL =
  /^(drop|drops|dropped|dip|dips|dipped|fall|falls|fell|down|declines|sinks|dumps|впаде|впав|падає|падатиме|подешевшає|подешевшав|подешевшала|подешевшало|просяде|просіла|просів|знизиться|опуститься|опуститися|упаде|упадет|упадёт|падает|подешевеет|просядет|снизится)$/u;
/** A rise: «rises», «pumps», «goes up», «виросте», «подорожчає». */
const RISE =
  /^(rise|rises|rose|up|pump|pumps|pumped|climbs|jumps|grows|gains|moons|виросте|виріс|зросте|зріс|росте|підніметься|піднявся|подорожчає|подорожчав|подорожчала|вырастет|поднимется|подорожает|растет|растёт)$/u;
/** «Goes», «gets» before «up» / «down»: words of the move itself. */
const MOVE_HELPERS = /^(it|goes|go|gets|is|price|its|ціна|вона|він|воно|она|он|цена|by|на|до|to)$/u;

const PERCENT_JOINED = /^[+−-]?(\d+(?:[.,]\d+)?)%$/u;
const PERCENT_BARE = /^[+−-]?(\d+(?:[.,]\d+)?)$/u;
const PRICE = /^\$?(\d+(?:[.,]\d+)?)\$?$/u;
/** Before a price: «to $0.8», «до 0,8». */
const TO = /^(to|до|below|under|above|over|нижче|вище|ниже|выше)$/u;

/** The farthest a sentence may ask for: 99 % under the price, a hundred times over it. */
const MAX_UNDER_BPS = 9_900;
const MAX_OVER_BPS = 990_000;

const number = (text: string) => Number(text.replace(',', '.'));

/** The sentence's condition clause — from «if» to the next comma or the end — and the rest; null without «if». */
function split(said: string): Readonly<{ clause: string; rest: string }> | null {
  const found = IF_WORD.exec(said);
  if (!found) return null;
  const start = found.index;
  const tail = said.slice(start);
  // A comma inside a figure («до 1,2») is a decimal, not the clause's end.
  const stop = tail.search(/;|,(?!\d)/u);
  const end = stop < 0 ? said.length : start + stop;
  return { clause: said.slice(start, end), rest: `${said.slice(0, start)} ${said.slice(end + 1)}`.replace(/\s+/gu, ' ').trim() };
}

/** A dollar price as a field takes it: a point for decimals, never a figure with two readings. */
function priceText(text: string): string | null {
  if (/^\d{1,3},\d{3}$/u.test(text)) return null;
  const value = text.replace(',', '.');
  return /^\d+(\.\d+)?$/u.test(value) && Number(value) > 0 ? value.replace(/^0+(?=\d)/u, '') : null;
}

/** The sentence's conditional order, `unsure` when it is one the terminal cannot rest, or null when it is no such sentence. */
export function readCondition(input: string, book: Book, context: Context = { subject: null }): ConditionReading | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said || /\?\s*$/u.test(said)) return null;
  const all = tokens(said);
  if (!all.length || QUESTION.test(all[0]!.text) || all.some((token) => NOT.test(token.text))) return null;
  if (!all.some((token) => VERBS.buy.test(token.text) || VERBS.sell.test(token.text))) return null;
  const parts = split(said);
  if (!parts) return null;

  /* The clause: the move, its level, and a coin it may name — «якщо JUP впаде на 10 %, купи на 1 SOL». */
  const clause = tokens(parts.clause).slice(1);
  const fall = clause.some((token) => FALL.test(token.text));
  const rise = clause.some((token) => RISE.test(token.text));
  const named = clause.map((token) => findCoin(token, book)).find((coin) => coin !== null) ?? null;
  let percent: number | null = null;
  let price: string | null = null;
  clause.forEach((token, at) => {
    const joined = PERCENT_JOINED.exec(token.text);
    const bare = PERCENT_BARE.exec(token.text);
    if (joined) percent = number(joined[1]!);
    else if (bare && clause[at + 1]?.text === '%') percent = number(bare[1]!);
    else if (TO.test(clause[at - 1]?.text ?? '')) {
      const plain = PRICE.exec(token.text);
      if (plain && clause[at + 1]?.text !== '%') price = priceText(plain[1]!);
    }
  });
  /* Anything else in the clause — another coin's move, a date, «when I get paid» — is not a level the screen can rest. */
  const other = clause.some((token) => !(FALL.test(token.text) || RISE.test(token.text) || MOVE_HELPERS.test(token.text) || token.text === '%' || PERCENT_JOINED.test(token.text) || PRICE.test(token.text) || findCoin(token, book) !== null));

  /* The rest is the line's own: a buy or a sale of a coin, with what pays or how much is sold. */
  // A coin named in the condition is the one bought or sold: «якщо JUP впаде на 10 %, купи на 1 SOL» buys JUP with SOL.
  const command = parse(named ? `${parts.rest} $${named.symbol.replace(/^\$+/u, '')}` : parts.rest, book, context);
  if (command.kind !== 'buy' && command.kind !== 'sell') return { kind: 'unsure' };
  if (named && named.mint !== command.coin.mint) return { kind: 'unsure' };
  if (fall === rise || other || (percent === null && price === null) || isBase(command.coin) === 'USDC') return { kind: 'unsure' };
  const side = command.kind;
  /* A buy on a rise chases the price: no order of the terminal rests there. */
  if (side === 'buy' && rise) return { kind: 'unsure' };

  let off: number | null = null;
  if (price === null) {
    const bps = Math.round(percent! * 100);
    if (!(bps >= 1) || bps > (fall ? MAX_UNDER_BPS : MAX_OVER_BPS)) return { kind: 'unsure' };
    off = fall ? -bps : bps;
  }
  const pay: Base | null = side === 'buy' ? command.pay : command.into;
  /* A price said in dollars prices the pair in USDC: a buy's sum said in SOL cannot stand in that field, so it is left. */
  const amount = price !== null && side === 'buy' && pay === 'SOL' ? null : command.amount;
  return {
    kind: 'order',
    command: {
      kind: 'order',
      mode: side === 'sell' && fall ? 'stop' : 'limit',
      side,
      coin: command.coin,
      price,
      ...(off !== null ? { off } : {}),
      amount,
      pay: price !== null ? 'USDC' : (pay ?? 'USDC'),
      share: command.share,
    },
  };
}

/**
 * The order's price from the price now: `off` basis points from `usd`, in what the pair is priced in — dollars, or SOL
 * at `solUsd` a coin. Cut to a figure a person would type: four significant figures under 1, two decimals over it.
 * Null when a price is missing.
 */
export function priceOff(usd: number | null, off: number, unitUsd = 1): string | null {
  if (usd === null || !Number.isFinite(usd) || usd <= 0 || !Number.isFinite(unitUsd) || unitUsd <= 0) return null;
  const value = (usd * (1 + off / 10_000)) / unitUsd;
  if (!(value > 0)) return null;
  const places = value >= 1000 ? 0 : value >= 1 ? 2 : Math.min(12, -Math.floor(Math.log10(value)) + 3);
  const text = value.toFixed(places).replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
  return Number(text) > 0 ? text : null;
}
