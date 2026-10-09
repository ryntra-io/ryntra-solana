/**
 * The pages of Ryntra, the sections of the menu that hold them, and the only
 * place their order is decided.
 *
 * **The menu v6.2, since 2026-10-06.** One menu for everyone, from the sections already on production:
 * on a desk «+ Запустити токен» on top, then Головна · Ринки — Торгувати ·
 * Лаунч · Боти — Портфель · Гроші · Винагороди in three groups without
 * headings, each row with its caption; the assistant Ryntra in the header; on a
 * phone Головна · Ринки · + · Портфель · Ще ({@link menuNavigation},
 * {@link mobileNavigation}). A section's pages are tabs at the top of its page
 * ({@link sectionTabs}). There is no «Простий»/«Профі» switch (since
 * 2026-09-24), and the fifteen registered pages stay the product's capability
 * modules: each lives in exactly one section ({@link MENU_SECTIONS}).
 *
 * **PLANNED is hidden everywhere a person reads** (since 2026-09-23).
 * A planned page stays registered here as a target,
 * and is neither a row nor a destination: its address leads to a page that
 * works (`lib/product/customer-routing.ts`), and no word for «not yet» exists
 * in this file to draw. BUILDING is visible only with a useful action on the
 * page.
 *
 * ## Four rules this file enforces rather than describes
 *
 * **A page with no route does not exist.** {@link menuNavigation} throws
 * rather than emitting an entry whose `href` is empty. A hand-written rail
 * beside the registry was the root cause of the `Soon` defect — rows that
 * looked like product somebody forgot to finish. There is no `href: null`
 * branch for a page here and no place to add one.
 *
 * **Readiness is declared once and read everywhere.** A page carries exactly
 * one of `available | building | planned`; the rail and a place decide from
 * it whether the page is drawn, and the page states it. Neither owns the
 * answer alone.
 *
 * **One projection, taking nothing but the routes and a language.** The
 * menu does not depend on who is looking, on a stored preference or on a
 * cookie: the same five places are drawn for a guest, for a person with a
 * wallet and for a person who once chose «Профі».
 *
 * **Both languages live here, not in a translator that throws.**
 * `translateSolana` is fail-closed by design — a missing Ukrainian key raises,
 * which is correct for prose a person reads and catastrophic for a rail, where
 * one absent string would 500 Ukrainian navigation on every page of the
 * product. Nothing in this file can throw for want of a translation.
 */

/**
 * The four kinds of work a page does, in the order the product first named them.
 *
 * Since 2026-09-24 they are no longer a menu — the five places are — but they
 * are still what a page *is*, and the API's capabilities carry a page's kind
 * as its `group` (contract field), so a client that read it keeps reading the
 * same four words.
 */
export const PRODUCT_GROUP_IDS = ["trade", "strategies", "money", "manage"] as const;

export type ProductGroupId = (typeof PRODUCT_GROUP_IDS)[number];

/**
 * The registered pages, in the order the product built them.
 *
 * `my-strategies` rather than `strategies` because the kind of work is already
 * called that, and an id that means two things at two levels is how a rail
 * comes to light the wrong row. `activity` keeps its id under the label
 * History for the same reason a route keeps its address: identifiers are not
 * words a person reads.
 */
export const PRODUCT_PAGE_IDS = [
  "swap",
  "spot",
  "stocks",
  "trends",
  "perps",
  "predictions",
  "ideas",
  "my-strategies",
  "results",
  "send",
  "receive",
  "bridge",
  "rewards",
  "portfolio",
  "activity",
] as const;

export type ProductPageId = (typeof PRODUCT_PAGE_IDS)[number];

/** The kind of work each page does. Every page has exactly one. */
export const PAGE_GROUP: Readonly<Record<ProductPageId, ProductGroupId>> = {
  swap: "trade",
  spot: "trade",
  stocks: "trade",
  trends: "trade",
  perps: "trade",
  predictions: "trade",
  ideas: "strategies",
  "my-strategies": "strategies",
  results: "strategies",
  send: "money",
  receive: "money",
  bridge: "money",
  rewards: "money",
  portfolio: "manage",
  activity: "manage",
};

