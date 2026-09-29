/**
 * The workspace registry.
 *
 * One Ryntra, five workspaces. A workspace is a *context* — where you are
 * working — not a separate application. Switching between them changes the
 * canvas and the rail; it never changes the brand, the account or the way back.
 *
 * This file answers exactly one question, and the switcher that reads it may
 * not answer any other: **which workspace am I in?**
 *
 * It used to answer five at once. The list mixed a page (Global Overview), a
 * product zone (Trading Desk), a network and environment (a testnet), a way
 * of working (Review Desk), an unbuilt adapter (Robinhood Chain Desk) and two
 * research directions — then hung a per-row `Sign-in` / `Open` / `Research`
 * state off each one. Opening it did not tell a person where they were; it
 * asked them to work out whether they were switching a product, a chain, a
 * mode, an account or a page. Four distinctions now live where each belongs:
 *
 *   workspace     here. Enterable, few, and every one of them real.
 *   environment   `environment` below — the network or mode the workspace runs
 *                 in. It is a separate chip in the top bar, because a chain's
 *                 name and the network it runs on are two different facts.
 *   review        a zone inside every workspace, never a workspace. Activity,
 *                 Journal and Receipts are how you look at work you did in a
 *                 workspace, so they cannot be a place you switch to instead.
 *   direction     `lib/product/ecosystems.ts`. Accepting a chain or venue as
 *                 a direction does not create a row here. A direction earns one
 *                 when a workspace opens it — and then the workspace names it
 *                 in `opens`, rather than a third file keeping a private map of
 *                 which direction has a door. Directions live in the capability
 *                 register at `/docs/current-capabilities` — the Workspace Map
 *                 at `/workspaces` is a permanent redirect there since the
 *                 public-surface consolidation.
 *
 * The consequence worth stating: **a workspace with no route does not exist.**
 * There is no `href: null` branch left in this file and no place to add one.
 * A destination that is not built belongs on a map that can describe it
 * honestly, not in a switcher where it reads as a product someone forgot to
 * finish.
 *
 * `access` stays load-bearing. An ecosystem workspace may be deliberately open —
 * the surface a reviewer opens without a Telegram account — and putting it
 * behind the cabinet gate would break that path. The cabinet workspaces keep
 * their own session gate, untouched by this file — the registry only records
 * which is which.
 *
 * A workspace a separate package brings to the shell is not written here: its
 * own layout registers it (`registerWorkspace`) before the shell renders, so
 * this file names only the Solana product's own places.
 */

export type WorkspaceAccess = "public" | "session";

export type WorkspaceKind = "home" | "ecosystem_pack" | "domain";

/**
 * The switcher's three headings, in their fixed order.
 *
 * They were four — `HOME MARKETS ECOSYSTEMS OPERATIONS` — and that list mixed
 * two axes. `MARKETS` and `OPERATIONS` describe what *kind of Ryntra product*
 * a workspace is; `ECOSYSTEMS` describes an external network we have built a
 * pack for. So the headings follow the distinction the registry already draws:
 *
 *   RYNTRA      the neutral centre
 *   PRODUCTS    our own domain products — Agent Control
 *   ECOSYSTEMS  a pack built for an external network — Robinhood Chain,
 *               Stellar, Solana
 *
 * **Derived from `kind`, not declared beside it.** A `group` field existed for
 * exactly one commit and was already a place where two facts could disagree —
 * a domain product filed under ECOSYSTEMS would have compiled, rendered and
 * looked deliberate. Now it cannot be written at all.
 *
 * This file argued the opposite for one workspace, and both sentences are kept
 * because the reversal is only legible beside them:
 *
 *   > Filing Tokenized Markets under ECOSYSTEMS would have been the clearest
 *   > symptom … the question "which ecosystem does it belong to?" has no
 *   > answer the day a tokenized stock appears on a second venue.
 *
 *   > Robinhood Chain is not here. It is a real ecosystem and it will get a row
 *   > beside the other chains on the day it has a workspace of its own.
 *
 * Each was about a *desk* that settled on a chain, and a desk is not a chain.
 * `RYN-RHC-002` did not file the desk under ECOSYSTEMS; it made **the chain**
 * the workspace, with the desk as one surface inside it — which is the row the
 * second sentence reserved, on the day it names. The multi-venue objection is
 * not answered by a heading and is answered by `opens`: this workspace opens
 * the Robinhood Chain pack *and* the venues quoted on it, and a tokenized stock
 * appearing on a second chain gets that chain's own workspace rather than a
 * heading it has to be argued into.
 */
