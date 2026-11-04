import type { Metadata } from "next";
import { PUBLIC_LOCALE_CODES } from "./i18n/locales.ts";
import { HOMEPAGE_CATEGORY, HOMEPAGE_COPY } from "../lib/site/homepage-copy.ts";
import { publicUrl } from "../lib/product/app-address.ts";
import { hasUkAddress, localizedPath } from "../lib/site/localized.ts";
import { marketsCard, type CardLocale, type CardSpec } from "./brand/page-card.ts";
import { LANDING_META } from "./(home)/landing-meta.ts";
import { MISSION_CONTROL_WORDS } from "../lib/mission-control/words.ts";
import { LANDING_IS_LIVE } from "../lib/site/home-to-app.ts";
import { CITY_CARD_SIZE, cityCardVersion } from "../city/lib/share/card.ts";
import { CARD_WORDS } from "../city/lib/share/words.ts";
import { pagePath as cityPagePath, type PageId as CityPageId } from "../city/lib/pages/pages.ts";

export const SITE = "https://ryntra.io";
/**
 * The share card's address carries the card's own fingerprint. Link caches
 * (X, Telegram, LinkedIn, Slack) key on this string for days; a redrawn
 * card at an unchanged address kept the retired brand on every post until
 * the cache chose to expire. Since CITY-158 (31.10) every card is the city's:
 * the live city's frame, the mark and one line (`city/lib/share/card.ts`).
 */
export const OG_IMAGE = `${SITE}/opengraph-image?v=${cityCardVersion()}`;
export const SITE_NAME = "Ryntra";
export const TWITTER = "@Ryntra_io";

/** The languages the product answers in (the cabinet and the guides). */
export const ALL_LOCALES = PUBLIC_LOCALE_CODES;
export const ROOT_LOCALE = "en" as const;
/**
 * The languages the public landing answers in: English at `/`, Ukrainian at
 * `/uk` — the new site of 2026-09-26. The address decides the language, so
 * each is a page a search engine can index, and the two name each other as
 * `hreflang` alternates.
 *
 * The history this list carries: from 2026-09-13 the landing was English and
 * dark only and `/uk` went to `/`; from 2026-09-26 `/` led into the app by a
 * temporary 307 while the new site was built. An `hreflang` naming a locale
 * that redirects away is worse than none, so the alternates are derived from
 * this list, not from `ALL_LOCALES`.
 */
export const LANDING_LOCALES = ["en", "uk"] as const;
export type SeoLocale = (typeof ALL_LOCALES)[number];
/**
 * The surfaces that have their own localized metadata.
 *
 * `methodology` was the second one, and it is gone: `/methodology` was one of
 * four public documents restating the same boundaries, and it now redirects
 * into the guides. The type stays a union of one rather than being deleted,
 * because the surface machinery below is what a second localized route will
 * need again — and because collapsing it would silently turn every
 * `urlForSurface(locale, x)` call into an unchecked landing link.
 */
export type SeoSurface = "landing";

export function pathForLocale(locale: string): string {
  return locale === ROOT_LOCALE ? "/" : `/${locale}`;
}

export function pathForSurface(locale: string, _surface: SeoSurface): string {
  return pathForLocale(locale);
}

export function urlForLocale(locale: string): string {
  const path = pathForLocale(locale);
  return `${SITE}${path === "/" ? "" : path}`;
}

export function urlForSurface(locale: string, surface: SeoSurface): string {
  const path = pathForSurface(locale, surface);
  return `${SITE}${path === "/" ? "" : path}`;
}

/**
 * SEO strings keyed by locale, including locales that are currently parked.
 *
 * `SeoLocale` narrows to whatever is public today, so typing these as
 * `Record<SeoLocale, …>` would force every parked translation to be deleted the
 * moment its locale left the public list — losing work that is meant to come
 * back. The entry for `en` is required; the rest are carried and unused until
 * their locale is unparked. Reads go through `copyFor`, which falls back to
 * English, so a missing key can never render as `undefined`.
 */
