import type { CrossSwapProviderStatus } from "../swap/cross-swap-status.ts";
import { serviceFeeQuoted, serviceFeeRateFor, settleServiceFee, type RyntraServiceFee } from "../swap/service-fee.ts";

/**
 * The cross-chain lane's finished fee, in the one shape rewards understand.
 *
 * `CrossSwapProviderStatus` reports what Relay actually took, and it reports it
 * in the lane's own vocabulary rather than as a `RyntraServiceFee` — the two
 * shapes were written for different jobs and neither should grow the other's
 * fields. This is the adapter between them, and it is deliberately the only
 * place the cross-chain lane's fee becomes an accrual base.
 *
 * ## What it refuses
 *
 * A fee the provider did not confirm taking. `collected: false` is a legitimate
 * and important answer on this lane — Relay's own documented silent case is an
 * app fee that was quoted and never charged — and paying cashback on it would
 * be Ryntra funding a reward out of money it never received.
 *
 * ## The asset it does not claim to know
 *
 * Current Relay readers supply the fee's own currency and stated rate.
 * An explicitly unknown currency stays unknown; the input asset is used only
 * for legacy reports that predate the field. Dollar values come from the
 * observed fee, never a quote or the current token price.
 */
export function crossSwapServiceFee(
  status: CrossSwapProviderStatus,
  args: Readonly<{ symbol: string; decimals: number }>,
): RyntraServiceFee | null {
  const fee = status.serviceFee;
  if (!fee) return null;
  const settlement = fee.settlement;
  if (!settlement || settlement.userPaidRaw === null) return null;
  const symbol = fee.currency !== undefined ? fee.currency?.symbol ?? null : args.symbol;
  const decimals = fee.currency !== undefined ? fee.currency?.decimals ?? null : args.decimals;
  const asset = fee.currency?.address ?? null;

  const quoted = serviceFeeQuoted("RELAY_APP_FEE", {
    basisPoints: fee.basisPoints ?? serviceFeeRateFor("RELAY_APP_FEE"),
    asset,
    symbol,
    decimals,
    amountRaw: fee.paidAmountRaw ?? settlement.userPaidRaw,
    usd: fee.paidUsd,
    /* Relay takes no cut of an app fee. Its own charge is the platform fee,
       which is a separate line the person already sees. */
    providerRetainedPercent: 0,
  });

  return settleServiceFee(quoted, {
    collected: fee.collected,
    amountRaw: settlement.userPaidRaw,
    usd: fee.paidUsd,
    symbol,
    decimals,
    settlement: {
      userPaidRaw: settlement.userPaidRaw,
      providerRaw: settlement.providerRaw,
      ryntraRaw: settlement.ryntraRaw,
      asset,
      symbol,
      decimals,
      basis: settlement.basis,
      operationRef: settlement.operationRef,
    },
  });
}
