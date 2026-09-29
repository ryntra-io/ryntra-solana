/* Stock Token Intelligence — ERC-8056 on-chain reads + pure presentation math.
   uiMultiplier() lives ONLY on-chain (not in the Arcus API), so we read it from the token
   contract on Robinhood Chain (public, non-custodial — a plain eth_call, no keys). This turns the
   swap/terminal "multiplier · Next" placeholder into a live fact and lets us explain, honestly,
   why a Stock Token's price legitimately drifts above the headline share price (total-return:
   dividends auto-reinvest into the multiplier). See robinhood-chain-truth §5-6.

   Function selectors are keccak256(sig)[:4], VERIFIED two ways on 2026-07-09:
   (1) self-check — the same keccak produced the known balanceOf=0x70a08231 / transfer=0xa9059cbb;
   (2) live probe — uiMultiplier() returned exactly 1e18 (1.0) and oraclePaused() false on the real
       NVDA and TSLA token contracts via https://rpc.mainnet.chain.robinhood.com. */

import { SPOT_RPC_URL } from "../arcus/spot";
import type { OracleReading } from "./oracle-feeds";

// Pure presentation math lives in the leaf util lib/token/ui-multiplier.ts (so it stays
// unit-testable under `node --test`); re-exported here so callers can import both from one place.
export { stockTokenIntel, corporateActionStatus, pendingCorporateAction, type StockTokenIntel, type StockTokenPending } from "../token/ui-multiplier";

/** keccak256(sig)[:4] — verified by self-check + live probe (2026-07-09). */
const SEL = {
  uiMultiplier: "0xa60bf13d", // uiMultiplier()
  newUIMultiplier: "0xdc767007", // newUIMultiplier()
  effectiveAt: "0x97a4064f", // effectiveAt()
  oraclePaused: "0x7706ba52", // oraclePaused()
} as const;

async function ethCall(to: string, data: string, rpcUrl: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "eth_call error");
  return j.result ?? "0x";
}

const toBig = (hex: string): bigint => {
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
};

export type StockTokenOnchain = {
  uiMultiplier: bigint;
  /** scheduled multiplier; null = could not read (never fabricate a value — a failed sub-read
      must surface as "corporate-action status unknown", not a fake "none scheduled"). */
  newUiMultiplier: bigint | null;
  /** unix seconds; 0 = no scheduled change; null = could not read. */
  effectiveAt: number | null;
  /** true = paused, false = active, null = could not read (never assume active on failure). */
  oraclePaused: boolean | null;
};

/** An empty eth_call result ("0x") means the function is absent / returned nothing — not a value. */
const isEmptyHex = (h: string): boolean => h === "0x" || h === "";

/**
 * Read ERC-8056 state for a Stock Token from Robinhood Chain. Non-custodial public read.
 * Throws if the address is not a Stock Token (uiMultiplier() reverts or returns empty) — callers
 * gate on that. Fail-CLOSED: a failed/empty oracle-pause read yields `null` ("unknown"), never a
 * fake healthy `false` — an unknown signal must never read as all-clear downstream (see lib/rwa/risk).
 */
export async function readStockTokenOnchain(
  tokenAddress: string,
  rpcUrl: string = SPOT_RPC_URL
): Promise<StockTokenOnchain> {
  const [m, nm, ea, op] = await Promise.all([
    ethCall(tokenAddress, SEL.uiMultiplier, rpcUrl),
    // A failed/empty sub-read → null, NOT a fabricated "0x0". Zeros here would read downstream as
    // "no corporate action scheduled" — a fake all-clear over a read we never actually got.
    ethCall(tokenAddress, SEL.newUIMultiplier, rpcUrl).catch(() => null),
    ethCall(tokenAddress, SEL.effectiveAt, rpcUrl).catch(() => null),
    ethCall(tokenAddress, SEL.oraclePaused, rpcUrl).catch(() => null),
  ]);
  // A real Stock Token returns uiMultiplier ≥ 1e18. Empty/zero ("0x", an EOA, or a non-token
  // contract) must NOT silently become 1.0 — that would fake a healthy multiplier. Gate here.
  const uiMultiplier = toBig(m);
  if (uiMultiplier <= 0n) throw new Error("not a Stock Token (empty uiMultiplier)");
  return {
    uiMultiplier,
    newUiMultiplier: nm == null || isEmptyHex(nm) ? null : toBig(nm),
    effectiveAt: ea == null || isEmptyHex(ea) ? null : Number(toBig(ea)),
    oraclePaused: op == null || isEmptyHex(op) ? null : toBig(op) === 1n,
  };
}

/**
 * Read ONLY uiMultiplier() for a Stock Token (a single eth_call). null = could not read, the
 * function is absent, or a non-positive value — callers must treat null as "unknown" and fall
 * back to raw token units, never assume 1.0. For the Holdings table's per-row share-equivalent,
 * where the full 4-call readStockTokenOnchain snapshot is overkill.
 */
export async function readUiMultiplier(tokenAddress: string, rpcUrl: string = SPOT_RPC_URL): Promise<bigint | null> {
  const m = await ethCall(tokenAddress, SEL.uiMultiplier, rpcUrl).catch(() => null);
  if (m == null || isEmptyHex(m)) return null;
  const v = toBig(m);
  return v > 0n ? v : null;
}

const INT256_SIGN = 1n << 255n;
const INT256_MOD = 1n << 256n;

/**
 * Read a Chainlink feed's latestRoundData() → {price, updatedAt}. Non-custodial public eth_call.
 * `answer` is int256 (two's complement): a negative value is treated as ≤0 (bad price), never as a
 * huge positive. Empty/short result ⇒ nulls ("unknown"), never a fake healthy reading.
 */
export async function readOracleReading(feedProxy: string, decimals: number, rpcUrl: string = SPOT_RPC_URL): Promise<OracleReading> {
  // latestRoundData() = 0xfeaf968c → (roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80)
  const r = await ethCall(feedProxy, "0xfeaf968c", rpcUrl).catch(() => "0x");
  const h = r.startsWith("0x") ? r.slice(2) : r;
  if (isEmptyHex(r) || h.length < 64 * 4) return { price: null, updatedAt: null };
  const word = (i: number) => toBig("0x" + h.slice(i * 64, (i + 1) * 64));
  const raw = word(1);
  const answer = raw >= INT256_SIGN ? raw - INT256_MOD : raw; // to signed
  const updatedAt = Number(word(3));
  return {
    price: answer > 0n ? Number(answer) / 10 ** decimals : 0, // ≤0 → 0 so freshness reads it as bad
    updatedAt: updatedAt > 0 ? updatedAt : null,
  };
}
