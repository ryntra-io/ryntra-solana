/**
 * Classify a Telegram sendMessage failure without storing the provider
 * description (it can name a person). Used by Broadcast Center deliveries.
 */

export type PlainDelivery =
  | { kind: "sent" }
  | { kind: "blocked" }
  | { kind: "retry"; retryAfterSec: number }
  | { kind: "failed" };

export function classifyTelegramSend(input: {
  ok: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
}): PlainDelivery {
  if (input.ok) return { kind: "sent" };
  if (input.error_code === 403) return { kind: "blocked" };
  const retry = input.parameters?.retry_after;
  if (input.error_code === 429 && typeof retry === "number" && retry > 0) {
    return { kind: "retry", retryAfterSec: Math.min(Math.floor(retry), 3600) };
  }
  return { kind: "failed" };
}

export function deliveryStateFrom(kind: PlainDelivery["kind"]): "SENT" | "RETRY" | "FAILED" | "BLOCKED" {
  if (kind === "sent") return "SENT";
  if (kind === "blocked") return "BLOCKED";
  if (kind === "retry") return "RETRY";
  return "FAILED";
}

export function errorClassFrom(kind: PlainDelivery["kind"]): "blocked" | "retry" | "failed" | null {
  if (kind === "sent") return null;
  if (kind === "blocked") return "blocked";
  if (kind === "retry") return "retry";
  return "failed";
}
