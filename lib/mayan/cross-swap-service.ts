/**
 * Moved: the cross-chain swap lane's shared service now lives at
 * `lib/swap/cross-swap-service.ts`.
 *
 * It left this directory when the lane gained a second provider. A module that
 * chooses between Mayan and Relay cannot live inside `lib/mayan/` without
 * reading as though Mayan were choosing.
 *
 * This file stays as a re-export so that nothing which already imported from
 * here had to change in the same commit that moved it. New code should import
 * the new path.
 */

export {
  addressShapeOk,
  approvalsFor,
  EVM_ADDRESS,
  historyDestinationFor,
  historyWalletFor,
  mayanTokenFor,
  movementFor,
  quoteCrossSwap,
  relayTokenFor,
  resolveCrossSwapRoute,
  SOLANA_ADDRESS,
  type CrossSwapQuoteOptions,
  type CrossSwapQuoteOutcome,
  type CrossSwapRoute,
  type CrossSwapRouteResolution,
} from "../swap/cross-swap-service.ts";
