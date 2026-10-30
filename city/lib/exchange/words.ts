import { words } from '../i18n/dict.ts';

/* The Exchange's words outside its window (CITY-79): what its formatters, tables and moments say on screen. */

/** The funding's period and who pays it. */
export const EX_FORMAT = words(
  {
    hours: (n: number) => `${n}h`,
    minutes: (n: number) => `${n}m`,
    longsPay: 'longs pay',
    shortsPay: 'shorts pay',
  },
  {
    hours: (n: number) => `${n} год`,
    minutes: (n: number) => `${n} хв`,
    longsPay: 'платять лонги',
    shortsPay: 'платять шорти',
  },
);

/** A market's state, by Phoenix's word on it. */
export const EX_STATE = words(
  {
    trading: 'Trading',
    underlyingClosed: 'Its market is closed',
    internalPricing: 'After hours: Phoenix prices it',
    paused: 'Paused by Phoenix',
    unknown: 'Session not known',
  },
  {
    trading: 'Торгується',
    underlyingClosed: 'Основний ринок закритий',
    internalPricing: 'Поза сесією: ціну дає Phoenix',
    paused: 'Phoenix призупинив',
    unknown: 'Сесія невідома',
  },
);

/** The account panel's title by the account's kind, and its one short line where it has one. */
export const EX_ACCOUNT = words(
  {
    connect: 'Connect a wallet',
    loading: 'Reading Phoenix',
    unavailable: 'Phoenix isn’t answering',
    invite: 'No Phoenix account',
    inviteLine: 'Phoenix opens accounts by invite.',
    frozen: 'Waiting for access',
    reduceOnly: 'Closing only',
    inactive: 'Inactive on Phoenix',
    active: 'Account',
    unknown: 'Account',
  },
  {
    connect: 'Підключити гаманець',
    loading: 'Зв’язуємося з Phoenix',
    unavailable: 'Phoenix не відповідає',
    invite: 'Немає рахунку Phoenix',
    inviteLine: 'Phoenix відкриває рахунки за запрошенням.',
    frozen: 'Чекаємо на доступ',
    reduceOnly: 'Лише закриття',
    inactive: 'Неактивний на Phoenix',
    active: 'Рахунок',
    unknown: 'Рахунок',
  },
);

/** The account's health on the engine's scale: one word, and Phoenix's detail behind a tap. */
export const EX_HEALTH = words(
  {
    healthy: 'Healthy',
    healthyLine: 'Phoenix grades this account at its lowest risk.',
    raised: 'Elevated risk',
    raisedLine: 'Phoenix moved this account up a risk grade. Closing a position or adding collateral moves it back.',
    critical: 'Critical',
    criticalLine: 'Phoenix may start cancelling this account’s resting orders to free margin.',
    stale: 'Data is out of date',
    staleLine: 'Phoenix’s reads stopped: these are the last figures read. Closing still works.',
    liquidation: 'Liquidation',
    liquidationLine: 'Phoenix reports this account as being liquidated. What happened is in the history, each fill with its receipt.',
  },
  {
    healthy: 'Норма',
    healthyLine: 'Phoenix оцінює ризик цього рахунку як найнижчий.',
    raised: 'Підвищений ризик',
    raisedLine: 'Phoenix підняв ризик цього рахунку на щабель. Закрий позицію чи додай забезпечення — і він повернеться.',
    critical: 'Критично',
    criticalLine: 'Phoenix може почати скасовувати ордери цього рахунку, щоб звільнити маржу.',
    stale: 'Дані застаріли',
    staleLine: 'Phoenix не оновлюється: це останні отримані цифри. Закрити позицію можна.',
    liquidation: 'Ліквідація',
    liquidationLine: 'Phoenix повідомляє, що рахунок ліквідують. Що сталося — в історії, кожне виконання з квитанцією.',
  },
);

/** The levels of a position on the window's strip. */
export const EX_LAYERS = words(
  {
    longEntry: 'Long entry',
    shortEntry: 'Short entry',
    liquidation: 'Liquidation',
    takeProfit: 'Take profit',
    stopLoss: 'Stop loss',
    buyOrder: 'Buy order',
    sellOrder: 'Sell order',
  },
  {
    longEntry: 'Вхід у лонг',
    shortEntry: 'Вхід у шорт',
    liquidation: 'Ліквідація',
    takeProfit: 'Тейк-профіт',
    stopLoss: 'Стоп-лос',
    buyOrder: 'Ордер на купівлю',
    sellOrder: 'Ордер на продаж',
  },
);

