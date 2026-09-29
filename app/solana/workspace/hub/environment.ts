import type { SolanaModuleEnvironment, SolanaModuleMode } from "./modules.ts";

export function environmentChip(
  environment: SolanaModuleEnvironment,
  mode: SolanaModuleMode,
): string {
  if (environment === "MAINNET") {
    return mode === "USER_SIGNED" ? "Mainnet · review required" : "Mainnet · read only";
  }
  return "Workspace";
}
