/**
 * One action, two read models.
 *
 * Agent Control and an ecosystem workspace answer different questions about
 * the same lifecycle. This module lets both read it without creating a second
 * Action, re-hashing a digest, or treating a chain receipt as delegated agent
 * authority. The caller supplies one canonical identity plus each surface's
 * source claim. Claims may be absent; when present they must agree exactly.
 *
 * The output deliberately shares one frozen identity object by reference.
 * That is an observable contract, not an implementation detail: a caller
 * cannot update the ecosystem copy while leaving Agent Control behind because
 * there is no second copy to update.
 */

const HEX_HASH = /^0x[0-9a-f]{64}$/;

export const ADAPTER_PROJECTION_ERROR_REASONS = [
  "ADAPTER_UNKNOWN",
  "ADAPTER_CHAIN_UNDECLARED",
  "INVALID_PROJECTION_INPUT",
  "ACTION_ID_MISMATCH",
  "ACTION_DIGEST_MISMATCH",
  "POLICY_VERSION_MISMATCH",
  "RECEIPT_REFERENCE_MISMATCH",
  "RECEIPT_BINDING_INCOMPLETE",
  "RECEIPT_ACTION_ID_MISMATCH",
  "RECEIPT_ACTION_DIGEST_MISMATCH",
  "RECEIPT_POLICY_VERSION_MISMATCH",
  "RECEIPT_CHAIN_REF_MISMATCH",
  "CHAIN_REF_MISMATCH",
] as const;

export type AdapterProjectionErrorReason =
  (typeof ADAPTER_PROJECTION_ERROR_REASONS)[number];

export class AdapterProjectionError extends Error {
  readonly reasonCode: AdapterProjectionErrorReason;

  constructor(reasonCode: AdapterProjectionErrorReason, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "AdapterProjectionError";
    this.reasonCode = reasonCode;
  }
}

/** The adapters this product declares. */
export type AdapterProjectionId = "solana" | "stellar";

/**
 * One adapter's declaration. `Id` is any string so that a separate package
 * can declare its own adapter and project through the same function, passing
 * its declaration in (`projectAdapterAction(input, [declaration])`); this
 * product's own list is typed to `AdapterProjectionId`.
 */
export type AdapterProjectionDeclaration<Id extends string = string> = Readonly<{
  id: Id;
  label: string;
  networkLabel: string;
  chainRefs: readonly string[];
  agentControlPath: "/agents/workspace/integrations";
  ecosystemPath: `/${string}`;
}>;

export type ReceiptReference = Readonly<{ id: string; hash: string }>;

export type ReceiptBinding = Readonly<{
  ref: ReceiptReference;
  actionId: string;
  actionDigest: string;
  policyVersion: number;
  chainRef: string;
}>;

export type AdapterIdentitySource = Readonly<{
  actionId: string | null;
  actionDigest: string | null;
  policyVersion: number | null;
  chainRef: string;
  /** Present only when the loaded Receipt binds every identity field. */
  receipt: ReceiptBinding | null;
}>;

export type AdapterSourceClaim = Readonly<{
  actionId: string | null;
  actionDigest: string | null;
  policyVersion: number | null;
  receiptRef: ReceiptReference | null;
  chainRef: string;
}>;

export const PROJECTION_AUTHORIZATION_STATES = [
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "UNAVAILABLE",
  "UNKNOWN",
] as const;

export const PROJECTION_LIFECYCLE_STATES = [
  "CONFIRMED",
  "MATCHED",
  "DEVIATION_RECORDED",
  "FAILED",
  "NOT_OBSERVED",
  "UNAVAILABLE",
  "UNKNOWN",
] as const;

export const PROVIDER_CAPABILITY_STATES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "UNKNOWN",
  "CONFLICTING",
] as const;

export const RYNTRA_MATURITY_STATES = [
  "LIVE",
  "TESTNET",
  "PAPER",
  "PREVIEW",
  "PLANNED",
  "AFTER_GATE",
  "UNKNOWN",
] as const;

export const ROUTE_CAPABILITY_STATES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "UNKNOWN",
  "CONFLICTING",
] as const;

