/**
 * Admin insights — three truth sources that must never be merged.
 *
 * First-party: anonymous site clicks (`events`) and authenticated product
 * actions (`product_events`) — two different units under one owner.
 * GA4: public acquisition, only when server credentials exist.
 * Search Console: organic visibility, only when server credentials exist.
 *
 * Unconfigured Google is not a measured zero. No wallet, P&L or trade size.
 */

import type { ActivityRead } from "./activity.ts";
import { stripForbiddenAdminProperties } from "./privacy.ts";

export const TRUTH_SOURCES = ["first_party", "ga4", "search_console"] as const;
export type TruthSource = (typeof TRUTH_SOURCES)[number];

export type SourceStatus = "measured" | "unknown" | "unconfigured";

export type FirstPartyEvent = {
  name: string;
  count: number | undefined;
};

export type FirstPartyTruth = {
  source: "first_party";
  status: SourceStatus;
  /** Anonymous site clicks, last 14 days. */
  events: FirstPartyEvent[];
  /** Authenticated product actions, last 30 days, by name. */
  product: {
    status: "measured" | "not_collected" | "unavailable";
    events: FirstPartyEvent[];
    logins30d: number | undefined;
    loginsByKind30d: Record<string, number>;
    anonymousOk30d: number | undefined;
    since: string | null;
  };
};

export type GoogleTruth = {
  source: "ga4" | "search_console";
  status: "unconfigured" | "measured" | "unknown";
  reason: "no_server_credentials" | "provider_unread" | null;
};

export type InsightsModel = {
  firstParty: FirstPartyTruth;
  ga4: GoogleTruth;
  searchConsole: GoogleTruth;
};

/** Events `/api/track` accepts: site clicks and Seeker Connect's count (SKR-1). All anonymous; none is a person. */
export const FIRST_PARTY_EVENT_CATALOG = [
  "telegram_cta_click",
  "workspace_cta_click",
  "arcus_link_click",
  "seeker_connect_ok",
  "seeker_connect_cancelled",
  "seeker_connect_failed",
] as const;

export function googleConfigured(env: {
  GA4_PROPERTY_ID?: string;
  GSC_SITE_URL?: string;
}): { ga4: boolean; searchConsole: boolean } {
  return {
    ga4: Boolean(env.GA4_PROPERTY_ID?.trim()),
    searchConsole: Boolean(env.GSC_SITE_URL?.trim()),
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function projectInsights(input: {
  cta14d?: Record<string, unknown> | number;
  activity?: ActivityRead;
  env?: { GA4_PROPERTY_ID?: string; GSC_SITE_URL?: string };
}): InsightsModel {
  const configured = googleConfigured(input.env ?? {});
  /* The old caller passed one number for the bot CTA; the new one passes the
     whole 14-day map. Both stay readable. */
  const ctaMap: Record<string, unknown> =
    typeof input.cta14d === "number"
      ? { telegram_cta_click: input.cta14d }
      : input.cta14d && typeof input.cta14d === "object"
        ? input.cta14d
        : {};
  const ctaKnown = input.cta14d !== undefined;
  const activity = input.activity ?? { status: "not_collected" as const };
  return {
    firstParty: {
      source: "first_party",
      status: ctaKnown ? "measured" : "unknown",
      events: FIRST_PARTY_EVENT_CATALOG.map((name) => ({
        name,
        count: ctaKnown ? (finite(ctaMap[name]) ?? 0) : undefined,
      })),
      product: {
        status: activity.status,
        events:
          activity.status === "measured"
            ? Object.entries(activity.summary.events.byName30d)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            : [],
        logins30d: activity.status === "measured" ? activity.summary.logins.count30d : undefined,
        loginsByKind30d: activity.status === "measured" ? activity.summary.logins.byKind30d : {},
        anonymousOk30d: activity.status === "measured" ? activity.summary.events.anonymousOk30d : undefined,
        since: activity.status === "measured" ? activity.summary.coverage.eventsSince : null,
      },
    },
    ga4: {
      source: "ga4",
      status: configured.ga4 ? "unknown" : "unconfigured",
      reason: configured.ga4 ? "provider_unread" : "no_server_credentials",
    },
    searchConsole: {
      source: "search_console",
      status: configured.searchConsole ? "unknown" : "unconfigured",
      reason: configured.searchConsole ? "provider_unread" : "no_server_credentials",
    },
  };
}

/** There is no combined visitor number. This exists so a test can prove it. */
export function combinedAudience(_model: InsightsModel): null {
  return null;
}

export function sanitizeInsightPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return stripForbiddenAdminProperties(payload);
}

export type SeoInventory = {
  sitemapUrlCount: number;
  lastmodDates: string[];
  treatsPriorityAsRank: false;
  adminIndexed: false;
  robotsDisallowAdmin: boolean;
};

export function projectSeoInventory(input: {
  urls: { lastModified?: Date | string }[];
  robotsDisallow: string[];
}): SeoInventory {
  const lastmodDates = [
    ...new Set(
      input.urls
        .map((row) => {
          if (!row.lastModified) return null;
          const value = row.lastModified instanceof Date ? row.lastModified.toISOString() : String(row.lastModified);
          return value.slice(0, 10);
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  return {
    sitemapUrlCount: input.urls.length,
    lastmodDates,
    treatsPriorityAsRank: false,
    adminIndexed: false,
    robotsDisallowAdmin: input.robotsDisallow.some((rule) => rule === "/admin" || rule.startsWith("/admin")),
  };
}
