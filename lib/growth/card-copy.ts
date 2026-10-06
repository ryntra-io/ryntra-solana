import type { RewardRank } from "../rewards/rules.ts";

/**
 * The words of a trade card — on the picture, on the invitation page and in
 * the sheet that makes it — in both languages. Pure and client-safe: no
 * clock, no store, no `node:` import.
 *
 * The cashback offer is the product's own sentence («кешбек 50 % кожному з
 * першої угоди») with the line that says what the half is of; no other
 * promise is made anywhere on a card.
 */

export type CardLocale = "en" | "uk";

const RANK_NAMES: Readonly<Record<CardLocale, Readonly<Record<RewardRank, string>>>> = {
  en: { BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold", SAPPHIRE: "Sapphire", DIAMOND: "Diamond" },
  uk: { BRONZE: "Бронза", SILVER: "Срібло", GOLD: "Золото", SAPPHIRE: "Сапфір", DIAMOND: "Діамант" },
};

/** 1 день, 2 дні, 5 днів — the last digits decide, as Ukrainian counts. */
function ukCount(n: number, one: string, few: string, many: string): string {
  const tail = Math.abs(n) % 100;
  const last = tail % 10;
  return tail >= 11 && tail <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

const NBSP = " ";

/** A result in hundredths of a percent, signed, one decimal: +30.0% / −12.5 %. */
export function cardPercent(bps: number, locale: CardLocale): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  const text = (Math.abs(bps) / 100).toFixed(1);
  return locale === "uk" ? `${sign}${text.replace(".", ",")}${NBSP}%` : `${sign}${text}%`;
}

/** Dollars from micros, to the cent: $1,234.56 / $1 234,56 — signed when asked. */
export function cardDollars(micros: bigint, locale: CardLocale, signed = false): string {
  const negative = micros < 0n;
  const cents = ((negative ? -micros : micros) + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, locale === "uk" ? NBSP : ",");
  const part = (cents % 100n).toString().padStart(2, "0");
  const figure = `$${whole}${locale === "uk" ? "," : "."}${part}`;
  if (!signed) return figure;
  return cents === 0n ? figure : `${negative ? "−" : "+"}${figure}`;
}

/** The decimals that show `prices` with three significant digits each, at least two — one count for all, so entry and exit read alike. */
export function priceDecimals(prices: readonly number[]): number {
  let decimals = 2;
  for (const price of prices) {
    if (price > 0 && price < 1) decimals = Math.max(decimals, Math.min(12, 2 - Math.floor(Math.log10(price))));
  }
  return decimals;
}

/**
 * A token's price in dollars. Beside another price, at their shared
 * `decimals` ($0.0000200 · $0.0000286); alone, with no trailing zeros past
 * the cents ($0.60, $0.0000213, $182.30).
 */
export function cardPrice(price: number, locale: CardLocale, decimals?: number): string {
  const max = decimals ?? priceDecimals([price]);
  const text = price.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: decimals ?? 2, maximumFractionDigits: max });
  return `$${text.replace(/\u202f/g, NBSP)}`;
}