type ParkedByLocale<T> = { en: T } & Partial<Record<string, T>>;

export const OG_LOCALE: ParkedByLocale<string> = {
  en: "en_US",
  uk: "uk_UA",
  ru: "ru_RU",
};

type Copy = Readonly<{ title: string; description: string; keywords: readonly string[] }>;

/* The landing is the company entry point, so its title carries the brand line
   fixed for it (Positioning v3, `lib/site/homepage-copy.ts`). The developer
   descriptor belongs to the developer artifacts, which build their own
   metadata. */
const LANDING_TITLE: ParkedByLocale<string> = {
  en: HOMEPAGE_COPY.en.seoTitle,
  uk: HOMEPAGE_COPY.uk.seoTitle,
  ru: "Ryntra — инвестируй в токенизированные акции от $1, в своём кошельке, на Solana",
};

/* What the product is now (2026-09-26): what a person buys and from how
   much, the second way in — a rule — and the one boundary that matters in a
   search snippet: what is bought stays in the person's own wallet and every
   purchase is theirs to sign. */
const COMPACT_LANDING_DESCRIPTION: ParkedByLocale<string> = {
  en: HOMEPAGE_COPY.en.description,
  uk: HOMEPAGE_COPY.uk.description,
  ru: "Покупай токенизированные акции от $1 на Solana или настрой правило, чтобы инвестировать регулярно. Купленное остаётся в твоём кошельке, каждую покупку подписываешь ты.",
};

/* The words a person looking for this product uses (2026-09-26): tokenized
   stocks, from a dollar, a rule that buys regularly, one's own wallet.
   Nothing here names a provider, a venue or a feature that is not live. */
const KEYWORDS = [
  "tokenized stocks",
  "tokenized stocks on Solana",
  "invest from $1",
  "buy tokenized stocks",
  "private company tokens",
  "autoinvest",
  "non-custodial investing",
  "Solana wallet",
] as const;

function copyFor(locale: SeoLocale, _surface: SeoSurface): Copy {
  const pick = (map: ParkedByLocale<string>) => map[locale] ?? map.en;
  const description = pick(COMPACT_LANDING_DESCRIPTION);
  return { title: pick(LANDING_TITLE), description, keywords: KEYWORDS };
}

export const SEO_COPY = Object.fromEntries(
  ALL_LOCALES.map((locale) => [locale, copyFor(locale, "landing")]),
) as Record<SeoLocale, Copy>;

/**
 * A page's absolute address in a language — `https://ryntra.io/uk/docs` for
 * the documentation's hub in Ukrainian — or its one address where it has only
 * one (`lib/site/localized.ts`). No query, no trailing slash. Once
 * app.ryntra.io is live, the app's pages are named there:
 * `https://app.ryntra.io/uk/solana/home` (`lib/product/app-address.ts`).
 */
export function localizedUrl(path: string, locale: string): string {
  return publicUrl(localizedPath(path, locale));
}

/**
 * The `hreflang` pair of a page offered in both languages — English, Ukrainian
 * and `x-default` on the English — or none for a page with one address: an
 * alternate naming an address that does not exist is worse than none.
 */
export function languageAlternates(path: string): Record<string, string> | undefined {
  if (!hasUkAddress(path)) return undefined;
  return { en: localizedUrl(path, "en"), uk: localizedUrl(path, "uk"), "x-default": localizedUrl(path, "en") };
}

export function hreflangsFor(_surface: SeoSurface): Record<string, string> {
  return languageAlternates("/") ?? { en: SITE, "x-default": SITE };
}

/** The Open Graph locale of a page's language, and of the other language where the page has both. */
export function openGraphLocales(path: string, localeInput: string): Readonly<{ locale: string; alternateLocale?: string[] }> {
  const locale = safeLocale(localeInput);
  const other = LANDING_LOCALES.filter((item) => item !== locale).map((item) => OG_LOCALE[item] ?? OG_LOCALE.en);
  return hasUkAddress(path) ? { locale: OG_LOCALE[locale] ?? OG_LOCALE.en, alternateLocale: other } : { locale: OG_LOCALE[locale] ?? OG_LOCALE.en };
}

