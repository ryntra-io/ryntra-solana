import { z } from "zod";

import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { readWatchlist, setWatch } from "@/lib/predictions/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Body = z
  .object({
    eventId: Id,
    watched: z.boolean(),
    venueMarketId: Id.nullable().optional(),
    outcomeLabel: z.string().max(64).nullable().optional(),
    probabilityAtWatch: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  return predictionJson({ wallet: actor.wallet, entries: await readWatchlist(actor.store, actor.wallet) });
}

/** Watch or unwatch one event; the leading probability at that moment is kept with it. */
export async function PUT(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const { eventId, watched, venueMarketId, outcomeLabel, probabilityAtWatch } = read.body;
  const entries = await setWatch(
    actor.store,
    actor.wallet,
    { eventId, venueMarketId: venueMarketId ?? null, outcomeLabel: outcomeLabel ?? null, probabilityAtWatch: probabilityAtWatch ?? null },
    watched,
  );
  if (!entries.ok) return predictionFailure(entries);
  return predictionJson({ wallet: actor.wallet, entries: entries.value });
}
