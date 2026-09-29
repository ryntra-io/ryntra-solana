/**
 * The one 402 engine.
 *
 * Every provider difference in this product lives in
 * `./implementations.ts` as data, and every decision about a payment route
 * lives here. That split is the packet's central claim, and it is checked
 * rather than asserted: a test reads this file from disk and fails if it
 * branches on a provider id, and reads the implementations file and fails if it
 * defines a resolver.
 *
 * ## What resolving a route means, and what it does not
 *
 * It means: given a protocol, an implementation, a method, a facilitator, a
 * network and an asset, decide whether that combination is (a) something the
 * provider's own documentation says is possible and (b) something this owner's
 * policy permits, and produce a frozen record naming all six.
 *
 * It does not mean anything happens. There is no signer, no credential, no
 * facilitator client and no network call in this module or any module it
 * imports. A resolved route is a description of a road, not a journey on it.
 *
 * ## The order of the checks is load-bearing
 *
 * Provider capability first, owner permission second. A route that nobody can
 * take and this owner also has not allowed reports the provider fact, because
 * *you may not* is a misleading answer when the truth is *nobody can*. Canon
 * `04 §6` puts unsupported action and network above budget for the same reason.
 *
 * ## The fifth constraint lives in the policy on purpose
 *
 * The adapter says what the provider *can* do; the per-chain `assetPolicy`
 * allowlist says what this owner *permits*, and it is keyed by network so that
 * an entry for one chain can never satisfy another. Those are two different
 * facts about the same token and collapsing them is how a mainnet allowance
 * silently authorises a testnet route, or the reverse.
 */

import { AGENT_CONTROL_REGISTRY, registryPin, resolveRegistryRef, type RegistryPin } from "../registry.ts";
import {
  PAYMENT_FACILITATORS,
  PAYMENT_METHODS,
  PAYMENT_PROTOCOL,
  PROVIDER_IMPLEMENTATIONS,
  paymentImplementation,
  type PaymentFacilitator,
  type PaymentMethod,
  type ProviderImplementation,
} from "./implementations.ts";
import type { PaymentTrustClass } from "./vocabulary.ts";

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const X402_ROUTE_REFUSALS = [
  "PAYMENT_PROTOCOL_UNSUPPORTED",
  "IMPLEMENTATION_UNKNOWN",
  "PAYMENT_METHOD_UNKNOWN",
  "FACILITATOR_UNKNOWN",
  "FACILITATOR_NOT_DECLARED_BY_IMPLEMENTATION",
  "NETWORK_NOT_DECLARED_BY_IMPLEMENTATION",
  "ASSET_NOT_DECLARED_BY_IMPLEMENTATION",
  "PAYMENT_METHOD_NOT_SUPPORTED_FOR_ASSET",
  "IMPLEMENTATION_NOT_ALLOWED_BY_POLICY",
  "PAYMENT_METHOD_NOT_ALLOWED_BY_POLICY",
  "FACILITATOR_NOT_ALLOWED_BY_POLICY",
  "NETWORK_NOT_ALLOWED_BY_POLICY",
  "ASSET_NOT_ALLOWED_ON_NETWORK",
  "AMOUNT_MALFORMED",
] as const;

export type X402RouteRefusal = (typeof X402_ROUTE_REFUSALS)[number];

export class X402RouteError extends Error {
  readonly reasonCode: X402RouteRefusal;

  constructor(reasonCode: X402RouteRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "X402RouteError";
    this.reasonCode = reasonCode;
  }
}

/**
 * The owner's side of a route.
 *
 * Budget deliberately is not here. `lib/agent-control/owner-control.ts` already
 * owns allocation, reservation, commitment and settlement against a versioned
 * mandate; a second per-call ceiling in this file would be a second copy of the
 * one number that must never disagree with itself.
 */
export type CommercePaymentPolicy = Readonly<{
  id: string;
  version: number;
  allowedImplementations: readonly ProviderImplementation[];
  allowedMethods: readonly PaymentMethod[];
  allowedFacilitators: readonly PaymentFacilitator[];
  /** Per chain. An entry for one network never satisfies another. */
  assetPolicy: readonly Readonly<{ network: string; assetRefs: readonly string[] }>[];
}>;

