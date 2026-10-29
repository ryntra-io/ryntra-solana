/**
 * Ryntra as the seller: one paid service, and the facts that stay free.
 *
 * The order the owner's review set is deliberate — Ryntra sells before it buys,
 * because a hub whose first act is to spend has learned nothing about what a
 * paid call costs. So there is exactly one sellable service here, the deep
 * token report of AGH-1, and everything the review calls *material risk truth*
 * is free and stays free.
 *
 * ## The free list is enforced, not promised
 *
 * `FREE_RISK_FACTS` is the list of things a person or an agent can learn about
 * a token without paying: who can mint it, who can freeze it, which Token-2022
 * extensions it carries, whether its metadata can be rewritten, how
 * concentrated its holders and its liquidity are, and who the issuer is for a
 * real-world asset. The paid deliverable declares what it adds, and a test
 * fails if any free fact appears in it: monetising the knowledge that a token
 * can be frozen is the one thing this product's rules name as never allowed,
 * and a comment above a price list does not stop it.
 *
 * ## Why there is no price in this file
 *
 * D22 of the owner's review: the price of a deep check, in credits or in x402,
 * is set after the cost of thirty to fifty real jobs has been measured. So the
 * price is configuration the owner sets and this module refuses to quote
 * without — `PRICE_NOT_SET_BY_OWNER` — rather than a number invented here and
 * quietly inherited by the first buyer.
 *
 * ## Why nothing can be bought today
 *
 * Two things are missing and both are named by the code rather than by a
 * document: the deliverable itself is AGH-1 and is not built, and the seller's
 * network, recipient, price and facilitator are the owner's to set after this
 * merges. `sellerReadiness` returns both as a list, the route answers with it,
 * and a quote is never issued for something that cannot be served — taking a
 * payment for an answer that does not exist is the `PAID_BUT_UNSERVED` case,
 * not an edge case.
 */

import { USDC, usdcMint, type AllowanceNetwork } from "../../solana/allowances/model.ts";
import {
  X402_SOLANA_NETWORKS,
  facilitatorDeclaration,
  splAssetRef,
  type X402Facilitator,
  type X402Scheme,
} from "./protocol.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE_UNITS = /^(?:0|[1-9]\d*)$/;

/* ─── What stays free ──────────────────────────────────────────────────────── */

export type RiskFact = Readonly<{
  id: string;
  label: string;
  /** Where the product already reads it, so the free answer is not new work. */
  readBy: string;
}>;

/**
 * The material risk facts. Free, rate-limited like everything else, and never
 * behind a payment on any surface.
 *
 * Each names where the product already reads it, because that is what makes
 * "free" cheap enough to keep: these are not a free tier built to be upsold,
 * they are the facts the token page and the pulse already show.
 */
export const FREE_RISK_FACTS: readonly RiskFact[] = Object.freeze([
  Object.freeze({ id: "mint-authority", label: "Whether anyone can still mint more", readBy: "the token page" }),
  Object.freeze({ id: "freeze-authority", label: "Whether anyone can freeze a holder's account", readBy: "the token page" }),
  Object.freeze({ id: "token-2022-extensions", label: "Which Token-2022 extensions the mint carries", readBy: "the token passport" }),
  Object.freeze({ id: "metadata-mutability", label: "Whether the name, symbol or image can be rewritten", readBy: "the token page" }),
  Object.freeze({ id: "holder-concentration", label: "How concentrated the holders are, pools and escrow aside", readBy: "market health" }),
  Object.freeze({ id: "liquidity-concentration", label: "How much liquidity there is and how concentrated", readBy: "market health" }),
  Object.freeze({ id: "rwa-issuer", label: "Who the issuer is, for a real-world asset", readBy: "the asset passport" }),
]);

export const FREE_RISK_FACT_IDS: readonly string[] = Object.freeze(FREE_RISK_FACTS.map((fact) => fact.id));

/**
 * What this product's monetisation rules refuse, stated so it can be asserted.
 *
 * The review's list, kept verbatim in substance: never hide a critical risk
 * fact behind a price, never sell a "safe" badge, never let a higher fee buy a
 * better ranking, never let a paid plan break a policy.
 */
export const NEVER_MONETISED: readonly string[] = Object.freeze([
  "Hiding a material risk fact behind a payment.",
  "A «safe» badge, a single score, or any verdict a buyer can pay to receive.",
  "A place in a ranking that a larger fee buys.",
  "Permission to exceed a policy because a plan was paid for.",
]);