/**
 * A page's share card, as metadata names it. Since CITY-158 every page shows the city's card in its language — the
 * old pages' own titles are the old product's words — so the key and the page's card words no longer change the
 * picture; `/og/…` still answers the addresses older posts name.
 */
export function pageCardImage(locale: CardLocale, _key: readonly string[], _card: CardSpec): Readonly<{ url: string; alt: string }> {
  return { url: landingOgImage(locale), alt: cardAltFor(locale) };
}

function safeLocale(locale: string): SeoLocale {
  return (ALL_LOCALES as readonly string[]).includes(locale) ? (locale as SeoLocale) : ROOT_LOCALE;
}

/** The words of the city's card in a page's language: what the picture behind `landingOgImage` shows. */
export function cardAltFor(localeInput: string): string {
  return CARD_WORDS[safeLocale(localeInput) === "uk" ? "uk" : "en"].alt;
}

/**
 * The share card of each landing address, carrying the card's fingerprint:
 * the English card at `/opengraph-image`, the Ukrainian one at
 * `/uk/opengraph-image` (earlier only English existed), whose file sits in
 * `app/uk/`, outside the landing's route group, so the address is this plain
 * one and not a hashed one.
 */
export function landingOgImage(localeInput: string): string {
  return safeLocale(localeInput) === "uk" ? `${SITE}/uk/opengraph-image?v=${cityCardVersion()}` : OG_IMAGE;
}

/**
 * The landing's metadata, per address: the title within 60 characters for a
 * result and a tab, the description within 160, the product's full line on
 * the share card; canonical to itself, and English, Ukrainian and
 * `x-default` naming each other.
 */
export function buildLandingMetadata(localeInput: string): Metadata {
  const locale = safeLocale(localeInput);
  const meta = LANDING_META[locale];
  const canonical = urlForSurface(locale, "landing");
  const image = landingOgImage(locale);
  const alternateLocale = LANDING_LOCALES.filter((item) => item !== locale).map((item) => OG_LOCALE[item] ?? OG_LOCALE.en);

  return {
    title: { absolute: meta.title },
    description: meta.description,
    keywords: [...KEYWORDS],
    category: HOMEPAGE_CATEGORY,
    robots: { index: true, follow: true },
    alternates: { canonical, languages: hreflangsFor("landing") },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: meta.ogTitle,
      description: meta.description,
      url: canonical,
      locale: OG_LOCALE[locale] ?? OG_LOCALE.en,
      ...(alternateLocale.length ? { alternateLocale } : {}),
      images: [{ url: image, width: 1200, height: 630, alt: cardAltFor(locale) }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER,
      creator: TWITTER,
      title: meta.ogTitle,
      description: meta.description,
      images: [image],
    },
  };
}

/**
 * Mission Control's metadata — ryntra.io's home page since MC-0 (decision 68), in English only: decision 64's title and descriptor within 60 and 160 characters, and the scene's own card for X
 * (1200 × 675). `path` and `card` name a mission's Control Room or Launch Night; the home page is `/` with its card,
 * and `size` the card's own pixels where it is not 1200 × 675.
 */
export function buildMissionControlMetadata(
  words: Readonly<{ title: string; description: string }> = MISSION_CONTROL_WORDS,
  path = "/",
  card = "/api/launch/mission-card",
  size: Readonly<{ width: number; height: number }> = { width: 1200, height: 675 },
): Metadata {
  const canonical = path === "/" ? SITE : `${SITE}${path}`;
  const image = { url: `${SITE}${card}`, width: size.width, height: size.height, alt: words.title };
  return {
    title: { absolute: words.title },
    description: words.description,
    keywords: [...KEYWORDS],
    category: HOMEPAGE_CATEGORY,
    /* In the index once ryntra.io answers with the scene (`LANDING_IS_LIVE`); out of it while `HOME_TO_APP` leads into the app. */
    robots: { index: LANDING_IS_LIVE, follow: true },
    alternates: { canonical },
    openGraph: { type: "website", siteName: SITE_NAME, title: words.title, description: words.description, url: canonical, locale: OG_LOCALE.en, images: [image] },
    twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title: words.title, description: words.description, images: [image.url] },
  };
}

