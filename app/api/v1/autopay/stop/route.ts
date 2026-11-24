import { apiJson, readApiBody } from "@/lib/api/v1/http";
import { StopSchema, autopayFailure, openAutopayRequest } from "@/lib/autopay/http.server";
import { reviewStop, submitStop } from "@/lib/autopay/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/autopay/stop` — stop an autopay and take the rest back. With `{ id }` alone: the person's one
 * unsigned transaction — the policy removed, the vault's rest to their wallet. With `{ id, transaction }`: that
 * transaction signed, relayed once; the book says «stopped» when the chain no longer carries the policy.
 */
export async function POST(request: Request) {
  const open = await openAutopayRequest(request, "mutation");
  if (open instanceof Response) return open;
  const read = await readApiBody(request, StopSchema, 8_192);
  if (!read.ok) return read.response;
  const { id, transaction } = read.body;
  const unavailable = { ok: false as const, code: "UNAVAILABLE" as const, reason: "The autopay could not be stopped. Try again." };
  if (!transaction) {
    const review = await reviewStop({ owner: open.owner, id }, open.gate).catch(() => unavailable);
    return review.ok ? apiJson(review) : autopayFailure(review);
  }
  const result = await submitStop({ owner: open.owner, id, transaction }, open.gate).catch(() => unavailable);
  return result.ok ? apiJson(result) : autopayFailure(result);
}
