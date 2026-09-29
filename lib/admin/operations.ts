/**
 * Operations provider board.
 *
 * Five states and no sixth: HEALTHY · DEGRADED · UNAVAILABLE · UNKNOWN ·
 * UNCONFIGURED. A timeout is UNAVAILABLE, a malformed answer is UNKNOWN, an
 * answer served by a fallback is DEGRADED, a missing credential is
 * UNCONFIGURED. Nothing here turns a single HTTP 200 into "the provider
 * works": every row names the one capability it actually checked.
 *
 * The board is assembled from independent probes; one probe failing is one
 * row, never a blank board.
 */

export const PROVIDER_STATES = ["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN", "UNCONFIGURED"] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

export const PROVIDER_IDS = [
  "database",
  "activity_store",
  "telegram_bot",
  "solana_rpc",
  "jupiter",
  "relay_rate_limit",
  "circle_iris",
  "ga4",
  "search_console",
  "broadcast_queue",
  "guard_store",
  "rewards_treasury",
  "jupiter_referral",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  database: "База (Supabase RPC)",
  activity_store: "Сховище активності",
  telegram_bot: "Telegram-бот",
  solana_rpc: "Solana RPC (mainnet)",
  jupiter: "Jupiter",
  relay_rate_limit: "Relay — запас ліміту",
  circle_iris: "Circle Iris (CCTP)",
  ga4: "GA4",
  search_console: "Search Console",
  broadcast_queue: "Черга розсилок",
  guard_store: "Guard-стор (реєстри)",
  rewards_treasury: "Скарбниця Rewards",
  jupiter_referral: "Реферальний акаунт Jupiter",
};

/** What each row actually proves — printed beside the state, never implied. */
export const PROVIDER_CAPABILITY: Record<ProviderId, string> = {
  database: "health_ping через секрет застосунку",
  activity_store: "читання зведення входів і дій",
  telegram_bot: "getMe + getWebhookInfo",
  solana_rpc: "getSlot на парі endpoint-ів",
  jupiter: "читання ціни SOL (price v3)",
  relay_rate_limit: "власний облік Relay: виклики, 429 і пікова хвилина на ключ",
  circle_iris: "читання /v2/publicKeys",
  ga4: "наявність серверних облікових даних",
  search_console: "наявність серверних облікових даних",
  broadcast_queue: "стан кампаній у сховищі",
  guard_store: "читання реєстру внутрішніх гаманців",
  rewards_treasury: "баланс USDC скарбниці виплат",
  jupiter_referral: "акаунт існує, у програмі Referral, у проєкті Ultra",
};

export type ProviderStatus = Readonly<{
  id: ProviderId;
  label: string;
  capability: string;
  state: ProviderState;
  checkedAt: string | null;
  latencyMs: number | null;
  /** A short safe class, never provider text, secrets or URLs with keys. */
  reason: string | null;
  /** One sentence for the row, composed here. */
  detail: string | null;
  /** Provider-specific facts a row may show (pending updates, host, queue counts). */
  facts: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ProbeResult =
  | { ok: true; latencyMs: number; state?: Exclude<ProviderState, "UNAVAILABLE" | "UNCONFIGURED">; reason?: string | null; detail?: string | null; facts?: Record<string, string | number | boolean | null> }
  | { ok: false; latencyMs: number | null; state: Exclude<ProviderState, "HEALTHY">; reason: string; detail?: string | null; facts?: Record<string, string | number | boolean | null> };

export function providerStatus(
  id: ProviderId,
  result: ProbeResult,
  checkedAt: Date,
): ProviderStatus {
  return {
    id,
    label: PROVIDER_LABEL[id],
    capability: PROVIDER_CAPABILITY[id],
    state: result.ok ? (result.state ?? "HEALTHY") : result.state,
    checkedAt: checkedAt.toISOString(),
    latencyMs: result.latencyMs,
    reason: result.ok ? (result.reason ?? null) : result.reason,
    detail: result.detail ?? null,
    facts: result.facts ?? {},
  };
}

/** Run one probe under a deadline; a deadline is UNAVAILABLE with reason `timeout`, never healthy. */
export async function timedProbe(
  work: () => Promise<ProbeResult>,
  timeoutMs: number,
): Promise<ProbeResult> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, latencyMs: null, state: "UNAVAILABLE", reason: "timeout", detail: `Не відповів за ${timeoutMs} мс.` }),
      timeoutMs,
    );
  });
  try {
    const result = await Promise.race([work(), deadline]);
    if (result.ok && !Number.isFinite(result.latencyMs)) {
      return { ...result, latencyMs: Date.now() - startedAt };
    }
    return result;
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt, state: "UNAVAILABLE", reason: "probe_threw", detail: "Проба завершилась помилкою." };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function unconfigured(detail: string): ProbeResult {
  return { ok: false, latencyMs: null, state: "UNCONFIGURED", reason: "no_server_credentials", detail };
}

const STATE_RANK: Record<ProviderState, number> = {
  UNAVAILABLE: 4,
  DEGRADED: 3,
  UNKNOWN: 2,
  UNCONFIGURED: 1,
  HEALTHY: 0,
};

export function boardSummary(board: readonly ProviderStatus[]): {
  worst: ProviderState;
  attention: ProviderStatus[];
  counts: Record<ProviderState, number>;
} {
  const counts: Record<ProviderState, number> = { HEALTHY: 0, DEGRADED: 0, UNAVAILABLE: 0, UNKNOWN: 0, UNCONFIGURED: 0 };
  let worst: ProviderState = "HEALTHY";
  for (const row of board) {
    counts[row.state] += 1;
    if (STATE_RANK[row.state] > STATE_RANK[worst]) worst = row.state;
  }
  return {
    worst,
    attention: board.filter((row) => row.state === "UNAVAILABLE" || row.state === "DEGRADED" || row.state === "UNKNOWN"),
    counts,
  };
}

/** Is the recorded check older than the surface may call current? */
export function isStale(checkedAt: string | null, now: Date, maxAgeMs = 5 * 60_000): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  return !Number.isFinite(at) || now.getTime() - at > maxAgeMs;
}

export const PROVIDER_STATE_LABEL: Record<ProviderState, string> = {
  HEALTHY: "працює",
  DEGRADED: "частково",
  UNAVAILABLE: "недоступний",
  UNKNOWN: "невідомо",
  UNCONFIGURED: "не підключено",
};
