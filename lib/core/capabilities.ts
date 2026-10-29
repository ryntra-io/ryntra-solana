/**
 * The capability registry, version 2: network × venue × capability → state,
 * fee and attribution.
 *
 * The core asks this registry what can be done and through which venue; it
 * never names a protocol on its own. One row per (network, venue, capability).
 * A row says three things and nothing else:
 *
 * - **state** — `LIVE` (people use it on production), `BUILDING` (code exists,
 *   not open to people), `PLANNED` (in the product plan, no code). A `LIVE`
 *   row whose operator stop is closed reads `PAUSED` at runtime — the stop is
 *   the same environment switch the routes already obey, read here, never a
 *   second switch.
 * - **fee** — the Ryntra fee and the mechanism the venue carries it by. A live
 *   rate is read from the fee policy — v2 per flow (`./fee-policy.ts`) on the
 *   Jupiter swap, `lib/swap/service-fee.ts` elsewhere — never copied here:
 *   one number, one place. A planned row has no rate yet — `NOT_SET` — and
 *   opens only with one.
 * - **attribution** — how an outside counter knows the flow is Ryntra's: the
 *   kind of identity and where its address is configured. This registry holds
 *   no address: a referral account or a Relay recipient is a deployment fact
 *   read on the server, and a product's fee wallet is a row of the public
 *   attribution registry (`lib/attribution/registry.ts`).
 *
 * The older registry of public claims (`lib/product/capabilities.ts`) answers
 * a different question — how mature a claim on a page is — and stays as it is.
 *
 * **What a person may do, and who holds its bound, is the authority matrix**
 * (`./authority-matrix.ts`, EXE-1): one row per venue × action with its honest
 * state. Each row here names the matrix rows it routes (`authority`), and a
 * row here is `LIVE` only where one of them has a live ceiling
 * (`authority-matrix.test.mjs`). `PLANNED` here means «not on the core's
 * routing yet» — a venue people already use on its own routes (the pools,
 * Phoenix) reads its people's state from the matrix, never from this file.
 *
 * Pure: no I/O and no clock. The environment is passed in.
 */

import { z } from "zod";

import { feeWalletOf } from "../attribution/registry.ts";
import { SOLANA_LANE_STATE_ENV, resolveSolanaLaneState, type SolanaLane } from "../solana/lane-state.ts";
import { SERVICE_FEE_ENV } from "../swap/service-fee.server.ts";
import { RYNTRA_SERVICE_FEE_POLICY, type ServiceFeeConfig, type ServiceFeeMechanism } from "../swap/service-fee.ts";
import { FEE_POLICY_V2, type FeeFlow } from "./fee-policy.ts";
import {
  CAPABILITY_IDS,
  NETWORK_IDS,
  PRODUCT_IDS,
  VENUE_IDS,
  type CapabilityId,
  type FeeIdentity,
  type NetworkId,
  type Product,
  type VenueId,
} from "./contracts.ts";

export const CAPABILITY_STATES = ["LIVE", "BUILDING", "PLANNED"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];
/** What a caller sees: a live row behind a closed operator stop is paused. */
export type ResolvedCapabilityState = CapabilityState | "PAUSED";

/** The pipelines a live row may run through. One today: a Solana swap. */
export const INTENT_PIPELINES = ["solana-swap"] as const;
export type IntentPipelineId = (typeof INTENT_PIPELINES)[number];

export type CapabilityFee =
  /** Charged through the venue's own mechanism, at the policy's rate. */
  | Readonly<{ kind: "MECHANISM"; mechanism: Exclude<ServiceFeeMechanism, "NONE" | "JUPITER_PLATFORM_FEE" | "METEORA_LAUNCH"> }>
  /** Fee policy v2: the rate is the trade's flow's, carried by whichever of the venue's mechanisms its lane takes. */
  | Readonly<{ kind: "POLICY"; policy: "fee-policy-v2"; mechanisms: readonly Exclude<ServiceFeeMechanism, "NONE">[] }>
  /** The route has no mechanism for an integrator fee; a true zero. */
  | Readonly<{ kind: "NONE"; reason: string }>
  /** Planned: the rate is set before the row opens, never guessed here. */
  | Readonly<{ kind: "NOT_SET" }>;

