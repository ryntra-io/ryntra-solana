import { langNow } from '../i18n/lang.ts';
import type { EarnTab, ProductId } from './flag.ts';

/**
 * Earn's words in English and Ukrainian, in one small object until the city's dictionaries (CITY-79,
 * `city/lib/i18n/**`) land — then these move there as they are. The language follows the browser's: Ukrainian for a
 * Ukrainian browser, English otherwise.
 */

export type Lang = 'en' | 'uk';

type ProductWords = Readonly<{ name: string; line: string; action: string; context: string }>;

export type Words = Readonly<{
  title: string;
  tabs: Readonly<Record<EarnTab, string>>;
  earned: string;
  vsHold: string;
  inSol: string;
  notMeasured: string;
  products: Readonly<Record<ProductId, ProductWords>>;
  perYear: string;
  riskLabel: (dots: number) => string;
  notify: string;
  notifyOn: string;
  notifyDetails: string;
  back: string;
  open: string;
  details: string;
  connect: string;
  tryAgain: string;
  unavailable: string;
  saver: Readonly<{
    lsts: string;
    cancelled: string;
    amount: string;
    max: string;
    youGet: string;
    worth: string;
    yearAtRate: string;
    fee: string;
    noFee: string;
    minimum: string;
    network: string;
    networkRent: string;
    rent: string;
    lstFee: string;
    exitSpread: string;
    entryCost: string;
    route: string;
    risk: string;
    riskWhat: string;
    method: string;
    methodChain: string;
    methodSanctum: string;
    source: string;
    review: string;
    building: string;
    sign: string;
    wallet: string;
    sending: string;
    checking: string;
    done: string;
    doneLine: string;
    failed: string;
    failedLine: string;
    unknown: string;
    again: string;
    explorer: string;
    fine: string;
    problem: Readonly<Record<'format' | 'zero' | 'decimals' | 'balance', string>>;
  }>;
  piers: Readonly<{ fees24h: string; liquidity: string; add: string; read: string; empty: string; fine: string }>;
  mine: Readonly<{
    lsts: string;
    piers: string;
    stocks: string;
    inRange: string;
    outOfRange: string;
    filled: string;
    dividends: string;
    dividendsNone: string;
    split: string;
    unmeasured: string;
    emptyTitle: string;
    emptyLine: string;
    start: string;
    connectTitle: string;
    connectLine: string;
    dividendFine: string;
    vsHoldFine: string;
  }>;
}>;

