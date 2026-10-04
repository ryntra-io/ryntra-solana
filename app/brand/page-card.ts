import { companyCopy } from "../company/company-copy.ts";
import { contactCopy } from "../contact/contact-copy.ts";
import { supportCopy } from "../support/support-copy.ts";
import { DOC_PAGES } from "../docs/content/index.ts";
import { GROUP_TITLES } from "../docs/content/model.ts";
import { methodologyCopy } from "../methodology/methodology-copy.ts";
import { securityCopy } from "../security/security-copy.ts";
import { HELP_TOPICS } from "../shell/help-topics.ts";
import { STATS_COPY } from "../stats/copy.ts";
import { fnv1a } from "./og-version.ts";

/**
 * The share card of every page offered to the index: the landing's card
 * language — the wordmark, one headline, a line under it, the promise at the
 * foot and the R — with the page's own words, in the page's language.
 *
 * - a public page: its own name and headline;
 * - a documentation page: «Ryntra Docs» and its section, the page's title and
 *   the one sentence the index shows for it;
 * - Markets: what is on it, never a price;
 * - a company: its picture, name and token, what the token is in its
 *   issuer's words, «in your own wallet» — never a price and never «from $1»,
 *   since each company's minimum is its own.
 *
 * The words are read from the same sources the pages read, so a card cannot
 * say what its page no longer does. Its address carries the fingerprint of
 * everything drawn on it: link caches (X, Telegram, Slack) keep a card by its
 * address for days, and a changed card is a new address.
 */

export type CardLocale = "en" | "uk";

export type CardSpec = Readonly<{
  /** The small line over the headline: the page's section, or what a token is. */
  eyebrow: string;
  headline: string;
  /** A company's token, beside its name. */
  token: string | null;
  context: string | null;
  /** A company's picture, at the catalogue's own address — fetched when the card is drawn. */
  icon: string | null;
}>;

/** Bump when the card's drawing (`page-og.tsx`) changes without its words changing. */
export const PAGE_CARD_REVISION = "2026-09-27";

export const PAGE_CARD_IDS = ["company", "security", "methodology", "contact", "support", "stats"] as const;
export type PageCardId = (typeof PAGE_CARD_IDS)[number];

export function isPageCardId(value: string): value is PageCardId {
  return (PAGE_CARD_IDS as readonly string[]).includes(value);
}

/** A public page's card: its eyebrow and headline, as the page draws them. */
export function pageCard(id: PageCardId, locale: CardLocale): CardSpec {
  const hero =
    id === "company" ? companyCopy(locale).hero
    : id === "security" ? securityCopy(locale).hero
    : id === "methodology" ? methodologyCopy(locale).hero
    : id === "contact" ? contactCopy(locale).hero
    : id === "support" ? supportCopy(locale).hero
    : STATS_COPY[locale];
  return { eyebrow: hero.eyebrow, headline: hero.title, token: null, context: null, icon: null };
}

/** A documentation page's card — the hub's at the empty slug. */
export function docsCard(slug: string, locale: CardLocale): CardSpec | null {
  const page = DOC_PAGES.find((candidate) => candidate.slug === slug);
  if (!page) return null;
  const docs = locale === "uk" ? "Документація Ryntra" : "Ryntra Docs";
  return {
    eyebrow: slug ? `${docs} · ${GROUP_TITLES[page.group][locale]}` : docs,
    headline: page.title[locale],
    token: null,
    context: page.summary[locale],
    icon: null,
  };
}

/** Markets' card: what the place holds. */
export function marketsCard(locale: CardLocale): CardSpec {
  return locale === "uk"
    ? { eyebrow: "Ryntra · Ринки", headline: "Токенізовані акції на Solana", token: null, context: "Публічні й приватні компанії, крипта й долари — ціна в $ і купівля в доларах на сторінці кожної компанії.", icon: null }
    : { eyebrow: "Ryntra · Markets", headline: "Tokenized stocks on Solana", token: null, context: "Listed and private companies, crypto and dollars — the price in $ and a purchase in dollars on every company's page.", icon: null };
}

/** What a company's card is drawn from — the parts of its row that say what it is. */
export type CompanyCardInput = Readonly<{
  name: string;
  symbol: string;
  issuer: "xstocks" | "backpack" | "ondo" | "prestocks";
  icon: string | null;
}>;

const ISSUER_NAMES: Readonly<Record<CompanyCardInput["issuer"], string>> = { xstocks: "xStocks", backpack: "Backpack", ondo: "Ondo", prestocks: "PreStocks" };
const TRUTH = { xstocks: HELP_TOPICS.truthXStocks, backpack: HELP_TOPICS.truthBackpack, ondo: HELP_TOPICS.truthOndo, prestocks: HELP_TOPICS.truthPreStocks } as const;

/** A company's card: what the token is in its issuer's words, the company and its token, and where it stays. */
export function companyCard(company: CompanyCardInput, locale: CardLocale): CardSpec {
  return {
    eyebrow: `${TRUTH[company.issuer].title[locale]} · ${ISSUER_NAMES[company.issuer]}`,
    headline: company.name,
    token: company.symbol,
    context: locale === "uk" ? "У твоєму гаманці, на Solana." : "In your own wallet, on Solana.",
    icon: company.icon,
  };
}

/** The card's own words, for `og:image:alt` — what the picture says, nothing more. */
export function cardAlt(card: CardSpec): string {
  const head = card.token ? `${card.headline} (${card.token})` : card.headline;
  return [card.eyebrow, head, card.context].filter(Boolean).join(" — ");
}

/** The card's address under the site: `/og/uk/docs/invest/buy?v=…`, the fingerprint of everything drawn. */
export function cardPath(locale: CardLocale, key: readonly string[], card: CardSpec): string {
  const version = fnv1a([PAGE_CARD_REVISION, locale, card.eyebrow, card.headline, card.token ?? "", card.context ?? "", card.icon ?? ""].join("|"));
  return `/og/${locale}/${key.map(encodeURIComponent).join("/")}?v=${version}`;
}
