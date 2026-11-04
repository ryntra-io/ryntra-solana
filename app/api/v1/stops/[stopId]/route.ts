import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { StopPatchSchema } from "@/lib/stops/schema";
import { stopsApi } from "@/lib/stops/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Readonly<{ params: Promise<{ stopId: string }> }>;

/** Let the wallet's stop go (CITY-149). A change: the wallet's own signature (Sign In With Solana). */
export async function DELETE(request: Request, { params }: Params) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { stopId } = await params;
  const answer = await stopsApi().cancel(proof.address, stopId);
  return apiJson(answer.body, answer.status);
}

/** `{ "state": "done" }`: the reached stop's sale settled in the person's wallet. */
export async function PATCH(request: Request, { params }: Params) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, StopPatchSchema, 256);
  if (!body.ok) return body.response;
  const { stopId } = await params;
  const answer = await stopsApi().finish(proof.address, stopId);
  return apiJson(answer.body, answer.status);
}
