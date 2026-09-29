import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { isAgentverseAddress } from "../../agent-control-sdk/src/index.ts";
import type { A2aProposal } from "../../../lib/agent-control/a2a/inbound.ts";
import {
  MCP_WRITE_LIMITATIONS,
  WRITE_INPUT_SCHEMAS,
  dispatchMcpWrite,
} from "../../../lib/agent-control/mcp/write-dispatch.ts";
import {
  MCP_WRITE_TOOLS,
  mcpWriteTool,
} from "../../../lib/agent-control/mcp/write-tools.ts";
import {
  createProposalLedger,
  type ProposalLedger,
  type ProposalRecord,
} from "../../../lib/agent-control/mcp/proposal-ledger.ts";
import type {
  AgentControlRequestOptions,
  AgentLaunchTokenDetailResult,
  AgentLaunchTokenListResult,
  AgentPassport,
  BnbApexObservationRequest,
  BnbApexObservationResult,
  ActionPassportPreview,
  ArtifactVerification,
  RyntraAgentControlClient,
} from "../../agent-control-sdk/src/index.ts";
import { McpAgentActionIntentSchema } from "./intent-schema.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT256_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const UINT256_MAX = (1n << 256n) - 1n;
export const AGENT_CONTROL_MCP_MAX_RESULT_BYTES = 96 * 1_024;
export const AGENT_CONTROL_MCP_MAX_VERIFY_INPUT_BYTES = 64 * 1_024;

const MCP_LIMITATIONS = [
  "SOURCE PREVIEW — NOT A FINALIZED RECEIPT",
  "No account, wallet, signature, provider action, payment or settlement is performed.",
] as const;

const localReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const upstreamReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * The annotations a write tool publishes — honest, and load-bearing for nothing.
 *
 * MCP `2026-07-28` states it plainly: *"clients MUST consider tool annotations
 * to be untrusted unless they come from trusted servers."* So these describe
 * the tool for a reader and decide nothing at all; `admitMcpWrite` runs before
 * any body and never reads them. A test inverts every one of them and asserts
 * the server's behaviour is byte-identical.
 *
 * `openWorldHint: false` is the exact fact worth publishing: these writes do
 * not leave the process.
 */
const localWriteAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};


export type AgentControlMcpClient = Pick<
  RyntraAgentControlClient,
  | "agentPassport"
  | "preflight"
  | "verifyArtifact"
  | "agentLaunchTokens"
  | "agentLaunchToken"
  | "observeBnbApex"
>;

type ToolData =
  | AgentPassport
  | AgentLaunchTokenListResult
  | AgentLaunchTokenDetailResult
  | BnbApexObservationResult
  | ArtifactVerification
  | ActionPassportPreview
  | ProposalRecord
  | A2aProposal
  | Readonly<{ tools: readonly unknown[] }>
  | Readonly<{
      maturity: "SOURCE_PREVIEW";
      intent: z.output<typeof McpAgentActionIntentSchema>;
      limitations: typeof MCP_LIMITATIONS;
    }>;

type ToolErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "UPSTREAM_FAILURE"
  | "UNKNOWN_TOOL"
  | "VALIDATION_ERROR"
  | "TOOL_REQUEST_FAILED";

const textEncoder = new TextEncoder();

function serializedBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return textEncoder.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function toolFailureCode(code: ToolErrorCode) {
  const messages: Record<ToolErrorCode, string> = {
    PAYLOAD_TOO_LARGE: "The bounded tool payload exceeds the application byte limit.",
    RATE_LIMITED: "The bounded read-only request was rate limited.",
    REQUEST_ABORTED: "The bounded read-only request was cancelled.",
    REQUEST_TIMEOUT: "The bounded read-only request exceeded its timeout.",
    UPSTREAM_FAILURE: "The read-only upstream observation could not be completed.",
    UNKNOWN_TOOL: "The requested tool is not available.",
    VALIDATION_ERROR: "The tool input was not accepted.",
    TOOL_REQUEST_FAILED: "The read-only tool request could not be completed.",
  };
  const output = { error: { code, message: messages[code] } };
  const result = {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
  const bytes = serializedBytes(result);
  if (bytes !== null && bytes <= AGENT_CONTROL_MCP_MAX_RESULT_BYTES) return result;

  const fallback = {
    isError: true,
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: {
          code: "TOOL_REQUEST_FAILED",
          message: "The read-only tool request could not be completed.",
        },
      }),
    }],
    structuredContent: {
      error: {
        code: "TOOL_REQUEST_FAILED" as const,
        message: "The read-only tool request could not be completed.",
      },
    },
  };
  return fallback;
}

