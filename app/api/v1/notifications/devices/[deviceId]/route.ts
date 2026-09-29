import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { revokeDevice } from "@/lib/monitoring/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: Readonly<{ params: Promise<{ deviceId: string }> }>) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { deviceId } = await params;
  if (!/^dev_[0-9a-f]{24}$/.test(deviceId)) return apiFailure("VALIDATION_ERROR", "Not a device.");
  const ok = await revokeDevice(getGuardRuntime().store, proof.address, deviceId, Date.now());
  if (!ok) return apiFailure("VALIDATION_ERROR", "No such device for this wallet.");
  return apiJson({ ok: true });
}
