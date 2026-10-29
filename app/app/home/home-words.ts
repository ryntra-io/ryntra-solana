import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Home's own words, English and Ukrainian side by side so neither is ever
 * missing: for a guest the market, Pulse, three steps and the launches; for a
 * wallet its value, its assets, its last operations, what needs it, its
 * orders and the day's moves.
 */

const ukForm = (count: number, one: string, few: string, many: string): string => {
  const form = new Intl.PluralRules("uk").select(count);
  return form === "one" ? one : form === "few" ? few : many;
};

const WORDS = {
  en: {
    title: "Home",
    help: "Stocks, crypto and memes on Solana — from your own wallet. Prices and moves are read live; your money shows here once a wallet is connected.",
    loading: "Reading your wallet",
    connectWallet: "Connect wallet",
    openInPhantom: "Open in Phantom",

    marketsTitle: "Markets now",
    tabs: { stocks: "Stocks", crypto: "Crypto", memes: "Memes", movers: "Movers" },
    asset: "Asset",
    price: "Price",
    day: "24h",
    volume: "Volume 24h",
    marketsAll: "View markets",
    marketsUnread: "Markets could not be read just now.",
    marketsEmpty: "No market in this list just now.",
    moversQuiet: "Nothing has moved much today.",
    source: (time: string) => `Jupiter · ${time}`,

    stepsTitle: "Start in three steps",
    steps: ["Connect wallet", "Add funds from $1 — USDC or SOL", "Buy your first stock or token"],

    launchesTitle: "Launches on Ryntra",
    launchesAll: "View launches",
    toDex: (pct: string) => `${pct} to the DEX`,
    onDex: "On the DEX",
    holders: (count: string) => `${count} holders`,

    value: "Portfolio value",
    valueUnread: "The wallet could not be read just now.",
    valuePartial: "Not every asset of the wallet could be read.",
    valueUnpriced: "No asset of the wallet has a price just now.",
    unpriced: (count: number) => `${count} ${count === 1 ? "asset" : "assets"} without a price`,
    floor: "Not everything answered: the value is at least this.",
    dayChange: "today",
    dayChangeWallet: "wallet today",
    parts: { wallet: "Wallet", pools: "Pools", orders: "In orders", collateral: "Phoenix collateral" },
    partReading: "reading",
    partUnread: "not read",
    riskLine: "Portfolio risk",
    actionTopUp: "Add funds",
    actionTopUpSol: "Add SOL",
    actionTrade: "Trade",
    quick: { topUp: "Add funds", send: "Send", receive: "Receive", swap: "Swap" },

    assetsTitle: "My assets",
    worth: "Value",
    share: "Wallet share",
    assetsAll: "Open portfolio",
    assetsNone: "No asset with a price in the wallet yet.",
    assetsUnread: "Your assets could not be read just now.",

    recentTitle: "Recent operations",
    what: "What",
    status: "Status",
    when: "When",
    recentAll: "View history",
    recentNone: "No operations through Ryntra yet.",
    recentUnread: "Your history could not be read just now.",

    attentionTitle: "Needs attention",
    calm: "All quiet.",
    attentionUnread: "Not everything could be read, so something may be missing here.",
    attention: {
      "needs-you": (count: number) => (count === 1 ? "An operation needs you" : `${count} operations need you`),
      "in-flight": (count: number) => (count === 1 ? "An operation is on its way" : `${count} operations are on their way`),
      "order-claim": (count: number) => (count === 1 ? "An order filled — take it back" : `${count} orders filled — take them back`),
      "order-part": (count: number) => (count === 1 ? "An order filled in part" : `${count} orders filled in part`),
      "pool-out": (count: number) => (count === 1 ? "A pool position is out of range" : `${count} pool positions are out of range`),
      risk: () => "Portfolio risk asks for a look",
    },

    ordersTitle: "Open orders",
    ordersNone: "No open orders.",
    ordersUnread: "Your orders could not be read just now.",
    ordersPartial: "Not every venue answered.",
    positionsUnread: "Your positions could not be read just now.",
    ordersAll: "View orders",
    token: "token",
    amount: "Amount",
    buy: "Buy",
    sell: "Sell",
    limit: "Limit",
    waiting: "Waiting",
    partFilled: "Part filled",
    placing: "Placing",
    cancelling: "Cancelling",

    retry: "Try again",
    details: "Details",
    detailsNote: "Portfolio risk",
  },
  uk: {
    title: "Головна",
    help: "Акції, крипта й меми на Solana — з твого гаманця. Ціни й рухи читаються наживо; твої гроші з'являться тут, щойно підключиш гаманець.",
    loading: "Читаємо гаманець",
    connectWallet: "Підключити гаманець",
    openInPhantom: "Відкрити в Phantom",

    marketsTitle: "Ринки зараз",
    tabs: { stocks: "Акції", crypto: "Крипта", memes: "Меми", movers: "Рухи дня" },
    asset: "Актив",
    price: "Ціна",
    day: "24 год",
    volume: "Обсяг 24 год",
    marketsAll: "Переглянути ринки",
    marketsUnread: "Ринки зараз не прочиталися.",
    marketsEmpty: "У цьому списку зараз немає ринків.",
    moversQuiet: "Сьогодні помітних рухів немає.",
    source: (time: string) => `Jupiter · ${time}`,

    stepsTitle: "Почни за три кроки",
    steps: ["Підключи гаманець", "Поповни від $1 — USDC або SOL", "Купи першу акцію чи токен"],

    launchesTitle: "Лаунчі на Ryntra",
    launchesAll: "Переглянути лаунчі",
    toDex: (pct: string) => `${pct} до DEX`,
    onDex: "На DEX",
    holders: (count: string) => `${count} власників`,

    value: "Вартість портфеля",
    valueUnread: "Гаманець зараз не прочитався.",
    valuePartial: "Не всі активи гаманця прочиталися.",
    valueUnpriced: "Жоден актив гаманця зараз не має ціни.",
    unpriced: (count: number) => `${count} ${ukForm(count, "актив", "активи", "активів")} без ціни`,
    floor: "Відповіло не все: вартість — щонайменше стільки.",
    dayChange: "за день",
    dayChangeWallet: "гаманця за день",
    parts: { wallet: "Гаманець", pools: "Пули", orders: "В ордерах", collateral: "Застава Phoenix" },
    partReading: "читаємо",
    partUnread: "не прочиталось",
    riskLine: "Ризик портфеля",
    actionTopUp: "Поповнити",
    actionTopUpSol: "Поповнити SOL",
    actionTrade: "Торгувати",
    quick: { topUp: "Поповнити", send: "Надіслати", receive: "Отримати", swap: "Обміняти" },

    assetsTitle: "Мої активи",
    worth: "Вартість",
    share: "Частка гаманця",
    assetsAll: "Відкрити портфель",
    assetsNone: "У гаманці ще немає активів з ціною.",
    assetsUnread: "Активи зараз не прочиталися.",

    recentTitle: "Останні операції",
    what: "Що",
    status: "Стан",
    when: "Коли",
    recentAll: "Переглянути історію",
    recentNone: "Операцій через Ryntra ще немає.",
    recentUnread: "Історія зараз не прочиталася.",

    attentionTitle: "Потребує уваги",
    calm: "Усе спокійно.",
    attentionUnread: "Не все прочиталося, тож тут може бути не все.",
    attention: {
      "needs-you": (count: number) => (count === 1 ? "Операція чекає на тебе" : `${count} ${ukForm(count, "операція чекає", "операції чекають", "операцій чекають")} на тебе`),
      "in-flight": (count: number) => (count === 1 ? "Операція в дорозі" : `${count} ${ukForm(count, "операція", "операції", "операцій")} в дорозі`),
      "order-claim": (count: number) => (count === 1 ? "Ордер виконано — забери кошти" : `${count} ${ukForm(count, "ордер виконано", "ордери виконано", "ордерів виконано")} — забери кошти`),
      "order-part": (count: number) => (count === 1 ? "Ордер виконано частково" : `${count} ${ukForm(count, "ордер виконано", "ордери виконано", "ордерів виконано")} частково`),
      "pool-out": (count: number) => (count === 1 ? "Позиція в пулі поза діапазоном" : `${count} ${ukForm(count, "позиція", "позиції", "позицій")} у пулах поза діапазоном`),
      risk: () => "Ризик портфеля просить глянути",
    },

    ordersTitle: "Відкриті ордери",
    ordersNone: "Відкритих ордерів немає.",
    ordersUnread: "Ордери зараз не прочиталися.",
    ordersPartial: "Не всі майданчики відповіли.",
    positionsUnread: "Позиції зараз не прочиталися.",
    ordersAll: "Переглянути ордери",
    token: "токен",
    amount: "Сума",
    buy: "Купити",
    sell: "Продати",
    limit: "Ліміт",
    waiting: "Чекає",
    partFilled: "Частково",
    placing: "Виставляємо",
    cancelling: "Скасовуємо",

    retry: "Спробувати ще",
    details: "Деталі",
    detailsNote: "Ризик портфеля",
  },
} as const;

export type HomeWords = (typeof WORDS)["en"] | (typeof WORDS)["uk"];

export function homeWords(locale: WorkspaceLocale): HomeWords {
  return locale === "uk" ? WORDS.uk : WORDS.en;
}