export const USER_ELIGIBILITY_STATES = [
  "ELIGIBLE",
  "INELIGIBLE",
  "UNKNOWN",
  "NOT_EVALUATED",
] as const;

export type ProjectionAuthorizationState =
  (typeof PROJECTION_AUTHORIZATION_STATES)[number];
export type ProjectionLifecycleState =
  (typeof PROJECTION_LIFECYCLE_STATES)[number];
export type ProviderCapabilityState =
  (typeof PROVIDER_CAPABILITY_STATES)[number];
export type RyntraMaturityState = (typeof RYNTRA_MATURITY_STATES)[number];
export type RouteCapabilityState =
  (typeof ROUTE_CAPABILITY_STATES)[number];
export type UserEligibilityState =
  (typeof USER_ELIGIBILITY_STATES)[number];

export type ProjectionFact<T extends string> = Readonly<{
  state: T;
  basis: string;
}>;

export type ProjectionAxes = Readonly<{
  providerCapability: ProjectionFact<ProviderCapabilityState>;
  ryntraMaturity: ProjectionFact<RyntraMaturityState>;
  routeCapability: ProjectionFact<RouteCapabilityState>;
  userEligibility: ProjectionFact<UserEligibilityState>;
}>;

export type ProjectionAuthority =
  | Readonly<{ mode: "PER_ACTION"; ref: null }>
  | Readonly<{ mode: "BOUNDED_MANDATE"; ref: string }>;

export type AdapterProjectionInput<Id extends string = string> = Readonly<{
  adapter: AdapterProjectionDeclaration<Id>;
  identity: AdapterIdentitySource;
  agentControl: Readonly<{
    sourceClaim: AdapterSourceClaim;
    agentRef: string | null;
    authority: ProjectionAuthority | null;
    policyRef: Readonly<{ id: string; version: number }> | null;
    authorization: ProjectionFact<ProjectionAuthorizationState>;
    sourceRefs: readonly string[];
  }>;
  ecosystem: Readonly<{
    sourceClaim: AdapterSourceClaim;
    assetRef: string | null;
    execution: ProjectionFact<ProjectionLifecycleState>;
    settlement: ProjectionFact<ProjectionLifecycleState>;
    reconciliation: ProjectionFact<ProjectionLifecycleState>;
    sourceRefs: readonly string[];
  }>;
  axes: ProjectionAxes;
  limitations: readonly string[];
  nextGate: string;
}>;

export type SharedActionIdentity = Readonly<{
  actionId: string | null;
  actionDigest: string | null;
  policyVersion: number | null;
  chainRef: string;
  receipt: ReceiptReference | null;
}>;

export type AdapterProjection<Id extends string = string> = Readonly<{
  schemaVersion: "1.0.0";
  adapter: AdapterProjectionDeclaration<Id>;
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  identity: SharedActionIdentity;
  agentControl: Readonly<{
    identity: SharedActionIdentity;
    responsibilities: readonly [
      "agent attribution",
      "owner authority or mandate",
      "policy binding",
      "authorization state",
    ];
    agentRef: string | null;
    authority: ProjectionAuthority | null;
    policyRef: Readonly<{ id: string; version: number }> | null;
    authorization: ProjectionFact<ProjectionAuthorizationState>;
    sourceRefs: readonly string[];
  }>;
  ecosystem: Readonly<{
    identity: SharedActionIdentity;
    responsibilities: readonly [
      "chain and asset identity",
      "execution",
      "settlement",
      "reconciliation",
    ];
    chainRef: string;
    assetRef: string | null;
    execution: ProjectionFact<ProjectionLifecycleState>;
    settlement: ProjectionFact<ProjectionLifecycleState>;
    reconciliation: ProjectionFact<ProjectionLifecycleState>;
    sourceRefs: readonly string[];
  }>;
  axes: ProjectionAxes;
  gaps: readonly string[];
  limitations: readonly string[];
  nextGate: string;
}>;

const AGENT_CONTROL_RESPONSIBILITIES = [
  "agent attribution",
  "owner authority or mandate",
  "policy binding",
  "authorization state",
] as const;

