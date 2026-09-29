import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./approval.ts";
import type { EvidenceReport, StrategySpec } from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type EvidenceProofStrategy = {
  spec: StrategySpec;
  versionId: string;
};

export type EvidenceProofIdentity = {
  experimentId: string | null;
  evidenceReportId: string | null;
  evidenceHash: string;
};

/**
 * Who the proof is bound to: the account id when the session knows it
 * (RYN-ACCESS-002), otherwise the legacy Telegram id. Verification tries the
 * account form first and the Telegram form second, so proofs issued before
 * accounts existed still verify for the same person.
 */
type EvidenceProofPayload = {
  telegramId?: number | null;
  accountId?: string | null;
  strategy: EvidenceProofStrategy;
  evidence: EvidenceReport;
  evidenceIdentity?: EvidenceProofIdentity;
};

type SignedEvidenceProofPayload = (
  | { accountId: string; strategy: EvidenceProofStrategy; evidence: EvidenceReport }
  | { telegramId: number; strategy: EvidenceProofStrategy; evidence: EvidenceReport }
) & {
  evidenceIdentity: EvidenceProofIdentity;
};

function boundPayloads(payload: EvidenceProofPayload, evidenceIdentity: EvidenceProofIdentity): SignedEvidenceProofPayload[] {
  const out: SignedEvidenceProofPayload[] = [];
  const base = { strategy: payload.strategy, evidence: payload.evidence, evidenceIdentity };
  if (typeof payload.accountId === "string" && UUID_PATTERN.test(payload.accountId)) {
    out.push({ accountId: payload.accountId, ...base });
  }
  if (typeof payload.telegramId === "number" && Number.isSafeInteger(payload.telegramId) && payload.telegramId > 0) {
    out.push({ telegramId: payload.telegramId, ...base });
  }
  return out;
}

export type EvidenceProofDecision = "valid" | "invalid" | "unconfigured";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function secret(override?: string): string | null {
  const value = override
    ?? process.env.STRATEGY_LAB_EVIDENCE_SECRET
    ?? process.env.BETA_APP_SECRET;
  return typeof value === "string" && value.trim().length >= 32 ? value.trim() : null;
}
export function evidenceProofSigningAvailable(secretOverride?: string): boolean {
  return secret(secretOverride) !== null;
}

export function evidenceReportHash(evidence: EvidenceReport): string {
  return createHash("sha256").update(canonicalJson(evidence), "utf8").digest("hex");
}

export function createEvidenceProofIdentity(
  evidence: EvidenceReport,
  persisted?: { experimentId: string; evidenceReportId: string } | null,
): EvidenceProofIdentity {
  return {
    experimentId: persisted?.experimentId ?? null,
    evidenceReportId: persisted?.evidenceReportId ?? null,
    evidenceHash: evidenceReportHash(evidence),
  };
}

function resolveEvidenceIdentity(payload: EvidenceProofPayload): EvidenceProofIdentity | null {
  const identity = payload.evidenceIdentity ?? createEvidenceProofIdentity(payload.evidence);
  const bothNull = identity.experimentId === null && identity.evidenceReportId === null;
  const bothPersisted = typeof identity.experimentId === "string"
    && typeof identity.evidenceReportId === "string"
    && UUID_PATTERN.test(identity.experimentId)
    && UUID_PATTERN.test(identity.evidenceReportId);
  if (!bothNull && !bothPersisted) return null;
  const expectedHash = evidenceReportHash(payload.evidence);
  if (!SHA256_PATTERN.test(identity.evidenceHash) || identity.evidenceHash !== expectedHash) return null;
  return identity;
}

function mac(payload: SignedEvidenceProofPayload, signingSecret: string): Buffer {
  return createHmac("sha256", signingSecret)
    .update("ryntra:strategy-lab:evidence:v2\n")
    .update(canonicalJson(payload))
    .digest();
}

export function issueEvidenceProof(payload: EvidenceProofPayload, secretOverride?: string): string | null {
  const signingSecret = secret(secretOverride);
  if (!signingSecret) return null;
  try {
    const evidenceIdentity = resolveEvidenceIdentity(payload);
    if (!evidenceIdentity) return null;
    const bound = boundPayloads(payload, evidenceIdentity);
    if (bound.length === 0) return null;
    return "v2." + mac(bound[0], signingSecret).toString("hex");
  } catch {
    return null;
  }
}

export function verifyEvidenceProof(
  payload: EvidenceProofPayload,
  proof: string,
  secretOverride?: string,
): EvidenceProofDecision {
  const signingSecret = secret(secretOverride);
  if (!signingSecret) return "unconfigured";
  if (!/^v2\.[a-f0-9]{64}$/.test(proof)) return "invalid";
  try {
    const evidenceIdentity = resolveEvidenceIdentity(payload);
    if (!evidenceIdentity) return "invalid";
    const given = Buffer.from(proof.slice(3), "hex");
    for (const bound of boundPayloads(payload, evidenceIdentity)) {
      const expected = mac(bound, signingSecret);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return "valid";
    }
    return "invalid";
  } catch {
    return "invalid";
  }
}