/** The one line under a Review's title. */
export const EX_TERMS = words(
  {
    liqNow: 'now',
    noneInRange: 'none in range',
    onFill: 'on fill',
    feeOnFill: (fee: string) => `${fee} on fill`,
    liq: (price: string) => `Liq. ${price}`,
    fee: (fee: string) => `Fee ${fee}`,
  },
  {
    liqNow: 'зараз',
    noneInRange: 'поза діапазоном',
    onFill: 'при виконанні',
    feeOnFill: (fee: string) => `${fee} при виконанні`,
    liq: (price: string) => `Ліквід. ${price}`,
    fee: (fee: string) => `Комісія ${fee}`,
  },
);

/** What still stands between the ticket and a Review. */
export const EX_ISSUES = words(
  {
    UNITS: 'Market not ready',
    MARK: 'Waiting for the price',
    SIDE: 'Choose long or short',
    SIZE: 'Choose a size',
    PRICE: 'Type a limit price',
    TP_TEXT: 'Check the take profit',
    SL_TEXT: 'Check the stop loss',
    TP_SIDE: 'Take profit on the wrong side',
    SL_SIDE: 'Stop loss on the wrong side',
  },
  {
    UNITS: 'Ринок не готовий',
    MARK: 'Чекаємо на ціну',
    SIDE: 'Обери лонг чи шорт',
    SIZE: 'Обери розмір',
    PRICE: 'Введи ціну ліміту',
    TP_TEXT: 'Перевір тейк-профіт',
    SL_TEXT: 'Перевір стоп-лос',
    TP_SIDE: 'Тейк-профіт не з того боку',
    SL_SIDE: 'Стоп-лос не з того боку',
  },
);

