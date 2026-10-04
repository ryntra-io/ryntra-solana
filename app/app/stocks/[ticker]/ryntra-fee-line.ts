/**
 * «з них комісія Ryntra 0,25% · 0,0025 USDC» — Ryntra's own fee inside «Усі
 * витрати», on its own line beside the issuer's.
 *
 * The figures are the one formatter every surface uses
 * (`serviceFeeReviewText`), in the sheet's own locale: exact where the fee is
 * known before the swap (fee policy v2's `/build` takes it from what was
 * typed), else `≈` a share of the side it is taken from. A route with no fee
 * prints no line — the total above already says nothing was added.
 */

import { serviceFeeReviewText, type RyntraServiceFee } from "@/lib/swap/service-fee";

/* A company is bought with dollars and sold into them; the fee is in one of these. */
const SCALES: Readonly<Record<string, Readonly<{ decimals: number; code: string }>>> = {
  So11111111111111111111111111111111111111112: { decimals: 9, code: "SOL" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { decimals: 6, code: "USDC" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { decimals: 6, code: "USDT" },
};

type OrderFee = Readonly<{ ryntraFee?: unknown; inputMint: string; outputMint: string; inAmountRaw: string; outAmountRaw: string; inUsdValue?: string | null; outUsdValue?: string | null }>;

export function ryntraFeeOfWhich(order: OrderFee | null, label: string, numbers: string): string | null {
  const fee = order?.ryntraFee as RyntraServiceFee | undefined;
  if (!order || !fee || typeof fee.basisPoints !== "number" || fee.basisPoints <= 0) return null;
  const sides = Object.fromEntries([order.inputMint, order.outputMint].flatMap((mint) => (SCALES[mint] ? [[mint, SCALES[mint]]] : [])));
  const figures = serviceFeeReviewText(
    fee,
    { inputMint: order.inputMint, outputMint: order.outputMint, inputRaw: order.inAmountRaw, quotedOutputRaw: order.outAmountRaw },
    sides,
    { numbers, usd: { input: Number(order.inUsdValue) || null, output: Number(order.outUsdValue) || null } },
  );
  return `${label} ${figures}`;
}
