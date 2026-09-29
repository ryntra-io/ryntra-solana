import { createHash } from "node:crypto";

import { canonicalJson } from "../guard/canonical-json.ts";

export const AGENT_HASH_DOMAINS = {
  intent: "ryntra.agent-control.intent.v1",
  evidence: "ryntra.agent-control.evidence-root.v1",
  policy: "ryntra.agent-control.policy.v1",
  policyResult: "ryntra.agent-control.policy-result.v1",
  passport: "ryntra.agent-control.passport-preview.v1",
  integrity: "ryntra.agent-control.passport-integrity.v1",
} as const;

/**
 * The v2 domain set, and the point at which this serialization becomes
 * **frozen**.
 *
 * Frozen means the preimage bytes for a given value may never change again:
 * not the domain string, not the separator, not the canonicalizer's key order
 * or `undefined` handling. `canonical.golden.test.mjs` pins the exact preimage
 * and the exact digest for one fixed input per domain as literals, so any drift
 * fails there before it can reach an artifact.
 *
 * The freeze exists because Release B adds an issuer signature. A signature is
 * a claim about exact bytes; if the bytes a verifier reconstructs can move, the
 * signature says nothing. The v1 domains above stay exported and unchanged so
 * artifacts written before this packet keep verifying.
 */
export const AGENT_HASH_DOMAINS_V2 = {
  intent: "ryntra.agent-control.intent.v2",
  evidence: "ryntra.agent-control.evidence-root.v2",
  policy: "ryntra.agent-control.policy.v2",
  policyResult: "ryntra.agent-control.policy-result.v2",
  registry: "ryntra.agent-control.registry.v2",
  agentPassport: "ryntra.agent-control.agent-passport.v2",
  actionPassport: "ryntra.agent-control.action-passport.v2",
  outcomeReceipt: "ryntra.agent-control.outcome-receipt.v2",
  /* A commerce receipt is a different artifact from an Outcome Receipt and gets
     its own domain rather than borrowing one: sharing a domain would let a
     payment record be replayed as a settled action outcome, which is exactly
     the substitution domain separation exists to stop. */
  commerceReceipt: "ryntra.agent-control.commerce-receipt.v2",
  /* An inbound A2A Agent Card is somebody else's document, and its digest is
     the only thing canon `12 §9` asks Ryntra to keep of it. It gets its own
     domain for the same reason a commerce receipt does: sharing one would let
     a card digest be replayed where an Agent Passport digest belongs, and an
     Agent Passport is Ryntra's own observation while a card is a claim. */
  a2aAgentCard: "ryntra.agent-control.a2a-agent-card.v2",
  solanaReceiptCorrection: "ryntra.agent-control.solana-receipt-correction.v2",
  authorizationProof: "ryntra.agent-control.authorization-proof.v2",
  issuerSignature: "ryntra.agent-control.issuer-signature.v2",
  integrity: "ryntra.agent-control.artifact-integrity.v2",
} as const;

export type AgentHashDomain = (typeof AGENT_HASH_DOMAINS)[keyof typeof AGENT_HASH_DOMAINS];
export type AgentHashDomainV2 = (typeof AGENT_HASH_DOMAINS_V2)[keyof typeof AGENT_HASH_DOMAINS_V2];

/**
 * The exact bytes every Agent Control digest and signature covers: the domain
 * line, one `\n`, then the shared Guard canonical JSON.
 *
 * Exposed rather than inlined because a frozen format has to be assertable.
 * A test that only compares digests cannot tell a canonicalizer change from a
 * domain change; one that compares preimages says which.
 */
export function agentCanonicalPreimage(
  domain: AgentHashDomain | AgentHashDomainV2,
  value: unknown,
): string {
  return `${domain}\n${canonicalJson(value)}`;
}

function digest(preimage: string): string {
  return `0x${createHash("sha256").update(preimage, "utf8").digest("hex")}`;
}

/**
 * Domain-separated SHA-256 over the shared Guard canonical JSON bytes.
 *
 * Canonicalization stays single-source in `lib/guard/canonical-json.ts`; the
 * domain line prevents an Agent Control intent hash from being replayed as a
 * policy, evidence root or passport hash even when the JSON payload is equal.
 */
export function hashAgentPayload(domain: AgentHashDomain, value: unknown): string {
  return digest(agentCanonicalPreimage(domain, value));
}

/**
 * The v2 hasher. Separate from `hashAgentPayload` by type rather than by
 * convention: a v1 domain cannot be passed here and a v2 domain cannot be
 * passed there, so an artifact version can never be hashed under the wrong
 * generation by accident.
 */
export function hashAgentPayloadV2(domain: AgentHashDomainV2, value: unknown): string {
  return digest(agentCanonicalPreimage(domain, value));
}