/* ─── The one paid service ─────────────────────────────────────────────────── */

export const SELLABLE_SERVICE_IDS = ["token-deep-report"] as const;

export type SellableServiceId = (typeof SELLABLE_SERVICE_IDS)[number];

export type SellableService = Readonly<{
  serviceId: SellableServiceId;
  label: string;
  /** The path this is served at, under Ryntra's own origin. */
  path: string;
  scheme: X402Scheme;
  mimeType: string;
  /** How long a quote stands, and how long the sale may take. */
  validForSeconds: number;
  maxTimeoutSeconds: number;
  /** What the buyer gets on top of the free facts. */
  adds: readonly string[];
  /** What it explicitly does not include. Stated, never inferred. */
  excludes: readonly string[];
  /** The task that builds the deliverable, while there is none. */
  deliverableTaskRef: string | null;
  limitations: readonly string[];
}>;

export const TOKEN_DEEP_REPORT: SellableService = Object.freeze({
  serviceId: "token-deep-report",
  label: "Deep token report",
  path: "/api/agents/services/token-report",
  /* `exact` and only `exact`. `upto` is a range, and a seller offering a range
     is a seller asking for an open authorization. */
  scheme: "exact",
  mimeType: "application/json",
  validForSeconds: 60,
  maxTimeoutSeconds: 30,
  adds: Object.freeze([
    "One report over the facts the free answer already gives, with each source and the date it was read.",
    "The deeper compute: holder graph beyond the pools, escrow and vesting unwound, and every claim marked known or unknown.",
    "A digest a buyer can re-check, and a receipt that keeps the payment and the delivery apart.",
  ]),
  excludes: Object.freeze([
    "Any verdict. There is no «safe», no «scam» and no single score, whatever is paid.",
    "Anything a person needs in order to avoid a loss. Those facts are free and stay free.",
    "A promise of freshness beyond the dates the report prints.",
  ]),
  deliverableTaskRef: "AGH-1",
  limitations: Object.freeze([
    "The deliverable is AGH-1 and it is not built, so nothing is sellable today and no quote is issued.",
    "The price is the owner's after a real cost measurement (D22); this service carries none of its own.",
    "A paid report never withholds a risk fact the free answer gives.",
  ]),
});

export const SELLABLE_SERVICES: readonly SellableService[] = Object.freeze([TOKEN_DEEP_REPORT]);

/* ─── The owner's configuration ────────────────────────────────────────────── */

/**
 * What the owner sets, after this merges, on their own machine.
 *
 * Four values and not one, because each is a different decision: which network
 * the hub sells on, which address is paid, what the price is, and which
 * facilitator settles. The facilitator's **credential** is not among them — it
 * belongs to the client this repository does not hold, and nothing here reads,
 * stores or asks for a key.
 */
export const SELLER_ENV = Object.freeze({
  network: "RYNTRA_X402_NETWORK",
  payTo: "RYNTRA_X402_PAY_TO",
  priceBaseUnits: "RYNTRA_X402_PRICE_USDC_BASE_UNITS",
  facilitator: "RYNTRA_X402_FACILITATOR",
});

export type SellerConfig = Readonly<{
  network: string;
  networkName: AllowanceNetwork;
  mint: string;
  assetRef: string;
  assetSymbol: string;
  decimals: number;
  payTo: string;
  priceBaseUnits: string;
  facilitator: X402Facilitator;
}>;

export const SELLER_READINESS_BLOCKERS = [
  "NETWORK_NOT_SET_BY_OWNER",
  "PAY_TO_NOT_SET_BY_OWNER",
  "PAY_TO_MALFORMED",
  "PRICE_NOT_SET_BY_OWNER",
  "PRICE_MALFORMED",
  "FACILITATOR_NOT_SET_BY_OWNER",
  "FACILITATOR_UNKNOWN",
  "FACILITATOR_DOES_NOT_DECLARE_NETWORK",
  "FACILITATOR_DOES_NOT_DECLARE_SCHEME",
  "DELIVERABLE_NOT_BUILT",
] as const;

export type SellerReadinessBlocker = (typeof SELLER_READINESS_BLOCKERS)[number];

export type SellerReadiness =
  | Readonly<{ sellable: true; config: SellerConfig; service: SellableService }>
  | Readonly<{
      sellable: false;
      config: SellerConfig | null;
      service: SellableService;
      blockers: readonly Readonly<{ code: SellerReadinessBlocker; detail: string }>[];
    }>;

