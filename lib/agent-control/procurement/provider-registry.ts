/**
 * `ProviderRegistry` — the list of parties an agent of Ryntra may pay, and the
 * only answer to the question *may this URL be paid at all*.
 *
 * The specification (§5.7) states the rule in one line: an agent cannot pay an
 * arbitrary URL from a prompt. This module is that line made structural. A
 * resource is payable when a **registered provider** declares it, at a declared
 * price, in a declared currency, under a declared ceiling, with a declared
 * timeout and a declared refund path. Anything else resolves to a named
 * refusal, and there is no code path from a string to a payment that does not
 * pass through here.
 *
 * ## Why the URL is matched on origin and path, and nothing looser
 *
 * Prompt injection arrives as text that looks like a resource. The two shapes
 * that matter are a host that merely *contains* a registered name
 * (`api.ryntra.io.evil.test`) and a path that merely *starts with* a registered
 * one (`/v1/token-risk/../../drain`). Both pass a `includes` or a
 * `startsWith` check and neither passes this one: the origin is compared whole,
 * after the URL parser has normalised it, and the pathname must equal a
 * declared path exactly. Query parameters are allowed, because the mint being
 * priced is one, and they are never part of the match.
 *
 * ## What the registry is not
 *
 * It is not a marketplace and not a directory. It holds providers the owner has
 * admitted, with the source and the date each fact was read. Discovery, a
 * catalogue of other people's agents, and anything resembling a ranking are a
 * different product decision (D18, after a paid pilot) and deliberately absent.
 *
 * It also holds no credential. A provider entry carries no API key, no bearer
 * token and no account id, because a secret in a registry is a secret in a
 * payment authorization, and §5.7 refuses exactly that: an API key is not a
 * spending permission.
 */

import {
  X402_SCHEMES,
  X402_SOLANA_NETWORKS,
  X402_TIMEOUT_SECONDS,
  facilitatorDeclaration,
  isSolanaNetwork,
  splAssetRef,
  type X402Facilitator,
  type X402Scheme,
} from "./protocol.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE_UNITS = /^(?:0|[1-9]\d*)$/;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * How a provider's identity is established — not whether it is trustworthy.
 *
 * `AGENT_CARD` is a `/.well-known/agent.json` read at the registered origin;
 * `DOMAIN_TLS` is the certificate alone. `NONE` exists and is permitted,
 * because an honest registry records a provider the product's owner admitted
 * with nothing else behind it rather than inventing a proof for it. What a
 * provider cannot do is be absent.
 */
export const PROVIDER_IDENTITY_PROOFS = ["AGENT_CARD", "DOMAIN_TLS", "NONE"] as const;

export type ProviderIdentityProof = (typeof PROVIDER_IDENTITY_PROOFS)[number];

/**
 * Where the money goes when a payment settles and the resource does not
 * arrive. `NONE` is a legal value and it is the one that costs: the procurement
 * policy can require a path, and a provider with none is then unbuyable.
 */
export const PROVIDER_REFUND_PATHS = ["NONE", "PROVIDER_REVIEW", "ON_CHAIN_REVERSAL"] as const;

export type ProviderRefundPath = (typeof PROVIDER_REFUND_PATHS)[number];

/**
 * How far a service may be taken. The field exists because of the Pull Program.
 *
 * Blueshift's Pull Program has no audit, and the registry row for this task is
 * explicit: paper and devnet only, never a surface for people. A declaration
 * that cannot be enforced is a comment, so the reach is a field, the policy
 * reads it, and a mainnet request against a `PAPER_AND_DEVNET_ONLY` service is
 * a refusal by name.
 */
export const SERVICE_REACH = ["PAPER_AND_DEVNET_ONLY", "DEVNET_THEN_OWNER_CANARY", "LIVE"] as const;

export type ServiceReach = (typeof SERVICE_REACH)[number];

export type RegisteredService = Readonly<{
  serviceId: string;
  label: string;
  /** The absolute `https` URL. Origin and pathname are both load-bearing. */
  resource: string;
  scheme: X402Scheme;
  facilitator: X402Facilitator;
  /** CAIP-2. */
  network: string;
  /** The SPL mint. */
  mint: string;
  assetRef: string;
  assetSymbol: string;
  decimals: number;
  /** What the provider says it costs, in base units. */
  priceBaseUnits: string;
  /**
   * The most this service may ever be charged at, in base units.
   *
   * A separate number from the price on purpose, and it binds the
   * **registration** rather than the request: a price above its ceiling is
   * refused here, at build, so a provider that re-prices upward cannot be
   * re-admitted at the new number without the owner raising the ceiling first.
   * The request is bound by the registered price and by the policy's own
   * per-call ceiling — a third comparison at request time could never fire and
   * would be a bound in name only.
   */
  priceCeilingBaseUnits: string;
  maxTimeoutSeconds: number;
  refund: ProviderRefundPath;
  reach: ServiceReach;
  /** What a buyer gets, and what is not included. Shown, never inferred. */
  deliverable: string;
  limitations: readonly string[];
}>;

