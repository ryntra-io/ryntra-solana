/**
 * Fixtures for the hub's tests.
 *
 * Every number, address and URL below is invented for a test and is marked as
 * such: the hosts are under `.test`, which can never resolve, and the addresses
 * are real base-58 strings that belong to nobody this product knows. Nothing
 * here is a provider Ryntra has admitted, a price the owner has set or a
 * facilitator anyone can reach — the live registry comes from `./hub.ts` and is
 * empty until the owner sets four values.
 *
 * They live in one module rather than in each test file because the cases the
 * registry row names — a wrong network, a wrong mint, a swapped recipient, an
 * overridden amount, an expiry, a repeated signature, a timeout after
 * settlement, concurrent requests, paid-but-undelivered — are all the *same*
 * sale with one fact changed, and a battery that re-declares the sale nine
 * times proves nine different things by accident.
 */

import { X402_SOLANA_NETWORKS, splAssetRef, type X402PaymentRequirements } from "./protocol.ts";
import {
  buildProviderRegistry,
  type ProviderRegistry,
  type RegisteredProvider,
} from "./provider-registry.ts";
import { buildProcurementPolicy, type ProcurementPolicy } from "./policy.ts";
import type { ProgramMandateRead } from "./mandate.ts";
import type { FacilitatorClient, Deliverable } from "./sale.ts";
import type { SettlementReport } from "./fulfilment.ts";
import { SELLER_ENV } from "./seller.ts";

export const DEVNET = X402_SOLANA_NETWORKS.devnet;
export const MAINNET = X402_SOLANA_NETWORKS.mainnet;

/** Circle's USDC, the two mints the spending limits already name. */
export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Invented addresses. Base-58 of the right shape and nobody's keys. */
export const FIXTURE = Object.freeze({
  payTo: "CwiqtA5LdGPRydNX48GkCjyrJw6udZpfgQoUCnQDCHs6",
  otherPayTo: "GmFNVt4tXsYXn5RQZJLWNix8ksd8XE69JGzZcd5X1rng",
  agent: "Aq3TSFzkYFfFHscuWyX4dnNxi77aEM4iYdSqBhCnoZho",
  otherAgent: "992JvLi54wBBdKMhEwKv4PWZLdhmiQuuo1KkxdkGYCXz",
  buyer: "9WbkRbdrn1VnzAqTd8K2c6d6hkXX7fJSK4j8tBoncSnz",
  otherMint: "DqUfWUmyxzF8pstpzm6biNfKG55VBnF1HUFxeQBzns2C",
});

/* ─── A registry with somebody else in it ──────────────────────────────────── */

export const FIXTURE_ORIGIN = "https://data.example.test";

/** One external provider, with a live service and a paper-only one beside it. */
export function fixtureProvider(): RegisteredProvider {
  return Object.freeze({
    providerId: "oracle-labs",
    label: "Oracle Labs (fixture)",
    operator: "nobody — this host cannot resolve",
    origin: FIXTURE_ORIGIN,
    identityProof: "AGENT_CARD",
    identityReference: `${FIXTURE_ORIGIN}/.well-known/agent.json`,
    services: Object.freeze([
      Object.freeze({
        serviceId: "token-facts",
        label: "Token facts (fixture)",
        resource: `${FIXTURE_ORIGIN}/v1/token-facts`,
        scheme: "exact" as const,
        facilitator: "COINBASE_CDP" as const,
        network: MAINNET,
        mint: USDC_MAINNET,
        assetRef: splAssetRef(MAINNET, USDC_MAINNET),
        assetSymbol: "USDC",
        decimals: 6,
        priceBaseUnits: "200000",
        priceCeilingBaseUnits: "400000",
        maxTimeoutSeconds: 30,
        refund: "PROVIDER_REVIEW" as const,
        reach: "LIVE" as const,
        deliverable: "One JSON document of token facts, with each source and the date it was read.",
        limitations: Object.freeze(["A fixture. The host is under `.test` and cannot resolve."]),
      }),
      Object.freeze({
        serviceId: "pull-experiment",
        label: "Pull experiment (fixture, unaudited)",
        resource: `${FIXTURE_ORIGIN}/v1/pull-experiment`,
        scheme: "exact" as const,
        facilitator: "COINBASE_CDP" as const,
        network: DEVNET,
        mint: USDC_DEVNET,
        assetRef: splAssetRef(DEVNET, USDC_DEVNET),
        assetSymbol: "USDC",
        decimals: 6,
        priceBaseUnits: "10000",
        priceCeilingBaseUnits: "10000",
        maxTimeoutSeconds: 20,
        refund: "NONE" as const,
        reach: "PAPER_AND_DEVNET_ONLY" as const,
        deliverable: "Nothing a person sees. A paper and devnet experiment, under its own task.",
        limitations: Object.freeze([
          "No audit stands behind the program this exercises, so it never reaches mainnet or a surface a person uses.",
        ]),
      }),
    ]),
    source: Object.freeze({ url: `${FIXTURE_ORIGIN}/docs`, observedAt: "2026-10-26" }),
    limitations: Object.freeze(["A fixture provider. Admitted by no Owner and reachable by nobody."]),
  });
}

