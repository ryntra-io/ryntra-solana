/**
 * Where a customer path goes, after Product Canon v1.0 §3.
 *
 * The menu is eleven pages in four groups, and four names left it: Home,
 * Bridge, Passport and Agents. None of their *functions* left with them, so
 * none of their URLs dead-ends either — canon §3.4 requires old URLs to lead to
 * the new place of the work, and requires operations already under way to stay
 * reachable while they do.
 *
 * Three rules decided every row below.
 *
 * **A retired name redirects to the page that took its work over,** not to the
 * product root.
 *
 * `/app/bridge` was one of those rows and is not any more. It pointed at Swap
 * from 2026-09-08, when the canon folded cross-network work into one universal
 * form; the Owner's decision of 2026-09-10 splits the two again, so Bridge is a
 * page serving its own address and the alias is gone rather than repointed. The
 * rule this row used to illustrate is unchanged — it simply has one fewer
 * example, which is what a retired name coming back looks like.
 *
 * **A repointed alias is temporary, never permanent.** A 308 cannot be recalled
 * from a browser that cached it, and every row here that changed destination in
 * this wave points somewhere new — so those rows are 307s. The rows that have
 * always meant the same thing keep their 308.
 *
 * **A route still needed for recovery is not redirected at all.**
 * `/app/agents/inspect` and `/app/agents/verify` stay served even though the
 * Agents entry is gone from the menu: the entry was a place, the tools are
 * work, and canon §10.3 moves the work rather than deleting it.
 *
 * **One version since canon v5.3 (2026-09-24, В28).** No row here reads who
 * is looking: the depth cookie that once sent «Профі» elsewhere decides
 * nothing, so every address answers every person and every guest the same.
 */

/** Customer locations are independent of the settlement adapter. */
export const CUSTOMER_PATHS = {
  /* The product root is Home since canon v5.0 §3 (2026-09-23,
     `RYN-INVEST-SIMPLE-001`) — the first of the five places, for everyone
     since canon v5.3. */
  home: "/app/home",
  portfolio: "/app/portfolio", activity: "/app/activity",
  swap: "/app/swap", spot: "/app/spot", perps: "/app/perps", trends: "/app/trends",
  ideas: "/app/ideas", strategies: "/app/strategies", results: "/app/results",
  send: "/app/send", receive: "/app/receive",
  receipts: "/app/receipts", assets: "/app/assets", settings: "/app/settings",
} as const;

/** Rows that have always meant the same thing. They keep their permanent 308. */
const settled: readonly (readonly [string, string])[] = [
  ["/product", "/app/portfolio"], ["/product-map", "/app/portfolio"], ["/workspaces", "/app/portfolio"],
  ["/solana", "/app/portfolio"], ["/solana/workspace", "/app/portfolio"],
  ["/solana/workspace/holdings", "/app/portfolio"],
  ["/solana/workspace/swap", "/app/swap"], ["/solana/workspace/trade", "/app/swap"],
  ["/solana/workspace/send", "/app/send"], ["/solana/workspace/receive", "/app/receive"],
  ["/solana/workspace/history", "/app/activity"],
  ["/solana/workspace/receipts", "/app/receipts"],
  ["/solana/workspace/assets", "/app/assets"],
  ["/solana/workspace/settings", "/app/settings"],
  ["/solana/workspace/map", "/app/portfolio"], ["/solana/workspace/developers", "/docs/developers"],
  /* The last two workspace pages still served in their own old shell
     (found by `RYN-SURFACE-CLEAN-001`, 2026-09-23): the same Spot and the same
     Rewards the product has, at their product addresses. */
  ["/solana/workspace/spot", "/app/spot"], ["/solana/workspace/rewards", "/app/rewards"],
  ["/agents/passport", "/app/agents/inspect"], ["/agents/workspace/passport", "/app/agents/inspect"],
  ["/agents/verify", "/app/agents/verify"], ["/agents/workspace/verify", "/app/agents/verify"],
  ["/agents/workspace/settings", "/app/settings"],
  ["/app/connect", "/app/settings#account"],
  ["/app/operations", "/app/settings"],
  ["/app/holdings", "/app/portfolio"], ["/app/history", "/app/activity"],
  ["/app/map", "/app/portfolio"], ["/app/developers", "/docs/developers"],
  /* `/developers` left this list on 2026-09-26 (`RYN-SITE-V5-001`, subtask 3):
     it is a page again — the public repository, what is open and how to run
     it. A browser that cached the old 308 still lands on the developer
     references, which is somewhere true. */
  ["/guard", "/docs/developers/guard"],
  ["/developers/guard", "/docs/developers/guard"],
  ["/developers/agent-control", "/docs/developers/agent-control"],
  /* The handbook's chapters, to the documentation page that answers the same
     question since the rewrite of 2026-09-14 — a page each, not an anchor on
     a hub that no longer has one. */
  ["/docs/introduction", "/docs"], ["/docs/how-ryntra-works", "/docs/start/getting-started"],
  ["/docs/receipts-journal", "/docs/manage/activity"], ["/docs/faq", "/docs/reference/faq"],
  ["/docs/glossary", "/docs/reference/glossary"], ["/docs/core-principles", "/docs/reference/review"],
  ["/docs/current-capabilities", "/docs/start/cabinet"], ["/docs/roadmap", "/docs/start/cabinet"],
  ["/docs/ecosystems", "/docs/money/bridge"], ["/docs/ryntra-home", "/docs/manage/portfolio"],
  /* Bridge is documented under Money since canon v4.0 (2026-09-14). */
  ["/docs/trade/bridge", "/docs/money/bridge"],
  ["/docs/changelog", "/docs"], ["/docs/product-paper", "/docs"],
  ["/docs/agent-control", "/docs/developers/agent-control"],
  /* The documentation under the menu's sections (the new site of canon v5.5,
     `RYN-SITE-V5-001` subtask 3, 2026-09-26): the Stocks page became
     «What you actually buy» under Invest, and «Security and risk» the
     Security page itself — each moved for good, so each keeps its 308. */
  ["/docs/trade/tokenized-stocks", "/docs/invest/what-you-buy"],
  ["/docs/reference/security", "/security"],
];

