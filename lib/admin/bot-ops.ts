/**
 * Bot Operations projection. Never carry the bot token onto a surface.
 */

const TOKEN_SHAPE = /\d{8,}:[A-Za-z0-9_-]{20,}/g;

export type WebhookHealth = {
  username: string | null;
  webhookHost: string | null;
  webhookConfigured: boolean;
  pendingUpdates: number | undefined;
  lastErrorAt: string | null;
  lastErrorClass: string | null;
};

export function redactBotSecret(value: string): string {
  return value.replace(TOKEN_SHAPE, "[redacted]");
}

export function projectWebhookHealth(input: {
  username?: string | null;
  webhookUrl?: string | null;
  pendingUpdateCount?: number;
  lastErrorDate?: number;
  lastErrorMessage?: string | null;
}): WebhookHealth {
  let host: string | null = null;
  if (input.webhookUrl) {
    try {
      host = new URL(input.webhookUrl).host;
    } catch {
      host = "invalid-url";
    }
  }
  const message = input.lastErrorMessage ? redactBotSecret(input.lastErrorMessage) : null;
  return {
    username: input.username ?? null,
    webhookHost: host,
    webhookConfigured: Boolean(host),
    pendingUpdates: typeof input.pendingUpdateCount === "number" ? input.pendingUpdateCount : undefined,
    lastErrorAt: typeof input.lastErrorDate === "number" ? new Date(input.lastErrorDate * 1000).toISOString() : null,
    lastErrorClass: message ? "webhook_error" : null,
  };
}
