import type { NextRequest } from "next/server";

import { serveLaunchCard } from "../../serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `/t/<8>/image?v=…&l=uk` — the token's card a preview shows, beside its short address (SOL-L1e; `../../serve.ts`). */
export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return serveLaunchCard(req, slug);
}