export type ProductLocale = "en" | "uk";

export type DomainLabel = Readonly<{ en: string; uk: string }>;

/**
 * How finished a page is, in the product's own three-status vocabulary.
 *
 * `available` — a verified capability the person can carry out here.
 * `building`  — real implementation of a defined capability with a useful
 *               action already on the page; never a live execute button over
 *               invented numbers.
 * `planned`   — an agreed page with no confirmed implementation behind it.
 *               Registered, served, stated on itself — and not a row.
 *
 * There is deliberately no fourth value. `Exploring` is a research state that
 * does not reach the product menu, and `Design preview` is a caption on a
 * mock-up rather than a status of a page.
 */
export type PageReadiness = "available" | "building" | "planned";

/** The four kinds' words, for the surfaces that name a page's kind. */
export const GROUP_LABELS: Readonly<Record<ProductGroupId, DomainLabel>> = {
  trade: { en: "Trade", uk: "Торгівля" },
  strategies: { en: "Strategies", uk: "Стратегії" },
  money: { en: "Money", uk: "Кошти" },
  manage: { en: "Manage", uk: "Керування" },
};

/**
 * The settled vocabulary. These names are decided and are not
 * reopened during implementation.
 *
 * `History / Історія` is the product's word for the record of what a wallet
 * did here. `Activity` was the English label until 2026-09-14
 * and is retired with `Операції` and `Активність`; the id and the address stay.
 *
 * `My strategies` keeps its first word. It is not a catalogue of strategies
 * somebody could adopt; it is the person's own plans, drafts and the decisions
 * waiting on them, and dropping `My` turns a workspace into a directory.
 */
export const PAGE_LABELS: Readonly<Record<ProductPageId, DomainLabel>> = {
  swap: { en: "Swap", uk: "Обмін" },
  spot: { en: "Spot", uk: "Спот" },
  /* «Акції»: the page is about tokenized stocks and ETFs, and the Ukrainian
     word for shares is the one a person already owns. RWA beyond equities
     stays a category word inside the page, not part of its name. */
  stocks: { en: "Stocks", uk: "Акції" },
  trends: { en: "Trends", uk: "Тренди" },
  perps: { en: "Perps", uk: "Безстрокові" },
  /* «Прогнози»: the page is about markets on outcomes, and the Ukrainian word
     for a forecast is the one a person already owns. */
  predictions: { en: "Predictions", uk: "Прогнози" },
  ideas: { en: "Ideas", uk: "Ідеї" },
  "my-strategies": { en: "My strategies", uk: "Мої стратегії" },
  results: { en: "Results", uk: "Результати" },
  send: { en: "Send", uk: "Надіслати" },
  receive: { en: "Receive", uk: "Отримати" },
  /* «Міст» rather than a transliterated «Бридж»: the Ukrainian word is the one
     a person already owns, and the page is named after what somebody wants done
     rather than after the mechanism that does it. */
  bridge: { en: "Bridge", uk: "Міст" },
  rewards: { en: "Rewards", uk: "Винагороди" },
  portfolio: { en: "Portfolio", uk: "Портфель" },
  activity: { en: "History", uk: "Історія" },
};

/** Secondary destinations, named here so they are never invented at a call site. */
export const SECONDARY_LABELS = {
  settings: { en: "Settings", uk: "Налаштування" },
  productMap: { en: "Product Map", uk: "Карта продукту" },
  developers: { en: "Developers", uk: "Розробникам" },
} as const;

export type PageRoute = Readonly<{
  id: ProductPageId;
  /** Where the page opens. Never empty — see {@link productNavigation}. */
  href: string;
  /** The icon the rail draws. */
  icon: string;
  /** How finished this page is, in the product's three-status vocabulary. */
  readiness: PageReadiness;
  /**
   * Every route this page owns, landing included.
   *
   * A page is a place, not a URL, and without this the rail lights the wrong
   * row: Swap owns `/app/trade`, the address its own form answered to before it
   * was named Swap, so a person arriving on an old link sees **Swap** marked
   * current rather than nothing at all. Old routes stay reachable and land
   * under the page that owns them now.
   */
  match: readonly string[];
}>;

