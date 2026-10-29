/**
 * What the prediction money routes take, kept apart from the route files so
 * the tests check the very rules the routes run: the request bodies of the
 * withdrawal preview and the withdrawal — strict, so a body that names a
 * destination (or anything else the contract does not hold) is refused, the
 * destination being always the proven wallet — and the wallet a proof may
 * act for: a Solana wallet only, an EVM proof the shared reader still
 * accepts is refused.
 */

import { z } from "zod";

import { failure, type PredictionFailure } from "./failure.ts";

const RAW = z.string().regex(/^\d{1,18}$/);

/** A withdrawal priced now: an exact amount, or the most that can be delivered. */
export const WithdrawPreviewBodySchema = z.union([z.object({ amountRaw: RAW }).strict(), z.object({ max: z.literal(true) }).strict()]);

/** The person confirmed the Review. */
export const WithdrawBodySchema = z
  .object({
    /** Made by the browser when the Review opened; the same confirmation sent again carries the same id. */
    requestId: z.string().uuid(),
    amountRaw: RAW,
    reviewedReceiveRaw: RAW,
    reviewedFeeRaw: RAW.nullable(),
  })
  .strict();

/** The wallet a proven request acts for: a Solana one, or the refusal. */
export function predictionProofWallet(proof: Readonly<{ chain: string; address: string }>): Readonly<{ ok: true; wallet: string }> | PredictionFailure {
  if (proof.chain !== "solana") return failure("UNAUTHORIZED", "Sign in with a Solana wallet.");
  return { ok: true, wallet: proof.address };
}
