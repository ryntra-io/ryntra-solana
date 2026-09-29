/**
 * The public navigation, in one place, with one rule.
 *
 * Every entry points at something that exists. The previous site grew a header
 * link to `#how`, an id no section rendered — nothing threw, nothing looked
 * broken, and the link simply did nothing for every visitor who asked the most
 * basic question a site has to answer.
 *
 * The second rule is just as load-bearing: the header is not a sitemap. It once
 * carried five mega-menu categories over twenty destinations, repeated all of
 * them in the footer and gave every internal artifact equal weight. The menu
 * below is different: one product-family disclosure answers a single visitor
 * question — "what can I open?" — and the two direct global paths stay direct.
 * Stellar and Solana remain ecosystem workspaces, while Agent Control is a
 * domain workspace under Ryntra; none becomes a separate brand.
 */

import { ecosystemById, type EcosystemState } from "../../lib/product/ecosystems.ts";
import { REGISTRY_MATURITY } from "../../lib/product/capability-maturity.ts";
import { CONTACTS, REPOSITORY_URL } from "../../lib/site/contacts.ts";

export type NavItem = Readonly<{
  href: string;
  label: string;
  /** One line explaining where the link goes. Used by the mobile sheet. */
  note?: string;
  external?: boolean;
}>;

export type NavGroup = Readonly<{
  id: string;
  label: string;
  items: readonly NavItem[];
}>;

export type ProductNavItem = Readonly<{
  id: string;
  href: string | null;
  label: string;
  note: string;
  state?: "testnet_verified" | "read_only" | "preview" | "research" | "beta";
  stateLabel?: "Testnet verified" | "Read-only" | "Preview" | "Research" | "Beta";
}>;

export type ProductNavGroup = Readonly<{
  id: "open" | "cabinet" | "understand";
  label: string;
  items: readonly ProductNavItem[];
}>;

/**
 * The header's one action: go where the doors are.
 *
 * It replaced `Request beta access` as the primary CTA on 2026-08-17, on the
 * founder's direct instruction, because the loudest button on the site gated
 * the smallest part of it: four workspaces open with no account at all, and
 * the one thing beta actually gates is the cabinet. A first-time visitor read
 * "beta" and concluded the product was closed — including, on a bad night,
 * the founder. Beta keeps its honest places: the cabinet row in the menu,
 * the homepage story, and the mobile sheet's second button.
 */
export const WORKSPACES_HREF = "/workspaces";
export const WORKSPACES_CTA_LABEL = "Open a workspace";

/**
 * The consumer entry point.
 *
 * Named for where it goes rather than for where a visitor eventually arrives.
 * It was `WORKSPACE_HREF`, and every button bound to it said `Open Workspace` —
 * but `/beta` is a Telegram confirmation gate, so the label promised a product
 * and delivered a form. A constant named after the destination makes that
 * mismatch hard to write again, and it is also why the header CTA says
 * `Request beta access` rather than the shorter `Open beta`: nothing opens.
 */
export const BETA_HREF = "/beta";
/**
 * The label every beta action carries, in one place.
 *
 * It lived as a literal in three files and drifted: the header said one thing
 * and the homepage another, and the test meant to catch that matched a prose
 * comment quoting the old wording instead. A constant makes the mismatch
 * impossible rather than detectable.
 */
export const BETA_CTA_LABEL = "Request beta access";
/** The single documentation hub. */
export const DOCS_HREF = "/docs";
/**
 * The single developer surface.
 *
 * An older shortcut used to be its own destination beside two more developer
 * links. One portal replaced all three, and the shortcut redirects so every
 * link that was ever sent to it keeps working.
 */
export const GUARD_HREF = "/developers";
/**
 * The bounded public extraction. Not the exact local candidate — see
 * `/docs/changelog`.
 *
 * Re-exported rather than declared: the footer needs the same URL and cannot
 * import this module, because everything below evaluates the capability
 * registry at module scope. One literal, in `lib/site/contacts.ts`.
 */
export { REPOSITORY_URL };
export const CONTACT_EMAIL = CONTACTS.email;

const ECOSYSTEM_STATE_LABEL: Readonly<
  Record<Extract<EcosystemState, "testnet_verified" | "read_only" | "research">, "Testnet verified" | "Read-only" | "Research">
> = {
  testnet_verified: "Testnet verified",
  read_only: "Read-only",
  research: "Research",
};

function ecosystemNavigationState(id: "stellar" | "solana") {
  const ecosystem = ecosystemById(id);
  if (!ecosystem || (ecosystem.state !== "testnet_verified" && ecosystem.state !== "read_only" && ecosystem.state !== "research")) {
    throw new Error(`Navigation ecosystem ${id} has an unsupported or missing state.`);
  }
  return {
    state: ecosystem.state,
    stateLabel: ECOSYSTEM_STATE_LABEL[ecosystem.state],
  } as const;
}

