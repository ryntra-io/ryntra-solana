/**
 * The product's search (since 2026-09-24): one field in the top bar
 * that finds a token by its name, its ticker or its contract address, a
 * company, or an action — «Запустити токен», «Поповнити», «Історія»,
 * «Налаштування» — from any page (the core's menu since B1).
 *
 * Pure: the index in, the matches out. The index is the one Markets draws —
 * one company, one card; the venue's verified crypto; its verified memes; the
 * two dollars — so a search never names a company differently from the shelf.
 * The actions are the menu's own rows (`menuNavigation`, Menu 3 since NAV-1)
 * and the pages that stand under them, so a place the menu draws is an action
 * the search finds, in both languages, and nothing else. A pasted contract address is a token:
 * it opens the token's page (`/app/token/<address>` finds which).
 *
 * The groups stand in the order of their best match (SOL-C2, UX-002): «SOL» + Enter opens Solana, not «Поповнити» — a
 * ticker typed whole outranks an action found only by the words a person may type for it.
 */

import { FUTURES_NOW, MENU_ACTION, MENU_FOOT, MENU_SECTIONS, menuNavigation, type PageRoute, type ProductLocale } from "../../app/shell/domains.ts";
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
  /** A second line: the group of the menu the action lives in, or what it does. */
  hint: string | null;
  href: string;
  icon: string;
  words: readonly string[];
}>;

export type SearchCoin = ShelfCoin & Readonly<{ kind: "crypto" | "meme" | "dollar" }>;

/** The groups of results a person scans after a pasted address. */
export type SearchGroupId = "actions" | "companies" | "privateCompanies" | "coins";

export type SearchResults = Readonly<{
  /** A pasted contract address, to open as a token. */
  address: string | null;
  /** The groups in the order they are drawn: the best match first, so Enter opens it (UX-002). */
  order: readonly SearchGroupId[];
  actions: readonly SearchAction[];
  companies: readonly ShelfCard[];
  privateCompanies: readonly ShelfCard[];
  coins: readonly SearchCoin[];
}>;

/** Words a person may type for each row, in both languages, beside its label. */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  home: ["home", "головна", "balance", "баланс", "investments", "інвестиції"],
  markets: ["markets", "ринки", "screener", "скринер", "trends", "тренди", "trending", "buy", "купити", "companies", "компанії", "crypto", "крипта", "stocks", "акції", "memes", "меми", "private", "приватні", "watchlist", "обране"],
  spot: ["spot", "спот", "chart", "графік", "candles", "свічки", "trade", "торгувати", "торгівля", "terminal", "термінал", "order", "ордер"],
  swap: ["swap", "обмін", "exchange", "обміняти", "convert"],
  "launch-new": ["launch", "запустити", "token", "токен", "create", "створити", "new", "новий"],
  launch: ["launch", "лаунч", "launches", "лаунчі", "ryntra markets", "ринки ryntra"],
  pools: ["pools", "пули", "liquidity", "ліквідність", "lp", "meteora", "dlmm", "damm", "lp fees", "комісії пулу"],
  "launch-mine": ["my launches", "мої лаунчі", "creator", "творець", "claim", "забрати", "fees", "комісії"],
  predictions: ["predictions", "прогнози", "prediction markets", "ринки прогнозів", "events", "події", "outcomes", "наслідки", "polymarket", "kalshi", "paper", "симуляція"],
  futures: ["perps", "перпи", "перпс", "perp", "perpetuals", "безстрокові", "futures", "ф'ючерси", "leverage", "плече", "phoenix", "фенікс", "order book", "стакан", "collateral", "застава"],
  bots: ["bots", "боти", "autoinvest", "автоінвест", "my bots", "мої боти", "rules", "правила", "plans", "плани", "strategies", "стратегії", "results", "результати", "recurring", "регулярна", "regularly", "регулярно", "dca", "budget", "бюджет"],
  "bots-catalog": ["catalog", "каталог", "recurring buy", "регулярна купівля", "weekly", "щотижня", "plan", "план"],
  /* No ticker here: «SOL» and «USDC» are coins the search opens, not words for «Поповнити» (UX-002). */
  deposit: ["top up", "поповнити", "deposit", "поповнення", "card", "картка", "money", "гроші", "funds", "кошти"],
  send: ["send", "надіслати", "transfer", "переказ", "переказати", "відправити"],
  receive: ["receive", "отримати", "address", "адреса", "qr"],
  bridge: ["bridge", "міст", "cross-chain", "між мережами", "base", "ethereum", "arbitrum"],
  portfolio: ["portfolio", "портфель", "positions", "позиції", "holdings", "що в мене"],
  history: ["history", "історія", "transactions", "транзакції", "receipts", "квитанції", "operations"],
  assistant: ["ryntra", "ai", "ші", "assistant", "помічник", "ask", "спитати", "chat"],
  rewards: ["rewards", "винагороди", "points", "бали", "referral", "реферал", "cashback"],
  /* «Налаштування» — the menu's own panel: the theme, the language, the density, the menu's place (UX-013). */
  customize: ["settings", "налаштування", "налаштувати", "customize", "language", "мова", "english", "українська", "theme", "тема", "dark", "light", "темна", "світла", "density", "щільність", "menu", "меню"],
  /* «Акаунт» — the account's page: wallets, Telegram, signing in. */
  settings: ["account", "акаунт", "profile", "профіль", "telegram", "wallets", "гаманці", "sign in", "вхід"],
  alerts: ["notifications", "сповіщення", "alerts", "нагляд", "monitoring", "reminders", "нагадування"],
};

