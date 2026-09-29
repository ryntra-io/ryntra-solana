import type { SolanaActionOutcome, SolanaWalletAction } from "./action-ledger.ts";
import { NATIVE_SOL_DECIMALS, SOLANA_MAINNET_USDC_MINT, SYSTEM_PROGRAM_ID, WRAPPED_SOL_MINT } from "./send-kinds.ts";

export type ActivityHolding = Readonly<{
  kind?: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  decimals: number;
  symbol: string | null;
  name?: string | null;
  catalog?: Readonly<{ symbol: string | null; name: string | null }> | null;
}>;

export type LaneOutcomeEvidence = Readonly<{
  outcome: SolanaActionOutcome;
  updatedAt: string;
}>;

const terminal = (outcome: SolanaActionOutcome) => outcome === "DONE" || outcome === "FAILED";

/**
 * Apply a lane snapshot only when it is at least as fresh as the wallet row.
 *
 * The action row is written after settlement and may therefore contain the
 * terminal answer even when the lane's own last write was missed or restored
 * from an older replica. A stale lane read is useful evidence about what once
 * happened, never evidence that a completed operation became unfinished.
 */
export function projectLaneOutcome(
  action: SolanaWalletAction,
  evidence: LaneOutcomeEvidence | null,
): SolanaWalletAction {
  if (evidence === null) return action;
  const actionAt = Date.parse(action.updatedAt);
  const evidenceAt = Date.parse(evidence.updatedAt);
  if (!Number.isFinite(actionAt) || !Number.isFinite(evidenceAt) || evidenceAt < actionAt) return action;
  if (terminal(action.outcome) && !terminal(evidence.outcome)) return action;
  return evidence.outcome === action.outcome ? action : { ...action, outcome: evidence.outcome };
}

function holdingForMint(mint: string, holdings: readonly ActivityHolding[]): ActivityHolding | null {
  if (mint === WRAPPED_SOL_MINT) {
    return holdings.find((holding) => holding.kind === "NATIVE_SOL") ??
      holdings.find((holding) => holding.mint === mint) ??
      null;
  }
  return holdings.find((holding) => holding.mint === mint) ?? null;
}

function cleanSymbol(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^(wrapped sol|wsol)$/i.test(trimmed) ? "SOL" : trimmed;
}

function knownMintMetadata(mint: string): Readonly<{ decimals: number; symbol: string }> | null {
  if (mint === WRAPPED_SOL_MINT) return { decimals: NATIVE_SOL_DECIMALS, symbol: "SOL" };
  if (mint === SOLANA_MAINNET_USDC_MINT) return { decimals: 6, symbol: "USDC" };
  return null;
}

/**
 * Fill display metadata only from the row, the wallet's live holdings, or a
 * structural mint constant already used by the money path. Unknown metadata
 * stays unknown; this helper never chooses a decimal scale from a token name.
 */
export function enrichActivityMetadata(
  action: SolanaWalletAction,
  holdings: readonly ActivityHolding[],
): SolanaWalletAction {
  const enrich = (movement: SolanaWalletAction["out"]): SolanaWalletAction["out"] => {
    if (movement === null) return movement;
    if (
      action.lane === "SEND" &&
      movement.mint === SYSTEM_PROGRAM_ID &&
      movement.decimals === NATIVE_SOL_DECIMALS
    ) {
      return { ...movement, symbol: "SOL" };
    }
    if (movement.mint === null) return action.lane === "SEND" && movement.decimals === NATIVE_SOL_DECIMALS
      ? { ...movement, symbol: movement.symbol ?? "SOL" } : movement;
    const holding = holdingForMint(movement.mint, holdings);
    const known = knownMintMetadata(movement.mint);
    const symbol =
      cleanSymbol(movement.symbol) ??
      cleanSymbol(holding?.catalog?.symbol) ??
      cleanSymbol(holding?.symbol) ??
      known?.symbol ??
      null;
    const decimals = movement.decimals ?? holding?.decimals ?? known?.decimals ?? null;
    if (symbol === movement.symbol && decimals === movement.decimals) return movement;
    return { ...movement, symbol, decimals };
  };
  return { ...action, out: enrich(action.out), in: enrich(action.in) };
}