/**
 * Ryntra City, the home at `/` since decision 70 (2026-10-26): the live Solana market as a night city. The words
 * say what the city does today and grow with it; the share card is the city's own (CITY-158): a frame of the live 3D
 * city, the mark and the line, 1200 × 630 — the shape Open Graph and X draw a large card at.
 */
export const CITY_WORDS = {
  title: "Ryntra — your AI agent on Solana",
  description: "Say it, your AI agent does the rest: launch coins, trade and earn on Solana on autopilot. Watch your tower rise in a living 3D city.",
} as const;

export function buildCityMetadata(): Metadata {
  return buildMissionControlMetadata(CITY_WORDS, "/", `/opengraph-image?v=${cityCardVersion()}`, CITY_CARD_SIZE);
}

/**
 * Home's metadata — the app's first place, in words of its own as the app's
 * page; it used to carry the site's line, from the days `ryntra.io/` led
 * here. Its address in each language — `/app/home` and `/uk/app/home` — names
 * the other, and the share card is the landing's in the page's language.
 * Home, Markets and the companies' pages are the cabinet's addresses offered
 * to the index (`robots.ts`); nothing deeper is.
 */
export const APP_HOME_PATH = "/app/home" as const;
export const APP_MARKETS_PATH = "/app/markets" as const;

const APP_HOME_WORDS: Readonly<Record<"en" | "uk", Readonly<{ title: string; description: string }>>> = {
  en: {
    title: "Ryntra app — stocks, crypto, memes and your own token",
    description: "Connect a Solana wallet, top up, and buy tokenized stocks, crypto and memes — or launch your own token. Markets, bots and your notifications in one app.",
  },
  uk: {
    title: "Застосунок Ryntra — акції, крипта, меми й свій токен",
    description: "Підключи гаманець Solana, поповни й купуй токенізовані акції, крипту й меми — або запусти свій токен. Ринки, боти й сповіщення в одному застосунку.",
  },
};

const APP_MARKETS_WORDS: Readonly<Record<"en" | "uk", Readonly<{ title: string; description: string }>>> = {
  en: {
    title: "Markets — stocks, crypto and memes on Solana · Ryntra",
    description: "One screener for tokenized stocks, private companies, crypto and memes on Solana: price, change, volume, liquidity and market cap, sorted the way you choose.",
  },
  uk: {
    title: "Ринки — акції, крипта й меми на Solana · Ryntra",
    description: "Один скринер токенізованих акцій, приватних компаній, крипти й мемів на Solana: ціна, зміна, обсяг, ліквідність і капіталізація — у порядку, який обираєш ти.",
  },
};

/** The words of Home and Markets, for the pages' own structured data. */
export function appPageWords(page: "home" | "markets", localeInput: string): Readonly<{ title: string; description: string }> {
  const locale = safeLocale(localeInput) === "uk" ? "uk" : "en";
  return page === "home" ? APP_HOME_WORDS[locale] : APP_MARKETS_WORDS[locale];
}

/**
 * The metadata of a page offered to the index in both languages, in the
 * language it is drawn in: its canonical is that language's address, the
 * `hreflang` pair names both, and its card and words are the page's own.
 */
