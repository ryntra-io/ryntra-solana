/**
 * Ryntra Solana Evidence Kit — the typed SDK.
 *
 * Three calls, one job each: read what a mint structurally is, preview an
 * exact SPL transfer against a declared policy, and check an Outcome Receipt
 * without asking the party that wrote it. Everything here is read-only by
 * construction — this package builds no transaction, holds no key, and calls
 * no state-changing RPC method. `boundaries.test.mjs` asserts that by reading
 * the shipped sources rather than by trusting this paragraph.
 *
 * The evidence core is imported, not copied. `lib/solana/` is the one
 * implementation the Ryntra product itself runs on, and the public extraction
 * carries those exact files — so a result from this SDK and a result from
 * ryntra.io come from the same code, or the extraction is broken and its
 * tests say so.
 */

import { SplTransferInputSchema, type SplTransferInput } from "../../../lib/agent-control/adapters/solana-token-2022.ts";
import {
  SolanaOwnerPolicySchema,
  type SolanaAssetPassportContract,
  type SolanaOwnerPolicy,
  type SolanaPolicyVerdict,
  type SplTransferPreflight,
} from "../../../lib/solana/contracts.ts";
import { buildTransferPreflight } from "../../../lib/solana/preflight.ts";
import { evaluateOwnerPolicy } from "../../../lib/solana/policy.ts";
import { buildPassport } from "../../../lib/solana/passport.ts";
import { readMintAccount } from "../../../lib/solana/mint.ts";
import { createSolanaRpcHandle, ENV_OVERRIDES, resolveEndpoint, SOLANA_NETWORKS, type SolanaNetwork } from "../../../lib/solana/rpc.ts";
import {
  verifySolanaOutcomeReceipt,
  type SolanaReceiptVerification,
} from "../../../lib/solana/receipt.ts";
import type { SolanaAssetPassport } from "../../../lib/solana/types.ts";

export type {
  SolanaAssetPassport,
  SolanaAssetPassportContract,
  SolanaNetwork,
  SolanaOwnerPolicy,
  SolanaPolicyVerdict,
  SolanaReceiptVerification,
  SplTransferInput,
  SplTransferPreflight,
};
export { SOLANA_NETWORKS, ENV_OVERRIDES, resolveEndpoint, SolanaOwnerPolicySchema, SplTransferInputSchema };
export { SOLANA_PROVENANCE } from "../../../lib/solana/types.ts";
export { POLICY_RULE_IDS, POLICY_VERDICTS, PUBLISHED_CONTRACTS } from "../../../lib/solana/contracts.ts";
export { parseHumanAmount, scaleRawAmount } from "../../../lib/solana/amounts.ts";
export {
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SPL_TRANSFER_ACTION_REF,
  SOLANA_CAIP2,
} from "../../../lib/agent-control/adapters/solana-token-2022.ts";

/**
 * What this kit structurally cannot do. Exported as data so a surface built
 * on it can render the boundary instead of retyping it and drifting.
 */
export const SOLANA_EVIDENCE_KIT_LIMITATIONS = [
  "READ-ONLY EVIDENCE — NOT A WALLET AND NOT AN EXECUTOR",
  "No key is held, no transaction is built or signed, and no state-changing RPC method is called.",
  "A policy verdict reports the absence of known blockers under a declared policy. It is not a safety judgement and endorses nothing.",
] as const;

export type SolanaEvidenceFailureCode =
  | "ACCOUNT_NOT_FOUND"
  | "NOT_A_MINT"
  | "DECODE_FAILED"
  | "RPC_FAILED"
  | "INVALID_INPUT"
  | "INVALID_POLICY"
  | "INPUT_MINT_MISMATCH"
  | "MINT_NOT_INITIALIZED"
  | "ZERO_AMOUNT"
  | "SENDER_RECIPIENT_SAME";

export type SolanaEvidenceFailure = Readonly<{
  ok: false;
  code: SolanaEvidenceFailureCode;
  reason: string;
}>;

export type SolanaConnection = Readonly<{
  network?: SolanaNetwork;
  /** Explicit endpoint wins over the env override, which wins over the public default. */
  endpoint?: string;
  timeoutMs?: number;
  /** Additional attempts after the first transport failure. Never for an answer. */
  retries?: number;
}>;

function handleFor(connection: SolanaConnection) {
  return createSolanaRpcHandle({
    network: connection.network ?? "mainnet",
    endpoint: connection.endpoint,
    timeoutMs: connection.timeoutMs,
    retries: connection.retries,
  });
}

export type InspectSolanaMintResult =
  | Readonly<{ ok: true; passport: SolanaAssetPassport }>
  | SolanaEvidenceFailure;

/**
 * Read one mint and return its Asset Passport.
 *
 * The passport is a function of the account bytes and nothing else, so the
 * same account always produces the same passport — which is what makes an
 * independent re-read a check rather than a second opinion. Never throws:
 * a mint that does not exist, is not a mint, or did not decode comes back as
 * a value with its reason.
 */
