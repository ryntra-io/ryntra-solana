// Zero-dependency error monitoring. Every path is best-effort and never throws —
// a monitoring failure must never break the request it is observing.
//
// Two independent, env-gated sinks (both optional; console.error always runs):
//   • Sentry  — set SENTRY_DSN. Events are posted to Sentry's HTTP envelope endpoint
//               directly (no @sentry/* SDK, no build changes, no source-map upload).
//   • Telegram— set ALERT_TELEGRAM_ID to the founder's numeric Telegram id. Critical
//               errors are DM'd via the existing bot, rate-limited per signature.

import { sendPlainMessage } from "@/lib/telegram/api";

const SENTRY_DSN = process.env.SENTRY_DSN;
const ALERT_TELEGRAM_ID = process.env.ALERT_TELEGRAM_ID;
const ENVIRONMENT = process.env.VERCEL_ENV ?? "development";

type Extra = Record<string, unknown>;

function hex32(): string {
  // event_id must be 32 hex chars, no dashes
  return (globalThis.crypto?.randomUUID?.() ?? "00000000-0000-4000-8000-000000000000").replace(/-/g, "");
}

/** Parse a Sentry DSN into its ingest envelope URL + public key. Returns null if malformed. */
function parseDsn(dsn: string): { url: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!u.username || !projectId) return null;
    return { url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey: u.username };
  } catch {
    return null;
  }
}

async function toSentry(where: string, err: unknown, extra?: Extra): Promise<void> {
  if (!SENTRY_DSN) return;
  const dsn = parseDsn(SENTRY_DSN);
  if (!dsn) return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const eventId = hex32();
  const nowSec = Date.now() / 1000;
  const event = {
    event_id: eventId,
    timestamp: nowSec,
    platform: "node",
    level: "error",
    logger: "ryntra",
    server_name: "ryntra",
    environment: ENVIRONMENT,
    transaction: where,
    tags: { where },
    exception: { values: [{ type: e.name || "Error", value: e.message, stacktrace: undefined }] },
    extra: { stack: e.stack, ...extra },
  };
  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: SENTRY_DSN }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(event);
  try {
    await fetch(dsn.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=ryntra-monitor/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* monitoring is best-effort */
  }
}

// Per-instance throttle: don't DM the founder more than once per signature per window.
const lastAlert = new Map<string, number>();
const ALERT_WINDOW_MS = 10 * 60 * 1000;

async function toTelegram(where: string, err: unknown, extra?: Extra): Promise<void> {
  if (!ALERT_TELEGRAM_ID) return;
  const id = Number(ALERT_TELEGRAM_ID);
  if (!Number.isFinite(id)) return;
  const msg = err instanceof Error ? err.message : String(err);
  const sig = `${where}:${msg}`.slice(0, 120);
  const now = Date.now();
  const prev = lastAlert.get(sig);
  if (prev && now - prev < ALERT_WINDOW_MS) return;
  lastAlert.set(sig, now);
  if (lastAlert.size > 500) lastAlert.clear();
  const extraLine = extra && Object.keys(extra).length ? `\n${JSON.stringify(extra).slice(0, 300)}` : "";
  const text = `⚠️ Ryntra ${ENVIRONMENT} error\n[${where}] ${msg.slice(0, 400)}${extraLine}`;
  try {
    await sendPlainMessage(id, text);
  } catch {
    /* best-effort */
  }
}

/**
 * Report a server error. Always logs to console (preserving existing behavior);
 * additionally forwards to Sentry and/or the founder's Telegram when configured.
 * Fire-and-forget safe — awaiting is optional and it never rejects.
 */
export async function reportError(where: string, err: unknown, extra?: Extra): Promise<void> {
  console.error(`[${where}]`, err, extra ?? "");
  await Promise.allSettled([toSentry(where, err, extra), toTelegram(where, err, extra)]);
}