/** A day, in UTC so the card reads the same everywhere: 6 Oct 2026 / 6 жовт. 2026 р. */
export function cardDate(iso: string, locale: CardLocale, year = true): string {
  return new Date(iso).toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** From the first day to the last, as short as reads right: 6 Oct 2026 · 1–6 Oct 2026 · 28 Sept – 6 Oct 2026. */
export function cardPeriod(from: string | null, to: string, locale: CardLocale): string {
  if (!from || cardDate(from, locale) === cardDate(to, locale)) return cardDate(to, locale);
  const start = new Date(from);
  const end = new Date(to);
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()}–${cardDate(to, locale)}`;
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return `${cardDate(from, locale, !sameYear)} – ${cardDate(to, locale)}`;
}

export type CardWords = Readonly<{
  rank: (rank: RewardRank) => string;
  kind: Readonly<{ SELL: string; BUY: string }>;
  result: string;
  entry: string;
  exit: string;
  price: string;
  paid: string;
  pnl: string;
  held: (days: number) => string;
  through: string;
  offer: string;
  offerWhy: string;
  join: string;
  risk: string;
  riskStock: string;
  /** The picture's description for a screen reader and for X. */
  alt: (symbol: string, figure: string | null) => string;

  /* The invitation page. */
  /** The trade and its result over its time: never a token's price move. */
  tradeLine: (symbol: string, figure: string | null, days: number | null) => string;
  pageLead: string;
  pageRisk: string;
  pageRiskStock: string;
  open: (symbol: string) => string;
  howCashback: string;

  /* The sheet that makes a card. */
  share: string;
  shareTrade: string;
  sheetLead: string;
  listLabel: string;
  empty: string;
  unreadable: string;
  amounts: string;
  amountsNote: string;
  drawing: string;
  failed: string;
  postX: string;
  telegram: string;
  copy: string;
  copied: string;
  close: string;
  back: string;
  /** The post's text: the trade, never a promise. */
  postText: (symbol: string, figure: string | null, days: number | null) => string;
  retry: string;
}>;

const EN: CardWords = {
  rank: (rank) => RANK_NAMES.en[rank],
  kind: { SELL: "Sold", BUY: "Bought" },
  result: "Result",
  entry: "Avg. entry",
  exit: "Exit",
  price: "Price",
  paid: "Paid",
  pnl: "Profit / loss",
  held: (days) => (days === 0 ? "same day" : days === 1 ? "1 day" : `${days} days`),
  through: "Through Ryntra · from the trade's receipts",
  offer: "50% cashback for everyone from the first trade",
  offerWhy: "Half of Ryntra's fee comes back to you",
  join: "My invitation link",
  risk: "Past results do not promise future ones. Capital at risk.",
  riskStock: "Tokenized stocks are not shares. Capital at risk.",
  alt: (symbol, figure) => (figure ? `A trade card: ${symbol} sold through Ryntra, result ${figure}` : `A trade card: ${symbol} bought through Ryntra`),

  tradeLine: (symbol, figure, days) =>
    !figure ? `Bought ${symbol} on Ryntra` : days === null ? `${symbol} trade on Ryntra: ${figure}` : days === 0 ? `${symbol} trade on Ryntra: ${figure}, same day` : `${symbol} trade on Ryntra: ${figure} in ${days === 1 ? "1 day" : `${days} days`}`,
  pageLead: "50% cashback for everyone from the first trade.",
  pageRisk: "Figures from the trade's receipts. Not advice. Capital at risk.",
  pageRiskStock: "Tokenized stocks are not shares. Figures from the trade's receipts. Not advice. Capital at risk.",
  open: (symbol) => `Open ${symbol} in Ryntra`,
  howCashback: "How cashback works",

  share: "Share",
  shareTrade: "Share a trade",
  sheetLead: "A picture of your trade with your invitation link. A loss shows the same as a profit.",
  listLabel: "Your trades through Ryntra",
  empty: "No trades through Ryntra to share yet.",
  unreadable: "Your trades could not be read right now.",
  amounts: "Show dollar amounts",
  amountsNote: "Off: only the percent and prices.",
  drawing: "Drawing the card…",
  failed: "The card could not be made. Try again.",
  postX: "Post on X",
  telegram: "Telegram",
  copy: "Copy link",
  copied: "Copied",
  close: "Close",
  back: "All trades",
  postText: (symbol, figure, days) => EN.tradeLine(symbol, figure, days),
  retry: "Try again",
};

const UK: CardWords = {
  rank: (rank) => RANK_NAMES.uk[rank],
  kind: { SELL: "Продаж", BUY: "Купівля" },
  result: "Результат",
  entry: "Середній вхід",
  exit: "Вихід",
  price: "Ціна",
  paid: "Сплачено",
  pnl: "Прибуток / збиток",
  held: (days) => (days === 0 ? "того ж дня" : `${days}${NBSP}${ukCount(days, "день", "дні", "днів")}`),
  through: `Через Ryntra · за${NBSP}квитанціями угоди`,
  offer: `Кешбек 50${NBSP}% кожному з${NBSP}першої угоди`,
  offerWhy: "Половина комісії Ryntra повертається тобі",
  join: "Моє запрошення",
  risk: `Минулий результат не обіцяє майбутнього. Капітал під${NBSP}ризиком.`,
  riskStock: `Токенізовані акції — не${NBSP}акції. Капітал під${NBSP}ризиком.`,
  alt: (symbol, figure) => (figure ? `Картка угоди: продаж ${symbol} через Ryntra, результат ${figure}` : `Картка угоди: купівля ${symbol} через Ryntra`),

  tradeLine: (symbol, figure, days) =>
    !figure ? `Купівля ${symbol} у Ryntra` : days === null ? `Угода ${symbol} у Ryntra: ${figure}` : days === 0 ? `Угода ${symbol} у Ryntra: ${figure} того ж дня` : `Угода ${symbol} у Ryntra: ${figure} за${NBSP}${days}${NBSP}${ukCount(days, "день", "дні", "днів")}`,
  pageLead: `Кешбек 50${NBSP}% кожному з${NBSP}першої угоди.`,
  pageRisk: `Цифри — з${NBSP}квитанцій угоди. Не${NBSP}порада. Капітал під${NBSP}ризиком.`,
  pageRiskStock: `Токенізовані акції — не${NBSP}акції. Цифри — з${NBSP}квитанцій угоди. Не${NBSP}порада. Капітал під${NBSP}ризиком.`,
  open: (symbol) => `Відкрити ${symbol} у Ryntra`,
  howCashback: "Як працює кешбек",

  share: "Поділитися",
  shareTrade: "Поділитися угодою",
  sheetLead: "Картинка угоди з вашим посиланням-запрошенням. Збиток видно так само, як прибуток.",
  listLabel: "Ваші угоди через Ryntra",
  empty: `Ще немає угод через Ryntra, якими можна поділитися.`,
  unreadable: "Угоди зараз не вдалося прочитати.",
  amounts: "Показати суми в доларах",
  amountsNote: "Вимкнено: лише відсоток і ціни.",
  drawing: "Малюємо картку…",
  failed: "Картку не вдалося зробити. Спробуйте ще раз.",
  postX: "Опублікувати в X",
  telegram: "Telegram",
  copy: "Копіювати",
  copied: "Скопійовано",
  close: "Закрити",
  back: "Усі угоди",
  postText: (symbol, figure, days) => UK.tradeLine(symbol, figure, days),
  retry: "Спробувати ще раз",
};

export function cardWords(locale: CardLocale): CardWords {
  return locale === "uk" ? UK : EN;
}
