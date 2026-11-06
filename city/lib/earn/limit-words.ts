import { langNow } from '../i18n/lang.ts';
import type { Intent, LimitForm } from './limit.ts';
import type { Lang } from './words.ts';

/**
 * Sell Higher's words in English and Ukrainian (CITY-97), beside Earn's own until the city's dictionaries land. On the
 * screen: the side, the market's price, your price, the amount, what arrives if it all fills, one line before the
 * signature and one action. Everything else sits behind «Details».
 */

type BySide = Readonly<Record<Intent, string>>;

export type LimitWords = Readonly<{
  intents: BySide;
  now: string;
  price: string;
  amount: BySide;
  max: string;
  unitIn: string;
  ifAll: BySide;
  noFee: string;
  minimum: string;
  risk: BySide;
  place: BySide;
  building: string;
  wallet: string;
  sending: string;
  checking: string;
  orders: string;
  waiting: string;
  partly: (pct: string) => string;
  filled: string;
  take: string;
  cancel: string;
  youGetBack: string;
  wheel: BySide;
  wheelLine: (price: string) => string;
  replace: string;
  form: string;
  forms: Readonly<Record<LimitForm, string>>;
  orderAt: string;
  ladderTo: string;
  bonus: string;
  bonusValue: (fee: string) => string;
  rent: string;
  rentBack: string;
  binsRent: string;
  network: string;
  units: string;
  unitsValue: (multiplier: string) => string;
  eve: string;
  eveKinds: Readonly<Record<'dividend' | 'split' | 'other', string>>;
  eveBlocked: (kind: string, when: string) => string;
  eveFine: string;
  issuer: string;
  issuerFine: string;
  taxes: string;
  fine: string;
  stopped: string;
  replaceFine: string;
  problems: Readonly<{
    format: string;
    price: string;
    side: BySide;
    balance: (symbol: string) => string;
    ceiling: (figure: string) => string;
    min: (figure: string) => string;
  }>;
  failures: Readonly<Record<string, string>>;
  done: Readonly<Record<'place' | 'cancel' | 'roll', string>>;
  doneLine: Readonly<Record<'place' | 'cancel' | 'roll', string>>;
  partial: string;
  failed: string;
  unknown: string;
  again: string;
  explorer: string;
  empty: string;
}>;

