import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { StrategySpec } from "./types.ts";
import { StrategySpecSchema, validateStrategySpec } from "./validation.ts";

const TelegramIdSchema = z.number().finite().int().positive().refine(Number.isSafeInteger);
const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ProofSchema = z.string().regex(/^v1\.[a-f0-9]{64}$/);
const ApprovedAtSchema = z.string()
  .datetime()
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  }, "approvedAt must be a canonical UTC ISO timestamp.");

type UnsignedStrategyApprovalArtifact = {
  schemaVersion: 1;
  versionId: string;
  spec: StrategySpec;
  specHash: string;
  approvedAt: string;
  parentVersionId: string | null;
};

/**
 * Serialize JSON values with recursively sorted object keys. Arrays retain their
 * order because order is part of the StrategySpec contract.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Approval payload numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Approval payload must contain only JSON-safe values.");
}

function strategySpecHash(spec: StrategySpec): string {
  return createHash("sha256").update(canonicalJson(spec)).digest("hex");
}

const StrategyApprovalArtifactBaseSchema = z.object({
  schemaVersion: z.literal(1),
  versionId: UuidSchema,
  spec: StrategySpecSchema,
  specHash: Sha256Schema,
  approvedAt: ApprovedAtSchema,
  parentVersionId: UuidSchema.nullable(),
  proof: ProofSchema,
}).strict();

/** Strict transport schema for the complete, stateless approval artifact. */
export const StrategyApprovalArtifactSchema = StrategyApprovalArtifactBaseSchema.superRefine((artifact, context) => {
  const validated = validateStrategySpec(artifact.spec);
  if (!validated.ok) {
    context.addIssue({
      code: "custom",
      path: ["spec"],
      message: "Approval contains a semantically invalid StrategySpec v1.",
    });
    return;
  }
  if (strategySpecHash(validated.value) !== artifact.specHash) {
    context.addIssue({
      code: "custom",
      path: ["specHash"],
      message: "specHash does not match the canonical StrategySpec v1.",
    });
  }
});

export type StrategyApprovalArtifact = z.infer<typeof StrategyApprovalArtifactSchema>;

export type StrategyApprovalArtifactParseResult =
  | { success: true; data: StrategyApprovalArtifact }
  | { success: false };

/**
 * Parse an approval envelope only after iterative StrategySpec preflight. This
 * prevents recursive schema parsing from turning hostile AST depth into a 500.
 */
export function parseStrategyApprovalArtifact(input: unknown): StrategyApprovalArtifactParseResult {
  try {
    if (input === null || typeof input !== "object") return { success: false };
    const descriptor = Object.getOwnPropertyDescriptor(input, "spec");
    if (!descriptor || !("value" in descriptor)) return { success: false };
    const spec = validateStrategySpec(descriptor.value);
    if (!spec.ok) return { success: false };
    const parsed = StrategyApprovalArtifactSchema.safeParse(input);
    return parsed.success ? { success: true, data: parsed.data } : { success: false };
  } catch {
    return { success: false };
  }
}

export type StrategyApprovalIssueResult =
  | { ok: true; approval: StrategyApprovalArtifact }
  | { ok: false; error: "invalid-input" | "unconfigured" };

export type StrategyApprovalVerificationDecision = "valid" | "invalid" | "unconfigured";

function approvalSecret(override?: string): string | null {
  const value = override
    ?? process.env.STRATEGY_LAB_APPROVAL_SECRET
    ?? process.env.STRATEGY_LAB_EVIDENCE_SECRET
    ?? process.env.BETA_APP_SECRET;
  return typeof value === "string" && value.trim().length >= 32 ? value.trim() : null;
}

function unsignedArtifact(approval: StrategyApprovalArtifact): UnsignedStrategyApprovalArtifact {
  return {
    schemaVersion: approval.schemaVersion,
    versionId: approval.versionId,
    spec: approval.spec,
    specHash: approval.specHash,
    approvedAt: approval.approvedAt,
    parentVersionId: approval.parentVersionId,
  };
}

