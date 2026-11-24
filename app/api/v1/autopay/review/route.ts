import { apiJson, readApiBody } from "@/lib/api/v1/http";
import { ReviewSchema, autopayFailure, openAutopayRequest } from "@/lib/autopay/http.server";
import { reviewAutopay } from "@/lib/autopay/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/autopay/review` — the person's unsigned transactions for a new autopay: every payment moved
 * into the autopay's own vault and the one policy that lets the executor pay only the named address, only that amount,
 * once a window, until the end. The wallet signs them; nothing is sent here.
 */
export async function POST(request: Request) {
  const open = await openAutopayRequest(request, "mutation");
  if (open instanceof Response) return open;
  const read = await readApiBody(request, ReviewSchema, 2_048);
  if (!read.ok) return read.response;
  const body = read.body;
  const review = await reviewAutopay(
    { owner: open.owner, to: body.to, label: body.label ?? null, coin: body.coin, amount: body.amount, every: body.every, count: body.count, startAt: body.startAt ?? null, smartAccount: body.smartAccount ?? null },
    open.gate,
  ).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, reason: "The autopay could not be prepared. Try again." }));
  if (!review.ok) return autopayFailure(review);
  return apiJson(review);
}
