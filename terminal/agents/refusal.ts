import { digits, words } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';

/**
 * Why the engine stopped a bot's budget before the wallet, in the person's language (Recurring buys is a bot —
 * decision 109 — so the lines say «the bot», whatever the engine's English calls it). The engine judges the budget
 * and the coin before anything is signed (`lib/mandate/service.server.ts` `reviewEnable`, `coinForBudget`; the coin's
 * features in `lib/mandate/token-2022.ts`) and answers with a coarse code and a sentence in English; the code alone does
 * not say why. So the screen reads the engine's own sentence — its fixed wording, not a guess — and says it in English
 * or Ukrainian; a sentence it does not know is the plain «stopped before your wallet», never the English text.
 *
 * Nothing here changes what the engine decides. Pure: the bots' page and the tests read it as it is.
 */

export type RefusalWhy =
  | 'freeze'
  | 'takeBack'
  | 'issuerProgram'
  | 'cannotMove'
  | 'pause'
  | 'hidden'
  | 'shownAmount'
  | 'issuerClose'
  | 'startsFrozen'
  | 'unknownFeature'
  | 'transferFee'
  | 'notCoin'
  | 'noPair'
  | 'ownCoin'
  | 'launchedHere'
  | 'nameCoin'
  | 'notBudget'
  | 'otherWallet'
  | 'changed'
  | 'unreadable';

export type Refusal = Readonly<{ why: RefusalWhy; fee?: Readonly<{ takes: string; most: string }> }>;

