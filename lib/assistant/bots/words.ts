/**
 * Ryntra's words in the bots hub (CITY-133, B3), English and Ukrainian.
 * Short on purpose: one line on the screen, two at most; every figure is the
 * engine's, said beside what it stands on. Advice, never «buy» or «sell»:
 * a past result is a past result, and a bot is a draft until the person
 * starts it. Pure.
 */

import type { Fit, WeatherKind } from "../../bots/weather/weather.ts";
import type { AssistantBotKind, Horizon } from "./kinds.ts";

export type Locale = "en" | "uk";

const intl = (locale: Locale) => (locale === "uk" ? "uk-UA" : "en-US");

/** $1,234 from a hundred dollars, cents under it; a minus sign, never a hyphen. */
export function usd(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 0 : 2;
  return `${value < 0 ? "−" : ""}$${magnitude.toLocaleString(intl(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** +$1.20 / −$0.80: a change carries its sign. */
export function signedUsd(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0.004 ? "+" : ""}${usd(value, locale)}`;
}

export function pct(value: number, locale: Locale, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.abs(value).toLocaleString(intl(locale), { minimumFractionDigits: 0, maximumFractionDigits: digits })}${locale === "uk" ? " %" : "%"}`;
}

type Words = Readonly<{
  bot: Readonly<Record<AssistantBotKind, string>>;
  botIn: Readonly<Record<AssistantBotKind, string>>;
  horizon: Readonly<Record<Horizon, string>>;
  forHorizon: Readonly<Record<Horizon, string>>;
  weather: Readonly<Record<WeatherKind | "trend_up" | "trend_down", string>>;
  fit: Readonly<Record<Fit, string>>;
  coin: string;
  noHistory: (symbol: string) => string;
  notRead: (symbol: string) => string;
  noWeather: (symbol: string) => string;
  unsafe: (symbol: string) => string;
  askHorizon: string;
  askAmount: string;
  nothingFits: (weather: string) => string;
  pick: (weather: string, bot: string, symbol: string) => string;
  beat: (span: string, usd: string) => string;
  trailed: (span: string, usd: string) => string;
  notWorth: (share: string, amount: string, from: string | null) => string;
  reasonFit: (weather: string, bot: string, fit: string) => string;
  reasonHorizon: (horizon: string) => string;
  reasonCustody: Readonly<Record<"position" | "order" | "wallet", string>>;
  lastSpan: (n: number) => string;
  simulated: (bot: string, symbol: string) => string;
  past: string;
  stress: (symbol: string, shock: number, usd: string) => string;
  explainKind: Readonly<Record<AssistantBotKind, readonly [string, string]>>;
  notFound: string;
  cause: Readonly<{
    range_above: string;
    range_below: string;
    needs_you: string;
    behind: (usd: string, days: string) => string;
    behindFees: (usd: string, days: string, fees: string) => string;
    ahead: (usd: string, days: string) => string;
    unpriced: string;
    done: string;
    working: string;
    waiting: string;
  }>;
  summary: (live: number, vsHold: string | null) => string;
  summaryNone: string;
  attention: (name: string) => string;
  bestWorst: (best: string, worst: string) => string;
  draftReady: (bot: string, symbol: string, amount: string) => string;
}>;

const EN: Words = {
  bot: { grid: "a grid", buyLadder: "a buy ladder", exitLadder: "an exit ladder", recurring: "a recurring buy" },
  botIn: { grid: "Grid", buyLadder: "Buy ladder", exitLadder: "Exit ladder", recurring: "Recurring buy" },
  horizon: { week: "a week", month: "a month", half_year: "half a year" },
  forHorizon: { week: "Made for a week", month: "Made for a month", half_year: "Made for half a year" },
  weather: { trend: "Trending", trend_up: "Trending up", trend_down: "Trending down", range: "Ranging", chop: "Choppy" },
  fit: { good: "fits well now", fair: "fits in part", poor: "fits poorly now" },
  coin: "this coin",
  noHistory: (symbol) => `No price history for ${symbol} yet — nothing to try a bot on.`,
  notRead: (symbol) => `Can't read ${symbol}'s prices right now.`,
  noWeather: (symbol) => `Too few candles of ${symbol} to read its weather yet.`,
  unsafe: (symbol) => `${symbol}'s token can be frozen, taxed or taken by its authority — no bot stands on it.`,
  askHorizon: "For how long — a week, a month or half a year?",
  askAmount: "How much would you put in, in dollars?",
  nothingFits: (weather) => `${weather} — no bot fits now. Waiting is a choice too.`,
  pick: (weather, bot, symbol) => `${weather} — ${bot} on ${symbol} fits.`,
  beat: (span, amount) => `${span}: ${amount} better than holding.`,
  trailed: (span, amount) => `${span}: ${amount} behind holding.`,
  notWorth: (share, amount, from) => `Costs would eat ${share} of ${amount}${from ? ` — worth it from ${from}` : ""}.`,
  reasonFit: (weather, bot, fit) => `${weather}: ${bot} ${fit}`,
  reasonHorizon: (horizon) => horizon,
  reasonCustody: {
    position: "Your money stays in your own pool position; it works without Ryntra",
    order: "Orders on the chain that only your wallet cancels",
    wallet: "Stays in your wallet; each buy is your one tap",
  },
  lastSpan: (n) => (n === 7 ? "Last week" : n === 30 ? "Last month" : n === 180 ? "Last 6 months" : `Last ${n} days`),
  simulated: (bot, symbol) => `${bot} on ${symbol}, replayed with fees, slippage and priority fees.`,
  past: "The past is not a promise.",
  stress: (symbol, shock, amount) => `If ${symbol} falls ${shock}% at once: about ${amount}`,
  explainKind: {
    grid: ["Buys lower and sells higher inside your range, in your own pool position.", "Earns in a ranging market; a strong trend walks out of the range."],
    buyLadder: ["Buy orders stepped under the price, on the chain.", "Buys dips in parts; fills only if the price comes down to them."],
    exitLadder: ["Sells in parts as the price climbs, on the chain.", "Locks profit on the way up; a fall leaves it holding."],
    recurring: ["Buys a little on a schedule; each buy is your one tap.", "Averages the price over time; it does not time the market."],
  },
  notFound: "That bot is not in this wallet's hangar.",
  cause: {
    range_above: "The price left the range above: it sold everything and waits.",
    range_below: "The price fell under the range: it bought all the way down and holds the coin.",
    needs_you: "It waits for you — finish or cancel it where it was placed.",
    behind: (amount, days) => `Behind holding by ${amount} over ${days}.`,
    behindFees: (amount, days, fees) => `Behind holding by ${amount} over ${days}; ${fees} of fees did not cover the move.`,
    ahead: (amount, days) => `Ahead of holding by ${amount} over ${days}.`,
    unpriced: "Not priced yet — nothing to judge.",
    done: "Done: nothing of it is working now.",
    working: "Working: the chain fills it, no Ryntra signature needed.",
    waiting: "Waiting for the price to reach its orders.",
  },
  summary: (live, vsHold) => `${live} ${live === 1 ? "bot works" : "bots work"}${vsHold ? `, ${vsHold} against holding` : ""}.`,
  summaryNone: "No bots run on this wallet yet.",
  attention: (name) => `Worth a look: ${name}.`,
  bestWorst: (best, worst) => `Best: ${best} · weakest: ${worst}.`,
  draftReady: (bot, symbol, amount) => `${bot} on ${symbol} for ${amount} — a draft. Check it and start.`,
};

