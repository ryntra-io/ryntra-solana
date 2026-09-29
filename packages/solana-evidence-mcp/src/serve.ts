import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";

import { createSolanaEvidenceMcpServer } from "./server.ts";

const STDIO_MAX_MESSAGE_BYTES = 128 * 1_024;

export function serveSolanaEvidenceMcpStdio() {
  const transport = new StdioServerTransport(
    process.stdin,
    process.stdout,
    { maxBufferSize: STDIO_MAX_MESSAGE_BYTES },
  );
  return serveStdio(
    () => createSolanaEvidenceMcpServer(),
    {
      transport,
      onerror: () => {
        console.error("[ryntra-solana-evidence-mcp] protocol error");
      },
    },
  );
}
