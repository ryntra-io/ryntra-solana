/**
 * `ProcurementPolicy` — the owner's side of a purchase, and the one decision
 * that stands between an agent and a payment.
 *
 * The registry row and specification §5.7 name what a policy must carry:
 * provider, price, currency, ceiling, nonce, receipt, timeout, and a
 * refund path. All seven are fields here, and each one refuses by name.
 *
 * ## The order of the checks, and why it is not the cheap one
 *
 * 1. **Is this URL payable at all** — the provider registry. A URL nobody
 *    registered is never a budget question, and answering it with "over the
 *    ceiling" invites a smaller amount for the same arbitrary host.
 * 2. **Is the route permitted** — scheme, network, asset, facilitator, and the
 *    service's own reach. A route the owner has not allowed cannot be fixed
 *    with a price.
 * 3. **Is the price the one that was declared** — the quote against the
 *    registered price and the owner's ceiling, then the per-call and daily
 *    bounds.
 * 4. **Is the request well formed** — timeout inside the provider's own bound,
 *    a refund path where the policy requires one, a receipt required, a nonce
 *    that is fresh and has not been used.
 * 5. **Who authorizes it** — the mandate gate. This is last because its answer
 *    is not a refusal: a sound request with no program-enforced mandate is one
 *    a person signs, and reporting that first would hide six real refusals
 *    behind "a human is needed".
 *
 * ## What a decision is not
 *
 * It is not a payment, a reservation or a hold. Nothing here signs, calls a
 * facilitator or touches a chain. An `allowed` decision says the hub would let
 * this purchase proceed and names who must authorize it; the money still moves
 * only through the buyer's own wallet and the owner's facilitator.
 */

import {
  X402_SCHEMES,
  X402_SOLANA_NETWORKS,
  isSolanaNetwork,
  facilitatorDeclaration,
  type X402Facilitator,
  type X402Scheme,
} from "./protocol.ts";
import {
  resolveRegisteredResource,
  type ProviderRegistry,
  type ProviderRegistryRefusal,
  type RegisteredProvider,
  type RegisteredService,
} from "./provider-registry.ts";
import {
  evaluateProgramMandate,
  type MandateDecision,
  type MandateRefusal,
  type ProgramMandateRead,
} from "./mandate.ts";

const BASE_UNITS = /^(?:0|[1-9]\d*)$/;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Whether a quote's own receipt is optional. It is not.
 *
 * A purchase with no receipt is a payment nobody can reconcile, and the two
 * axes this product keeps apart — paid and delivered — both live on one. So the
 * field exists to be stated rather than chosen, and the type has one value.
 */
export const PROCUREMENT_RECEIPT_RULES = ["REQUIRED"] as const;

export const PROCUREMENT_REFUND_RULES = ["PATH_REQUIRED", "PATH_OPTIONAL"] as const;

export type ProcurementRefundRule = (typeof PROCUREMENT_REFUND_RULES)[number];

export type ProcurementPolicy = Readonly<{
  id: string;
  version: number;
  allowedSchemes: readonly X402Scheme[];
  allowedFacilitators: readonly X402Facilitator[];
  /** Per chain. An entry for one network never answers for another. */
  allowedAssets: readonly Readonly<{ network: string; assetRefs: readonly string[] }>[];
  /** The most one call may cost, in the asset's base units. */
  perCallCeilingBaseUnits: string;
  /** The most every call together may cost in a day, in the same units. */
  dailyCeilingBaseUnits: string;
  /** How old a seller's quote may be when it is answered. */
  nonceMaxAgeSeconds: number;
  receipt: (typeof PROCUREMENT_RECEIPT_RULES)[number];
  refund: ProcurementRefundRule;
  /**
   * Whether a service whose reach is paper-and-devnet may ever be reached on
   * mainnet. It may not, and the field is here so the answer is enforced rather
   * than remembered: Blueshift's Pull Program has no audit.
   */
  paperOnlyReachesMainnet: false;
  limitations: readonly string[];
}>;

