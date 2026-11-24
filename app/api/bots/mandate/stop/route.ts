import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { mandateFailure, mandateHeaders, openMandate, ownerProof, readMandateBody } from "@/lib/mandate/http.server";
import { askedStop, stopSale } from "@/lib/mandate/exit.server";
import { stopTidy } from "@/lib/mandate/sale.server";
import { mandateConnection, reviewStop } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** How long her stop waits for the wallet's proof before it is built without marking the agent's sales held. */
const PROOF_WAIT_MS = 1_500;

/**
 * Stop the agent and take the rest back: `POST` the person's wallet, her smart account and the policy; the
 * answer is one unsigned transaction of hers. The same transaction tidies up: her sold sales' mandates
 * removed, the vault's empty account of the coin closed, her wSOL unwrapped — every rent back to her. This route never signs.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, settings: Base58, policy: Base58 }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "stop");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const store = getGuardRuntime().store;
  const connection = mandateConnection(gate.network);
  /*
   * The sale's policy of an agent that sells on its own goes in the same signature — found on chain beside the
   * buy's, the book's word only checked against it; the agent's address names whose sale it is once the buy's is gone.
   */
  /*
   * Building her stop marks it asked — the agent then starts no sale but her stop's that could land first. Only
   * from her own proven wallet (the lead's review of #1972): the stop itself is built for anyone who names her public
   * addresses, as before, but a stranger's request must not hold the agent's sales again every two minutes.
   */
  /* The proof is read beside the stop's build and never longer than `PROOF_WAIT_MS`: a slow session store never holds her stop. */
  const proven = ownerProof(request, body.owner, gate.rate).then(
    (refused) => refused === null,
    () => false,
  );
  const waited = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROOF_WAIT_MS));
  const book = storeSurvivesColdStart(store)
    ? {
        tidy: stopTidy({ store, connection, network: gate.network }),
        sale: stopSale({ store, network: gate.network }),
        asked: async (policy: Parameters<ReturnType<typeof askedStop>>[0]) => {
          if (await Promise.race([proven, waited])) await askedStop({ store, network: gate.network })(policy);
        },
      }
    : {};
  const review = await reviewStop(body, gate.network, connection, { ...book, agent: gate.agent });
  if (!review.ok) return mandateFailure(review.code === "VALIDATION_ERROR" ? 400 : review.code === "UNAVAILABLE" ? 503 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, transactions: review.transactions, returnLamports: review.fundLamports }, { headers: mandateHeaders(gate.rate) });
}
