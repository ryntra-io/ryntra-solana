import { DeviceRegistrationRequestSchema } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { ownerDevices, registerDevice } from "@/lib/monitoring/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const devices = await ownerDevices(getGuardRuntime().store, proof.address);
  return apiJson({ devices: devices.map((row) => ({ deviceId: row.deviceId, platform: row.platform, appVersion: row.appVersion, locale: row.locale, registeredAt: row.registeredAt })) });
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, DeviceRegistrationRequestSchema, 8_192);
  if (!body.ok) return body.response;
  const registered = await registerDevice(getGuardRuntime().store, proof.address, body.body, Date.now());
  return apiJson(registered);
}