function toolSuccess(
  data: ToolData,
  limitations: readonly string[] = MCP_LIMITATIONS,
) {
  const output = { data, limitations };
  let textPayload: string;
  try {
    textPayload = JSON.stringify(output);
  } catch {
    return toolFailureCode("TOOL_REQUEST_FAILED");
  }
  const duplicated = {
    content: [{ type: "text" as const, text: textPayload }],
    structuredContent: output,
  };
  const duplicatedBytes = serializedBytes(duplicated);
  if (duplicatedBytes !== null && duplicatedBytes <= AGENT_CONTROL_MCP_MAX_RESULT_BYTES) {
    return duplicated;
  }

  const structuredOnly = {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ dataLocation: "structuredContent", bounded: true }),
    }],
    structuredContent: output,
  };
  const structuredBytes = serializedBytes(structuredOnly);
  if (structuredBytes !== null && structuredBytes <= AGENT_CONTROL_MCP_MAX_RESULT_BYTES) {
    return structuredOnly;
  }
  return toolFailureCode("PAYLOAD_TOO_LARGE");
}

function readErrorCode(error: unknown): ToolErrorCode {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return "TOOL_REQUEST_FAILED";
  }
  const code = (error as { code?: unknown }).code;
  if (code === "BODY_TOO_LARGE" || code === "RESPONSE_TOO_LARGE") return "PAYLOAD_TOO_LARGE";
  if (code === "RATE_LIMITED") return "RATE_LIMITED";
  if (code === "CALLER_ABORTED" || code === "REQUEST_ABORTED") return "REQUEST_ABORTED";
  if (code === "REQUEST_TIMEOUT") return "REQUEST_TIMEOUT";
  if (code === "VALIDATION_ERROR" || code === "INVALID_REQUEST") return "VALIDATION_ERROR";
  if (
    code === "INVALID_CONTENT_LENGTH"
    || code === "INVALID_CONTENT_TYPE"
    || code === "INVALID_JSON"
    || code === "INVALID_RESPONSE"
    || code === "NETWORK_ERROR"
    || code === "UPSTREAM_FAILURE"
  ) {
    return "UPSTREAM_FAILURE";
  }
  return "TOOL_REQUEST_FAILED";
}

function toolFailure(error: unknown) {
  return toolFailureCode(readErrorCode(error));
}

async function boundedCall<T extends ToolData>(operation: () => Promise<T>) {
  try {
    return toolSuccess(await operation());
  } catch (error) {
    return toolFailure(error);
  }
}

const AgentverseAddressSchema = z.string().max(65).refine(isAgentverseAddress, {
  message: "Address must be a checksum-valid Agentverse address.",
});

const EvmAddressSchema = z.string().regex(EVM_ADDRESS).max(42);

const JobIdSchema = z
  .string()
  .regex(UINT256_DECIMAL)
  .max(78)
  .refine((value) => BigInt(value) <= UINT256_MAX, { message: "jobId exceeds uint256." });

const TransactionHashSchema = z.string().regex(TRANSACTION_HASH).max(66);