const ECOSYSTEM_RESPONSIBILITIES = [
  "chain and asset identity",
  "execution",
  "settlement",
  "reconciliation",
] as const;

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const ADAPTER_PROJECTION_DECLARATIONS: readonly AdapterProjectionDeclaration<AdapterProjectionId>[] =
  freezeDeep([
    {
      id: "solana",
      label: "Solana Token-2022",
      /* "Solana Devnet" until the mainnet-first canon, and it was the only
         adapter whose label named a network no lifecycle had ever used.
         Stellar names a testnet because one ran there; Solana had nothing
         to anchor it, and the adapter declares both refs below. The projection
         names the network the next Solana action would run on, which is the
         only network this product releases to. */
      networkLabel: "Solana Mainnet",
      chainRefs: [
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      ],
      agentControlPath: "/agents/workspace/integrations",
      ecosystemPath: "/solana/workspace/receipts",
    },
    {
      id: "stellar",
      label: "Stellar",
      networkLabel: "Stellar Testnet",
      chainRefs: ["stellar:testnet", "stellar:mainnet"],
      agentControlPath: "/agents/workspace/integrations",
      ecosystemPath: "/stellar/workspace/receipts",
    },
  ] satisfies AdapterProjectionDeclaration<AdapterProjectionId>[]);

function fail(reasonCode: AdapterProjectionErrorReason, detail: string): never {
  throw new AdapterProjectionError(reasonCode, detail);
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("INVALID_PROJECTION_INPUT", `${label} must be a non-empty string`);
  }
}

function assertHash(value: string, label: string): void {
  if (!HEX_HASH.test(value)) {
    fail("INVALID_PROJECTION_INPUT", `${label} must be a lowercase 0x-prefixed SHA-256 digest`);
  }
}

function assertVersion(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    fail("INVALID_PROJECTION_INPUT", `${label} must be a positive integer`);
  }
}

function assertReceiptReference(reference: ReceiptReference, label: string): void {
  assertText(reference.id, `${label}.id`);
  assertHash(reference.hash, `${label}.hash`);
}

function sameReceipt(
  left: ReceiptReference | null,
  right: ReceiptReference | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.hash === right.hash)
  );
}

function validateReceipt(identity: AdapterIdentitySource): void {
  const receipt = identity.receipt;
  if (!receipt) return;

  assertReceiptReference(receipt.ref, "identity.receipt.ref");
  if (
    identity.actionId === null ||
    identity.actionDigest === null ||
    identity.policyVersion === null
  ) {
    fail(
      "RECEIPT_BINDING_INCOMPLETE",
      "a projected Receipt requires actionId, actionDigest and policyVersion",
    );
  }
  if (receipt.actionId !== identity.actionId) {
    fail("RECEIPT_ACTION_ID_MISMATCH", "the Receipt names another actionId");
  }
  if (receipt.actionDigest !== identity.actionDigest) {
    fail(
      "RECEIPT_ACTION_DIGEST_MISMATCH",
      "the Receipt names another action digest",
    );
  }
  if (receipt.policyVersion !== identity.policyVersion) {
    fail(
      "RECEIPT_POLICY_VERSION_MISMATCH",
      "the Receipt names another policy version",
    );
  }
  if (receipt.chainRef !== identity.chainRef) {
    fail("RECEIPT_CHAIN_REF_MISMATCH", "the Receipt names another chain");
  }
}

function validateClaim(
  label: "agentControl" | "ecosystem",
  claim: AdapterSourceClaim,
  identity: SharedActionIdentity,
): void {
  if (claim.chainRef !== identity.chainRef) {
    fail("CHAIN_REF_MISMATCH", `${label} names ${claim.chainRef}, source names ${identity.chainRef}`);
  }
  if (claim.actionId !== null && claim.actionId !== identity.actionId) {
    fail("ACTION_ID_MISMATCH", `${label} names another actionId`);
  }
  if (claim.actionDigest !== null && claim.actionDigest !== identity.actionDigest) {
    fail("ACTION_DIGEST_MISMATCH", `${label} names another action digest`);
  }
  if (claim.policyVersion !== null && claim.policyVersion !== identity.policyVersion) {
    fail("POLICY_VERSION_MISMATCH", `${label} names another policy version`);
  }
  if (claim.receiptRef !== null) {
    assertReceiptReference(claim.receiptRef, `${label}.sourceClaim.receiptRef`);
    if (!sameReceipt(claim.receiptRef, identity.receipt)) {
      fail("RECEIPT_REFERENCE_MISMATCH", `${label} names another Receipt`);
    }
  }
}

