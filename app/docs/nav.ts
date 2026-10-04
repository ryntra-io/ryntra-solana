/**
 * The documentation tree, in one place.
 *
 * `/docs` was one 1,028-line page with ten chapters on it. That page answered
 * two different questions in one scroll — *what are you building* and *what can
 * I rely on today* — and a reader looking for the second had to pass the first.
 * The public information architecture separates them, and this file is the
 * separation: every documentation destination, its group, and the class of
 * thing it is.
 *
 * One rule, inherited from `app/site/nav.ts` and worth repeating because it is
 * the one that rots: **every entry points at something that exists.** A test
 * walks this tree and opens each route.
 */

export type PageClass = "Architecture" | "Guide" | "Capability" | "Reference";

export type DocEntry = Readonly<{
  href: string;
  label: string;
  /** One line, shown on the hub. Not a teaser — a description of the contents. */
  note: string;
  pageClass: PageClass;
  /** Leaves Ryntra's documentation for another public surface. */
  external?: boolean;
}>;

export type DocGroup = Readonly<{
  id: string;
  label: string;
  /** Why this group exists, shown once on the hub. */
  note: string;
  entries: readonly DocEntry[];
}>;

export const DOCS_GROUPS: readonly DocGroup[] = [
  {
    id: "start",
    label: "Start here",
    note: "What Ryntra is, how the loop runs, and the words the rest of the documentation uses.",
    entries: [
      {
        href: "/docs/introduction",
        label: "Introduction",
        note: "The category, who it is for, and the four commitments that bound it: non-custodial, venue-neutral, paper-first, human-authorized.",
        pageClass: "Guide",
      },
      {
        href: "/docs/how-ryntra-works",
        label: "How Ryntra works",
        note: "One lifecycle from discovery to journal, and the product model each stage belongs to.",
        pageClass: "Architecture",
      },
      {
        href: "/docs/core-principles",
        label: "Decision method",
        note: "How a decision is evaluated: risk dimensions, evidence sufficiency, the deterministic governor, and what a BLOCK means.",
        pageClass: "Architecture",
      },
      {
        href: "/docs/glossary",
        label: "Glossary",
        note: "Network, venue, protocol, adapter, passport, StrategySpec, governor, action, authorization, receipt, and the two state vocabularies.",
        pageClass: "Reference",
      },
    ],
  },
  {
    id: "truth",
    label: "What is true today",
    note: "Release truth, kept apart from design direction on purpose — they answer different questions.",
    entries: [
      {
        href: "/docs/current-capabilities",
        label: "Current capabilities",
        note: "Every registered capability with its state, environment, mode, scope, evidence and review date, rendered from the registry rather than written here.",
        pageClass: "Capability",
      },
      {
        href: "/docs/roadmap",
        label: "Roadmap",
        note: "What is being built next — risk, strategy, agents and the ecosystem waves — gated by capability rather than by date.",
        pageClass: "Reference",
      },
      {
        href: "/docs/changelog",
        label: "Changelog",
        note: "Public product-relevant changes, with the capability each one moved.",
        pageClass: "Reference",
      },
    ],
  },
  {
    id: "product",
    label: "The product",
    note: "What is being built and why it is shaped this way. Design direction, not availability.",
    entries: [
      {
        href: "/docs/product-paper",
        label: "Product & Architecture Paper",
        note: "The whole system in one document: thesis, principles, the Evidence Kernel, every product archetype including Agent Control, every ecosystem pack, and the boundaries.",
        pageClass: "Architecture",
      },
      {
        href: "/docs/receipts-journal",
        label: "Evidence & receipts",
        note: "What a receipt binds, why a transaction hash is not one, and how a past decision is reviewed.",
        pageClass: "Architecture",
      },
      {
        href: "/docs/ryntra-home",
        label: "Ryntra Home",
        note: "Every Home surface, the question it answers, what it refuses to do, and the three capabilities that are not enabled with the exact record that would open each one.",
        pageClass: "Reference",
      },
      {
        href: "/docs/agent-control",
        label: "Agent Control",
        note: "Every Agent Control surface, what it refuses, the one write path that is not a page, and everything designed but not built — each with the exact gate that would open it.",
        pageClass: "Reference",
      },
      {
        href: "/docs/ecosystems",
        label: "Ecosystem workspaces",
        note: "Every registered chain pack and venue adapter — Robinhood Chain, Solana, Stellar, Base, Starknet, Arcus and Uniswap — and the exact point each one stops.",
        pageClass: "Reference",
      },
    ],
  },
  {
    id: "elsewhere",
    label: "Elsewhere",
    note: "Documentation that lives on its own surface because it answers to a different reader.",
    entries: [
      {
        href: "/security",
        label: "Security",
        note: "What Ryntra can access, what it structurally cannot, and what has not been audited.",
        pageClass: "Reference",
        external: true,
      },
      {
        href: "/developers",
        label: "Developers",
        note: "The API, its authentication, idempotency and errors, and the SDK.",
        pageClass: "Reference",
        external: true,
      },
      {
        href: "/docs/faq",
        label: "FAQ",
        note: "The questions a reviewer asks first, answered without marketing.",
        pageClass: "Guide",
      },
    ],
  },
];

/** Every documentation route, flattened — for navigation, tests and sitemaps. */
export const DOCS_ENTRIES: readonly DocEntry[] = DOCS_GROUPS.flatMap((group) => group.entries);

/** The routes this segment actually serves, i.e. excluding the two that do not. */
export const DOCS_ROUTES: readonly string[] = DOCS_ENTRIES.filter((entry) => !entry.external).map(
  (entry) => entry.href,
);

export function entryFor(href: string): DocEntry | undefined {
  return DOCS_ENTRIES.find((entry) => entry.href === href);
}

export function groupFor(href: string): DocGroup | undefined {
  return DOCS_GROUPS.find((group) => group.entries.some((entry) => entry.href === href));
}