export type ResolvedPaymentRoute = Readonly<{
  protocol: typeof PAYMENT_PROTOCOL;
  implementation: ProviderImplementation;
  implementationLabel: string;
  operator: string;
  method: PaymentMethod;
  facilitator: PaymentFacilitator;
  network: string;
  assetRef: string;
  assetSymbol: string;
  /** How this provider spells this method on the wire, when it publishes one. */
  wireValue: string | null;
  /** The most this operator's own report can ever establish, before observation. */
  trustCeiling: PaymentTrustClass;
  policyRef: Readonly<{ id: string; version: number }>;
  registryPin: RegistryPin;
  sourceUrl: string;
  limitations: readonly string[];
}>;

export type ResolvePaymentRouteInput = Readonly<{
  protocol: string;
  implementation: string;
  method: string;
  facilitator: string;
  network: string;
  assetRef: string;
  policy: CommercePaymentPolicy;
}>;

/**
 * A stable identity for one route, and the reason the two `B402`s can never be
 * confused for each other.
 *
 * Pipe-separated rather than colon-separated because CAIP-2 and CAIP-19 already
 * use colons and slashes; a separator that appears inside a field is a parser
 * bug waiting for the first asset id that contains it.
 */
export function routeId(route: ResolvedPaymentRoute): string {
  return [
    route.protocol,
    route.implementation,
    route.method,
    route.facilitator,
    route.network,
    route.assetRef,
  ].join("|");
}

/**
 * Resolve one route, failing closed with a named reason at the first check it
 * cannot pass.
 */
export function resolvePaymentRoute(input: ResolvePaymentRouteInput): ResolvedPaymentRoute {
  if (input.protocol !== PAYMENT_PROTOCOL) {
    throw new X402RouteError(
      "PAYMENT_PROTOCOL_UNSUPPORTED",
      `this engine speaks ${PAYMENT_PROTOCOL} and was handed ${String(input.protocol)}`,
    );
  }
  if (!PROVIDER_IMPLEMENTATIONS.includes(input.implementation as ProviderImplementation)) {
    throw new X402RouteError("IMPLEMENTATION_UNKNOWN", String(input.implementation));
  }
  if (!PAYMENT_METHODS.includes(input.method as PaymentMethod)) {
    throw new X402RouteError("PAYMENT_METHOD_UNKNOWN", String(input.method));
  }
  if (!PAYMENT_FACILITATORS.includes(input.facilitator as PaymentFacilitator)) {
    throw new X402RouteError("FACILITATOR_UNKNOWN", String(input.facilitator));
  }

  const declaration = paymentImplementation(input.implementation);
  if (!declaration) {
    throw new X402RouteError("IMPLEMENTATION_UNKNOWN", String(input.implementation));
  }

  const method = input.method as PaymentMethod;
  const facilitator = input.facilitator as PaymentFacilitator;

  /* --- what the provider says is possible ------------------------------- */

  if (!declaration.facilitators.includes(facilitator)) {
    throw new X402RouteError(
      "FACILITATOR_NOT_DECLARED_BY_IMPLEMENTATION",
      `${declaration.label} is operated by ${declaration.operator} and does not run through ${facilitator}`,
    );
  }
  if (!declaration.networks.includes(input.network)) {
    throw new X402RouteError(
      "NETWORK_NOT_DECLARED_BY_IMPLEMENTATION",
      `${declaration.label} declares no ${input.network}`,
    );
  }

  const asset = declaration.assets.find(
    (candidate) => candidate.assetRef === input.assetRef && candidate.network === input.network,
  );
  if (!asset) {
    throw new X402RouteError(
      "ASSET_NOT_DECLARED_BY_IMPLEMENTATION",
      `${declaration.label} publishes no contract for ${input.assetRef} on ${input.network}`,
    );
  }
  if (!asset.methods.includes(method)) {
    throw new X402RouteError(
      "PAYMENT_METHOD_NOT_SUPPORTED_FOR_ASSET",
      `${declaration.label} does not offer ${method} for ${asset.symbol}`,
    );
  }

  /* --- what this owner permits ------------------------------------------ */

  const policy = input.policy;
  if (!policy.allowedImplementations.includes(declaration.id)) {
    throw new X402RouteError("IMPLEMENTATION_NOT_ALLOWED_BY_POLICY", declaration.id);
  }
  if (!policy.allowedMethods.includes(method)) {
    throw new X402RouteError("PAYMENT_METHOD_NOT_ALLOWED_BY_POLICY", method);
  }
  if (!policy.allowedFacilitators.includes(facilitator)) {
    throw new X402RouteError("FACILITATOR_NOT_ALLOWED_BY_POLICY", facilitator);
  }

  /* The per-chain allowlist. Looked up by network first and then by asset, so a
     token permitted on one chain cannot answer for the same token on another —
     and an absent chain entry is a refusal rather than a pass. */
  const chainEntry = policy.assetPolicy.find((entry) => entry.network === input.network);
  if (!chainEntry) {
    throw new X402RouteError(
      "NETWORK_NOT_ALLOWED_BY_POLICY",
      `policy ${policy.id}@${policy.version} lists no assets for ${input.network}`,
    );
  }
  if (!chainEntry.assetRefs.includes(input.assetRef)) {
    throw new X402RouteError(
      "ASSET_NOT_ALLOWED_ON_NETWORK",
      `${asset.symbol} is not on the ${input.network} allowlist of policy ${policy.id}@${policy.version}`,
    );
  }

  /* --- the pin a verifier can reproduce --------------------------------- */

  resolveRegistryRef(AGENT_CONTROL_REGISTRY, declaration.adapterRef, "ADAPTER");
  resolveRegistryRef(AGENT_CONTROL_REGISTRY, declaration.actionRef, "ACTION_SCHEMA");
  const pin = registryPin(AGENT_CONTROL_REGISTRY, [declaration.adapterRef, declaration.actionRef]);

  return Object.freeze({
    protocol: PAYMENT_PROTOCOL,
    implementation: declaration.id,
    implementationLabel: declaration.label,
    operator: declaration.operator,
    method,
    facilitator,
    network: input.network,
    assetRef: asset.assetRef,
    assetSymbol: asset.symbol,
    wireValue: declaration.wireValueByMethod[method] ?? null,
    trustCeiling: declaration.facilitatorTrustCeiling,
    policyRef: Object.freeze({ id: policy.id, version: policy.version }),
    registryPin: pin,
    sourceUrl: declaration.source.url,
    limitations: declaration.limitations,
  });
}

