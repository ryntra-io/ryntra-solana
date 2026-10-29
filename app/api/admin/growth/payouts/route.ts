import { NextRequest, NextResponse } from "next/server";

import { requireFreshMfa } from "@/lib/admin/auth";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSupportsConcurrentInstances } from "@/lib/guard/store";
import { ATTRIBUTION_REGISTRY } from "@/lib/attribution/registry";
import { CANARY_MAX_USD_MICROS, CANARY_MIN_USD_MICROS, canarySlotKey, observePayout, readAllReceipts, readOpenPayouts, readPayoutGate, readPayoutPause, sendCanaryPayout, setPayoutPause } from "@/lib/growth/partner-payout";
import { payoutChainReads, payoutDeps } from "@/lib/growth/partner-payout.server";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { freeReserveUsdMicros, readReserveLedger } from "@/lib/rewards/reserve";
import { readRewardsReserve, rewardsTreasuryConfig } from "@/lib/rewards/treasury.server";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Partner payouts for the owner: whether they are open, the canary, every
 * receipt, and the Rewards treasury they are paid from (its address, whether
 * this deployment can sign — never the key — its balance and what is free).
 *
 * `POST` starts the canary: $1–2 to the voluntary test wallet the owner names,
 * with a reason. A fresh second factor, once ever: its paid receipt opens
 * automatic partner payouts. The server signs with the treasury's key, as it
 * does for every cashback claim; the owner funds the treasury and presses.
 * `POST {action:"pause"|"resume", note}` stops or resumes partner payouts
 * alone, with a reason — cashback is not touched.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

/** "1.5" → 1500000; null when not an amount. */
function usdToMicros(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d{1,3})(?:[.,](\d{1,6}))?$/.exec(String(value).trim());
  if (!match) return null;
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  try {
    const store = getGuardRuntime().store;
    const now = new Date().toISOString();
    const canary = await observePayout(store, payoutChainReads(), canarySlotKey("solana"));
    const [gate, pause, open, receipts, reserve, ledger] = await Promise.all([
      readPayoutGate(store, "solana"),
      readPayoutPause(store, "solana"),
      readOpenPayouts(store, "solana"),
      readAllReceipts(store, "solana"),
      readRewardsReserve(),
      readReserveLedger(store),
    ]);
    const config = rewardsTreasuryConfig();
    return json({
      ok: true,
      open: gate !== null,
      gate,
      pause: { paused: pause.paused, note: pause.record?.note ?? null, at: pause.record?.at ?? null },
      deciding: open.map((row) => ({ wallet: row.wallet, usdMicros: row.usdMicros, state: row.state, signature: row.signature, openedAt: row.openedAt })),
      canary: canary ? { state: canary.state, wallet: canary.wallet, usdMicros: canary.usdMicros, basis: canary.basis, signature: canary.signature, openedAt: canary.openedAt, resolvedAt: canary.resolvedAt, note: canary.note } : null,
      limits: { minUsdMicros: CANARY_MIN_USD_MICROS.toString(), maxUsdMicros: CANARY_MAX_USD_MICROS.toString() },
      treasury: config.configured
        ? { configured: true, address: config.treasury, mint: config.mint, canSign: config.canSign, state: reserve.state, usdMicros: reserve.usdMicros.toString(), freeUsdMicros: freeReserveUsdMicros({ treasuryUsdMicros: reserve.usdMicros, ledger, now }).toString() }
        : { configured: false },
      receipts: [...receipts].reverse(),
    });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const gate = await requireFreshMfa();
  if (!gate.ok) return json({ error: gate.reason }, gate.reason === "reverify" ? 403 : 401);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad json" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const store = getGuardRuntime().store;
  if (body.action === "pause" || body.action === "resume") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) return json({ error: "reason_required" }, 400);
    try {
      const done = await setPayoutPause(store, { network: "solana", paused: body.action === "pause", note, by: `admin:${gate.admin.telegramId}`, at: new Date().toISOString() });
      return done ? json({ ok: true }) : json({ error: "bad_request" }, 400);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }
  const usdMicros = usdToMicros(body.usd);
  if (usdMicros === null || typeof body.wallet !== "string" || typeof body.basis !== "string") return json({ error: "bad_request" }, 400);
  if (!storeSupportsConcurrentInstances(store)) return json({ error: "store_not_durable" }, 503);
  try {
    /* Never the treasury itself nor any address Ryntra keeps in its registry: a canary to one of them pays nobody. */
    const config = rewardsTreasuryConfig();
    const forbidden = new Set<string>([...ATTRIBUTION_REGISTRY.map((row) => row.address).filter((address): address is string => typeof address === "string"), ...(config.configured ? [config.treasury] : [])]);
    const out = await sendCanaryPayout(store, payoutDeps(), { wallet: body.wallet.trim(), usdMicros, basis: body.basis, requestedBy: `admin:${gate.admin.telegramId}`, forbidden });
    return json({ ok: out.state === "PAID", state: out.state, usdMicros: out.usdMicros ?? null, signature: out.signature ?? null }, out.state === "PAID" ? 200 : out.state === "INVALID" ? 400 : 409);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
