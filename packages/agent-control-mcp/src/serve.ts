import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";

import { createAgentControlMcpServer, type AgentControlMcpClient } from "./server.ts";

const STDIO_MAX_MESSAGE_BYTES = 128 * 1_024;

export function serveAgentControlMcpStdio(client: AgentControlMcpClient) {
  const transport = new StdioServerTransport(
    process.stdin,
    process.stdout,
    { maxBufferSize: STDIO_MAX_MESSAGE_BYTES },
  );
  return serveStdio(
    () => createAgentControlMcpServer(client),
    {
      transport,
      onerror: () => {
        console.error("[ryntra-agent-control-mcp] protocol error");
      },
    },
  );
}
