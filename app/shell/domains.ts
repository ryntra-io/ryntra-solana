/**
 * The pages of Ryntra, the five places they live in, and the only place their
 * order is decided.
 *
 * **Canon v5.3, adopted 2026-09-24 (MASTER-PLAN В28, §0.0 rule 9, §3).** One
 * version for everyone: one menu of five places — Головна · Ринки · Ryntra ·
 * Портфель · Ще (Home · Markets · Agent · Portfolio · More) — the same on the
 * web and on a phone, for every person and every guest. There is no
 * «Простий»/«Профі» switch. What «Профі» held lives a tap deeper in the same
 * places ({@link PLACE_PAGES}): Spot, the stock screener and Trends in
 * Markets' «Для досвідчених»; My strategies, Results and History in Portfolio;
 * Swap, Bridge, Send, Receive, Rewards and the prediction demo in «Ще».
 *
 * The fifteen pages stay registered here in the order the product built them,
 * and every one of them lives in exactly one place. A place's own page draws
 * the pages it holds ({@link placePages}) — Markets as its «Для досвідчених»
 * row, Portfolio as its tabs; the phone's bar is the five places
 * ({@link mobileNavigation}).
 *
 * **Canon v5.4, adopted 2026-09-24 (evening, В30).** The menu is one you can
 * see: on a desk every section with its caption and nothing behind «Ще» —
 * Головна · Інвестувати · Торгувати · Гроші · Портфель · Ryntra —
 * ШІ-помічник · Винагороди — and on a phone «Ще» opens the same sections
 * ({@link menuNavigation}). The prediction demo is off the surface
 * ({@link OFF_SURFACE}).
 *
 * **PLANNED is hidden everywhere a person reads** (canon v5.0 §0.0 rule 10,
 * 2026-09-23). A planned page stays registered here as the Owner's target,
 * and is neither a row nor a destination: its address leads to a page that
 * works (`lib/product/customer-routing.ts`), and no word for «not yet» exists
 * in this file to draw. BUILDING is visible only with a useful action on the
 * page.
 *
 * ## Four rules this file enforces rather than describes
 *
 * **A page with no route does not exist.** {@link productNavigation} throws
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
 * The four kinds of work a page does, in the order canon v4.0 named them.
 *
 * Since canon v5.3 they are no longer a menu — the five places are — but they
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
 * How finished a page is, in the canon's own vocabulary (§3.3).
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
 * The settled vocabulary. These names are an owner decision and are not
 * reopened during implementation.
 *
 * `History / Історія` is the canon v4.0 word for the record of what a wallet
 * did here (§5.1, §11.2). `Activity` was the English label until 2026-09-14
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
  /** How finished this page is, in the canon's three-status vocabulary. */
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
 * `History`. `Passport` and `Agents` are names the canon removed from the menu
 * — their functions moved into asset detail, Portfolio and My strategies, and
 * a row carrying one of those words would mean the move did not happen.
 * `Home` and «Ринки» came back with canon v5.0 §3 as two of the five places,
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
  /* «Гроші» left this list with canon v5.4 (В30, 2026-09-24): the Owner named
     it as the caption of the menu's section Поповнити · Надіслати · Отримати ·
     Міст. The API's kind of work keeps «Кошти» (`GROUP_LABELS`). */
  "Агенти",
  "Паспорт",
];

/**
 * Pages kept off every surface a person reads, by the Owner's word — built,
 * and not shown (canon v5.4 В32, 2026-09-24: the prediction demo). Their code,
 * their API and their records stay; their address leads to a page that works
 * (`lib/product/customer-routing.ts`); no menu, place, tab, search or
 * documentation draws them. Coming back is a new word of the Owner's, and it
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

/* ------------------------------------------------------------- the places */

/**
 * The five places, in the canon's order (canon v5.0 §3, one version since
 * v5.3): Головна · Ринки · Ryntra · Портфель · Ще. The internal names are the
 * phone's (decision F1 of 2026-09-17): Home · Markets · Agent · Portfolio ·
 * More.
 */
export const PLACE_IDS = ["home", "markets", "agent", "portfolio", "more"] as const;

