import { NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { readLaunchImage } from "@/lib/launch/metadata.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/launch/image/<sha256>` — a launched token's picture, its address
 * the sha256 of its bytes: cached for a year, immutable, open to any origin.
 * Served as the type its own bytes are, never sniffed further.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const stored = await readLaunchImage(getGuardRuntime().store, id).catch(() => null);
  if (!stored) return new NextResponse("not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new NextResponse(new Uint8Array(Buffer.from(stored.base64, "base64")), {
    status: 200,
    headers: {
      "content-type": stored.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