function agentControlNavigationState() {
  const maturity = REGISTRY_MATURITY["agent-control-preflight"];
  if (maturity !== "preview") {
    throw new Error("Agent Control navigation may render only from the preview registry state.");
  }
  return { state: maturity, stateLabel: "Preview" } as const;
}

/**
 * The menu answers the visitor's first question — "where do I go?" — before
 * any other.
 *
 * The two-group version this replaces mixed abstractions ("Ryntra Workspace",
 * which meant the cabinet) with places (the ecosystem hubs), linked the places to
 * their landings rather than their doors, and did not link the Workspace Map
 * at all — so the answer to "how do I get into a workspace" was three hops
 * long and started with a guess. Founder-reported, at night, as "я сам не
 * розумію, куди деяка вкладка".
 *
 * Three groups now, in the order of a real visit: the doors that open with no
 * account (straight to each workspace, not to prose about it), the cabinet
 * with its honest Beta chip — the only thing beta gates — and the pages that
 * explain. Every state chip still resolves from the registries; a group id is
 * typed so a fourth group is a deliberate change.
 */
export const PRODUCT_NAV_GROUPS: readonly ProductNavGroup[] = [
  {
    id: "open",
    label: "Open now — no account",
    items: [
      {
        id: "stellar",
        href: "/stellar/workspace",
        label: "Stellar Hub",
        note: "RWA assets, issuer controls and holder rights — mainnet reads, testnet actions.",
        ...ecosystemNavigationState("stellar"),
      },
      {
        id: "solana",
        href: "/solana/workspace",
        label: "Solana Markets",
        note: "Mint identity, issuer powers and judged swap previews, read-only.",
        ...ecosystemNavigationState("solana"),
      },
      {
        id: "agents",
        href: "/agents/workspace",
        label: "Agent Control",
        note: "Agent passports, action previews and outcome evidence.",
        ...agentControlNavigationState(),
      },
    ],
  },
  {
    id: "cabinet",
    label: "Your cabinet",
    items: [
      {
        id: "cabinet",
        href: "/app",
        label: "Ryntra Home",
        note: "Portfolio, planning and journal. One Telegram confirmation; free during beta.",
        state: "beta",
        stateLabel: "Beta",
      },
    ],
  },
  {
    id: "understand",
    label: "Understand Ryntra",
    items: [
      {
        id: "overview",
        href: "/",
        label: "Ryntra overview",
        note: "The product, its decision loop and what is available today.",
      },
      {
        id: "guard",
        href: GUARD_HREF,
        label: "Developer platform",
        note: "Developer APIs and evidence contracts over the shared kernel.",
      },
      {
        id: "map",
        href: WORKSPACES_HREF,
        label: "All workspaces & directions",
        note: "Everything you can open today, and every registered direction with the exact point it stops.",
      },
    ],
  },
];

/** Paths that make the whole Products family the active global destination. */
export const PRODUCT_PATH_PREFIXES = ["/app", "/stellar", "/solana", "/agents"] as const;

/**
 * Direct global paths beside the Products disclosure and the one action.
 */
export const PRIMARY_NAV: readonly (NavItem & { id: string })[] = [
  { id: "docs", href: DOCS_HREF, label: "Docs", note: "The Handbook: capabilities, method, evidence, security, roadmap." },
  { id: "developers", href: GUARD_HREF, label: "Developers", note: "APIs, architecture, limits and what is not published." },
];

/**
 * The footer: three short columns, and nothing that repeats itself.
 *
 * Company and legal facts live here and only here — they are easy to find and
 * they do not compete with the product story at the top of every page.
 */
export const FOOTER_GROUPS: readonly NavGroup[] = [
  {
    id: "product",
    label: "Workspaces",
    items: [
      { href: "/stellar", label: "Stellar" },
      { href: "/solana", label: "Solana" },
      { href: "/agents", label: "Agent Control" },
      { href: WORKSPACES_HREF, label: "Workspace Map" },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { href: DOCS_HREF, label: "Docs" },
      { href: GUARD_HREF, label: "Developers" },
      { href: REPOSITORY_URL, label: "GitHub", external: true },
    ],
  },
  {
    id: "company",
    label: "Company",
    items: [
      { href: "/company", label: "About" },
      { href: `mailto:${CONTACT_EMAIL}`, label: "Contact", external: true },
    ],
  },
];

/**
 * Retained so the navigation test keeps checking every destination the chrome
 * can reach. It is the same list the header and footer render — there is no
 * second source of navigation truth.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "products",
    label: "Products",
    items: PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.flatMap((item) =>
        item.href ? [{ href: item.href, label: item.label, note: item.note }] : [],
      ),
    ),
  },
  { id: "primary", label: "Primary", items: PRIMARY_NAV },
  ...FOOTER_GROUPS,
];