export type CapabilityAttribution = Readonly<{
  kind: FeeIdentity["kind"];
  /** The environment key that holds the address; null when none exists yet. */
  configKey: string | null;
  /** The products this one identity serves until each has its own. */
  products: readonly Product[];
}>;

export type CapabilityRow = Readonly<{
  network: NetworkId;
  venue: VenueId;
  capability: CapabilityId;
  state: CapabilityState;
  /** The operator stop a live row obeys; null when the row has none. */
  lane: SolanaLane | null;
  fee: CapabilityFee;
  attribution: CapabilityAttribution | null;
  /** The intent pipeline the row runs through; null while it runs on its own routes. */
  pipeline: IntentPipelineId | null;
  /** The authority-matrix rows (`./authority-matrix.ts`) this row routes; the person's state is theirs. */
  authority: readonly string[];
  /** One plain line for an operator: what the row is, never a claim to a person. */
  note: string;
}>;

const PLANNED_FEE = { kind: "NOT_SET" } as const;

/**
 * The rows. Order is the order a reader meets them: what is live, then what is
 * planned by network.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityRow[] = Object.freeze([
  {
    network: "solana",
    venue: "jupiter",
    capability: "swap",
    state: "LIVE",
    lane: "SWAP",
    /* `/build` pays the fee wallet; `/order` (Ondo, PreStocks, where it pays more, the phone) the referral account — both read by the attribution registry. */
    fee: { kind: "POLICY", policy: "fee-policy-v2", mechanisms: ["JUPITER_PLATFORM_FEE", "JUPITER_REFERRAL"] },
    attribution: {
      kind: "FEE_WALLET",
      configKey: null,
      products: ["swap", "memes", "stocks"],
    },
    pipeline: "solana-swap",
    authority: ["jupiter.swap", "jupiter.limit"],
    note: "Swap, Spot and the company page: one order, one review, one wallet signature, one receipt; the fee per flow.",
  },
  {
    network: "solana",
    venue: "relay",
    capability: "bridge",
    state: "LIVE",
    lane: "CROSS_SWAP",
    fee: { kind: "MECHANISM", mechanism: "RELAY_APP_FEE" },
    attribution: {
      kind: "RELAY_APP_FEE_RECIPIENT",
      configKey: SERVICE_FEE_ENV.relayAppFeeRecipient,
      products: ["bridge"],
    },
    pipeline: null,
    authority: ["relay.cross-swap"],
    note: "Cross-chain swap and bridge from Solana; runs on its own routes until it moves onto the pipeline.",
  },
  {
    network: "solana",
    venue: "pump",
    capability: "swap",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "FEE_WALLET", configKey: null, products: ["memes"] },
    pipeline: null,
    authority: [],
    note: "Trading on launch curves directly.",
  },
  {
    network: "solana",
    venue: "meteora-dbc",
    capability: "launch",
    /* Open to people on mainnet since 2026-10-06: creating, trading on the curve and in the pool, the creator's claim — behind the Launch lane's stop. The partner's claim on the treasury multisig is not built (SOL-L1d). */
    state: "LIVE",
    lane: "LAUNCH",
    fee: { kind: "NONE", reason: "The curve's own fee: Ryntra earns inside it as the config's partner, with no fee of its own on top." },
    attribution: { kind: "CURVE_CONFIG", configKey: null, products: ["launch"] },
    pipeline: null,
    authority: ["meteora-dbc.launch", "meteora-dbc.trade", "meteora-dbc.creator-claim", "meteora-dbc.holder-collect", "meteora-dbc.graduation", "meteora-dbc.liquidity-ladder", "meteora-dbc.partner-claim"],
    note: "Ryntra Launch on a dynamic bonding curve: a config per preset; the partner's fee claimer and the pool payer in the attribution registry.",
  },
  {
    network: "solana",
    venue: "launchlab",
    capability: "launch",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "CURVE_CONFIG", configKey: null, products: ["launch"] },
    pipeline: null,
    authority: [],
    note: "A second launch venue after the first is live.",
  },
  {
    network: "solana",
    venue: "meteora-dlmm",
    capability: "liquidity",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "FEE_WALLET", configKey: null, products: ["lp"] },
    pipeline: null,
    authority: ["meteora-dlmm.liquidity", "meteora-dlmm.grid", "meteora-dlmm.limit"],
    note: "Pools and the grid: on their own routes behind the pools' gate, not the core's routing yet; the people's state is the matrix's.",
  },
  {
    network: "solana",
    venue: "meteora-damm2",
    capability: "liquidity",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "FEE_WALLET", configKey: null, products: ["lp"] },
    pipeline: null,
    authority: ["meteora-damm2.liquidity"],
    note: "Pools, and launches' pools after migration: on their own routes behind the pools' gate; the people's state is the matrix's.",
  },
  {
    network: "solana",
    venue: "phoenix",
    capability: "perps",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "PARTNER_CODE", configKey: null, products: ["perps"] },
    pipeline: null,
    authority: ["phoenix.collateral", "phoenix.orders"],
    note: "Perpetuals on Phoenix: collateral and orders on their own routes and gates; the people's state is the matrix's.",
  },
  {
    network: "hyperliquid",
    venue: "hyperliquid",
    capability: "perps",
    state: "PLANNED",
    lane: null,
    fee: PLANNED_FEE,
    attribution: { kind: "PARTNER_CODE", configKey: null, products: ["perps"] },
    pipeline: null,
    authority: [],
    note: "Perpetuals second, through a partner code.",
  },
  ...(["base", "bsc", "ethereum", "robinhood"] as const).map(
    (network): CapabilityRow => ({
      network,
      venue: "uniswap",
      capability: "swap",
      state: "PLANNED",
      lane: null,
      fee: PLANNED_FEE,
      attribution: { kind: "FEE_WALLET", configKey: null, products: ["swap"] },
      pipeline: null,
      authority: [],
      note: "Swap on an EVM chain through the one EVM adapter.",
    }),
  ),
]);