export const WORKSPACE_GROUPS = ["RYNTRA", "PRODUCTS", "ECOSYSTEMS"] as const;

export type WorkspaceGroup = (typeof WORKSPACE_GROUPS)[number];

/** Which heading a workspace sits under. One answer, from one fact. */
export function workspaceGroup(workspace: Workspace): WorkspaceGroup {
  if (workspace.kind === "home") return "RYNTRA";
  return workspace.kind === "ecosystem_pack" ? "ECOSYSTEMS" : "PRODUCTS";
}

export type Workspace = Readonly<{
  id: string;
  /**
   * The workspace's name, and one class of thing is named one way.
   *
   * These read `… Hub`, `Stellar Hub` and `Solana Markets` — three spellings
   * of one kind of entity, and the third had already gone stale: that
   * workspace carries mint identity, issuer powers, Token-2022 evidence, a
   * devnet action lifecycle and receipts, which is not a market terminal. The
   * one-line description under each row is where the contents belong.
   *
   * Page names *inside* a workspace are untouched — a hub's Map is still its
   * Map. This is what the switcher calls the place, not what the place calls
   * its own pages.
   */
  name: string;
  /**
   * What the trigger shows when there is no room for the full name.
   *
   * Explicit rather than "the first word": the first word of `Ryntra Home` is
   * the brand, which on a phone would leave the top bar reading `Ryntra Ryntra`
   * and naming no workspace at all.
   */
  short: string;
  kind: WorkspaceKind;
  /** The switcher row's glyph. Resolved by the shell's icon map. */
  icon: string;
  /** One line under the name in the switcher. Factual, never a slogan. */
  subtitle: string;
  /**
   * The network or mode this workspace runs in, when it has one.
   *
   * Rendered as its own chip beside the switcher rather than folded into the
   * name. Ryntra Home has none — it is venue-neutral by construction, and
   * giving it an environment would be the first step back to a switcher that
   * cannot tell a product from a chain.
   */
  environment?: string;
  access: WorkspaceAccess;
  /** Where selecting it goes. Every workspace has one. */
  href: string;
  /** Route prefixes that mean "this workspace is active". */
  match: readonly string[];
  /**
   * The `lib/product/ecosystems.ts` manifest rows this workspace opens.
   *
   * The first is the direction the workspace **is**; the rest are venues
   * quoted or executed inside it. Ids only, so the switcher still costs one
   * import — but they are the manifest's own ids, and `shell.test.mjs` fails
   * the build on one that resolves to nothing.
   *
   * It sits here rather than on the manifest, and that direction is the point:
   * a listed direction must not be able to give itself a door. A workspace
   * opens a direction; a direction never opens itself. Before this field the
   * relationship lived in a `Record` inside `app/workspaces/page.tsx` — three
   * records of one fact, and the only one a reader would find was the one free
   * to disagree with the other two.
   */
  opens?: readonly string[];
  /**
   * Public header dropdown. Absent or `enabled: false` means the workspace
   * is not a public ecosystem door — it may still exist as a route.
   */
  publicEntry?: Readonly<{
    enabled: boolean;
    description: Readonly<{ en: string; uk: string }>;
  }>;
}>;