export const PROCUREMENT_POLICY_REFUSALS = [
  "POLICY_ID_MALFORMED",
  "POLICY_SCHEME_UNKNOWN",
  "POLICY_FACILITATOR_UNKNOWN",
  "POLICY_NETWORK_NOT_SOLANA",
  "POLICY_CEILING_MALFORMED",
  "POLICY_DAILY_BELOW_PER_CALL",
  "POLICY_NONCE_AGE_OUT_OF_RANGE",
] as const;

export type ProcurementPolicyRefusal = (typeof PROCUREMENT_POLICY_REFUSALS)[number];

export class ProcurementPolicyError extends Error {
  readonly reasonCode: ProcurementPolicyRefusal;

  constructor(reasonCode: ProcurementPolicyRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "ProcurementPolicyError";
    this.reasonCode = reasonCode;
  }
}

/** How stale a quote may ever be allowed to be, in seconds. */
export const PROCUREMENT_NONCE_AGE_SECONDS = Object.freeze({ min: 5, max: 300 });

export function buildProcurementPolicy(input: {
  id: string;
  version: number;
  allowedSchemes: readonly X402Scheme[];
  allowedFacilitators: readonly X402Facilitator[];
  allowedAssets: readonly Readonly<{ network: string; assetRefs: readonly string[] }>[];
  perCallCeilingBaseUnits: string;
  dailyCeilingBaseUnits: string;
  nonceMaxAgeSeconds: number;
  refund: ProcurementRefundRule;
  limitations?: readonly string[];
}): ProcurementPolicy {
  if (!ID.test(input.id) || !Number.isInteger(input.version) || input.version <= 0) {
    throw new ProcurementPolicyError(
      "POLICY_ID_MALFORMED",
      `${input.id}@${input.version} is not a policy identity`,
    );
  }
  for (const scheme of input.allowedSchemes) {
    if (!X402_SCHEMES.includes(scheme)) {
      throw new ProcurementPolicyError("POLICY_SCHEME_UNKNOWN", String(scheme));
    }
  }
  for (const facilitator of input.allowedFacilitators) {
    if (!facilitatorDeclaration(facilitator)) {
      throw new ProcurementPolicyError("POLICY_FACILITATOR_UNKNOWN", String(facilitator));
    }
  }
  for (const entry of input.allowedAssets) {
    if (!isSolanaNetwork(entry.network)) {
      throw new ProcurementPolicyError("POLICY_NETWORK_NOT_SOLANA", entry.network);
    }
  }
  if (!BASE_UNITS.test(input.perCallCeilingBaseUnits) || !BASE_UNITS.test(input.dailyCeilingBaseUnits)) {
    throw new ProcurementPolicyError(
      "POLICY_CEILING_MALFORMED",
      "a ceiling is whole base units as digits, never a decimal display string",
    );
  }
  if (BigInt(input.perCallCeilingBaseUnits) === 0n) {
    throw new ProcurementPolicyError(
      "POLICY_CEILING_MALFORMED",
      "a per-call ceiling of zero refuses everything, which is a disabled policy rather than a policy",
    );
  }
  if (BigInt(input.dailyCeilingBaseUnits) < BigInt(input.perCallCeilingBaseUnits)) {
    throw new ProcurementPolicyError(
      "POLICY_DAILY_BELOW_PER_CALL",
      `a day of ${input.dailyCeilingBaseUnits} cannot hold one call of ${input.perCallCeilingBaseUnits}`,
    );
  }
  if (
    !Number.isInteger(input.nonceMaxAgeSeconds) ||
    input.nonceMaxAgeSeconds < PROCUREMENT_NONCE_AGE_SECONDS.min ||
    input.nonceMaxAgeSeconds > PROCUREMENT_NONCE_AGE_SECONDS.max
  ) {
    throw new ProcurementPolicyError(
      "POLICY_NONCE_AGE_OUT_OF_RANGE",
      `${input.nonceMaxAgeSeconds}s is outside ${PROCUREMENT_NONCE_AGE_SECONDS.min}–${PROCUREMENT_NONCE_AGE_SECONDS.max}s`,
    );
  }

  return Object.freeze({
    id: input.id,
    version: input.version,
    allowedSchemes: Object.freeze([...input.allowedSchemes]),
    allowedFacilitators: Object.freeze([...input.allowedFacilitators]),
    allowedAssets: Object.freeze(
      input.allowedAssets.map((entry) =>
        Object.freeze({ network: entry.network, assetRefs: Object.freeze([...entry.assetRefs]) }),
      ),
    ),
    perCallCeilingBaseUnits: input.perCallCeilingBaseUnits,
    dailyCeilingBaseUnits: input.dailyCeilingBaseUnits,
    nonceMaxAgeSeconds: input.nonceMaxAgeSeconds,
    receipt: "REQUIRED",
    refund: input.refund,
    paperOnlyReachesMainnet: false,
    limitations: Object.freeze([...(input.limitations ?? [])]),
  });
}

