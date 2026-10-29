import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { predictionsLocale } from "@/lib/predictions/locale.server";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";
import { sweepSettlement } from "@/lib/predictions/settle-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settlement as it stands for the wallet: when each open market of theirs is
 * decided, which are due within the day, which are overdue or disputed, the
 * payouts on their way in with their receipts, and the notes.
 *
 * A read follows the payouts already asked for and writes what happened; it
 * asks for nothing new, so looking at the page never starts a payment.
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const swept = await sweepSettlement(actor.store, actor.provider, actor.wallet, process.env, Date.now(), {
    ask: false,
    locale: await predictionsLocale(),
    transports: predictionTransports(actor.store),
  });
  return swept.ok ? predictionJson(swept.value) : predictionFailure(swept);
}

/**
 * *Collect what is due now* — the same pass the operator's sweep runs, for
 * the person's own wallet: every decided market the provider marks payable
 * is asked for under its one request id. Pressing it twice, or pressing it
 * while the sweep runs, asks for nothing twice.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const swept = await sweepSettlement(actor.store, actor.provider, actor.wallet, process.env, Date.now(), {
    locale: await predictionsLocale(),
    transports: predictionTransports(actor.store),
  });
  return swept.ok ? predictionJson(swept.value) : predictionFailure(swept);
}
