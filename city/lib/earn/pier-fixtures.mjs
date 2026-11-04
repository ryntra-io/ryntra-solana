// Fixtures for the SOL Pier (CITY-93): the engine's recorded SOL–USDC DLMM pool (16.10) and a JitoSOL–SOL DLMM pool
// shaped like the engine's catalogue answers it. The recorded catalogue carries no LST pool (it is the top 120 by
// volume of one morning), so this one is written by hand for the tests and the screenshot stand — never shown live.
import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG } from "../districts/harbor/test-fixtures.mjs";

export const SOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
export const JUPSOL = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";

export const SOL_USDC = harborPools(CATALOG).find((pool) => pool.kind === "dlmm" && pool.pair === "SOL-USDC" && pool.binStepBps === 4);

/** JitoSOL–SOL: X is the LST, Y is SOL; one-basis-point bins. */
export function lstPool(changes = {}) {
  const solUsd = SOL_USDC?.x.priceUsd ?? 180;
  return {
    kind: "dlmm",
    address: "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U",
    pair: "JitoSOL-SOL",
    x: { mint: JITOSOL, symbol: "JitoSOL", decimals: 9, priceUsd: solUsd * 1.2603 },
    y: { mint: SOL, symbol: "SOL", decimals: 9, priceUsd: solUsd },
    price: 1.2603,
    tvlUsd: 12_400_000,
    volume24hUsd: 9_100_000,
    fees24hUsd: 910,
    lpFees24hUsd: 864.5,
    feePct: 0.01,
    binStepBps: 1,
    band: null,
    ...changes,
  };
}

/** Four-hour closes for thirty days, unix seconds: a gentle wave around `start` that drifts to `end`. */
export function closes(start, end, bars = 180, wave = 0.01, t0 = 1_759_000_000) {
  return Array.from({ length: bars }, (_, i) => {
    const k = i / (bars - 1);
    const p = start + (end - start) * k + start * wave * Math.sin(i / 9);
    return { time: t0 + i * 14_400, open: p, high: p * 1.002, low: p * 0.998, close: p, volume: 1000 };
  });
}