export type ProductNavEntry = Readonly<{
  id: ProductPageId;
  label: string;
  href: string;
  icon: string;
  readiness: PageReadiness;
}>;

/**
 * Words this product does not use, kept here so a test can assert their absence
 * rather than a reviewer having to remember them.
 *
 * `Workspace` and `Ecosystems` describe the model the one-product decision
 * replaced. `Operations` and `Activity` are English labels retired in favour of
 * `History`. `Passport` and `Agents` are names the product removed from the menu
 * — their functions moved into asset detail, Portfolio and My strategies, and
 * a row carrying one of those words would mean the move did not happen.
 * `Home` and «Ринки» came back as two of the five places,
 * so neither is listed here any more.
 */
export const FORBIDDEN_NAV_WORDS: readonly string[] = [
  "Workspace",
  "Workspaces",
  "Ecosystem",
  "Ecosystems",
  "Operations",
  "Activity",
  "Passport",
  "Agents",
  "Активність",
  "Операції",
  /* «Гроші» left this list on 2026-09-24: it is now
     the caption of the menu's section Поповнити · Надіслати · Отримати ·
     Міст. The API's kind of work keeps «Кошти» (`GROUP_LABELS`). */
  "Агенти",
  "Паспорт",
];

/**
 * Pages kept off every surface a person reads — built,
 * and not shown (since 2026-09-24: the prediction demo). Their code,
 * their API and their records stay; their address leads to a page that works
 * (`lib/product/customer-routing.ts`); no menu, place, tab, search or
 * documentation draws them. Coming back is a new product decision, and it
 * is one line here.
 */
export const OFF_SURFACE: ReadonlySet<ProductPageId> = new Set<ProductPageId>(["predictions"]);

/** Whether a page may be drawn: registered, built and on the surface. */
export function drawn(route: Pick<PageRoute, "id" | "readiness">): boolean {
  return route.readiness !== "planned" && !OFF_SURFACE.has(route.id);
}

function projectPages(routes: readonly PageRoute[], locale: ProductLocale): readonly ProductNavEntry[] {
  const byId = new Map(routes.map((route) => [route.id, route]));
  return PRODUCT_PAGE_IDS.map((id) => {
    const route = byId.get(id);
    if (!route) {
      throw new Error(`Ryntra page "${id}" has no route. Every page opens somewhere; register it in the product routes.`);
    }
    if (!route.href || route.href.trim().length === 0) {
      throw new Error(`Ryntra page "${id}" has an empty route. A page with no destination is not a page.`);
    }
    return {
      id,
      label: PAGE_LABELS[id][locale],
      href: route.href,
      icon: route.icon,
      readiness: route.readiness,
    };
  });
}

/**
 * Every registered page, flat, in the registry's order — planned ones included.
 *
 * For the surfaces that describe the registry rather than draw the menu: the
 * documentation's page table and the Academy's structure lesson say what is
 * registered and how ready it is. The menu is {@link productNavigation}.
 */
export function registeredPages(
  routes: readonly PageRoute[],
  locale: ProductLocale,
): readonly ProductNavEntry[] {
  return projectPages(routes, locale);
}

/**
 * Which page a path belongs to, by longest owned prefix.
 *
 * Returns the page's **landing href**, so the caller marks the row a person
 * would press to get here rather than the sub-route they happen to be on. Match
 * is on segment boundaries, never characters: `/x/send` is not inside
 * `/x/sender`. Anything with a landing and owned routes can be asked — the
 * registry's pages, or the five places. A tie goes to the earlier route, so a
 * route is owned by one row only.
 */
export function pageActiveHref(
  pathname: string,
  routes: readonly Pick<PageRoute, "href" | "match">[],
): string | null {
  let best: Pick<PageRoute, "href" | "match"> | null = null;
  let bestLength = -1;
  for (const route of routes) {
    for (const owned of route.match) {
      if (pathname !== owned && !pathname.startsWith(`${owned}/`)) continue;
      if (owned.length > bestLength) {
        best = route;
        bestLength = owned.length;
      }
    }
  }
  return best ? best.href : null;
}

