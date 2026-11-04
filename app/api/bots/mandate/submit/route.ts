import { z } from "zod";

import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { relayMandate } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * CITY-174 — forward the person's signed mandate transactions to devnet, in order. Each is read before any is sent:
 * she pays, she alone signed, really, and only the smart account, token and system programs are called.
 * This route never signs: it has no key.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(2_000);
const BodySchema = z.object({ owner: Base58, items: z.array(Base64).min(1).max(3) }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "submit");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const relayed = await relayMandate(body, gate.network);
  if (!relayed.ok) return mandateFailure(422, relayed.code, relayed.reason, gate.rate);
  return Response.json({ network: gate.network, signatures: relayed.signatures }, { headers: mandateHeaders(gate.rate) });
}
