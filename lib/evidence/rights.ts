/**
 * The rights map — what each provider family may be used for, written from
 * the provider's own documents and enforced before anything reaches a
 * client, a store or a log.
 *
 * Access to an endpoint is not the right to republish its fields. The map
 * records, per family: whether the redistribution guide allows it (and on
 * what condition), which fields the mapper may read into the snapshot, how
 * long a copy may be held, how long a figure a Review judged may stay with
 * that review, the attribution the terms accept, and where and when the rule
 * was read. A family that is not `allowed` here is not called by the
 * product — not hidden by CSS, not called and dropped, not called.
 *
 * The figures the map allows are aggregates: a volume, a net flow, a count.
 * No family here yields an address, a label or a row to anything outside the
 * mapper, and the mapper reads named fields only, so a new field the
 * provider adds tomorrow is not displayed by accident.
 *
 * The source of each rule is named so the next reader checks the document,
 * not this file. Pure and client-safe: the map is data.
 */

import type { EvidenceProvider, EvidenceWindow } from "./metrics.ts";
import type { EvidenceAttribution } from "./snapshot.ts";

export type RightsStatus =
  /** Allowed with attribution — the guide's ✅ row. */
  | "allowed-with-attribution"
  /** Approval and significant modification required — not called by the product. */
  | "restricted"
  /** Never redistributed — never called by the product. */
  | "prohibited"
  /** Documented, but the account's plan answers 403 — not called until the plan or a grant opens it. */
  | "plan-gated"
  /** Documented for other networks only, or answers by a confirmed hash and not before a signature — not called on Solana. */
  | "unsupported";

export type FamilyRights = Readonly<{
  /** The provider's family name as the guide lists it (without the `/api/v1/` prefix). */
  family: string;
  /** The live path, which may differ from the guide's name. */
  path: string;
  status: RightsStatus;
  /** The fields the mapper may read; everything else in the answer is dropped unread. */
  fields: readonly string[];
  /** Seconds a copy may sit in Ryntra's cache, per window the family serves — never beyond the provider's own documented cache for the family. */
  cacheSeconds: Readonly<Partial<Record<EvidenceWindow, number>>>;
  /** The provider's documented response cache, seconds, per window the family serves, so a card can say how far behind a fresh answer may be. */
  providerLagSeconds: Readonly<Partial<Record<EvidenceWindow, number>>>;
  /** The provider's credit price per call, as its published credit costs or its own cost header state it on the review date. */
  creditsPerCall: number;
  note: string;
}>;

export type ProviderRights = Readonly<{
  provider: EvidenceProvider;
  /** Names the rule set a snapshot was filtered under. */
  policy: string;
  attribution: EvidenceAttribution;
  /** Seconds a figure a Review judged stays readable with that review; after it the value is redacted and Ryntra's verdict stays. */
  retainJudgedValueSeconds: number;
  /** Seconds a snapshot past its expiry may still be served, marked stale, when the provider does not answer; then it is dropped. */
  staleHoldSeconds: number;
  families: readonly FamilyRights[];
  reviewed: Readonly<{ guide: string; guideDate: string; terms: string; termsDate: string; pricing: string; readOn: string }>;
}>;

const DAY = 24 * 3600;