function claimIsComplete(claim: AdapterSourceClaim, identity: SharedActionIdentity): boolean {
  return (
    claim.actionId === identity.actionId &&
    claim.actionDigest === identity.actionDigest &&
    claim.policyVersion === identity.policyVersion &&
    claim.chainRef === identity.chainRef &&
    sameReceipt(claim.receiptRef, identity.receipt)
  );
}

function isObserved(state: ProjectionLifecycleState): boolean {
  return !["NOT_OBSERVED", "UNAVAILABLE", "UNKNOWN"].includes(state);
}

function projectionGaps(input: AdapterProjectionInput): string[] {
  const gaps: string[] = [];
  if (input.identity.actionId === null) gaps.push("No shared Agent Control actionId is bound.");
  if (input.identity.actionDigest === null) gaps.push("No shared action digest is bound.");
  if (input.identity.policyVersion === null) gaps.push("No shared policyVersion is bound.");
  if (input.agentControl.agentRef === null) gaps.push("No agent is attributed to this action.");
  if (input.agentControl.authority === null) gaps.push("No owner authority or mandate is bound.");
  if (input.agentControl.policyRef === null) gaps.push("No Agent Control policy reference is bound.");
  if (input.agentControl.authorization.state !== "AUTHORIZED") {
    gaps.push("No Agent Control authorization is bound.");
  }
  return gaps;
}

/**
 * Produce the two read models. The function has no clock, network, storage or
 * hashing dependency; the same input returns the same value.
 *
 * The adapter must be one of `declarations` — this product's own list unless a
 * caller that declares its own adapter passes it.
 */
