import { serveSolanaEvidenceMcpStdio } from "./serve.ts";

function main(): void {
  try {
    const handle = serveSolanaEvidenceMcpStdio();

    process.once("SIGINT", () => {
      void handle.close().finally(() => process.exit(0));
    });
  } catch {
    console.error("[ryntra-solana-evidence-mcp] startup failed");
    process.exitCode = 1;
  }
}

main();