export function fixtureRegistry(
  providers: readonly RegisteredProvider[] = [fixtureProvider()],
): ProviderRegistry {
  return buildProviderRegistry({ id: "fixture-providers", version: 1, providers });
}

export function fixturePolicy(overrides: Partial<Parameters<typeof buildProcurementPolicy>[0]> = {}): ProcurementPolicy {
  return buildProcurementPolicy({
    id: "fixture-procurement",
    version: 1,
    allowedSchemes: ["exact"],
    allowedFacilitators: ["COINBASE_CDP"],
    allowedAssets: [
      { network: MAINNET, assetRefs: [splAssetRef(MAINNET, USDC_MAINNET)] },
      { network: DEVNET, assetRefs: [splAssetRef(DEVNET, USDC_DEVNET)] },
    ],
    perCallCeilingBaseUnits: "1000000",
    dailyCeilingBaseUnits: "10000000",
    nonceMaxAgeSeconds: 60,
    refund: "PATH_REQUIRED",
    ...overrides,
  });
}

/* ─── Mandate reads, one per program state ─────────────────────────────────── */

const HOUR = 60 * 60 * 1_000;

export function smartAccountLimit(
  overrides: Partial<Extract<ProgramMandateRead, { kind: "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT" }>> = {},
  nowMs = Date.now(),
): ProgramMandateRead {
  return Object.freeze({
    kind: "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT" as const,
    state: "ACTIVE" as const,
    account: "9Ekagmp8xek75PQmvwPYwHAUvk2syt1atVnBWvCqp9Ko",
    network: MAINNET,
    mint: USDC_MAINNET,
    spender: FIXTURE.agent,
    destinations: Object.freeze([FIXTURE.payTo]),
    availableBaseUnits: "1000000",
    expiresAtMs: nowMs + 24 * HOUR,
    ...overrides,
  });
}

export function merchantPlan(
  overrides: Partial<Extract<ProgramMandateRead, { kind: "SUBSCRIPTIONS_MERCHANT_PLAN" }>> = {},
  nowMs = Date.now(),
): ProgramMandateRead {
  return Object.freeze({
    kind: "SUBSCRIPTIONS_MERCHANT_PLAN" as const,
    state: "ACTIVE" as const,
    account: "Dsdr3TyqpGGFt9jWAm6t1CHgA6sX86MvccBTLd98vwnZ",
    network: MAINNET,
    mint: USDC_MAINNET,
    spender: FIXTURE.agent,
    destinations: Object.freeze([FIXTURE.payTo]),
    availableBaseUnits: "1000000",
    expiresAtMs: nowMs + 30 * 24 * HOUR,
    ...overrides,
  });
}

export function v4SpendingLimit(nowMs = Date.now()): ProgramMandateRead {
  void nowMs;
  return Object.freeze({
    kind: "SQUADS_V4_SPENDING_LIMIT" as const,
    state: "ACTIVE" as const,
    account: "FtvsqSaokzzy76W9UQpX3uPX8rtz1mrqxhJ5NrpurtvX",
    network: MAINNET,
    mint: USDC_MAINNET,
    spender: FIXTURE.agent,
    destinations: Object.freeze([FIXTURE.payTo]),
    availableBaseUnits: "1000000",
  });
}

export function subscriptionsDelegation(
  kind: "SUBSCRIPTIONS_FIXED_DELEGATION" | "SUBSCRIPTIONS_RECURRING_DELEGATION",
  nowMs = Date.now(),
): ProgramMandateRead {
  return Object.freeze({
    kind,
    state: "ACTIVE" as const,
    account: "3hcu2kuj7xn3GiKJxee1ohS9munGEv5McnXDcPgaHmK5",
    network: MAINNET,
    mint: USDC_MAINNET,
    spender: FIXTURE.agent,
    availableBaseUnits: "1000000",
    expiresAtMs: nowMs + 24 * HOUR,
  });
}

