import { NextResponse } from "next/server";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { projectSeoInventory } from "@/lib/admin/insights";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const map = await sitemap();
  const bot = robots();
  const rules = bot.rules;
  const first = Array.isArray(rules) ? rules[0] : rules;
  const disallow = first?.disallow ?? [];
  return NextResponse.json({
    seo: projectSeoInventory({
      urls: map.map((entry) => ({ lastModified: entry.lastModified })),
      robotsDisallow: Array.isArray(disallow) ? disallow : [disallow],
    }),
  });
}
