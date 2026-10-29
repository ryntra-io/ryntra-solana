/**
 * The agents' hub on Solana — Ryntra's own, assembled from configuration.
 *
 * Decision 58 settled where this lives: Solana has its own agent hub, built
 * here, with no gate in another product's way. This module is the assembly
 * point. It turns the owner's four environment values and the one sellable
 * service into the two objects the rest of the hub needs — a `ProviderRegistry`
 * and a `ProcurementPolicy` — and it says, in one list, everything stopping
 * either from being real today.
 *
 * ## Ryntra is the first provider, and for a while the only one
 *
 * The first party an agent of Ryntra may pay is Ryntra: one service, the deep
 * token report, at the price the owner sets. That is the order the review set
 * on purpose — sell before buying, so the first paid call is one whose cost is
 * known — and it makes the hub's own devnet pass a round trip between two parts
 * of this product rather than a dependency on somebody else's uptime.
 *
 * Other providers are the owner's to admit, one at a time, with the source and
 * the date behind each. There is no discovery, no catalogue of other people's
 * agents and nothing resembling a ranking: that is a later decision (D18, after
 * a paid pilot) and building it early would be building a marketplace this
 * product has already decided against.
 *
 * ## An empty registry is the correct answer today
 *
 * With the owner's values unset the registry has no providers, and every
 * procurement decision refuses at `PROVIDER_NOT_REGISTERED`. That is not a
 * degraded mode to be worked around — it is the hub saying that an agent of
 * Ryntra can pay nobody, which is true until the owner sets a recipient, a
 * price and a facilitator on their own machine.
 */

import {
  X402_SOLANA_NETWORKS,
  splAssetRef,
} from "./protocol.ts";
import {
  buildProviderRegistry,
  type ProviderRegistry,
  type RegisteredProvider,
  type RegisteredService,
} from "./provider-registry.ts";
import {
  buildProcurementPolicy,
  type ProcurementPolicy,
} from "./policy.ts";
import {
  SELLER_ENV,
  TOKEN_DEEP_REPORT,
  sellerReadiness,
  type SellerConfig,
  type SellerReadiness,
  type SellerReadinessBlocker,
} from "./seller.ts";

export const RYNTRA_PROVIDER_ID = "ryntra" as const;

/**
 * Ryntra's own bounds on an agent's spending, in USDC base units.
 *
 * These are not prices — D22 leaves prices to the owner after a cost
 * measurement — they are the ceiling above which a payment is refused whatever
 * a provider quotes. The band comes from the owner's review, which puts an
 * agent's x402 call at 0.01 to 1 USDC: one dollar a call and ten a day is the
 * largest number that band can justify, and a number a policy cannot justify is
 * a number somebody will raise.
 *
 * The same shape as `AGENT_LIMIT_CAP_RAW` in the treasury model, and for the
 * same reason: a cap Ryntra sets on what an agent may be handed is Ryntra's own
 * decision, not a figure read from a chain.
 */
export const AGENT_PROCUREMENT_CAPS = Object.freeze({
  perCallBaseUnits: "1000000",
  dailyBaseUnits: "10000000",
  /** Up to this, the agent acts alone; above it a person confirms the action. */
  agentBoundBaseUnits: "500000",
});

/** How stale a quote may be when the hub answers it. */
export const HUB_NONCE_MAX_AGE_SECONDS = 60;

/**
 * The policy the hub runs. One object, built rather than typed, so every bound
 * it states has already passed the policy builder's own checks.
 */