const EN: Words = {
  title: 'Earn',
  tabs: { shelf: 'Shelf', piers: 'Piers', mine: 'Mine' },
  earned: 'Earned',
  vsHold: 'Vs holding',
  inSol: 'SOL',
  notMeasured: 'Not measured',
  products: {
    saver: { name: 'SOL Saver', line: 'SOL → staked SOL, one signature', action: 'Start', context: 'Last epoch, a year' },
    pier: { name: 'SOL Pier', line: 'Fees in SOL from a SOL pool', action: 'Add liquidity', context: 'Top pier, fees 24H' },
    dollar: { name: 'Dollar Saver', line: 'Lend USDC at a floating rate', action: 'Open', context: 'USDC lending now' },
    sell: { name: 'Sell Higher', line: 'Your price, set and left', action: 'Open', context: 'SOL now' },
    stocks: { name: 'Dollars for Stocks', line: 'Borrow USDC against your stocks', action: 'Open', context: 'Stock price now' },
    captain: { name: 'Like the Captain', line: 'Copy a strategy with a proven record', action: 'Open', context: 'Piers listed now' },
  },
  perYear: 'a year',
  riskLabel: (dots) => `Risk ${dots} of 3`,
  notify: 'Tell me when it opens',
  notifyOn: 'We’ll tell you here',
  notifyDetails: 'Kept on this device: the city tells you here when it opens. Phone and Telegram alerts come with Ryntra’s alerts.',
  back: 'Back',
  open: 'Open',
  details: 'Details',
  connect: 'Connect wallet',
  tryAgain: 'Try again',
  unavailable: 'Not available right now.',
  saver: {
    lsts: 'Staked SOL',
    cancelled: 'Cancelled in your wallet. Nothing was sent.',
    amount: 'Amount',
    max: 'Max',
    youGet: 'You get',
    worth: 'Worth',
    yearAtRate: 'A year at this rate',
    fee: 'Fee',
    noFee: 'No Ryntra fee',
    minimum: 'Min',
    network: 'Network',
    networkRent: 'Network + rent',
    rent: 'Account deposit',
    lstFee: 'Pool’s share of rewards',
    exitSpread: 'Swap back now',
    entryCost: 'Cost on the way in',
    route: 'Route',
    risk: 'Risk: may trade below SOL',
    riskWhat: 'An LST can trade below its worth in SOL when its market thins. Its worth in SOL comes from staking and does not fall with SOL’s price in dollars.',
    method: 'Rate',
    methodChain: 'The token’s worth in SOL this epoch against the last, from the stake pool on chain, compounded over a year’s epochs.',
    methodSanctum: 'Sanctum’s latest-epoch rate for this token.',
    source: 'Read',
    review: 'Review',
    building: 'Checking…',
    sign: 'Sign in wallet',
    wallet: 'Confirm in your wallet',
    sending: 'Sending…',
    checking: 'Checking the network…',
    done: 'Done',
    doneLine: 'Now earning in SOL.',
    failed: 'Failed',
    failedLine: 'Only the network fee moved.',
    unknown: 'Not known yet',
    again: 'Again',
    explorer: 'Explorer',
    fine: 'The rate is the last epoch’s and moves every epoch; it is no promise. Your wallet signs; Ryntra holds no keys.',
    problem: { format: 'Type an amount of SOL.', zero: 'Type more than zero.', decimals: 'SOL has 9 decimals.', balance: 'More than the wallet can spend.' },
  },
  piers: {
    fees24h: 'Fees 24H',
    liquidity: 'Liquidity',
    add: 'Add liquidity',
    read: 'Meteora’s figures',
    empty: 'No pier deep enough right now.',
    fine: 'A day’s fees are no promise of the next. If the price leaves the range you keep your tokens and stop earning.',
  },
  mine: {
    lsts: 'Staked SOL',
    piers: 'Piers',
    stocks: 'Stocks',
    inRange: 'In range',
    outOfRange: 'Out of range',
    filled: 'Filled',
    dividends: 'Dividends this year',
    dividendsNone: 'No dividend seen yet',
    split: 'Split — not income',
    unmeasured: 'Some positions have no figure here',
    emptyTitle: 'Nothing earning yet',
    emptyLine: 'Start with SOL: stake it in one signature.',
    start: 'SOL Saver',
    connectTitle: 'Your earnings in SOL',
    connectLine: 'Connect to see what you hold and how it stands against holding.',
    dividendFine: 'xStocks reinvest dividends by raising the token’s multiplier. Counted on the balance you hold now; a split changes the units, not the worth, and is never counted.',
    vsHoldFine: 'Earned: what the products paid, net of costs on the way in. Vs holding: against keeping the same coins. Pier dollars turned into SOL at today’s price. Different assets are never added together.',
  },
};