/** The engine's refusals in a person's words, by the engine's code, and the line for a code this release does not know. */
export const EX_REFUSALS = words(
  {
    ORDERS_CLOSED: 'Orders aren’t open for this wallet yet. Nothing was sent.',
    ACTIONS_CLOSED: 'Deposits and withdrawals aren’t open for this wallet yet. Nothing was sent.',
    CANARY_LIMIT: 'Over the current limit. Nothing was sent.',
    ORDERS_UNAVAILABLE: 'Trading is unavailable right now. Nothing was sent.',
    ACTIONS_UNAVAILABLE: 'Deposits and withdrawals are unavailable right now. Nothing was sent.',
    ACCOUNT_NEEDED: 'No Phoenix account for this wallet. Phoenix opens accounts by invite.',
    TRADING_CLOSED: 'Phoenix doesn’t take this order on this account now. Nothing was sent.',
    MARKET_GATED: 'Phoenix doesn’t take orders on this market now. Nothing was sent.',
    ISOLATED_ONLY: 'This market is isolated margin only. Nothing was sent.',
    DEPOSIT_CLOSED: 'Phoenix doesn’t take a deposit on this account now. Nothing was sent.',
    WITHDRAW_CLOSED: 'Phoenix doesn’t allow a withdrawal on this account now. Nothing was sent.',
    OVER_WITHDRAWABLE: 'More than the account may withdraw now. Nothing was sent.',
    BELOW_MINIMUM: 'The smallest position is $1. Nothing was sent.',
    LIMIT_FAR: 'The limit is more than 5% from the price. Nothing was sent.',
    POST_ONLY_CROSS: 'At this price the order would trade at once. Nothing was sent.',
    TP_SIDE: 'The take profit is on the wrong side of the price. Nothing was sent.',
    SL_SIDE: 'The stop loss is on the wrong side of the price. Nothing was sent.',
    PRICE_UNKNOWN: 'The price didn’t arrive. Nothing was sent.',
    NOT_FILLABLE: 'Not enough in the book for this size now. Nothing was sent.',
    NO_POSITION: 'There is no position on this market. Nothing was sent.',
    OVER_POSITION: 'More than the position holds. Nothing was sent.',
    LEGS_SIDE: 'Set TP/SL on the position itself. Nothing was sent.',
    NOTHING_TO_CHANGE: 'No TP/SL to change. Nothing was sent.',
    NO_ORDERS: 'No open orders on this market. Nothing was sent.',
    NO_ORDER: 'This order is no longer open. Nothing was sent.',
    NO_CONDITIONAL: 'This TP/SL is no longer set. Nothing was sent.',
    BAD_REQUEST: 'This order couldn’t be prepared. Nothing was sent.',
    VALIDATION_ERROR: 'This couldn’t be prepared. Nothing was sent.',
    PHOENIX_UNAVAILABLE: 'Phoenix didn’t answer. Nothing was sent.',
    PHOENIX_RATE_LIMITED: 'Phoenix is busy. Nothing was sent; try again in a moment.',
    UNAVAILABLE: 'Solana didn’t answer. Nothing was sent.',
    BUILD_REFUSED: 'This order didn’t pass its check. Nothing was sent.',
    RATE_LIMITED: 'Too many tries. Nothing was sent; try again in a moment.',
    TIMEOUT: 'No answer in time. Nothing was sent.',
    NETWORK: 'The connection dropped. Nothing was sent.',
    WALLET_REFUSED: 'The wallet said no. Nothing was sent.',
    WALLET_MISMATCH: 'Signed in with another wallet. Nothing was sent.',
    TICKET_EXPIRED: 'The terms expired. Nothing was sent; try again.',
    TICKET_INVALID: 'The terms expired. Nothing was sent; try again.',
    SIGNED_MISMATCH: 'The wallet changed the order. Nothing was sent.',
    NOT_SIGNED: 'Not signed by this wallet. Nothing was sent.',
    RELAY_REFUSED: 'Solana refused it. Nothing was sent.',
    FORBIDDEN_ORIGIN: 'Orders are taken on Ryntra only. Nothing was sent.',
    FALLBACK: 'Not accepted right now. Nothing was sent.',
  },
  {
    ORDERS_CLOSED: 'Ордери для цього гаманця ще закриті. Нічого не надіслано.',
    ACTIONS_CLOSED: 'Внески й виведення для цього гаманця ще закриті. Нічого не надіслано.',
    CANARY_LIMIT: 'Понад поточний ліміт. Нічого не надіслано.',
    ORDERS_UNAVAILABLE: 'Торгівля зараз недоступна. Нічого не надіслано.',
    ACTIONS_UNAVAILABLE: 'Внески й виведення зараз недоступні. Нічого не надіслано.',
    ACCOUNT_NEEDED: 'Для цього гаманця немає рахунку Phoenix. Phoenix відкриває рахунки за запрошенням.',
    TRADING_CLOSED: 'Phoenix зараз не приймає цей ордер на цьому рахунку. Нічого не надіслано.',
    MARKET_GATED: 'Phoenix зараз не приймає ордери на цьому ринку. Нічого не надіслано.',
    ISOLATED_ONLY: 'На цьому ринку лише ізольована маржа. Нічого не надіслано.',
    DEPOSIT_CLOSED: 'Phoenix зараз не приймає внесок на цей рахунок. Нічого не надіслано.',
    WITHDRAW_CLOSED: 'Phoenix зараз не дозволяє виведення з цього рахунку. Нічого не надіслано.',
    OVER_WITHDRAWABLE: 'Більше, ніж зараз можна вивести. Нічого не надіслано.',
    BELOW_MINIMUM: 'Найменша позиція — $1. Нічого не надіслано.',
    LIMIT_FAR: 'Ліміт далі ніж 5% від ціни. Нічого не надіслано.',
    POST_ONLY_CROSS: 'За цієї ціни ордер виконався б одразу. Нічого не надіслано.',
    TP_SIDE: 'Тейк-профіт не з того боку від ціни. Нічого не надіслано.',
    SL_SIDE: 'Стоп-лос не з того боку від ціни. Нічого не надіслано.',
    PRICE_UNKNOWN: 'Ціна не надійшла. Нічого не надіслано.',
    NOT_FILLABLE: 'Зараз у книзі замало для такого розміру. Нічого не надіслано.',
    NO_POSITION: 'На цьому ринку немає позиції. Нічого не надіслано.',
    OVER_POSITION: 'Більше, ніж є в позиції. Нічого не надіслано.',
    LEGS_SIDE: 'Задай TP/SL на самій позиції. Нічого не надіслано.',
    NOTHING_TO_CHANGE: 'Немає TP/SL, щоб змінити. Нічого не надіслано.',
    NO_ORDERS: 'На цьому ринку немає відкритих ордерів. Нічого не надіслано.',
    NO_ORDER: 'Цей ордер уже не відкритий. Нічого не надіслано.',
    NO_CONDITIONAL: 'Цей TP/SL уже знято. Нічого не надіслано.',
    BAD_REQUEST: 'Не вдалося підготувати цей ордер. Нічого не надіслано.',
    VALIDATION_ERROR: 'Не вдалося це підготувати. Нічого не надіслано.',
    PHOENIX_UNAVAILABLE: 'Phoenix не відповів. Нічого не надіслано.',
    PHOENIX_RATE_LIMITED: 'Phoenix зайнятий. Нічого не надіслано — спробуй за мить.',
    UNAVAILABLE: 'Solana не відповіла. Нічого не надіслано.',
    BUILD_REFUSED: 'Ордер не пройшов перевірку. Нічого не надіслано.',
    RATE_LIMITED: 'Забагато спроб. Нічого не надіслано — спробуй за мить.',
    TIMEOUT: 'Відповідь не прийшла вчасно. Нічого не надіслано.',
    NETWORK: 'З’єднання обірвалося. Нічого не надіслано.',
    WALLET_REFUSED: 'Гаманець відмовив. Нічого не надіслано.',
    WALLET_MISMATCH: 'Підписано іншим гаманцем. Нічого не надіслано.',
    TICKET_EXPIRED: 'Умови застаріли. Нічого не надіслано — спробуй ще раз.',
    TICKET_INVALID: 'Умови застаріли. Нічого не надіслано — спробуй ще раз.',
    SIGNED_MISMATCH: 'Гаманець змінив ордер. Нічого не надіслано.',
    NOT_SIGNED: 'Не підписано цим гаманцем. Нічого не надіслано.',
    RELAY_REFUSED: 'Solana відхилила це. Нічого не надіслано.',
    FORBIDDEN_ORIGIN: 'Ордери приймаються лише в Ryntra. Нічого не надіслано.',
    FALLBACK: 'Зараз не прийнято. Нічого не надіслано.',
  },
);