const CapabilityRowSchema = z
  .object({
    network: z.enum(NETWORK_IDS),
    venue: z.enum(VENUE_IDS),
    capability: z.enum(CAPABILITY_IDS),
    state: z.enum(CAPABILITY_STATES),
    lane: z.enum(Object.keys(SOLANA_LANE_STATE_ENV) as [SolanaLane, ...SolanaLane[]]).nullable(),
    fee: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("MECHANISM"), mechanism: z.enum(["JUPITER_REFERRAL", "RELAY_APP_FEE", "MAYAN_REFERRER"]) }).strict(),
      z
        .object({
          kind: z.literal("POLICY"),
          policy: z.literal("fee-policy-v2"),
          mechanisms: z.array(z.enum(["JUPITER_REFERRAL", "JUPITER_PLATFORM_FEE", "RELAY_APP_FEE", "MAYAN_REFERRER"])).min(1),
        })
        .strict(),
      z.object({ kind: z.literal("NONE"), reason: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("NOT_SET") }).strict(),
    ]),
    attribution: z
      .object({
        kind: z.enum(["JUPITER_REFERRAL_ACCOUNT", "FEE_WALLET", "RELAY_APP_FEE_RECIPIENT", "PARTNER_CODE", "CURVE_CONFIG"]),
        configKey: z.string().min(1).nullable(),
        products: z.array(z.enum(PRODUCT_IDS)).min(1),
      })
      .strict()
      .nullable(),
    pipeline: z.enum(INTENT_PIPELINES).nullable(),
    authority: z.array(z.string().min(1)),
    note: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((row, context) => {
    /* A live row charges what the policy says or says why nothing; a planned
       row has no rate until it opens. */
    if (row.state === "LIVE" && row.fee.kind === "NOT_SET") {
      context.addIssue({ code: "custom", path: ["fee"], message: "A live row needs its fee or the reason it has none." });
    }
    if (row.state !== "LIVE" && (row.fee.kind === "MECHANISM" || row.fee.kind === "POLICY")) {
      context.addIssue({ code: "custom", path: ["fee"], message: "Only a live row charges a fee." });
    }
    /* A live row is stoppable by an operator, and its fee is attributable. */
    if (row.state === "LIVE" && row.lane === null) {
      context.addIssue({ code: "custom", path: ["lane"], message: "A live row needs its operator stop." });
    }
    if (row.fee.kind === "MECHANISM" && (row.attribution === null || row.attribution.configKey === null)) {
      context.addIssue({ code: "custom", path: ["attribution"], message: "A charged fee needs a configured identity." });
    }
    /* A fee wallet's address is a row of the public attribution registry, not a deployment key. */
    if (row.fee.kind === "POLICY" && (row.attribution === null || (row.attribution.kind !== "FEE_WALLET" && row.attribution.configKey === null))) {
      context.addIssue({ code: "custom", path: ["attribution"], message: "A charged fee needs a configured identity." });
    }
    /* Only live code runs through a pipeline. */
    if (row.pipeline !== null && row.state !== "LIVE") {
      context.addIssue({ code: "custom", path: ["pipeline"], message: "Only a live row runs through a pipeline." });
    }
  });

