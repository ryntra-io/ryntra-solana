import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/session";
import { listAdminAudit } from "@/lib/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await listAdminAudit(100);
  if (!rows) return NextResponse.json({ error: "admin data unavailable" }, { status: 503 });
  return NextResponse.json({ rows });
}
