import { NextRequest, NextResponse } from "next/server";

import { activityStoreApplied } from "@/lib/admin/activity";
import { projectWebhookHealth } from "@/lib/admin/bot-ops";
import { googleConfigured } from "@/lib/admin/insights";
import {
  boardSummary,
  providerStatus,
  timedProbe,
  unconfigured,
  type ProbeResult,
  type ProviderStatus,
} from "@/lib/admin/operations";
import { appendAdminAudit, listBroadcasts } from "@/lib/admin/store";
import { dbPing } from "@/lib/beta/rpc";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { RELAY_API_ORIGIN } from "@/lib/relay/chains";
import { relayHeaders } from "@/lib/relay/http";
import { fetchRelayUsage } from "@/lib/relay/usage-api";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { nativeSolPriceMint } from "@/lib/solana/catalog";
import { readIrisJson } from "@/lib/solana/cctp-provider";
import { rpcPairHealth } from "@/lib/solana/health";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { sendPlainDelivery, tg } from "@/lib/telegram/api";
import { probeGuardStore, probeJupiterReferral, probeRewardsTreasury } from "@/lib/admin/money-signals.server";
import { getGuardRuntime } from "@/lib/guard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROBE_MS = 4_500;
const JUPITER_MAX_BYTES = 64 * 1024;

function since(startedAt: number): number {
  return Date.now() - startedAt;
}

async function probeDatabase(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const ok = await dbPing();
  return ok
    ? { ok: true, latencyMs: since(startedAt), detail: "RPC із секретом застосунку відповів." }
    : { ok: false, latencyMs: since(startedAt), state: "UNAVAILABLE", reason: "ping_failed", detail: "health_ping не відповів «ok»." };
}

/**
 * How close Relay's rate limit is, from Relay's own accounting.
 *
 * Owner instruction 2026-09-10, given after reading the Dashboard: the key meters
 * `/quote` at **50 requests a minute** for the whole integration, and that is a
 * ceiling shared by everybody using Bridge at once. The point of this row is to
 * see the wall before hitting it, so it reports the **peak minute** rather than
 * an average — fifty-nine quiet minutes and one at the ceiling average to
 * nothing while somebody was being refused.
 *
 * It reads `GET /metrics/usage` rather than counting locally, because serverless
 * instances do not share memory: a local counter would see a fraction of the
 * traffic and every instance would report headroom that is not there.
 *
 * `DEGRADED` on any refusal at all, or at four fifths of a ceiling — early
 * enough to act, late enough not to cry wolf.
 */
async function probeRelayRateLimit(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const usage = await fetchRelayUsage({ apiKey: resolveRelayApiKey(), timeoutMs: PROBE_MS });
  if (!usage.ok) {
    if (usage.reason === "UNCONFIGURED") return unconfigured("RYNTRA_RELAY_API_KEY не заданий у цьому середовищі, тож облік Relay недоступний.");
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: usage.reason === "UNAUTHORIZED" ? "UNAVAILABLE" : "UNKNOWN",
      reason: usage.reason.toLowerCase(),
      detail: usage.message,
    };
  }
  /* And whether the endpoint the money is read from actually answers with this
     key. `/metrics/usage` proves the key authenticates; `/requests/v3` proves the
     one call Activity's actual output and every Rewards accrual depend on. They
     are different questions and a key can pass the first and fail the second. */
  const v3 = await fetch(new URL("/requests/v3?limit=1", RELAY_API_ORIGIN).toString(), {
    method: "GET",
    headers: relayHeaders({ apiKey: resolveRelayApiKey() }),
    signal: AbortSignal.timeout(PROBE_MS),
  })
    .then((response) => (response.ok ? "OK" : `HTTP_${response.status}`))
    .catch(() => "UNREACHABLE");

  const worst = usage.rows[0] ?? null;
  const facts: Record<string, string | number | boolean | null> = {
    "виклики за добу": usage.totalCalls,
    "відмов 429": usage.totalRateLimited,
    "найнавантаженіший ендпойнт": worst ? worst.endpoint : null,
    "пікова хвилина": worst ? `${worst.peakPerMinute} з ${worst.limitPerMinute}` : null,
    "requests/v3": v3,
  };
  const load = Math.round(usage.worstLoad * 100);
  if (usage.totalRateLimited > 0) {
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: "DEGRADED",
      reason: "rate_limited",
      detail: `Relay відмовив ${usage.totalRateLimited} раз(и) за 429. Пік — ${load}% ліміту.`,
      facts,
    };
  }
  if (usage.worstLoad >= 0.8) {
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: "DEGRADED",
      reason: "approaching_limit",
      detail: `Пікова хвилина використала ${load}% ліміту. Відмов ще не було.`,
      facts,
    };
  }
  if (v3 !== "OK") {
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: "DEGRADED",
      reason: "requests_v3_unavailable",
      detail: `Ліміт у нормі (пік ${load}%), але /requests/v3 відповів «${v3}» — фактична сума й paidAppFees читаються звідти.`,
      facts,
    };
  }
  return { ok: true, latencyMs: since(startedAt), detail: `Пік — ${load}% ліміту, відмов немає, /requests/v3 відповідає.`, facts };
}

