import { DevEndpointCreateRequestSchema, type DevEndpointCreatedResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeDevWrite, devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { createEndpoint } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/developer/projects/{id}/endpoints` (1.83.0, DEV-2) — where signed deliveries go. Drafting one needs
 * `draft`; it is made **off**, so turning it on is a separate act that needs `submit`. The signing secret is in this
 * answer once: the server keeps it because it signs with it, and no read view carries it again.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, DevEndpointCreateRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const made = await createEndpoint(served.deps, { projectId: id, wallet: proof.address, environment: read.body.environment, url: read.body.url, events: read.body.events });
  if (!made.ok) return devFailure(made, rate.headers);
  return apiJson({ project: made.project, endpoint: made.endpoint, secret: made.secret, shownOnce: true } satisfies DevEndpointCreatedResponse, 200, rate.headers);
}