export const NANSEN_RIGHTS: ProviderRights = {
  provider: "nansen",
  policy: "nansen-guide-2025-11-18",
  /* The terms accept "Powered by Nansen" or "Data provided by Nansen"; the
     guide's own wording for the allowed-with-attribution rows is "Powered by
     Nansen API" with a visible link. Both are satisfied by this one line. */
  attribution: { text: "Powered by Nansen API", href: "https://nansen.ai" },
  retainJudgedValueSeconds: 7 * DAY,
  staleHoldSeconds: 30 * 60,
  families: [
    {
      family: "tgm/token-screener",
      path: "/api/v1/token-screener",
      status: "allowed-with-attribution",
      fields: ["token_address", "token_symbol", "volume", "buy_volume", "sell_volume", "netflow"],
      /* A live, point-in-time screener with no provider cache; Ryntra's own
         window coalesces reads of one token so five people opening the same
         asset within five minutes cost one call. */
      cacheSeconds: { "24h": 300, "7d": 900 },
      providerLagSeconds: { "24h": 0, "7d": 0 },
      creditsPerCall: 1,
      note: "Per-token aggregates of DEX activity over a rolling window; the figures cover the whole market as the source counts it.",
    },
    {
      family: "tgm/flow-intelligence",
      path: "/api/v1/tgm/flow-intelligence",
      status: "allowed-with-attribution",
      fields: ["exchange_net_flow_usd", "whale_net_flow_usd", "whale_wallet_count", "warnings"],
      /* The provider caches these answers 10–30 minutes by timeframe; a copy
         held longer than that would be a copy beyond the documented timeframe. */
      cacheSeconds: { "24h": 600, "7d": 1800 },
      providerLagSeconds: { "24h": 600, "7d": 1800 },
      creditsPerCall: 1,
      note: "Net movement and address counts for the source's labelled groups; movement, not trade; exchanges and large holders only — the other groups are not read.",
    },
    {
      family: "tgm/who-bought-sold",
      path: "/api/v1/tgm/who-bought-sold",
      status: "allowed-with-attribution",
      fields: [],
      cacheSeconds: { "24h": 300, "7d": 300 },
      providerLagSeconds: { "24h": 300, "7d": 300 },
      creditsPerCall: 1,
      note: "Allowed by the guide, not read in this slice: its rows are per address and a page is a sample; the whole-market buys and sells come from the screener instead.",
    },
    {
      family: "smart-money/inflows",
      path: "/api/v1/smart-money/netflow",
      status: "restricted",
      fields: [],
      cacheSeconds: { "24h": 0, "7d": 0 },
      providerLagSeconds: { "24h": 0, "7d": 0 },
      creditsPerCall: 5,
      note: "Approval and significant modification required by the guide; the product does not call it.",
    },
    {
      family: "address/labels",
      path: "/api/v1/profiler/address/labels",
      status: "prohibited",
      fields: [],
      cacheSeconds: { "24h": 0, "7d": 0 },
      providerLagSeconds: { "24h": 0, "7d": 0 },
      creditsPerCall: 100,
      note: "Prohibited from redistribution; never called.",
    },
  ],
  reviewed: {
    guide: "https://docs.nansen.ai/guides/redistribution-guide",
    guideDate: "2025-11-18",
    terms: "https://nansen.ai/legal/api",
    termsDate: "2026-06-01",
    pricing: "https://docs.nansen.ai/getting-started/credits",
    readOn: "2026-09-16",
  },
};

/**
 * DD.xyz / Webacy — the security and due-diligence provider. Its
 * documentation, read in full on 2026-09-16,
 * publishes no redistribution guide, no attribution rule and no display
 * rule — only "keep your API key secret" and the line *Powered by DD.xyz*;
 * the account's grant text says the frontend integration may be white-labelled.
 * The map is therefore conservative until the provider answers the open
 * rights question: the product shows derived aggregates with
 * attribution and nothing that names an address — the sniper and bundler
 * address lists, the developer address, the labels, the tag descriptions and
 * every `details.*` block never leave the adapter. The prices are the
 * provider's own `x-webacy-cu` header as observed at the stage-A smoke.
 */
