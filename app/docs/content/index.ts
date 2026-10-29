import { BOTS_PAGE } from "./bots.ts";
import { AUTOINVEST_PAGE, BUY, COMPANY_PAGE, PRIVATE_COMPANIES, WHAT_YOU_BUY } from "./invest.ts";
import { CREATOR, LAUNCH } from "./launch.ts";
import { ACTIVITY, POOLS, PORTFOLIO, SETTINGS } from "./manage.ts";
import { DOC_GROUP_IDS, GROUP_TITLES, type DocGroupId, type DocPage, type Localized } from "./model.ts";
import { RECEIVE, REFERRALS, REWARDS_PAGE, SEND, TOP_UP_PAGE } from "./money.ts";
import { PERPS_PAGE } from "./perps.ts";
import { PHONE } from "./phone.ts";
import { PREDICTIONS_PAGE } from "./predictions.ts";
import { REFERENCE_PAGES } from "./reference.ts";
import { ASSISTANT } from "./ryntra.ts";
import { SOON } from "./soon.ts";
import { CABINET, GETTING_STARTED, OVERVIEW, WALLET } from "./start.ts";
import { MY_STRATEGIES, RESULTS, STRATEGIES_OVERVIEW } from "./strategies.ts";
import { BRIDGE, SCREENER, SPOT, SWAP, TRADE_OVERVIEW, TRENDS } from "./trade.ts";

/**
 * Every documentation page, in reading order — the products a person uses: Start,
 * Trading, Perps, Predictions, Bots and grid, Launch, Portfolio and pools, Money and wallet, Rewards, the assistant,
 * the phone, then Reference, and the one short page for teams, agents and developers. The overview (slug "") is
 * `/docs`; every other slug answers at `/docs/<slug>`.
 */
export const DOC_PAGES: readonly DocPage[] = [
  OVERVIEW,
  GETTING_STARTED,
  CABINET,
  SETTINGS,
  TRADE_OVERVIEW,
  SPOT,
  SWAP,
  SCREENER,
  TRENDS,
  BUY,
  COMPANY_PAGE,
  WHAT_YOU_BUY,
  PRIVATE_COMPANIES,
  PERPS_PAGE,
  PREDICTIONS_PAGE,
  BOTS_PAGE,
  AUTOINVEST_PAGE,
  MY_STRATEGIES,
  RESULTS,
  STRATEGIES_OVERVIEW,
  LAUNCH,
  CREATOR,
  PORTFOLIO,
  POOLS,
  WALLET,
  TOP_UP_PAGE,
  SEND,
  RECEIVE,
  BRIDGE,
  ACTIVITY,
  REWARDS_PAGE,
  REFERRALS,
  ASSISTANT,
  PHONE,
  ...REFERENCE_PAGES,
  SOON,
];

/**
 * The developer references keep their own routes and their own renderer
 * (`docs-experience.tsx`) and answer by their own links; since F3
 * the navigation lists none of them — «Teams, agents and developers» is the
 * one page it holds for them.
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
      href: "/support",
      title: { en: "Support", uk: "Підтримка" },
      summary: { en: "Where to ask, what to send with your question, and the answers people look for first.", uk: "Куди писати, що додати до запитання, і відповіді, які шукають першими." },
    },
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
};

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}` : "/docs");

export function docPageBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export type DocNavItem = Readonly<{ href: string; title: Localized; summary: Localized; slug?: string }>;
export type DocNavGroup = Readonly<{ id: DocGroupId; title: Localized; items: readonly DocNavItem[] }>;

/** The sidebar: the products, then Reference and «Teams, agents, developers», each with its pages in reading order and the site's own pages it points to. */
export const DOC_NAV: readonly DocNavGroup[] = DOC_GROUP_IDS.map((id) => {
  const site = (SITE_ENTRIES[id] ?? []).map((entry) => ({ href: entry.href, title: entry.title, summary: entry.summary }));
  const docs = DOC_PAGES.filter((page) => page.group === id).map((page) => ({ href: docsHref(page.slug), title: page.title, summary: page.summary, slug: page.slug }));
  return { id, title: GROUP_TITLES[id], items: [...docs, ...site] };
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
