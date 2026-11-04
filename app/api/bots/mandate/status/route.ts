import { mandateFailure, mandateHeaders, openMandate } from "@/lib/mandate/http.server";
import { mandateStatus } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CITY-174 — what stands now, on devnet: `GET ?policy=…&vault=…` → whether the agent may act, and the budget left. */
export async function GET(request: Request) {
  const gate = openMandate(request, "status");
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  const status = await mandateStatus({ policy: url.searchParams.get("policy") ?? "", vault: url.searchParams.get("vault") ?? "" }, gate.network);
  if (!status) return mandateFailure(400, "VALIDATION_ERROR", "Not addresses.", gate.rate);
  return Response.json({ network: gate.network, ...status }, { headers: mandateHeaders(gate.rate) });
}