export function projectAdapterAction<Id extends string = AdapterProjectionId>(
  input: AdapterProjectionInput<Id>,
  declarations: readonly AdapterProjectionDeclaration<string>[] = ADAPTER_PROJECTION_DECLARATIONS,
): AdapterProjection<Id> {
  const adapter = declarations.find(
    (candidate) => candidate.id === input.adapter.id,
  ) as AdapterProjectionDeclaration<Id> | undefined;
  if (!adapter) fail("ADAPTER_UNKNOWN", `adapter ${String(input.adapter.id)} is not declared`);

  assertText(input.identity.chainRef, "identity.chainRef");
  if (!adapter.chainRefs.includes(input.identity.chainRef)) {
    fail(
      "ADAPTER_CHAIN_UNDECLARED",
      `${adapter.id} does not declare ${input.identity.chainRef}`,
    );
  }
  if (input.identity.actionId !== null) assertText(input.identity.actionId, "identity.actionId");
  if (input.identity.actionDigest !== null) {
    assertHash(input.identity.actionDigest, "identity.actionDigest");
  }
  if (input.identity.policyVersion !== null) {
    assertVersion(input.identity.policyVersion, "identity.policyVersion");
  }
  validateReceipt(input.identity);

  const identity: SharedActionIdentity = freezeDeep({
    actionId: input.identity.actionId,
    actionDigest: input.identity.actionDigest,
    policyVersion: input.identity.policyVersion,
    chainRef: input.identity.chainRef,
    receipt: input.identity.receipt
      ? { id: input.identity.receipt.ref.id, hash: input.identity.receipt.ref.hash }
      : null,
  });

  validateClaim("agentControl", input.agentControl.sourceClaim, identity);
  validateClaim("ecosystem", input.ecosystem.sourceClaim, identity);

  if (input.agentControl.policyRef !== null) {
    assertText(input.agentControl.policyRef.id, "agentControl.policyRef.id");
    assertVersion(input.agentControl.policyRef.version, "agentControl.policyRef.version");
    if (input.agentControl.policyRef.version !== identity.policyVersion) {
      fail("POLICY_VERSION_MISMATCH", "Agent Control policyRef does not match the shared identity");
    }
  }
  if (
    input.agentControl.authority?.mode === "BOUNDED_MANDATE" &&
    input.agentControl.authority.ref.trim().length === 0
  ) {
    fail("INVALID_PROJECTION_INPUT", "a bounded mandate requires a non-empty reference");
  }
  assertText(input.agentControl.authorization.basis, "agentControl.authorization.basis");
  assertText(input.ecosystem.execution.basis, "ecosystem.execution.basis");
  assertText(input.ecosystem.settlement.basis, "ecosystem.settlement.basis");
  assertText(input.ecosystem.reconciliation.basis, "ecosystem.reconciliation.basis");
  assertText(input.axes.providerCapability.basis, "axes.providerCapability.basis");
  assertText(input.axes.ryntraMaturity.basis, "axes.ryntraMaturity.basis");
  assertText(input.axes.routeCapability.basis, "axes.routeCapability.basis");
  assertText(input.axes.userEligibility.basis, "axes.userEligibility.basis");
  assertText(input.nextGate, "nextGate");
  if (input.limitations.length === 0) {
    fail("INVALID_PROJECTION_INPUT", "at least one limitation is required");
  }

  const completeIdentity =
    identity.actionId !== null &&
    identity.actionDigest !== null &&
    identity.policyVersion !== null;
  const completeControl =
    input.agentControl.agentRef !== null &&
    input.agentControl.authority !== null &&
    input.agentControl.policyRef !== null &&
    input.agentControl.authorization.state === "AUTHORIZED";
  const completeClaims =
    claimIsComplete(input.agentControl.sourceClaim, identity) &&
    claimIsComplete(input.ecosystem.sourceClaim, identity);
  const anyLifecycleFact =
    identity.actionId !== null ||
    identity.actionDigest !== null ||
    identity.policyVersion !== null ||
    input.agentControl.agentRef !== null ||
    input.agentControl.authority !== null ||
    input.agentControl.policyRef !== null ||
    input.agentControl.authorization.state === "AUTHORIZED" ||
    isObserved(input.ecosystem.execution.state) ||
    isObserved(input.ecosystem.settlement.state) ||
    isObserved(input.ecosystem.reconciliation.state);
  const status =
    completeIdentity && completeControl && completeClaims
      ? "COMPLETE"
      : anyLifecycleFact
        ? "PARTIAL"
        : "UNAVAILABLE";

  const projection: AdapterProjection<Id> = {
    schemaVersion: "1.0.0",
    adapter,
    status,
    identity,
    agentControl: {
      identity,
      responsibilities: AGENT_CONTROL_RESPONSIBILITIES,
      agentRef: input.agentControl.agentRef,
      authority: input.agentControl.authority
        ? { ...input.agentControl.authority }
        : null,
      policyRef: input.agentControl.policyRef
        ? { ...input.agentControl.policyRef }
        : null,
      authorization: { ...input.agentControl.authorization },
      sourceRefs: [...input.agentControl.sourceRefs],
    },
    ecosystem: {
      identity,
      responsibilities: ECOSYSTEM_RESPONSIBILITIES,
      chainRef: identity.chainRef,
      assetRef: input.ecosystem.assetRef,
      execution: { ...input.ecosystem.execution },
      settlement: { ...input.ecosystem.settlement },
      reconciliation: { ...input.ecosystem.reconciliation },
      sourceRefs: [...input.ecosystem.sourceRefs],
    },
    axes: {
      providerCapability: { ...input.axes.providerCapability },
      ryntraMaturity: { ...input.axes.ryntraMaturity },
      routeCapability: { ...input.axes.routeCapability },
      userEligibility: { ...input.axes.userEligibility },
    },
    gaps: projectionGaps(input),
    limitations: [...input.limitations],
    nextGate: input.nextGate,
  };

  return freezeDeep(projection);
}
