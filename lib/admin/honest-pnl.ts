import { FEE_POLICY_V2, MAJOR_MINTS, WRAPPED_SOL_MINT } from "../core/fee-policy.ts";
import { ESTIMATED_NETWORK_FEE_SOL, type ExitMark, type HonestPnlInput, type PnlLeg } from "../core/pnl/honest.ts";
import { lastMonths, platformMonths, type PlatformMonth } from "../core/pnl/platform.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { executedUsd, movementUsdMicros } from "../solana/action-value.ts";

/**
 * The platform's honest metric (DSC-2) from Ryntra's own record of its swaps (`solanaWalletActions`): each wallet that
 * traded through Ryntra, by the honest standard in dollars, and each month's share of those wallets in the plus after
 * fees. For the admin first.
 *
 * - **A swap's two sides.** A dollar and SOL are money: a swap for either is a buy or a sale of the token on the other
 *   side; a token for a token is a sale of one and a buy of the other at the same dollar value. A swap between two kinds
 *   of money (SOL for a dollar) is no position.
 * - **The dollar value** is the one the ledger keeps (`executedUsd`): the stablecoin leg at par, else the provider's own
 *   figure for the exact fill; without either the leg is not priced — a part not known.
 * - **Fees.** Ryntra's fee is inside the amounts that moved; the network's is not on the row — estimated at the
 *   standard's figure (`ESTIMATED_NETWORK_FEE_SOL`) at SOL's price now, and said.
 * - **What is held** is valued at the exit price now (Jupiter's price, half its liquidity as the pool's depth,
 *   Ryntra's fee by fee policy v2 and the network's on the way out) — for every month alike, and said.
 * - Only swaps through Ryntra are counted: a token that came from elsewhere has no known cost (a part not known).
 *
 * Pure: the rows, the prices and the clock are the caller's.
 */

const RAW = /^[1-9][0-9]*$/;

/** A side that is money: a stablecoin at par, or SOL. */
function isMoney(movement: SolanaWalletAction["out"]): boolean {
  return movement !== null && (movement.mint === WRAPPED_SOL_MINT || movementUsdMicros(movement) !== null);
}

/** The swaps that count, oldest first: through Ryntra, on mainnet, done, both sides settled, two different mints. */
export function countedRyntraSwaps(actions: readonly SolanaWalletAction[]): SolanaWalletAction[] {
  return actions
    .filter(
      (action) =>
        action.network === "mainnet" &&
        action.lane === "SWAP" &&
        action.outcome === "DONE" &&
        action.out !== null &&
        action.in !== null &&
        action.out.mint !== null &&
        action.in.mint !== null &&
        action.out.mint !== action.in.mint &&
        RAW.test(action.out.amountRaw) &&
        RAW.test(action.in.amountRaw),
    )
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.actionId < b.actionId ? -1 : 1));
}

/** Whole units of a side; raw when its decimals are not on the row (it is then never valued). */
function unitsOf(movement: NonNullable<SolanaWalletAction["out"]>): { amount: number; whole: boolean } {
  const raw = Number(movement.amountRaw);
  return movement.decimals === null ? { amount: raw, whole: false } : { amount: raw / 10 ** movement.decimals, whole: true };
}

export type TokenMarketUsd = Readonly<{ priceUsd: number | null; liquidityUsd: number | null }>;