export function indexedPageMetadata(page: Readonly<{ path: string; locale: string; title: string; description: string; image: Readonly<{ url: string; alt: string }>; index?: boolean; keywords?: readonly string[] }>): Metadata {
  const canonical = localizedUrl(page.path, page.locale);
  const languages = languageAlternates(page.path);
  const index = page.index ?? true;
  return {
    title: { absolute: page.title },
    description: page.description,
    ...(page.keywords ? { keywords: [...page.keywords] } : {}),
    category: HOMEPAGE_CATEGORY,
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    alternates: { canonical, ...(index && languages ? { languages } : {}) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: page.title,
      description: page.description,
      url: canonical,
      ...openGraphLocales(page.path, page.locale),
      images: [{ url: page.image.url, width: 1200, height: 630, alt: page.image.alt }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER,
      creator: TWITTER,
      title: page.title,
      description: page.description,
      images: [page.image.url],
    },
  };
}

export function buildAppHomeMetadata(localeInput: string): Metadata {
  const locale = safeLocale(localeInput);
  const words = appPageWords("home", locale);
  return indexedPageMetadata({
    path: APP_HOME_PATH,
    locale,
    ...words,
    image: { url: landingOgImage(locale), alt: cardAltFor(locale) },
  });
}

/** Markets: the listed and private companies, crypto and dollars — its canonical never carries the tab (`?tab=`). */
export function buildAppMarketsMetadata(localeInput: string): Metadata {
  const locale = safeLocale(localeInput) === "uk" ? "uk" : "en";
  return indexedPageMetadata({
    path: APP_MARKETS_PATH,
    locale,
    ...appPageWords("markets", locale),
    image: pageCardImage(locale, ["markets"], marketsCard(locale)),
  });
}

/** The landing's metadata, by the name the site's older callers use. */
export function buildMetadata(locale: string): Metadata {
  return buildLandingMetadata(locale);
}

/**
 * The city's pages at their own addresses (CITY-157): Docs, Developers, AI chats (`/connector`, CITY-170), Help (at
 * `/support` and `/feedback`), About,
 * the Terms and the Privacy Policy — the same contents the city's menu opens as windows. Each names its own address;
 * `/feedback` is the same Help and points the index at `/support`. The share card is the city's still (CITY-64) until
 * the previews of every page are redrawn (CITY-158).
 */
export const CITY_PAGE_WORDS: Readonly<Record<CityPageId, Readonly<{ title: string; description: string }>>> = {
  docs: {
    title: "Ryntra Docs — your AI agent on Solana, explained",
    description: "How Ryntra works: the live city, buying and selling, launches, earning, your agent, every fee and how your money stays yours.",
  },
  developers: {
    title: "Developers — connect your agent to Ryntra",
    description: "Connect an agent to Ryntra on Solana: sign in with Solana, read what is open, prepare the transaction — the wallet signs it.",
  },
  connector: {
    title: "Ryntra in your AI chat — Solana market and pre-sign check",
    description: "Connect Ryntra to your AI chat: token passports, a coin's tower, the Solana market and a check of any transaction before you sign. Reads only — it never moves funds.",
  },
  help: {
    title: "Help — Ryntra",
    description: "Ask a question, report a problem, share an idea or a security issue. One form, read by the team that builds Ryntra.",
  },
  about: {
    title: "About Ryntra",
    description: "Ryntra is agentic finance on Solana: the market as a living city, every coin a tower. Non-custodial — your money stays in your wallet.",
  },
  terms: {
    title: "Terms of Use — Ryntra",
    description: "The Terms of Use of Ryntra: non-custodial access, the beta, eligibility, fees, Rewards, risks, third-party services and liability.",
  },
  privacy: {
    title: "Privacy Policy — Ryntra",
    description: "What Ryntra collects for a wallet, what the phone app keeps, what it never collects, who processes data and how to delete it.",
  },
};

export function buildCityPageMetadata(id: CityPageId, path: string = cityPagePath(id)): Metadata {
  const words = CITY_PAGE_WORDS[id];
  const own = cityPagePath(id);
  const base = buildMissionControlMetadata(words, own, `/opengraph-image?v=${cityCardVersion()}`, CITY_CARD_SIZE);
  /* A second address of the same page (`/feedback`) stays out of the index; its canonical is the page's own. */
  return { ...base, robots: { index: path === own, follow: true } };
}