const PassportRecordSchema = z.record(z.string().min(1).max(128), z.unknown());
const NullableHashSchema = z.string().regex(HEX_HASH).nullable();
const ActionPassportCandidateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    kind: z.literal("ACTION_PASSPORT_PREVIEW"),
    id: z.string().min(3).max(128),
    createdAt: z.string().datetime({ offset: true }),
    maturity: z.literal("SOURCE_PREVIEW"),
    intent: McpAgentActionIntentSchema,
    intentHash: z.string().regex(HEX_HASH),
    evidence: z
      .object({
        // A verifier accepts an empty candidate so it can return INVALID;
        // the authoritative passport schema still requires evidence.
        items: z.array(PassportRecordSchema).max(16),
        root: z.string().regex(HEX_HASH),
      })
      .strict(),
    policy: z
      .object({
        definition: PassportRecordSchema,
        result: PassportRecordSchema,
      })
      .strict(),
    authorization: z
      .object({
        status: z.enum(["NOT_RECORDED", "RECORDED_DEMO_ONLY"]),
        demoOnly: z.literal(true),
        subjectRef: z.string().min(1).max(256).nullable(),
        method: z.literal("LOCAL_DEMO_ACK").nullable(),
        intentHash: NullableHashSchema,
        evidenceRoot: NullableHashSchema,
        policyDigest: NullableHashSchema,
        recordedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
    execution: z
      .object({
        status: z.literal("UNAVAILABLE"),
        reasonCode: z.enum([
          "SOURCE_PREVIEW_ONLY",
          "NO_PROVIDER_SIGNER",
          "NO_WALLET_AUTHORIZATION",
          "EXTERNAL_CONTRACT_UNVERIFIED",
        ]),
        jobId: z.null(),
        transactionHash: z.null(),
      })
      .strict(),
    outcome: z
      .object({
        status: z.literal("OUTCOME_NOT_OBSERVED"),
        observedEffects: z.array(z.never()).length(0),
        sourceRefs: z.array(z.never()).length(0),
      })
      .strict(),
    limitations: z.tuple([
      z.string().min(1).max(80_000),
      z.string().min(1).max(80_000),
      z.string().min(1).max(80_000),
      z.string().min(1).max(80_000),
    ]),
    passportHash: z.string().regex(HEX_HASH),
    integrity: z
      .object({ algorithm: z.literal("SHA-256"), hash: z.string().regex(HEX_HASH) })
      .strict(),
  })
  .strict();

const DraftIntentInputSchema = z.object({ intent: McpAgentActionIntentSchema }).strict();
const InspectAgentverseInputSchema = z.object({ address: AgentverseAddressSchema }).strict();
const ListAgentLaunchInputSchema = z.object({}).strict();
const InspectAgentLaunchInputSchema = z.object({ address: EvmAddressSchema }).strict();
const PreflightInputSchema = z
  .object({
    intent: McpAgentActionIntentSchema,
    recordDemoDecision: z.boolean().default(false),
  })
  .strict();
const VerifyActionPassportPreviewInputSchema = z
  .object({ passport: ActionPassportCandidateSchema })
  .strict();
const ObserveBnbApexInputSchema = z
  .object({
    jobId: JobIdSchema,
    txHash: TransactionHashSchema,
  })
  .strict();


function isWithinVerifyInputBoundary(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 32) return false;
    if (typeof current.value === "string" && current.value.length > 80_000) return false;
    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      for (const [key, entry] of Object.entries(current.value)) {
        if (key.length > 128) return false;
        stack.push({ value: entry, depth: current.depth + 1 });
      }
    } else if (
      current.value !== null
      && typeof current.value !== "string"
      && typeof current.value !== "boolean"
      && !(typeof current.value === "number" && Number.isFinite(current.value))
    ) {
      return false;
    }
  }
  const bytes = serializedBytes(value);
  return bytes !== null && bytes <= AGENT_CONTROL_MCP_MAX_VERIFY_INPUT_BYTES;
}

function signalOptions(signal: AbortSignal): AgentControlRequestOptions {
  return { signal };
}

/**
 * The write refusal a caller sees.
 *
 * Every refusal from the gate, the registry, the A2A mirror and the ledger
 * keeps its own reason code, because a caller that is told only "rejected"
 * cannot tell "this action does not exist" from "this tool may not propose it"
 * — and those want different corrections. Nothing else is echoed: no message
 * anyone else wrote, no stack, and none of the caller's own input.
 */
