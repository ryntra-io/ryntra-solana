import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mutationOriginAllowed } from "@/lib/security";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { fetchCctpAttestation } from "@/lib/solana/cctp-attestation";
import { markCctpMintObserved, readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { SOLANA_ADDRESS_PATTERN } from "@/lib/solana/cctp-direction";
import { checkCctpSignedReceive } from "@/lib/solana/cctp-receive-check";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { sendTransactionOnce, SolanaSubmitRpcError } from "@/lib/solana/submit-rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const ROUTE_DEADLINE_MS = 50_000;
const CONFIRM_ATTEMPTS = 25;
const CONFIRM_INTERVAL_MS = 1_000;

/**
 * The only route that submits the Solana side of a Base-to-Solana transfer.
 *
 * It is the mirror of the burn route and it is deliberately less anxious than
 * one, because the two steps are not equally dangerous. A burn destroys value
 * and a second one is a second real loss. A destination replay is idempotent —
 * the transmitter's `used_nonce` account makes a second submission fail rather
 * than pay twice — and it credits the account the signed message names whoever
 * sends it. So there is no second boundary to hold here.
 *
 * What is still checked, and checked from sources a caller cannot choose:
 *
 * - the transfer exists, is heading to Solana, and has an attestation recorded;
 * - the message being submitted is the one **Circle** signed, fetched here
 *   rather than accepted from the request;
 * - the signed transaction receives exactly that message into exactly the
 *   account it names, and calls nothing else unfamiliar;
 * - it is submitted **once**, and confirmation is read from an operator that
 *   did not submit it.
 */

const RequestSchema = z
  .object({
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    payer: z.string().regex(SOLANA_ADDRESS_PATTERN),
    recipientOwner: z.string().regex(SOLANA_ADDRESS_PATTERN),
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(12_000),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return bridgeFailure(403, "FORBIDDEN_ORIGIN", "This step must be requested from this site.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  const input = parsed.data;

  const store = getGuardRuntime().store;
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  if (claim.record.direction !== "BASE_TO_SOLANA" && claim.record.direction !== "ETHEREUM_TO_SOLANA") {
    return bridgeFailure(409, "DIRECTION_MISMATCH", "That transfer does not arrive on Solana.", rate);
  }
  const burnHash = claim.record.burnSignature;
  const nonce = claim.record.messageNonce;
  if (!burnHash || !nonce) {
    return bridgeFailure(
      409,
      "ATTESTATION_NOT_RECORDED",
      "No attested message is recorded for this transfer, so there is nothing to submit.",
      rate,
    );
  }
  if (claim.record.destinationWallet && claim.record.destinationWallet !== input.recipientOwner) {
    return bridgeFailure(
      409,
      "RECIPIENT_MISMATCH",
      "This transfer is for a different wallet from the one given here.",
      rate,
    );
  }

  /* Circle's own copy of the message, fetched here. Taking the bytes from the
     request would mean the one thing this route checks the signature against
     was chosen by the caller that produced the signature. */
  const attestation = await fetchCctpAttestation({ direction: claim.record.direction, transactionHash: burnHash });
  if (attestation.state !== "ATTESTED" || !attestation.attested) {
    return bridgeFailure(
      409,
      "ATTESTATION_NOT_READY",
      "Circle has not returned a signed message for this transfer right now, so nothing was submitted.",
      rate,
    );
  }
  if (attestation.attested.nonce.toLowerCase() !== nonce.toLowerCase()) {
    return bridgeFailure(
      409,
      "MESSAGE_MISMATCH",
      "Circle returned a different message from the one recorded for this transfer.",
      rate,
    );
  }

  let recipientTokenAccount: string;
  try {
    recipientTokenAccount = await associatedTokenAccount({
      owner: input.recipientOwner,
      mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
      tokenProgram: SOLANA_TOKEN_PROGRAM,
    });
  } catch (cause) {
    return bridgeFailure(
      422,
      "RECIPIENT_INVALID",
      `The receiving USDC account could not be derived: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }

  const check = checkCctpSignedReceive({
    signedWireBase64: input.signedTransactionBase64,
    payer: input.payer,
    messageHex: attestation.attested.messageHex,
    attestationHex: attestation.attested.attestationHex,
    recipientTokenAccount,
  });
  if (check.verdict !== "CLEARED") {
    return bridgeFailure(409, `SIGNED_${check.verdict}`, check.detail, rate);
  }

  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const independent = createIndependentReadHandle(handle);

  /* The exact returned bytes, executed without effect before they are sent. A
     replay whose account set drifted, or whose recipient account was closed
     since the plan was built, fails here rather than costing a fee to discover. */
  try {
    const simulated = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(input.signedTransactionBase64 as never, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
        })
        .send({ abortSignal }),
    );
    if (simulated.value.err !== null && simulated.value.err !== undefined) {
      return bridgeFailure(
        409,
        "RECEIVE_SIMULATION_FAILED",
        `This step does not succeed in simulation, so nothing was sent: ${JSON.stringify(simulated.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
        rate,
      );
    }
  } catch (cause) {
    return bridgeFailure(
      503,
      "RECEIVE_SIMULATION_UNAVAILABLE",
      `The cluster would not simulate this step, so what it would do is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }

  const deadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  let signature: string;
  try {
    signature = await sendTransactionOnce({
      handle,
      signedWireBase64: input.signedTransactionBase64,
      deadlineAt,
    });
  } catch (cause) {
    if (cause instanceof SolanaSubmitRpcError) {
      /* A proven rejection. The cluster answered and refused, so nothing was
         submitted — and because the replay is idempotent this is safe to try
         again from a fresh plan, unlike a burn. */
      return bridgeFailure(409, "RECEIVE_REJECTED", `The cluster rejected this step: ${cause.message}`, rate);
    }
    return bridgeFailure(
      502,
      "RECEIVE_UNKNOWN",
      "This step was handed to the network and the answer was lost. Read whether it arrived before sending it again.",
      rate,
    );
  }

  /* Confirmation from the operator that did not submit it, bounded, and a
     landed-but-failed transaction is still confirmed. */
  const reader = independent ?? handle;
  let confirmation: "CONFIRMED" | "PENDING" = "PENDING";
  let slot: string | null = null;
  let landedError: string | null = null;
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS && Date.now() < deadlineAt; attempt += 1) {
    try {
      const statuses = await withRpcDiscipline(reader, (abortSignal) =>
        reader.rpc
          .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
          .send({ abortSignal }),
      );
      const status = statuses.value[0];
      if (status) {
        confirmation = "CONFIRMED";
        slot = String(status.slot);
        landedError =
          status.err === null || status.err === undefined
            ? null
            : JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        break;
      }
    } catch {
      /* An unreadable status is not an unlanded transaction. */
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
  }

  let recorded = false;
  if (confirmation === "CONFIRMED" && landedError === null) {
    const marked = await markCctpMintObserved({
      store,
      network: "mainnet",
      intentDigest: input.intentDigest,
      mintTransactionHash: signature,
    });
    recorded = marked.ok;
  }

  return Response.json(
    {
      data: {
        signature,
        confirmation,
        slot,
        landedError,
        recipientTokenAccount,
        companionPrograms: check.companionPrograms,
        observedBy: reader.endpoints[0].host,
        recorded,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}
