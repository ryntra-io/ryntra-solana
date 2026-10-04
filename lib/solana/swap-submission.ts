import {
  JUPITER_SWAP_ACTION_REF,
  JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
  JUPITER_SWAP_BUILD_ACTION_REF,
  JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF,
} from "../agent-control/adapters/jupiter-swap.ts";

export const SWAP_SUBMISSION_LANES = [
  "JUPITER_EXECUTE",
  "ADOPTED_RPC",
  "BUILD_OWN_RPC",
  "UNKNOWN",
] as const;

export type SwapSubmissionLane = (typeof SWAP_SUBMISSION_LANES)[number];

export function swapSubmissionActionRef(lane: SwapSubmissionLane): string {
  if (lane === "JUPITER_EXECUTE") return JUPITER_SWAP_ACTION_REF;
  if (lane === "ADOPTED_RPC") return JUPITER_SWAP_ADOPTED_RPC_ACTION_REF;
  if (lane === "BUILD_OWN_RPC") return JUPITER_SWAP_BUILD_ACTION_REF;
  return JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF;
}