/** Each Ryntra wallet's input by the honest standard, in dollars. `exclude` — the owner's and test wallets. */
export function ryntraWalletInputs(
  actions: readonly SolanaWalletAction[],
  context: Readonly<{ nowS: number; solUsd: number | null; market: ReadonlyMap<string, TokenMarketUsd>; exclude?: ReadonlySet<string> }>,
): Map<string, HonestPnlInput> {
  const solUsd = context.solUsd && context.solUsd > 0 ? context.solUsd : null;
  const networkFee = solUsd === null ? null : ESTIMATED_NETWORK_FEE_SOL * solUsd;
  const legsBy = new Map<string, PnlLeg[]>();
  const unscaled = new Set<string>();
  for (const action of countedRyntraSwaps(actions)) {
    if (context.exclude?.has(action.wallet)) continue;
    const value = executedUsd(action)?.value ?? null;
    const sides = [
      { movement: action.out!, side: "sell" as const },
      { movement: action.in!, side: "buy" as const },
    ].filter((entry) => !isMoney(entry.movement));
    if (sides.length === 0) continue;
    const at = Math.floor(Date.parse(action.startedAt) / 1000);
    const legs = legsBy.get(action.wallet) ?? [];
    legsBy.set(action.wallet, legs);
    for (const { movement, side } of sides) {
      const units = unitsOf(movement);
      if (!units.whole) unscaled.add(movement.mint!);
      legs.push({
        id: `${action.actionId}:${side}`,
        asset: movement.mint!,
        at: Number.isFinite(at) ? at : null,
        side,
        amount: units.amount,
        value,
        fee: networkFee === null ? null : networkFee / sides.length,
      });
    }
  }
  const marks = new Map<string, ExitMark>();
  for (const [mint, known] of context.market) {
    if (unscaled.has(mint)) continue;
    marks.set(mint, {
      price: known.priceUsd !== null && known.priceUsd >= 0 ? known.priceUsd : null,
      depth: known.liquidityUsd !== null && known.liquidityUsd > 0 ? known.liquidityUsd / 2 : null,
      feeShare: (MAJOR_MINTS.has(mint) ? FEE_POLICY_V2.MAJOR.bps : FEE_POLICY_V2.MEME.bps) / 10_000,
      feeFixed: networkFee ?? 0,
    });
  }
  const out = new Map<string, HonestPnlInput>();
  for (const [wallet, legs] of legsBy) out.set(wallet, { unit: "USD", nowS: context.nowS, legs, marks });
  return out;
}

/** The mints a set of swaps holds positions in — what the exit price is read for. */
export function positionMints(actions: readonly SolanaWalletAction[]): string[] {
  const out = new Set<string>();
  for (const action of countedRyntraSwaps(actions)) for (const movement of [action.out!, action.in!]) if (!isMoney(movement)) out.add(movement.mint!);
  return [...out];
}

export type PlatformHonestMetric = Readonly<{
  /** When it was read, ISO. */
  readAt: string;
  months: readonly PlatformMonth[];
  /** Wallets that ever traded through Ryntra (the owner's and test wallets left out). */
  wallets: number;
  excluded: number;
  /** SOL's price used for the network's fee — null: the fees are not known, every month reads «not known». */
  solUsd: number | null;
  /** Of the tokens held, how many had a price and a depth to leave at. */
  marked: number;
  positions: number;
  /** Whether the record was read; `unavailable` — no figure is a fact. */
  source: "measured" | "unavailable";
}>;

/** The metric over the last `count` months, from the rows and the prices given. */
export function platformHonestMetric(
  actions: readonly SolanaWalletAction[],
  context: Readonly<{ nowS: number; solUsd: number | null; market: ReadonlyMap<string, TokenMarketUsd>; exclude: ReadonlySet<string>; count?: number; source?: "measured" | "unavailable" }>,
): PlatformHonestMetric {
  const inputs = ryntraWalletInputs(actions, context);
  const mints = positionMints(actions);
  const traders = new Set(countedRyntraSwaps(actions).map((action) => action.wallet));
  return {
    readAt: new Date(context.nowS * 1000).toISOString(),
    months: platformMonths(inputs, lastMonths(context.nowS, context.count ?? 6)),
    wallets: inputs.size,
    excluded: [...traders].filter((wallet) => context.exclude.has(wallet)).length,
    solUsd: context.solUsd,
    marked: mints.filter((mint) => {
      const known = context.market.get(mint);
      return known !== undefined && known.priceUsd !== null && known.liquidityUsd !== null && known.liquidityUsd > 0;
    }).length,
    positions: mints.length,
    source: context.source ?? "measured",
  };
}