export async function inspectSolanaMint(
  mint: string,
  connection: SolanaConnection = {},
): Promise<InspectSolanaMintResult> {
  const read = await readMintAccount(handleFor(connection), mint);
  if (!read.ok) return read;
  const built = buildPassport(read.raw);
  if (!built.ok) return built;
  return { ok: true, passport: built.passport };
}

export type PreflightSolanaActionResult =
  | Readonly<{
      ok: true;
      passport: SolanaAssetPassport;
      preflight: SplTransferPreflight;
      verdict: SolanaPolicyVerdict;
    }>
  | SolanaEvidenceFailure;

/**
 * Preview an exact SPL transfer and judge it against a declared policy.
 *
 * The two halves stay separate on purpose. The preflight states what will
 * happen — fee math from the mint's own configuration, what the recipient
 * actually receives, which structural facts doom the transfer. The verdict
 * states what the *owner's policy* makes of that, and its floor is
 * `NO_KNOWN_BLOCKER`, never "safe".
 *
 * `epoch` selects between a mint's two transfer-fee configurations. Omitting
 * it uses the newer one and records that choice in the preflight rather than
 * hiding it in a default.
 */
export async function preflightSolanaAction(
  args: Readonly<{
    input: SplTransferInput;
    policy: SolanaOwnerPolicy;
    epoch?: bigint | null;
    now?: Date;
    connection?: SolanaConnection;
  }>,
): Promise<PreflightSolanaActionResult> {
  const parsedInput = SplTransferInputSchema.safeParse(args.input);
  if (!parsedInput.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: parsedInput.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  const parsedPolicy = SolanaOwnerPolicySchema.safeParse(args.policy);
  if (!parsedPolicy.success) {
    return {
      ok: false,
      code: "INVALID_POLICY",
      reason: parsedPolicy.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  const input = parsedInput.data;

  /* The evidence is read on the network the proposal names, not on whatever
     the caller's connection happened to default to: a preview against the
     wrong chain would be exact about the wrong thing. */
  const read = await readMintAccount(
    handleFor({ ...(args.connection ?? {}), network: input.network }),
    input.mint,
  );
  if (!read.ok) return read;

  const built = buildPassport(read.raw);
  if (!built.ok) return built;

  const preflight = buildTransferPreflight({
    read,
    passport: built.passport,
    input,
    epoch: args.epoch ?? null,
    now: args.now,
  });
  if (!preflight.ok) return preflight;

  return {
    ok: true,
    passport: built.passport,
    preflight: preflight.preflight,
    verdict: evaluateOwnerPolicy({
      policy: parsedPolicy.data,
      input,
      passport: built.passport,
      preflight: preflight.preflight,
      now: args.now,
    }),
  };
}

/**
 * Verify an Outcome Receipt offline, on four separate axes.
 *
 * Nothing here reaches the network and nothing asks Ryntra: the hashes are
 * recomputed from the receipt's own bytes and the Ed25519 signature is checked
 * against the key the receipt carries. Supplying `trustedPublicKeys` is what
 * turns "this signature is sound" into "this signature is one of these keys'";
 * without it the issuer axis says so rather than implying the stronger claim.
 */
export function verifySolanaReceipt(
  receipt: unknown,
  options: Readonly<{ trustedPublicKeys?: readonly string[] }> = {},
): SolanaReceiptVerification {
  return verifySolanaOutcomeReceipt(receipt, options);
}

/**
 * A cautious starting policy: quote anything, accept no issuer power.
 *
 * Deliberately an example rather than a recommendation — a policy is the
 * owner's declaration, and a default that nobody chose is how a product ends
 * up deciding for its users. It is the stance the Ryntra workspace itself
 * renders, exported here so an integrator has a working shape to edit.
 */
const cautiousPolicy: SolanaOwnerPolicy = {
  schema: "ryntra.solana.owner-policy",
  schemaVersion: "0.1.0",
  allowedNetworks: ["mainnet", "devnet"],
  allowedMints: "ANY",
  allowedTokenPrograms: ["SPL_TOKEN", "TOKEN_2022"],
  acceptPermanentDelegate: false,
  transferHookAllowlist: "NONE_ALLOWED",
  maxFeeBasisPoints: 100,
  maxFeeRaw: null,
  recipientAllowlist: "ANY",
  maxAmountRaw: null,
  maxEvidenceAgeSeconds: 300,
  acceptDefaultFrozenAccounts: false,
  requireHumanApproval: false,
};

/* Annotated first, then frozen: an object literal passed straight into
   `Object.freeze` loses its contextual type, so every enum array widens to
   `string[]` and the assignment fails three lines later. The public CI found
   this before any reader did. */
export const EXAMPLE_CAUTIOUS_POLICY: SolanaOwnerPolicy = Object.freeze(cautiousPolicy);
