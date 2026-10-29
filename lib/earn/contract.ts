/**
 * The one interface both Earn providers answer.
 *
 * Everything a surface needs is here — read the markets, read
 * one wallet's positions, build the bytes for one action — and a provider that cannot do one of them says so
 * in the same four words as the other ({@link EarnUnavailable}).
 *
 * Types only. The adapters are `jupiter-adapter.ts` and `kamino-adapter.ts`, the actions that ask them are
 * `actions.ts`, and the wiring that hands them the real key and the real chain is `service.server.ts`.
 */

import type { EarnAction, EarnMarket, EarnPosition, EarnProviderId, EarnUnavailable } from "./model.ts";

/** Anything a provider refused or could not do, in a shape a route can answer with. */
export type EarnFailure = Readonly<{ ok: false; code: EarnUnavailable | string; reason: string; status?: number }>;

export type EarnMarketsRead = Readonly<{ ok: true; markets: readonly EarnMarket[] }> | EarnFailure;

export type EarnPositionsRead = Readonly<{ ok: true; positions: readonly EarnPosition[] }> | EarnFailure;

/** One action's bytes, unsigned, as the provider built them, with the market as it stood at that moment. */
export type EarnBuilt = Readonly<{
  ok: true;
  wireBase64: string;
  /** The market the bytes were built against — the Review quotes this, not a figure read earlier. */
  market: EarnMarket;
  /** What will actually move, base units: a partial withdrawal is already cut to the market's liquidity. */
  amountRaw: bigint;
  partial: boolean;
  leftRaw: bigint | null;
}>;

export type EarnBuildRequest = Readonly<{
  action: EarnAction;
  owner: string;
  /** The market's id as the provider's own read gave it. */
  marketId: string;
  /** What the person asked for, base units. */
  askedRaw: bigint;
  /** The wallet's balance of the asset, base units, or null when it was not read. */
  walletRaw: bigint | null;
  /** What the position is worth, base units, or null when it was not read. */
  positionRaw: bigint | null;
}>;

export type EarnAdapter = Readonly<{
  provider: EarnProviderId;
  /** Why this provider cannot be asked at all now, or null when it can. */
  blocked: Readonly<{ code: EarnUnavailable; reason: string }> | null;
  markets(): Promise<EarnMarketsRead>;
  positions(owner: string, markets: readonly EarnMarket[]): Promise<EarnPositionsRead>;
  build(request: EarnBuildRequest): Promise<EarnBuilt | EarnFailure>;
}>;
