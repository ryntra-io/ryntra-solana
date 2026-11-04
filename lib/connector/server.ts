import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";

import type { ConnectorScope } from "./metadata.ts";
import { carriesSigningLink, CONNECTOR_PROFILES, profileTool, profileToolsFor, type ConnectorProfile } from "./profiles.ts";
import { runConnectorTool, type EngineRead, type ToolEnvelope } from "./tools.ts";

/**
 * The connector's MCP server, built fresh for one authenticated request (CITY-154).
 *
 * The pattern is Agent Control's hosted server (`lib/agent-control/mcp/hosted-server.ts`): `tools/list` is built from
 * the token's scopes, and every `tools/call` goes through one handler that admits the call again before anything
 * runs, so a guessed name or a name kept from a wider token is refused with its reason. A filter alone is not a
 * control.
 */

export const CONNECTOR_SERVER_INFO = Object.freeze({ name: "ryntra", title: "Ryntra", version: "1.0.0" });

/** The full connector's instructions; the catalog's are its profile's (`./profiles.ts`). */
export const CONNECTOR_INSTRUCTIONS = CONNECTOR_PROFILES.full.instructions;

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  /* True: the answers are facts about the open market and the chain, which change between calls. */
  openWorldHint: true,
};

export const CONNECTOR_REFUSALS = ["TOOL_NOT_HOSTED", "SCOPE_NOT_GRANTED", "SIGNING_LINK_REFUSED"] as const;

export type ConnectorCallOutcome = Readonly<{ toolName: string; admitted: boolean; reasonCode: string | null; args: unknown }>;

/** The wallet's durable window, asked once per admitted tool call. */
export type ConnectorMeter = () => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;

export type ConnectorServerOptions = Readonly<{
  /** Which tools this address serves (CITY-170): the full connector at `/mcp`, the catalog's at `/mcp/read`. */
  profile?: ConnectorProfile;
  scopes: readonly ConnectorScope[];
  read: EngineRead;
  origin: string;
  /**
   * Called once per `tools/call`, whatever the outcome, and awaited before the answer is returned: the receipt is
   * written inside the call, so no way of streaming the response can outrun it.
   */
  onCall: (outcome: ConnectorCallOutcome) => Promise<void> | void;
  /** The quota counts tool calls, not protocol messages: `initialize`, `tools/list` and pings cost nothing here. */
  meter?: ConnectorMeter;
  nowMs?: () => number;
}>;

type CallResult = { isError?: boolean; content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> };

function result(envelope: ToolEnvelope | Record<string, unknown>, isError: boolean): CallResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope as Record<string, unknown>,
  };
}

export function createConnectorServer(options: ConnectorServerOptions): McpServer {
  const profile = options.profile ?? CONNECTOR_PROFILES.full;
  const server = new McpServer(
    { ...CONNECTOR_SERVER_INFO },
    { capabilities: { tools: {} }, instructions: profile.instructions },
  );

  for (const tool of profileToolsFor(profile, options.scopes)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { ...READ_ANNOTATIONS, title: tool.title } },
      /* Never runs: every call is answered by the one handler below. Registered so `tools/list` publishes the schema. */
      async () => result({ error: { code: "UNREACHABLE", message: "Every call is answered by the connector's dispatch." } }, true),
    );
  }

  server.server.setRequestHandler("tools/call", async (request) => {
    const name = String(request.params.name ?? "");
    const args = request.params.arguments ?? {};
    const tool = profileTool(profile, name);
    if (!tool) {
      await options.onCall({ toolName: name, admitted: false, reasonCode: "TOOL_NOT_HOSTED", args });
      return result({ error: { code: "TOOL_NOT_HOSTED", message: "Ryntra hosts no tool by that name." } }, true);
    }
    if (!options.scopes.includes(tool.scope)) {
      await options.onCall({ toolName: name, admitted: false, reasonCode: "SCOPE_NOT_GRANTED", args });
      return result({ error: { code: "SCOPE_NOT_GRANTED", message: `This connection was not granted ${tool.scope}.` } }, true);
    }
    if (options.meter) {
      let decision: Awaited<ReturnType<ConnectorMeter>> | null;
      try {
        decision = await options.meter();
      } catch {
        decision = null;
      }
      if (!decision || !decision.allowed) {
        const code = decision ? "RATE_LIMITED" : "QUOTA_UNAVAILABLE";
        await options.onCall({ toolName: name, admitted: false, reasonCode: code, args });
        return result(
          {
            error: decision
              ? { code, message: `This wallet's tool calls for this minute are spent. Try again in ${decision.retryAfterSeconds} s.`, retryAfterSeconds: decision.retryAfterSeconds }
              : { code, message: "The quota could not be read now; try again in a moment." },
          },
          true,
        );
      }
    }
    const outcome = await runConnectorTool(tool, args, { read: options.read, origin: options.origin, nowMs: options.nowMs });
    /* The catalog's rule 3: whatever a route answered, a link to sign never reaches a chat through this address. */
    if (profile.refuseSigningLinks && carriesSigningLink(JSON.stringify(outcome.envelope), options.origin)) {
      await options.onCall({ toolName: name, admitted: true, reasonCode: "SIGNING_LINK_REFUSED", args });
      return result(
        {
          tool: outcome.envelope.tool,
          asOf: outcome.envelope.asOf,
          observedAt: null,
          source: outcome.envelope.source,
          notice: outcome.envelope.notice,
          error: { code: "SIGNING_LINK_REFUSED", message: "This answer carried a link to sign, which this read-only connector does not serve.", status: 502 },
        },
        true,
      );
    }
    await options.onCall({ toolName: name, admitted: true, reasonCode: outcome.reasonCode, args });
    return result(outcome.envelope, outcome.isError);
  });

  return server;
}