export const DDXYZ_RIGHTS: ProviderRights = {
  provider: "ddxyz",
  policy: "ddxyz-conservative-2026-09-16",
  attribution: { text: "Data provided by DD.xyz", href: "https://dd.xyz" },
  retainJudgedValueSeconds: 7 * DAY,
  staleHoldSeconds: 30 * 60,
  families: [
    {
      family: "trading-lite",
      path: "/trading-lite/{mint}",
      status: "allowed-with-attribution",
      fields: ["Top10Holders", "TotalHolders", "mintable", "freezable", "buy_sell_taxes", "SniperPercentageHolding", "BundlerPercentageHolding", "DevHoldingPercentage", "analysisTimestamp"],
      /* The provider caches its analysis five minutes and charges the same
         4 CU for a cached answer, so Ryntra's own copy is held ten: a token's
         structure does not move in minutes, and five people opening the same
         asset cost one call. */
      cacheSeconds: { now: 600 },
      providerLagSeconds: { now: 300 },
      creditsPerCall: 4,
      note: "The token's structure on Solana: the top-ten share, the holder count, the mint and freeze authority, the transfer tax, and the source's sniper, bundler and developer shares (cohort figures, advisory). Address lists never leave the adapter.",
    },
    {
      family: "addresses",
      path: "/addresses/{address}",
      status: "allowed-with-attribution",
      fields: ["count", "medium", "high", "overallRisk", "isContract", "addressType", "analyzed_at", "expiresAt"],
      /* The provider's own copy is valid up to 24 hours (`expiresAt`); a
         sanction or a finding can appear at any time, so Ryntra's copy is an
         hour. */
      cacheSeconds: { now: 3600 },
      providerLagSeconds: { now: 24 * 3600 },
      creditsPerCall: 3,
      note: "A plain wallet's findings, as counts by severity and the source's own 0–100 figure with its band; the tags, labels and descriptions stay server-side. Program-owned accounts are unsupported at the source and read UNKNOWN.",
    },
    {
      family: "sanctions",
      path: "/addresses/sanctioned/{address}",
      status: "allowed-with-attribution",
      fields: ["is_sanctioned", "sanctions_status", "is_sanctions_related", "sanctions_related_status"],
      cacheSeconds: { now: 3600 },
      providerLagSeconds: { now: 0 },
      creditsPerCall: 1,
      note: "Exact-match screening against the lists the source keeps; the status words are shown exactly as the source states them (clean · unknown · sanctioned).",
    },
    {
      family: "holder-analysis",
      path: "/holder-analysis/{mint}",
      status: "plan-gated",
      fields: [],
      cacheSeconds: {},
      providerLagSeconds: {},
      creditsPerCall: 0,
      note: "403 on the account's plan (2026-09-14 and 2026-09-16); nothing is claimed from it.",
    },
    {
      family: "token-detail",
      path: "/tokens/{mint}",
      status: "plan-gated",
      fields: [],
      cacheSeconds: {},
      providerLagSeconds: {},
      creditsPerCall: 0,
      note: "403 on the account's plan; the token view of the address engine answers instead but took 22 s cold and is left for a later slice.",
    },
    {
      family: "token-pools",
      path: "/tokens/{mint}/pools",
      status: "plan-gated",
      fields: [],
      cacheSeconds: {},
      providerLagSeconds: {},
      creditsPerCall: 0,
      note: "403 on the account's plan; liquidity comes from the venue's own quote, never from here.",
    },
    {
      family: "transaction-scan",
      path: "/scan/{from}/transactions",
      status: "unsupported",
      fields: [],
      cacheSeconds: {},
      providerLagSeconds: {},
      creditsPerCall: 0,
      note: "Pre-sign scanning is documented for EVM chains only; the Solana transaction endpoint analyses a confirmed hash. No pre-sign scanning on Solana is built.",
    },
  ],
  reviewed: {
    guide: "https://docs.webacy.com/",
    guideDate: "2026-09-16",
    terms: "https://developers.webacy.co/",
    termsDate: "2026-09-16",
    pricing: "https://docs.webacy.com/pricing",
    readOn: "2026-09-16",
  },
};

export const PROVIDER_RIGHTS: Readonly<Record<EvidenceProvider, ProviderRights>> = { nansen: NANSEN_RIGHTS, ddxyz: DDXYZ_RIGHTS };

export function providerRights(provider: EvidenceProvider): ProviderRights {
  return PROVIDER_RIGHTS[provider];
}

export function familyRights(provider: ProviderRights, family: string): FamilyRights | null {
  return provider.families.find((entry) => entry.family === family) ?? null;
}

/** The families the product may call: allowed by the guide and with at least one field the mapper reads. */
export function callableFamilies(provider: ProviderRights): readonly FamilyRights[] {
  return provider.families.filter((entry) => entry.status === "allowed-with-attribution" && entry.fields.length > 0);
}

/**
 * Keep only the fields a family's rights name. Applied to the provider's
 * row before anything else reads it, so the raw answer is gone by the time
 * a mapper, a log or a serializer could see it.
 */
export function filterFields<T extends Record<string, unknown>>(rights: FamilyRights, row: T): Partial<T> {
  const kept: Partial<T> = {};
  for (const field of rights.fields) {
    if (field in row) kept[field as keyof T] = row[field as keyof T];
  }
  return kept;
}
