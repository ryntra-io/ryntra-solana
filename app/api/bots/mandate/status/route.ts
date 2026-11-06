import { mandateFailure, mandateHeaders, openMandate } from "@/lib/mandate/http.server";
import { mandateStatus } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CITY-174 — what stands now: `GET ?policy=…&vault=…` → whether the agent may act, and the budget left. CITY-196: only of
 * a real mandate of this agent — any other policy or vault is 404.
 */
export async function GET(request: Request) {
  const gate = openMandate(request, "status");
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  const read = await mandateStatus({ policy: url.searchParams.get("policy") ?? "", vault: url.searchParams.get("vault") ?? "" }, gate);
  if (!read.ok) return read.code === "not-addresses" ? mandateFailure(400, "VALIDATION_ERROR", "Not addresses.", gate.rate) : mandateFailure(404, "NOT_FOUND", "No such mandate.", gate.rate);
  return Response.json({ network: gate.network, ...read.status }, { headers: mandateHeaders(gate.rate) });
}
