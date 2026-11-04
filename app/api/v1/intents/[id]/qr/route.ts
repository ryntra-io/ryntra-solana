import QRCode from "qrcode";

import { apiFailure, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { intentsOrRefusal } from "@/lib/intents/http.server";
import { INTENT_ID } from "@/lib/intents/model";
import { readIntent } from "@/lib/intents/service";
import { intentLinks, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/intents/{id}/qr` (1.90.0, CITY-161) — an SVG QR code of the intent's page, for a person to scan with
 * their phone. It encodes only Ryntra's own `https://…/i/<id>`, built from the id, never anything the creator sent.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = intentsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const id = (await params).id;
  if (!INTENT_ID.test(id)) return apiFailure("INTENT_NOT_FOUND", "No such intent.");
  const read = await readIntent(served.deps, id);
  if (!read.ok) return apiFailure(read.code, read.message, { headers: rateLimitHeaders(rate) });
  const svg = await QRCode.toString(intentLinks(id, publicIntentOrigin()).url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0b0a14", light: "#fff6e6" } });
  return new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, max-age=300", ...rateLimitHeaders(rate) } });
}