/* ─── The request ──────────────────────────────────────────────────────────── */

export const PROCUREMENT_REFUSALS = [
  "SCHEME_NOT_ALLOWED_BY_POLICY",
  "UPTO_WITHOUT_CAP",
  "FACILITATOR_NOT_ALLOWED_BY_POLICY",
  "NETWORK_NOT_ALLOWED_BY_POLICY",
  "ASSET_NOT_ALLOWED_ON_NETWORK",
  "ROUTE_DOES_NOT_MATCH_REGISTRATION",
  "PAPER_ONLY_SERVICE_ON_MAINNET",
  "QUOTE_ABOVE_REGISTERED_PRICE",
  "QUOTE_ABOVE_PER_CALL_CEILING",
  "DAY_WOULD_EXCEED_CEILING",
  "AMOUNT_MALFORMED",
  "TIMEOUT_ABOVE_SERVICE_BOUND",
  "TIMEOUT_MALFORMED",
  "REFUND_PATH_REQUIRED",
  "NONCE_MALFORMED",
  "NONCE_STALE",
  "NONCE_ALREADY_USED",
] as const;

export type ProcurementRefusal = (typeof PROCUREMENT_REFUSALS)[number];

/** Every reason one evaluation can end in, from all three stages. */
export type ProcurementDecisionRefusal =
  | ProviderRegistryRefusal
  | ProcurementRefusal
  | MandateRefusal;

export type ProcurementRequest = Readonly<{
  /** The URL the agent was told to pay. From anywhere; trusted nowhere. */
  resourceUrl: string;
  scheme: X402Scheme;
  facilitator: X402Facilitator;
  network: string;
  assetRef: string;
  mint: string;
  payTo: string;
  /** What the seller's quote asks for, in base units. */
  quotedBaseUnits: string;
  /** For `upto`, the declared ceiling. Absent is a refusal for that scheme. */
  capBaseUnits: string | null;
  maxTimeoutSeconds: number;
  nonce: string;
  /** When the seller issued the quote. Freshness is read from this. */
  quoteIssuedAtMs: number;
  spender: string;
  agentBoundBaseUnits: string;
}>;

export type ProcurementDecision =
  | Readonly<{
      allowed: true;
      stage: "AUTHORIZED";
      provider: RegisteredProvider;
      service: RegisteredService;
      mandate: MandateDecision;
      /** Who must act for this to happen. Never "nobody". */
      authorization: MandateDecision["authorization"];
      amountBaseUnits: string;
      policyRef: Readonly<{ id: string; version: number }>;
      limitations: readonly string[];
    }>
  | Readonly<{
      allowed: false;
      stage: "PROVIDER" | "ROUTE" | "PRICE" | "REQUEST" | "MANDATE";
      reasonCode: ProcurementDecisionRefusal;
      detail: string;
    }>;

export const PROCUREMENT_DECISION_LIMITATIONS: readonly string[] = Object.freeze([
  "An allowed decision is permission to proceed, not a payment. Nothing has been signed, held or settled.",
  "The buyer's own wallet signs and the owner's facilitator settles. Ryntra holds no key and no facilitator credential on either side.",
  "A mandate the program enforces bounds the recipient and the end date. Ryntra's own bound is a second, smaller limit and it is not enforced on chain.",
]);

/**
 * Evaluate one purchase.
 *
 * `nonceAlreadyUsed` and `spentTodayBaseUnits` are handed in rather than read,
 * so this function stays pure and the same code decides in a route, in a test
 * and on the surface. The durable claim that makes "already used" true across
 * instances is `./fulfilment.ts`, and it runs after this says yes — a decision
 * that consumed a nonce would burn it on every refusal.
 */
