import { COMMAND_MAX, findCoin, isBase, LINE_WORDS, tokens, type Book, type Coin, type Token } from '../command/parse.ts';
import { planSaid } from '../autopilot/read.ts';
import type { StrategyPlan } from '../../../lib/mandate/plans.ts';
import type { WorkPart } from '../../../lib/pilot/plan.ts';

/**
 * The money autopilot on its word (CITY-204): one sentence for the whole budget — «працюй з моїми 2 SOL і 100 USDC:
 * частину в скарбничку, частину торгуй BONK і JUP, частину в пули», «put my 2 SOL and 100 USDC on autopilot», «розподіли
 * 3 SOL: 40 % у скарбничку, 30 % у пули, решту торгуй». English and Ukrainian, with the Russian a phone often types.
 * Pure: no store, no wallet, no network.
 *
 * It is the autopilot's only when the sentence gives money — SOL or USDC, said so — and either names two places for it or
 * says to spread it («частину», «розподіли», «autopilot», «працюй з моїми»). A budget a day («торгуй на 1 SOL на день») is
 * the agent's of CITY-175; one place alone («поклади 50 USDC під відсоток») is the Dollar Saver's of CITY-192; a question
 * or a refusal is no ask. A word is never guessed into money.
 */

export type PilotAsk = Readonly<{
  said: string;
  /** SOL and USDC given, base units as text; null — none of that asset was said. */
  solRaw: string | null;
  usdcRaw: string | null;
  /** The places named, each with its share in basis points, or `true` when named without one. */
  named: Readonly<Partial<Record<WorkPart, number | true>>>;
  /** The coins the trade is to buy, as named, first first. */
  coins: readonly Coin[];
  /** A strategy or an exit said for the trade (CITY-193), or null. */
  plan: StrategyPlan | null;
}>;

const { QUESTION, NOT, NUMBER, NUMBER_UNIT, SOLS, DOLLARS } = LINE_WORDS;

const SAVE = /^(скарбничк\p{L}*|скарбничці|копилк\p{L}*|savings?|saver|save|lend\p{L}*|депозит\p{L}*|deposit|interest|відсот\p{L}*|процент\p{L}*|yield|apy|позик\p{L}*)$/u;
const POOL = /^(пул\p{L}*|pools?|liquidity|ліквідн\p{L}*|ликвидн\p{L}*|причал\p{L}*|piers?|lp|фарм\p{L}*|farm\p{L}*)$/u;
const TRADE = /^(торгу\p{L}*|торгів\p{L}*|торговать|поторгуй\p{L}*|trade|trades|trading|трейд\p{L}*|купуй|купувати|buy|buying)$/u;
/** Words that say to spread the money: «частину», «розподіли», «решту», «split», «autopilot». */
const SPREAD = /^(частин\p{L}*|частк\p{L}*|розподіл\p{L}*|розподіли|розклади|распредели\p{L}*|часть|решт\p{L}*|остальн\p{L}*|part|parts|some|rest|split|spread|allocate|allocation|diversify|autopilot|автопілот\p{L}*|автопилот\p{L}*)$/u;
/** «Працюй з моїми …», «work with my …», «make my … work». */
const WORK = /^(працюй|працюйте|попрацюй|працювати|работай|work|working)$/u;
const WITH = /^(з|із|зі|с|with)$/u;
const MY = /^(my|моїми|моїм|моєю|мої|мій|мою|моими|мои|мой)$/u;
/** «… заробляти», «… earn»: with both SOL and USDC given, said plainly, the whole budget is put to work. */
const EARN = /^(заробляти|заробляй|зароби|заработай|зарабатывать|earn|earning)$/u;
/** A budget a day, or another span: the agent of CITY-175, not a whole budget. */
const SPAN = /^(day|days|daily|день|дня|щодня|щоденно|ежедневно|week|weekly|тиждень|щотижня|month|monthly|місяць|щомісяця|hour|hourly|годину|щогодини)$/u;

/** The words of an exit, whose per cent is not a share. */
const EXIT = /^(фіксуй|зафіксуй|фиксируй|take|profit|tp|забирай|прибуток|профіт|stop|стоп|stop-loss|stoploss|стоп-лос\p{L}*|loss|лос|sl)$/u;

const has = (list: readonly Token[], re: RegExp) => list.some((t) => re.test(t.text));

/** «2», «0,5», «1.25» → text with a point; null for anything that could be read two ways. */
function amountText(text: string): string | null {
  if (/^\d{1,3},\d{3}$/u.test(text) || /^[1-9]\d{0,2}\.\d{3}$/u.test(text)) return null;
  const value = text.replace(',', '.');
  return /^\d+(\.\d+)?$/u.test(value) && Number(value) > 0 ? value : null;
}

/** Base units of a decimal amount; null past the asset's decimals or the bound. */
function rawOf(text: string, decimals: number): string | null {
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals || whole!.length > 9) return null;
  const raw = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return raw > 0n ? raw.toString() : null;
}

