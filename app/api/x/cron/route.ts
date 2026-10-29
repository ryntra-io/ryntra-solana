import { xApi } from "@/city/lib/x/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The X publisher's pass, every 10 minutes (vercel.json, CITY-39): in an open slot of the day it posts the oldest
 * approved draft, once. Called by Vercel's cron with `CRON_SECRET`; anything else is refused. Without the owner's
 * switch and keys it answers `not_connected` and touches nothing.
 */
export async function GET(req: Request) {
  return xApi().cron(req);
}