const EN: LimitWords = {
  intents: { sell: 'Sell higher', buy: 'Buy lower' },
  now: 'now',
  price: 'Your price',
  amount: { sell: 'You sell', buy: 'You spend' },
  max: 'Max',
  unitIn: 'Amount in',
  ifAll: { sell: 'If it all sells', buy: 'If it all buys' },
  noFee: 'Fee 0',
  minimum: 'Min',
  risk: { sell: 'above your price, no more of the rise', buy: 'buys while the price falls' },
  place: { sell: 'Sell at my price', buy: 'Buy at my price' },
  building: 'Getting exact figures…',
  wallet: 'Confirm in your wallet',
  sending: 'Reading the network…',
  checking: 'Check again',
  orders: 'Your orders',
  waiting: 'Waiting',
  partly: (pct) => `${pct} filled`,
  filled: 'Filled',
  take: 'Take',
  cancel: 'Cancel',
  youGetBack: 'You get back',
  wheel: { sell: 'Buy lower', buy: 'Sell higher' },
  wheelLine: (price) => `Next at ${price}`,
  replace: 'Units changed — set it again',
  form: 'Form',
  forms: { one: 'One price', ladder: 'Ladder' },
  orderAt: 'Order at',
  ladderTo: 'Ladder to',
  bonus: 'Maker bonus',
  bonusValue: (fee) => `half the pool’s ${fee} swap fee, on what fills`,
  rent: 'Order deposit',
  rentBack: 'back when you take it',
  binsRent: 'Pool bins, once',
  network: 'Network',
  units: 'Units',
  unitsValue: (multiplier) => `1 token = ${multiplier} shares`,
  eve: 'Corporate action',
  eveKinds: { dividend: 'Dividend', split: 'Split', other: 'Corporate action' },
  eveBlocked: (kind, when) => `${kind} ${when}: an order this near the price opens after it.`,
  eveFine: 'On the eve of a dividend or a split the token’s units change. An order near the price could fill on that step alone, so it waits; a price further away can be set now.',
  issuer: 'Issuer',
  issuerFine: 'The issuer can pause or freeze its token. An order sits in the pool until it fills or you take it.',
  taxes: 'Every fill is a sale.',
  fine: 'A real limit order in the pool, on Meteora DLMM: it fills only at your price or better and stays filled. Prices per share follow the token’s live multiplier. Your wallet signs every step; Ryntra holds no keys and adds no fee.',
  stopped: 'New orders are paused. Taking orders back still works.',
  replaceFine: 'The token’s units changed since this order was set, so its price per share moved with them. Take it and set it again at your price.',
  problems: {
    format: 'Type an amount.',
    price: 'Type your price.',
    side: { sell: 'Pick a price above now.', buy: 'Pick a price below now.' },
    balance: (symbol) => `Not enough ${symbol}.`,
    ceiling: (figure) => `Up to ${figure} for now.`,
    min: (figure) => `At least ${figure}.`,
  },
  failures: {
    LIMITS_CLOSED: 'Orders are not open to this wallet yet.',
    LIMITS_STOPPED: 'New orders are paused right now.',
    LIMIT_MARKET: 'This market is not offered right now.',
    LIMIT_CEILING: 'More than one order takes for now.',
    LIMIT_EVE: 'A corporate action is due — pick a price further away.',
    LIMIT_UNPRICED: 'No price for this market right now.',
    LIMIT_NOT_SUPPORTED: 'This pool takes no orders now.',
    ORDER_NOT_FOUND: 'This order is already gone.',
    NOT_FILLED: 'The order has not filled yet.',
    SIDE_NOT_ACCEPTED: 'The price reached yours — set it again.',
  },
  done: { place: 'Order set', cancel: 'Back in your wallet', roll: 'Wheel turned' },
  doneLine: {
    place: 'It fills only at your price or better. You can take it back any time.',
    cancel: 'Everything the order held is back in your wallet.',
    roll: 'Taken, and the next order is set.',
  },
  partial: 'The first part landed; the next needs a fresh Review — see your orders.',
  failed: 'It did not go through. Only the network fee was spent.',
  unknown: 'Sent; the network has not answered yet. Nothing will be sent again.',
  again: 'Again',
  explorer: 'Explorer',
  empty: 'No market can be checked right now.',
};

