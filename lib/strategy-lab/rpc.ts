import { rpcResult } from "../supabase-rpc";
import { subjectArgs, type AccountSubject } from "../account/subject.ts";
import type { StrategyApprovalArtifact } from "./approval.ts";
import type { EvidenceReport, NormalizedTrade } from "./types.ts";

const rpc = <T,>(fn: string, args: Record<string, unknown>) => rpcResult<T>("strategy-lab", fn, args);

export type StrategyListItem = {
  strategyId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  latestVersionId: string;
  versionNumber: number;
  specHash: string;
};

export type StrategyAppendVersionResult = {
  strategyId: string;
  versionId: string;
  versionNumber: number;
  approval: StrategyApprovalArtifact;
  replay: boolean;
};

export type StrategyAppendRunResult = {
  experimentId: string;
  importId: string;
  evidenceReportId: string;
  evidenceHash: string;
  iterationNumber: number;
  replay: boolean;
};

export type StrategyAppendProposalResult = {
  proposalId: string;
  replay: boolean;
};

export function isStrategyLabIdempotencyConflict(error: string): boolean {
  return error.trim().toLowerCase().includes("idempotency conflict");
}

export function strategyLabAppendVersion(input: {
  subject: AccountSubject;
  requestId: string;
  payloadHash: string;
  approval: StrategyApprovalArtifact;
}) {
  return rpc<StrategyAppendVersionResult>("strategy_lab_append_version", {
    ...subjectArgs(input.subject),
    p_request_uuid: input.requestId,
    p_payload_hash: input.payloadHash,
    p_approval: input.approval,
  });
}

export function strategyLabAppendRun(input: {
  subject: AccountSubject;
  requestId: string;
  payloadHash: string;
  versionId: string;
  protocol: Record<string, unknown>;
  lineage: Record<string, unknown>;
  manifest: Record<string, unknown>;
  providerMetrics: Record<string, number>;
  trades: NormalizedTrade[];
  evidence: EvidenceReport;
  evidenceHash: string;
  engineVersion: string;
}) {
  return rpc<StrategyAppendRunResult>("strategy_lab_append_run", {
    ...subjectArgs(input.subject),
    p_request_uuid: input.requestId,
    p_payload_hash: input.payloadHash,
    p_version_id: input.versionId,
    p_protocol: input.protocol,
    p_lineage: input.lineage,
    p_manifest: input.manifest,
    p_provider_metrics: input.providerMetrics,
    p_trades: input.trades,
    p_evidence: input.evidence,
    p_evidence_hash: input.evidenceHash,
    p_engine_version: input.engineVersion,
  });
}

export function strategyLabAppendProposal(input: {
  subject: AccountSubject;
  requestId: string;
  payloadHash: string;
  versionId: string;
  experimentId: string;
  evidenceReportId: string;
  evidenceHash: string;
  source: "ai" | "manual";
  proposal: Record<string, unknown>;
  audit: Record<string, unknown> | null;
}) {
  return rpc<StrategyAppendProposalResult>("strategy_lab_append_proposal", {
    ...subjectArgs(input.subject),
    p_request_uuid: input.requestId,
    p_payload_hash: input.payloadHash,
    p_version_id: input.versionId,
    p_experiment_id: input.experimentId,
    p_evidence_report_id: input.evidenceReportId,
    p_evidence_hash: input.evidenceHash,
    p_source: input.source,
    p_proposal: input.proposal,
    p_audit: input.audit,
  });
}

export function strategyLabList(input: {
  subject: AccountSubject;
  limit: number;
  beforeUpdatedAt: string | null;
  beforeId: string | null;
}) {
  return rpc<StrategyListItem[]>("strategy_lab_list", {
    ...subjectArgs(input.subject),
    p_limit: input.limit,
    p_before_updated_at: input.beforeUpdatedAt,
    p_before_id: input.beforeId,
  });
}

export function strategyLabGet(input: {
  subject: AccountSubject;
  strategyId: string;
  versionLimit: number;
  versionsBeforeRecordedAt: string | null;
  versionsBeforeId: string | null;
  runLimit: number;
  runsBeforeCreatedAt: string | null;
  runsBeforeId: string | null;
  proposalLimit: number;
  proposalsBeforeCreatedAt: string | null;
  proposalsBeforeId: string | null;
}) {
  return rpc<Record<string, unknown> | null>("strategy_lab_get", {
    ...subjectArgs(input.subject),
    p_strategy_id: input.strategyId,
    p_versions_before_recorded_at: input.versionsBeforeRecordedAt,
    p_versions_before_id: input.versionsBeforeId,
    p_version_limit: input.versionLimit,
    p_run_limit: input.runLimit,
    p_runs_before_created_at: input.runsBeforeCreatedAt,
    p_runs_before_id: input.runsBeforeId,
    p_proposal_limit: input.proposalLimit,
    p_proposals_before_created_at: input.proposalsBeforeCreatedAt,
    p_proposals_before_id: input.proposalsBeforeId,
  });
}
