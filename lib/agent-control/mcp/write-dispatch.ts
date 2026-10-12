import { z } from "zod";

import { A2aInboundSchema, A2aIngestError, ingestA2aTask } from "../a2a/inbound.ts";
import { RegistryResolutionError } from "../registry.ts";
import {
  ProposalLedgerError,
  type ProposalLedger,
} from "./proposal-ledger.ts";
import { McpWriteError, admitMcpWrite, mcpWriteRefusal } from "./write-gate.ts";
import { mcpWriteTool } from "./write-tools.ts";

/**
 * The five writes, once, in protocol-neutral form.
 *
 * This dispatch first lived inside the stdio server, where it had one caller.
 * Release D adds a second — the hosted endpoint — and two copies of a gate is
 * how a gate stops being one. So the decision moved here and both servers call
 * it; what stays in each server is only the shaping of an MCP result, which is
 * genuinely per transport.
 *
 * The order the stdio server established is preserved exactly. `admitMcpWrite` runs
 * **before** the input schema and before any body, because that is the server
 * `MUST` half of the MCP specification's security split and it is what makes
 * the published tool annotations decide nothing. The registry answers before
 * the tool's allowlist, so *this action does not exist* outranks *this tool may
 * not propose it*.
 *
 * The return value is a discriminated result rather than an MCP content block:
 * a hosted route needs the outcome to write a receipt, and re-parsing JSON out
 * of a text content block to learn whether a call succeeded is how a caller
 * ends up disagreeing with its own audit trail.
 */

export const MCP_WRITE_LIMITATIONS = [
  "PROPOSAL ONLY — NOT AN AUTHORIZATION, A MANDATE OR A SIGNATURE",
  "Writes one record in this server process. Reaches no provider, chain, facilitator or wallet.",
  "The record sits at PROPOSE. Only the owner advances it, and not through this surface.",
] as const;

export const ProposalIdSchema = z.string().regex(/^proposal-[1-9]\d{0,3}$/);
export const SubjectRefSchema = z.string().min(1).max(128);
const DecimalAmountSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/);

export const BudgetSchema = z
  .object({ amount: DecimalAmountSchema, assetRef: z.string().min(3).max(128) })
  .strict();

/**
 * `actionRef` is an enum built from the catalogue, not a free string.
 *
 * The published JSON Schema therefore shows a client the four exact references
 * it may name. That is a courtesy, not the control — `admitMcpWrite` checks the
 * same allowlist server-side, resolves it through the hash-pinned registry, and
 * would refuse a fifth even if a client sent one.
 */
const proposalActionRefs = mcpWriteTool("propose_action")?.actionRefs ?? [];

export const SubmitActionProposalInputSchema = z
  .object({
    actionRef: z.enum(proposalActionRefs as [string, ...string[]]),
    subjectRef: SubjectRefSchema,
    summary: z.string().min(1).max(512),
    budget: BudgetSchema.nullable().default(null),
  })
  .strict();

export const AttachProposalEvidenceInputSchema = z
  .object({
    proposalId: ProposalIdSchema,
    sourceRef: z.string().min(3).max(128),
    note: z.string().min(1).max(512),
  })
  .strict();

export const RequestHumanReviewInputSchema = z.object({ proposalId: ProposalIdSchema }).strict();

export const WithdrawProposalInputSchema = z
  .object({ proposalId: ProposalIdSchema, reason: z.string().min(1).max(256) })
  .strict();

export const WRITE_INPUT_SCHEMAS = {
  propose_action: SubmitActionProposalInputSchema,
  attach_proposal_evidence: AttachProposalEvidenceInputSchema,
  request_human_review: RequestHumanReviewInputSchema,
  retract_proposal: WithdrawProposalInputSchema,
  ingest_a2a_task: A2aInboundSchema,
} as const;

export type McpWriteResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; code: string }>;

export function dispatchMcpWrite(
  ledger: ProposalLedger,
  name: string,
  rawInput: unknown,
): McpWriteResult {
  try {
    const admitted = admitMcpWrite({ tool: name, input: rawInput });

    if (name === "ingest_a2a_task") {
      const proposal = ingestA2aTask(rawInput);
      ledger.open({
        source: "A2A_INBOUND",
        tool: name,
        actionRef: admitted.actionRef,
        adapterRef: admitted.adapterRef,
        canonicalClass: admitted.canonicalClass,
        subjectRef: proposal.taskId,
        summary: `${proposal.agentName}: ${proposal.taskState}`,
        ownerAuthorization: proposal.ownerAuthorization,
      });
      return { ok: true, data: proposal };
    }

    if (name === "propose_action") {
      const parsed = SubmitActionProposalInputSchema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR" };
      return {
        ok: true,
        data: ledger.open({
          source: "MCP_CLIENT",
          tool: name,
          actionRef: admitted.actionRef,
          adapterRef: admitted.adapterRef,
          canonicalClass: admitted.canonicalClass,
          subjectRef: parsed.data.subjectRef,
          summary: parsed.data.summary,
          ownerAuthorization: admitted.ownerAuthorization,
        }),
      };
    }

    if (name === "attach_proposal_evidence") {
      const parsed = AttachProposalEvidenceInputSchema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR" };
      return {
        ok: true,
        data: ledger.attachEvidence(parsed.data.proposalId, {
          sourceRef: parsed.data.sourceRef,
          note: parsed.data.note,
        }),
      };
    }

    if (name === "request_human_review") {
      const parsed = RequestHumanReviewInputSchema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR" };
      return { ok: true, data: ledger.requestReview(parsed.data.proposalId) };
    }

    if (name === "retract_proposal") {
      const parsed = WithdrawProposalInputSchema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR" };
      return {
        ok: true,
        data: ledger.withdraw(parsed.data.proposalId, parsed.data.reason),
      };
    }

    /* Unreachable while the catalogue and this block agree, and a test proves
       they do by calling every catalogue entry. Refusing rather than falling
       through is the point: a tool that reached here would have been admitted
       and then done nothing, which reads as success. */
    return { ok: false, code: "UNKNOWN_TOOL" };
  } catch (error) {
    if (
      error instanceof McpWriteError
      || error instanceof RegistryResolutionError
      || error instanceof A2aIngestError
      || error instanceof ProposalLedgerError
    ) {
      return {
        ok: false,
        code:
          error instanceof ProposalLedgerError || error instanceof A2aIngestError
            ? error.reasonCode
            : mcpWriteRefusal(error),
      };
    }
    return { ok: false, code: "TOOL_REQUEST_FAILED" };
  }
}