/** `devnet` or `mainnet`, by the same words the spending limits read. */
function networkFrom(value: string | undefined): AllowanceNetwork | null {
  const named = value?.trim().toLowerCase();
  if (named === "devnet") return "devnet";
  if (named === "mainnet" || named === "mainnet-beta") return "mainnet";
  return null;
}

/**
 * Whether one service can be sold right now, and everything stopping it.
 *
 * It returns **every** blocker rather than the first. An Owner setting four
 * variables and a task building a deliverable should see the whole list once,
 * not discover the next one on each deploy.
 */
export function sellerReadiness(
  service: SellableService,
  env: Readonly<Record<string, string | undefined>>,
): SellerReadiness {
  const blockers: Array<Readonly<{ code: SellerReadinessBlocker; detail: string }>> = [];
  const note = (code: SellerReadinessBlocker, detail: string) =>
    blockers.push(Object.freeze({ code, detail }));

  const networkName = networkFrom(env[SELLER_ENV.network]);
  if (!networkName) {
    note("NETWORK_NOT_SET_BY_OWNER", `${SELLER_ENV.network} names no network, so nothing is sold`);
  }

  const payTo = env[SELLER_ENV.payTo]?.trim() ?? "";
  if (payTo.length === 0) note("PAY_TO_NOT_SET_BY_OWNER", `${SELLER_ENV.payTo} is empty`);
  else if (!BASE58.test(payTo)) note("PAY_TO_MALFORMED", `${payTo} is not a Solana address`);

  const price = env[SELLER_ENV.priceBaseUnits]?.trim() ?? "";
  if (price.length === 0) {
    note(
      "PRICE_NOT_SET_BY_OWNER",
      `${SELLER_ENV.priceBaseUnits} is empty; D22 sets the price after a real cost measurement`,
    );
  } else if (!BASE_UNITS.test(price) || BigInt(price) === 0n) {
    note("PRICE_MALFORMED", "a price is whole base units of USDC as digits, above zero");
  }

  const facilitatorId = env[SELLER_ENV.facilitator]?.trim() ?? "";
  const facilitator = facilitatorId.length > 0 ? facilitatorDeclaration(facilitatorId) : null;
  if (facilitatorId.length === 0) {
    note("FACILITATOR_NOT_SET_BY_OWNER", `${SELLER_ENV.facilitator} is empty`);
  } else if (!facilitator) {
    note("FACILITATOR_UNKNOWN", `${facilitatorId} is not one of the two declared facilitators`);
  }

  const network = networkName ? X402_SOLANA_NETWORKS[networkName] : null;
  if (facilitator && network && !facilitator.networks.includes(network)) {
    note(
      "FACILITATOR_DOES_NOT_DECLARE_NETWORK",
      `${facilitator.label} declares no ${network}`,
    );
  }
  if (facilitator && !facilitator.schemes.includes(service.scheme)) {
    note(
      "FACILITATOR_DOES_NOT_DECLARE_SCHEME",
      `${facilitator.label} publishes no ${service.scheme}`,
    );
  }

  /* The deliverable, last in the list and first in importance. */
  if (service.deliverableTaskRef !== null) {
    note(
      "DELIVERABLE_NOT_BUILT",
      `${service.label} is built by ${service.deliverableTaskRef}; a quote for an answer that does not exist is a payment nobody can serve`,
    );
  }

  const config: SellerConfig | null =
    networkName && network && facilitator && BASE58.test(payTo) && BASE_UNITS.test(price) && BigInt(price) > 0n
      ? Object.freeze({
          network,
          networkName,
          mint: usdcMint(networkName),
          assetRef: splAssetRef(network, usdcMint(networkName)),
          assetSymbol: USDC.symbol,
          decimals: USDC.decimals,
          payTo,
          priceBaseUnits: price,
          facilitator: facilitator.id,
        })
      : null;

  if (blockers.length === 0 && config) {
    return Object.freeze({ sellable: true as const, config, service });
  }
  return Object.freeze({
    sellable: false as const,
    config,
    service,
    blockers: Object.freeze(blockers),
  });
}

/** Every service, with whether it can be sold. The catalogue route reads this. */
export function sellerCatalogue(
  env: Readonly<Record<string, string | undefined>>,
): readonly SellerReadiness[] {
  return Object.freeze(SELLABLE_SERVICES.map((service) => sellerReadiness(service, env)));
}
