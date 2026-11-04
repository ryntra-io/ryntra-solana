import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { StopCreateSchema } from "@/lib/stops/schema";
import { stopsApi } from "@/lib/stops/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A new stop asks the swap engine's quote once, to refuse a stop that is already reached. */
export const maxDuration = 30;

/**
 * The proven wallet's stops on spot (CITY-149): the list, and a new one. A read takes the wallet's proof; a new stop
 * takes the wallet's own signature (Sign In With Solana) — never a linked wallet. The engine keeps the intent and
 * watches it with the swap engine's quote; when it is reached the person is told, and their wallet signs the sale.
 * Nothing here signs, sends or holds a key.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const answer = await stopsApi().list(proof.address);
  return apiJson(answer.body, answer.status);
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, StopCreateSchema, 2_048);
  if (!body.ok) return body.response;
  const answer = await stopsApi().create(proof.address, body.body);
  return apiJson(answer.body, answer.status);
}
