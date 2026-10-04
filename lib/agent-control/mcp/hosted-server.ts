import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AgentActionIntentSchema } from "../contracts.ts";
import { createAgentControlDemo } from "../demo.ts";
import type { AgentControlScope } from "../tenancy.ts";
import { verifyAgentArtifact } from "../verify.ts";
import { createProposalLedger, type ProposalLedger } from "./proposal-ledger.ts";
import {
  HOSTED_MCP_TOOLS,
  admitHostedToolCall,
  hostedRefusalMessage,
  hostedToolsFor,
} from "./hosted.ts";
import {
  MCP_WRITE_LIMITATIONS,
  WRITE_INPUT_SCHEMAS,
  dispatchMcpWrite,
} from "./write-dispatch.ts";
import { MCP_WRITE_TOOLS } from "./write-tools.ts";

/**
 * The hosted MCP server, built fresh for one authenticated request.
 *
 * Three properties are worth naming because each is a decision rather than a
 * default.
 *
 * **The inventory is built from the token.** `hostedToolsFor` decides what is
 * registered, so `tools/list` is already correct for this caller. That is
 * convenience. The control is the `tools/call` handler, which re-runs
 * `admitHostedToolCall` against the same scopes before any body executes — so a
 * caller that guessed a name, kept one from a wider token, or reached the
 * endpoint through some generic execute indirection is refused with the same
 * reason the filter was expressing. That is written twice on purpose, because
 * a filter alone is not a control.
 *
 * **No tool here reaches outside this process.** The three read tools compute
 * locally; the five write tools produce a proposal in an in-memory ledger. The
 * four upstream read tools the stdio server carries are deliberately not hosted
 * — see `./hosted.ts`. So this endpoint has no outbound surface at all, which
 * is the same property the write gate gives tool input when it refuses to
 * accept an endpoint from a caller.
 *
 * **The ledger is per request, and that is a stated limitation rather than a
 * bug.** A proposal made through the hosted endpoint lives in the instance that
 * accepted it. Making proposals durable across instances is real work with a
 * real schema, and shipping a `proposalId` that a second call cannot resolve
 * would be worse than saying so: every write result carries the limitation, and
 * the durable record of the call is the receipt, which is written to the store.
 */

const hostedReadAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  /* False, and load-bearing for nothing. MCP `2026-07-28` states that clients
     MUST treat annotations as untrusted; the fact this endpoint makes no
     outbound call is a property of what is registered, not of this hint. */
  openWorldHint: false,
};

const hostedWriteAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const HOSTED_READ_LIMITATIONS = [
  "SOURCE PREVIEW — NOT A FINALIZED RECEIPT",
  "No account, wallet, signature, provider action, payment or settlement is performed.",
] as const;

const DraftIntentInputSchema = { intent: AgentActionIntentSchema };
const PreflightInputSchema = {
  intent: AgentActionIntentSchema,
  recordDemoDecision: z.boolean().default(false),
};
const VerifyInputSchema = { artifact: z.unknown() };

type McpToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent: unknown;
};

