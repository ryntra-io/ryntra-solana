import type { AssistantPushLatest } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { listInbox } from "@/lib/monitoring/store";
import { isStopNote } from "@/lib/stops/notes";
import { isEarnNote } from "@/city/lib/earn/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A push wakes the browser within moments of its note; anything older is not what woke it. */
const FRESH_MS = 15 * 60_000;

/**
 * `GET /api/v1/assistant/push/latest` (contract 1.59.0) — what the service worker shows when an empty push wakes it:
 * the wallet's newest note of the last minutes, in its own words, and where it opens. The words travel from Ryntra to
 * the browser under the wallet's cookie, never through the push service. Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const nowMs = Date.now();
  const notes = await listInbox(getGuardRuntime().store, proof.address).catch(() => []);
  const newest = notes.find((note) => nowMs - Date.parse(note.createdAt) < FRESH_MS) ?? null;
  const body: AssistantPushLatest = {
    note: newest
      ? {
          id: newest.id,
          title: (newest.text?.[newest.locale]?.title ?? newest.title).slice(0, 200),
          body: (newest.text?.[newest.locale]?.reason ?? newest.reason).slice(0, 400),
          /* A reached stop (CITY-149) opens the city on its sale, an Earn note (CITY-100) Earn; every other note its own page. */
          href: isStopNote(newest) || isEarnNote(newest) ? newest.href : `/app/alerts/open?n=${encodeURIComponent(newest.id)}`,
        }
      : null,
  };
  return apiJson(body satisfies AssistantPushLatest, 200, { "cache-control": "private, no-store" });
}
