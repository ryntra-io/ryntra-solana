import type { NextRequest } from "next/server";

import { serveLaunchShort } from "../../serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `/t/<8>/<code>` — a launched token's short address with the sharer's referral code (SOL-L1e; `../../serve.ts`). */
export async function GET(req: NextRequest, context: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await context.params;
  return serveLaunchShort(req, slug, code, "en");
}
