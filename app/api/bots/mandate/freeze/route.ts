import { z } from "zod";

import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { setFrozen } from "@/lib/mandate/freeze.server";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CITY-70 — «Freeze» and «Resume»: `POST {owner, policy, frozen}` — the person's own switch over her agent's new actions.
 * On, the agent starts nothing new (a trade already on its way is still read back); off, it works again. Only the proven
 * wallet that owns the mandate turns it — the wallet's proof is one signed message, never a transaction. Writes one row of
 * the agent's book; signs, sends and moves nothing.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, policy: Base58, frozen: z.boolean() }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "freeze");
  if (gate instanceof Response) return gate;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  if (body.owner !== proof.address) return mandateFailure(403, "FORBIDDEN", "Only the proven wallet turns its own agent.", gate.rate);
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return mandateFailure(503, "UNAVAILABLE", "The switch cannot be kept here now.", gate.rate);
  try {
    const turned = await setFrozen(body, gate.network, { store: guard.store });
    if (!turned.ok) return mandateFailure(turned.code === "NOT_FOUND" ? 404 : 422, turned.code, turned.reason, gate.rate);
    return Response.json({ network: gate.network, frozen: turned.frozen }, { headers: mandateHeaders(gate.rate) });
  } catch {
    return mandateFailure(503, "UNAVAILABLE", "The switch cannot be kept here now. Try again in a moment.", gate.rate);
  }
}
