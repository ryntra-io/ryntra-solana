import { apiJson, readApiBody } from "@/lib/api/v1/http";
import { SubmitSchema, autopayFailure, openAutopayRequest } from "@/lib/autopay/http.server";
import { submitAutopay } from "@/lib/autopay/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/autopay/submit` — the person's signed transactions for a draft: each read and relayed once,
 * in order; the book keeps the autopay only when the chain carries its policy with the draft's numbers.
 */
export async function POST(request: Request) {
  const open = await openAutopayRequest(request, "mutation");
  if (open instanceof Response) return open;
  const read = await readApiBody(request, SubmitSchema, 16_384);
  if (!read.ok) return read.response;
  const result = await submitAutopay({ owner: open.owner, draft: read.body.draft, transactions: read.body.transactions }, open.gate).catch(
    () => ({ ok: false as const, code: "UNAVAILABLE" as const, reason: "The autopay could not be sent. Try again." }),
  );
  if (!result.ok) return autopayFailure(result);
  return apiJson(result);
}
