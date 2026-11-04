/**
 * The city's pages (CITY-157): Docs, Developers, AI chats (the connector's documentation, CITY-170), Help, About, the
 * Terms and the Privacy Policy. Each one is a window of
 * the city, opened from the menu (☰) over the live city, and the same contents stand as a page of their own at the
 * address the site always had — the address a store, a search engine or a post needs (`/legal/privacy`, `/support`).
 * Nothing of the old site's pages is used: the words are new (`city/components/pages/words.ts`), the legal texts are
 * the published ones, as data (`lib/legal/texts/*`).
 *
 * Pure data, no React: the tests read it in Node.
 */

export const PAGE_IDS = ['docs', 'developers', 'connector', 'help', 'about', 'terms', 'privacy'] as const;
export type PageId = (typeof PAGE_IDS)[number];

/** The addresses each page answers at; the first is its own (the canonical one). Support and Feedback are one Help. */
export const PAGE_PATHS: Readonly<Record<PageId, readonly string[]>> = {
  docs: ['/docs'],
  developers: ['/developers'],
  // Ryntra in AI chats: how to connect, what it reads and checks, privacy, limits, support (CITY-170).
  connector: ['/connector'],
  help: ['/support', '/feedback'],
  about: ['/about'],
  terms: ['/legal/terms'],
  privacy: ['/legal/privacy'],
};

export function pagePath(id: PageId): string {
  return PAGE_PATHS[id][0]!;
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value);
}

/** The page an address of the site is, with its anchor (`/legal/privacy#android`), or null for any other address. */
export function pageOfHref(href: string): Readonly<{ id: PageId; hash: string }> | null {
  const [path, hash = ''] = href.split('#');
  for (const id of PAGE_IDS) if (PAGE_PATHS[id].includes(path ?? '')) return { id, hash };
  return null;
}

/**
 * The site's three documents that stand at their own address only, never as a window (CITY-177): «What we're
 * building» — how Ryntra works, in full, with its PDF; the partner page with «Copy my link»; and the public roadmap. The
 * menu (☰) and the foot of every page of the site lead to them.
 */
export const SITE_DOCS = ['build', 'partners', 'roadmap'] as const;
export type SiteDocId = (typeof SITE_DOCS)[number];

export const SITE_DOC_PATHS: Readonly<Record<SiteDocId, string>> = {
  build: '/build',
  partners: '/partners',
  roadmap: '/roadmap',
};

/** The menu's documents that leave the city for their own page; «Partners» is the menu's own window above them. */
export const MENU_SITE_DOCS: readonly SiteDocId[] = ['build', 'roadmap'];

/** The menu's rows that open a page, in the menu's order: the five doors, then the two documents in its foot. */
export const MENU_PAGES: readonly PageId[] = ['docs', 'developers', 'connector', 'help', 'about'];
export const MENU_LEGAL: readonly PageId[] = ['terms', 'privacy'];

/**
 * The still at the head of each page: a frame filmed from our own live 3D city (`public/city/art/`, CITY-64) — never a
 * generated city that is not ours. It carries no coin, logo, price or figure. Two widths:
 * the narrow one for a window and a phone, the wide one for a desk page.
 */
export type PageArt = Readonly<{ small: string; large: string; position: string }>;

const ART = '/city/art';

export const PAGE_ART: Readonly<Record<PageId, PageArt>> = {
  // The island from above, the Sol eclipse over it: the city is the market.
  docs: { small: `${ART}/district-market-800.webp`, large: `${ART}/district-market-1600.webp`, position: '50% 40%' },
  // The agents' quarter: glass towers behind the wires.
  developers: { small: `${ART}/district-agents-800.webp`, large: `${ART}/district-agents-1600.webp`, position: '50% 35%' },
  // One tower ringed in light: a coin's tower, as a chat brings it.
  connector: { small: `${ART}/district-launch-800.webp`, large: `${ART}/district-launch-1600.webp`, position: '50% 30%' },
  // Warm windows of the home quarter.
  help: { small: `${ART}/district-home-800.webp`, large: `${ART}/district-home-1600.webp`, position: '50% 45%' },
  // Towers over the water at night.
  about: { small: `${ART}/district-harbor-800.webp`, large: `${ART}/district-harbor-1600.webp`, position: '50% 45%' },
  // Calm water under the towers: the documents read quietly.
  terms: { small: `${ART}/district-vault-800.webp`, large: `${ART}/district-vault-1600.webp`, position: '50% 50%' },
  privacy: { small: `${ART}/district-vault-800.webp`, large: `${ART}/district-vault-1600.webp`, position: '50% 50%' },
};
