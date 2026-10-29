import { DevKeyActionRequestSchema, type DevKeyIssuedResponse, type DevProjectResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeDevWrite, devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { changeKey, revokeKey, rotateKey } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/developer/projects/{id}/keys/{keyId}` (1.83.0, DEV-2) — one credential's life, by a wallet whose role
 * submits: `rotate` (a successor whose token is shown once here, the predecessor on a clock of `graceHours` — 0 ends
 * it at once), `revoke` (it stops answering from the next request on, with nothing cached anywhere), `change` (its
 * scopes, and for a public key the origins it answers from).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, DevKeyActionRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id, keyId } = await context.params;

  if (read.body.action === "rotate") {
    const rotated = await rotateKey(served.deps, { projectId: id, wallet: proof.address, keyId, graceHours: read.body.graceHours });
    if (!rotated.ok) return devFailure(rotated, rate.headers);
    return apiJson({ project: rotated.project, issued: rotated.issued } satisfies DevKeyIssuedResponse, 200, rate.headers);
  }
  const changed =
    read.body.action === "revoke"
      ? await revokeKey(served.deps, { projectId: id, wallet: proof.address, keyId })
      : await changeKey(served.deps, { projectId: id, wallet: proof.address, keyId, scopes: read.body.scopes, origins: read.body.origins });
  if (!changed.ok) return devFailure(changed, rate.headers);
  return apiJson({ project: changed.project } satisfies DevProjectResponse, 200, rate.headers);
}
