import type { GuardStore } from "../guard/store.ts";
import { formatUsdMicros } from "../rewards/model.ts";
import { readRewardsReserve } from "../rewards/treasury.server.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { verifiedJupiterReferral } from "../solana/referral-account.server.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import type { ProbeResult } from "./operations.ts";
import type { AttentionItem } from "./overview.ts";

/**
 * The money's own signals, for the operator who has to notice before a
 * customer does.
 *
 * `RYN-ADMIN-FEEDBACK-LOOP-001`. The provider board knew whether the database
 * and the RPC answered; nothing on the admin said whether a swap had failed
 * today, whether a bridge was stuck, whether the Rewards treasury could pay,
 * whether Jupiter would collect the fee at all. These are those four, as
 * probes for the Operations board and as attention rows for the Overview,
 * each read from the source that decides it and bounded so a slow read never
 * holds the page.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type OperationsHealth = Readonly<{
  status: "measured" | "unavailable";
  /** `FAILED` rows updated in the last seven days. */
  failed7d: number;
  /** `IN_FLIGHT` or `NEEDS_YOU` rows untouched for over an hour. */
  stuck: number;
  /** `DONE` rows in the last 24 hours — the pulse. */
  done24h: number;
  oldestStuckAt: string | null;
}>;

/** Failed and stuck operations, from the wallet action ledger. */
export async function readOperationsHealth(store: GuardStore, now: Date = new Date()): Promise<OperationsHealth> {
  try {
    const raw = await store.collection<unknown>("solanaWalletActions").valuesWithPrefix("solana:mainnet:");
    const since7d = now.getTime() - 7 * DAY_MS;
    const since24h = now.getTime() - DAY_MS;
    const stuckBefore = now.getTime() - HOUR_MS;
    let failed7d = 0;
    let stuck = 0;
    let done24h = 0;
    let oldestStuckAt: string | null = null;
    for (const row of raw) {
      const parsed = SolanaWalletActionSchema.safeParse(row);
      if (!parsed.success) continue;
      const action: SolanaWalletAction = parsed.data;
      const updated = Date.parse(action.updatedAt);
      if (action.outcome === "FAILED" && updated >= since7d) failed7d += 1;
      if (action.outcome === "DONE" && updated >= since24h) done24h += 1;
      if ((action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU") && updated < stuckBefore) {
        stuck += 1;
        if (oldestStuckAt === null || action.updatedAt < oldestStuckAt) oldestStuckAt = action.updatedAt;
      }
    }
    return { status: "measured", failed7d, stuck, done24h, oldestStuckAt };
  } catch {
    return { status: "unavailable", failed7d: 0, stuck: 0, done24h: 0, oldestStuckAt: null };
  }
}

/** The Rewards treasury: configured, readable, and holding something. */
export async function probeRewardsTreasury(env: NodeJS.ProcessEnv = process.env): Promise<ProbeResult> {
  const startedAt = Date.now();
  const reserve = await readRewardsReserve({ env });
  const latencyMs = Date.now() - startedAt;
  if (reserve.state === "UNCONFIGURED") {
    return { ok: false, latencyMs: null, state: "UNCONFIGURED", reason: "no_treasury", detail: reserve.reason };
  }
  if (reserve.state === "UNREADABLE") {
    return { ok: false, latencyMs, state: "UNAVAILABLE", reason: "treasury_unreadable", detail: reserve.reason };
  }
  const treasury = reserve.treasury ?? "";
  const facts = { treasury: treasury ? `${treasury.slice(0, 4)}…${treasury.slice(-4)}` : null, balance_usd: formatUsdMicros(reserve.usdMicros), state: reserve.state };
  if (reserve.state === "EMPTY") {
    return { ok: true, latencyMs, state: "DEGRADED", reason: "treasury_empty", detail: "Скарбниця Rewards порожня — нарахування записуються, виплати чекають на поповнення.", facts };
  }
  return { ok: true, latencyMs, detail: `Скарбниця читається: $${formatUsdMicros(reserve.usdMicros)} USDC.`, facts };
}

/** The Jupiter referral account: the fee is collected only when it verifies. */
export async function probeJupiterReferral(): Promise<ProbeResult> {
  const startedAt = Date.now();
  const config = resolveServiceFeeConfig();
  if (!config.jupiterReferralAccount) {
    return { ok: false, latencyMs: null, state: "UNCONFIGURED", reason: "no_referral_account", detail: "RYNTRA_JUPITER_REFERRAL_ACCOUNT не заданий — комісія Swap/Spot не збирається." };
  }
  const verified = await verifiedJupiterReferral(config);
  const latencyMs = Date.now() - startedAt;
  if (!verified.verdict.ok) {
    return { ok: false, latencyMs, state: "UNAVAILABLE", reason: verified.verdict.code.toLowerCase(), detail: `${verified.verdict.reason} Комісія Swap/Spot не збирається, торгівля не зупиняється.` };
  }
  return { ok: true, latencyMs, detail: `Реферальний акаунт підтверджено; ставка ${verified.referral?.feeBps ?? 0} bps.`, facts: { account: `${verified.verdict.account.slice(0, 4)}…${verified.verdict.account.slice(-4)}` } };
}

/** The Guard store — the ledgers Activity, Rewards and Points live in. */
export async function probeGuardStore(store: GuardStore): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const rows = await store.collection<unknown>("adminInternalWallets").valuesWithPrefix("");
    return { ok: true, latencyMs: Date.now() - startedAt, detail: "Guard-стор читається.", facts: { internal_wallets: rows.length } };
  } catch (failure) {
    return { ok: false, latencyMs: Date.now() - startedAt, state: "UNAVAILABLE", reason: "guard_store_unreadable", detail: failure instanceof Error ? failure.message : "Guard-стор не відповів." };
  }
}

/** The attention rows the money adds to the Overview. */
export function moneyAttention(args: Readonly<{ health: OperationsHealth; treasury: ProbeResult; referral: ProbeResult; relayKeyPresent: boolean }>): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (args.health.status === "unavailable") {
    items.push({ id: "ledger_unavailable", label: "Реєстр операцій не відповів", value: undefined, tone: "risk", href: "/admin/operations" });
  } else {
    if (args.health.stuck > 0) {
      items.push({ id: "operations_stuck", label: "Операції без остаточного результату понад годину", value: args.health.stuck, tone: "risk", href: "/admin/analytics?scope=all" });
    }
    if (args.health.failed7d > 0) {
      items.push({ id: "operations_failed", label: "Невдалі операції за 7 днів", value: args.health.failed7d, tone: "warn", href: "/admin/analytics?scope=all" });
    }
  }
  if (!args.treasury.ok) {
    items.push({ id: "treasury", label: args.treasury.state === "UNCONFIGURED" ? "Скарбниця Rewards не налаштована" : "Скарбниця Rewards не читається", value: undefined, tone: "risk", href: "/admin/operations" });
  } else if (args.treasury.state === "DEGRADED") {
    items.push({ id: "treasury_empty", label: "Скарбниця Rewards порожня", value: undefined, tone: "warn", href: "/admin/operations" });
  }
  if (!args.referral.ok) {
    items.push({ id: "jupiter_referral", label: "Комісія Jupiter не збирається — реферальний акаунт не підтверджено", value: undefined, tone: "risk", href: "/admin/operations" });
  }
  if (!args.relayKeyPresent) {
    items.push({ id: "relay_key", label: "Relay без ключа: філи читаються з Requests v2 (до 24.11.2026)", value: undefined, tone: "muted", href: "/admin/operations" });
  }
  return items;
}