/**
 * Rows this wave moved, and rows that may move again.
 *
 * Temporary on purpose, every one. None of them points at a page that is not
 * built — since canon v5.0 a person following an old link lands on a page that
 * works, never on a page about the future — and when a planned page arrives its
 * address updates itself, because nothing cached a permanent answer.
 */
const moved: readonly (readonly [string, string])[] = [
  /* The product root opens on Home — the first of the five places, for every
     person and every guest (canon v5.0 §3; one version since v5.3 В28). */
  ["/app", "/app/home"],

  /* The front door. From 2026-09-10 both public roots went to Swap, named
     by the Owner as `https://ryntra.io/app/swap`, while the landing was
     rebuilt behind `/preview/site`; on 2026-09-14, with the landing complete
     (four blocks and the footer, the hero drawn in code), the Owner turned
     the redirect off — *«виключи переадресацію з головної на внутрішню»* —
     and `/` was the landing again. From 2026-09-26 (`RYN-SITE-NOW-001`) `/`
     and every language address of it led into the app until the new site was
     built; the new landing of `RYN-SITE-V5-001` answers at `/` and `/uk`
     itself, and the language addresses around them live in `LANDING_REDIRECTS`
     in `next.config.ts` — none of them is a row here. */

  /* The landing's review door of 2026-09-13/14, deleted with that landing's
     release. The address had been handed to the Owner and written into the
     records of that day, so a link somebody was given lands on the landing in
     its language, one hop. */
  ["/preview/site", "/"],
  ["/preview/site/uk", "/uk"],

  /* The palette A/B of 2026-08-20, answered that day for the canon and kept
     until the approved hero shipped on `/`; removed with the new site (the
     plan's address map, `RYN-SITE-V5-001`), a link to it lands on the landing. */
  ["/preview/hero-ab", "/"],

  /* Bridge. The menu entry and the page are both gone; the lane is not. */

  ["/solana/workspace/bridge", "/app/swap"],

  /* `/app/markets` is a page again since canon v5.0 §3: Markets, companies
     first, for everyone. The Solana workspace's old address keeps its Trends
     answer. */
  ["/solana/workspace/markets", "/app/trends"],

  /* Strategies. Plans is not a second system (canon §5.2), so the plan list is
     this page rather than a page beside it. Action cases, Control and Agents
     still resolve here. `/app/alerts` is the Monitoring surface of
     `RYN-MONITORING-PUSH-001` and is not redirected — the rail still lights
     My strategies because the route is in that group's match list.

     `/app/plans` is NOT in this table, and its absence is the point. Until this
     wave the alias ran the other way and it was permanent — `/app/strategies →
     /app/plans`, a 308 every browser that used the page has cached and will
     never re-ask. Redirecting `/app/plans` back would loop those browsers on
     the landing page of a whole group. It serves the same page instead; see
     `app/app/plans/page.tsx`. */
  ["/app/action-cases", "/app/strategies"],
  ["/app/control", "/app/strategies"],
  ["/app/agents", "/app/strategies"],
  ["/agent-control", "/app/strategies"], ["/agents", "/app/strategies"],
  ["/agents/workspace", "/app/strategies"], ["/agents/workspace/agents", "/app/strategies"],
  ...["attention", "actions", "policies", "evidence", "lab", "operations", "team", "reviews", "authorize", "integrations", "commerce", "tools", "adoption"].map(
    (name): readonly [string, string] => [`/agents/workspace/${name}`, "/app/strategies"],
  ),

  /* Canon v5.0 §0.0 rule 10 (2026-09-23, `RYN-SURFACE-CLEAN-001`): only what
     is built reaches a person. Three pages that are not built leave the
     surface by these rows, and their code stays where it is — the rows are
     temporary on purpose, so a page that is built later takes its address
     back without fighting a cached answer.

     Ideas was a page that said what it would be. Research, the critic and
     the read of a thesis are Ryntra's now (canon v5.0 §3: Research, Critic
     and Brief are details of Ryntra, not menu items), so Ideas and the two
     older names it had taken over — research and the adviser — lead to the
     assistant, each directly rather than through one another. */
  ["/app/ideas", "/app/ryn"],
  ["/app/research", "/app/ryn"],
  ["/app/adviser", "/app/ryn"],
  /* Perps is not in the product (canon §10.3); the nearest thing that works
     is Spot. */
  ["/app/perps", "/app/spot"],
  /* The prediction demo leaves the surface on the Owner's word (canon v5.4
     В32, 2026-09-24): its pages, its paper account and its code stay, and
     every address of it — a market, a plan — leads to Markets until the
     Owner says otherwise. Temporary, so the demo can take its address back. */
  ["/app/predictions", "/app/markets"],
  ["/app/predictions/:path*", "/app/markets"],
  ["/docs/trade/predictions", "/docs/start/cabinet"],
  /* The parked ecosystems (the Owner's word, 2026-09-23: «Стеллар Workspace…
     Робингу тоже на главную»). Stellar's and Robinhood's workspaces are
     history — their code preserved, their rows parked in the registry — and an
     old link to either lands on the landing rather than in an old shell, in one
     hop (the plan of `RYN-SITE-V5-001`, §1; the app's Home from 2026-09-26 while
     `/` led into the app). */
  ["/stellar", "/"], ["/stellar/:path*", "/"],
  ["/robinhood", "/"], ["/robinhood/:path*", "/"],
  /* The Strategy Lab is frozen until В16 (canon §10.5, B.17): its engine and
     its records stay in the code, its page leaves the surface for My
     strategies, where the person's own plans are. Until 2026-09-23 this row
     was deliberately absent — the lab was a live preview kept out of every
     menu by its own flag. */
  ["/app/strategy-lab", "/app/strategies"],

  /* Results takes plan-against-outcome. Journal used to answer to Activity,
     which is the other half of the question (canon §9.2 draws the line). */
  ["/app/journal", "/app/results"],
  ["/app/brief", "/app/results"],
  ["/app/coverage", "/app/results"],

  /* The documentation of two pages that are not built left with canon v5.0
     §0.0 rule 10 (2026-09-23, `RYN-SURFACE-CLEAN-001`): only what is built
     is documented to a person. Their addresses lead to the nearest page that
     works, and stay temporary — the pages may come back when they are built. */
  ["/docs/trade/perps", "/docs/trade/spot"],
  ["/docs/strategies/ideas", "/docs/strategies/overview"],
];