/** The engine's sentences, by the words that stay the same in each — the gravest first, as the engine orders them. */
const KNOWN: readonly (readonly [RegExp, RefusalWhy])[] = [
  [/issuer can freeze your wallet/iu, 'freeze'],
  [/issuer can take the coin out of any wallet/iu, 'takeBack'],
  [/runs its issuer's own program on every transfer/iu, 'issuerProgram'],
  [/cannot be moved, so it could never be sold/iu, 'cannotMove'],
  [/issuer can stop every transfer/iu, 'pause'],
  [/can hide its amounts/iu, 'hidden'],
  [/shown amount changes on its own/iu, 'shownAmount'],
  [/issuer can close the coin itself/iu, 'issuerClose'],
  [/wallets of this coin start frozen/iu, 'startsFrozen'],
  [/Token-2022 feature the agent does not know/iu, 'unknownFeature'],
  [/takes [\d.]+% on every transfer/iu, 'transferFee'],
  [/not a token of the token programs|not a coin's mint|mint cannot be read whole|transfer fee cannot be read/iu, 'notCoin'],
  [/does not trade this pair|names no router fee/iu, 'noPair'],
  [/does not buy your own coin/iu, 'ownCoin'],
  [/does not buy coins launched on Ryntra/iu, 'launchedHere'],
  [/name the coin the agent buys/iu, 'nameCoin'],
  [/^not a budget/iu, 'notBudget'],
  [/not a wallet address|agent is not the person|another wallet/iu, 'otherWallet'],
  [/budget is not the one shown|wallet changed the transaction|unexpected|outside the mandate|not a mandate transaction|unreadable transaction/iu, 'changed'],
  [/not readable|could not be read/iu, 'unreadable'],
];

/** The engine's reason as the screen says it; null — a sentence it does not know. */
export function refusalOf(reason: string | null | undefined): Refusal | null {
  if (typeof reason !== 'string' || !reason.trim()) return null;
  const found = KNOWN.find(([re]) => re.test(reason));
  if (!found) return null;
  if (found[1] !== 'transferFee') return { why: found[1] };
  const figures = /takes ([\d.]+)% on every transfer, above the ([\d.]+)%/iu.exec(reason);
  return figures ? { why: 'transferFee', fee: { takes: figures[1]!, most: figures[2]! } } : { why: 'notCoin' };
}

export const REFUSAL = words(
  {
    freeze: 'The bot doesn’t buy this coin: its issuer can freeze your wallet of it, and a frozen coin can’t be sold.',
    takeBack: 'The bot doesn’t buy this coin: its issuer can take it out of any wallet.',
    issuerProgram: 'The bot doesn’t buy this coin: its issuer can step into every transfer of it.',
    cannotMove: 'The bot doesn’t buy this coin: it can’t be moved, so it could never be sold.',
    pause: 'The bot doesn’t buy this coin: its issuer can stop every transfer of it.',
    hidden: 'The bot doesn’t buy this coin: it can hide its amounts, so what reaches you can’t be checked.',
    shownAmount: 'The bot doesn’t buy this coin: its shown amount changes on its own.',
    issuerClose: 'The bot doesn’t buy this coin: its issuer can close the coin itself.',
    startsFrozen: 'The bot doesn’t buy this coin: new wallets of it start frozen.',
    unknownFeature: 'The bot doesn’t buy this coin: it has a feature the bot doesn’t know.',
    transferFee: (takes: string, most: string) => `The bot doesn’t buy this coin: it takes ${takes}% on every transfer, more than the ${most}% the bot pays.`,
    notCoin: 'The bot doesn’t buy this coin: it can’t be read as a coin.',
    noPair: 'The bot doesn’t buy this coin yet.',
    ownCoin: 'The bot doesn’t buy your own coin.',
    launchedHere: 'The bot doesn’t buy coins launched on Ryntra.',
    nameCoin: 'Pick the coin the bot buys.',
    notBudget: 'These numbers aren’t a budget yet — check the day, the trade and the term.',
    otherWallet: 'Another wallet — connect the one the budget is for.',
    changed: 'Stopped: it wasn’t the budget shown — nothing was sent.',
    unreadable: 'The coin couldn’t be read just now — try again in a minute.',
  },
  {
    freeze: 'Бот не купує цю монету: її емітент може заморозити твій гаманець з нею, а заморожену монету не продати.',
    takeBack: 'Бот не купує цю монету: її емітент може забрати її з будь-якого гаманця.',
    issuerProgram: 'Бот не купує цю монету: її емітент може втрутитися в кожен її переказ.',
    cannotMove: 'Бот не купує цю монету: її не можна переказати, тож і продати ніколи не вийде.',
    pause: 'Бот не купує цю монету: її емітент може зупинити всі її перекази.',
    hidden: 'Бот не купує цю монету: вона може ховати суми, тож що дійде до тебе — не звірити.',
    shownAmount: 'Бот не купує цю монету: її показана кількість змінюється сама.',
    issuerClose: 'Бот не купує цю монету: її емітент може закрити саму монету.',
    startsFrozen: 'Бот не купує цю монету: нові гаманці з нею стартують замороженими.',
    unknownFeature: 'Бот не купує цю монету: у неї є властивість, якої бот не знає.',
    transferFee: (takes: string, most: string) => `Бот не купує цю монету: вона бере ${takes}% з кожного переказу — більше за ${most}%, які платить бот.`,
    notCoin: 'Бот не купує цю монету: її не прочитати як монету.',
    noPair: 'Бот поки не купує цю монету.',
    ownCoin: 'Бот не купує твою власну монету.',
    launchedHere: 'Бот не купує монети, запущені на Ryntra.',
    nameCoin: 'Обери монету, яку купує бот.',
    notBudget: 'Ці числа ще не бюджет — глянь на день, угоду й строк.',
    otherWallet: 'Інший гаманець — підключи той, для якого бюджет.',
    changed: 'Зупинено: це був не той бюджет, що на екрані, — нічого не надіслано.',
    unreadable: 'Монету зараз не вдалося прочитати — спробуй за хвилину.',
  },
);

/** The line the person reads, in her language; null — the engine's sentence is not one the screen knows. */
export function refusalLine(reason: string | null | undefined, lang: Lang): string | null {
  const refusal = refusalOf(reason);
  if (!refusal) return null;
  const w = REFUSAL[lang];
  if (refusal.why === 'transferFee' && refusal.fee) return w.transferFee(digits(refusal.fee.takes, lang), digits(refusal.fee.most, lang));
  const line = w[refusal.why];
  return typeof line === 'string' ? line : null;
}
