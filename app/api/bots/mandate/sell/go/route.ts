import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { agentKeyFor } from "@/lib/mandate/agent-service.server";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { goSale, saleVenueOf } from "@/lib/mandate/sale.server";
import { mandateConnection } from "@/lib/mandate/service.server";
import { agentJournal } from "@/lib/mandate/tick.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CITY-187 — the person signed her sale: `POST` her wallet and the sale's mandate; once the chain has it, the agent sells
 * now — on devnet the pool's swap with Ryntra's fee before it, on mainnet Jupiter's route with the fee inside (CITY-195) —
 * judged and signed by the agent's own signer, and the answer is the receipt. Where the deployment has no agent key, the
 * sale waits for the cron's pass. Public data only.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, policy: Base58 }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "sell-go");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const store = getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return mandateFailure(503, "UNAVAILABLE", "The agent's book is not kept here.", gate.rate);
  const connection = mandateConnection(gate.network);
  const gone = await goSale(body, { gate, store, connection, key: agentKeyFor(process.env, gate), journal: agentJournal(() => store), venue: saleVenueOf(connection, gate) }).catch(() => null);
  if (!gone) return mandateFailure(503, "UNAVAILABLE", "The network did not answer.", gate.rate);
  if (!gone.ok) return mandateFailure(gone.code === "NOT_FOUND" ? 404 : 409, gone.code, gone.reason, gate.rate);
  return Response.json({ network: gate.network, ...gone.receipt }, { headers: mandateHeaders(gate.rate) });
}