/* --------------------------------------------------------------- the menu */

/**
 * The menu v6.2, built from the sections already on
 * production: on a desk «+ Запустити токен» on top in a quiet style — the one
 * orange action stays the screen's — then three groups without headings,
 * divided by thin lines: Головна · Ринки — Торгувати · Лаунч · Боти —
 * Портфель · Гроші · Винагороди, each row with its caption; Відгук and
 * Налаштування at the foot. The assistant Ryntra is not a row: it is «Спитати
 * Ryntra» in the header, with the screen as its context. Pools and Perps are
 * not sections until their tasks are on production.
 *
 * A section's pages are tabs at the top of its page, one component everywhere
 * ({@link sectionTabs}): Торгувати — Спот · Обмін; Лаунч — Запустити токен ·
 * Мої лаунчі; Боти — Мої боти · Каталог; Портфель — Позиції · Історія; Гроші —
 * Поповнити · Надіслати · Отримати · Між мережами. Ринки is one page, the
 * screener, with its own tabs over one table.
 *
 * On a phone five places — Головна · Ринки · + · Портфель · Ще — and «Ще»
 * opens Торгувати, Боти, Гроші, Винагороди, Ryntra and Налаштування
 * ({@link mobileNavigation}).
 */
export const MENU_SECTION_IDS = ["home", "markets", "trade", "launch", "bots", "portfolio", "money", "rewards"] as const;

export type MenuSectionId = (typeof MENU_SECTION_IDS)[number];

/** The three groups, in order, without headings: a thin line stands between them. */
export const MENU_GROUPS: readonly Readonly<{ id: string; sections: readonly MenuSectionId[] }>[] = [
  { id: "discover", sections: ["home", "markets"] },
  { id: "act", sections: ["trade", "launch", "bots"] },
  { id: "own", sections: ["portfolio", "money", "rewards"] },
];

/** One tab at the top of a section's page. `page` binds it to a registered page, so a page that is not drawn is not a tab. */
export type MenuTab = Readonly<{
  id: string;
  label: DomainLabel;
  href: string;
  /** Every route the tab stands for, its landing included. */
  match: readonly string[];
  page?: ProductPageId;
}>;

export type MenuSectionDef = Readonly<{
  label: DomainLabel;
  /** A second line that says what the section holds. Home carries none until it is Pulse. */
  caption?: DomainLabel;
  href: string;
  icon: string;
  /** Every route the section stands for — its tabs' and the old addresses that lead into it. */
  match: readonly string[];
  /** The registered pages it holds, so every page lives in exactly one section. */
  pages: readonly ProductPageId[];
  tabs?: readonly MenuTab[];
}>;

