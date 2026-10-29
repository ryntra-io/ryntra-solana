import { DevKeyIssueRequestSchema, type DevKeyIssuedResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeDevWrite, devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { issueKey } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/developer/projects/{id}/keys` (1.83.0, DEV-2) — a credential, by a wallet whose role submits.
 *
 * A secret key's token is in this answer and in no other, ever: the store keeps a SHA-256 of it and the key's read
 * view has no field it could be put in. A public key has no secret at all — `issued.secret` is null — because its id
 * is the whole credential and what bounds it is the origins it names.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, DevKeyIssueRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const issued = await issueKey(served.deps, {
    projectId: id,
    wallet: proof.address,
    environment: read.body.environment,
    kind: read.body.kind,
    name: read.body.name,
    scopes: read.body.scopes,
    origins: read.body.origins ?? [],
  });
  if (!issued.ok) return devFailure(issued, rate.headers);
  return apiJson({ project: issued.project, issued: issued.issued } satisfies DevKeyIssuedResponse, 200, rate.headers);
}