const UK: LimitWords = {
  intents: { sell: 'Продам дорожче', buy: 'Куплю дешевше' },
  now: 'зараз',
  price: 'Твоя ціна',
  amount: { sell: 'Продаєте', buy: 'Витрачаєте' },
  max: 'Усе',
  unitIn: 'Сума в',
  ifAll: { sell: 'Якщо продасться все', buy: 'Якщо купиться все' },
  noFee: 'Комісія 0',
  minimum: 'Мін.',
  risk: { sell: 'вище твоєї ціни зростання вже не твоє', buy: 'купує, коли ціна падає' },
  place: { sell: 'Продати за моєю ціною', buy: 'Купити за моєю ціною' },
  building: 'Рахуємо точні цифри…',
  wallet: 'Підтвердьте в гаманці',
  sending: 'Читаємо мережу…',
  checking: 'Перевірити ще',
  orders: 'Твої ордери',
  waiting: 'Чекає',
  partly: (pct) => `Виконано ${pct}`,
  filled: 'Виконано',
  take: 'Забрати',
  cancel: 'Скасувати',
  youGetBack: 'Повернеться',
  wheel: { sell: 'Куплю дешевше', buy: 'Продам дорожче' },
  wheelLine: (price) => `Наступний за ${price}`,
  replace: 'Одиниці змінились — поставте знову',
  form: 'Форма',
  forms: { one: 'Одна ціна', ladder: 'Драбина' },
  orderAt: 'Ордер за',
  ladderTo: 'Драбина до',
  bonus: 'Бонус мейкера',
  bonusValue: (fee) => `половина комісії пулу ${fee} — лише з виконаного`,
  rent: 'Депозит ордера',
  rentBack: 'повертається, коли забереш',
  binsRent: 'Біни пулу, один раз',
  network: 'Мережа',
  units: 'Одиниці',
  unitsValue: (multiplier) => `1 токен = ${multiplier} акції`,
  eve: 'Корпоративна подія',
  eveKinds: { dividend: 'Дивіденд', split: 'Спліт', other: 'Корпоративна подія' },
  eveBlocked: (kind, when) => `${kind} ${when}: ордер так близько до ціни відкриється після нього.`,
  eveFine: 'Напередодні дивіденду чи спліту одиниці токена змінюються. Ордер біля ціни міг би виконатися лише через цей крок, тож він чекає; ціну далі можна поставити вже зараз.',
  issuer: 'Емітент',
  issuerFine: 'Емітент може призупинити чи заморозити свій токен. Ордер стоїть у пулі, доки не виконається або доки ти його не забереш.',
  taxes: 'Кожне виконання — це продаж.',
  fine: 'Справжній лімітний ордер у пулі Meteora DLMM: виконується лише за твоєю ціною або кращою і лишається виконаним. Ціни за акцію йдуть за живим множником токена. Кожен крок підписує твій гаманець; ключів Ryntra не тримає й комісії не додає.',
  stopped: 'Нові ордери на паузі. Забрати ордер можна, як і раніше.',
  replaceFine: 'Відколи ордер поставлено, одиниці токена змінились, тож і ціна за акцію зсунулась разом із ними. Забери його й постав знову за своєю ціною.',
  problems: {
    format: 'Введи суму.',
    price: 'Введи свою ціну.',
    side: { sell: 'Обери ціну вище поточної.', buy: 'Обери ціну нижче поточної.' },
    balance: (symbol) => `Бракує ${symbol}.`,
    ceiling: (figure) => `Поки до ${figure}.`,
    min: (figure) => `Щонайменше ${figure}.`,
  },
  failures: {
    LIMITS_CLOSED: 'Ордери для цього гаманця ще не відкрито.',
    LIMITS_STOPPED: 'Нові ордери зараз на паузі.',
    LIMIT_MARKET: 'Цей ринок зараз недоступний.',
    LIMIT_CEILING: 'Більше, ніж поки бере один ордер.',
    LIMIT_EVE: 'Скоро корпоративна подія — обери ціну далі.',
    LIMIT_UNPRICED: 'Для цього ринку зараз немає ціни.',
    LIMIT_NOT_SUPPORTED: 'Цей пул зараз не бере ордерів.',
    ORDER_NOT_FOUND: 'Цього ордера вже немає.',
    NOT_FILLED: 'Ордер ще не виконано.',
    SIDE_NOT_ACCEPTED: 'Ціна дійшла до твоєї — постав знову.',
  },
  done: { place: 'Ордер стоїть', cancel: 'Повернулося в гаманець', roll: 'Колесо повернулось' },
  doneLine: {
    place: 'Виконається лише за твоєю ціною або кращою. Забрати можна будь-коли.',
    cancel: 'Усе, що тримав ордер, повернулося у твій гаманець.',
    roll: 'Забрано, і наступний ордер стоїть.',
  },
  partial: 'Перша частина пройшла; для наступної потрібен новий перегляд — див. твої ордери.',
  failed: 'Не пройшло. Витрачено лише комісію мережі.',
  unknown: 'Надіслано; мережа ще не відповіла. Повторно нічого не надсилаємо.',
  again: 'Ще раз',
  explorer: 'Оглядач',
  empty: 'Зараз жоден ринок не вдалося перевірити.',
};

export const LIMIT_WORDS: Readonly<Record<Lang, LimitWords>> = { en: EN, uk: UK };

export function limitWords(lang: Lang = langNow()): LimitWords {
  return LIMIT_WORDS[lang] ?? EN;
}