export const MENU_SECTIONS: Readonly<Record<MenuSectionId, MenuSectionDef>> = {
  home: { label: { en: "Home", uk: "Головна" }, href: "/app/home", icon: "home", match: ["/app/home"], pages: [] },
  /* One screener for every asset: a company's page and an asset's page stand under it, and the two lists it
     replaced — the stock screener and Trends — lead into it. */
  markets: {
    label: { en: "Markets", uk: "Ринки" },
    caption: { en: "Stocks, crypto, memes", uk: "Акції, крипта, меми" },
    href: "/app/markets",
    icon: "explore",
    match: ["/app/markets", "/app/stocks", "/app/trends", "/app/assets"],
    pages: ["stocks", "trends", "predictions"],
  },
  trade: {
    label: { en: "Trade", uk: "Торгувати" },
    caption: { en: "Spot and swap", uk: "Спот і обмін" },
    href: "/app/spot",
    icon: "trade",
    match: ["/app/spot", "/app/swap", "/app/trade"],
    pages: ["spot", "swap", "perps"],
    tabs: [
      { id: "spot", label: { en: "Spot", uk: "Спот" }, href: "/app/spot", match: ["/app/spot"], page: "spot" },
      { id: "swap", label: { en: "Swap", uk: "Обмін" }, href: "/app/swap", match: ["/app/swap", "/app/trade"], page: "swap" },
    ],
  },
  /* Ryntra Launch: the form opens it; «Лаунчі на Ryntra» — every market launched on Ryntra, no wallet — and «Мої лаунчі» are tabs beside it; every launch's page stands under it. */
  launch: {
    label: { en: "Launch", uk: "Лаунч" },
    caption: { en: "Your token", uk: "Свій токен" },
    href: "/app/launch/new",
    icon: "launch",
    match: ["/app/launch"],
    pages: [],
    tabs: [
      { id: "launch-new", label: { en: "Launch a token", uk: "Запустити токен" }, href: "/app/launch/new", match: ["/app/launch/new"] },
      { id: "launch-markets", label: { en: "Launches on Ryntra", uk: "Лаунчі на Ryntra" }, href: "/app/launch/markets", match: ["/app/launch/markets"] },
      { id: "launch-mine", label: { en: "My launches", uk: "Мої лаунчі" }, href: "/app/launch/mine", match: ["/app/launch/mine"] },
    ],
  },
  /* Everything that runs on a person's rule: «Мої боти» gathers the recurring-buy rules and the plans with
     their results; «Каталог» holds what can be set up. The plan builder and a plan's page stand under «Мої боти». */
  bots: {
    label: { en: "Bots", uk: "Боти" },
    caption: { en: "Recurring buys, plans", uk: "Регулярна купівля, плани" },
    href: "/app/bots",
    icon: "bots",
    match: ["/app/bots", "/app/strategies", "/app/plans", "/app/results", "/app/journal", "/app/brief", "/app/coverage", "/app/action-cases", "/app/control", "/app/agents", "/app/autoinvest"],
    pages: ["my-strategies", "results"],
    tabs: [
      {
        id: "bots-mine",
        label: { en: "My bots", uk: "Мої боти" },
        href: "/app/bots",
        match: ["/app/bots", "/app/strategies", "/app/plans", "/app/action-cases", "/app/control", "/app/agents"],
        page: "my-strategies",
      },
      { id: "bots-catalog", label: { en: "Catalog", uk: "Каталог" }, href: "/app/bots/catalog", match: ["/app/bots/catalog"] },
    ],
  },
  portfolio: {
    label: { en: "Portfolio", uk: "Портфель" },
    caption: { en: "Positions and history", uk: "Позиції й історія" },
    href: "/app/portfolio",
    icon: "portfolio",
    match: ["/app/portfolio", "/app/activity", "/app/receipts"],
    pages: ["portfolio", "activity"],
    tabs: [
      { id: "positions", label: { en: "Positions", uk: "Позиції" }, href: "/app/portfolio", match: ["/app/portfolio"], page: "portfolio" },
      { id: "history", label: { en: "History", uk: "Історія" }, href: "/app/activity", match: ["/app/activity", "/app/receipts"], page: "activity" },
    ],
  },
  /* One page with four tabs; each keeps its address. */
  money: {
    label: { en: "Money", uk: "Гроші" },
    caption: { en: "Top up and transfers", uk: "Поповнення й перекази" },
    href: "/app/top-up",
    icon: "money",
    match: ["/app/top-up", "/app/send", "/app/receive", "/app/bridge"],
    pages: ["send", "receive", "bridge"],
    tabs: [
      { id: "top-up", label: { en: "Top up", uk: "Поповнити" }, href: "/app/top-up", match: ["/app/top-up"] },
      { id: "send", label: { en: "Send", uk: "Надіслати" }, href: "/app/send", match: ["/app/send"], page: "send" },
      { id: "receive", label: { en: "Receive", uk: "Отримати" }, href: "/app/receive", match: ["/app/receive"], page: "receive" },
      { id: "bridge", label: { en: "Cross-chain", uk: "Між мережами" }, href: "/app/bridge", match: ["/app/bridge"], page: "bridge" },
    ],
  },
  rewards: {
    label: { en: "Rewards", uk: "Винагороди" },
    caption: { en: "Points, leaderboards, season", uk: "Бали, таблиці, сезон" },
    href: "/app/rewards",
    icon: "rewards",
    match: ["/app/rewards"],
    pages: ["rewards"],
  },
};

