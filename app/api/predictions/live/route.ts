import { readLiveAccess } from "@/lib/predictions/live";
import { predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { readPaperAccount } from "@/lib/predictions/paper";
import { listRedeemReceipts, redeemable } from "@/lib/predictions/redeem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Live trading as it stands for the wallet: whether it is open here, on
 * which venues and up to what amount, and — only when it is open to this
 * wallet — the live account (the managed balance, live positions and
 * orders, Ryntra's live records), what can be collected now, and the
 * payout receipts. A wallet live trading is not open to gets the state
 * alone; nothing of the provider is read for it.
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const access = await readLiveAccess(actor.provider, actor.wallet);
  if (access.state === "off") return predictionJson({ wallet: actor.wallet, access, account: null, redeemable: [], receipts: [] });
  const account = await readPaperAccount(actor.store, actor.provider, actor.wallet, "live");
  const receipts = await listRedeemReceipts(actor.store, actor.wallet);
  return predictionJson({ wallet: actor.wallet, access, account, redeemable: redeemable([...account.positions, ...account.closedPositions]), receipts });
}