const REGISTERED: Workspace[] = [
  {
    id: "home",
    name: "Ryntra Home",
    short: "Home",
    kind: "home",
    icon: "workspace-home",
    subtitle: "Portfolio, markets, strategies and attention",
    access: "session",
    href: "/app",
    match: ["/app"],
  },
  {
    /*
     * `tokenized-markets` until 2026-08-19, and the *id* changed rather than
     * only the name — and an id change is a migration rather than copy, because
     * the id keys the stored layout preference. It was performed: `app/shell/layout-store.ts`
     * carries the rename, so a person who had set Pro mode and a panel
     * arrangement on this desk still has both. A silent reset was the thing
     * that rule exists to prevent, not a cost this packet was allowed to pay.
     *
     * The id is now the manifest's own id. Workspace and manifest row are one
     * object named once, which is the thing this packet existed to do.
     */
    id: "robinhood-chain",
    name: "Robinhood Chain",
    /* Not "Robinhood": on a phone the top bar would name the broker rather than
       the chain, and nothing here may imply Robinhood endorses this product.
       Not "Markets" either — that named the old desk, and a short label naming
       a category while the full one names a chain is two answers to the
       switcher's single question. */
    short: "RH Chain",
    kind: "ecosystem_pack",
    icon: "workspace-markets",
    /* The chain's own breadth, not a venue list. The venues are in `opens`,
       where the Workspace Map renders each with its real state and gate — three
       of them named in a subtitle was a capability claim in the one place with
       no room to qualify it. */
    subtitle: "Stocks, crypto, RWAs & onchain markets",
    environment: "Paper · wallet-signed routes",
    /* Public, like every other ecosystem workspace. The surfaces under it read
       a public venue; the account gate lives on the pages that need one, never
       on the door. It was `session` while the desk lived inside the cabinet at
       `/app/markets` and inherited the cabinet's answer. */
    access: "public",
    /* The workspace root is Radar — a trade opens *from* Radar, so the door is
       the discovery surface rather than the terminal. */
    href: "/robinhood/workspace",
    match: ["/robinhood/workspace"],
    opens: ["robinhood-chain", "arcus-spot", "arcus-perps", "uniswap"],
    /* Out of the active public product story on 2026-09-04
       (RYN-PUBLIC-SITE-PRODUCT-MAP-001). Not deleted and not closed: the
       workspace, its adapters, its evidence and its route all stay exactly
       where they are and open by direct URL. What ends is presenting it as one
       of several current Ryntra products, which is the model the One Ryntra
       decision replaced. */
    publicEntry: {
      enabled: false,
      description: {
        en: "Tokenized stocks, crypto and onchain markets on Robinhood Chain.",
        uk: "Токенізовані акції, крипто та ончейн-ринки на Robinhood Chain.",
      },
    },
  },
  {
    id: "stellar",
    name: "Stellar",
    short: "Stellar",
    kind: "ecosystem_pack",
    icon: "workspace-stellar",
    subtitle: "RWA assets, issuer controls and holder rights",
    /*
     * Two networks, because the workspace genuinely uses two.
     *
     * This said "Stellar Mainnet · read-only", which was exactly true while
     * every surface here read mainnet and wrote nothing. `/authorize` and
     * `/receipts` are Stellar Testnet and one of them submits — so on the single
     * screen where confusing two networks has consequences, the chrome was
     * asserting the wrong one while the page said TESTNET twice beneath it.
     *
     * A route-aware environment chip belongs to the workspace kernel
     * (`RYN-WS-KERNEL-001`); until then this states both halves, which is true
     * everywhere in the workspace rather than true on most of it.
     */
    environment: "Mainnet reads · Testnet actions",
    /* Public: a visitor opens it with no account. */
    access: "public",
    href: "/stellar/workspace",
    match: ["/stellar/workspace"],
    opens: ["stellar"],
    /* Out of the active public product story on 2026-09-04
       (RYN-PUBLIC-SITE-PRODUCT-MAP-001). Not deleted and not closed: the
       workspace, its adapters, its evidence and its route all stay exactly
       where they are and open by direct URL. What ends is presenting it as one
       of several current Ryntra products, which is the model the One Ryntra
       decision replaced. */
    publicEntry: {
      enabled: false,
      description: {
        en: "RWA assets, issuer controls and holder rights.",
        uk: "RWA-активи, контроль емітента та права держателя.",
      },
    },
  },
  {
    id: "solana",
    name: "Solana",
    short: "Solana",
    kind: "ecosystem_pack",
    icon: "workspace-solana",
    subtitle: "Mint identity, issuer powers and Token-2022 evidence",
    /*
     * One network, because the product now has one.
     *
     * This chip has been wrong twice in opposite directions. It said "Mainnet ·
     * read only" while `/send` was building transfers, then "Mainnet reads ·
     * Devnet actions" — which fixed the read-only half and enshrined a devnet
     * ladder as the model. The Solana Mainnet Product Canon v5.0 removed that
     * ladder: mainnet is the release target for every action family, devnet is
     * an optional internal regression fixture, and the Send path's remaining
     * devnet wiring is a rewrite in flight (`RYN-SOL-M0C`) rather than a second
     * network this workspace offers. So the chip states the environment and
     * nothing else. It does not claim a transfer has happened; each page
     * resolves its own maturity from its module record, and Send reads
     * IN BUILD.
     */
    environment: "Solana Mainnet",
    /* Public for the same reason Stellar is: it is the surface a reviewer
       opens with no account and no wallet. */
    access: "public",
    href: "/solana/workspace",
    match: ["/solana/workspace"],
    opens: ["solana"],
    publicEntry: {
      enabled: true,
      description: {
        /* It said "Mint identity, issuer powers and Token-2022 evidence" and
           the manifest called it read-only, on a product that had been moving
           real money for days. */
        en: "Swap, send, receive and bridge from your own wallet, and see what each issuer can still do to it.",
        uk: "Обмінюйте, надсилайте, отримуйте й переносіть кошти зі свого гаманця та бачте, що емітент ще може з ними зробити.",
      },
    },
  },
  {
    id: "agent-control",
    name: "Agent Control",
    short: "Agents",
    kind: "domain",
    icon: "workspace-agents",
    subtitle: "Agents, intents, policies and verifiable outcomes",
    /* No workspace-level environment, and that is the fix this comment used to
       predict: "route-aware scope belongs in the workspace kernel rather than
       in a renamed workspace". One global `BNB Testnet` put a chain badge above
       the Agentverse Passport — a provider-global read whose evidence has no
       chain — and above a JSON verifier that touches no network. Agent Control
       states its own scope per route through `scopeForPath` in
       `app/agents/workspace/surfaces.ts`, where `null` is a real answer. */
    access: "public",
    href: "/agents/workspace",
    match: ["/agents/workspace"],
  },
];

