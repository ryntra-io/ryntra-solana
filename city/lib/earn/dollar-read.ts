import { cleanNumber, COMMAND_MAX, LINE_WORDS, tokens, type Token } from '../command/parse.ts';
import type { DollarAsset, DollarSide } from './dollar.ts';

/**
 * The Dollar Saver on its word (CITY-192): one sentence — «поклади мої USDC працювати», «put my USDC to work»,
 * «поклади 50 USDC під відсоток», «lend 2 SOL», «забери мої USDC зі скарбнички» — read into the card to open: the
 * coin, the side and the amount when it was said. English and Ukrainian, with the Russian a Ukrainian phone often
 * types. Pure: no store, no wallet, no network.
 *
 * It reads the command line's way (`../command/parse.ts`): the same tokens and numbers, a word is never guessed into
 * money, and a question or a refusal is never an ask. «Put» alone is not a deposit — «put 1 SOL into JUP» is a trade —
 * so a deposit needs a word of lending or of the money working («lend», «під відсоток», «to work», «скарбничка»), and a
 * withdrawal a word of taking back with a word of the Saver. A sentence that is not one of the two answers null.
 */

export type DollarAsk = Readonly<{
  kind: 'dollar';
  said: string;
  side: DollarSide;
  asset: DollarAsset;
  /** The amount as said, in the coin («50», «0.5»); null when none was said or it could be read two ways. */
  amount: string | null;
}>;

const { QUESTION, NOT, SOLS, NUMBER, NUMBER_UNIT, DOLLARS } = LINE_WORDS;

/** Lending as a verb: it is a deposit on its own. */
const LEND = /^(lend|lending|позич\p{L}*|позичи|одолжи|займи)$/u;
/** Putting money somewhere: a deposit only with a word of work or interest beside it. */
const PUT = /^(put|park|place|stash|поклади|покласти|поклади-но|вклади|вкласти|вкладу|положи|положить|вложи|вложить|закинь|кинь|відклади|відкласти|відкладу|заведи|постав|let)$/u;
/** The money working, interest, a saving: what makes «put» a deposit and «take» a withdrawal from the Saver. */
const WORK =
  /^(work|working|interest|yield|apy|apr|earn|earning|earnings|savings|saver|piggy|працю\p{L}*|працюва\p{L}*|відсот\p{L}*|процент\p{L}*|заробля\p{L}*|заробіт\p{L}*|заробит\p{L}*|скарбничк\p{L}*|скарбниц\p{L}*|копилк\p{L}*|накопич\p{L}*|работ\p{L}*|депозит\p{L}*|лендинг\p{L}*)$/u;
/** Taking back: «забери», «withdraw», «зніми». */
const TAKE = /^(withdraw|take|unlend|redeem|забери|забрати|заберу|зніми|зняти|виведи|вивести|верни|поверни|повернути|сними|выведи|вытащи)$/u;
/** USDC by name; plain dollars read as USDC too — the Saver lends dollars as USDC. */
const USDC_WORD = /^(usdc|\$usdc|юсдс|юсдц)$/u;

const has = (list: readonly Token[], re: RegExp) => list.some((t) => re.test(t.text));

/** The coin said: USDC (or dollars) or SOL; null when both or neither was said. */
function assetOf(list: readonly Token[]): DollarAsset | null {
  const sol = list.some((t) => SOLS.test(t.text) || /^\$?sol$/u.test(t.text) || /^\d+(?:[.,]\d+)?sol$/u.test(t.text));
  const usdc = list.some((t) => USDC_WORD.test(t.text) || DOLLARS.test(t.text) || /^\$\d/u.test(t.text) || /^\d+(?:[.,]\d+)?\$$/u.test(t.text) || /^\d+(?:[.,]\d+)?(usdc|usd)$/u.test(t.text));
  if (sol === usdc) return null;
  return sol ? 'SOL' : 'USDC';
}

/** The one amount said in the coin; two amounts, a share or a per cent are not one amount. */
function amountOf(list: readonly Token[], asset: DollarAsset): string | null {
  const found: string[] = [];
  list.forEach((token, at) => {
    const joined = NUMBER_UNIT.exec(token.text);
    if (joined) {
      const unit = joined[2] === 'sol' ? 'SOL' : 'USDC';
      found.push(unit === asset ? (cleanNumber(joined[1]!) ?? '') : '');
      return;
    }
    const plain = NUMBER.exec(token.text);
    if (!plain) return;
    if (plain[2] === '%') return; // «під 5 %» is a rate asked about, not an amount
    if (token.text.startsWith('$') || plain[2] === '$') {
      found.push(asset === 'USDC' ? (cleanNumber(plain[1]!) ?? '') : '');
      return;
    }
    const next = list[at + 1]?.text ?? '';
    const sol = SOLS.test(next) || next === 'sol';
    const usdc = USDC_WORD.test(next) || DOLLARS.test(next);
    if ((sol && asset === 'SOL') || (usdc && asset === 'USDC')) found.push(cleanNumber(plain[1]!) ?? '');
    else found.push('');
  });
  return found.length === 1 && found[0] ? found[0] : null;
}

/** The sentence as an ask of the Dollar Saver, or null when it is not one. */
export function readDollarAsk(input: string): DollarAsk | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said) return null;
  const list = tokens(said);
  if (!list.length) return null;
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(said)) return null;
  if (has(list, NOT)) return null;
  const asset = assetOf(list);
  if (!asset) return null;

  const take = has(list, TAKE);
  const work = has(list, WORK);
  if (take) return work ? { kind: 'dollar', said, side: 'withdraw', asset, amount: amountOf(list, asset) } : null;
  if (has(list, LEND) || (has(list, PUT) && work) || (work && /^(make|let|нехай|хай|пусть)$/u.test(list[0]!.text))) {
    return { kind: 'dollar', said, side: 'deposit', asset, amount: amountOf(list, asset) };
  }
  return null;
}
