import { verifyTypedData, type Address, type Hex } from "viem";

/**
 * The human authorization axis: EIP-712, signed in an owner-controlled wallet.
 *
 * **Ryntra never produces one of these.** It builds the typed structure, shows
 * it, and checks what comes back. The private key stays in the wallet and the
 * only thing that reaches this codebase is 65 bytes of signature — which is the
 * product's central claim, so it is asserted by a test over this source rather
 * than promised in a comment.
 *
 * EIP-712 rather than a personal_sign over a digest, for one reason that
 * matters more than convenience: the wallet renders the fields. A person
 * approving an action sees the exact content hash, their own address, the nonce
 * and the expiry. A signature made blind over `0x7f3a…` is not an
 * authorization; it is a person agreeing to something they could not read.
 *
 * The proof binds `contentHash` and not the whole artifact, because Release B
 * put the two proof axes outside the hash they attest to. A hash that covered
 * the proof could never be the hash the proof was made over.
 */

export const AGENT_AUTHORIZATION_DOMAIN_NAME = "Ryntra Agent Control" as const;
export const AGENT_AUTHORIZATION_DOMAIN_VERSION = "2.0.0" as const;
export const AGENT_AUTHORIZATION_PRIMARY_TYPE = "AgentAuthorization" as const;

export const AGENT_AUTHORIZATION_TYPES = {
  AgentAuthorization: [
    { name: "contentHash", type: "bytes32" },
    { name: "subject", type: "address" },
    { name: "nonce", type: "string" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

const HEX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export type AgentAuthorizationChallenge = Readonly<{
  domain: Readonly<{ name: string; version: string; chainId: number }>;
  primaryType: typeof AGENT_AUTHORIZATION_PRIMARY_TYPE;
  types: typeof AGENT_AUTHORIZATION_TYPES;
  message: Readonly<{
    contentHash: Hex;
    subject: Address;
    nonce: string;
    expiresAt: bigint;
  }>;
}>;

export function buildAgentAuthorizationChallenge(input: {
  contentHash: string;
  subject: string;
  nonce: string;
  expiresAt: Date;
  chainId: number;
}): AgentAuthorizationChallenge {
  if (!HEX_HASH.test(input.contentHash)) throw new Error("The content hash must be a lowercase 32-byte hex digest.");
  if (!ADDRESS.test(input.subject)) throw new Error("The subject must be a 20-byte address.");
  if (input.nonce.length < 8 || input.nonce.length > 128) throw new Error("The nonce must be 8-128 characters.");
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new Error("The chain id must be a positive integer.");

  return {
    domain: {
      name: AGENT_AUTHORIZATION_DOMAIN_NAME,
      version: AGENT_AUTHORIZATION_DOMAIN_VERSION,
      chainId: input.chainId,
    },
    primaryType: AGENT_AUTHORIZATION_PRIMARY_TYPE,
    types: AGENT_AUTHORIZATION_TYPES,
    message: {
      contentHash: input.contentHash as Hex,
      subject: input.subject as Address,
      nonce: input.nonce,
      expiresAt: BigInt(Math.floor(input.expiresAt.getTime() / 1_000)),
    },
  };
}

export const AUTHORIZATION_REFUSALS = [
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_NONCE_REPLAYED",
  "AUTHORIZATION_CONTENT_MISMATCH",
  "AUTHORIZATION_SIGNER_MISMATCH",
  "AUTHORIZATION_MALFORMED",
] as const;

export type AuthorizationRefusal = (typeof AUTHORIZATION_REFUSALS)[number];

export type AuthorizationCheck = Readonly<
  | { ok: true; subject: Address }
  | { ok: false; reasonCode: AuthorizationRefusal; detail: string }
>;

/**
 * Check one authorization against the artifact it claims to authorize.
 *
 * `claimNonce` is a function rather than a set, and it must *claim* rather than
 * test: reading "this nonce is free" and then recording it is a race, and two
 * simultaneous submissions of the same signature would both pass. Block A's
 * store provides exactly that primitive, so the caller passes it in and this
 * module stays free of storage.
 */
export async function verifyAgentAuthorization({
  proof,
  contentHash,
  chainId,
  claimNonce,
  now = new Date(),
}: {
  proof: { subjectRef: string; contentHash: string; nonce: string; expiresAt: string; signature: string };
  contentHash: string;
  chainId: number;
  claimNonce: (nonce: string) => Promise<boolean>;
  now?: Date;
}): Promise<AuthorizationCheck> {
  if (!ADDRESS.test(proof.subjectRef) || !SIGNATURE.test(proof.signature) || !HEX_HASH.test(proof.contentHash)) {
    return { ok: false, reasonCode: "AUTHORIZATION_MALFORMED", detail: "the proof is not the declared shape" };
  }

  /* Ordered so the cheapest and most decisive refusals come first, and so a
     replayed nonce is never claimed for a proof that was going to fail anyway.
     Binding before expiry, because a proof over the wrong artifact is wrong
     whatever its expiry says. */
  if (proof.contentHash !== contentHash) {
    return {
      ok: false,
      reasonCode: "AUTHORIZATION_CONTENT_MISMATCH",
      detail: "the proof authorizes a different artifact",
    };
  }

  const expiresAt = Date.parse(proof.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, reasonCode: "AUTHORIZATION_MALFORMED", detail: "the expiry is not a timestamp" };
  }
  if (expiresAt <= now.getTime()) {
    return { ok: false, reasonCode: "AUTHORIZATION_EXPIRED", detail: "the authorization expired before it was used" };
  }

  const challenge = buildAgentAuthorizationChallenge({
    contentHash: proof.contentHash,
    subject: proof.subjectRef,
    nonce: proof.nonce,
    expiresAt: new Date(expiresAt),
    chainId,
  });

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: challenge.message.subject,
      domain: { ...challenge.domain },
      types: challenge.types,
      primaryType: challenge.primaryType,
      message: { ...challenge.message },
      signature: proof.signature as Hex,
    });
  } catch {
    return { ok: false, reasonCode: "AUTHORIZATION_MALFORMED", detail: "the signature could not be checked" };
  }
  if (!valid) {
    return {
      ok: false,
      reasonCode: "AUTHORIZATION_SIGNER_MISMATCH",
      detail: "the signature does not recover to the declared subject",
    };
  }

  /* Last, and only for a proof that has already passed everything else: a nonce
     burned by a failing submission would let one bad request lock out the good
     one that follows it. */
  if (!(await claimNonce(proof.nonce))) {
    return {
      ok: false,
      reasonCode: "AUTHORIZATION_NONCE_REPLAYED",
      detail: "this nonce has already authorized something",
    };
  }

  return { ok: true, subject: challenge.message.subject };
}