export type PlaceId = (typeof PLACE_IDS)[number];

/**
 * The places' words. The third place carries the product's own name in both
 * languages — the assistant is Ryntra wherever a person reads (the Owner,
 * 2026-09-23: no «Ryn» persona) — so it is the one label that is the same in
 * English and Ukrainian, on purpose.
 */
export const PLACE_LABELS: Readonly<Record<PlaceId, DomainLabel>> = {
  home: { en: "Home", uk: "Головна" },
  markets: { en: "Markets", uk: "Ринки" },
  agent: { en: "Ryntra", uk: "Ryntra" },
  portfolio: { en: "Portfolio", uk: "Портфель" },
  more: { en: "More", uk: "Ще" },
};

/**
 * The pages each place holds, in the order the place draws them (canon v5.3
 * В28, §3). Every registered page lives in exactly one place.
 *
 * - **Markets** — «Для досвідчених»: Spot with the chart and the ticket, the
 *   stock screener, Trends with crypto and memes; Perps when it is built.
 * - **Ryntra** — Ideas is the assistant's, and not built as a page.
 * - **Portfolio** — the positions, My strategies (the full plan, versions and
 *   journal), Results and History.
 * - **«Ще»** — Swap, Bridge, Send, Receive, Rewards and the prediction demo,
 *   in the order the Owner named them on 2026-09-24.
 *
 * Home holds no registered page: its own page and «Поповнити» are its.
 */
export const PLACE_PAGES: Readonly<Record<PlaceId, readonly ProductPageId[]>> = {
  home: [],
  markets: ["spot", "stocks", "trends", "perps"],
  agent: ["ideas"],
  portfolio: ["portfolio", "my-strategies", "results", "activity"],
  more: ["swap", "bridge", "send", "receive", "rewards", "predictions"],
};

/** Which place holds each page — read off {@link PLACE_PAGES}, never written twice. */
export const PAGE_PLACE: Readonly<Record<ProductPageId, PlaceId>> = Object.freeze(
  Object.fromEntries(PLACE_IDS.flatMap((place) => PLACE_PAGES[place].map((page) => [page, place] as const))),
) as Readonly<Record<ProductPageId, PlaceId>>;

/**
 * A page named differently inside its place. Inside Portfolio the tabs read
 * Позиції · Стратегії · Результати · Історія — the place already says whose
 * they are; in Markets' «Для досвідчених» row the stock screener is «Скринер»
 * (canon v5.4 В33: «Спот, Скринер, Тренди»).
 */
export const IN_PLACE_LABELS: Readonly<Partial<Record<ProductPageId, DomainLabel>>> = {
  stocks: { en: "Screener", uk: "Скринер" },
  portfolio: { en: "Positions", uk: "Позиції" },
  "my-strategies": { en: "Strategies", uk: "Стратегії" },
};

export type Place = Readonly<{
  id: PlaceId;
  /** Where the place opens. Null for «Ще», which opens its list rather than a page. */
  href: string | null;
  icon: string;
  /**
   * The routes the place owns itself, beyond its pages' own routes.
   *
   * Markets owns its landing, and through its pages Spot, the stock desk's
   * addresses (a company's page among them) and Trends; Portfolio owns its
   * pages' routes — the plans, the monitoring surface, Results, History and
   * a receipt — because a position, its record and the rules watching it are
   * one place (canon §3). A route nobody owns lights nothing, which is honest.
   */
  own: readonly string[];
}>;

export const PLACES: readonly Place[] = [
  /* «Поповнити» is reached from Home and belongs to it; so does «Автоінвест»,
     whose block Home draws (on the desk both are rows of the menu too). */
  { id: "home", href: "/app/home", icon: "home", own: ["/app/home", "/app/top-up", "/app/autoinvest"] },
  { id: "markets", href: "/app/markets", icon: "explore", own: ["/app/markets"] },
  { id: "agent", href: "/app/ryn", icon: "ryntra", own: ["/app/ryn"] },
  { id: "portfolio", href: "/app/portfolio", icon: "portfolio", own: [] },
  { id: "more", href: null, icon: "more", own: [] },
];

