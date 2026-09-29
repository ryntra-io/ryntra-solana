/**
 * Feedback inbox — one thread for site, app and bot.
 *
 * The message body is operational support data, never an analytics event.
 * Replies go through the Beta Bot when a Telegram id is on the thread.
 */

export const FEEDBACK_SOURCES = ["site", "app", "bot"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_CATEGORIES = ["bug", "idea", "security", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ["OPEN", "WAITING", "CLOSED"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_PRIORITIES = ["NORMAL", "SECURITY"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

const SENSITIVE_QUERY = /^(token|secret|key|password|seed|wallet|session|code|auth|sig|signature|mnemonic)$/i;

export function isFeedbackSource(value: unknown): value is FeedbackSource {
  return typeof value === "string" && (FEEDBACK_SOURCES as readonly string[]).includes(value);
}

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function feedbackPriority(category: FeedbackCategory): FeedbackPriority {
  return category === "security" ? "SECURITY" : "NORMAL";
}

export function sanitizeFeedbackBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\0/g, "").trim();
  if (body.length < 10 || body.length > 4000) return null;
  return body;
}

export function sanitizeAdminReply(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\0/g, "").trim();
  if (body.length < 2 || body.length > 4000) return null;
  return body;
}

export function sanitizeFeedbackRoute(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > 500) return null;
  const looksLikeRoute = trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed);
  if (!looksLikeRoute) return trimmed.replace(/\?[^#]*/, "").slice(0, 500);
  try {
    const url = new URL(trimmed, "https://ryntra.io");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.delete(key);
    }
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.slice(0, 500);
  } catch {
    return trimmed.replace(/\?[^#]*/, "").slice(0, 500);
  }
}

export function publicFeedbackRef(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `RYN-FB-${hex}`;
}

export function isPublicFeedbackRef(value: unknown): value is string {
  return typeof value === "string" && /^RYN-FB-[0-9A-F]{8}$/.test(value);
}

export type FeedbackListRow = {
  id: string;
  public_ref: string;
  source: string;
  category: string;
  status: string;
  priority: string;
  telegram_id: number | null;
  locale: string | null;
  created_at: string;
  updated_at: string;
  preview: string;
};