/**
 * Shape one write outcome as an MCP result.
 *
 * The decision itself is `dispatchMcpWrite`, shared with the hosted endpoint.
 * What stays here is transport shaping and the byte ceiling, which are
 * genuinely per server.
 */
function dispatchWriteTool(ledger: ProposalLedger, name: string, rawInput: unknown) {
  const outcome = dispatchMcpWrite(ledger, name, rawInput);
  if (outcome.ok) return toolSuccess(outcome.data as ToolData, MCP_WRITE_LIMITATIONS);
  const known: readonly string[] = ["UNKNOWN_TOOL", "VALIDATION_ERROR", "TOOL_REQUEST_FAILED"];
  if (known.includes(outcome.code)) return toolFailureCode(outcome.code as ToolErrorCode);
  const output = { error: { code: outcome.code, message: "The bounded write was refused." } };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

async function dispatchAgentControlToolUnchecked(
  client: AgentControlMcpClient,
  ledger: ProposalLedger,
  name: string,
  rawInput: unknown,
  signal: AbortSignal,
) {
  if (mcpWriteTool(name) !== null) return dispatchWriteTool(ledger, name, rawInput);

  switch (name) {
    case "draft_agent_action_intent": {
      const parsed = DraftIntentInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return toolSuccess({
        maturity: "SOURCE_PREVIEW",
        intent: parsed.data.intent,
        limitations: MCP_LIMITATIONS,
      });
    }
    case "inspect_agentverse_agent": {
      const parsed = InspectAgentverseInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return boundedCall(
        () => client.agentPassport(parsed.data.address, signalOptions(signal)),
      );
    }
    case "list_agent_launch_testnet_tokens": {
      const parsed = ListAgentLaunchInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return boundedCall(() => client.agentLaunchTokens(signalOptions(signal)));
    }
    case "inspect_agent_launch_testnet_token": {
      const parsed = InspectAgentLaunchInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return boundedCall(
        () => client.agentLaunchToken(parsed.data.address, signalOptions(signal)),
      );
    }
    case "run_agent_action_preflight": {
      const parsed = PreflightInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return boundedCall(async () => {
        const result = await client.preflight(
          {
            intent: parsed.data.intent,
            recordDemoDecision: parsed.data.recordDemoDecision,
          },
          signalOptions(signal),
        );
        return result.passport;
      });
    }
    case "verify_action_passport_preview": {
      const parsed = VerifyActionPassportPreviewInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      if (!isWithinVerifyInputBoundary(parsed.data.passport)) {
        return toolFailureCode("PAYLOAD_TOO_LARGE");
      }
      return boundedCall(
        () => client.verifyArtifact(parsed.data.passport, signalOptions(signal)),
      );
    }
    case "observe_bnb_apex_testnet_job": {
      const parsed = ObserveBnbApexInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return boundedCall(
        () => client.observeBnbApex(
          {
            jobId: parsed.data.jobId,
            txHash: parsed.data.txHash,
          } satisfies BnbApexObservationRequest,
          signalOptions(signal),
        ),
      );
    }
    default:
      return toolFailureCode("UNKNOWN_TOOL");
  }
}

async function dispatchAgentControlTool(
  client: AgentControlMcpClient,
  ledger: ProposalLedger,
  name: string,
  rawInput: unknown,
  signal: AbortSignal,
) {
  try {
    return await dispatchAgentControlToolUnchecked(client, ledger, name, rawInput, signal);
  } catch {
    return toolFailureCode("TOOL_REQUEST_FAILED");
  }
}


export function createAgentControlMcpServer(client: AgentControlMcpClient): McpServer {
  const server = new McpServer(
    { name: "ryntra-agent-control", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  /* One ledger per server, created here rather than at module scope: two stdio
     sessions in one process must not see each other's proposals, and a
     module-level map would make that a shared store nobody declared. */
  const ledger = createProposalLedger(() => new Date().toISOString());

  server.registerTool(
    "draft_agent_action_intent",
    {
      title: "Draft a strict Agent Action Intent",
      description:
        "Validate and return an AgentActionIntent 1.0.0 source preview. This never authorizes, signs, submits, pays or settles.",
      inputSchema: DraftIntentInputSchema,
      annotations: localReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "draft_agent_action_intent",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "inspect_agentverse_agent",
    {
      title: "Inspect one Agentverse address",
      description:
        "Build a bounded Agent Passport from fixed public Agentverse reads. Provider claims remain separate from Ryntra observations.",
      inputSchema: InspectAgentverseInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "inspect_agentverse_agent",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "list_agent_launch_testnet_tokens",
    {
      title: "List Agent Launch BSC Testnet token records",
      description:
        "Read the fixed Agent Launch public list route for chainId 97. An empty list is an honest ZERO_STATE, not adoption evidence.",
      inputSchema: ListAgentLaunchInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "list_agent_launch_testnet_tokens",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "inspect_agent_launch_testnet_token",
    {
      title: "Inspect one Agent Launch BSC Testnet token record",
      description:
        "Read one exact EVM token-address record through the fixed Agent Launch chainId 97 route. No token action is performed.",
      inputSchema: InspectAgentLaunchInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "inspect_agent_launch_testnet_token",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "run_agent_action_preflight",
    {
      title: "Run deterministic Agent Control preflight",
      description:
        "Evaluate a strict intent and return a non-executing Action Passport Preview. Demo acknowledgement is not wallet authorization.",
      inputSchema: PreflightInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "run_agent_action_preflight",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "verify_action_passport_preview",
    {
      title: "Verify a Action Passport Preview",
      description:
        "Send one strictly bounded Action Passport candidate to the configured Ryntra verification API. This HTTP read/compute call never observes an outcome.",
      inputSchema: VerifyActionPassportPreviewInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "verify_action_passport_preview",
      input,
      context.mcpReq.signal,
    ),
  );

  server.registerTool(
    "observe_bnb_apex_testnet_job",
    {
      title: "Observe one known BNB APEX BSC Testnet reference",
      description:
        "Read one exact jobId and transaction hash through fixed official BSC Testnet contracts. No log scan or lifecycle write occurs.",
      inputSchema: ObserveBnbApexInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input, context) => dispatchAgentControlTool(
      client,
      ledger,
      "observe_bnb_apex_testnet_job",
      input,
      context.mcpReq.signal,
    ),
  );

  /* The five write tools, registered from the catalogue rather than written out
     one by one.
     A loop here and a literal switch in `dispatchWriteTool` is deliberate
     asymmetry. The loop guarantees that what `tools/list` publishes is exactly
     the catalogue — a tool cannot appear in the inventory without an entry, and
     an entry cannot ship without a schema, because the lookup below would throw
     at construction. The dispatch stays a literal switch because the body of a
     write must never be reachable by a name the catalogue happened to carry. */
  for (const tool of MCP_WRITE_TOOLS) {
    const inputSchema = WRITE_INPUT_SCHEMAS[tool.name as keyof typeof WRITE_INPUT_SCHEMAS];
    if (!inputSchema) throw new Error("a write tool was catalogued without an input schema");
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.summary} ${tool.limitations.join(" ")}`,
        inputSchema,
        annotations: localWriteAnnotations,
      },
      async (input: unknown, context: { mcpReq: { signal: AbortSignal } }) =>
        dispatchAgentControlTool(client, ledger, tool.name, input, context.mcpReq.signal),
    );
  }

  // The high-level SDK validates tools before registered callbacks and includes
  // raw tool/key names in its default error text. Replace only tools/call with
  // a fixed redacted boundary; tools/list continues to use the twelve registered
  // definitions above, so inventory and JSON Schemas cannot drift.
  server.server.setRequestHandler("tools/call", async (request, context) => (
    dispatchAgentControlTool(
      client,
      ledger,
      request.params.name,
      request.params.arguments ?? {},
      context.mcpReq.signal,
    )
  ));

  return server;
}