/** The moments of a signature that went another way than planned. */
export const EX_NOTICES = words(
  {
    lost: 'Signed, but no answer came. Check Positions before trying again.',
    old: 'Terms refreshed. Check them, then sign.',
    aged: 'Nothing was sent. Terms refreshed: check them, then sign.',
    broken: 'Nothing was sent. Try again.',
  },
  {
    lost: 'Підписано, але відповіді немає. Перевір «Позиції», перш ніж пробувати знову.',
    old: 'Умови оновлено. Перевір їх і підпиши.',
    aged: 'Нічого не надіслано. Умови оновлено: перевір їх і підпиши.',
    broken: 'Нічого не надіслано. Спробуй ще раз.',
  },
);

/** The one step before a first trade (`onboarding.ts`): a title, one calm line, the action, the detail behind «Details». */
export const ONBOARDING = words(
  {
    connectTitle: 'Connect a wallet',
    openTitle: 'Open a Phoenix account',
    openLine: 'Phoenix opens accounts by invite.',
    openAction: 'Open on phoenix.trade',
    openDetail: 'Open it on phoenix.trade with your invite, then come back: this window looks again by itself.',
    waitTitle: 'Waiting for access',
    waitLine: 'Phoenix grants access to new accounts.',
  },
  {
    connectTitle: 'Підключи гаманець',
    openTitle: 'Відкрий рахунок Phoenix',
    openLine: 'Phoenix відкриває рахунки за запрошенням.',
    openAction: 'Відкрити на phoenix.trade',
    openDetail: 'Відкрий його на phoenix.trade за запрошенням і повертайся: це вікно перевірить саме.',
    waitTitle: 'Чекаємо на доступ',
    waitLine: 'Phoenix сам відкриває доступ новим рахункам.',
  },
);
