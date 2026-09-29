import type { WorkspaceManifest } from "../../../shell/modules.ts";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { NavEntry, NavGroup } from "@/app/shell/workspaces";
import { translateSolana } from "../i18n/catalog.ts";
import { localizedSolanaModules, type SolanaModule } from "./modules.ts";

/**
 * Solana Markets, projected onto the Shell v2 skeleton.
 *
 * Built from the module registry rather than beside it: the route comes from
 * the registry and the label comes from the registry, so the rail cannot name
 * or point at anything the registry does not declare.
 *
 * The claim above used to be aspirational. Until canon §0.7 on 2026-09-03 this
 * file also typed nineteen rows by hand with their own labels and its own
 * placeholder word, and the paragraph that stood here described that as
 * honesty: *a future capability is described honestly where a person looks for
 * it, never faked and never silently missing.* The intent was right and the
 * place was wrong. A rail row has room for a label and a badge; "described
 * honestly" needs what exists, what does not, and the condition that moves it —
 * which is what a registry entry has room for, and what those nineteen rows
 * never carried.
 */

const BASE = "/solana/workspace";

/**
 * The workspace manifest: the landing route, the deep links, and Settings.
 *
 * It used to carry a second information architecture as well — groups called
 * `radar`, `portfolio` and `journal` over a different module grouping, tagging
 * routeless entries `Planned` where the rail tagged them `Soon`. Two
 * hand-written menus over one product, with two placeholder vocabularies, and
 * only one of them was ever rendered: `hub/shell.tsx` reads
 * `settingsEntry(manifest)` and nothing else. A dead menu is not harmless — it
 * is the second definition somebody eventually updates instead of the first.
 *
 * `${BASE}/trade` stays in `deepLinks`. That route is a **permanent** redirect
 * to `/swap`, so caches and copied links remember it; removing it from the
 * migration seam would strand them.
 */
export function solanaManifest(locale: WorkspaceLocale): WorkspaceManifest {
  return {
    workspaceId: "solana",
    defaultLanding: BASE,
    deepLinks: [`${BASE}/send`, `${BASE}/swap`, `${BASE}/trade`, `${BASE}/developers`, `${BASE}/map`],
    modules: [
      {
        id: "settings",
        label: translateSolana(locale, "Settings"),
        href: `${BASE}/settings`,
      },
    ],
  };
}

/**
 * One row of the rail, taken from the registry rather than typed beside it.
 *
 * The label used to be passed in here, so the rail and the Hub Map called the
 * same thing by two different names — *Market overview* against *Overview*,
 * *Asset Passports* against *Assets & Passport* — and a row moving between the
 * two surfaces changed its name on the way. It now comes from the module,
 * already localized by `localizedSolanaModules`, so it must not be translated
 * again here.
 *
 * The route has always come from the registry, and the throw is the point: a
 * rail row pointing at a page that does not exist is the most expensive mistake
 * this file can make.
 */
function routed(
  modules: readonly SolanaModule[],
  id: string,
  icon: string,
): NavEntry {
  const found = modules.find((item) => item.id === id);
  if (!found?.route) throw new Error(`Solana navigation route "${id}" is not available.`);
  return { id, label: found.label, href: found.route, icon };
}

/**
 * The rail carries routes. Everything else is registered, not advertised.
 *
 * Owner decision, 2026-09-03 (`docs/DECISIONS.md`), superseding the rule this
 * workspace was built on: **a future capability stays registered — in the
 * capability registry, and later on a public Product Map — and does not occupy
 * primary working navigation until it has a real user route.**
 *
 * What it replaces, and why the replacement is not a retreat. `CANON.md` §4.2
 * fixed a seven-block menu and required Pro to show the whole end-state IA at
 * once with `Soon` placeholders for the absent parts. The intent was honesty:
 * describe a future capability where a person looks for it rather than hide it.
 * In practice Pro rendered twenty-nine rows, nineteen of them disabled, and
 * Simple answered by hiding four surfaces that *work* — so the mode meant for a
 * newcomer showed less product and the mode meant for depth showed mostly
 * things that do not exist.
 *
 * `Soon` had also stopped being merely uninformative and become false. `policy`
 * and `sdk-mcp` are both registered `AVAILABLE` — one with a published
 * Apache-2.0 repository — and both rendered `Soon`. Worse, the helper that drew
 * these rows discarded each module's real gate and replaced it with a generic
 * *In development*, which `modules.ts` explicitly forbids: *a gated entry whose
 * gate says nothing is a "coming soon" badge, which is the thing this registry
 * forbids.* The guard could not fire, because the rail was typed by hand beside
 * the registry instead of projected from it.
 *
 * Nothing is deleted from the product. Radar, Watchlist, Scanner, Launches,
 * Market flow, Wallet intelligence, RWA markets, Alerts, Strategy Lab,
 * Automation, Payments, Creator & Treasury, Subscriptions/x402, SDK & MCP and
 * Provider status all keep their registry entries and their gates. A grey
 * button with no route is what leaves.
 *
 * ## One rail for both depths
 *
 * Simple and Pro return the same groups, deliberately. Pro is more depth over
 * the same product — route detail, fee breakdown, provider and evidence,
 * filters, export — and never a base capability Simple does not have. The
 * parameter is kept so callers and their tests do not have to change, and so
 * that a future difference has somewhere to live; it must not become a second
 * menu again.
 *
 * The names are the ones already authoritative. `Transfers → Money` and
 * `Journal → Activity` were proposed and are deliberately not made here: those
 * belong to a navigation contract shared by five workspaces, and the authority
 * over it is itself unresolved — canon §0.2 ranks Shell v2 above the Solana
 * canon while `docs/design/README.md` calls the same files superseded, and the
 * v2.1 successor defines no navigation skeleton. Naming that gap is not the
 * same as licensing a Solana row to close it.
 */
export function solanaNavigation(
  locale: WorkspaceLocale,
  _depth: "simple" | "pro" = "pro",
): readonly NavGroup[] {
  const modules = localizedSolanaModules(locale);
  const entry = (id: string, icon: string) => routed(modules, id, icon);

  return [
    {
      id: "markets",
      title: translateSolana(locale, "Markets"),
      entries: [entry("overview", "markets"), entry("trade", "swap")],
    },
    {
      id: "portfolio",
      title: translateSolana(locale, "Portfolio"),
      entries: [entry("holdings", "portfolio"), entry("assets", "assets")],
    },
    {
      id: "transfers",
      title: translateSolana(locale, "Transfers"),
      entries: [
        entry("send", "send"),
        entry("receive", "request"),
      ],
    },
    {
      id: "journal",
      title: translateSolana(locale, "Journal"),
      entries: [entry("journal", "journal"), entry("receipts", "receipts")],
    },
  ];
}

export const SOLANA_MANIFEST: WorkspaceManifest = solanaManifest("en");
