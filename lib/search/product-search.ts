/**
 * The product's search (since 2026-09-24): one field in the top bar
 * that finds a company, a coin or an action — «Поповнити», «Історія»,
 * «Налаштування» — from any page.
 *
 * Pure: the index in, the matches out. The index is the one Markets draws —
 * one company, one card; the venue's verified crypto; its verified memes; the
 * two dollars — so a search never names a company differently from the shelf.
 * The actions are the menu's own rows (`menuNavigation`), so a row the menu
 * draws is an action the search finds, in both languages, and nothing else.
 */

import { menuNavigation, type PageRoute, type ProductLocale } from "../../app/shell/domains.ts";
import type { ShelfCoin } from "../spot/coin-shelf.ts";
import type { ShelfCard } from "../stocks/shelf.ts";

/** What the index route answers: the lists Markets draws, trimmed to what a search shows. */
export type SearchIndex = Readonly<{
  companies: readonly ShelfCard[];
  privateCompanies: readonly ShelfCard[];
  coins: readonly ShelfCoin[];
  memes: readonly ShelfCoin[];
  dollars: readonly ShelfCoin[];
}>;

export type SearchAction = Readonly<{
  id: string;
  label: string;
  /** A second line: the section of the menu the action lives in, or what it does. */
  hint: string | null;
  href: string;
  icon: string;
  words: readonly string[];
}>;

export type SearchCoin = ShelfCoin & Readonly<{ kind: "crypto" | "meme" | "dollar" }>;

export type SearchResults = Readonly<{
  actions: readonly SearchAction[];
  companies: readonly ShelfCard[];
  privateCompanies: readonly ShelfCard[];
  coins: readonly SearchCoin[];
}>;

/** Words a person may type for each row, in both languages, beside its label. */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  home: ["home", "головна", "balance", "баланс", "investments", "інвестиції"],
  markets: ["markets", "ринки", "buy", "купити", "companies", "компанії", "crypto", "крипта", "stocks", "акції"],
  autoinvest: ["autoinvest", "автоінвест", "regularly", "регулярно", "weekly", "щотижня", "rule", "правило", "budget", "бюджет", "dca"],
  swap: ["swap", "обмін", "exchange", "обміняти", "convert"],
  spot: ["spot", "спот", "chart", "графік", "candles", "свічки", "trade", "торгувати", "order", "ордер"],
  stocks: ["screener", "скринер", "stocks", "акції", "filter", "фільтр"],
  trends: ["trends", "тренди", "memes", "меми", "trending"],
  "top-up": ["top up", "поповнити", "deposit", "поповнення", "card", "картка", "usdc", "sol"],
  send: ["send", "надіслати", "transfer", "переказ", "переказати", "відправити"],
  receive: ["receive", "отримати", "address", "адреса", "qr"],
  bridge: ["bridge", "міст", "base", "ethereum", "arbitrum"],
  portfolio: ["portfolio", "портфель", "positions", "позиції", "holdings", "що в мене"],
  "my-strategies": ["strategies", "стратегії", "plan", "план", "plans", "плани"],
  results: ["results", "результати", "profit", "прибуток"],
  activity: ["history", "історія", "transactions", "транзакції", "receipts", "квитанції", "operations"],
  agent: ["ryntra", "ai", "ші", "assistant", "помічник", "ask", "спитати", "chat"],
  rewards: ["rewards", "винагороди", "points", "бали", "referral", "реферал", "cashback"],
  settings: ["settings", "налаштування", "language", "мова", "theme", "тема", "telegram", "account", "акаунт"],
  alerts: ["notifications", "сповіщення", "alerts", "нагляд", "monitoring", "reminders", "нагадування"],
};

/** The bell's page, found by the search as the one place every note lives. */
const ALERTS = { id: "alerts", label: { en: "Notifications", uk: "Сповіщення" }, hint: { en: "Monitoring", uk: "Нагляд" }, href: "/app/alerts", icon: "alerts" } as const;

/** What a query with nothing typed yet offers: the actions a beginner looks for first. */
const STARTERS: readonly string[] = ["markets", "top-up", "autoinvest", "activity", "alerts", "settings"];

/**
 * Every action the search can find, from the menu's own rows: its label, the
 * section it sits in as the hint, its words. Settings and the bell's page
 * join them, because a person looks for both by name.
 */
