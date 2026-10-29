import { xApi } from "@/city/lib/x/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The day's report of the X publisher, for an operator signed in to the admin: `?day=YYYY-MM-DD` (today by default). */
export async function GET(req: Request) {
  return xApi().report(req);
}