export function buildHubPolicy(): ProcurementPolicy {
  return buildProcurementPolicy({
    id: "solana-agent-procurement",
    version: 1,
    /* `exact` only. `upto` is declarable by a provider and the policy refuses
       it, because an upper bound a seller chooses is not a bound the owner set. */
    allowedSchemes: ["exact"],
    allowedFacilitators: ["COINBASE_CDP"],
    allowedAssets: [
      {
        network: X402_SOLANA_NETWORKS.devnet,
        assetRefs: [splAssetRef(X402_SOLANA_NETWORKS.devnet, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")],
      },
      {
        network: X402_SOLANA_NETWORKS.mainnet,
        assetRefs: [splAssetRef(X402_SOLANA_NETWORKS.mainnet, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")],
      },
    ],
    perCallCeilingBaseUnits: AGENT_PROCUREMENT_CAPS.perCallBaseUnits,
    dailyCeilingBaseUnits: AGENT_PROCUREMENT_CAPS.dailyBaseUnits,
    nonceMaxAgeSeconds: HUB_NONCE_MAX_AGE_SECONDS,
    refund: "PATH_REQUIRED",
    limitations: [
      "USDC is the only asset on either chain, and each chain's allowlist is its own: an entry for devnet never answers for mainnet.",
      "`upto` is refused whatever a provider declares. Only `exact` is bought here.",
      "The ceilings are Ryntra's own and are not enforced by any program. The program-enforced bound is the mandate's.",
    ],
  });
}

export type HubState = Readonly<{
  registry: ProviderRegistry;
  policy: ProcurementPolicy;
  /** Ryntra's own listing, when it is sellable. `null` while it is not. */
  ownService: SellerReadiness;
  /** Everything stopping the hub from buying or selling anything. */
  blockers: readonly Readonly<{ code: SellerReadinessBlocker | "ORIGIN_UNKNOWN"; detail: string }>[];
}>;

/** Ryntra's own provider entry, once there is a price, a recipient and a chain. */
function ryntraProvider(config: SellerConfig, origin: string): RegisteredProvider {
  const service: RegisteredService = Object.freeze({
    serviceId: TOKEN_DEEP_REPORT.serviceId,
    label: TOKEN_DEEP_REPORT.label,
    resource: `${origin}${TOKEN_DEEP_REPORT.path}`,
    scheme: TOKEN_DEEP_REPORT.scheme,
    facilitator: config.facilitator,
    network: config.network,
    mint: config.mint,
    assetRef: splAssetRef(config.network, config.mint),
    assetSymbol: config.assetSymbol,
    decimals: config.decimals,
    priceBaseUnits: config.priceBaseUnits,
    /* The ceiling is the owner's per-call cap rather than the price, so a
       re-priced service refuses at a bound instead of being paid at the new
       number. */
    priceCeilingBaseUnits: AGENT_PROCUREMENT_CAPS.perCallBaseUnits,
    maxTimeoutSeconds: TOKEN_DEEP_REPORT.maxTimeoutSeconds,
    refund: "PROVIDER_REVIEW",
    reach: "DEVNET_THEN_OWNER_CANARY",
    deliverable: TOKEN_DEEP_REPORT.adds.join(" "),
    limitations: TOKEN_DEEP_REPORT.limitations,
  });

  return Object.freeze({
    providerId: RYNTRA_PROVIDER_ID,
    label: "Ryntra",
    operator: "Ryntra",
    origin,
    /* Ryntra's own deployment, so the proof is the deployment itself rather
       than a card it would be writing about itself. */
    identityProof: "DOMAIN_TLS",
    identityReference: origin,
    services: Object.freeze([service]),
    source: Object.freeze({ url: `${origin}/api/agents/services`, observedAt: "2026-10-26" }),
    limitations: Object.freeze([
      "The first provider of this hub is Ryntra itself, so the first paid round trip is between two parts of one product.",
      "Other providers are the owner's to admit one at a time. There is no discovery and no catalogue of other people's agents.",
    ]),
  });
}

/**
 * Assemble the hub.
 *
 * `origin` is the deployment's own absolute origin — `https://ryntra.io` in
 * production. Without it Ryntra cannot be registered as a provider of its own
 * service, because a registered resource is an absolute URL and a relative path
 * is not one.
 */
export function buildHubState({
  env,
  origin,
}: {
  env: Readonly<Record<string, string | undefined>>;
  origin: string | null;
}): HubState {
  const ownService = sellerReadiness(TOKEN_DEEP_REPORT, env);
  const blockers: Array<Readonly<{ code: SellerReadinessBlocker | "ORIGIN_UNKNOWN"; detail: string }>> =
    ownService.sellable ? [] : [...ownService.blockers];

  let providers: readonly RegisteredProvider[] = [];
  if (ownService.config !== null) {
    if (origin === null || !/^https:\/\/[^/]+$/.test(origin)) {
      blockers.push(
        Object.freeze({
          code: "ORIGIN_UNKNOWN" as const,
          detail: "the deployment's own https origin is not known, so no absolute resource can be registered",
        }),
      );
    } else {
      providers = Object.freeze([ryntraProvider(ownService.config, origin)]);
    }
  }

  return Object.freeze({
    registry: buildProviderRegistry({
      id: "solana-agent-providers",
      version: 1,
      providers,
    }),
    policy: buildHubPolicy(),
    ownService,
    blockers: Object.freeze(blockers),
  });
}

/** The environment names the owner sets, in one place for the surface to print. */
export const HUB_ENV_NAMES = SELLER_ENV;