export type RegisteredProvider = Readonly<{
  providerId: string;
  label: string;
  operator: string;
  /** Origin only — scheme, host and port. No path, no credential, ever. */
  origin: string;
  identityProof: ProviderIdentityProof;
  identityReference: string | null;
  services: readonly RegisteredService[];
  source: Readonly<{ url: string; observedAt: string }>;
  limitations: readonly string[];
}>;

export type ProviderRegistry = Readonly<{
  id: string;
  version: number;
  providers: readonly RegisteredProvider[];
}>;

export const PROVIDER_REGISTRY_REFUSALS = [
  /* Building one. */
  "REGISTRY_ID_MALFORMED",
  "PROVIDER_ID_REPEATED",
  "PROVIDER_ORIGIN_NOT_HTTPS",
  "PROVIDER_ORIGIN_CARRIES_PATH",
  "PROVIDER_ORIGIN_CARRIES_CREDENTIAL",
  "PROVIDER_HAS_NO_SERVICE",
  "SERVICE_ID_REPEATED",
  "SERVICE_RESOURCE_NOT_UNDER_ORIGIN",
  "SERVICE_RESOURCE_REPEATED",
  "SERVICE_NETWORK_NOT_SOLANA",
  "SERVICE_MINT_MALFORMED",
  "SERVICE_SCHEME_UNKNOWN",
  "SERVICE_FACILITATOR_UNKNOWN",
  "SERVICE_FACILITATOR_DOES_NOT_DECLARE_SCHEME",
  "SERVICE_FACILITATOR_DOES_NOT_DECLARE_NETWORK",
  "SERVICE_PRICE_MALFORMED",
  "SERVICE_CEILING_BELOW_PRICE",
  "SERVICE_TIMEOUT_OUT_OF_RANGE",
  "SERVICE_DECIMALS_OUT_OF_RANGE",
  "SERVICE_PAPER_ONLY_ON_MAINNET",
  /* Resolving one. */
  "RESOURCE_URL_MALFORMED",
  "RESOURCE_URL_NOT_HTTPS",
  "RESOURCE_URL_CARRIES_CREDENTIAL",
  "PROVIDER_NOT_REGISTERED",
  "RESOURCE_NOT_REGISTERED",
] as const;

export type ProviderRegistryRefusal = (typeof PROVIDER_REGISTRY_REFUSALS)[number];

export class ProviderRegistryError extends Error {
  readonly reasonCode: ProviderRegistryRefusal;

  constructor(reasonCode: ProviderRegistryRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "ProviderRegistryError";
    this.reasonCode = reasonCode;
  }
}

