import { PRODUCT_ROUTES } from "../../app/shell/product-routes.ts";
import { MENU_SECTION_IDS } from "../../app/shell/domains.ts";
import { productMapEntries, type ProductMapEntry, type ProductMapLabel } from "./product-map.ts";
import type { PublicLocale } from "./locale.ts";

export type HomepageStatus = ProductMapLabel | "SUPPORTED_ROUTES" | "UNAVAILABLE";
type RouteSource = Readonly<{ id: string; readiness: string; href: string }>;
export type HomepageAssetId = "crypto" | "memes" | "stocks" | "rwa" | "stables";
export type HeroStripId = "invest" | "autoinvest" | "private" | "rewards";
export type WorkflowStepId = "company" | "sum" | "review" | "sign" | "receipt" | "autoinvest";
export type WorkflowSurface = "markets" | "company" | "wallet" | "history" | "autoinvest";

const FROM_ROUTE: Readonly<Record<string, HomepageStatus>> = {
  available: "AVAILABLE",
  building: "BUILDING",
  planned: "PLANNED",
  limited: "LIMITED",
};

/** A public projection of existing sources, never a second capability registry. */
export function homepageModel(
  locale: PublicLocale,
  routes: readonly RouteSource[] = PRODUCT_ROUTES,
  capabilities: readonly ProductMapEntry[] = productMapEntries(locale),
) {
  const status = (id: string): HomepageStatus => {
    const route = routes.find((entry) => entry.id === id);
    return route ? FROM_ROUTE[route.readiness] ?? "UNAVAILABLE" : "UNAVAILABLE";
  };
  /* Markets and «Автоінвест» are sections of the menu, not pages of the route
     registry: drawn in the menu means open. «Автоінвест» lives in «Боти» since
     the menu v6.2. */
  const SECTION_OF = { markets: "markets", autoinvest: "bots" } as const;
  const destination = (id: keyof typeof SECTION_OF): HomepageStatus =>
    (MENU_SECTION_IDS as readonly string[]).includes(SECTION_OF[id]) ? "AVAILABLE" : "UNAVAILABLE";
  const swap = status("swap");
  const supported: HomepageStatus = swap === "AVAILABLE" ? "SUPPORTED_ROUTES" : swap;
  const tokenized = capabilities.find((entry) => entry.id === "rwa-markets")?.label ?? "UNAVAILABLE";
  return {
    assets: [
      { id: "crypto", status: supported },
      { id: "memes", status: supported },
      { id: "stocks", status: tokenized },
      { id: "rwa", status: tokenized },
      { id: "stables", status: supported },
    ] as readonly Readonly<{ id: HomepageAssetId; status: HomepageStatus }>[],
    /* Swap first because it is the one that works; the rest follow the product's
       own Trade order. Each status is read from the route registry, never
       written here — a marketing table that outranks the registry is exactly
       how a planned surface starts reading as a shipped one. */
    trading: (["swap", "trends", "spot", "perps"] as const).map((id) => ({ id, status: status(id) })),
    /* The rest of the workspace, named briefly rather than sold as a second
       storyline: a reader asking "what else is already there?" gets an answer
       without the page growing another section. */
    workspace: (["portfolio", "send", "receive", "activity"] as const).map((id) => ({ id, status: status(id) })),
    /* The hero's four ways in: a company from $1 and the private companies
       open on the company pages (the `stocks` route family), the rules on
       «Автоінвест», the fee back on Rewards. The strip shows a status only
       when a page is not available, so a building surface can never stand in
       the hero as a shipped one. */
    hero: [
      { id: "invest", status: destination("markets") === "AVAILABLE" ? status("stocks") : "UNAVAILABLE" },
      { id: "autoinvest", status: destination("autoinvest") },
      { id: "private", status: status("stocks") },
      { id: "rewards", status: status("rewards") },
    ] as readonly Readonly<{ id: HeroStripId; status: HomepageStatus }>[],
    /* How it works — one purchase from $1 on the app's own road, each step on
       the page that owns it: the company in Markets, the sum and the Review on
       the company's page, the signature in the person's wallet, the receipt in
       History, the rule in «Автоінвест» — with that page's readiness beside
       it, so a step whose page is still being built says so. The wallet is the
       person's own, never a page of ours: its step reads the page the purchase
       starts from. */
    workflow: ([
      ["company", "markets", destination("markets")],
      ["sum", "company", status("stocks")],
      ["review", "company", status("stocks")],
      ["sign", "wallet", status("stocks")],
      ["receipt", "history", status("activity")],
      ["autoinvest", "autoinvest", destination("autoinvest")],
    ] as const).map(([id, surface, stepStatus]) => ({ id, surface, status: stepStatus })) as readonly Readonly<{ id: WorkflowStepId; surface: WorkflowSurface; status: HomepageStatus }>[],
    /* The fourth block's panel names the Rewards page's readiness in the
       registry's word, so the programme reads as open only while the page is. */
    rewards: status("rewards"),
  };
}