export function searchActions(routes: readonly PageRoute[], locale: ProductLocale): readonly SearchAction[] {
  const menu = menuNavigation(routes, locale);
  const rows = menu.sections.flatMap((section) =>
    section.rows.map((row): SearchAction => ({
      id: row.id,
      label: row.label,
      hint: row.caption ?? section.title,
      href: row.href,
      icon: row.icon,
      words: WORDS[row.id] ?? [],
    })),
  );
  return [
    ...rows,
    { id: ALERTS.id, label: ALERTS.label[locale], hint: ALERTS.hint[locale], href: ALERTS.href, icon: ALERTS.icon, words: WORDS.alerts },
    { id: "settings", label: menu.settings.label, hint: null, href: menu.settings.href, icon: menu.settings.icon, words: WORDS.settings },
  ];
}

/** Lower-case, one kind of apostrophe, no stray spaces — so «Об'єднати» and «Обʼєднати» match alike. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[’ʼ`´]/g, "'").replace(/\s+/g, " ").trim();
}

/** The words of a phrase, so «Скринер акцій» is found by «акц» and «Спот» is not found by «по». */
function wordsOf(text: string): readonly string[] {
  return normalize(text).split(/[\s·—-]+/).filter(Boolean);
}

/**
 * How well an action answers: its whole label, the label's start, the start
 * of one of its words, the start of one of the words a person may type for
 * it. A match inside a word counts only from three letters on — two letters
 * found inside «Спот» and «Сповіщення» are noise, not an answer.
 */
function actionScore(action: SearchAction, needle: string): number {
  const label = normalize(action.label);
  if (label === needle) return 5;
  if (label.startsWith(needle)) return 4;
  if (wordsOf(action.label).some((word) => word.startsWith(needle))) return 3;
  if (action.words.some((phrase) => wordsOf(phrase).some((word) => word.startsWith(needle)))) return 2;
  if (needle.length >= 3 && (label.includes(needle) || action.words.some((word) => normalize(word).includes(needle)))) return 1;
  return 0;
}

/** A company or a coin by its name or its ticker, with the same rule for a match inside a word. */
function nameScore(name: string, ticker: string, needle: string): number {
  const full = normalize(name);
  const symbol = normalize(ticker);
  if (full === needle || symbol === needle) return 5;
  if (full.startsWith(needle) || symbol.startsWith(needle)) return 4;
  if (wordsOf(name).some((word) => word.startsWith(needle))) return 3;
  if (needle.length >= 3 && (full.includes(needle) || symbol.includes(needle))) return 1;
  return 0;
}

function matchCards(cards: readonly ShelfCard[], needle: string): ShelfCard[] {
  return cards
    .map((card) => ({ card, score: nameScore(card.name, card.ticker, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.card.volume24h - a.card.volume24h)
    .map((entry) => entry.card);
}

export const RESULT_LIMITS = { actions: 5, companies: 6, privateCompanies: 3, coins: 6 } as const;

/**
 * The matches for one query, in the order a person scans them: actions,
 * companies, private companies, coins. An empty query offers the starter
 * actions and nothing else — a search box is not a second shelf.
 */
export function searchProduct(index: SearchIndex | null, actions: readonly SearchAction[], query: string): SearchResults {
  const needle = normalize(query);
  if (needle.length === 0) {
    return {
      actions: STARTERS.flatMap((id) => actions.filter((action) => action.id === id)).slice(0, RESULT_LIMITS.actions + 1),
      companies: [],
      privateCompanies: [],
      coins: [],
    };
  }
  const found = actions
    .map((action) => ({ action, score: actionScore(action, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.action)
    .slice(0, RESULT_LIMITS.actions);
  if (!index) return { actions: found, companies: [], privateCompanies: [], coins: [] };
  const coins: SearchCoin[] = [
    ...index.dollars.map((coin) => ({ ...coin, kind: "dollar" as const })),
    ...index.coins.map((coin) => ({ ...coin, kind: "crypto" as const })),
    ...index.memes.map((coin) => ({ ...coin, kind: "meme" as const })),
  ];
  const seen = new Set<string>();
  return {
    actions: found,
    companies: matchCards(index.companies, needle).slice(0, RESULT_LIMITS.companies),
    privateCompanies: matchCards(index.privateCompanies, needle).slice(0, RESULT_LIMITS.privateCompanies),
    coins: coins
      .map((coin) => ({ coin, score: nameScore(coin.name, coin.symbol, needle) }))
      .filter((entry) => entry.score > 0 && !seen.has(entry.coin.mint) && seen.add(entry.coin.mint))
      .sort((a, b) => b.score - a.score || b.coin.volume24h - a.coin.volume24h)
      .map((entry) => entry.coin)
      .slice(0, RESULT_LIMITS.coins),
  };
}

/** Whether a stored or answered value is an index this module can read. */
export function isSearchIndex(value: unknown): value is SearchIndex {
  if (typeof value !== "object" || value === null) return false;
  const index = value as Record<string, unknown>;
  return ["companies", "privateCompanies", "coins", "memes", "dollars"].every((key) => Array.isArray(index[key]));
}
