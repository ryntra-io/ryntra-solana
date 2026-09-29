import {
  localizedSolanaModules,
  type SolanaModule,
  type SolanaModuleMaturity,
} from "../../app/solana/workspace/hub/modules.ts";
import type { PublicLocale } from "./locale.ts";

/**
 * The public Product Map, projected from the capability registry.
 *
 * Working navigation and this are different questions, and the owner decision
 * of 2026-09-04 says so in one line: *working app navigation is only usable
 * routes; the Product Map is the whole accepted direction.* The rail throws
 * rather than render a destination with no page; this page exists precisely to
 * describe the things that have no page yet, so that removing them from the
 * rail did not remove them from the product.
 *
 * ## It is projected, never written
 *
 * Canon §0.7 names a hand-written list beside the registry as the root cause of
 * the `Soon` defect — rows that looked like product somebody forgot to finish.
 * A hand-written *public* list is the same defect with a larger audience, so
 * every card here comes from `SOLANA_MODULES` and nothing may be added to this
 * file to make the map look fuller.
 *
 * ## Six words, derived rather than invented
 *
 * The registry carries four independent axes — environment, mode, maturity and
 * `lastVerifiedAt`. A reader with no registry needs one word, so maturity is
 * projected onto the vocabulary the owner settled. This is a **presentation**
 * of the internal axes and never a second operational status system: nothing
 * reads these words back, and changing one changes what a visitor sees and
 * nothing else.
 *
 * `RESEARCH` is in the vocabulary because the owner named it and because the
 * ecosystem manifest has a `research` state, and it is **absent from the
 * derivation on purpose**: no Solana capability is in it today, and emitting a
 * word nothing maps to would be a label looking for a meaning.
 */
export type ProductMapLabel = "AVAILABLE" | "LIMITED" | "BUILDING" | "PLANNED" | "PARKED" | "RESEARCH";

export const PRODUCT_MAP_LABELS: readonly ProductMapLabel[] = [
  "AVAILABLE",
  "LIMITED",
  "BUILDING",
  "PLANNED",
  "PARKED",
  "RESEARCH",
];

/**
 * Maturity to presentation word.
 *
 * `OWNER_CANARY_VERIFIED` collapses into `AVAILABLE` deliberately: it is the
 * registry's word for *one owner-signed mainnet action of this family ran,
 * reconciled and receipted*, which is a stronger claim than `AVAILABLE` and
 * means the same thing to a person deciding whether they can use it. The
 * distinction is evidence, and evidence belongs in the receipt rather than on a
 * marketing card.
 */
const FROM_MATURITY: Readonly<Record<SolanaModuleMaturity, ProductMapLabel>> = {
  AVAILABLE: "AVAILABLE",
  OWNER_CANARY_VERIFIED: "AVAILABLE",
  PREVIEW: "LIMITED",
  IN_BUILD: "BUILDING",
  PLANNED: "PLANNED",
  GATED: "PARKED",
};

export function productMapLabel(maturity: SolanaModuleMaturity): ProductMapLabel {
  return FROM_MATURITY[maturity];
}

export type ProductMapEntry = Readonly<{
  id: string;
  name: string;
  /** One line: the job this does for a person. Never the registry's `detail`. */
  blurb: string;
  label: ProductMapLabel;
  /** Where it opens, when it opens anywhere. */
  href: string | null;
}>;

/**
 * Every registered capability, in the order a reader meets them: what works
 * now, then what is being built, then what is accepted and not started.
 *
 * Deliberately absent from every card: the registry's `gate`, `exists` and
 * `missing` fields. `gate` carries task ids like `RYN-SOL-M4` — canon §0.5
 * keeps internal vocabulary off customer surfaces, and a public page is the
 * most customer-facing surface there is.
 */
const ORDER: readonly ProductMapLabel[] = ["AVAILABLE", "LIMITED", "BUILDING", "PLANNED", "PARKED", "RESEARCH"];

/* Customer terminology only. IDs, membership and maturity still come entirely
   from SOLANA_MODULES. Asset/transaction details are product context, not a
   separate Passport or receipt-infrastructure marketing story. */
const PUBLIC_DETAILS: Readonly<Record<string, Readonly<Record<PublicLocale, { name: string; blurb: string; href: string }>>>> = {
  assets: {
    en: { name: "Asset details", blurb: "Inspect an asset's identity, issuer controls and transfer conditions in the product.", href: "/app/assets" },
    uk: { name: "Відомості про актив", blurb: "Переглядайте дані активу, повноваження емітента й умови переказу в продукті.", href: "/app/assets" },
  },
  receipts: {
    en: { name: "Transaction details", blurb: "Review transaction status, costs and observed outcomes from Activity.", href: "/app/activity" },
    uk: { name: "Деталі операцій", blurb: "Переглядайте статус, витрати й спостережені результати в історії операцій.", href: "/app/activity" },
  },
  send: {
    en: { name: "Send", blurb: "Review a supported Solana transfer, then confirm it with your own wallet.", href: "/app/send" },
    uk: { name: "Надіслати", blurb: "Перегляньте умови підтримуваного переказу на Solana й підтвердьте його власним гаманцем.", href: "/app/send" },
  },
  "sdk-mcp": {
    en: { name: "SDK & MCP", blurb: "Use documented Solana SDK and MCP interfaces in your own application.", href: "/docs" },
    uk: { name: "SDK та MCP", blurb: "Використовуйте документовані інтерфейси Solana SDK та MCP у власному застосунку.", href: "/docs" },
  },
  /* The two TRADE pages the Owner's structure decision of 2026-09-11 names on
     the map: Spot, live, and Predictions, visible and locked. Customer paths,
     because the registry's own route field predates the one-product shell. */
  spot: {
    en: { name: "Spot", blurb: "Find an asset, see its real price and chart, and buy or sell it with your own signature.", href: "/app/spot" },
    uk: { name: "Спот", blurb: "Знайдіть актив, побачте його справжню ціну й графік, купіть або продайте його власним підписом.", href: "/app/spot" },
  },
  predictions: {
    en: { name: "Predictions", blurb: "Prediction markets — crypto, macro, business, politics, sports — through aggregated venues. Coming soon.", href: "/app/predictions" },
    uk: { name: "Прогнози", blurb: "Ринки прогнозів — крипто, макро, бізнес, політика, спорт — через агреговані майданчики. Незабаром.", href: "/app/predictions" },
  },
};

export function productMapEntries(locale: PublicLocale): readonly ProductMapEntry[] {
  const modules = localizedSolanaModules(locale === "uk" ? "uk" : "en");
  return [...modules]
    .map((module: SolanaModule): ProductMapEntry => ({
      id: module.id,
      name: PUBLIC_DETAILS[module.id]?.[locale].name ?? module.label,
      blurb: PUBLIC_DETAILS[module.id]?.[locale].blurb ?? module.purpose,
      label: productMapLabel(module.maturity),
      href: PUBLIC_DETAILS[module.id]?.[locale].href ?? module.route,
    }))
    .sort((left, right) => {
      const byLabel = ORDER.indexOf(left.label) - ORDER.indexOf(right.label);
      return byLabel !== 0 ? byLabel : left.name.localeCompare(right.name);
    });
}

/** How many capabilities sit under each word, for the map's own summary. */
export function productMapCounts(locale: PublicLocale): Readonly<Record<ProductMapLabel, number>> {
  const counts = Object.fromEntries(PRODUCT_MAP_LABELS.map((label) => [label, 0])) as Record<
    ProductMapLabel,
    number
  >;
  for (const entry of productMapEntries(locale)) counts[entry.label] += 1;
  return counts;
}
