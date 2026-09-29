import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { planBaseCctpMint } from "@/lib/base/cctp-mint";
import { createEvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { cctpLaneFacts, EVM_ADDRESS_PATTERN, SOLANA_ADDRESS_PATTERN } from "@/lib/solana/cctp-direction";
import { decodeCctpV2Message } from "@/lib/solana/cctp-message";
import { planSolanaCctpReceive } from "@/lib/solana/cctp-receive-plan";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Prepare the destination step. Nothing is sent from here.
 *
 * Circle does not deliver a Standard transfer, so something has to replay the
 * message on the far chain. This route builds that exact step for whichever
 * chain the transfer is arriving on, prices it, and reports whether the
 * submitting wallet can pay — all before a wallet opens, because a failing
 * transaction spends money to learn what a read could have said for nothing.
 *
 * The replay guard is asked first on both sides. A message already received
 * needs no transaction at all, and offering one would be offering to waste
 * money.
 *
 * ## Which chain, decided by the record and not by the request
 *
 * The direction lives on the durable claim. A caller cannot ask for the Solana
 * step on a transfer heading to Base, and the message the wallet would be shown
 * is built from the lane the transfer was actually claimed under.
 */

const RequestSchema = z
  .object({
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    /* The wallet that will submit and pay, on whichever chain that is. */
    from: z.union([z.string().regex(EVM_ADDRESS_PATTERN), z.string().regex(SOLANA_ADDRESS_PATTERN)]),
    messageHex: z.string().regex(/^0x[0-9a-fA-F]+$/).max(8_192),
    attestationHex: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4_096),
    /** The Solana wallet the money is for. Only a Solana destination has one. */
    recipientOwner: z.string().regex(SOLANA_ADDRESS_PATTERN).optional(),
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

  const claim = await readCctpBurnClaim({
    store: getGuardRuntime().store,
    network: "mainnet",
    intentDigest: input.intentDigest,
  });
  if (!claim.ok) return bridgeFailure(409, claim.code, claim.reason, rate);
  const nonce = claim.record.messageNonce;
  if (!nonce) {
    return bridgeFailure(
      409,
      "ATTESTATION_NOT_RECORDED",
      "No attestation is recorded for this transfer yet, so there is no message to submit.",
      rate,
    );
  }
  const direction = claim.record.direction;
  const lane = cctpLaneFacts(direction);

  if (lane.destination.chain !== "solana") {
    if (!EVM_ADDRESS_PATTERN.test(input.from)) {
      return bridgeFailure(
        400,
        "VALIDATION_ERROR",
        `This transfer arrives on ${lane.destination.label}, so it is submitted from a ${lane.destination.label} address.`,
        rate,
      );
    }
    /* The chain the claim says the money is arriving on. Base or Ethereum. */
    const handle = createEvmRpcHandle(lane.evmChain);
    const plan = await planBaseCctpMint(handle, {
      from: input.from,
      nonce,
      messageHex: input.messageHex,
      attestationHex: input.attestationHex,
    });
    return Response.json(
      { data: { direction, destinationChain: lane.destination.chain, plan, claimState: claim.record.state } },
      { headers: bridgeHeaders(rate) },
    );
  }

  if (!SOLANA_ADDRESS_PATTERN.test(input.from)) {
    return bridgeFailure(
      400,
      "VALIDATION_ERROR",
      "This transfer arrives on Solana, so it is submitted from a Solana wallet.",
      rate,
    );
  }
  /* The recipient the burn actually named, and the source token behind it, are
     read out of the signed message rather than taken from the request. The
     replay writes into the account the message names; a request that could
     nominate a different one would be a request to send somebody else's money
     somewhere else. */
  const decoded = decodeCctpV2Message(input.messageHex);
  if (!decoded.ok) {
    return bridgeFailure(422, `MESSAGE_${decoded.code}`, decoded.reason, rate);
  }
  if (decoded.message.header.nonce.toLowerCase() !== nonce.toLowerCase()) {
    return bridgeFailure(
      409,
      "MESSAGE_MISMATCH",
      "That message is not the one Circle signed for this transfer.",
      rate,
    );
  }
  if (!decoded.message.burn) {
    return bridgeFailure(422, "MESSAGE_NOT_A_TRANSFER", "That message does not carry a token transfer.", rate);
  }
  const recipientOwner = input.recipientOwner ?? claim.record.destinationWallet;
  if (!recipientOwner) {
    return bridgeFailure(
      409,
      "RECIPIENT_UNKNOWN",
      "The wallet this transfer is for is not recorded, so the receiving account cannot be checked.",
      rate,
    );
  }

  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const plan = await planSolanaCctpReceive(handle, {
    payer: input.from,
    recipientOwner,
    sourceDomain: decoded.message.header.sourceDomain,
    remoteTokenHex: decoded.message.burn.burnToken,
    nonce,
    messageHex: input.messageHex,
    attestationHex: input.attestationHex,
    destinationCallerHex: decoded.message.header.destinationCaller,
  });

  /* The account the message names has to be the account this plan will credit.
     They are derived from different places on purpose — one from the signed
     message, one from the wallet the person says the money is for — and a
     disagreement means the burn named something else entirely. */
  if (
    plan.recipientTokenAccount &&
    decoded.message.burn.mintRecipient.toLowerCase() !== `0x${solanaAddressToHex(plan.recipientTokenAccount)}`
  ) {
    return bridgeFailure(
      409,
      "RECIPIENT_MISMATCH",
      "The transfer names a different receiving account from the wallet given here, so nothing was prepared.",
      rate,
    );
  }

  return Response.json(
    { data: { direction, destinationChain: lane.destination.chain, plan, claimState: claim.record.state } },
    { headers: bridgeHeaders(rate) },
  );
}

/** A base58 Solana address as the thirty-two hex bytes a CCTP message carries. */
function solanaAddressToHex(value: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let big = 0n;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) return "";
    big = big * 58n + BigInt(index);
  }
  let hex = big.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let leading = 0;
  for (const character of value) {
    if (character !== "1") break;
    leading += 1;
  }
  return `${"00".repeat(leading)}${hex}`.padStart(64, "0");
}
