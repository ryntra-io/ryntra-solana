import { z } from "zod";

import { agentReportOpen, REPORT_HOUR } from "@/city/lib/autopilot/report";
import { keepReport, readReport } from "@/city/lib/autopilot/report-watch";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CITY-194 — the agent's daily report, as the person keeps it: `GET ?owner=` — whether it is on and at which hour of her
 * day; `POST` — the city keeps her clock and language, and her one tap on or off (or another hour). Only the proven
 * wallet changes its own; a proof of another wallet changes nothing. Writes one row; signs, sends and trades nothing.
 * Closed where the city does not show the report (`NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open`) or the mandate is shut.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z
  .object({
    owner: Base58,
    timezone: z.string().min(1).max(64).optional(),
    locale: z.enum(["en", "uk"]).optional(),
    on: z.boolean().optional(),
    hour: z.number().int().min(0).max(23).optional(),
  })
  .strict();

const shown = (settings: Readonly<{ on: boolean; hour: number }> | null) => ({ on: settings?.on ?? true, hour: settings?.hour ?? REPORT_HOUR, kept: settings !== null });

export async function GET(request: Request) {
  const gate = openMandate(request, "report-read");
  if (gate instanceof Response) return gate;
  if (!agentReportOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT)) return mandateFailure(404, "REPORT_CLOSED", "Not found.", gate.rate);
  const owner = Base58.safeParse(new URL(request.url).searchParams.get("owner"));
  if (!owner.success) return mandateFailure(400, "VALIDATION_ERROR", "Not an address.", gate.rate);
  const settings = await readReport(getGuardRuntime().store, owner.data).catch(() => undefined);
  if (settings === undefined) return mandateFailure(503, "UNAVAILABLE", "The report did not answer.", gate.rate);
  return Response.json(shown(settings), { headers: mandateHeaders(gate.rate) });
}

export async function POST(request: Request) {
  const gate = openMandate(request, "report");
  if (gate instanceof Response) return gate;
  if (!agentReportOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT)) return mandateFailure(404, "REPORT_CLOSED", "Not found.", gate.rate);
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  if (body.owner !== proof.address) return mandateFailure(403, "FORBIDDEN", "Only the proven wallet keeps its report.", gate.rate);
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return mandateFailure(503, "UNAVAILABLE", "The report cannot be kept here now.", gate.rate);
  try {
    const kept = await keepReport(guard.store, body, Date.now());
    return Response.json(shown(kept), { headers: mandateHeaders(gate.rate) });
  } catch {
    return mandateFailure(503, "UNAVAILABLE", "The report cannot be kept here now. Try again in a moment.", gate.rate);
  }
}