const UK: Words = {
  bot: { grid: "сітка", buyLadder: "драбина купівлі", exitLadder: "драбина продажу", recurring: "регулярна купівля" },
  botIn: { grid: "Сітка", buyLadder: "Драбина купівлі", exitLadder: "Драбина продажу", recurring: "Регулярна купівля" },
  horizon: { week: "тиждень", month: "місяць", half_year: "пів року" },
  forHorizon: { week: "Під тиждень", month: "Під місяць", half_year: "Під пів року" },
  weather: { trend: "Тренд", trend_up: "Тренд угору", trend_down: "Тренд униз", range: "Боковик", chop: "Пила" },
  fit: { good: "зараз добре підходить", fair: "підходить частково", poor: "зараз погано підходить" },
  coin: "цей токен",
  noHistory: (symbol) => `Історії цін ${symbol} ще немає — боту нема на чому пробувати.`,
  notRead: (symbol) => `Зараз не читаю ціни ${symbol}.`,
  noWeather: (symbol) => `Свічок ${symbol} ще замало, щоб прочитати погоду.`,
  unsafe: (symbol) => `Токен ${symbol} можуть заморозити, обкласти збором чи забрати — бот на ньому не стоїть.`,
  askHorizon: "На який строк — тиждень, місяць чи пів року?",
  askAmount: "Скільки ти вклав би, у доларах?",
  nothingFits: (weather) => `${weather} — зараз жоден бот не підходить. Почекати — теж вибір.`,
  pick: (weather, bot, symbol) => `${weather} — ${bot} на ${symbol} підходить.`,
  beat: (span, amount) => `${span}: на ${amount} краще за тримання.`,
  trailed: (span, amount) => `${span}: на ${amount} гірше за тримання.`,
  notWorth: (share, amount, from) => `Витрати з'їли б ${share} від ${amount}${from ? ` — варто від ${from}` : ""}.`,
  reasonFit: (weather, bot, fit) => `${weather}: ${bot} ${fit}`,
  reasonHorizon: (horizon) => horizon,
  reasonCustody: {
    position: "Гроші у твоїй власній позиції пулу; працює без Ryntra",
    order: "Ордери в ланцюгу, скасовує лише твій гаманець",
    wallet: "Лишається в гаманці; кожна купівля — твій один дотик",
  },
  lastSpan: (n) => (n === 7 ? "Останній тиждень" : n === 30 ? "Останній місяць" : n === 180 ? "Останні пів року" : `Останні ${n} днів`),
  simulated: (bot, symbol) => `${bot} на ${symbol} — повтор із комісіями, прослизанням і пріоритетними зборами.`,
  past: "Минуле — не обіцянка.",
  stress: (symbol, shock, amount) => `Якщо ${symbol} −${shock} % одразу: близько ${amount}`,
  explainKind: {
    grid: ["Купує нижче й продає вище в твоєму діапазоні, у твоїй позиції пулу.", "Заробляє в боковику; сильний тренд виходить за діапазон."],
    buyLadder: ["Ордери на купівлю сходинками під ціною, у ланцюгу.", "Купує просідання частинами; спрацює, лише якщо ціна дійде."],
    exitLadder: ["Продає частинами, поки ціна росте, у ланцюгу.", "Фіксує прибуток на зростанні; падіння лишає токен у тебе."],
    recurring: ["Купує потроху за розкладом; кожна купівля — твій один дотик.", "Усереднює ціну в часі; моменту ринку не вгадує."],
  },
  notFound: "Такого бота в Ангарі цього гаманця немає.",
  cause: {
    range_above: "Ціна вийшла з діапазону вгору: бот усе продав і чекає.",
    range_below: "Ціна впала під діапазон: бот купив до самого низу й тримає токен.",
    needs_you: "Чекає на тебе — заверши чи скасуй там, де ставив.",
    behind: (amount, days) => `Відстає від тримання на ${amount} за ${days}.`,
    behindFees: (amount, days, fees) => `Відстає від тримання на ${amount} за ${days}; ${fees} зборів не покрили руху.`,
    ahead: (amount, days) => `Випереджає тримання на ${amount} за ${days}.`,
    unpriced: "Ще без ціни — судити нема з чого.",
    done: "Завершено: зараз нічого з нього не працює.",
    working: "Працює: виконує ланцюг, підпис Ryntra не потрібен.",
    waiting: "Чекає, поки ціна дійде до ордерів.",
  },
  summary: (live, vsHold) => `${live} ${live === 1 ? "бот працює" : live < 5 ? "боти працюють" : "ботів працюють"}${vsHold ? `, ${vsHold} проти тримання` : ""}.`,
  summaryNone: "На цьому гаманці ще не працює жоден бот.",
  attention: (name) => `Варто глянути: ${name}.`,
  bestWorst: (best, worst) => `Найкращий: ${best} · найслабший: ${worst}.`,
  draftReady: (bot, symbol, amount) => `${bot} на ${symbol} на ${amount} — чернетка. Перевір і запусти.`,
};

export const BOT_WORDS: Readonly<Record<Locale, Words>> = { en: EN, uk: UK };

/** Days in words for the «over N days» of a result. */
export function spanText(days: number, locale: Locale): string {
  if (locale === "uk") {
    const mod10 = days % 10;
    const mod100 = days % 100;
    const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дні" : "днів";
    return `${days} ${word}`;
  }
  return `${days} ${days === 1 ? "day" : "days"}`;
}
