import { DevEndpointActionRequestSchema, type DevEndpointActionResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeDevWrite, devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { changeEndpoint, readProject, sendTestDelivery, verifyDelivery } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/developer/projects/{id}/endpoints/{endpointId}` (1.83.0, DEV-2) — turning an endpoint on or off, the
 * events it takes, a new signing secret (the old one signs beside it for one window, so a receiver mid-deploy keeps
 * verifying), removal, a test delivery, and `verify`.
 *
 * `verify` is the one that matters for a replay: a receiver hands back the body and headers it got, and the server
 * checks the signature, the timestamp against the window, and the delivery's id against the ones this endpoint has
 * already had verified. The third check is why a second copy of a genuine delivery is refused — the signature over
 * the same bytes is correct for ever.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; endpointId: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevWrite(request.headers);
  if (!rate.ok) return rate.response;
  const read = await readApiBody(request, DevEndpointActionRequestSchema, 32_768);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id, endpointId } = await context.params;
  const body = read.body;

  if (body.action === "test" || body.action === "verify") {
    const answer =
      body.action === "test"
        ? await sendTestDelivery(served.deps, { projectId: id, wallet: proof.address, endpointId })
        : await verifyDelivery(served.deps, { projectId: id, wallet: proof.address, endpointId, body: body.body, headers: body.headers });
    if (!answer.ok) return devFailure(answer, rate.headers);
    const project = await readProject(served.deps, { id, wallet: proof.address });
    if (!project.ok) return devFailure(project, rate.headers);
    const shaped: DevEndpointActionResponse =
      "delivery" in answer
        ? { project: project.project, secret: null, delivery: { id: answer.delivery.id, endpointId: answer.delivery.endpointId, event: answer.delivery.event, at: answer.delivery.at, state: answer.delivery.state, attempts: answer.delivery.attempts, status: answer.delivery.status, error: answer.delivery.error }, verification: null }
        : { project: project.project, secret: null, delivery: null, verification: { verified: answer.verified, refusal: answer.refusal, deliveryId: answer.deliveryId } };
    return apiJson(shaped, 200, rate.headers);
  }

  const changed = await changeEndpoint(served.deps, {
    projectId: id,
    wallet: proof.address,
    endpointId,
    ...(body.action === "enable" ? { enabled: true } : {}),
    ...(body.action === "disable" ? { enabled: false } : {}),
    ...(body.action === "events" ? { events: body.events } : {}),
    ...(body.action === "rotateSecret" ? { rotateSecret: true } : {}),
    ...(body.action === "remove" ? { remove: true } : {}),
  });
  if (!changed.ok) return devFailure(changed, rate.headers);
  return apiJson({ project: changed.project, secret: changed.secret, delivery: null, verification: null } satisfies DevEndpointActionResponse, 200, rate.headers);
}