/** One row the menu draws: a place, or a page inside a place. */
export type PlaceEntry = Readonly<{
  id: PlaceId | ProductPageId;
  label: string;
  href: string;
  icon: string;
}>;

/**
 * The pages a place draws, in its order: a `planned` page is not drawn, nor
 * one kept off the surface ({@link OFF_SURFACE}), exactly as they are nowhere
 * else, and a page missing from `routes` throws for the same reason
 * {@link productNavigation} does.
 */
export function placePages(place: PlaceId, routes: readonly PageRoute[], locale: ProductLocale): readonly PlaceEntry[] {
  const byId = new Map(projectPages(routes, locale).map((page) => [page.id, page]));
  return PLACE_PAGES[place].flatMap((id): PlaceEntry[] => {
    const page = byId.get(id);
    if (!page) throw new Error(`The place "${place}" holds "${id}", which is not a registered page.`);
    if (!drawn(page)) return [];
    return [{ id: page.id, label: IN_PLACE_LABELS[id]?.[locale] ?? page.label, href: page.href, icon: page.icon }];
  });
}

export type ProductNavigation = Readonly<{
  /** The four places that are pages, in order; «Ще» is {@link ProductNavigation.more}. */
  places: readonly PlaceEntry[];
  /** «Ще»'s title and its pages. */
  more: Readonly<{ title: string; entries: readonly PlaceEntry[] }>;
  /** Every landing a row stands for and the routes it owns, for `pageActiveHref`. */
  routes: readonly Pick<PageRoute, "href" | "match">[];
}>;

/**
 * The one menu: the four places, and «Ще» over its pages.
 *
 * A place stands for its own routes and for every route of every page it
 * holds, planned ones included — an old address of a page that is not built
 * still belongs to the place that will hold it. A page of «Ще» is a row of its
 * own and stands for its own routes.
 *
 * @throws if a page is missing from `routes`, or carries an empty `href`. A
 * rail that can render a dead row is the defect this registry exists to close,
 * so the failure happens at construction where a test can see it, rather than
 * on a customer's screen where it reads as a broken product.
 */
export function productNavigation(routes: readonly PageRoute[], locale: ProductLocale): ProductNavigation {
  const owned = new Map<string, readonly string[]>(routes.map((route) => [route.id, route.match]));
  const more = placePages("more", routes, locale);
  const places = PLACES.flatMap((place): PlaceEntry[] =>
    place.href === null ? [] : [{ id: place.id, label: PLACE_LABELS[place.id][locale], href: place.href, icon: place.icon }],
  );
  return {
    places,
    more: { title: PLACE_LABELS.more[locale], entries: more },
    routes: [
      ...PLACES.flatMap((place) =>
        place.href === null || place.id === "more"
          ? []
          : [{ href: place.href, match: [...place.own, ...PLACE_PAGES[place.id].flatMap((id) => owned.get(id) ?? [])] }],
      ),
      ...more.map((entry) => ({ href: entry.href, match: owned.get(entry.id) ?? [entry.href] })),
    ],
  };
}

export type MobileNavEntry = Readonly<{
  id: string;
  label: string;
  /** Null for `more`, which opens the rail rather than navigating. */
  href: string | null;
  icon: string;
  /**
   * The landing hrefs this column stands for — its own, and for «Ще» every
   * page it holds, so a person on Send knows where Send lives.
   */
  matches: readonly string[];
}>;

/**
 * The phone's five: the places, «Ще» the opener of the menu's sections
 * ({@link menuNavigation}) — the same list the desk shows, so the two cannot
 * disagree.
 */
export function mobileNavigation(routes: readonly PageRoute[], locale: ProductLocale): readonly MobileNavEntry[] {
  const { places, more } = productNavigation(routes, locale);
  return [
    ...places.map((place) => ({ id: place.id, label: place.label, href: place.href, icon: place.icon, matches: [place.href] })),
    { id: "more", label: more.title, href: null, icon: "more", matches: more.entries.map((entry) => entry.href) },
  ];
}

/* --------------------------------------------------------------- the menu */

