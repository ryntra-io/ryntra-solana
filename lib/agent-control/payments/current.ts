/**
 * What the commerce surface can honestly show today.
 *
 * Everything below is derived by running the real engine over the real
 * declarations. Nothing is hand-written: if the engine changes its mind about a
 * route, this projection changes with it, which is the only way a page can
 * state a verdict without becoming a second source of truth.
 *
 * The projection is computed on the server because the engine reaches the
 * hash-pinned registry, which hashes with `node:crypto`. That is a deliberate
 * boundary rather than an inconvenience: the browser gets the answers, not the
 * ability to produce new ones.
 */

import {
  PAYMENT_FACILITATORS,
  PAYMENT_IMPLEMENTATIONS,
  PAYMENT_METHODS,
  PAYMENT_PROTOCOL,
  PROVIDER_IMPLEMENTATIONS,
  type PaymentFacilitator,
  type PaymentImplementationDeclaration,
  type PaymentMethod,
  type ProviderImplementation,
} from "./implementations.ts";
import {
  X402RouteError,
  buildRoutePreview,
  resolvePaymentRoute,
  type CommercePaymentPolicy,
} from "./x402-engine.ts";
import {
  PAYMENT_STATUSES,
  SERVICE_DELIVERY_STATUSES,
  buildCommerceOutcome,
  settlementPairing,
  type PaymentStatus,
  type PaymentTrustClass,
  type ServiceDeliveryStatus,
  type SettlementPairingCode,
} from "./vocabulary.ts";
import { buildCommerceReceipt, type CommerceReceipt } from "./receipt.ts";
import { ERC_8004_PIN, ERC_8183_PIN, buildJobObservation, buildReputationEvidence } from "./draft-standards.ts";
import { BINANCE_B402_FACILITATOR, BINANCE_MCP_AGENTIC_ACCOUNT } from "../../binance/capability.ts";

const BSC = "eip155:56";
const USDT = `${BSC}/erc20:0x55d398326f99059fF775485246999027B3197955`;
const U = `${BSC}/erc20:0xcE24439F2D9C6a2289F741120FE202248B666666`;
const USD1 = `${BSC}/erc20:0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d`;
const USDC = `${BSC}/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`;

/** Names a person recognises, never used as an identifier. The id is CAIP-2. */
const NETWORK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "eip155:56": "BNB Smart Chain",
  "eip155:97": "BNB Smart Chain Testnet",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:43114": "Avalanche",
  "eip155:43113": "Avalanche Fuji",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "Solana Devnet",
});

export function networkLabel(chainRef: string): string {
  return NETWORK_LABELS[chainRef] ?? chainRef;
}

/**
 * The sample owner policy this surface reasons against.
 *
 * It permits every axis value and lists three of the four BNB Smart Chain
 * assets, deliberately leaving USDC off. A policy that allowed everything would
 * make the per-chain allowlist invisible, and the whole point of putting the
 * asset list in the policy is that an owner can decline an asset a provider
 * offers.
 */
export const SAMPLE_COMMERCE_POLICY: CommercePaymentPolicy = Object.freeze({
  id: "sample-commerce-policy",
  version: 1,
  allowedImplementations: Object.freeze([...PROVIDER_IMPLEMENTATIONS]),
  allowedMethods: Object.freeze([...PAYMENT_METHODS]),
  allowedFacilitators: Object.freeze([...PAYMENT_FACILITATORS]),
  assetPolicy: Object.freeze([Object.freeze({ network: BSC, assetRefs: Object.freeze([U, USD1, USDT]) })]),
});

export type RouteVerdict = Readonly<{
  method: PaymentMethod;
  facilitator: PaymentFacilitator;
  allowed: boolean;
  /** The refusal code, or `null` when the route resolves. */
  reasonCode: string | null;
  detail: string;
  /** Whether the refusal came from the provider's declaration or the owner's policy. */
  refusedBy: "PROVIDER" | "POLICY" | null;
}>;

export type RouteSlice = Readonly<{
  implementation: ProviderImplementation;
  network: string;
  networkLabel: string;
  assetRef: string | null;
  assetSymbol: string | null;
  cells: readonly RouteVerdict[];
  allowedCount: number;
}>;

const POLICY_REFUSALS = new Set([
  "IMPLEMENTATION_NOT_ALLOWED_BY_POLICY",
  "PAYMENT_METHOD_NOT_ALLOWED_BY_POLICY",
  "FACILITATOR_NOT_ALLOWED_BY_POLICY",
  "NETWORK_NOT_ALLOWED_BY_POLICY",
  "ASSET_NOT_ALLOWED_ON_NETWORK",
]);

function verdictFor(
  implementation: ProviderImplementation,
  network: string,
  assetRef: string,
  method: PaymentMethod,
  facilitator: PaymentFacilitator,
  policy: CommercePaymentPolicy,
): RouteVerdict {
  try {
    resolvePaymentRoute({
      protocol: PAYMENT_PROTOCOL,
      implementation,
      method,
      facilitator,
      network,
      assetRef,
      policy,
    });
    return Object.freeze({ method, facilitator, allowed: true, reasonCode: null, detail: "", refusedBy: null });
  } catch (error) {
    if (!(error instanceof X402RouteError)) throw error;
    return Object.freeze({
      method,
      facilitator,
      allowed: false,
      reasonCode: error.reasonCode,
      detail: error.message.slice(error.reasonCode.length + 2),
      refusedBy: POLICY_REFUSALS.has(error.reasonCode) ? ("POLICY" as const) : ("PROVIDER" as const),
    });
  }
}