async function probeActivityStore(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const state = await activityStoreApplied();
  if (state === "applied") return { ok: true, latencyMs: since(startedAt), detail: "Зведення входів і дій читається." };
  if (state === "missing") {
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: "UNCONFIGURED",
      reason: "migration_not_applied",
      detail: "Міграцію 20260905120000_ryn_admin_006_activity_v1 ще не застосовано; входи й дії не збираються.",
    };
  }
  return { ok: false, latencyMs: since(startedAt), state: "UNAVAILABLE", reason: "rpc_failed", detail: "Сховище не відповіло." };
}

async function probeTelegram(): Promise<ProbeResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return unconfigured("TELEGRAM_BOT_TOKEN не заданий у цьому середовищі.");
  const startedAt = Date.now();
  const [me, hook] = await Promise.all([
    tg<{ username?: string }>("getMe", {}),
    tg<{ url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string }>("getWebhookInfo", {}),
  ]);
  const latencyMs = since(startedAt);
  if (!me || !hook) {
    return { ok: false, latencyMs, state: "UNAVAILABLE", reason: me ? "webhook_info_failed" : "get_me_failed", detail: "Telegram API не відповів." };
  }
  const health = projectWebhookHealth({
    username: me.username ?? null,
    webhookUrl: hook.url ?? null,
    pendingUpdateCount: hook.pending_update_count,
    lastErrorDate: hook.last_error_date,
    lastErrorMessage: hook.last_error_message ?? null,
  });
  const facts = {
    username: health.username ? `@${health.username}` : null,
    webhook_host: health.webhookHost,
    pending_updates: health.pendingUpdates ?? null,
    last_error_at: health.lastErrorAt,
  };
  if (!health.webhookConfigured) {
    return { ok: false, latencyMs, state: "DEGRADED", reason: "webhook_missing", detail: "Бот відповідає, але вебхук не налаштований.", facts };
  }
  const recentError = health.lastErrorAt && Date.now() - Date.parse(health.lastErrorAt) < 3_600_000;
  if (recentError) {
    return { ok: true, latencyMs, state: "DEGRADED", reason: "recent_webhook_error", detail: "Вебхук мав помилку протягом останньої години.", facts };
  }
  if ((health.pendingUpdates ?? 0) > 100) {
    return { ok: true, latencyMs, state: "DEGRADED", reason: "pending_backlog", detail: "У черзі вебхука понад 100 оновлень.", facts };
  }
  return { ok: true, latencyMs, detail: "Бот і вебхук відповідають.", facts };
}