/**
 * Who an approval is bound to.
 *
 * An account id when the session knows it (RYN-ACCESS-002), otherwise the
 * legacy Telegram id. The MAC input keeps the legacy shape byte-for-byte for
 * a Telegram subject, so approvals issued before accounts existed still
 * verify; verification tries the account form first and the Telegram form
 * second for a session that carries both.
 */
export type ApprovalSubject = Readonly<{ telegramId?: number | null; accountId?: string | null }>;

type BoundSubject = { accountId: string } | { telegramId: number };

function boundSubjects(input: ApprovalSubject): BoundSubject[] {
  const out: BoundSubject[] = [];
  const accountId = UuidSchema.safeParse(input.accountId ?? undefined);
  if (accountId.success) out.push({ accountId: accountId.data });
  const telegramId = TelegramIdSchema.safeParse(input.telegramId ?? undefined);
  if (telegramId.success) out.push({ telegramId: telegramId.data });
  return out;
}

function approvalMac(
  subject: BoundSubject,
  artifact: UnsignedStrategyApprovalArtifact,
  signingSecret: string,
): Buffer {
  return createHmac("sha256", signingSecret)
    .update("ryntra:strategy-lab:approval:v1\n")
    .update(canonicalJson({ ...subject, artifact }))
    .digest();
}

/**
 * Issue a server-identified, stateless approval. Version identity and approval
 * time are deliberately not accepted from the caller.
 */
export function issueStrategyApproval(
  input: ApprovalSubject & { spec: unknown; parentVersionId?: string | null },
  secretOverride?: string,
): StrategyApprovalIssueResult {
  const signingSecret = approvalSecret(secretOverride);
  if (!signingSecret) return { ok: false, error: "unconfigured" };

  try {
    const subjects = boundSubjects(input);
    const parentVersionId = UuidSchema.nullable().safeParse(input.parentVersionId ?? null);
    const spec = validateStrategySpec(input.spec);
    if (subjects.length === 0 || !parentVersionId.success || !spec.ok) {
      return { ok: false, error: "invalid-input" };
    }

    const artifact: UnsignedStrategyApprovalArtifact = {
      schemaVersion: 1,
      versionId: randomUUID(),
      spec: spec.value,
      specHash: strategySpecHash(spec.value),
      approvedAt: new Date().toISOString(),
      parentVersionId: parentVersionId.data,
    };
    const proof = `v1.${approvalMac(subjects[0], artifact, signingSecret).toString("hex")}`;
    const approval = parseStrategyApprovalArtifact({ ...artifact, proof });
    return approval.success
      ? { ok: true, approval: approval.data }
      : { ok: false, error: "invalid-input" };
  } catch {
    return { ok: false, error: "invalid-input" };
  }
}

/** Verify that an approval belongs to this user and this exact StrategySpec. */
export function verifyStrategyApproval(
  input: ApprovalSubject & { spec: unknown; approval: unknown },
  secretOverride?: string,
): StrategyApprovalVerificationDecision {
  const signingSecret = approvalSecret(secretOverride);
  if (!signingSecret) return "unconfigured";

  try {
    const subjects = boundSubjects(input);
    const spec = validateStrategySpec(input.spec);
    const approval = parseStrategyApprovalArtifact(input.approval);
    if (subjects.length === 0 || !spec.ok || !approval.success) return "invalid";

    const expectedSpec = canonicalJson(spec.value);
    if (canonicalJson(approval.data.spec) !== expectedSpec) return "invalid";
    if (strategySpecHash(spec.value) !== approval.data.specHash) return "invalid";

    const given = Buffer.from(approval.data.proof.slice(3), "hex");
    for (const subject of subjects) {
      const expected = approvalMac(subject, unsignedArtifact(approval.data), signingSecret);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return "valid";
    }
    return "invalid";
  } catch {
    return "invalid";
  }
}
