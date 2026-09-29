import { RyntraAgentControlClient } from "../../agent-control-sdk/src/index.ts";
import { serveAgentControlMcpStdio } from "./serve.ts";

function readOrigin(): string {
  return process.env.RYNTRA_AGENT_CONTROL_ORIGIN ?? "http://127.0.0.1:3000";
}

function main(): void {
  try {
    const handle = serveAgentControlMcpStdio(
      new RyntraAgentControlClient({ baseUrl: readOrigin() }),
    );

    process.once("SIGINT", () => {
      void handle.close().finally(() => process.exit(0));
    });
  } catch {
    console.error("[ryntra-agent-control-mcp] startup failed");
    process.exitCode = 1;
  }
}

main();
