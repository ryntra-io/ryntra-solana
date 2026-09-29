// Arcus SPOT — isomorphic constants + math. Spot is a wallet-signed on-chain RFQ swap
// (host router.spot.arcus.xyz, Robinhood Chain 4663), NOT the Ed25519 perp order engine.
// See docs/ARCUS-API.md §SPOT.

export const SPOT_ROUTER_BASE = "https://router.spot.arcus.xyz";
export const SPOT_CHAIN_ID = 4663;
export const SPOT_CHAIN_ID_HEX = "0x1237";
export const SPOT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const SPOT_CHAIN_NAME = "Robinhood Chain";

// Universal Permit2 (same address every chain). USDG is the quote/settlement token (6 decimals).
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";
export const SPOT_SETTLEMENT_ROUTER_ADDRESS = "0xc94135b63772b91d79d0a2daab2a8801f32359bd";
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_DECIMALS = 6;

export type SpotToken = {
  chainId: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  source: string;
  wrappedTokenAddress?: string | null;
  logoUrl?: string | null;
};

export type SpotQuote = {
  venue: string;
  buyAmount: string; // base units of buyToken
  sellAmount: string; // base units of sellToken
  minBuyAmount: string;
  quoteId: string;
  fees: unknown[];
  needsAllowance: boolean;
  tx: { to: string; data: string; value?: string } | null;
  toSign?: unknown;
  raw?: unknown;
};

export type SpotQuoteResponse = { recommended?: string; all?: SpotQuote[]; errors?: unknown };

/** parse a human decimal string into integer base units (no float error). */
export function parseUnits(value: string, decimals: number): bigint | null {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [whole, frac = ""] = v.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

/** format integer base units to a human string, trimming trailing zeros to `maxFrac`. */
export function formatUnits(raw: string | bigint, decimals: number, maxFrac = 6): string {
  let v: bigint;
  try {
    v = typeof raw === "bigint" ? raw : BigInt(raw);
  } catch {
    return "0";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const s = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${s}` : s;
}