const aliases: readonly (readonly [string, string])[] = [...settled, ...moved];

/**
 * A Strategy Lab record — `/app/strategies/<uuid>`, the lab's own detail
 * page. Matched by the lab's canonical UUID only, so the plan builder
 * (`/app/strategies/new`) and the plans (`/app/strategies/plans/…`) can never
 * be caught by it. It leaves with the lab, temporarily, for My strategies.
 */
export const LAB_RECORD_SOURCE =
  "/app/strategies/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

export const CUSTOMER_REDIRECTS = [
  /* No row is conditional: since canon v5.3 (В28) the rows that led «Профі»
     from Home, Markets and «Поповнити» to Portfolio, Trends and Receive by a
     cookie are gone with the switch, and those addresses answer everyone. */
  ...settled.map(([source, destination]) => ({ source, destination, permanent: true })),
  ...moved.map(([source, destination]) => ({ source, destination, permanent: false })),
  { source: "/assets/:mint", destination: "/app/assets?mint=:mint", permanent: true },
  { source: LAB_RECORD_SOURCE, destination: "/app/strategies", permanent: false },
];

/** Preserve query and fragment when adapting links, never rewrite off-site URLs. */
export function customerHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const end = href.search(/[?#]/);
  const pathname = end < 0 ? href : href.slice(0, end);
  const suffix = end < 0 ? "" : href.slice(end);
  const asset = /^\/assets\/([^/]+)$/.exec(pathname);
  if (asset) {
    try {
      const destination = new URL(href, "https://ryntra.io");
      destination.pathname = "/app/assets";
      destination.searchParams.set("mint", decodeURIComponent(asset[1]));
      return destination.pathname + destination.search + destination.hash;
    } catch { return href; }
  }
  const target = aliases.find(([source]) => source === pathname)?.[1];
  if (!target) return href;
  const [base, fragment] = target.split("#");
  return base + suffix + (fragment && !suffix.includes("#") ? `#${fragment}` : "");
}
