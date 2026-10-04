import { INVEST_PAGES } from "./invest.ts";
import { ACTIVITY, PORTFOLIO, SETTINGS } from "./manage.ts";
import { DOC_GROUP_IDS, GROUP_TITLES, type DocGroupId, type DocPage, type Localized } from "./model.ts";
import { MONEY_PAGES, REWARDS_PAGES } from "./money.ts";
import { REFERENCE_PAGES } from "./reference.ts";
import { RYNTRA_PAGES } from "./ryntra.ts";
import { START_PAGES } from "./start.ts";
import { STRATEGY_PAGES } from "./strategies.ts";
import { SCREENER, SPOT, SWAP, TRENDS } from "./trade.ts";

/**
 * Every documentation page, in reading order — the menu's order: Start,
 * Invest, Trade, Money, Portfolio, Ryntra, Rewards, then Reference. The
 * overview (slug "") is `/docs`; every other slug answers at `/docs/<slug>`.
 */
export const DOC_PAGES: readonly DocPage[] = [
  ...START_PAGES,
  SETTINGS,
  ...INVEST_PAGES,
  SWAP,
  SPOT,
  SCREENER,
  TRENDS,
  ...MONEY_PAGES,
  PORTFOLIO,
  ...STRATEGY_PAGES,
  ACTIVITY,
  ...RYNTRA_PAGES,
  ...REWARDS_PAGES,
  ...REFERENCE_PAGES,
];

/**
 * The developer references keep their own routes and their own renderer
 * (`docs-experience.tsx`); the navigation lists them beside the product
 * pages so a reader finds them from the same place.
 */
export type DeveloperEntry = Readonly<{ href: string; title: Localized; summary: Localized }>;
export const DEVELOPER_ENTRIES: readonly DeveloperEntry[] = [
  {
    href: "/docs/developers",
    title: { en: "Developer overview", uk: "Огляд для розробників" },
    summary: { en: "Two ways in: run the open repository, or call Agent Control.", uk: "Два входи: запустити відкритий репозиторій або викликати Agent Control." },
  },
  {
    href: "/docs/developers/agent-control",
    title: { en: "Agent Control", uk: "Agent Control" },
    summary: { en: "Typed client, HTTP and local MCP reference for public inspection and preflight.", uk: "Типізований клієнт, HTTP і локальний MCP для публічного читання та preflight." },
  },
];

/**
 * The site's own pages a section of the documentation points to, beside its
 * documents: Security and where the figures come from under Reference (the
 * documentation's «Security and risk» page became `/security` itself), and
 * the public repository first under Developers. They are pages of the site,
 * not of the documentation, so they render as themselves.
 */
export const SITE_ENTRIES: Readonly<Partial<Record<DocGroupId, readonly DeveloperEntry[]>>> = {
  reference: [
    {
      href: "/security",
      title: { en: "Security", uk: "Безпека" },
      summary: { en: "What Ryntra can touch and what it cannot, what has not been audited, and how to report an issue.", uk: "Чого Ryntra може торкнутися й чого ні, що не проходило аудиту і як повідомити про проблему." },
    },
    {
      href: "/methodology",
      title: { en: "Where the figures come from", uk: "Звідки цифри" },
      summary: { en: "Every figure Ryntra shows, its source and its time.", uk: "Кожна цифра в Ryntra, її джерело й час." },
    },
  ],
  developers: [
    {
      href: "/developers",
      title: { en: "Open source", uk: "Відкритий код" },
      summary: { en: "The public repository: what is open, how to run it and what it does not claim.", uk: "Публічний репозиторій: що відкрито, як запустити і чого він не стверджує." },
    },
  ],
};

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}` : "/docs");

export function docPageBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export type DocNavItem = Readonly<{ href: string; title: Localized; summary: Localized; slug?: string }>;
export type DocNavGroup = Readonly<{ id: DocGroupId; title: Localized; items: readonly DocNavItem[] }>;

/** The sidebar: the menu's sections, then Reference and Developers, each with its pages in reading order and the site's own pages it points to. */
export const DOC_NAV: readonly DocNavGroup[] = DOC_GROUP_IDS.map((id) => {
  const site = (SITE_ENTRIES[id] ?? []).map((entry) => ({ href: entry.href, title: entry.title, summary: entry.summary }));
  const pages =
    id === "developers"
      ? DEVELOPER_ENTRIES.map((entry) => ({ href: entry.href, title: entry.title, summary: entry.summary }))
      : DOC_PAGES.filter((page) => page.group === id).map((page) => ({ href: docsHref(page.slug), title: page.title, summary: page.summary, slug: page.slug }));
  return { id, title: GROUP_TITLES[id], items: id === "developers" ? [...site, ...pages] : [...pages, ...site] };
});

/** The page before and after, in reading order, for the footer of an article. */
export function docNeighbours(slug: string): Readonly<{ previous: DocPage | null; next: DocPage | null }> {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  if (index < 0) return { previous: null, next: null };
  return { previous: DOC_PAGES[index - 1] ?? null, next: DOC_PAGES[index + 1] ?? null };
}

/** Everything a search may match on one page, in one language, lower-cased. */
export function docSearchText(page: DocPage, locale: "en" | "uk"): string {
  const parts: string[] = [page.title[locale], page.summary[locale]];
  for (const section of page.sections) {
    parts.push(section.heading[locale]);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "p":
        case "note":
          parts.push(block.text[locale]);
          break;
        case "steps":
        case "list":
          parts.push(...block.items[locale]);
          break;
        case "table":
          parts.push(...block.head[locale], ...block.rows[locale].flat());
          break;
        case "facts":
          parts.push(...block.items[locale].flat());
          break;
        case "product-pages":
          break;
        case "links":
          parts.push(...block.items.map((item) => item.label[locale]));
          break;
      }
    }
  }
  return parts.join(" ").toLocaleLowerCase(locale === "uk" ? "uk" : "en");
}
