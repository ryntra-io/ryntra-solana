/**
 * The pages of Ryntra, the sections of the menu that hold them, and the only
 * place their order is decided.
 *
 * **The core's Menu 3, since NAV-1 (decision 55).** One menu for everyone, the
 * core's composition in the core's frame: Головна, then the groups Торгівля ·
 * Автоматика · Заробіток · Гроші, each opened by its arrow, with the rows that
 * live on Solana ({@link MENU_SECTIONS}, {@link menuNavigation}). Every place is
 * a row; there are no tabs above a page. There is no «Простий»/«Профі» switch
 * (since 2026-09-24), and the fifteen registered pages stay the product's
 * capability modules: each lives in exactly one row.
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

import { NAV_GROUPS, NAV_WORDS, PHONE_BAR, groupOf, type NavGroupId, type NavItemId, type NavPaths, type PhoneBarPlace } from "@ryntra/core/nav";

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
  perps: { en: "Perps", uk: "Perps" },
  /* «Прогнози»: the page is about markets on outcomes, and the Ukrainian word
     for a forecast is the one a person already owns. */
  predictions: { en: "Predictions", uk: "Прогнози" },
  ideas: { en: "Ideas", uk: "Ідеї" },
  "my-strategies": { en: "My strategies", uk: "Мої стратегії" },
  results: { en: "Results", uk: "Результати" },
  send: { en: "Send", uk: "Надіслати" },
  receive: { en: "Receive", uk: "Отримати" },
  /* «Між мережами» — the core's menu word (Menu 3), and since B18 the one name of this work everywhere: the page is
     named after what somebody wants done rather than after the mechanism that does it. */
  bridge: { en: "Between networks", uk: "Між мережами" },
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
 * Menu 3: the core's one menu — Головна, then the groups Торгівля · Автоматика ·
 * Заробіток · Гроші · Казна, each opened and shut by its arrow — and on Solana only the rows that live here. Every
 * place of the product is a row: no tabs above a page, no row of tools beside them. Надіслати and Отримати are rows
 * of Гроші. «Мережа» and «Інші продукти» are off the foot of the menu for now: the
 * menu names Solana only (the frame, `app/app/product-shell.tsx`).
 *
 * The composition, its order and its words are the core's (`@ryntra/core/nav`), one for the web, the phone and every
 * network; this file says only where each row opens here, which routes it owns and which registered pages it holds.
 * Agents do not live on Solana yet, so they are simply not drawn (decision 55 replaces «Ще»
 * with a caption). Perps (the core's `futures`) and Прогнози are rows of Торгівля inside Solana: the perpetuals of Phoenix (B7) and the predictions of AGG (NAV-6), without a way-out arrow — drawn once
 * their pages live, each by its own task ({@link MENU_LIVE}). Ryntra Futures, the one Hyperliquid terminal, is not a row here and, while
 * its line is paused (decision 58), not a link of the menu or the search either (decision 63).
 *
 * Every page that was a tab keeps its address and is a row now; the pages under a row (a token, a pool, a plan, «Мої
 * лаунчі», the bots' catalogue) are reached from the row's page.
 */
const SOLANA_ROWS = [
  "home",
  "spot",
  "swap",
  "markets",
  "launch",
  "futures",
  "predictions",
  "bots",
  "assistant",
  "pools",
  "rewards",
  "portfolio",
  "deposit",
  "send",
  "receive",
  "bridge",
  "history",
] as const satisfies readonly NavItemId[];

/**
 * Казна (SOL-4, decision 47): the person's own Squads multisig. A row of the core's group «Казна» only where the
 * deployment names the treasury's network; elsewhere its page is not served and the row is not drawn.
 */
export const TREASURY_IN_MENU = treasuryNamed(process.env.NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK);

/** The same reading as the treasury's own (`lib/solana/treasury/model.ts` `treasuryNetworkFrom`), kept here so the rail depends on nothing. */
export function treasuryNamed(value: string | undefined): boolean {
  return ["devnet", "mainnet", "mainnet-beta"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * Ліміти витрат (SOL-7, decision 58): limits on the person's USDC on the Subscriptions program — the core's row
 * «Правила» of the group «Казна», the rules of what may be taken. Drawn only where the deployment names the limits'
 * network (`NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK`: devnet first, mainnet by the operator's canary), as the treasury's.
 */
export const ALLOWANCES_IN_MENU = treasuryNamed(process.env.NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK);

/**
 * Earn (decision 47): the person's own asset in a lending market — Jupiter Lend first, Kamino Lend
 * second and switched off. The core's row «Earn» of the group «Заробіток», drawn only where the deployment
 * says Earn is reachable here (`NEXT_PUBLIC_RYNTRA_EARN=on`), as the treasury's row is.
 *
 * The flag and the key are one decision in two halves: reading the markets needs a Jupiter key with Lend
 * access on the server, and a row that led to a provider nobody can ask would be a row that teaches people
 * the section is broken. The page itself is served either way and says which provider is unavailable and
 * why — an honest page nobody is sent to beats a row over an empty one.
 */
export const EARN_IN_MENU = earnNamed(process.env.NEXT_PUBLIC_RYNTRA_EARN);

/** The same reading as Earn's own (`lib/earn/providers.ts` `earnNamed`), kept here so the rail depends on nothing. */
export function earnNamed(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "on";
}

/**
 * Казна on mainnet is open to every wallet of 21.10 and early (SOL-C2, decision 63; UX-003, UX-703):
 * its group in the menu says «Beta», its page the network and «Beta». No new gate — the deployment's variable still
 * decides whether the row is drawn at all.
 */
export const TREASURY_ON_MAINNET = ["mainnet", "mainnet-beta"].includes(process.env.NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK?.trim().toLowerCase() ?? "");

/**
 * «Perps» — the row of Phoenix's perpetuals (B7) in both languages, as Jupiter, Drift and Phoenix name theirs. The core's word for its `futures` row is still «Ф'ючерси» / «Futures», one for every
 * network, and the other networks and the phone keep it; on Solana this word stands in its place: in the search and
 * the page's registry here, and in the core's menu through `app/app/frame.css`, which the frame hands it as a custom
 * property as it does the row's tag. Asked of the core as a network's own word for a row (handoff PERP-1); the frame's rule goes
 * when the core takes one.
 */
export const PERPS_LABEL: DomainLabel = { en: "Perps", uk: "Perps" };

/**
 * The network Ryntra on Solana runs on, named on the plate beside the logo — the core's `network`: a plate, not a switch. One name in both languages, as the operator gave it.
 */
export const NETWORK_PLATE = "Solana Mainnet Beta";

/**
 * What Perps (Phoenix) let a person do now, in the search's hint (SOL-C2, UX-365, UX-350): since 22.10 orders are open
 * from Ryntra, so the row in the menu carries no tag any more (PERP-2) — a tag stands only where
 * a place lets a person do less than its word says.
 */
export const FUTURES_NOW: DomainLabel = { en: "orders open", uk: "ордери відкриті" };

/** The tag in the menu beside a place's word — Казна's group — where it lets a person do less than its word says. */
export const MENU_TAGS: Readonly<Partial<Record<MenuSectionId, DomainLabel>>> = {
  ...(TREASURY_ON_MAINNET ? { treasury: { en: "Beta", uk: "Beta" } } : {}),
};

export type MenuSectionId = (typeof SOLANA_ROWS)[number] | "treasury" | "policies" | "lend";

export const MENU_SECTION_IDS: readonly MenuSectionId[] = Object.freeze([
  ...SOLANA_ROWS,
  ...(EARN_IN_MENU ? (["lend"] as const) : []),
  ...(TREASURY_IN_MENU ? (["treasury"] as const) : []),
  ...(ALLOWANCES_IN_MENU ? (["policies"] as const) : []),
]);

export type MenuSectionDef = Readonly<{
  label: DomainLabel;
  href: string;
  /** Every route the row stands for — its own and the old addresses that lead into it. */
  match: readonly string[];
  /** The registered pages it holds, so every page lives in exactly one row. */
  pages: readonly ProductPageId[];
}>;

/** A row's word in both languages, the core's own. */
function navLabel(id: NavItemId): DomainLabel {
  return { en: NAV_WORDS.en.items[id], uk: NAV_WORDS.uk.items[id] };
}

const row = (id: MenuSectionId, href: string, match: readonly string[], pages: readonly ProductPageId[] = []): MenuSectionDef => ({
  label: navLabel(id),
  href,
  match,
  pages,
});

export const MENU_SECTIONS: Readonly<Record<MenuSectionId, MenuSectionDef>> = {
  home: row("home", "/app/home", ["/app/home"]),
  /* The registered Perps page stays planned under Spot until trading from Ryntra comes with B6; its
     address is the row Perps' own (PERP-1). */
  spot: row("spot", "/app/spot", ["/app/spot"], ["spot", "perps"]),
  swap: row("swap", "/app/swap", ["/app/swap", "/app/trade"], ["swap"]),
  /* One screener for every asset: a company's page and an asset's page stand under it, and the two lists it replaced
     — the stock screener and Trends — lead into it. Pools is a row of its own under Заробіток. */
  markets: row("markets", "/app/markets", ["/app/markets", "/app/stocks", "/app/trends", "/app/assets"], ["stocks", "trends", "predictions"]),
  /* Ryntra Launch: every market launched on Ryntra, no wallet; the form, «Мої лаунчі» and every launch's page stand
     under it. */
  launch: row("launch", "/app/launch/markets", ["/app/launch"]),
  /* Perps: Phoenix's perpetuals inside Solana — the markets, the book, the core's
     chart and the wallet's Phoenix account, in Solana's frame — at `/app/perps`, named «Perps» in both languages
     ({@link PERPS_LABEL}, PERP-1); the old `/app/futures` leads here for good. The id stays the core's `futures`. Like
     Прогнози, the row holds the route only: the registered Perps page stays planned (no documentation, no API
     readiness yet) until trading from Ryntra comes with B6. */
  futures: { ...row("futures", "/app/perps", ["/app/perps", "/app/futures"]), label: PERPS_LABEL },
  /* Прогнози: the Predictions section on AGG inside Solana (NAV-6c, decision 58), a row of Торгівля without the
     way-out arrow (`app/app/frame.css`); its hub, markets and paper portfolio light it. Its registered page stays off
     the documented surface (no documentation page yet) and is still filed under Ринки, so this row holds the route
     only: a row whose every page is off the surface would not be drawn. */
  predictions: row("predictions", "/app/predictions", ["/app/predictions"]),
  /* Everything that runs on a person's rule: the recurring-buy rules and the plans with their results (the old
     «Автоінвест»); the plan builder, a plan's page and the catalogue stand under it. */
  bots: row(
    "bots",
    "/app/bots",
    ["/app/bots", "/app/strategies", "/app/plans", "/app/results", "/app/journal", "/app/brief", "/app/coverage", "/app/action-cases", "/app/control", "/app/agents", "/app/autoinvest"],
    ["my-strategies", "results"],
  ),
  /* The assistant Ryntra: a row of Автоматика, and the button at the end of the header with the screen as its
     context. Its older names lead here. */
  assistant: row("assistant", "/app/ryn", ["/app/ryn", "/app/ideas", "/app/research", "/app/adviser"], ["ideas"]),
  pools: row("pools", "/app/markets/pools", ["/app/markets/pools"]),
  /* Earn: the lending markets, the wallet's position in them read from the chain, and one Review per
     move. Registered here always and drawn only where {@link EARN_IN_MENU} says the section is reachable. */
  lend: row("lend", "/app/earn", ["/app/earn"]),
  rewards: row("rewards", "/app/rewards", ["/app/rewards"], ["rewards"]),
  portfolio: row("portfolio", "/app/portfolio", ["/app/portfolio"], ["portfolio"]),
  deposit: row("deposit", "/app/top-up", ["/app/top-up"]),
  send: row("send", "/app/send", ["/app/send"], ["send"]),
  receive: row("receive", "/app/receive", ["/app/receive"], ["receive"]),
  bridge: row("bridge", "/app/bridge", ["/app/bridge"], ["bridge"]),
  history: row("history", "/app/activity", ["/app/activity", "/app/receipts", "/app/fees"], ["activity"]),
  /* The treasury's one page: the multisig, its proposals, payouts and limits; the agent's multisig is made there too. */
  treasury: row("treasury", "/app/treasury", ["/app/treasury"]),
  /* The spending limits' one page: give a limit, see who may take what, revoke in one tap. */
  policies: row("policies", "/app/allowances", ["/app/allowances"]),
};

/** The group each row stands in, the core's; null for Home. */
export function menuGroupOf(id: MenuSectionId): NavGroupId | null {
  return groupOf(id);
}

/** Where each row opens, after the app's root — the frame hands it to the core's menu. */
export const MENU_PATHS: NavPaths = Object.freeze(
  Object.fromEntries(MENU_SECTION_IDS.map((id) => [id, MENU_SECTIONS[id].href.replace(/^\/app\/?/, "")])),
) as NavPaths;

/**
 * The rows drawn here: every row of Solana — Perps (Phoenix, B7) and Прогнози (AGG) among them, both inside Solana's
 * frame (decision 56).
 */
export const MENU_LIVE: readonly NavItemId[] = Object.freeze([...MENU_SECTION_IDS]);

/** Every row's landing and the routes it owns, for `pageActiveHref`. */
export const MENU_ROUTES: readonly Pick<PageRoute, "href" | "match">[] = MENU_SECTION_IDS.map((id) => ({ href: MENU_SECTIONS[id].href, match: MENU_SECTIONS[id].match }));

/** The row a path stands in, or null: Settings, Нагляд and the other pages outside every row light none. */
export function rowForPath(pathname: string): MenuSectionId | null {
  const href = pageActiveHref(pathname, MENU_ROUTES);
  return MENU_SECTION_IDS.find((id) => MENU_SECTIONS[id].href === href) ?? null;
}

/** The row that holds each registered page — read off {@link MENU_SECTIONS}, never written twice. */
export const PAGE_SECTION: Readonly<Partial<Record<ProductPageId, MenuSectionId>>> = Object.freeze(
  Object.fromEntries(MENU_SECTION_IDS.flatMap((section) => MENU_SECTIONS[section].pages.map((page) => [page, section] as const))),
) as Readonly<Partial<Record<ProductPageId, MenuSectionId>>>;

/** The assistant: a row of Автоматика, and «Спитати Ryntra» at the end of the header. */
export const ASSISTANT = {
  label: { en: "Ryntra", uk: "Ryntra" },
  caption: { en: "AI assistant", uk: "ШІ-помічник" },
  ask: { en: "Ask Ryntra", uk: "Спитати Ryntra" },
  href: MENU_SECTIONS.assistant.href,
  icon: "ryntra",
} as const;

/** «Запустити токен» — the Launch page's own action, and an action of the search. */
export const MENU_ACTION = {
  label: { en: "Launch a token", uk: "Запустити токен" },
  short: { en: "Launch", uk: "Лаунч" },
  href: "/app/launch/new",
  icon: "launch-plus",
} as const;

/**
 * What the wallet's panel holds: «Акаунт» — the page of the account, Telegram and the language; «Нагляд» — the page
 * where every note and reminder lives, under the same name as its page; «Відгук». «Налаштування» is one place only:
 * the row at the foot of the menu (the look, the density, the menu's place), so the panel's row carries another word.
 */
export const MENU_FOOT = {
  feedback: { en: "Feedback", uk: "Відгук" },
  notifications: { label: { en: "Notifications", uk: "Сповіщення" }, href: "/app/alerts" },
  settings: { label: { en: "Account", uk: "Акаунт" }, href: "/app/settings", icon: "settings", match: ["/app/settings"] },
} as const;

export type MenuRow = Readonly<{
  /** A row's id, or `settings`. */
  id: string;
  label: string;
  href: string;
  icon: string;
}>;

export type MenuSection = Readonly<{ id: MenuSectionId; title: null; rows: readonly MenuRow[] }>;

/** Home, then each of the core's groups that has a row here, in the core's order. */
export type MenuGroup = Readonly<{ id: "home" | NavGroupId; label: string; rows: readonly MenuRow[] }>;

export type MenuNavigation = Readonly<{
  /** «Запустити токен». */
  action: Readonly<{ label: string; href: string; icon: string }>;
  groups: readonly MenuGroup[];
  /** The same rows one at a time — for the surfaces that list places (search, documentation). */
  sections: readonly MenuSection[];
  assistant: MenuRow;
  settings: MenuRow;
  feedbackLabel: string;
  /** Every row's landing and the routes it owns, for `pageActiveHref`. */
  routes: readonly Pick<PageRoute, "href" | "match">[];
}>;

/**
 * Whether a row is drawn: one that opens a page of its own — no registered page, or none at its address (the
 * assistant, whose old Ideas page is planned) — is a destination of its own; otherwise one of its pages must be drawn.
 */
function sectionDrawn(section: MenuSectionDef, byId: ReadonlyMap<string, ProductNavEntry>): boolean {
  if (!section.pages.some((id) => byId.get(id)?.href === section.href)) return true;
  return section.pages.some((id) => {
    const page = byId.get(id);
    return page !== undefined && drawn(page);
  });
}

/** The icon each group and Home carry in the surfaces drawn outside the core (the landing's picture of the menu). */
const GROUP_ICON: Readonly<Record<"home" | NavGroupId, string>> = {
  home: "home",
  trading: "trade",
  automation: "bots",
  earning: "rewards",
  money: "money",
  treasury: "treasury",
};

/**
 * The menu, from the routes and a language and nothing else: a row whose
 * pages are all planned or off the surface is not drawn, and a page missing
 * from `routes` throws, as everywhere in this file.
 */
export function menuNavigation(routes: readonly PageRoute[], locale: ProductLocale): MenuNavigation {
  const pages = new Map<string, ProductNavEntry>(projectPages(routes, locale).map((page) => [page.id, page]));
  const shown = (id: MenuSectionId) => sectionDrawn(MENU_SECTIONS[id], pages);
  const toRow = (id: MenuSectionId): MenuRow => ({ id, label: MENU_SECTIONS[id].label[locale], href: MENU_SECTIONS[id].href, icon: GROUP_ICON[groupOf(id) ?? "home"] });
  const here = (id: NavItemId): id is MenuSectionId => (MENU_SECTION_IDS as readonly string[]).includes(id) && shown(id as MenuSectionId);
  const groups: MenuGroup[] = [
    { id: "home", label: NAV_WORDS[locale].items.home, rows: [toRow("home")] },
    ...NAV_GROUPS.flatMap((group): MenuGroup[] => {
      const rows = group.items.map((item) => item.id).filter(here).map(toRow);
      return rows.length === 0 ? [] : [{ id: group.id, label: NAV_WORDS[locale].groups[group.id], rows }];
    }),
  ];
  return {
    action: { label: MENU_ACTION.label[locale], href: MENU_ACTION.href, icon: MENU_ACTION.icon },
    groups,
    sections: groups.flatMap((group) => group.rows).map((entry) => ({ id: entry.id as MenuSectionId, title: null, rows: [entry] })),
    assistant: { id: "assistant", label: ASSISTANT.label[locale], href: ASSISTANT.href, icon: ASSISTANT.icon },
    settings: { id: "settings", label: MENU_FOOT.settings.label[locale], href: MENU_FOOT.settings.href, icon: MENU_FOOT.settings.icon },
    feedbackLabel: MENU_FOOT.feedback[locale],
    routes: [
      ...MENU_SECTION_IDS.filter(shown).map((id) => ({ href: MENU_SECTIONS[id].href, match: MENU_SECTIONS[id].match })),
      { href: MENU_FOOT.settings.href, match: MENU_FOOT.settings.match },
    ],
  };
}

export type MobileNavEntry = Readonly<{
  id: string;
  label: string;
  /** Null for `menu`, which opens the menu rather than navigating. */
  href: string | null;
  icon: string;
  /** The landing hrefs this column stands for — its own, and for «Меню» every row it opens. */
  matches: readonly string[];
  /** Kept for the old frame's bar; Menu 3 has no action in the bar. */
  action?: boolean;
}>;

/** Where each place of the phone's bar opens on Solana: Торгівля on Spot, Гроші on Поповнити (the frame's bar opens its four actions instead). */
export const PHONE_PLACES: Readonly<Record<Exclude<PhoneBarPlace, "menu">, MenuSectionId>> = {
  home: "home",
  trading: "spot",
  money: "deposit",
  portfolio: "portfolio",
};

/**
 * The phone's bar of Menu 3 — Головна · Торгівля · Гроші · Портфель · Меню (the core's `PHONE_BAR`). The product's
 * own frame is the core's, whose menu opens in a bottom sheet; this bar is drawn only where a page still sits in the
 * old frame.
 */
export function mobileNavigation(routes: readonly PageRoute[], locale: ProductLocale): readonly MobileNavEntry[] {
  const menu = menuNavigation(routes, locale);
  const rows = menu.groups.flatMap((group) => group.rows);
  const words = NAV_WORDS[locale];
  return PHONE_BAR.map((place): MobileNavEntry => {
    if (place === "menu") {
      return { id: "menu", label: words.menu, href: null, icon: "more", matches: [...rows.map((entry) => entry.href), menu.settings.href] };
    }
    const target = MENU_SECTIONS[PHONE_PLACES[place]];
    const group = place === "trading" || place === "money" ? place : null;
    const label = group ? words.groups[group] : words.items[place as "home" | "portfolio"];
    const matches = group ? rows.filter((entry) => groupOf(entry.id as NavItemId) === group).map((entry) => entry.href) : [target.href];
    return { id: place, label, href: target.href, icon: group ? GROUP_ICON[group] : place, matches };
  });
}
