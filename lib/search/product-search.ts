/**
 * The product's search (since 2026-09-24): one field in the top bar
 * that finds a token by its name, its ticker or its contract address, a
 * company, or an action — «Запустити токен», «Поповнити», «Історія»,
 * «Налаштування» — from any page (the menu v6.2).
 *
 * Pure: the index in, the matches out. The index is the one Markets draws —
 * one company, one card; the venue's verified crypto; its verified memes; the
 * two dollars — so a search never names a company differently from the shelf.
 * The actions are the menu's own sections and their tabs (`menuNavigation`,
 * `MENU_SECTIONS`), so a place the menu draws is an action the search finds,
 * in both languages, and nothing else. A pasted contract address is a token:
 * it opens the token's page (`/app/token/<address>` finds which).
 */

import { MENU_SECTIONS, menuNavigation, type MenuSectionId, type PageRoute, type ProductLocale } from "../../app/shell/domains.ts";
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
  /** A pasted contract address, to open as a token. */
  address: string | null;
  actions: readonly SearchAction[];
  companies: readonly ShelfCard[];
  privateCompanies: readonly ShelfCard[];
  coins: readonly SearchCoin[];
}>;

/** Words a person may type for each row, in both languages, beside its label. */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  home: ["home", "головна", "balance", "баланс", "investments", "інвестиції"],
  markets: ["markets", "ринки", "screener", "скринер", "trends", "тренди", "trending", "buy", "купити", "companies", "компанії", "crypto", "крипта", "stocks", "акції", "memes", "меми", "private", "приватні", "watchlist", "обране"],
  trade: ["trade", "торгувати", "торгівля", "order", "ордер"],
  launch: ["launch", "лаунч", "token", "токен", "create", "створити"],
  bots: ["bots", "боти", "bot", "бот", "autoinvest", "автоінвест", "recurring", "регулярна", "regularly", "регулярно", "dca", "rule", "правило"],
  money: ["money", "гроші", "funds", "кошти"],
  spot: ["spot", "спот", "chart", "графік", "candles", "свічки", "trade", "торгувати", "order", "ордер"],
  swap: ["swap", "обмін", "exchange", "обміняти", "convert"],
  "launch-new": ["launch", "запустити", "token", "токен", "create", "створити", "new", "новий"],
  "launch-mine": ["my launches", "мої лаунчі", "creator", "творець", "claim", "забрати", "fees", "комісії"],
  "bots-mine": ["my bots", "мої боти", "rules", "правила", "plans", "плани", "strategies", "стратегії", "results", "результати", "autoinvest", "автоінвест", "budget", "бюджет"],
  "bots-catalog": ["catalog", "каталог", "recurring buy", "регулярна купівля", "weekly", "щотижня", "plan", "план"],
  "top-up": ["top up", "поповнити", "deposit", "поповнення", "card", "картка", "usdc", "sol"],
  send: ["send", "надіслати", "transfer", "переказ", "переказати", "відправити"],
  receive: ["receive", "отримати", "address", "адреса", "qr"],
  bridge: ["bridge", "міст", "cross-chain", "між мережами", "base", "ethereum", "arbitrum"],
  portfolio: ["portfolio", "портфель", "positions", "позиції", "holdings", "що в мене"],
  positions: ["positions", "позиції", "holdings", "що в мене"],
  history: ["history", "історія", "transactions", "транзакції", "receipts", "квитанції", "operations"],
  agent: ["ryntra", "ai", "ші", "assistant", "помічник", "ask", "спитати", "chat"],
  rewards: ["rewards", "винагороди", "points", "бали", "referral", "реферал", "cashback"],
  settings: ["settings", "налаштування", "language", "мова", "theme", "тема", "telegram", "account", "акаунт"],
  alerts: ["notifications", "сповіщення", "alerts", "нагляд", "monitoring", "reminders", "нагадування"],
};

/** The bell's page, found by the search as the one place every note lives. */
const ALERTS = { id: "alerts", label: { en: "Notifications", uk: "Сповіщення" }, hint: { en: "Monitoring", uk: "Нагляд" }, href: "/app/alerts", icon: "alerts" } as const;

/** What a query with nothing typed yet offers: the places and the two actions a person looks for first. */
const STARTERS: readonly string[] = ["markets", "launch-new", "top-up", "bots-mine", "history", "settings"];

/** A Solana address as a person pastes it: base58, 32 to 44 characters. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The glyph of a tab found as an action. */
const TAB_ICONS: Readonly<Record<string, string>> = {
  spot: "spot",
  swap: "swap",
  "launch-new": "launch-plus",
  "launch-mine": "launch",
  "bots-mine": "bots",
  "bots-catalog": "autoinvest",
  positions: "portfolio",
  history: "history",
  "top-up": "top-up",
  send: "send",
  receive: "receive",
  bridge: "bridge",
};

/** The address a query is, when it is one — the way a pasted contract opens its token. */
export function addressOf(query: string): string | null {
  const trimmed = query.trim();
  return ADDRESS.test(trimmed) ? trimmed : null;
}

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
      hint: row.caption ?? null,
      href: row.href,
      icon: row.icon,
      words: WORDS[row.id] ?? [],
    })),
  );
  /* A section's tabs are actions of their own — «Запустити токен», «Поповнити», «Історія» — hinted by their section. */
  const tabs = menu.sections.flatMap((section) => {
    const def = MENU_SECTIONS[section.id as MenuSectionId];
    return (def.tabs ?? []).map((tab): SearchAction => ({
      id: tab.id,
      label: tab.label[locale],
      hint: def.label[locale],
      href: tab.href,
      icon: TAB_ICONS[tab.id] ?? def.icon,
      words: WORDS[tab.id] ?? [],
    }));
  });
  return [
    ...rows,
    ...tabs,
    { id: "agent", label: menu.assistant.label, hint: menu.assistant.caption ?? null, href: menu.assistant.href, icon: menu.assistant.icon, words: WORDS.agent },
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
function nameScore(name: string, ticker: string, needle: string, mint?: string): number {
  if (mint && mint.toLowerCase() === needle) return 6;
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
    .map((card) => ({ card, score: nameScore(card.name, card.ticker, needle, card.mint) }))
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
  const address = addressOf(query);
  if (needle.length === 0) {
    return {
      address: null,
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
    /* One answer per place: a section and its first tab open the same page, and the better match of the two is kept. */
    .filter((action, index, all) => all.findIndex((other) => other.href === action.href) === index)
    .slice(0, RESULT_LIMITS.actions);
  if (!index) return { address, actions: found, companies: [], privateCompanies: [], coins: [] };
  const coins: SearchCoin[] = [
    ...index.dollars.map((coin) => ({ ...coin, kind: "dollar" as const })),
    ...index.coins.map((coin) => ({ ...coin, kind: "crypto" as const })),
    ...index.memes.map((coin) => ({ ...coin, kind: "meme" as const })),
  ];
  const seen = new Set<string>();
  return {
    address,
    actions: found,
    companies: matchCards(index.companies, needle).slice(0, RESULT_LIMITS.companies),
    privateCompanies: matchCards(index.privateCompanies, needle).slice(0, RESULT_LIMITS.privateCompanies),
    coins: coins
      .map((coin) => ({ coin, score: nameScore(coin.name, coin.symbol, needle, coin.mint) }))
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