/** The section that holds each registered page — read off {@link MENU_SECTIONS}, never written twice. Ideas is the assistant's. */
export const PAGE_SECTION: Readonly<Partial<Record<ProductPageId, MenuSectionId>>> = Object.freeze(
  Object.fromEntries(MENU_SECTION_IDS.flatMap((section) => MENU_SECTIONS[section].pages.map((page) => [page, section] as const))),
) as Readonly<Partial<Record<ProductPageId, MenuSectionId>>>;

/** The assistant: «Спитати Ryntra» in the header on a desk, a row of «Ще» on a phone. Its older names lead here. */
export const ASSISTANT = {
  label: { en: "Ryntra", uk: "Ryntra" },
  caption: { en: "AI assistant", uk: "ШІ-помічник" },
  ask: { en: "Ask Ryntra", uk: "Спитати Ryntra" },
  href: "/app/ryn",
  icon: "ryntra",
  match: ["/app/ryn", "/app/ideas", "/app/research", "/app/adviser"],
  pages: ["ideas"] as readonly ProductPageId[],
} as const;

/** «+ Запустити токен» — on top of the menu on a desk, «+» in the middle of the phone's bar. */
export const MENU_ACTION = {
  label: { en: "Launch a token", uk: "Запустити токен" },
  short: { en: "Launch", uk: "Лаунч" },
  href: "/app/launch/new",
  icon: "launch-plus",
} as const;

/** The foot of the menu: Відгук is a dialog the shell draws; Settings is a row. */
export const MENU_FOOT = {
  feedback: { en: "Feedback", uk: "Відгук" },
  settings: { label: SECONDARY_LABELS.settings, href: "/app/settings", icon: "settings", match: ["/app/settings"] },
} as const;

export type MenuRow = Readonly<{
  /** A section's id, `agent` or `settings`. */
  id: string;
  label: string;
  caption?: string;
  href: string;
  icon: string;
}>;

export type MenuSection = Readonly<{ id: MenuSectionId; title: null; rows: readonly MenuRow[] }>;

export type MenuGroup = Readonly<{ id: string; rows: readonly MenuRow[] }>;

export type MenuNavigation = Readonly<{
  /** «+ Запустити токен». */
  action: Readonly<{ label: string; href: string; icon: string }>;
  /** The three groups, in order. */
  groups: readonly MenuGroup[];
  /** The same rows one section at a time — for the surfaces that list sections (search, documentation). */
  sections: readonly MenuSection[];
  /** The assistant's row, drawn in «Ще» on a phone only. */
  assistant: MenuRow;
  settings: MenuRow;
  feedbackLabel: string;
  /** Every row's landing and the routes it owns, for `pageActiveHref`. */
  routes: readonly Pick<PageRoute, "href" | "match">[];
}>;

/** Whether a section is drawn: one with no registered page is a destination of its own; otherwise one of its pages must be drawn. */
function sectionDrawn(section: MenuSectionDef, byId: ReadonlyMap<string, ProductNavEntry>): boolean {
  if (section.pages.length === 0) return true;
  return section.pages.some((id) => {
    const page = byId.get(id);
    return page !== undefined && drawn(page);
  });
}

/**
 * The menu, from the routes and a language and nothing else: a section whose
 * pages are all planned or off the surface is not a row, and a page missing
 * from `routes` throws, as everywhere in this file.
 */
export function menuNavigation(routes: readonly PageRoute[], locale: ProductLocale): MenuNavigation {
  const pages = new Map<string, ProductNavEntry>(projectPages(routes, locale).map((page) => [page.id, page]));
  const row = (id: MenuSectionId): MenuRow => {
    const section = MENU_SECTIONS[id];
    return { id, label: section.label[locale], caption: section.caption?.[locale], href: section.href, icon: section.icon };
  };
  const shown = (id: MenuSectionId) => sectionDrawn(MENU_SECTIONS[id], pages);
  const groups = MENU_GROUPS.flatMap((group): MenuGroup[] => {
    const rows = group.sections.filter(shown).map(row);
    return rows.length === 0 ? [] : [{ id: group.id, rows }];
  });
  const assistant: MenuRow = { id: "agent", label: ASSISTANT.label[locale], caption: ASSISTANT.caption[locale], href: ASSISTANT.href, icon: ASSISTANT.icon };
  return {
    action: { label: MENU_ACTION.label[locale], href: MENU_ACTION.href, icon: MENU_ACTION.icon },
    groups,
    sections: MENU_SECTION_IDS.filter(shown).map((id) => ({ id, title: null, rows: [row(id)] })),
    assistant,
    settings: { id: "settings", label: MENU_FOOT.settings.label[locale], href: MENU_FOOT.settings.href, icon: MENU_FOOT.settings.icon },
    feedbackLabel: MENU_FOOT.feedback[locale],
    routes: [
      ...MENU_SECTION_IDS.filter(shown).map((id) => ({ href: MENU_SECTIONS[id].href, match: MENU_SECTIONS[id].match })),
      { href: ASSISTANT.href, match: ASSISTANT.match },
      { href: MENU_FOOT.settings.href, match: MENU_FOOT.settings.match },
    ],
  };
}

