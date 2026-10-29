/**
 * The language of an address — English without a prefix, Ukrainian at `/uk`
 * and the same path, for every page offered to the index, the app's pages too.
 *
 * Every page a search engine is offered has two addresses: `/docs/invest/buy`
 * and `/uk/docs/invest/buy`, `/app/stocks/NVDAx` and `/uk/app/stocks/NVDAx`.
 * A crawler carries no cookie, so the address alone decides what it reads:
 * English at the first, Ukrainian at the second, each naming the other as its
 * `hreflang` pair. A person's language stays where it always was — the one
 * cookie every surface reads (`ryntra_hub_locale`) — and a visit to a `/uk`
 * address writes it (`middleware.ts`), so the pages beyond it follow.
 *
 * Plain functions over paths, importing only the address map's own plain
 * functions (`lib/product/app-address.ts`): the middleware runs this at the
 * edge on every `/uk` request, and the documentation's text must not ride
 * along into that bundle — hence the documentation's addresses as a list of
 * slugs here, which `lib/site/localized.test.mjs` holds equal to `DOC_PAGES`.
 */

import { APP_HOST, solanaRoute } from "../product/app-address.ts";

export const UK_PREFIX = "/uk";

export type AddressLocale = "en" | "uk";

/** The documentation's pages, by slug — every one written in both languages. */
export const DOC_SLUGS = [
  "start/getting-started",
  "start/wallet",
  "start/cabinet",
  "manage/settings",
  "invest/buy",
  "invest/autoinvest",
  "invest/company-page",
  "invest/private-companies",
  "invest/what-you-buy",
  "trade/overview",
  "trade/perps",
  "trade/predictions",
  "bots",
  "trade/swap",
  "trade/spot",
  "trade/screener",
  "trade/trends",
  "launch/launch-a-token",
  "launch/creator",
  "money/top-up",
  "money/send",
  "money/receive",
  "money/bridge",
  "manage/portfolio",
  "manage/pools",
  "strategies/my-strategies",
  "strategies/results",
  "strategies/overview",
  "manage/activity",
  "ryntra",
  "phone",
  "money/rewards",
  "money/referrals",
  "reference/networks",
  "reference/receipts",
  "reference/review",
  "reference/fees",
  "reference/statuses",
  "reference/troubleshooting",
  "reference/faq",
  "reference/glossary",
  "soon",
] as const;

const DOC_SLUG_SET: ReadonlySet<string> = new Set(DOC_SLUGS);

/**
 * The pages with an address in each language: the landing, Home, Markets, the
 * public pages of the site and the documentation's hub. The legal texts are
 * English until a lawyer gives them Ukrainian (plan decision 7), the reviewer
 * and developer pages stay out of the index, and the rest of the app is a
 * person's own — none of them has a `/uk` twin.
 */
const PAGES_IN_TWO_LANGUAGES: ReadonlySet<string> = new Set([
  "/",
  "/app/home",
  "/app/markets",
  "/company",
  "/security",
  "/methodology",
  "/contact",
  /* The support page the Android app's store listing names (2026-09-29). */
  "/support",
  "/stats",
  "/docs",
]);

/** A company's page: one token, never the screener that shares the folder. */
const COMPANY_PAGE = /^\/app\/stocks\/(?!screener$)[A-Za-z0-9._-]{1,44}$/;

/** Whether the page at this path (no query, no fragment) has a Ukrainian address too. */
export function hasUkAddress(path: string): boolean {
  if (PAGES_IN_TWO_LANGUAGES.has(path)) return true;
  if (COMPANY_PAGE.test(path)) return true;
  return path.startsWith("/docs/") && DOC_SLUG_SET.has(path.slice("/docs/".length));
}

/** An address split into the page and its language: `/uk/docs` → `{ uk: true, path: "/docs" }`, `/uk` → the landing. */
export function splitUkPrefix(pathname: string): Readonly<{ uk: boolean; path: string }> {
  if (pathname === UK_PREFIX) return { uk: true, path: "/" };
  if (pathname.startsWith(`${UK_PREFIX}/`)) return { uk: true, path: pathname.slice(UK_PREFIX.length) };
  return { uk: false, path: pathname };
}

/**
 * The page's address without its language and without its network — what
 * the app's own routes are named by: `/uk/app/home`, and on app.ryntra.io
 * `/solana/home` and `/uk/solana/home`, are all `/app/home`.
 */
export function pagePath(pathname: string): string {
  return solanaRoute(splitUkPrefix(pathname).path);
}

/**
 * The route a `/uk` address is served from (`middleware.ts`), or null where
 * the page has no Ukrainian twin: `/uk/docs` is `/docs`, and on app.ryntra.io
 * — only there — `/uk/solana/home` is `/app/home`. The landing, `/uk`, is its
 * own route and is not asked here.
 */
export function ukAddressRoute(pathname: string, host: string | null | undefined): string | null {
  const { uk, path } = splitUkPrefix(pathname);
  if (!uk) return null;
  const onAppHost = (host ?? "").toLowerCase().split(":")[0] === APP_HOST;
  const route = onAppHost ? solanaRoute(path) : path;
  return hasUkAddress(route) ? route : null;
}

function splitSuffix(href: string): [string, string] {
  const cut = href.search(/[?#]/);
  return cut < 0 ? [href, ""] : [href.slice(0, cut), href.slice(cut)];
}

/**
 * A link in a language: the Ukrainian address of a page that has one, the
 * path as it is otherwise — English, or a page with one address for both
 * (the app's own pages, the legal texts), where the cookie keeps the language.
 * The query and the fragment ride along.
 */
export function localizedPath(href: string, locale: string): string {
  if (locale !== "uk" || !href.startsWith("/")) return href;
  const [path, suffix] = splitSuffix(href);
  if (splitUkPrefix(path).uk || !hasUkAddress(path)) return href;
  return (path === "/" ? UK_PREFIX : `${UK_PREFIX}${path}`) + suffix;
}

/** The one language cookie every surface reads — `PUBLIC_LOCALE_COOKIE` and `WORKSPACE_LOCALE_COOKIE` by their other names. */
export const LANGUAGE_COOKIE = "ryntra_hub_locale";

/** A request's `Cookie` header with the language set to `value`, every other cookie kept as it came. */
export function withLanguageCookie(cookieHeader: string | null, value: AddressLocale): string {
  const kept = (cookieHeader ?? "")
    .split(/;\s*/)
    .filter((part) => part.length > 0 && !part.startsWith(`${LANGUAGE_COOKIE}=`));
  return [...kept, `${LANGUAGE_COOKIE}=${value}`].join("; ");
}

/**
 * Where choosing a language leads from the address in the bar: the same page
 * at the chosen language's address — or `null` where the page has one address
 * for both, and the cookie alone decides (the page is asked for again).
 */
export function languageSwitchHref(pathname: string, search: string, next: AddressLocale): string | null {
  const { path } = splitUkPrefix(pathname);
  if (!hasUkAddress(solanaRoute(path))) return null;
  const target = next === "uk" ? (path === "/" ? UK_PREFIX : `${UK_PREFIX}${path}`) : path;
  return target + search;
}
