import { apiJson } from "@/lib/api/v1/http";
import { autopayFailure, openAutopayRequest } from "@/lib/autopay/http.server";
import { listAutopays } from "@/lib/autopay/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/autopay` — the proven wallet's autopays: each one's recipient, amount, rhythm, end and the
 * payment of every window so far. Closed where `RYNTRA_AUTOPAY` names no network (`CAPABILITY_UNAVAILABLE`).
 */
export async function GET(request: Request) {
  const open = await openAutopayRequest(request, "read");
  if (open instanceof Response) return open;
  const read = await listAutopays(open.owner, open.gate).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, reason: "The autopays could not be read. Try again." }));
  if (!read.ok) return autopayFailure(read);
  return apiJson({ address: open.owner, network: open.gate.network, executor: open.gate.agent.toBase58(), autopays: [...read.autopays] });
}