export function evaluateProcurement({
  registry,
  policy,
  request,
  mandateRead,
  nonceAlreadyUsed,
  spentTodayBaseUnits,
  nowMs,
}: {
  registry: ProviderRegistry;
  policy: ProcurementPolicy;
  request: ProcurementRequest;
  /**
   * The mandate as it was read from the chain, or `null` when nothing read it.
   *
   * `null` is a real input rather than a missing one. An endpoint that cannot
   * reach a node has not found a smaller mandate — it has found none, and the
   * fail-closed answer to that is the same as to a revoked one: a person signs.
   */
  mandateRead: ProgramMandateRead | null;
  nonceAlreadyUsed: boolean;
  spentTodayBaseUnits: string;
  nowMs: number;
}): ProcurementDecision {
  const no = (
    stage: Extract<ProcurementDecision, { allowed: false }>["stage"],
    reasonCode: ProcurementDecisionRefusal,
    detail: string,
  ): ProcurementDecision => Object.freeze({ allowed: false as const, stage, reasonCode, detail });

  /* 1. May this URL be paid at all? */
  const resolved = resolveRegisteredResource(registry, request.resourceUrl);
  if (!resolved.ok) return no("PROVIDER", resolved.reasonCode, resolved.detail);
  const { provider, service } = resolved;

  /* 2. Is the route one the owner permits, and does it match the registration?

        The reach comes first inside this stage. A service with no audit behind
        it is not a route that could be fixed by allowing its scheme or its
        chain, and «this service never reaches mainnet» is the useful sentence
        to hand back — the registry refuses to register one there at all, and
        this is the second of the two layers. */
  if (service.reach === "PAPER_AND_DEVNET_ONLY" && request.network !== X402_SOLANA_NETWORKS.devnet) {
    return no(
      "ROUTE",
      "PAPER_ONLY_SERVICE_ON_MAINNET",
      `${service.label} is paper and devnet only — it has no audit, so it never reaches mainnet or a surface for people`,
    );
  }
  if (!policy.allowedSchemes.includes(request.scheme)) {
    return no("ROUTE", "SCHEME_NOT_ALLOWED_BY_POLICY", request.scheme);
  }
  if (request.scheme === "upto" && (request.capBaseUnits === null || !BASE_UNITS.test(request.capBaseUnits))) {
    return no(
      "ROUTE",
      "UPTO_WITHOUT_CAP",
      "`upto` without a declared upper cap is an open authorization, and this hub does not sign one",
    );
  }
  if (!policy.allowedFacilitators.includes(request.facilitator)) {
    return no("ROUTE", "FACILITATOR_NOT_ALLOWED_BY_POLICY", request.facilitator);
  }
  const chainEntry = policy.allowedAssets.find((entry) => entry.network === request.network);
  if (!chainEntry) {
    return no(
      "ROUTE",
      "NETWORK_NOT_ALLOWED_BY_POLICY",
      `policy ${policy.id}@${policy.version} lists no assets for ${request.network}`,
    );
  }
  if (!chainEntry.assetRefs.includes(request.assetRef)) {
    return no(
      "ROUTE",
      "ASSET_NOT_ALLOWED_ON_NETWORK",
      `${request.assetRef} is not on the ${request.network} allowlist of policy ${policy.id}@${policy.version}`,
    );
  }
  if (
    service.scheme !== request.scheme ||
    service.facilitator !== request.facilitator ||
    service.network !== request.network ||
    service.mint !== request.mint ||
    service.assetRef !== request.assetRef
  ) {
    return no(
      "ROUTE",
      "ROUTE_DOES_NOT_MATCH_REGISTRATION",
      `${provider.label} registers ${service.serviceId} as ${service.scheme} in ${service.assetSymbol} on ${service.network} through ${service.facilitator}`,
    );
  }

  /* 3. Is the price the one that was declared? */
  if (!BASE_UNITS.test(request.quotedBaseUnits) || BigInt(request.quotedBaseUnits) === 0n) {
    return no("PRICE", "AMOUNT_MALFORMED", "a quote is whole base units as digits, above zero");
  }
  if (!BASE_UNITS.test(spentTodayBaseUnits)) {
    return no("PRICE", "AMOUNT_MALFORMED", "the day's spend is not whole base units");
  }
  const quoted = BigInt(request.quotedBaseUnits);
  if (quoted > BigInt(service.priceBaseUnits)) {
    return no(
      "PRICE",
      "QUOTE_ABOVE_REGISTERED_PRICE",
      `${provider.label} is registered at ${service.priceBaseUnits} and quoted ${request.quotedBaseUnits}`,
    );
  }
  /* The service's own ceiling is not re-checked here, and that is deliberate:
     it binds the **registration** rather than the request. `buildProviderRegistry`
     refuses an entry whose price is above its ceiling, so a quote at or under
     the registered price is already under the ceiling, and a second comparison
     here would be a check that can never fire pretending to be a bound. */
  if (quoted > BigInt(policy.perCallCeilingBaseUnits)) {
    return no(
      "PRICE",
      "QUOTE_ABOVE_PER_CALL_CEILING",
      `policy ${policy.id}@${policy.version} allows ${policy.perCallCeilingBaseUnits} per call`,
    );
  }
  if (BigInt(spentTodayBaseUnits) + quoted > BigInt(policy.dailyCeilingBaseUnits)) {
    return no(
      "PRICE",
      "DAY_WOULD_EXCEED_CEILING",
      `${spentTodayBaseUnits} is already spent today against a ceiling of ${policy.dailyCeilingBaseUnits}`,
    );
  }

  /* 4. Is the request well formed? */
  if (!Number.isInteger(request.maxTimeoutSeconds) || request.maxTimeoutSeconds <= 0) {
    return no("REQUEST", "TIMEOUT_MALFORMED", String(request.maxTimeoutSeconds));
  }
  if (request.maxTimeoutSeconds > service.maxTimeoutSeconds) {
    return no(
      "REQUEST",
      "TIMEOUT_ABOVE_SERVICE_BOUND",
      `${provider.label} registers ${service.maxTimeoutSeconds}s for ${service.serviceId}`,
    );
  }
  if (policy.refund === "PATH_REQUIRED" && service.refund === "NONE") {
    return no(
      "REQUEST",
      "REFUND_PATH_REQUIRED",
      `${provider.label} declares no refund or reversal path for ${service.serviceId}`,
    );
  }
  if (typeof request.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(request.nonce)) {
    return no("REQUEST", "NONCE_MALFORMED", "a nonce is 16 to 128 URL-safe characters");
  }
  if (!Number.isFinite(request.quoteIssuedAtMs) || request.quoteIssuedAtMs > nowMs) {
    return no("REQUEST", "NONCE_STALE", "the quote claims to have been issued in the future");
  }
  if (nowMs - request.quoteIssuedAtMs > policy.nonceMaxAgeSeconds * 1_000) {
    return no(
      "REQUEST",
      "NONCE_STALE",
      `the quote is older than the ${policy.nonceMaxAgeSeconds}s this policy allows`,
    );
  }
  if (nonceAlreadyUsed) {
    return no(
      "REQUEST",
      "NONCE_ALREADY_USED",
      "this quote has already been answered; one payment is never two purchases",
    );
  }

  /* 5. Who authorizes it? */
  if (mandateRead === null) {
    return no(
      "MANDATE",
      "MANDATE_READ_UNKNOWN",
      "no mandate was read for this agent, so every action is one a person signs",
    );
  }
  const mandate = evaluateProgramMandate({
    read: mandateRead,
    request: {
      network: request.network,
      mint: request.mint,
      payTo: request.payTo,
      amountBaseUnits: request.quotedBaseUnits,
      spender: request.spender,
      agentBoundBaseUnits: request.agentBoundBaseUnits,
    },
    nowMs,
  });
  if (mandate.authorization === "HUMAN_SIGNATURE") {
    return no("MANDATE", mandate.reasonCode, mandate.detail);
  }

  return Object.freeze({
    allowed: true as const,
    stage: "AUTHORIZED" as const,
    provider,
    service,
    mandate,
    authorization: mandate.authorization,
    amountBaseUnits: request.quotedBaseUnits,
    policyRef: Object.freeze({ id: policy.id, version: policy.version }),
    limitations: PROCUREMENT_DECISION_LIMITATIONS,
  });
}