const UK: Words = {
  title: 'Заробіток',
  tabs: { shelf: 'Полиця', piers: 'Причали', mine: 'Моє' },
  earned: 'Зароблено',
  vsHold: 'Проти тримання',
  inSol: 'SOL',
  notMeasured: 'Не виміряно',
  products: {
    saver: { name: 'SOL-скарбничка', line: 'SOL → застейканий SOL одним підписом', action: 'Почати', context: 'Остання епоха, на рік' },
    pier: { name: 'SOL-причал', line: 'Комісії в SOL з пулу SOL', action: 'Додати ліквідність', context: 'Найкращий причал, комісії 24 год' },
    dollar: { name: 'Доларова скарбничка', line: 'Позичити USDC під змінний відсоток', action: 'Відкрити', context: 'Позика USDC зараз' },
    sell: { name: 'Продам дорожче', line: 'Своя ціна — поставив і забув', action: 'Відкрити', context: 'SOL зараз' },
    stocks: { name: 'Долари під акції', line: 'Взяти USDC під свої акції', action: 'Відкрити', context: 'Ціна акції зараз' },
    captain: { name: 'Як у капітана', line: 'Скопіювати стратегію з доведеним результатом', action: 'Відкрити', context: 'Причалів зараз' },
  },
  perYear: 'на рік',
  riskLabel: (dots) => `Ризик ${dots} з 3`,
  notify: 'Повідомити, коли відкриється',
  notifyOn: 'Повідомимо тут',
  notifyDetails: 'Зберігається на цьому пристрої: місто скаже тут, щойно відкриється. Сповіщення на телефон і в Telegram — разом зі сповіщеннями Ryntra.',
  back: 'Назад',
  open: 'Відкрити',
  details: 'Деталі',
  connect: 'Підключити',
  tryAgain: 'Ще раз',
  unavailable: 'Зараз недоступно.',
  saver: {
    lsts: 'Застейканий SOL',
    cancelled: 'Скасовано в гаманці. Нічого не надіслано.',
    amount: 'Сума',
    max: 'Усе',
    youGet: 'Отримаєте',
    worth: 'Вартість',
    yearAtRate: 'За рік за цією ставкою',
    fee: 'Комісія',
    noFee: 'Без комісії Ryntra',
    minimum: 'Мін.',
    network: 'Мережа',
    networkRent: 'Мережа й рента',
    rent: 'Депозит рахунку',
    lstFee: 'Частка пулу з нагород',
    exitSpread: 'Обмін назад зараз',
    entryCost: 'Втрата на вході',
    route: 'Маршрут',
    risk: 'Ризик: ціна LST може бути нижчою за SOL',
    riskWhat: 'LST може торгуватися нижче своєї вартості в SOL, коли ринок рідшає. Вартість у SOL росте від стейкінгу й не падає разом із ціною SOL у доларах.',
    method: 'Ставка',
    methodChain: 'Вартість токена в SOL цієї епохи проти минулої — з пулу стейкінгу в мережі, складена за епохи року.',
    methodSanctum: 'Ставка Sanctum за останню епоху для цього токена.',
    source: 'Прочитано',
    review: 'Перевірити',
    building: 'Перевіряємо…',
    sign: 'Підписати в гаманці',
    wallet: 'Підтвердьте в гаманці',
    sending: 'Надсилаємо…',
    checking: 'Перевіряємо мережу…',
    done: 'Готово',
    doneLine: 'Тепер заробляє в SOL.',
    failed: 'Не вдалося',
    failedLine: 'Пішла лише комісія мережі.',
    unknown: 'Ще невідомо',
    again: 'Ще раз',
    explorer: 'Оглядач',
    fine: 'Ставка — за останню епоху й змінюється щоепохи; це не обіцянка. Підписує ваш гаманець; ключів Ryntra не тримає.',
    problem: { format: 'Введіть суму в SOL.', zero: 'Більше за нуль.', decimals: 'У SOL 9 знаків після коми.', balance: 'Більше, ніж можна витратити з гаманця.' },
  },
  piers: {
    fees24h: 'Комісії 24 год',
    liquidity: 'Ліквідність',
    add: 'Додати ліквідність',
    read: 'Дані Meteora',
    empty: 'Зараз немає достатньо глибокого причалу.',
    fine: 'Комісії за день не обіцяють наступного. Якщо ціна вийде з діапазону, токени лишаються вашими, але заробіток зупиняється.',
  },
  mine: {
    lsts: 'Застейканий SOL',
    piers: 'Причали',
    stocks: 'Акції',
    inRange: 'У діапазоні',
    outOfRange: 'Поза діапазоном',
    filled: 'Виконано',
    dividends: 'Дивіденди цього року',
    dividendsNone: 'Дивідендів ще не було',
    split: 'Спліт — не дохід',
    unmeasured: 'Частина позицій без цифри',
    emptyTitle: 'Ще нічого не заробляє',
    emptyLine: 'Почніть із SOL: застейкайте одним підписом.',
    start: 'SOL-скарбничка',
    connectTitle: 'Ваш заробіток у SOL',
    connectLine: 'Підключіть гаманець, щоб бачити позиції й результат проти тримання.',
    dividendFine: 'xStocks реінвестують дивіденди, піднімаючи множник токена. Рахуємо на кількість, що є зараз; спліт змінює кількість, а не вартість, і ніколи не рахується.',
    vsHoldFine: 'Зароблено — що заплатили продукти, за вирахуванням витрат на вході. Проти тримання — порівняно з тими самими монетами в гаманці. Долари причалів — у SOL за сьогоднішньою ціною. Різні активи не складаємо.',
  },
};

export const WORDS: Readonly<Record<Lang, Words>> = { en: EN, uk: UK };

/** The browser's language: Ukrainian when it leads with it, English otherwise (the city's own choice comes first). */
export function langOf(languages: readonly string[] | undefined): Lang {
  return (languages ?? []).some((l, i) => i === 0 && /^uk\b/i.test(l)) ? 'uk' : 'en';
}

/** Earn's words in the city's language (CITY-79): the menu's switch, a `?lang=` link, else the browser's. */
export function earnWords(lang: Lang = langNow()): Words {
  return WORDS[lang] ?? EN;
}
