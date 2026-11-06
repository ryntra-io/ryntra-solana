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

/**
 * A Zap's Review as the engine answers it (CITY-198): 1 SOL into the JitoSOL pier, about half of it swapped through
 * Jupiter with Ryntra's 0.1 %, two transactions for one approval. `rest` — «Take the rest» of one that landed in part.
 */
export function zapReview(changes = {}, { rest = false, route = "jupiter" } = {}) {
  const swap = rest
    ? { route: "pool", inMint: JITOSOL, outMint: SOL, inAmount: "396000000", expectedOut: "498000000", floor: "495500000", fee: null, labels: ["Meteora DLMM"] }
    : {
        route,
        inMint: SOL,
        outMint: JITOSOL,
        inAmount: "500000000",
        expectedOut: "396300000",
        floor: "394300000",
        fee: route === "jupiter" ? { bps: 10, amount: "500000", mint: SOL, account: "FeeAcc1111111111111111111111111111111111111" } : null,
        labels: route === "jupiter" ? ["Meteora DLMM", "Sanctum"] : ["Meteora DLMM"],
      };
  return {
    preview: {
      action: rest ? "zap_rest" : "zap_in",
      venue: "meteora-dlmm",
      pool: "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U",
      owner: "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw",
      tokenX: { mint: JITOSOL, decimals: 9, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      tokenY: { mint: SOL, decimals: 9, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      amountIn: rest ? "0" : "1000000000",
      swap,
      deposit: rest ? null : { x: { asset: JITOSOL, units: "396300000", decimals: 9 }, y: { asset: SOL, units: "500000000", decimals: 9 } },
      range: rest ? null : { kind: "bins", lowerBin: -16, upperBin: 16, lowerPrice: "1.2583", upperPrice: "1.2623" },
      otherBefore: "0",
      unwrapLamports: rest ? "502039280" : "0",
      fees: !rest && route === "jupiter" ? [{ who: "ryntra", applies_to: "swap", bps: 10 }] : [],
      rent: rest ? [{ what: "ledger", direction: "return", lamports: "1280000", refundable: true }] : [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }],
      transactions: rest ? 1 : 2,
      notices: [],
      price: "1.2603",
      at: 1,
      expiresAt: 2,
    },
    transactions: rest ? [{ wireBase64: "AQ==", presigned: [] }] : [{ wireBase64: "AQ==", presigned: [] }, { wireBase64: "Ag==", presigned: [] }],
    position: rest ? "BoeMUkCLHchTD31HdXsbDExuZZfcUppSLpYtV3LZTH6U" : "PoSiTion1111111111111111111111111111111111",
    ticket: rest ? "ticket-rest" : "ticket-zap",
    expiresAt: 0,
    signableMs: 60_000,
    networkFeeLamports: "40000",
    depositUsd: null,
    referenceOut: rest ? "498500000" : "396700000",
    ...changes,
  };
}
