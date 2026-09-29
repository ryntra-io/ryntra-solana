/**
 * A probe-shaped Supabase RPC call: tells a missing function apart from a
 * failing one, and never reports.
 *
 * PostgREST answers an unknown function with 404 (`PGRST202`), which is what a
 * migration that has not been applied looks like from here. The admin surfaces
 * must say "not collected yet" for that and "unavailable" for a real failure,
 * so the two are different results rather than one null. Always quiet: an
 * unapplied store is an expected state, not an incident — and this module has
 * no monitoring import on purpose, so pure admin modules and their tests can
 * load it without the application's alias graph.
 *
 * Environment is read per call, not at module load, so a test can set it
 * before the first probe.
 */

export type RpcProbe<T> =
  | { kind: "ok"; data: T | null }
  | { kind: "missing" }
  | { kind: "unavailable"; reason: "not_configured" | "http" | "network"; status?: number };

export async function rpcProbe<T>(
  fn: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<RpcProbe<T>> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const secret = process.env.BETA_APP_SECRET;
  if (!url || !anonKey || !secret) return { kind: "unavailable", reason: "not_configured" };
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_secret: secret, ...args }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch {
    return { kind: "unavailable", reason: "network" };
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    return { kind: "unavailable", reason: "http", status: response.status };
  }
  if (!response.ok) {
    if (response.status === 404) return { kind: "missing" };
    return { kind: "unavailable", reason: "http", status: response.status };
  }
  try {
    return { kind: "ok", data: text && text !== "null" ? (JSON.parse(text) as T) : null };
  } catch {
    return { kind: "unavailable", reason: "http", status: response.status };
  }
}
