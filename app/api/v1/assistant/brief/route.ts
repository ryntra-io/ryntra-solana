import { AssistantBriefUpdateSchema, type AssistantBriefResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readBriefSurface, updateBriefSettings } from "@/lib/assistant/brief/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localeOf = (request: Request): "en" | "uk" => (new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en");
/** `?day=2026-10-18` — a note's link: that day's brief when it was delivered. */
const dayOf = (request: Request): string | null => new URL(request.url).searchParams.get("day");

/**
 * `GET /api/v1/assistant/brief` — «Ранковий огляд» of the proven wallet
 * (contract 1.46.0): whether it is on, its time and zone, when the next one
 * comes, where it goes and the latest brief, in the language asked
 * (`?locale=uk`). Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The morning brief needs a durable store; this deployment does not have one.");
  return apiJson((await readBriefSurface(guard.store, proof.address, Date.now(), localeOf(request), dayOf(request))) satisfies AssistantBriefResponse);
}

/**
 * `PUT /api/v1/assistant/brief` — turn the brief on or off and set its time
 * (a quarter hour), zone and language. Writes only the wallet's own settings;
 * the answer is the same read as `GET`.
 */
export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantBriefUpdateSchema, 1_024);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The morning brief needs a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const written = await updateBriefSettings(guard.store, proof.address, read.body, nowMs);
  if (!written.ok) return apiFailure(written.code, written.reason);
  return apiJson((await readBriefSurface(guard.store, proof.address, nowMs, localeOf(request))) satisfies AssistantBriefResponse);
}