async function probeSolanaRpc(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: PROBE_MS - 500, retries: 0 });
  try {
    const slot = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getSlot({ commitment: "confirmed" }).send({ abortSignal }),
    );
    const health = rpcPairHealth(handle);
    const facts = { served_by: handle.host(), slot: typeof slot === "bigint" ? slot.toString() : String(slot) };
    if (health.state === "DEGRADED") {
      return { ok: true, latencyMs: since(startedAt), state: "DEGRADED", reason: "fallback_served", detail: health.detail, facts };
    }
    return { ok: true, latencyMs: since(startedAt), detail: health.detail, facts };
  } catch {
    const health = rpcPairHealth(handle);
    return {
      ok: false,
      latencyMs: since(startedAt),
      state: health.state === "UNKNOWN" ? "UNKNOWN" : "UNAVAILABLE",
      reason: "rpc_pair_failed",
      detail: health.detail,
      facts: { served_by: null },
    };
  }
}

async function probeJupiter(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const apiKey = process.env.RYNTRA_JUPITER_API_KEY?.trim() || null;
  const base = apiKey ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3";
  const mint = nativeSolPriceMint();
  let response: Response;
  try {
    response = await fetch(`${base}?ids=${encodeURIComponent(mint)}`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      signal: AbortSignal.timeout(PROBE_MS - 500),
      cache: "no-store",
    });
  } catch {
    return { ok: false, latencyMs: since(startedAt), state: "UNAVAILABLE", reason: "unreachable", detail: "Jupiter не відповів.", facts: { access: apiKey ? "keyed" : "keyless" } };
  }
  const latencyMs = since(startedAt);
  const facts = { access: apiKey ? "keyed" : "keyless", http: response.status };
  if (response.status === 429) {
    await response.body?.cancel();
    return { ok: false, latencyMs, state: "DEGRADED", reason: "rate_limited", detail: "Jupiter обмежив запити.", facts };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, latencyMs, state: "UNAVAILABLE", reason: "refused", detail: `Jupiter відмовив: HTTP ${response.status}.`, facts };
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > JUPITER_MAX_BYTES) {
    await response.body?.cancel();
    return { ok: false, latencyMs, state: "UNKNOWN", reason: "oversized", detail: "Відповідь завелика для проби.", facts };
  }
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > JUPITER_MAX_BYTES) throw new Error("oversized");
    const body = JSON.parse(text) as Record<string, unknown>;
    const entry = body && typeof body === "object" ? body[mint] : undefined;
    if (!entry || typeof entry !== "object") {
      return { ok: false, latencyMs, state: "UNKNOWN", reason: "malformed", detail: "HTTP 200, але ціни SOL у відповіді немає.", facts };
    }
    return { ok: true, latencyMs, detail: "Ціна SOL читається.", facts };
  } catch {
    return { ok: false, latencyMs, state: "UNKNOWN", reason: "malformed", detail: "Відповідь Jupiter не розібрано.", facts };
  }
}

async function probeIris(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const read = await readIrisJson("/v2/publicKeys", { fetchImpl: fetch, timeoutMs: PROBE_MS - 500 });
  const latencyMs = since(startedAt);
  if (read.ok) {
    const keys = read.value && typeof read.value === "object" ? Object.keys(read.value as Record<string, unknown>).length : 0;
    if (keys === 0) return { ok: false, latencyMs, state: "UNKNOWN", reason: "malformed", detail: "HTTP 200 без публічних ключів.", facts: { http: read.status } };
    return { ok: true, latencyMs, detail: "Публічні ключі Iris читаються.", facts: { http: read.status } };
  }
  const state = read.code === "RATE_LIMITED" ? "DEGRADED" : read.code === "MALFORMED_RESPONSE" ? "UNKNOWN" : "UNAVAILABLE";
  const detail =
    read.code === "UNREACHABLE_FROM_ENVIRONMENT"
      ? "Iris не відповідає з цього середовища (з Vercel може відповідати)."
      : read.code === "RATE_LIMITED"
        ? "Iris обмежив запити."
        : "Iris відмовив або відповів некоректно.";
  return { ok: false, latencyMs, state, reason: read.code.toLowerCase(), detail, facts: { http: read.status } };
}