/**
 * The menu you can see (canon v5.4 В30, 2026-09-24): on a desk every section
 * with its caption and nothing behind «Ще» — Головна · Інвестувати (Ринки,
 * Автоінвест) · Торгувати (Обмін, Спот, Скринер акцій, Тренди) · Гроші
 * (Поповнити, Надіслати, Отримати, Міст) · Портфель (Позиції, Стратегії,
 * Результати, Історія) · Ryntra — ШІ-помічник · Винагороди, with Відгук and
 * Налаштування at the foot. On a phone «Ще» opens the same sections.
 *
 * A row is a registered page, or one of the product's own destinations that
 * is not a page of the registry — Home, Markets, «Автоінвест», «Поповнити»,
 * the assistant — each named, drawn and owning its routes here.
 */
export const MENU_SECTION_IDS = ["home", "invest", "trade", "money", "portfolio", "agent", "rewards"] as const;

export type MenuSectionId = (typeof MENU_SECTION_IDS)[number];

/** The captions. A section of one row carries none: its row says it. */
export const MENU_SECTION_LABELS: Readonly<Partial<Record<MenuSectionId, DomainLabel>>> = {
  invest: { en: "Invest", uk: "Інвестувати" },
  trade: { en: "Trade", uk: "Торгувати" },
  money: { en: "Money", uk: "Гроші" },
  portfolio: { en: "Portfolio", uk: "Портфель" },
};

/** The product's own destinations that are rows of the menu without being registered pages. */
export const MENU_DESTINATION_IDS = ["home", "markets", "autoinvest", "top-up", "agent"] as const;

export type MenuDestinationId = (typeof MENU_DESTINATION_IDS)[number];

export type MenuDestination = Readonly<{
  label: DomainLabel;
  /** A second line that says what the row is, where its name alone does not. */
  caption?: DomainLabel;
  href: string;
  icon: string;
  /** Every route the row stands for, its landing included. */
  match: readonly string[];
}>;

export const MENU_DESTINATIONS: Readonly<Record<MenuDestinationId, MenuDestination>> = {
  home: { label: PLACE_LABELS.home, href: "/app/home", icon: "home", match: ["/app/home"] },
  /* A company's page is reached from Markets and stands under it; the
     screener's own address is its row's. */
  markets: { label: PLACE_LABELS.markets, href: "/app/markets", icon: "explore", match: ["/app/markets", "/app/stocks"] },
  autoinvest: { label: { en: "Autoinvest", uk: "Автоінвест" }, href: "/app/autoinvest", icon: "autoinvest", match: ["/app/autoinvest"] },
  "top-up": { label: { en: "Top up", uk: "Поповнити" }, href: "/app/top-up", icon: "top-up", match: ["/app/top-up"] },
  /* The assistant says what it is (the Owner, 2026-09-24): «Ryntra» alone
     read as the product's name, not as the AI. Its older names lead here. */
  agent: {
    label: PLACE_LABELS.agent,
    caption: { en: "AI assistant", uk: "ШІ-помічник" },
    href: "/app/ryn",
    icon: "ryntra",
    match: ["/app/ryn", "/app/ideas", "/app/research", "/app/adviser"],
  },
};

export type MenuRowRef = Readonly<{ page: ProductPageId }> | Readonly<{ destination: MenuDestinationId }>;

/** What each section holds, in the order it draws. */
export const MENU_ROWS: Readonly<Record<MenuSectionId, readonly MenuRowRef[]>> = {
  home: [{ destination: "home" }],
  invest: [{ destination: "markets" }, { destination: "autoinvest" }],
  trade: [{ page: "swap" }, { page: "spot" }, { page: "stocks" }, { page: "trends" }, { page: "perps" }],
  money: [{ destination: "top-up" }, { page: "send" }, { page: "receive" }, { page: "bridge" }],
  portfolio: [{ page: "portfolio" }, { page: "my-strategies" }, { page: "results" }, { page: "activity" }],
  agent: [{ destination: "agent" }],
  rewards: [{ page: "rewards" }],
};

