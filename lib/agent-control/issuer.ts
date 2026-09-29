import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

import { AGENT_HASH_DOMAINS_V2, agentCanonicalPreimage } from "./canonical.ts";
import {
  UNSIGNED_ATTESTATION,
  issuerSigningPayload,
  type AgentArtifactKind,
  type IssuerAttestation,
} from "./artifacts.ts";

/**
 * Ryntra's issuer signature: axis one of three.
 *
 * Every hash in an Agent Control artifact is computable by anyone — that is
 * the point of them, and it is what makes "recompute it yourself" a checkable
 * claim rather than a promise. The cost is that a hash cannot say *who* built
 * the artifact: a byte-identical copy is trivial to produce. The signature adds
 * exactly that one fact and nothing else. It says these bytes were issued by
 * the holder of this key and have not moved since.
 *
 * **This is not a wallet key.** It signs documents, never transactions. It
 * cannot move value, authorize a payment or act on any chain. Ryntra holds no
 * wallet key and this module does not change that.
 *
 * The private key is read from the environment and never from the repository.
 * With none configured the correct artifact is an explicitly unsigned one —
 * `UNSIGNED` with a reason code — because the alternatives are both worse: an
 * absent field reads as an oversight, and a placeholder signature is a claim
 * that a verifier would have to be told to disbelieve.
 */

export const ISSUER_PRIVATE_KEY_ENV = "RYNTRA_AGENT_ISSUER_PRIVATE_KEY";

export type IssuerKey = Readonly<{
  keyId: string;
  publicKey: string;
  privateKey: KeyObject;
}>;

/** A stable id derived from the key itself, so it can never disagree with it. */
export function issuerKeyId(publicKeyBase64: string): string {
  return `ryntra-issuer-${createHash("sha256").update(publicKeyBase64, "utf8").digest("hex").slice(0, 16)}`;
}

function exportPublicKey(key: KeyObject): string {
  return createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
}

/**
 * Load the configured issuer key, or `null` when none is configured.
 *
 * `null` rather than a thrown error: an unconfigured issuer is the expected
 * state of this release, not a failure. A key that is present but unusable is
 * a different situation and does throw, because silently downgrading a broken
 * key to "unsigned" would hide a real misconfiguration behind a normal-looking
 * artifact.
 */
export function loadIssuerKey(
  environment: Record<string, string | undefined> = process.env,
): IssuerKey | null {
  const encoded = environment[ISSUER_PRIVATE_KEY_ENV];
  if (!encoded || encoded.trim() === "") return null;

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(encoded.trim(), "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch (cause) {
    throw new Error(`${ISSUER_PRIVATE_KEY_ENV} is set but is not a usable PKCS#8 key.`, { cause });
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`${ISSUER_PRIVATE_KEY_ENV} must be an Ed25519 key, not ${privateKey.asymmetricKeyType}.`);
  }

  const publicKey = exportPublicKey(privateKey);
  return Object.freeze({ keyId: issuerKeyId(publicKey), publicKey, privateKey });
}

/** The exact bytes a signature covers: the artifact kind and its content hash. */
function signingBytes(kind: AgentArtifactKind, contentHash: string): Buffer {
  return Buffer.from(
    agentCanonicalPreimage(AGENT_HASH_DOMAINS_V2.issuerSignature, issuerSigningPayload(kind, contentHash)),
    "utf8",
  );
}

/**
 * Sign an artifact's content hash, or return the explicit unsigned attestation.
 *
 * The signature covers the *content hash*, not the artifact. That keeps the
 * axis independent: an artifact can be signed, checked or stripped without its
 * content hash moving, which is what lets a verifier report "valid content,
 * no signature" instead of one merged verdict.
 */
export function attestArtifact({
  kind,
  contentHash,
  key,
  now = new Date(),
}: {
  kind: AgentArtifactKind;
  contentHash: string;
  key: IssuerKey | null;
  now?: Date;
}): IssuerAttestation {
  if (!key) return UNSIGNED_ATTESTATION;
  return {
    status: "SIGNED",
    algorithm: "Ed25519",
    keyId: key.keyId,
    publicKey: key.publicKey,
    signature: signBytes(null, signingBytes(kind, contentHash), key.privateKey).toString("base64"),
    signedAt: now.toISOString(),
  };
}

export const ISSUER_AXIS_VERDICTS = [
  "SIGNATURE_VALID",
  "SIGNATURE_INVALID",
  "UNSIGNED",
  "UNTRUSTED_KEY",
] as const;

export type IssuerAxisVerdict = (typeof ISSUER_AXIS_VERDICTS)[number];

export type IssuerAxisResult = Readonly<{
  verdict: IssuerAxisVerdict;
  keyId: string | null;
  detail: string;
}>;

/**
 * Check the issuer axis on its own.
 *
 * `trustedKeys` is optional and separate from validity on purpose. A signature
 * that verifies against a key nobody published is cryptographically fine and
 * evidentially worthless, and those are two different findings — collapsing
 * them would let "signed by someone" read as "signed by Ryntra".
 */
export function verifyIssuerAttestation({
  kind,
  contentHash,
  attestation,
  trustedPublicKeys,
}: {
  kind: AgentArtifactKind;
  contentHash: string;
  attestation: IssuerAttestation;
  trustedPublicKeys?: readonly string[];
}): IssuerAxisResult {
  if (attestation.status === "UNSIGNED") {
    return { verdict: "UNSIGNED", keyId: null, detail: attestation.reasonCode };
  }

  let valid = false;
  try {
    valid = verifyBytes(
      null,
      signingBytes(kind, contentHash),
      createPublicKey({
        key: Buffer.from(attestation.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return { verdict: "SIGNATURE_INVALID", keyId: attestation.keyId, detail: "UNREADABLE_KEY_OR_SIGNATURE" };
  }

  if (!valid) {
    return {
      verdict: "SIGNATURE_INVALID",
      keyId: attestation.keyId,
      detail: "the signature does not cover this artifact's content hash",
    };
  }
  if (attestation.keyId !== issuerKeyId(attestation.publicKey)) {
    return {
      verdict: "SIGNATURE_INVALID",
      keyId: attestation.keyId,
      detail: "the key id does not derive from the key it names",
    };
  }
  if (trustedPublicKeys && !trustedPublicKeys.includes(attestation.publicKey)) {
    return {
      verdict: "UNTRUSTED_KEY",
      keyId: attestation.keyId,
      detail: "the signature is valid but the key is not one this verifier publishes",
    };
  }
  return { verdict: "SIGNATURE_VALID", keyId: attestation.keyId, detail: "signed by the named issuer key" };
}

/** What the published verification-key surface serves. */
export function publishedIssuerKey(key: IssuerKey | null): Readonly<{
  status: "PUBLISHED" | "NOT_CONFIGURED";
  algorithm: "Ed25519";
  keyId: string | null;
  publicKey: string | null;
  note: string;
}> {
  if (!key) {
    return Object.freeze({
      status: "NOT_CONFIGURED" as const,
      algorithm: "Ed25519" as const,
      keyId: null,
      publicKey: null,
      note: "No issuer key is configured, so every artifact this deployment produces is explicitly unsigned.",
    });
  }
  return Object.freeze({
    status: "PUBLISHED" as const,
    algorithm: "Ed25519" as const,
    keyId: key.keyId,
    publicKey: key.publicKey,
    note: "Document signing only. This key cannot authorize a transaction, move value or act on any chain.",
  });
}