/**
 * Every workspace the shell knows: the product's own, and any a separate
 * package has registered. One array, so the switcher, `workspaceById` and
 * `workspaceForPath` can never disagree about what exists.
 */
export const WORKSPACES: readonly Workspace[] = REGISTERED;

/**
 * Register a workspace a separate package brings to the shared shell.
 *
 * Its own layout calls this before the shell renders — in a module the layout's
 * client component imports, so the server render and the browser register it
 * alike — and the entry takes its place in the switcher before `before`. A
 * second registration of the same id is ignored, so a module evaluated twice
 * cannot list a workspace twice.
 *
 * The registry is module state: once a hub's code has loaded in a server
 * process or a browser session, later shells see its row too. Only the
 * switcher renders from the list, and only on a press, so nothing renders
 * differently; a server-rendered count or list of `WORKSPACES` would have to
 * account for it.
 */
export function registerWorkspace(workspace: Workspace, place: Readonly<{ before: string }>): void {
  if (REGISTERED.some((existing) => existing.id === workspace.id)) return;
  const index = REGISTERED.findIndex((existing) => existing.id === place.before);
  REGISTERED.splice(index === -1 ? REGISTERED.length : index, 0, workspace);
}

export function workspaceById(id: string): Workspace | undefined {
  return WORKSPACES.find((workspace) => workspace.id === id);
}

/**
 * A workspace by id, or a thrown error naming the id.
 *
 * `workspaceById` returns `undefined` for callers that can genuinely handle
 * absence — route resolution can. A surface rendering a workspace's own name
 * and destination cannot: the fallback string it would need is exactly the
 * second record this lookup exists to remove, and it is the one that goes
 * stale. `app-shell.tsx` already raises this for an unregistered id; this
 * raises it at the same volume for every other reader.
 */
export function requireWorkspace(id: string): Workspace {
  const workspace = workspaceById(id);
  if (!workspace) {
    throw new Error(`Unknown workspace: ${id}. List it in app/shell/workspaces.ts, or register it with registerWorkspace.`);
  }
  return workspace;
}

/**
 * Which workspace a path belongs to.
 *
 * Longest match wins, so `/robinhood/workspace/terminal` resolves to Robinhood Chain rather
 * than to Ryntra Home, which matches `/app` on a shorter prefix. Account-level
 * routes — `/app/journal`, `/app/connect`, `/app/settings` — deliberately claim
 * no prefix of their own and therefore resolve to Home, which is where Review
 * and Connections actually live.
 */
export function workspaceForPath(pathname: string): Workspace | undefined {
  let best: Workspace | undefined;
  let bestLength = -1;
  for (const workspace of WORKSPACES) {
    for (const prefix of workspace.match) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        if (prefix.length > bestLength) {
          best = workspace;
          bestLength = prefix.length;
        }
      }
    }
  }
  return best;
}

/* -------------------------------------------------------------- navigation */

export type NavState = "active" | "disabled";

