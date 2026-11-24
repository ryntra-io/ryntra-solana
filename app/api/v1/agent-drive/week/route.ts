import { z } from "zod";

import { readWeek } from "@/lib/agent-drive/drive.server";
import { DRIVE_OPEN } from "@/lib/agent-drive/flag";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mandateFailure, mandateHeaders, openMandate } from "@/lib/mandate/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The week prices what the agents hold at the venue: a read of each mandate. */
export const maxDuration = 30;

/**
 * `GET ?owner=&lang=` — a wallet's agents over the last seven days, as her bots show it: their trades, the SOL spent,
 * the result after every fee as the agent's own book counts it, and her closed trades with their «×» cards. Public data,
 * as the agent's own view is (`/api/bots/mandate/agent`): numbers and the person's own cards, never a key. `week: null`
 * — none of her agents traded this week. Reads only.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export async function GET(request: Request) {
  const gate = openMandate(request, "drive-week");
  if (gate instanceof Response) return gate;
  if (!DRIVE_OPEN) return mandateFailure(404, "DRIVE_CLOSED", "Not found.", gate.rate);
  const url = new URL(request.url);
  const owner = Base58.safeParse(url.searchParams.get("owner"));
  if (!owner.success) return mandateFailure(400, "VALIDATION_ERROR", "Not an address.", gate.rate);
  const lang = url.searchParams.get("lang") === "uk" ? "uk" : "en";
  try {
    const answer = await readWeek(owner.data, process.env, getGuardRuntime().store, lang);
    return Response.json(answer ?? { week: null, cards: [] }, { headers: mandateHeaders(gate.rate) });
  } catch {
    return mandateFailure(503, "UNAVAILABLE", "The week did not answer.", gate.rate);
  }
}