/** The origin of a URL, or `null` when the string is not one this hub accepts. */
function originOf(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Build a registry, refusing at the first entry it cannot stand behind.
 *
 * Every check here is about the *declaration* rather than about a request, and
 * every one of them is a mistake that would otherwise be discovered at a
 * payment: a service whose facilitator does not speak its scheme issues quotes
 * nobody can settle, and a ceiling below the price makes every call refuse at
 * the ceiling with no way to tell that from a re-pricing.
 */
export function buildProviderRegistry(input: {
  id: string;
  version: number;
  providers: readonly RegisteredProvider[];
}): ProviderRegistry {
  if (!ID.test(input.id) || !Number.isInteger(input.version) || input.version <= 0) {
    throw new ProviderRegistryError(
      "REGISTRY_ID_MALFORMED",
      `${input.id}@${input.version} is not a registry identity`,
    );
  }

  const seenProviders = new Set<string>();
  const seenServices = new Set<string>();
  const seenResources = new Set<string>();

  for (const provider of input.providers) {
    if (!ID.test(provider.providerId) || seenProviders.has(provider.providerId)) {
      throw new ProviderRegistryError("PROVIDER_ID_REPEATED", provider.providerId);
    }
    seenProviders.add(provider.providerId);

    const origin = originOf(provider.origin);
    if (!origin || origin.protocol !== "https:") {
      throw new ProviderRegistryError("PROVIDER_ORIGIN_NOT_HTTPS", provider.origin);
    }
    if (origin.username.length > 0 || origin.password.length > 0) {
      throw new ProviderRegistryError(
        "PROVIDER_ORIGIN_CARRIES_CREDENTIAL",
        "a registry entry never carries a credential; §5.7 refuses an API key as a spending permission",
      );
    }
    if (origin.pathname !== "/" || origin.search.length > 0 || origin.hash.length > 0) {
      throw new ProviderRegistryError(
        "PROVIDER_ORIGIN_CARRIES_PATH",
        `${provider.origin} is a URL, and a provider is identified by its origin alone`,
      );
    }
    if (provider.services.length === 0) {
      throw new ProviderRegistryError("PROVIDER_HAS_NO_SERVICE", provider.providerId);
    }

    for (const service of provider.services) {
      const key = `${provider.providerId}/${service.serviceId}`;
      if (!ID.test(service.serviceId) || seenServices.has(key)) {
        throw new ProviderRegistryError("SERVICE_ID_REPEATED", key);
      }
      seenServices.add(key);

      const resource = originOf(service.resource);
      if (!resource || resource.protocol !== "https:") {
        throw new ProviderRegistryError("SERVICE_RESOURCE_NOT_UNDER_ORIGIN", service.resource);
      }
      if (resource.origin !== origin.origin) {
        throw new ProviderRegistryError(
          "SERVICE_RESOURCE_NOT_UNDER_ORIGIN",
          `${service.resource} is not under ${origin.origin}`,
        );
      }
      if (resource.search.length > 0 || resource.hash.length > 0) {
        throw new ProviderRegistryError(
          "SERVICE_RESOURCE_NOT_UNDER_ORIGIN",
          "a declared resource is an origin and a path; a query is the caller's, never the declaration's",
        );
      }
      const resourceKey = `${resource.origin}${resource.pathname}`;
      if (seenResources.has(resourceKey)) {
        throw new ProviderRegistryError("SERVICE_RESOURCE_REPEATED", resourceKey);
      }
      seenResources.add(resourceKey);

      if (!isSolanaNetwork(service.network)) {
        throw new ProviderRegistryError("SERVICE_NETWORK_NOT_SOLANA", service.network);
      }
      /* The first of the two layers behind the Pull Program's bound: a service
         with no audit behind it cannot be *registered* on mainnet at all, so
         the question never reaches a policy. The second layer is the policy's
         own refusal for a request that names mainnet anyway. */
      if (service.reach === "PAPER_AND_DEVNET_ONLY" && service.network === X402_SOLANA_NETWORKS.mainnet) {
        throw new ProviderRegistryError(
          "SERVICE_PAPER_ONLY_ON_MAINNET",
          `${service.serviceId} is paper and devnet only, and mainnet is neither`,
        );
      }
      if (!BASE58.test(service.mint)) {
        throw new ProviderRegistryError("SERVICE_MINT_MALFORMED", service.mint);
      }
      if (service.assetRef !== splAssetRef(service.network, service.mint)) {
        throw new ProviderRegistryError(
          "SERVICE_MINT_MALFORMED",
          `the CAIP-19 reference must be derived from the network and the mint, not typed beside them`,
        );
      }
      if (!Number.isInteger(service.decimals) || service.decimals < 0 || service.decimals > 18) {
        throw new ProviderRegistryError("SERVICE_DECIMALS_OUT_OF_RANGE", String(service.decimals));
      }
      if (!X402_SCHEMES.includes(service.scheme)) {
        throw new ProviderRegistryError("SERVICE_SCHEME_UNKNOWN", String(service.scheme));
      }

      const facilitator = facilitatorDeclaration(service.facilitator);
      if (!facilitator) {
        throw new ProviderRegistryError("SERVICE_FACILITATOR_UNKNOWN", String(service.facilitator));
      }
      if (!facilitator.schemes.includes(service.scheme)) {
        throw new ProviderRegistryError(
          "SERVICE_FACILITATOR_DOES_NOT_DECLARE_SCHEME",
          `${facilitator.label} publishes no ${service.scheme}`,
        );
      }
      if (!facilitator.networks.includes(service.network)) {
        throw new ProviderRegistryError(
          "SERVICE_FACILITATOR_DOES_NOT_DECLARE_NETWORK",
          `${facilitator.label} declares no ${service.network}`,
        );
      }

      if (!BASE_UNITS.test(service.priceBaseUnits) || !BASE_UNITS.test(service.priceCeilingBaseUnits)) {
        throw new ProviderRegistryError(
          "SERVICE_PRICE_MALFORMED",
          "a price is whole base units as digits, never a decimal display string",
        );
      }
      if (BigInt(service.priceBaseUnits) === 0n) {
        throw new ProviderRegistryError(
          "SERVICE_PRICE_MALFORMED",
          "a free service does not belong in a registry of things an agent may pay for",
        );
      }
      if (BigInt(service.priceCeilingBaseUnits) < BigInt(service.priceBaseUnits)) {
        throw new ProviderRegistryError(
          "SERVICE_CEILING_BELOW_PRICE",
          `${service.serviceId} prices at ${service.priceBaseUnits} under a ceiling of ${service.priceCeilingBaseUnits}`,
        );
      }
      if (
        !Number.isInteger(service.maxTimeoutSeconds) ||
        service.maxTimeoutSeconds < X402_TIMEOUT_SECONDS.min ||
        service.maxTimeoutSeconds > X402_TIMEOUT_SECONDS.max
      ) {
        throw new ProviderRegistryError(
          "SERVICE_TIMEOUT_OUT_OF_RANGE",
          `${service.maxTimeoutSeconds}s is outside ${X402_TIMEOUT_SECONDS.min}–${X402_TIMEOUT_SECONDS.max}s`,
        );
      }
    }
  }

  return Object.freeze({
    id: input.id,
    version: input.version,
    providers: Object.freeze(input.providers.map((provider) => Object.freeze({
      ...provider,
      services: Object.freeze([...provider.services].map((service) => Object.freeze({ ...service }))),
    }))),
  });
}

export type ResolvedResource =
  | Readonly<{
      ok: true;
      provider: RegisteredProvider;
      service: RegisteredService;
      /** The normalised URL, origin and path only. The query is the caller's. */
      canonicalResource: string;
    }>
  | Readonly<{ ok: false; reasonCode: ProviderRegistryRefusal; detail: string }>;

/**
 * Resolve a URL to a registered service, or refuse it by name.
 *
 * This is the function a prompt cannot talk its way past. It takes a string
 * from anywhere — a tool result, a web page, a user message — and the only
 * thing it can return is an entry an Owner put in the registry.
 */
export function resolveRegisteredResource(registry: ProviderRegistry, url: string): ResolvedResource {
  const no = (reasonCode: ProviderRegistryRefusal, detail: string): ResolvedResource =>
    Object.freeze({ ok: false as const, reasonCode, detail });

  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return no("RESOURCE_URL_MALFORMED", "a resource is a string of at most 2048 characters");
  }
  const parsed = originOf(url);
  if (!parsed) return no("RESOURCE_URL_MALFORMED", url);
  if (parsed.protocol !== "https:") {
    return no("RESOURCE_URL_NOT_HTTPS", `${parsed.protocol} is not https`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return no(
      "RESOURCE_URL_CARRIES_CREDENTIAL",
      "a URL carrying a credential is not a resource this hub pays; §5.8 refuses a secret as an authorization",
    );
  }

  const provider = registry.providers.find((candidate) => {
    const origin = originOf(candidate.origin);
    return origin !== null && origin.origin === parsed.origin;
  });
  if (!provider) {
    return no(
      "PROVIDER_NOT_REGISTERED",
      `${parsed.origin} is not a provider of registry ${registry.id}@${registry.version}; an agent pays registered providers, never a URL from a prompt`,
    );
  }

  const service = provider.services.find((candidate) => {
    const resource = originOf(candidate.resource);
    return resource !== null && resource.origin === parsed.origin && resource.pathname === parsed.pathname;
  });
  if (!service) {
    return no(
      "RESOURCE_NOT_REGISTERED",
      `${provider.label} registers no priced resource at ${parsed.pathname}`,
    );
  }

  return Object.freeze({
    ok: true as const,
    provider,
    service,
    canonicalResource: `${parsed.origin}${parsed.pathname}`,
  });
}

/** Every service of every provider, flattened. The surface reads this. */
export function registeredServices(
  registry: ProviderRegistry,
): readonly Readonly<{ provider: RegisteredProvider; service: RegisteredService }>[] {
  return Object.freeze(
    registry.providers.flatMap((provider) =>
      provider.services.map((service) => Object.freeze({ provider, service })),
    ),
  );
}