/** The key of a row: one row per (network, venue, capability). */
export function capabilityKey(row: Pick<CapabilityRow, "network" | "venue" | "capability">): string {
  return `${row.network}:${row.venue}:${row.capability}`;
}

/** The registry checked as a whole: every row valid, no key twice. */
export function validateCapabilityRegistry(rows: readonly CapabilityRow[] = CAPABILITY_REGISTRY): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = capabilityKey(row);
    const parsed = CapabilityRowSchema.safeParse(row);
    if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${key}: ${issue.path.join(".")} ${issue.message}`);
    if (seen.has(key)) problems.push(`${key}: registered twice`);
    seen.add(key);
  }
  return problems;
}

export function findCapability(network: NetworkId, venue: VenueId, capability: CapabilityId): CapabilityRow | null {
  return CAPABILITY_REGISTRY.find((row) => row.network === network && row.venue === venue && row.capability === capability) ?? null;
}

/** The state a caller acts on: a live row behind a closed operator stop is paused. */
export function resolveCapabilityState(
  row: CapabilityRow,
  env: Record<string, string | undefined> = process.env,
): ResolvedCapabilityState {
  if (row.state !== "LIVE") return row.state;
  return row.lane !== null && resolveSolanaLaneState(row.lane, env) === "OPEN" ? "LIVE" : "PAUSED";
}

/** The venues through which a capability is open on a network right now. */
export function openVenues(
  network: NetworkId,
  capability: CapabilityId,
  env: Record<string, string | undefined> = process.env,
): readonly CapabilityRow[] {
  return CAPABILITY_REGISTRY.filter(
    (row) => row.network === network && row.capability === capability && resolveCapabilityState(row, env) === "LIVE",
  );
}

/** The Ryntra rate a row charges, in basis points — on a policy row, the flow's; null while it is not set. */
export function capabilityFeeBps(row: CapabilityRow, flow: FeeFlow = "AS_NOW"): number | null {
  if (row.fee.kind === "NONE") return 0;
  if (row.fee.kind === "NOT_SET") return null;
  if (row.fee.kind === "POLICY") return FEE_POLICY_V2[flow].bps;
  return RYNTRA_SERVICE_FEE_POLICY[row.fee.mechanism];
}

/**
 * The fee identity a product's flow carries on a row, with its address: the
 * deployment's for a referral account or a Relay recipient, the attribution
 * registry's for a product fee wallet. Null when the row has no identity for
 * that product.
 */
export function resolveFeeIdentity(row: CapabilityRow, product: Product, config: ServiceFeeConfig): FeeIdentity | null {
  const attribution = row.attribution;
  if (!attribution || !attribution.products.includes(product)) return null;
  const address =
    attribution.kind === "JUPITER_REFERRAL_ACCOUNT"
      ? config.jupiterReferralAccount
      : attribution.kind === "RELAY_APP_FEE_RECIPIENT"
        ? config.relayAppFeeRecipient
        : attribution.kind === "FEE_WALLET"
          ? feeWalletOf(product, row.network)
          : null;
  return { product, kind: attribution.kind, address };
}
