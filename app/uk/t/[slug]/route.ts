import type { NextRequest } from "next/server";

import { serveLaunchShort } from "@/app/t/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `/uk/t/<8>` — the token's short address, its preview in Ukrainian (SOL-L1e). */
export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return serveLaunchShort(req, slug, null, "uk");
}
