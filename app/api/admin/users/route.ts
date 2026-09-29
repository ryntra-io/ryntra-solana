import { NextRequest, NextResponse } from "next/server";

import { readUserActivity, readUsersPage } from "@/lib/admin/activity";
import { isAccessMutation, isGlobalBetaMode } from "@/lib/admin/access";
import { mutateUserAccess, readAccessControls, readBetaMode, setBetaMode } from "@/lib/admin/store";
import {
  pageLegacyUsers,
  parseUsersQuery,
  projectAdminUser,
  projectAdminUserFromPage,
  type RawAdminUser,
} from "@/lib/admin/users";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { requireFreshMfa } from "@/lib/admin/auth";
import { rpcOrNull } from "@/lib/supabase-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_LIMIT = 500;

/**
 * GET ?q=&filter=&sort=&dir=&page=&size= — a page with a real total.
 * GET ?detail=<telegram_id> — one account's login and activity timeline.
 *
 * With the activity store applied the database filters, sorts and pages;
 * before that the legacy list is paged in memory and the response says so,
 * with the login columns marked not collected rather than blank.
 */
export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;

  const detail = params.get("detail");
  if (detail !== null) {
    const key = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail)
      ? { accountId: detail.toLowerCase() }
      : Number.isSafeInteger(Number(detail)) && Number(detail) > 0
        ? { telegramId: Number(detail) }
        : null;
    if (!key) return NextResponse.json({ error: "bad params" }, { status: 400 });
    const read = await readUserActivity(key);
    if (read.status === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (read.status === "unavailable") return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json(read.status === "measured" ? { activity: "measured", detail: read.activity } : { activity: "not_collected", detail: null });
  }

  const query = parseUsersQuery(params);
  const mode = await readBetaMode();

  const page = await readUsersPage({
    query: query.query,
    filter: query.filter,
    sort: query.sort,
    dir: query.dir,
    offset: (query.page - 1) * query.size,
    limit: query.size,
  });

  if (page.status === "measured") {
    return NextResponse.json({
      mode,
      activity: "measured",
      query,
      total: page.total,
      capped: false,
      rows: page.rows.map(projectAdminUserFromPage),
    });
  }

  /* Store missing or failing: the legacy list still answers. A failing store
     on top of a working legacy list is reported as such, not hidden. */
  const [users, controls] = await Promise.all([
    rpcOrNull<RawAdminUser[]>("admin", "admin_users_list", { p_query: query.query, p_limit: LEGACY_LIMIT }),
    readAccessControls(),
  ]);
  if (!users) return NextResponse.json({ error: "admin data unavailable" }, { status: 503 });
  const projected = users.map((row) =>
    projectAdminUser({
      ...row,
      access_control: controls[row.telegram_id]
        ? { state: controls[row.telegram_id].state, expires_at: controls[row.telegram_id].expires_at }
        : null,
    }),
  );
  const paged = pageLegacyUsers(projected, query, { capped: users.length >= LEGACY_LIMIT });
  return NextResponse.json({
    mode,
    activity: page.status,
    query,
    total: paged.total,
    capped: paged.capped,
    rows: paged.rows,
  });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireFreshMfa();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.reason === "reverify" ? 403 : 401 });
  const admin = gate.admin.telegramId;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (body.action === "mode") {
    if (!isGlobalBetaMode(body.mode) || typeof body.reason !== "string") {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }
    const result = await setBetaMode({ actorTelegramId: admin, mode: body.mode, reason: body.reason });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, mode: body.mode });
  }
  const telegramId = typeof body.telegram_id === "number" ? body.telegram_id : null;
  if (!telegramId || !isAccessMutation(body.mutation) || typeof body.reason !== "string") {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }
  const result = await mutateUserAccess({
    actorTelegramId: admin,
    targetTelegramId: telegramId,
    mutation: body.mutation,
    reason: body.reason,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, state: result.state });
}
