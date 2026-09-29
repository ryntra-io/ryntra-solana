import { healExternalIdLink } from "@/lib/predictions/link";
import { requirePredictionActor, predictionJson } from "@/lib/predictions/http";
import { readPaperAccount } from "@/lib/predictions/paper";
import { listPredictionPlans } from "@/lib/predictions/plan";
import { readWatchlist } from "@/lib/predictions/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The wallet's paper account (`RYN-PREDICTIONS-001`): the link state, the
 * paper balance, positions and orders as the provider states them, Ryntra's
 * own order records reconciled, the watchlist and the plans. An external-id
 * link that could not be made at sign-in is retried here once the signing
 * key exists. The same route for the web (proof cookie) and the phone (bearer).
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  await healExternalIdLink(actor.store, actor.provider, actor.wallet).catch(() => null);
  /* Store reads one after another: a single-connection stand (PGlite behind a socket) resets on concurrent queries, and three reads in sequence cost nothing here. */
  const account = await readPaperAccount(actor.store, actor.provider, actor.wallet);
  const watchlist = await readWatchlist(actor.store, actor.wallet);
  const plans = await listPredictionPlans(actor.store, actor.wallet);
  return predictionJson({ wallet: actor.wallet, ...account, watchlist, plans });
}
