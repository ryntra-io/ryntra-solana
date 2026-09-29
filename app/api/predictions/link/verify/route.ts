import bs58 from "bs58";
import { z } from "zod";

import { failure } from "@/lib/predictions/failure";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { verifyLink } from "@/lib/predictions/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z
  .object({
    message: z.string().min(40).max(4_096),
    signature: z.string().min(16).max(512),
    encoding: z.enum(["base64", "base58"]).optional(),
  })
  .strict();

/**
 * Step two: the signed message goes to the provider, which verifies the
 * signature over its own nonce and answers a session for the wallet's user
 * (created on first use). The server checks that the message names the
 * proven wallet and that the provider holds that wallet, links the stable
 * Ryntra id with the app secret (or records that the key is missing), and
 * seals the tokens in the store. The browser receives the link state and
 * never a token.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  let signature = read.body.signature;
  if ((read.body.encoding ?? "base64") === "base64") {
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64) return predictionFailure(failure("SIGNATURE_INVALID", "A Solana signature is 64 bytes."));
    signature = bs58.encode(bytes);
  }
  const linked = await verifyLink(actor.store, actor.provider, actor.wallet, { message: read.body.message, signature });
  if (!linked.ok) return predictionFailure(linked);
  return predictionJson({ wallet: actor.wallet, link: linked.value });
}
