import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { cctpMintAuthorized, cctpShouldPollAgain, fetchCctpAttestation } from "@/lib/solana/cctp-attestation";
import { markCctpAttested, markCctpBurnConfirmed, readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { cctpLaneFacts, isChainTransactionId } from "@/lib/solana/cctp-direction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask Circle about one burn, and record an attestation when there is one.
 *
 * Reads only. Every not-ready answer — HTTP 404, an empty message list, a
 * message still awaiting confirmations — comes back as a waiting state with the
 * interval Circle asks for, and none of them can be mistaken for an absent
 * burn. That distinction is the whole point: a client that concluded the burn
 * never happened would invite a second one.
 *
 * The direction comes from the durable claim, never from the request. Circle
 * indexes a burn under the domain it left from, so asking the wrong domain
 * returns a clean 404 — which this route correctly reports as *not indexed yet*
 * and would therefore poll for ever. The one thing that knows which way this
 * transfer goes is the record written when it was claimed.
 *
 * `iris-api.circle.com` refuses some networks at its edge, which is why this
 * runs on the server rather than in the browser: the deployment reaches Circle
 * where a developer machine may not.
 */

const RequestSchema = z
  .object({
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    /* Either chain's identifier. Which one is right is settled by the claim
       below, not by whichever shape happened to be posted. */
    burnSignature: z.union([
      z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
      z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    ]),
    expect: z
      .object({
        /* Solana 5, Base 6, Ethereum 0 — the three domains this product bridges between. */
        destinationDomain: z.union([z.literal(5), z.literal(6), z.literal(0)]),
        mintRecipient: z.string().regex(/^0x[0-9a-f]{64}$/),
        amountRaw: z.string().regex(/^[1-9][0-9]*$/).max(20),
      })
      .strict(),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  const input = parsed.data;

  const store = getGuardRuntime().store;
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  if (claim.record.burnSignature !== input.burnSignature) {
    return bridgeFailure(
      409,
      "BURN_SIGNATURE_MISMATCH",
      "That signature is not the burn this intent recorded.",
      rate,
    );
  }

  const direction = claim.record.direction;
  const lane = cctpLaneFacts(direction);
  if (!isChainTransactionId(lane.source.chain, input.burnSignature)) {
    return bridgeFailure(
      409,
      "BURN_SIGNATURE_MISMATCH",
      `That identifier is not a ${lane.source.label} transaction, and this transfer left ${lane.source.label}.`,
      rate,
    );
  }
  /* The expectation has to be about this lane's destination. A caller asking
     Circle to match a message against the other chain's domain would get a
     clean "no matching message" for a transfer that is proceeding perfectly. */
  if (input.expect.destinationDomain !== lane.destination.domain) {
    return bridgeFailure(
      409,
      "DIRECTION_MISMATCH",
      `This transfer arrives on ${lane.destination.label}, so it cannot be matched against the other chain.`,
      rate,
    );
  }

  const lookup = await fetchCctpAttestation({
    direction,
    transactionHash: input.burnSignature,
    expect: input.expect,
  });

  let recorded = false;
  if (cctpMintAuthorized(lookup) && lookup.attested) {
    /*
     * Circle signing a message is proof the burn landed and succeeded — the
     * message only exists because the programme emitted it, and the programme
     * only ran because the transaction executed. So an attestation is enough to
     * close a confirmation the burn route could not wait for.
     *
     * Without this the slow path dead-ends: a burn that took longer to confirm
     * than the submit route's window stays SUBMITTED_UNKNOWN forever, the
     * attested transition is refused, and the destination mint has no nonce to
     * work from — a stuck transfer produced entirely by our own bookkeeping.
     */
    if (claim.record.state === "BURN_SUBMITTED_UNKNOWN") {
      await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: input.intentDigest });
    }
    const marked = await markCctpAttested({
      store,
      network: "mainnet",
      intentDigest: input.intentDigest,
      messageNonce: lookup.attested.nonce,
    });
    recorded = marked.ok;
  }

  return Response.json(
    {
      data: {
        direction,
        attestation: lookup,
        recorded,
        shouldPollAgain: cctpShouldPollAgain(lookup),
        claimState: claim.record.state,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}
