import type { MenuDestinationId, ProductPageId } from "../../shell/domains.ts";

/**
 * The documentation's content model.
 *
 * Every page is data — bilingual text in fixed shapes — rendered by one
 * component, so the two languages cannot drift in structure, a search can see
 * every sentence, and a test can walk every page: both languages present,
 * every figure the same one the product computes with, every link a route
 * that answers, no internal vocabulary. Prose that lives in a component is
 * prose nobody can check.
 */

export type Localized<T = string> = Readonly<{ en: T; uk: T }>;

export type DocBlock =
  | Readonly<{ kind: "p"; text: Localized }>
  /** Numbered — the order matters (what to do, in sequence). */
  | Readonly<{ kind: "steps"; items: Localized<readonly string[]> }>
  /** Unordered — the order is editorial. */
  | Readonly<{ kind: "list"; items: Localized<readonly string[]> }>
  | Readonly<{ kind: "table"; head: Localized<readonly string[]>; rows: Localized<readonly (readonly string[])[]> }>
  /** Something the reader must not miss: a boundary, a cost, a rule. */
  | Readonly<{ kind: "note"; tone: "info" | "caution"; text: Localized }>
  /** Label → value pairs, at a glance. */
  | Readonly<{ kind: "facts"; items: Localized<readonly (readonly [string, string])[]> }>
  /** The product pages with group and readiness, drawn from the route registry. */
  | Readonly<{ kind: "product-pages" }>
  /** The ways to the site's own pages — Security, where the figures come from, About, Contact. */
  | Readonly<{ kind: "links"; items: readonly Readonly<{ href: string; label: Localized }>[] }>;

export type DocSection = Readonly<{
  id: string;
  heading: Localized;
  blocks: readonly DocBlock[];
}>;

/**
 * The documentation's sections are the menu's: Start, then Invest · Trade ·
 * Money · Portfolio · Ryntra · Rewards as the app draws them, then Reference and
 * Developers. A page keeps its address when it changes section — `money/rewards`
 * stands under Rewards, `strategies/*` and `manage/*` under Portfolio — so no
 * link anyone holds moves; a page that moved address answers by a 308.
 */
export const DOC_GROUP_IDS = ["start", "invest", "trade", "money", "portfolio", "ryntra", "rewards", "reference", "developers"] as const;
export type DocGroupId = (typeof DOC_GROUP_IDS)[number];

/** The first segment of a page's address: its section's own, or the one the page kept when it moved. */
export const DOC_PATH_PREFIXES = ["start", "invest", "trade", "money", "strategies", "manage", "ryntra", "reference"] as const;

export type DocPage = Readonly<{
  /** The path under `/docs/` — `trade/swap` answers at `/docs/trade/swap`. */
  slug: string;
  group: DocGroupId;
  /** The product page this document describes, when it describes one; its readiness comes from the registry. */
  pageId?: ProductPageId;
  /** A place of the menu that is not a registered page — Markets, Autoinvest, Top up, Ryntra — that «Open in Ryntra» leads to. */
  destination?: MenuDestinationId;
  title: Localized;
  /** The title a search result and a browser tab show, when it says more than the heading does; else «{title} — Ryntra Docs». */
  seoTitle?: Localized;
  /** One sentence for the index, the card and the search. */
  summary: Localized;
  sections: readonly DocSection[];
  /** Other pages worth reading next, as slugs. */
  related?: readonly string[];
}>;

export const GROUP_TITLES: Readonly<Record<DocGroupId, Localized>> = {
  start: { en: "Start here", uk: "Почати" },
  invest: { en: "Invest", uk: "Інвестувати" },
  trade: { en: "Trade", uk: "Торгувати" },
  money: { en: "Money", uk: "Гроші" },
  portfolio: { en: "Portfolio", uk: "Портфель" },
  ryntra: { en: "Ryntra", uk: "Ryntra" },
  rewards: { en: "Rewards", uk: "Винагороди" },
  reference: { en: "Reference", uk: "Довідка" },
  developers: { en: "Developers", uk: "Розробникам" },
};

/* Small constructors so the content files read as content. */
export const p = (en: string, uk: string): DocBlock => ({ kind: "p", text: { en, uk } });
export const steps = (en: readonly string[], uk: readonly string[]): DocBlock => ({ kind: "steps", items: { en, uk } });
export const list = (en: readonly string[], uk: readonly string[]): DocBlock => ({ kind: "list", items: { en, uk } });
export const note = (en: string, uk: string, tone: "info" | "caution" = "info"): DocBlock => ({ kind: "note", tone, text: { en, uk } });
export const facts = (en: readonly (readonly [string, string])[], uk: readonly (readonly [string, string])[]): DocBlock => ({ kind: "facts", items: { en, uk } });
export const table = (
  head: Localized<readonly string[]>,
  rows: Localized<readonly (readonly string[])[]>,
): DocBlock => ({ kind: "table", head, rows });
export const productPages = (): DocBlock => ({ kind: "product-pages" });
export const links = (items: readonly Readonly<{ href: string; en: string; uk: string }>[]): DocBlock => ({
  kind: "links",
  items: items.map(({ href, en, uk }) => ({ href, label: { en, uk } })),
});
export const section = (id: string, en: string, uk: string, blocks: readonly DocBlock[]): DocSection => ({ id, heading: { en, uk }, blocks });
