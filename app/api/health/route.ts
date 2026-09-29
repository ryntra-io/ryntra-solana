import { NextRequest } from "next/server";
import { dbPing } from "@/lib/beta/rpc";
import { getMarkets } from "@/lib/arcus/public";
import { tg } from "@/lib/telegram/api";
import { createHealthHandler } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health endpoint for external monitors and quick diagnostics.
 *
 * - No credentials: 200 public liveness with no upstream calls.
 * - Valid Bearer: deep DB, Arcus, and Telegram checks.
 * - DB or Telegram down: 503. Arcus alone down: 200 degraded.
 * - Wrong/malformed Authorization or any legacy ?key=: 401.
 *
 * External providers must use a dedicated HEALTH_SECRET. CRON_SECRET remains a
 * compatibility fallback for trusted first-party callers and must never be
 * shared with a monitor provider. Every response is no-store. Authorized
 * responses include scope="deep", preventing a missing header from passing as
 * authenticated deep health.
 */
export async function GET(req: NextRequest) {
  return createHealthHandler({
    healthSecret: process.env.HEALTH_SECRET,
    cronSecret: process.env.CRON_SECRET,
    checks: {
      db: dbPing,
      arcus: async () => (await getMarkets()).length > 0,
      telegram: async () => (await tg<{ id: number }>("getMe", {})) != null,
    },
  })(req);
}