/**
 * Every method × facilitator cell for one implementation, network and asset.
 *
 * Sixteen cells is small enough to read at a glance and large enough that the
 * shape of a provider's real capability shows up as a pattern rather than as a
 * paragraph.
 */
export function routeSlice({
  implementation,
  network,
  assetRef,
  policy = SAMPLE_COMMERCE_POLICY,
}: {
  implementation: ProviderImplementation;
  network: string;
  assetRef: string | null;
  policy?: CommercePaymentPolicy;
}): RouteSlice {
  const declaration = PAYMENT_IMPLEMENTATIONS.find((entry) => entry.id === implementation);
  const asset = declaration?.assets.find(
    (candidate) => candidate.assetRef === assetRef && candidate.network === network,
  );
  /* When the source publishes no asset for this network there is still a
     question worth answering, so the probe uses a reference that cannot exist
     and the grid fills with the refusal that is the actual finding. */
  const probe = assetRef ?? `${network}/erc20:0x0000000000000000000000000000000000000000`;
  const cells: RouteVerdict[] = [];
  for (const method of PAYMENT_METHODS) {
    for (const facilitator of PAYMENT_FACILITATORS) {
      cells.push(verdictFor(implementation, network, probe, method, facilitator, policy));
    }
  }
  return Object.freeze({
    implementation,
    network,
    networkLabel: networkLabel(network),
    assetRef,
    assetSymbol: asset?.symbol ?? null,
    cells: Object.freeze(cells),
    allowedCount: cells.filter((cell) => cell.allowed).length,
  });
}

export type ImplementationProjection = Readonly<{
  declaration: PaymentImplementationDeclaration;
  slices: readonly RouteSlice[];
  /** How many of this implementation's own cells resolve, across every slice. */
  allowedCount: number;
  totalCount: number;
}>;

function projectImplementation(
  declaration: PaymentImplementationDeclaration,
  policy: CommercePaymentPolicy,
): ImplementationProjection {
  const slices: RouteSlice[] = [];
  for (const network of declaration.networks) {
    const assets = declaration.assets.filter((asset) => asset.network === network);
    if (assets.length === 0) {
      slices.push(routeSlice({ implementation: declaration.id, network, assetRef: null, policy }));
      continue;
    }
    for (const asset of assets) {
      slices.push(routeSlice({ implementation: declaration.id, network, assetRef: asset.assetRef, policy }));
    }
  }
  const allowedCount = slices.reduce((sum, slice) => sum + slice.allowedCount, 0);
  const totalCount = slices.reduce((sum, slice) => sum + slice.cells.length, 0);
  return Object.freeze({ declaration, slices: Object.freeze(slices), allowedCount, totalCount });
}

export type PairingCell = Readonly<{
  paymentStatus: PaymentStatus;
  serviceDeliveryStatus: ServiceDeliveryStatus;
  code: SettlementPairingCode | null;
  consistency: "CONSISTENT" | "INCONSISTENT" | "UNDETERMINED";
}>;

/** Every pair, so that the two cells which name a problem are visibly two. */
export function pairingMatrix(): readonly PairingCell[] {
  const cells: PairingCell[] = [];
  for (const paymentStatus of PAYMENT_STATUSES) {
    for (const serviceDeliveryStatus of SERVICE_DELIVERY_STATUSES) {
      const pairing = settlementPairing({ paymentStatus, serviceDeliveryStatus });
      cells.push(Object.freeze({ paymentStatus, serviceDeliveryStatus, ...pairing }));
    }
  }
  return Object.freeze(cells);
}

/** The frozen instant these sample artifacts carry, so the page is deterministic. */
const SAMPLE_INSTANT = new Date("2026-08-24T00:00:00.000Z");

const SAMPLE_OUTCOME = buildCommerceOutcome({
  paymentStatus: "SETTLED",
  paymentSource: "FACILITATOR_REPORT",
  serviceDeliveryStatus: "UNKNOWN",
  serviceDeliverySource: null,
  verificationStatus: "PROVIDER_REPORTED",
  verificationSource: "FACILITATOR_REPORT",
  disputeStatus: "NONE",
  reconciliationStatus: "PENDING",
});

function sampleReceipt(
  implementation: ProviderImplementation,
  method: PaymentMethod,
  facilitator: PaymentFacilitator,
): CommerceReceipt {
  return buildCommerceReceipt({
    route: resolvePaymentRoute({
      protocol: PAYMENT_PROTOCOL,
      implementation,
      method,
      facilitator,
      network: BSC,
      assetRef: USDT,
      policy: SAMPLE_COMMERCE_POLICY,
    }),
    amount: "0.25",
    outcome: SAMPLE_OUTCOME,
    now: SAMPLE_INSTANT,
  });
}