/** The bell's page, found by the search as the one place every note lives. */
const ALERTS = { id: "alerts", label: MENU_FOOT.notifications.label, hint: { en: "Notifications and reminders", uk: "Сповіщення й нагадування" }, href: MENU_FOOT.notifications.href, icon: "alerts" } as const;

/**
 * «Налаштування» from the search: not a page but the menu's own panel (the core's «Налаштування» at its foot), which
 * the dialog opens instead of navigating (`app/app/customize-open.ts`). The account's page is «Акаунт».
 */
export const CUSTOMIZE_HREF = "#customize";
const CUSTOMIZE = { label: { en: "Settings", uk: "Налаштування" }, hint: { en: "Theme · Language · Menu", uk: "Тема · Мова · Меню" } } as const;

/** The pages under a row that a person looks for by name: hinted by their row. */
const UNDER = [
  { id: "launch-mine", row: "launch", label: { en: "My launches", uk: "Мої лаунчі" }, href: "/app/launch/mine", icon: "launch" },
  { id: "bots-catalog", row: "bots", label: { en: "Catalog", uk: "Каталог" }, href: "/app/bots/catalog", icon: "autoinvest" },
] as const;

/** What a query with nothing typed yet offers: the places and the two actions a person looks for first. */
const STARTERS: readonly string[] = ["markets", "launch-new", "deposit", "send", "history", "customize"];

