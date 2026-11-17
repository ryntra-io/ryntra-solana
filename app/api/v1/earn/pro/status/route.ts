import { EarnProStatusRequestSchema, type EarnProStatusResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { earnProSignatureStates } from "@/lib/earn-pro/actions.server";
import { openEarnProDoor } from "@/lib/earn-pro/http.server";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/earn/pro/status` — the chain's word on signatures a relay sent: landed,
 * failed, or not seen yet. For an answer lost on the way back — a signature with no answer is asked about here, never
 * called «nothing happened» and never sent again.
 */
export async function POST(request: Request) {
  const door = await openEarnProDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = EarnProStatusRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "A status read takes the signatures.", { headers });
  const states = await earnProSignatureStates(parsed.data.signatures);
  if (!states) return apiFailure("UNAVAILABLE", "The chain did not answer. Ask again.", { headers });
  return apiJson({ states: states.map((state) => ({ state: state.state, reason: state.reason?.slice(0, 240) ?? null })) } satisfies EarnProStatusResponse, 200, headers);
}
