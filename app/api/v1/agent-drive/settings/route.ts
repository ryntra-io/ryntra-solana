import { DRIVE_OPEN } from "@/lib/agent-drive/flag";
import { driveSettingsOf, DriveSettingsChangeSchema, keepDriveSettings, settingsView } from "@/lib/agent-drive/settings";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the person hears of her agent, and where: `GET` — her switches (each kind of note, Telegram, the phone) as kept,
 * or all on; `POST` — her change. Only the proven wallet reads and keeps its own — the proof is one signed message,
 * never a transaction. Closed where the drive is not shown (`NEXT_PUBLIC_RYNTRA_AGENT_DRIVE=open`) or the mandate is
 * shut. Writes one row; signs, sends and trades nothing.
 */

export async function GET(request: Request) {
  const gate = openMandate(request, "drive-settings-read");
  if (gate instanceof Response) return gate;
  if (!DRIVE_OPEN) return mandateFailure(404, "DRIVE_CLOSED", "Not found.", gate.rate);
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const settings = await driveSettingsOf(getGuardRuntime().store, proof.address).catch(() => null);
  if (!settings) return mandateFailure(503, "UNAVAILABLE", "The settings did not answer.", gate.rate);
  return Response.json(settingsView(settings), { headers: mandateHeaders(gate.rate) });
}

export async function POST(request: Request) {
  const gate = openMandate(request, "drive-settings");
  if (gate instanceof Response) return gate;
  if (!DRIVE_OPEN) return mandateFailure(404, "DRIVE_CLOSED", "Not found.", gate.rate);
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readMandateBody(request, DriveSettingsChangeSchema, gate.rate);
  if (body instanceof Response) return body;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return mandateFailure(503, "UNAVAILABLE", "The settings cannot be kept here now.", gate.rate);
  try {
    const kept = await keepDriveSettings(guard.store, proof.address, body, Date.now());
    return Response.json(settingsView(kept), { headers: mandateHeaders(gate.rate) });
  } catch {
    return mandateFailure(503, "UNAVAILABLE", "The settings cannot be kept here now. Try again in a moment.", gate.rate);
  }
}