/**
 * What a resolved route would cost and why it still cannot happen.
 *
 * A preview is deliberately a different type from a receipt, with different
 * fields and its own limitation strings. Canon `01 §24`: a preview is never a
 * Receipt, and the cheapest way to break that rule is to give one object an
 * optional `settlement` field and fill it in later.
 */
export type X402RoutePreview = Readonly<{
  kind: "X402_ROUTE_PREVIEW";
  createdAt: string;
  route: ResolvedPaymentRoute;
  routeId: string;
  amount: string;
  execution: Readonly<{ status: "UNAVAILABLE"; reasonCode: "NO_PAYMENT_CREDENTIAL" }>;
  limitations: readonly string[];
}>;

export const X402_ROUTE_PREVIEW_LIMITATIONS: readonly string[] = Object.freeze([
  "This is a route preview and not a receipt. Nothing has been paid, submitted, signed or observed.",
  "Ryntra holds no facilitator credential, no signer and no key on any of these routes, so no payment can be attempted from here.",
  "The provider facts behind this route are read from published documentation on the date the declaration records, and none of them is live-verified.",
  "A payment that settles is still not a service that was delivered. Those are two separate observations with two separate admissible sources.",
]);

export function buildRoutePreview({
  route,
  amount,
  now,
}: {
  route: ResolvedPaymentRoute;
  amount: string;
  now: Date;
}): X402RoutePreview {
  if (typeof amount !== "string" || !DECIMAL_STRING.test(amount)) {
    throw new X402RouteError("AMOUNT_MALFORMED", "an amount must be a plain decimal string");
  }
  return Object.freeze({
    kind: "X402_ROUTE_PREVIEW" as const,
    createdAt: now.toISOString(),
    route,
    routeId: routeId(route),
    amount,
    execution: Object.freeze({
      status: "UNAVAILABLE" as const,
      reasonCode: "NO_PAYMENT_CREDENTIAL" as const,
    }),
    limitations: X402_ROUTE_PREVIEW_LIMITATIONS,
  });
}