export function pullDelegation(): ProgramMandateRead {
  return Object.freeze({
    kind: "BLUESHIFT_PULL_DELEGATION" as const,
    state: "ACTIVE" as const,
    account: "E25opQFVHM5shbnTaB8QJ4UYZokazoaPKHDwb65R3itQ",
    network: DEVNET,
    mint: USDC_DEVNET,
    spender: FIXTURE.agent,
    availableBaseUnits: "1000000",
  });
}

/* ─── The seller's own configuration, as the owner would set it ─────────────── */

export function fixtureSellerEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    [SELLER_ENV.network]: "devnet",
    [SELLER_ENV.payTo]: FIXTURE.payTo,
    [SELLER_ENV.priceBaseUnits]: "50000",
    [SELLER_ENV.facilitator]: "COINBASE_CDP",
    ...overrides,
  });
}

/* ─── Stubs for the two ports ──────────────────────────────────────────────── */

export type FacilitatorStub = FacilitatorClient & Readonly<{ calls: { settle: number; supported: number } }>;

/**
 * A facilitator that answers however a test needs, and counts its calls.
 *
 * The count is the point in the replay cases: "no second charge" is a claim
 * about how many times `/settle` was called, and a test that only checks the
 * response body cannot see a second one.
 */
export function stubFacilitator({
  report,
  supported,
  settleDelayMs = 0,
  throwOnSettle = false,
}: {
  report?: SettlementReport;
  supported?: readonly Readonly<{ network: string; scheme: "exact" | "upto" }>[];
  settleDelayMs?: number;
  throwOnSettle?: boolean;
} = {}): FacilitatorStub {
  const calls = { settle: 0, supported: 0 };
  const answer: SettlementReport =
    report ??
    Object.freeze({
      status: "SETTLED" as const,
      transaction: "5FixtureSignature11111111111111111111111111111111111111111111111111111111111111111111",
      source: "FACILITATOR_REPORT" as const,
      detail: "a fixture facilitator reported this settled",
    });

  return Object.freeze({
    id: "COINBASE_CDP" as const,
    calls,
    async supported() {
      calls.supported += 1;
      return (
        supported ?? [
          { network: DEVNET, scheme: "exact" as const },
          { network: MAINNET, scheme: "exact" as const },
        ]
      );
    },
    async settle() {
      calls.settle += 1;
      if (throwOnSettle) throw new Error("the fixture facilitator could not be reached");
      if (settleDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
      }
      return answer;
    },
  });
}

export type DeliverableStub = Deliverable & Readonly<{ calls: { build: number } }>;

export function stubDeliverable({
  body = { report: "a fixture deep report" },
  failing = false,
}: { body?: unknown; failing?: boolean } = {}): DeliverableStub {
  const calls = { build: 0 };
  return Object.freeze({
    serviceId: "token-deep-report",
    calls,
    async build(_input: { requirements: X402PaymentRequirements; query: URLSearchParams }) {
      void _input;
      calls.build += 1;
      return failing ? null : body;
    },
  });
}

/* ─── The buyer's side of the wire ─────────────────────────────────────────── */

/**
 * Build a `PAYMENT-SIGNATURE` header the way a buyer's client would, with one
 * fact overridable.
 *
 * This is the only place in the hub that writes an authorization, and it is a
 * fixture on purpose: in production the payload comes from the buyer's own
 * wallet through `@x402/fetch` and `@x402/svm`, and Ryntra never produces one.
 */
export function authorizationHeader(
  requirements: X402PaymentRequirements,
  overrides: Readonly<Record<string, unknown>> = {},
  topOverrides: Readonly<Record<string, unknown>> = {},
): string {
  const payload = {
    asset: requirements.asset,
    amount: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    payer: FIXTURE.buyer,
    resource: requirements.resource,
    resourceDigest: requirements.resourceDigest,
    nonce: requirements.nonce,
    validUntil: requirements.expiresAt,
    signature: "Zml4dHVyZS1zaWduYXR1cmUtMDAwMDAwMDAwMDAwMDAwMA",
    ...overrides,
  };
  const document = {
    x402Version: requirements.x402Version,
    scheme: requirements.scheme,
    network: requirements.network,
    payload,
    ...topOverrides,
  };
  return Buffer.from(JSON.stringify(document), "utf8").toString("base64");
}

export function headersWith(authorization: string | null, extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra);
  if (authorization !== null) headers.set("PAYMENT-SIGNATURE", authorization);
  return headers;
}
