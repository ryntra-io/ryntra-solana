import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { markInboxRead, readMonitoringSurface } from "@/lib/monitoring/service.server";
import { preferencesOf, readPreferences } from "@/lib/monitoring/store";
import { isValidQuietHours } from "@/lib/monitoring/quiet-hours";
import { QUIET_HOURS_REFUSAL, readMonitoringWrite } from "@/lib/monitoring/write-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const locale = request.headers.get("accept-language")?.startsWith("uk") ? "uk" : "en";
  const store = getGuardRuntime().store;
  const surface = await readMonitoringSurface(store, proof.address, Date.now(), locale);
  const preferences = await readPreferences(store, proof.address);
  return apiJson({ ...surface, preferences: { telegram: preferences.telegram, push: preferences.push, quietHours: preferences.quietHours } });
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiFailure("VALIDATION_ERROR", "A JSON body is required.");
  }
  /* 1.11.0: the body is one the contract names — a read mark, or where notes go with each field of its own type (lib/monitoring/write-request.ts). */
  const body = readMonitoringWrite(raw);
  if (body.kind === "invalid") return apiFailure("VALIDATION_ERROR", body.message);
  const store = getGuardRuntime().store;
  if (body.kind === "read") {
    const ok = await markInboxRead(store, proof.address, body.id);
    if (!ok) return apiFailure("VALIDATION_ERROR", "No such note.");
    return apiJson({ ok: true });
  }
  const current = await readPreferences(store, proof.address);
  const quietHours = body.quietHours === undefined ? current.quietHours : body.quietHours;
  if (quietHours && !isValidQuietHours(quietHours)) return apiFailure("VALIDATION_ERROR", QUIET_HOURS_REFUSAL);
  const at = new Date().toISOString();
  await preferencesOf(store).compareAndSet(`solana:mainnet:${proof.address}`, current.version === 0 ? null : current.version, {
    version: current.version + 1,
    owner: proof.address,
    inbox: true,
    telegram: body.telegram ?? current.telegram,
    push: body.push ?? current.push,
    quietHours,
    updatedAt: at,
  });
  return apiJson({ ok: true });
}