export type CommerceSurface = Readonly<{
  protocol: typeof PAYMENT_PROTOCOL;
  policy: CommercePaymentPolicy;
  implementations: readonly ImplementationProjection[];
  /** The one asset a provider offers that this owner's policy declines. */
  declinedByPolicy: Readonly<{ assetRef: string; symbol: string; network: string }>;
  pairing: readonly PairingCell[];
  /** Two receipts for the same payment on two systems that share a name. */
  collision: Readonly<{ binance: CommerceReceipt; vistara: CommerceReceipt }>;
  preview: ReturnType<typeof buildRoutePreview>;
  job: ReturnType<typeof buildJobObservation>;
  reputation: ReturnType<typeof buildReputationEvidence>;
  custody: readonly (typeof BINANCE_B402_FACILITATOR)[];
  standards: readonly (typeof ERC_8004_PIN)[];
  /** Every route the whole engine resolves today, and every route it does not. */
  totals: Readonly<{ allowed: number; total: number }>;
  trustLadder: readonly PaymentTrustClass[];
}>;

export function buildCommerceSurface(policy: CommercePaymentPolicy = SAMPLE_COMMERCE_POLICY): CommerceSurface {
  const implementations = PAYMENT_IMPLEMENTATIONS.map((declaration) =>
    projectImplementation(declaration, policy),
  );
  return Object.freeze({
    protocol: PAYMENT_PROTOCOL,
    policy,
    implementations: Object.freeze(implementations),
    declinedByPolicy: Object.freeze({ assetRef: USDC, symbol: "USDC", network: BSC }),
    pairing: pairingMatrix(),
    collision: Object.freeze({
      binance: sampleReceipt("BINANCE_B402", "PERMIT2_EXACT", "BINANCE"),
      vistara: sampleReceipt("VISTARA_B402", "VISTARA_RELAYER_EIP712", "VISTARA"),
    }),
    preview: buildRoutePreview({
      route: resolvePaymentRoute({
        protocol: PAYMENT_PROTOCOL,
        implementation: "BINANCE_B402",
        method: "PERMIT2_EXACT",
        facilitator: "BINANCE",
        network: BSC,
        assetRef: USDT,
        policy: SAMPLE_COMMERCE_POLICY,
      }),
      amount: "0.25",
      now: SAMPLE_INSTANT,
    }),
    job: buildJobObservation({
      pin: ERC_8183_PIN,
      jobRef: "job_sample_1",
      network: BSC,
      state: "TERMINAL",
      terminalKind: "COMPLETED",
      sourceLabel: "ERC-8183 escrow read, revision-pinned — sample",
      observedAt: SAMPLE_INSTANT.toISOString(),
    }),
    reputation: buildReputationEvidence({
      pin: ERC_8004_PIN,
      subjectRef: "agent_sample_1",
      registry: "REPUTATION",
      state: "DECLARED",
      sourceLabel: "ERC-8004 Reputation registry, revision-pinned — sample",
      observedAt: SAMPLE_INSTANT.toISOString(),
    }),
    custody: Object.freeze([BINANCE_B402_FACILITATOR, BINANCE_MCP_AGENTIC_ACCOUNT]),
    standards: Object.freeze([ERC_8004_PIN, ERC_8183_PIN]),
    totals: Object.freeze({
      allowed: implementations.reduce((sum, entry) => sum + entry.allowedCount, 0),
      total: implementations.reduce((sum, entry) => sum + entry.totalCount, 0),
    }),
    trustLadder: Object.freeze([
      "UNVERIFIED_ASSERTION",
      "FACILITATOR_ASSERTION",
      "CHAIN_OBSERVED",
      "INDEPENDENTLY_RECONCILED",
    ] as const),
  });
}

/**
 * What stops any of this from being real, in the surface's own words.
 *
 * Not "coming soon". The exact missing thing, per axis, so a reader can tell
 * which of them is a decision and which is an engineering task.
 */
export const COMMERCE_BLOCKERS: readonly Readonly<{ title: string; detail: string }>[] = Object.freeze([
  Object.freeze({
    title: "No payment credential exists",
    detail:
      "Ryntra holds no facilitator clientId, no RSA signing key, no allowlisted source IP and no wallet on any of these four routes. Nothing here can attempt a payment, and none of those is requested by this packet.",
  }),
  Object.freeze({
    title: "No route has been observed",
    detail:
      "Every provider fact behind these verdicts is read from published documentation on the date the declaration records. No facilitator was called, no chain was read and no payment was made, so every sample receipt rests on a facilitator report that does not exist yet.",
  }),
  Object.freeze({
    title: "Both ERCs are Draft",
    detail:
      "ERC-8004 and ERC-8183 are mirrored behind a pinned content digest, not integrated. There is no contract address, no ABI and no chain client, and a job state read from an escrow is evidence rather than a reconciliation.",
  }),
  Object.freeze({
    title: "Enforcement is not a kernel field on this path",
    detail:
      "Canon 08 §6.2 holds: while enforcement lives outside the policy decision, nothing here can be promoted above PREVIEW. Completing this surface changed none of that.",
  }),
]);