export type NavEntry = Readonly<{
  id: string;
  label: string;
  href: string | null;
  /** Short capability tag. Omitted where a tag would say nothing. */
  tag?: string;
  /**
   * A quiet word beside the label saying what the row is, where its name alone
   * does not — «Ryntra · ШІ-помічник» (canon v5.4 В30). Not a tag: it names,
   * it does not grade.
   */
  caption?: string;
  /** Overrides the icon the entry id would otherwise resolve to. */
  icon?: string;
  /** Forces the tag's colour rather than inferring it from the tag text. */
  tone?: "verified" | "evidence" | "caution";
  /** Why the entry is not selectable. Required whenever `href` is null. */
  gate?: string;
  /** Requires the cabinet session. Rendered as a sign-in route, not a dead end. */
  needsSession?: boolean;
  /**
   * A surface *inside* a module rather than a module itself.
   *
   * Pro depth reveals these, and without the distinction the rail reads as one
   * flat list: measured on an ecosystem hub, fourteen entries at identical weight, with no
   * way to see that `Attention & recovery` lives inside `Radar`. The skeleton
   * is five things or it is nothing, so a sub-entry has to look subordinate.
   */
  sub?: boolean;
}>;

/**
 * A group of destinations.
 *
 * `title` is optional because Guided mode is one unnamed list: a heading over a
 * five-item rail is chrome that names nothing.
 */
export type NavGroup = Readonly<{
  id: string;
  title?: string;
  entries: readonly NavEntry[];
  /**
   * The title is a control that opens and closes the group.
   *
   * Opt-in, because it changes what a heading *is*: a plain `title` is a label
   * a reader skims past, and a collapsible one is a button they can press by
   * accident. The product rail asks for it because eleven pages under four
   * headings is a column somebody has to scan; a workspace whose rail is five
   * rows does not, and gets the label it has always had.
   */
  collapsible?: boolean;
}>;

/**
 * Navigation is one structure with workspace-resolved targets.
 *
 * The groups are the product lifecycle — see where you are, act, review, keep
 * the system honest — and they do not change when the workspace does. What
 * changes is where an entry points and whether it is available here.
 *
 * No rail repeats the workspace list. The top bar's switcher is the one answer
 * to "where am I", and a sidebar that offers the same jumps turns one question
 * into two controls that can disagree. The single exception is an explicitly
 * titled cross-workspace group, where the title itself says the destination
 * lives somewhere else.
 */
export function navigationFor(workspaceId: string): readonly NavGroup[] {
  /*
   * Home and Agent Control supply `navGroupsFor` from a Shell v2 manifest, the
   * same way every ecosystem hub does. Returning a second list from here would
   * be a third navigation that can disagree with the one on screen.
   */
  if (workspaceId === "agent-control") return [];
  if (workspaceId === "home") return [];
  /*
   * A workspace that supplies its own `navGroupsFor` gets nothing from here,
   * and the fallthrough is empty rather than `HOME_NAV`.
   *
   * It used to return the cabinet's rail for anything unrecognised — Stellar,
   * Solana and, after this move, Robinhood Chain. Harmless only for as long as
   * every one of them remembered to pass `navGroupsFor`: a wrapper that forgot
   * would have rendered Home's Journal, Connections and Access inside a chain's
   * workspace, with no type error and nothing to notice. An empty rail is
   * visibly wrong in one glance; a plausible wrong rail is not.
   */
  return [];
}

/**
 * The cabinet's Settings destination, shared by Ryntra Home and Robinhood Chain.
 *
 * Both render through `app/app/layout.tsx` and both settle on the same account,
 * so one entry serves them. It is exported rather than inlined because the
 * layout is a server component and the shell needs the same object for either
 * workspace the route resolves to.
 */
export const CABINET_SETTINGS: NavEntry = {
  id: "settings",
  label: "Settings",
  href: "/app/settings",
  icon: "settings",
};

/**
 * `MARKETS_NAV` is gone, and the reason is the whole of `RYN-RHC-002`'s
 * unfinished half.
 *
 * It listed six Markets entries and then a second group titled `Ryntra Home` —
 * `Portfolio & Markets`, `Journal`, `Connections` — inside a chain's rail. A
 * person working on Robinhood Chain was looking at three destinations that
 * belong to a different workspace, which is exactly what the shell exists to
 * prevent, and no other ecosystem did it: Stellar, Solana and every other hub supply
 * their own `navGroupsFor` and carry nothing of Home's.
 *
 * Robinhood Chain now does the same, from `app/robinhood/workspace/shell.tsx`,
 * on the five fixed slots with Screener, Scanner and Watchlist as Radar's modes
 * in Pro. Nothing routes through here for it any more.
 */
