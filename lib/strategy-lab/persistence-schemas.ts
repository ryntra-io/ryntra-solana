import { z } from "zod";
import { canonicalJson, StrategyApprovalArtifactSchema } from "./approval.ts";
import { EvidenceBundleSchema, StrategyChangeProposalSchema } from "./ai-schemas.ts";
import { evidenceReportHash } from "./evidence-proof.ts";
import { ExperimentLineageSchema } from "./lineage.ts";
import { StrategySpecSchema } from "./validation.ts";

export const StrategyLabCanonicalUuidSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const StrategyLabCursorTimestampSchema = z.string().max(40).datetime({ offset: true });

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SafePositiveIntegerSchema = z.number().int().min(1).refine(Number.isSafeInteger);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const StrategyListItemSchema = z.object({
  strategyId: StrategyLabCanonicalUuidSchema,
  title: z.string().trim().min(3).max(80),
  createdAt: StrategyLabCursorTimestampSchema,
  updatedAt: StrategyLabCursorTimestampSchema,
  latestVersionId: StrategyLabCanonicalUuidSchema,
  versionNumber: SafePositiveIntegerSchema,
  specHash: Sha256Schema,
}).strict();

export const StrategyLabListResultSchema = z.array(StrategyListItemSchema).max(100);

export const StrategyLabProtocolSchema = z.object({
  oos: z.enum(["none", "self-attested", "blind"]),
  costsIncluded: z.boolean(),
  regimesCovered: z.number().int().min(0).max(100),
  parameterSensitivity: z.enum(["not-tested", "fragile", "stable"]),
  forwardEvidence: z.boolean(),
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal("tradingview"),
  strategyVersionId: StrategyLabCanonicalUuidSchema,
  compilerVersion: z.string().min(1).max(64),
  pineHash: Sha256Schema,
  symbol: z.string().min(2).max(64),
  timeframe: z.string().min(1).max(8),
  timezone: z.literal("UTC"),
  compileWindow: z.object({ start: DateSchema, end: DateSchema }).strict(),
  initialCapital: z.number().finite().positive().max(1_000_000_000_000),
  exportedAt: StrategyLabCursorTimestampSchema,
  tradesFileHash: Sha256Schema,
  metricsFileHash: Sha256Schema,
}).strict();

const ProviderMetricsSchema = z.record(
  z.string().min(1).max(120).refine((key) => key === key.trim()),
  z.number().finite().min(-1_000_000_000_000_000).max(1_000_000_000_000_000),
).superRefine((metrics, context) => {
  if (Object.keys(metrics).length > 2_000 || JSON.stringify(metrics).length > 65_536) {
    context.addIssue({ code: "custom", message: "Provider metrics exceed restore bounds." });
  }
});

const AiAuditSchema = z.object({
  model: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(64),
  schemaVersion: z.string().min(1).max(64),
  responseId: z.string().min(1).max(200).nullable(),
  inputHash: Sha256Schema,
  tokenUsage: z.object({
    input: z.number().int().nonnegative().refine(Number.isSafeInteger),
    output: z.number().int().nonnegative().refine(Number.isSafeInteger),
    total: z.number().int().nonnegative().refine(Number.isSafeInteger),
  }).strict(),
  latencyMs: z.number().int().nonnegative().refine(Number.isSafeInteger),
  outcome: z.literal("ok"),
}).strict();

const VersionPageItemSchema = z.object({
  versionId: StrategyLabCanonicalUuidSchema,
  versionNumber: SafePositiveIntegerSchema,
  parentVersionId: StrategyLabCanonicalUuidSchema.nullable(),
  spec: StrategySpecSchema,
  specHash: Sha256Schema,
  approvedAt: StrategyLabCursorTimestampSchema,
  approval: StrategyApprovalArtifactSchema,
  recordedAt: StrategyLabCursorTimestampSchema,
}).strict().superRefine((version, context) => {
  if (version.versionId !== version.approval.versionId
    || version.parentVersionId !== version.approval.parentVersionId
    || version.specHash !== version.approval.specHash
    || Date.parse(version.approvedAt) !== Date.parse(version.approval.approvedAt)
    || canonicalJson(version.spec) !== canonicalJson(version.approval.spec)) {
    context.addIssue({ code: "custom", message: "Version restore identity mismatch." });
  }
});

const RunPageItemSchema = z.object({
  experimentId: StrategyLabCanonicalUuidSchema,
  versionId: StrategyLabCanonicalUuidSchema,
  parentExperimentId: StrategyLabCanonicalUuidSchema.nullable(),
  iterationNumber: SafePositiveIntegerSchema,
  protocol: StrategyLabProtocolSchema,
  lineage: ExperimentLineageSchema,
  status: z.literal("evidence-ready"),
  manifest: ManifestSchema,
  providerMetrics: ProviderMetricsSchema,
  rawFilesStored: z.literal(false),
  tradeCount: z.number().int().min(0).max(20_000),
  evidenceReportId: StrategyLabCanonicalUuidSchema,
  evidenceHash: Sha256Schema,
  evidence: EvidenceBundleSchema,
  engineVersion: z.string().min(1).max(64),
  createdAt: StrategyLabCursorTimestampSchema,
}).strict().superRefine((run, context) => {
  if (run.manifest.strategyVersionId !== run.versionId
    || run.lineage.parentRunId !== run.parentExperimentId
    || run.lineage.iterationNumber !== run.iterationNumber
    || evidenceReportHash(run.evidence) !== run.evidenceHash) {
    context.addIssue({ code: "custom", message: "Run restore identity mismatch." });
  }
});

const ProposalPageItemSchema = z.object({
  proposalId: StrategyLabCanonicalUuidSchema,
  versionId: StrategyLabCanonicalUuidSchema,
  experimentId: StrategyLabCanonicalUuidSchema,
  evidenceReportId: StrategyLabCanonicalUuidSchema,
  evidenceHash: Sha256Schema,
  source: z.enum(["manual", "ai"]),
  proposal: StrategyChangeProposalSchema,
  audit: AiAuditSchema.nullable(),
  createdAt: StrategyLabCursorTimestampSchema,
}).strict().superRefine((proposal, context) => {
  if ((proposal.source === "manual" && proposal.audit !== null)
    || (proposal.source === "ai" && proposal.audit === null)) {
    context.addIssue({ code: "custom", path: ["audit"], message: "Proposal provenance mismatch." });
  }
});

export const StrategyLabDetailResultSchema = z.object({
  strategy: z.object({
    strategyId: StrategyLabCanonicalUuidSchema,
    title: z.string().trim().min(3).max(80),
    createdAt: StrategyLabCursorTimestampSchema,
    updatedAt: StrategyLabCursorTimestampSchema,
  }).strict(),
  versions: z.array(VersionPageItemSchema).max(100),
  runs: z.array(RunPageItemSchema).max(100),
  proposals: z.array(ProposalPageItemSchema).max(100),
}).strict();