function success(data: unknown, limitations: readonly string[]): McpToolResult {
  const output = { data, limitations };
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function failure(code: string, message: string): McpToolResult {
  const output = { error: { code, message } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

export type HostedCallOutcome = Readonly<{
  toolName: string;
  admitted: boolean;
  reasonCode: string | null;
  args: unknown;
}>;

export type HostedServerOptions = Readonly<{
  scopes: readonly AgentControlScope[];
  /** Called once per `tools/call`, whatever the outcome. The route writes the receipt. */
  onCall: (outcome: HostedCallOutcome) => void;
}>;

function runHostedTool(
  ledger: ProposalLedger,
  name: string,
  rawInput: unknown,
): Readonly<{ result: McpToolResult; reasonCode: string | null }> {
  if (name === "draft_agent_action_intent") {
    const parsed = z.object(DraftIntentInputSchema).strict().safeParse(rawInput);
    if (!parsed.success) return { result: failure("VALIDATION_ERROR", "The tool input was not accepted."), reasonCode: "VALIDATION_ERROR" };
    return {
      result: success(
        { maturity: "SOURCE_PREVIEW", intent: parsed.data.intent },
        HOSTED_READ_LIMITATIONS,
      ),
      reasonCode: null,
    };
  }

  if (name === "run_agent_action_preflight") {
    const parsed = z.object(PreflightInputSchema).strict().safeParse(rawInput);
    if (!parsed.success) return { result: failure("VALIDATION_ERROR", "The tool input was not accepted."), reasonCode: "VALIDATION_ERROR" };
    try {
      return {
        result: success(
          createAgentControlDemo({
            intent: parsed.data.intent,
            recordDemoDecision: parsed.data.recordDemoDecision,
          }),
          HOSTED_READ_LIMITATIONS,
        ),
        reasonCode: null,
      };
    } catch {
      return { result: failure("PREFLIGHT_REJECTED", "The source preview could not be constructed."), reasonCode: "PREFLIGHT_REJECTED" };
    }
  }

  if (name === "verify_action_passport_preview") {
    const parsed = z.object(VerifyInputSchema).strict().safeParse(rawInput);
    if (!parsed.success) return { result: failure("VALIDATION_ERROR", "The tool input was not accepted."), reasonCode: "VALIDATION_ERROR" };
    return {
      result: success(verifyAgentArtifact(parsed.data.artifact), HOSTED_READ_LIMITATIONS),
      reasonCode: null,
    };
  }

  const outcome = dispatchMcpWrite(ledger, name, rawInput);
  return outcome.ok
    ? { result: success(outcome.data, MCP_WRITE_LIMITATIONS), reasonCode: null }
    : { result: failure(outcome.code, "The bounded write was refused."), reasonCode: outcome.code };
}

export function createHostedAgentControlServer(options: HostedServerOptions): McpServer {
  const server = new McpServer(
    { name: "ryntra-action-evidence", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );

  /* One ledger per served request. Two tenants must never see each other's
     proposals, and a module-level map would be a shared store nobody
     declared. */
  const ledger = createProposalLedger(() => new Date().toISOString());

  for (const tool of hostedToolsFor(options.scopes)) {
    const write = MCP_WRITE_TOOLS.find((candidate) => candidate.name === tool.name);
    if (write) {
      const inputSchema = WRITE_INPUT_SCHEMAS[write.name as keyof typeof WRITE_INPUT_SCHEMAS];
      if (!inputSchema) throw new Error("a write tool was catalogued without an input schema");
      server.registerTool(
        write.name,
        {
          title: write.title,
          description: `${write.summary} ${write.limitations.join(" ")}`,
          inputSchema,
          annotations: hostedWriteAnnotations,
        },
        async () => failure("UNREACHABLE", "The hosted dispatch answers every call."),
      );
      continue;
    }

    const readSchemas: Record<string, Record<string, z.ZodTypeAny>> = {
      draft_agent_action_intent: DraftIntentInputSchema,
      run_agent_action_preflight: PreflightInputSchema,
      verify_action_passport_preview: VerifyInputSchema,
    };
    server.registerTool(
      tool.name,
      {
        title: tool.name.replace(/_/g, " "),
        description:
          "Bounded local computation over Ryntra's own contracts. Reaches no provider, chain, wallet or facilitator.",
        inputSchema: readSchemas[tool.name],
        annotations: hostedReadAnnotations,
      },
      async () => failure("UNREACHABLE", "The hosted dispatch answers every call."),
    );
  }

  /*
   * One handler for every call, replacing the per-tool callbacks above.
   *
   * The registered callbacks exist so `tools/list` publishes real schemas and
   * titles; none of them ever runs. Routing every call through one place is
   * what makes the scope check unavoidable — a tool added later cannot acquire
   * an unguarded path by being registered, because registration is not how a
   * call is served here.
   */
  server.server.setRequestHandler("tools/call", async (request) => {
    const name = String(request.params.name ?? "");
    const args = request.params.arguments ?? {};

    const admission = admitHostedToolCall(name, options.scopes);
    if (!admission.admitted) {
      options.onCall({ toolName: name, admitted: false, reasonCode: admission.reasonCode, args });
      return failure(admission.reasonCode, hostedRefusalMessage(admission));
    }

    const { result, reasonCode } = runHostedTool(ledger, name, args);
    options.onCall({ toolName: name, admitted: true, reasonCode, args });
    return result;
  });

  return server;
}

/** Every name this endpoint could ever host, for the surface and its tests. */
export function hostedInventory(): readonly string[] {
  return HOSTED_MCP_TOOLS.map((tool) => tool.name);
}