/** The money said: SOL and USDC, each once at most; another money or a number with no unit refuses it all. */
function moneyOf(list: readonly Token[]): Readonly<{ sol: string | null; usdc: string | null; ok: boolean }> {
  let sol: string | null = null;
  let usdc: string | null = null;
  let ok = true;
  list.forEach((token, at) => {
    const joined = NUMBER_UNIT.exec(token.text);
    if (joined) {
      const value = amountText(joined[1]!);
      if (!value) return void (ok = false);
      if (joined[2] === 'sol') sol = sol === null ? value : ((ok = false), sol);
      else usdc = usdc === null ? value : ((ok = false), usdc);
      return;
    }
    const plain = NUMBER.exec(token.text);
    if (!plain || plain[2] === '%' || list[at + 1]?.text === '%') return;
    const value = amountText(plain[1]!);
    const next = list[at + 1]?.text ?? '';
    const dollar = token.text.startsWith('$') || plain[2] === '$' || DOLLARS.test(next);
    if (SOLS.test(next) && !dollar) {
      if (!value || sol !== null) return void (ok = false);
      sol = value;
    } else if (dollar) {
      if (!value || usdc !== null) return void (ok = false);
      usdc = value;
    }
    /* A bare number — a share's levels, a step — is not money; the strategy's reader has it. */
  });
  return { sol, usdc, ok };
}

/** Which place a word names, if any. */
const placeOf = (text: string): WorkPart | null => (SAVE.test(text) ? 'save' : POOL.test(text) ? 'pool' : TRADE.test(text) ? 'trade' : null);

/** The places named, each with the per cent said next to it («40 % у скарбничку», «скарбничка 40 %»). */
function placesOf(list: readonly Token[]): Partial<Record<WorkPart, number | true>> {
  const named: Partial<Record<WorkPart, number | true>> = {};
  const percents = list.flatMap((token, at) => {
    const joined = /^(\d{1,3}(?:[.,]\d+)?)%$/u.exec(token.text);
    const bare = /^(\d{1,3}(?:[.,]\d+)?)$/u.exec(token.text);
    const value = joined ? joined[1] : bare && list[at + 1]?.text === '%' ? bare[1] : null;
    const n = value ? Number(value.replace(',', '.')) : Number.NaN;
    /* A per cent of an exit — «take profit 20 %», «стоп −10 %» — is the trade's plan, never a share. */
    const exit = [list[at - 1]?.text, list[at - 2]?.text].some((word) => word !== undefined && EXIT.test(word));
    return Number.isFinite(n) && n > 0 && n <= 100 && !exit ? [{ at, bps: Math.round(n * 100) }] : [];
  });
  const used = new Set<number>();
  list.forEach((token, at) => {
    const part = placeOf(token.text);
    if (!part) return;
    /* The nearest per cent before it (up to three words), else after it (up to two), not one an exit took. */
    const before = [...percents].reverse().find((p) => p.at < at && at - p.at <= 3 && !used.has(p.at));
    const after = percents.find((p) => p.at > at && p.at - at <= 2 && !used.has(p.at));
    const near = before ?? after ?? null;
    if (near && named[part] === undefined) {
      used.add(near.at);
      named[part] = near.bps;
    } else if (named[part] === undefined) named[part] = true;
  });
  return named;
}

/** The coins named for the trade, by ticker: towers only, never SOL or USDC, at most three. */
function coinsOf(list: readonly Token[], book: Book): Coin[] {
  const out = new Map<string, Coin>();
  for (const token of list) {
    const coin = findCoin(token, book);
    if (coin?.tower && !isBase(coin) && out.size < 3) out.set(coin.mint, coin);
  }
  return [...out.values()];
}

/** The sentence as an ask of the money autopilot, or null when it is not one. */
export function readPilotAsk(input: string, book: Book): PilotAsk | null {
  const said = input.slice(0, COMMAND_MAX).trim();
  if (!said) return null;
  const list = tokens(said);
  if (!list.length) return null;
  if (QUESTION.test(list[0]!.text) || /\?\s*$/u.test(said)) return null;
  if (has(list, NOT)) return null;
  if (has(list, SPAN)) return null;
  const money = moneyOf(list);
  if (!money.ok || (money.sol === null && money.usdc === null)) return null;
  const named = placesOf(list);
  /* A coin named with no place is the trade. */
  const coins = coinsOf(list, book);
  if (coins.length && named.trade === undefined) named.trade = true;
  const places = Object.keys(named).length;
  const work = list.some((t, at) => WORK.test(t.text) && (WITH.test(list[at + 1]?.text ?? '') || MY.test(list[at + 1]?.text ?? '') || MY.test(list[at - 1]?.text ?? '') || MY.test(list[at - 2]?.text ?? '')));
  /* «Поклади 0,2 SOL і 5 USDC працювати»: both monies and a word of work anywhere — the whole budget, not one place. */
  const plain = money.sol !== null && money.usdc !== null && (has(list, WORK) || has(list, EARN));
  if (places < 2 && !has(list, SPREAD) && !work && !plain) return null;
  const plan = planSaid(list);
  return {
    said,
    solRaw: money.sol === null ? null : rawOf(money.sol, 9),
    usdcRaw: money.usdc === null ? null : rawOf(money.usdc, 6),
    named,
    coins,
    plan: plan && plan.id !== 'early' ? plan : null,
  };
}