/** A Solana address as a person pastes it: base58, 32 to 44 characters. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The glyph of each row found as an action. */
const ROW_ICONS: Readonly<Record<string, string>> = {
  home: "home",
  markets: "explore",
  spot: "spot",
  swap: "swap",
  launch: "launch",
  futures: "trade",
  predictions: "results",
  bots: "autoinvest",
  assistant: "ryntra",
  pools: "pools",
  rewards: "rewards",
  portfolio: "portfolio",
  history: "history",
  deposit: "top-up",
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
 * group it sits in as the hint, its words; then the pages under a row a person
 * looks for by name, the launch of a token, the bell's page and Settings.
 */
export function searchActions(routes: readonly PageRoute[], locale: ProductLocale): readonly SearchAction[] {
  const menu = menuNavigation(routes, locale);
  const rows = menu.groups.flatMap((group) =>
    group.rows.map((row): SearchAction => ({
      id: row.id,
      label: row.label,
      /* Perps say whose they are and what they let a person do now, as the menu's row does (UX-365). */
      hint: group.id === "home" ? null : row.id === "futures" ? `${group.label} · Phoenix · ${FUTURES_NOW[locale]}` : group.label,
      href: row.href,
      icon: ROW_ICONS[row.id] ?? row.icon,
      words: WORDS[row.id] ?? [],
    })),
  );
  const drawn = new Set(rows.map((row) => row.id));
  const under = UNDER.filter((page) => drawn.has(page.row)).map((page): SearchAction => ({
    id: page.id,
    label: page.label[locale],
    hint: MENU_SECTIONS[page.row].label[locale],
    href: page.href,
    icon: page.icon,
    words: WORDS[page.id] ?? [],
  }));
  return [
    ...rows,
    ...under,
    /* «Запустити токен», the Launch page's own action — found by name, hinted by its row. */
    { id: "launch-new", label: MENU_ACTION.label[locale], hint: MENU_SECTIONS.launch.label[locale], href: MENU_ACTION.href, icon: MENU_ACTION.icon, words: WORDS["launch-new"] },
    { id: ALERTS.id, label: ALERTS.label[locale], hint: ALERTS.hint[locale], href: ALERTS.href, icon: ALERTS.icon, words: WORDS.alerts },
    { id: "customize", label: CUSTOMIZE.label[locale], hint: CUSTOMIZE.hint[locale], href: CUSTOMIZE_HREF, icon: "customize", words: WORDS.customize },
    { id: "settings", label: menu.settings.label, hint: null, href: menu.settings.href, icon: "account", words: WORDS.settings },
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

/** The groups' order when their best matches tie: actions, companies, private companies, coins. */
const GROUP_ORDER: readonly SearchGroupId[] = ["actions", "companies", "privateCompanies", "coins"];

/**
 * The groups in the order of their best match (UX-002): a group whose best answer is better stands higher, a tie keeps
 * {@link GROUP_ORDER}. «SOL» finds Solana by its whole ticker (5) and no action any more, so Enter opens Solana; «swap»
 * finds the action by its whole word (5) before a coin that merely starts with it.
 */
function groupOrder(best: Readonly<Record<SearchGroupId, number>>): readonly SearchGroupId[] {
  return [...GROUP_ORDER].sort((a, b) => best[b] - best[a] || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
}

/**
 * The matches for one query, in the order a person scans them — the group with
 * the best match first ({@link groupOrder}). An empty query offers the starter
 * actions and nothing else — a search box is not a second shelf.
 */
export function searchProduct(index: SearchIndex | null, actions: readonly SearchAction[], query: string): SearchResults {
  const needle = normalize(query);
  const address = addressOf(query);
  if (needle.length === 0) {
    return {
      address: null,
      order: GROUP_ORDER,
      actions: STARTERS.flatMap((id) => actions.filter((action) => action.id === id)).slice(0, RESULT_LIMITS.actions + 1),
      companies: [],
      privateCompanies: [],
      coins: [],
    };
  }
  const scored = actions
    .map((action) => ({ action, score: actionScore(action, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const found = scored
    .map((entry) => entry.action)
    /* One answer per place: a section and its first tab open the same page, and the better match of the two is kept. */
    .filter((action, index, all) => all.findIndex((other) => other.href === action.href) === index)
    .slice(0, RESULT_LIMITS.actions);
  const bestAction = scored[0]?.score ?? 0;
  if (!index) return { address, order: GROUP_ORDER, actions: found, companies: [], privateCompanies: [], coins: [] };
  const coins: SearchCoin[] = [
    ...index.dollars.map((coin) => ({ ...coin, kind: "dollar" as const })),
    ...index.coins.map((coin) => ({ ...coin, kind: "crypto" as const })),
    ...index.memes.map((coin) => ({ ...coin, kind: "meme" as const })),
  ];
  const seen = new Set<string>();
  const companies = matchCards(index.companies, needle).slice(0, RESULT_LIMITS.companies);
  const privateCompanies = matchCards(index.privateCompanies, needle).slice(0, RESULT_LIMITS.privateCompanies);
  const coinMatches = coins
    .map((coin) => ({ coin, score: nameScore(coin.name, coin.symbol, needle, coin.mint) }))
    .filter((entry) => entry.score > 0 && !seen.has(entry.coin.mint) && seen.add(entry.coin.mint))
    .sort((a, b) => b.score - a.score || b.coin.volume24h - a.coin.volume24h)
    .slice(0, RESULT_LIMITS.coins);
  const cardBest = (cards: readonly ShelfCard[]) => (cards[0] ? nameScore(cards[0].name, cards[0].ticker, needle, cards[0].mint) : 0);
  return {
    address,
    order: groupOrder({ actions: bestAction, companies: cardBest(companies), privateCompanies: cardBest(privateCompanies), coins: coinMatches[0]?.score ?? 0 }),
    actions: found,
    companies,
    privateCompanies,
    coins: coinMatches.map((entry) => entry.coin),
  };
}

/** Whether a stored or answered value is an index this module can read. */
export function isSearchIndex(value: unknown): value is SearchIndex {
  if (typeof value !== "object" || value === null) return false;
  const index = value as Record<string, unknown>;
  return ["companies", "privateCompanies", "coins", "memes", "dollars"].every((key) => Array.isArray(index[key]));
}
