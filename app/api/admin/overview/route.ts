import { NextResponse } from "next/server";

import { readActivitySummary } from "@/lib/admin/activity";
import { moneyAttention, probeGuardStore, probeJupiterReferral, probeRewardsTreasury, readOperationsHealth } from "@/lib/admin/money-signals.server";
import { projectOverview, type ServiceCell } from "@/lib/admin/overview";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { projectWebhookHealth } from "@/lib/admin/bot-ops";
import { listBroadcasts, listFeedback } from "@/lib/admin/store";
import { metrics } from "@/lib/beta/rpc";
import { toDescriptiveMetrics } from "@/lib/metrics-response.mjs";
import { getAdminSession } from "@/lib/session";
import { rpcOrNull } from "@/lib/supabase-rpc";
import { tg } from "@/lib/telegram/api";
import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { fetchJupiterReferralBalance, fetchRelayAppFeeBalance } from "@/lib/swap/fee-balances.server";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHT_PROBE_MS = 2_500;

async function bounded<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The founder's first screen. Every source is read independently and a
 * failing one becomes an `unavailable` cell and an attention line — never a
 * blank page and never a zero.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [metricsRead, extraRead, feedbackRead, broadcastsRead, activityRead, hookRead] = await Promise.all([
    bounded(metrics(), 8_000),
    bounded(rpcOrNull<Record<string, unknown>>("admin", "admin_extra", {}, { quiet: true }), 8_000),
    bounded(listFeedback(200), 8_000),
    bounded(listBroadcasts(50), 8_000),
    readActivitySummary(),
    bounded(
      tg<{ url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string }>("getWebhookInfo", {}),
      LIGHT_PROBE_MS,
    ),
  ]);

  const descriptive = toDescriptiveMetrics(metricsRead);
  const hook = hookRead ? projectWebhookHealth({ webhookUrl: hookRead.url ?? null, pendingUpdateCount: hookRead.pending_update_count, lastErrorDate: hookRead.last_error_date, lastErrorMessage: hookRead.last_error_message ?? null }) : null;

  const services: ServiceCell[] = [
    { id: "database", label: "База", state: descriptive ? "HEALTHY" : "UNAVAILABLE" },
    {
      id: "telegram_bot",
      label: "Telegram-бот",
      state: !process.env.TELEGRAM_BOT_TOKEN
        ? "UNCONFIGURED"
        : !hook
          ? "UNAVAILABLE"
          : !hook.webhookConfigured
            ? "DEGRADED"
            : hook.lastErrorAt && Date.now() - Date.parse(hook.lastErrorAt) < 3_600_000
              ? "DEGRADED"
              : "HEALTHY",
    },
    {
      id: "activity_store",
      label: "Сховище активності",
      state: activityRead.status === "measured" ? "HEALTHY" : activityRead.status === "not_collected" ? "UNCONFIGURED" : "UNAVAILABLE",
    },
  ];

  /* What has accrued and is not yet withdrawn, per mechanism.
     A per-swap receipt says what one operation produced; this says what is
     sitting in the account, and a business has to be able to ask both. Read on
     the admin surface rather than in a report of its own, because it is one more
     number an operator already comes here for. Unconfigured mechanisms answer
     `NOT_CONFIGURED`, which is the useful state before the addresses are set. */
  /* The money's own signals: failed and stuck operations, the Rewards
     treasury, the Jupiter referral account, the Guard store — each bounded,
     each an attention row when it is not right. */
  const store = getGuardRuntime().store;
  const [health, treasury, referral, guard] = await Promise.all([
    bounded(readOperationsHealth(store), 6_000).then((read) => read ?? { status: "unavailable" as const, failed7d: 0, stuck: 0, done24h: 0, oldestStuckAt: null }),
    bounded(probeRewardsTreasury(), 6_000).then((read) => read ?? { ok: false as const, latencyMs: null, state: "UNAVAILABLE" as const, reason: "timeout", detail: "Скарбниця не відповіла за 6 с." }),
    bounded(probeJupiterReferral(), 6_000).then((read) => read ?? { ok: false as const, latencyMs: null, state: "UNAVAILABLE" as const, reason: "timeout", detail: "Реферальний акаунт не прочитано за 6 с." }),
    bounded(probeGuardStore(store), 4_000).then((read) => read ?? { ok: false as const, latencyMs: null, state: "UNAVAILABLE" as const, reason: "timeout", detail: "Guard-стор не відповів за 4 с." }),
  ]);
  const stateOf = (probe: { ok: boolean; state?: string }): ServiceCell["state"] =>
    probe.ok ? ((probe.state as ServiceCell["state"] | undefined) ?? "HEALTHY") : ((probe.state as ServiceCell["state"] | undefined) ?? "UNAVAILABLE");
  services.push(
    { id: "guard_store", label: "Guard-стор", state: stateOf(guard) },
    { id: "rewards_treasury", label: "Скарбниця Rewards", state: stateOf(treasury) },
    { id: "jupiter_referral", label: "Реферал Jupiter", state: stateOf(referral) },
  );
  const extraAttention = moneyAttention({ health, treasury, referral, relayKeyPresent: Boolean((process.env.RYNTRA_RELAY_API_KEY ?? "").trim()) });

  const feeConfig = resolveServiceFeeConfig();
  const [relayFees, jupiterFees] = await Promise.all([
    bounded(fetchRelayAppFeeBalance(feeConfig.relayAppFeeRecipient), 8_000).catch(() => null),
    bounded(
      fetchJupiterReferralBalance(feeConfig.jupiterReferralAccount, [
        { mint: SOLANA_MAINNET_USDC_MINT, symbol: "USDC", decimals: 6 },
        { mint: WRAPPED_SOL_MINT, symbol: "SOL", decimals: 9 },
      ]),
      8_000,
    ).catch(() => null),
  ]);

  return NextResponse.json({
    serviceFeeBalances: { relay: relayFees, jupiter: jupiterFees },
    overview: projectOverview({
      metrics: descriptive,
      extra: extraRead,
      feedback: { rows: feedbackRead },
      broadcasts: broadcastsRead,
      activity: activityRead,
      services,
      extraAttention,
    }),
    operationsHealth: health,
  });
}
