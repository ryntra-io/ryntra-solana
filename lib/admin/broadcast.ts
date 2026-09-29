/**
 * Broadcast Center — durable campaign + delivery queue.
 *
 * No fake read receipt. Audience is never a wallet, P&L or trade-size filter.
 * Send requires a test-to-owner first. The one-shot textarea remains only when
 * the campaign store is unapplied.
 */

export const BROADCAST_AUDIENCES = ["verified", "all"] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export const CAMPAIGN_STATES = [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "QUEUED",
  "SENDING",
  "COMPLETED",
  "PARTIAL",
  "CANCELLED",
] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const DELIVERY_STATES = ["QUEUED", "SENDING", "SENT", "RETRY", "FAILED", "BLOCKED"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_ERROR_CLASSES = ["blocked", "retry", "failed"] as const;
export type DeliveryErrorClass = (typeof DELIVERY_ERROR_CLASSES)[number];

export function isBroadcastAudience(value: unknown): value is BroadcastAudience {
  return typeof value === "string" && (BROADCAST_AUDIENCES as readonly string[]).includes(value);
}

export function isCampaignState(value: unknown): value is CampaignState {
  return typeof value === "string" && (CAMPAIGN_STATES as readonly string[]).includes(value);
}

export function isDeliveryState(value: unknown): value is DeliveryState {
  return typeof value === "string" && (DELIVERY_STATES as readonly string[]).includes(value);
}

export function sanitizeCampaignBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\0/g, "").trim();
  if (body.length < 2 || body.length > 3500) return null;
  return body;
}

export function sanitizeCampaignName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\0/g, "").trim();
  if (name.length < 2 || name.length > 80) return null;
  return name;
}

export function sanitizeCampaignCta(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > 500) return null;
  if (!/^https:\/\/([a-z0-9-]+\.)*ryntra\.io(\/|$)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function publicBroadcastRef(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `RYN-BC-${hex}`;
}

export function isPublicBroadcastRef(value: unknown): value is string {
  return typeof value === "string" && /^RYN-BC-[0-9A-F]{8}$/.test(value);
}

export function targetStatusForAudience(audience: BroadcastAudience): string | null {
  return audience === "verified" ? "verified_any" : null;
}

export function campaignAfterEdit(state: CampaignState): CampaignState | null {
  if (state === "DRAFT" || state === "READY") return "DRAFT";
  return null;
}

export function campaignAfterTest(state: CampaignState): CampaignState | null {
  if (state === "DRAFT" || state === "READY") return "READY";
  return null;
}

export function campaignMayEnqueue(input: {
  state: CampaignState;
  testSentAt: string | null;
  body: string;
  audience: BroadcastAudience;
}): { ok: true } | { ok: false; reason: string } {
  if (input.state !== "READY") return { ok: false, reason: "not_ready" };
  if (!input.testSentAt) return { ok: false, reason: "test_required" };
  if (!sanitizeCampaignBody(input.body)) return { ok: false, reason: "bad_body" };
  if (!isBroadcastAudience(input.audience)) return { ok: false, reason: "bad_audience" };
  return { ok: true };
}

export function campaignEnqueueState(scheduledAt: string | null, now = Date.now()): "SCHEDULED" | "QUEUED" {
  if (!scheduledAt) return "QUEUED";
  const at = Date.parse(scheduledAt);
  if (!Number.isFinite(at) || at <= now) return "QUEUED";
  return "SCHEDULED";
}

export function campaignMayCancel(state: CampaignState): boolean {
  return state === "DRAFT" || state === "READY" || state === "SCHEDULED" || state === "QUEUED" || state === "SENDING";
}

export function campaignRollupState(input: {
  state: CampaignState;
  queued: number;
  sent: number;
  failed: number;
  blocked: number;
}): CampaignState {
  if (input.state === "CANCELLED") return "CANCELLED";
  const remaining = input.queued;
  const finished = input.sent + input.failed + input.blocked;
  if (remaining <= 0 && finished > 0) {
    return input.failed + input.blocked === 0 ? "COMPLETED" : "PARTIAL";
  }
  if (finished > 0 || input.state === "SENDING" || input.state === "QUEUED") {
    return remaining > 0 ? (finished > 0 ? "SENDING" : "QUEUED") : input.state;
  }
  return input.state;
}

export type BroadcastListRow = {
  id: string;
  public_ref: string;
  name: string;
  audience: BroadcastAudience;
  state: CampaignState;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  blocked_count: number;
  test_sent_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  body?: string;
};

export const FORBIDDEN_BROADCAST_METRICS = ["read", "reads", "прочитано", "open_rate", "ctr"] as const;