export type SectionTabs = Readonly<{
  section: MenuSectionId;
  title: string;
  tabs: readonly Readonly<{ id: string; label: string; href: string }>[];
  /** The tab the path stands on. */
  current: string;
}>;

/**
 * The tabs at the top of the page a path stands on, or null where the section
 * has none or the path is none of its tabs' (a launched token's page, a
 * company's page). A tab bound to a page that is not drawn is not a tab.
 */
export function sectionTabs(pathname: string, routes: readonly PageRoute[], locale: ProductLocale): SectionTabs | null {
  const pages = new Map<string, ProductNavEntry>(projectPages(routes, locale).map((page) => [page.id, page]));
  for (const id of MENU_SECTION_IDS) {
    const section = MENU_SECTIONS[id];
    if (!section.tabs) continue;
    const tabs = section.tabs.filter((tab) => {
      if (!tab.page) return true;
      const page = pages.get(tab.page);
      return page !== undefined && drawn(page);
    });
    const current = pageActiveHref(pathname, tabs);
    if (current === null) continue;
    return { section: id, title: section.label[locale], tabs: tabs.map((tab) => ({ id: tab.id, label: tab.label[locale], href: tab.href })), current };
  }
  return null;
}

export type MobileNavEntry = Readonly<{
  id: string;
  label: string;
  /** Null for `more`, which opens the menu rather than navigating. */
  href: string | null;
  icon: string;
  /** The landing hrefs this column stands for — its own, and for «Ще» every row it opens. */
  matches: readonly string[];
  /** The middle «+»: the launch of a token, drawn as an action rather than a place. */
  action?: boolean;
}>;

/** The sections the phone's bar holds; every other row opens from «Ще». */
export const PHONE_BAR_SECTIONS: readonly MenuSectionId[] = ["home", "markets", "portfolio"];

/**
 * The phone's five: Головна · Ринки · + · Портфель · Ще. «Ще» opens the menu,
 * which on a phone draws Торгувати, Боти, Гроші, Винагороди, Ryntra and
 * Налаштування — the rows the bar does not hold.
 */
export function mobileNavigation(routes: readonly PageRoute[], locale: ProductLocale): readonly MobileNavEntry[] {
  const menu = menuNavigation(routes, locale);
  const rows = menu.groups.flatMap((group) => group.rows);
  const place = (id: MenuSectionId): MobileNavEntry[] => {
    const found = rows.find((entry) => entry.id === id);
    return found ? [{ id, label: found.label, href: found.href, icon: found.icon, matches: [found.href] }] : [];
  };
  const inMore = rows.filter((entry) => !PHONE_BAR_SECTIONS.includes(entry.id as MenuSectionId) && entry.id !== "launch");
  return [
    ...place("home"),
    ...place("markets"),
    { id: "launch", label: MENU_ACTION.short[locale], href: MENU_ACTION.href, icon: MENU_ACTION.icon, matches: [MENU_SECTIONS.launch.href], action: true },
    ...place("portfolio"),
    {
      id: "more",
      label: locale === "uk" ? "Ще" : "More",
      href: null,
      icon: "more",
      matches: [...inMore.map((entry) => entry.href), menu.assistant.href, menu.settings.href],
    },
  ];
}