/** A page named differently as a row of the menu. */
export const MENU_PAGE_LABELS: Readonly<Partial<Record<ProductPageId, DomainLabel>>> = {
  stocks: { en: "Stock screener", uk: "Скринер акцій" },
  portfolio: { en: "Positions", uk: "Позиції" },
  "my-strategies": { en: "Strategies", uk: "Стратегії" },
};

/**
 * A page drawn with another glyph as a row of the menu: the screener is the
 * funnel it is, and History the clock rather than the list the phone's old
 * menu control drew.
 */
export const MENU_PAGE_ICONS: Readonly<Partial<Record<ProductPageId, string>>> = {
  stocks: "screener",
  activity: "history",
};

/**
 * The routes a page's row stands for, where they differ from the page's own:
 * the screener is its own address (a company's page is Markets'), Trends no
 * longer holds the old Markets landing, and Monitoring — the notes the bell
 * opens — is the bell's, not a row's.
 */
export const MENU_PAGE_MATCH: Readonly<Partial<Record<ProductPageId, readonly string[]>>> = {
  stocks: ["/app/stocks/screener"],
  trends: ["/app/trends", "/app/assets"],
  "my-strategies": ["/app/strategies", "/app/plans", "/app/action-cases", "/app/control", "/app/agents"],
};

/** The foot of the menu: Відгук is a dialog the shell draws; Settings is a row. */
export const MENU_FOOT = {
  feedback: { en: "Feedback", uk: "Відгук" },
  settings: { label: SECONDARY_LABELS.settings, href: "/app/settings", icon: "settings", match: ["/app/settings"] },
} as const;

export type MenuRow = Readonly<{
  /** A page's id, a destination's, or `settings`. */
  id: string;
  label: string;
  caption?: string;
  href: string;
  icon: string;
}>;

export type MenuSection = Readonly<{ id: MenuSectionId; title: string | null; rows: readonly MenuRow[] }>;

export type MenuNavigation = Readonly<{
  sections: readonly MenuSection[];
  settings: MenuRow;
  feedbackLabel: string;
  /** Every row's landing and the routes it owns, for `pageActiveHref`. */
  routes: readonly Pick<PageRoute, "href" | "match">[];
}>;

/**
 * The menu, from the routes and a language and nothing else: a planned page
 * and a page kept off the surface are not rows, a section left empty is not
 * drawn, and a page missing from `routes` throws, as everywhere in this file.
 */
export function menuNavigation(routes: readonly PageRoute[], locale: ProductLocale): MenuNavigation {
  const pages = new Map(projectPages(routes, locale).map((page) => [page.id, page]));
  const owned = new Map<string, readonly string[]>(routes.map((route) => [route.id, route.match]));
  const matches: Pick<PageRoute, "href" | "match">[] = [];
  const sections = MENU_SECTION_IDS.flatMap((id): MenuSection[] => {
    const rows = MENU_ROWS[id].flatMap((ref): MenuRow[] => {
      if ("destination" in ref) {
        const destination = MENU_DESTINATIONS[ref.destination];
        matches.push({ href: destination.href, match: destination.match });
        return [{ id: ref.destination, label: destination.label[locale], caption: destination.caption?.[locale], href: destination.href, icon: destination.icon }];
      }
      const page = pages.get(ref.page);
      if (!page) throw new Error(`The menu holds "${ref.page}", which is not a registered page.`);
      if (!drawn(page)) return [];
      matches.push({ href: page.href, match: MENU_PAGE_MATCH[ref.page] ?? owned.get(ref.page) ?? [page.href] });
      return [{ id: page.id, label: MENU_PAGE_LABELS[ref.page]?.[locale] ?? page.label, href: page.href, icon: MENU_PAGE_ICONS[ref.page] ?? page.icon }];
    });
    if (rows.length === 0) return [];
    return [{ id, title: MENU_SECTION_LABELS[id]?.[locale] ?? null, rows }];
  });
  matches.push({ href: MENU_FOOT.settings.href, match: MENU_FOOT.settings.match });
  return {
    sections,
    settings: { id: "settings", label: MENU_FOOT.settings.label[locale], href: MENU_FOOT.settings.href, icon: MENU_FOOT.settings.icon },
    feedbackLabel: MENU_FOOT.feedback[locale],
    routes: matches,
  };
}
