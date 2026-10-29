import { NextRequest, NextResponse } from "next/server";

import { requireFreshMfa } from "@/lib/admin/auth";
import { appendAdminAudit } from "@/lib/admin/store";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { executorStatus, flipExecutor, flipPeople, switchAdmitted } from "@/lib/launch/executor-admin.server";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession, getAdminSessionDetail } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Ryntra Launch's executor in the admin: its status (GET) and the operator's switch (POST) — stop or resume it on one
 * market or on every market. Every flip that changes what holds is a mark in the markets' flight logs, and an entry in
 * the admin's audit. No key or secret is read back.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: privateNoStoreHeaders() });
  const network = launchNetwork();
  if (!network) return NextResponse.json({ error: "launch_unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  try {
    return NextResponse.json(await executorStatus(network, getGuardRuntime().store), { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  /* A fresh second factor, or the operator's own door — the session the bot's Telegram link opened (`switchAdmitted`). */
  const gate = await requireFreshMfa();
  const admitted = switchAdmitted(gate, gate.ok ? null : await getAdminSessionDetail());
  if (!admitted) return NextResponse.json({ error: gate.ok ? "unauthorized" : gate.reason }, { status: !gate.ok && gate.reason === "reverify" ? 403 : 401, headers: privateNoStoreHeaders() });
  const network = launchNetwork();
  if (!network) return NextResponse.json({ error: "launch_unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400, headers: privateNoStoreHeaders() });
  }
  /* The budget and the ladder on people's Micro markets (SOL-L6): a switch of the whole network. */
  if (body.action === "people-open" || body.action === "people-close") return flipPeopleSwitch(network, admitted, body.action === "people-open");
  const action = body.action === "stop" || body.action === "resume" ? body.action : null;
  const token = body.token === null || body.token === undefined ? null : typeof body.token === "string" && MINT.test(body.token) ? body.token : undefined;
  if (!action || token === undefined) return NextResponse.json({ error: "bad params" }, { status: 400, headers: privateNoStoreHeaders() });
  const actor = admitted.telegramId;
  /* The audit names the door: a fresh second factor, or the Telegram link. */
  const payload = { action, scope: token ? "market" : "all", token, network: network.chain, door: admitted.door };
  await appendAdminAudit({ actorTelegramId: actor, action: "launch_executor_switch", outcome: "attempt", payload }).catch(() => false);
  try {
    const store = getGuardRuntime().store;
    const outcome = await flipExecutor(network, store, { token, stopped: action === "stop", by: `admin:${actor}` });
    if (outcome === "UNKNOWN_MARKET") {
      await appendAdminAudit({ actorTelegramId: actor, action: "launch_executor_switch", outcome: "rejected", reason: "unknown_market", payload }).catch(() => false);
      return NextResponse.json({ error: "unknown market" }, { status: 404, headers: privateNoStoreHeaders() });
    }
    await appendAdminAudit({ actorTelegramId: actor, action: "launch_executor_switch", outcome: "ok", payload: { ...payload, changed: outcome.changed, marked: outcome.marked.length } }).catch(() => false);
    return NextResponse.json({ ...outcome, status: await executorStatus(network, store) }, { headers: privateNoStoreHeaders() });
  } catch {
    await appendAdminAudit({ actorTelegramId: actor, action: "launch_executor_switch", outcome: "failed", payload }).catch(() => false);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}

/** The operator opens or closes the budget and the ladder on people's Micro markets; each flip in the admin's audit. */
async function flipPeopleSwitch(network: NonNullable<ReturnType<typeof launchNetwork>>, admitted: Readonly<{ telegramId: number; door: string }>, open: boolean) {
  const actor = admitted.telegramId;
  const payload = { action: open ? "people-open" : "people-close", network: network.chain, door: admitted.door };
  await appendAdminAudit({ actorTelegramId: actor, action: "launch_people_switch", outcome: "attempt", payload }).catch(() => false);
  try {
    const store = getGuardRuntime().store;
    const outcome = await flipPeople(network, store, { open, by: `admin:${actor}` });
    await appendAdminAudit({ actorTelegramId: actor, action: "launch_people_switch", outcome: "ok", payload: { ...payload, changed: outcome.changed } }).catch(() => false);
    return NextResponse.json({ ...outcome, marked: [], status: await executorStatus(network, store) }, { headers: privateNoStoreHeaders() });
  } catch {
    await appendAdminAudit({ actorTelegramId: actor, action: "launch_people_switch", outcome: "failed", payload }).catch(() => false);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