async function probeBroadcastQueue(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const rows = await listBroadcasts(50);
  const latencyMs = since(startedAt);
  if (!rows) return { ok: false, latencyMs, state: "UNAVAILABLE", reason: "rpc_failed", detail: "Список кампаній не прочитано." };
  const inFlight = rows.filter((row) => row.state === "QUEUED" || row.state === "SENDING" || row.state === "SCHEDULED");
  const failed = rows.reduce((sum, row) => sum + (row.failed_count ?? 0) + (row.blocked_count ?? 0), 0);
  const facts = { campaigns: rows.length, in_flight: inFlight.length, undelivered: failed };
  if (failed > 0) return { ok: true, latencyMs, state: "DEGRADED", reason: "undelivered", detail: "Є недоставлені повідомлення.", facts };
  return { ok: true, latencyMs, detail: inFlight.length > 0 ? "Кампанії в черзі." : "Черга порожня.", facts };
}

function probeGoogle(kind: "ga4" | "search_console"): ProbeResult {
  const configured = googleConfigured({ GA4_PROPERTY_ID: process.env.GA4_PROPERTY_ID, GSC_SITE_URL: process.env.GSC_SITE_URL });
  const present = kind === "ga4" ? configured.ga4 : configured.searchConsole;
  if (!present) return unconfigured("Серверних облікових даних немає. Це не нуль відвідувачів.");
  return { ok: false, latencyMs: null, state: "UNKNOWN", reason: "provider_unread", detail: "Облікові дані є, живого читання ще немає." };
}

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const scope = new URL(req.url).searchParams.get("scope");
  const checkedAt = new Date();

  const store = getGuardRuntime().store;
  const probes: [ProviderStatus["id"], () => Promise<ProbeResult>][] = [
    ["database", probeDatabase],
    ["activity_store", probeActivityStore],
    ["guard_store", () => probeGuardStore(store)],
    ["telegram_bot", probeTelegram],
    ["broadcast_queue", probeBroadcastQueue],
  ];
  if (scope !== "core") {
    probes.push(
      ["solana_rpc", probeSolanaRpc],
      ["jupiter", probeJupiter],
      ["jupiter_referral", probeJupiterReferral],
      ["rewards_treasury", () => probeRewardsTreasury()],
      ["relay_rate_limit", probeRelayRateLimit],
      ["circle_iris", probeIris],
    );
  }

  const results = await Promise.all(probes.map(async ([id, run]) => providerStatus(id, await timedProbe(run, PROBE_MS), checkedAt)));
  const board: ProviderStatus[] = [
    ...results,
    providerStatus("ga4", probeGoogle("ga4"), checkedAt),
    providerStatus("search_console", probeGoogle("search_console"), checkedAt),
  ];

  const bot = board.find((row) => row.id === "telegram_bot");
  return NextResponse.json({
    checkedAt: checkedAt.toISOString(),
    board,
    summary: boardSummary(board),
    /* Kept for the existing Bot Operations card. */
    health: bot
      ? {
          username: typeof bot.facts.username === "string" ? bot.facts.username.replace(/^@/, "") : null,
          webhookHost: typeof bot.facts.webhook_host === "string" ? bot.facts.webhook_host : null,
          webhookConfigured: typeof bot.facts.webhook_host === "string",
          pendingUpdates: typeof bot.facts.pending_updates === "number" ? bot.facts.pending_updates : undefined,
          lastErrorAt: typeof bot.facts.last_error_at === "string" ? bot.facts.last_error_at : null,
          lastErrorClass: typeof bot.facts.last_error_at === "string" ? "webhook_error" : null,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await appendAdminAudit({
    actorTelegramId: admin,
    action: "ops_owner_test",
    outcome: "attempt",
  });
  const sent = await sendPlainDelivery(admin, "Ryntra operations test.");
  await appendAdminAudit({
    actorTelegramId: admin,
    action: "ops_owner_test",
    outcome: sent.kind === "sent" ? "ok" : "failed",
    payload: { delivery: sent.kind },
  });
  return NextResponse.json({ delivery: sent.kind });
}
