// Shared server-only Supabase RPC core for every SECURITY DEFINER beta_*/paper_*/live_* function.
// One place for the transport (headers, p_secret injection, timeout) and for infra-failure
// reporting — previously four near-identical copies whose failures only hit console.error and
// never reached Sentry/Telegram (reportError has its own per-key cooldown, so this can't spam).
//
// Two result shapes are kept for byte-compatible consumers:
//   rpcResult<T> → { ok: true, data } | { ok: false, error }   (paper/live semantics)
//   rpcOrNull<T> → T | null                                    (beta semantics)

import { reportError } from "./monitor";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BETA_APP_SECRET = process.env.BETA_APP_SECRET;

type Raw = { kind: "ok"; text: string } | { kind: "http"; status: number; text: string } | { kind: "infra"; error: string };

/**
 * `quiet` marks a call whose failure is an expected state rather than an incident — today
 * that is the acquisition path, whose schema is a deliberately unapplied migration. Without
 * it every bot start would emit an unsampled log line about a function we know is absent.
 * Quiet callers are responsible for their own sampled reporting.
 */
async function call(scope: string, fn: string, args: Record<string, unknown>, quiet = false): Promise<Raw> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BETA_APP_SECRET) {
    if (!quiet) void reportError(`${scope}-rpc:env`, new Error(`rpc ${fn}: env not configured`));
    return { kind: "infra", error: "not configured" };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_secret: BETA_APP_SECRET, ...args }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    if (!res.ok) return { kind: "http", status: res.status, text };
    return { kind: "ok", text };
  } catch (e) {
    // network/timeout — real infra failure, worth waking the founder up (throttled in monitor)
    if (!quiet) void reportError(`${scope}-rpc:${fn}`, e);
    return { kind: "infra", error: "temporarily unavailable" };
  }
}

/** paper/live shape: business errors (PostgREST `raise exception`) surface their message. */
export async function rpcResult<T>(scope: string, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await call(scope, fn, args);
  if (r.kind === "infra") return { ok: false, error: r.error };
  if (r.kind === "http") {
    // PostgREST wraps `raise exception` messages as {"message": "..."}
    let msg = `rpc ${fn} failed`;
    try { msg = (JSON.parse(r.text) as { message?: string }).message ?? msg; } catch { /* keep default */ }
    return { ok: false, error: msg };
  }
  return { ok: true, data: JSON.parse(r.text) as T };
}

/** beta shape: any failure → null (callers treat null as "unavailable"). */
export async function rpcOrNull<T>(
  scope: string,
  fn: string,
  args: Record<string, unknown>,
  options?: { quiet?: boolean },
): Promise<T | null> {
  const quiet = options?.quiet === true;
  const r = await call(scope, fn, args, quiet);
  if (r.kind === "infra") return null;
  if (r.kind === "http") {
    if (!quiet) console.error(`${scope} rpc ${fn}: ${r.status} ${r.text}`);
    return null;
  }
  return r.text && r.text !== "null" ? (JSON.parse(r.text) as T) : null;
}
