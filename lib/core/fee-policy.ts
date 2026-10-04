/**
 * Fee policy v2 — one policy in the core, carried by each venue's own
 * mechanism.
 *
 * A trade belongs to one **flow**, read off its two sides; the flow names the
 * Ryntra fee and the lane it travels by. The table is configuration, not code
 * spread across routes: a protocol that changes its terms changes one row.
 *
 * | Flow       | Fee      | Lane                                                    |
 * |------------|---------:|---------------------------------------------------------|
 * | MEME       | 1.00 %   | Jupiter `/build`, the fee to Ryntra's own fee wallet    |
 * | TRENDING   | 0.50 %   | Jupiter `/build`                                        |
 * | MAJOR      | 0.10 %   | Jupiter `/build`                                        |
 * | STABLE     | 0        | Jupiter `/build` with no fee, or `/order` when it pays more |
 * | XSTOCK     | 0.25 %   | Jupiter `/build`                                        |
 * | ONDO       | 0.50 %   | Jupiter `/order` — Ondo trades on Jupiter only by RFQ   |
 * | PRESTOCK   | as now   | Jupiter `/order`, the referral fee                      |
 * | AS_NOW     | as now   | anything the table does not name, or could not be read  |
 *
 * ## Which flow
 *
 * A side is a dollar (USDC, USDT, PYUSD, USDS, USDG), a major (SOL, BTC, ETH,
 * JUP and the liquid-staked SOL tokens), a stock by its issuer's tag, or a
 * token. A token is TRENDING when Jupiter verifies it and its first pool is at
 * least seven days old; otherwise — new, or not verified — it is MEME. The
 * pair takes the side that is not money: a stock decides first, then the
 * riskier of two tokens. A side whose facts could not be read makes the pair
 * AS_NOW, the lane production ran before this policy — never a guess at a
 * higher fee.
 *
 * ## `/build`, `/order`, and which one wins
 *
 * `/build` (Metis only, ExactIn only) takes no fee of Jupiter's; Ryntra's fee
 * lands in its own fee wallet inside the same transaction. `/order` brings the
 * other engines too (DFlow, OKX; JupiterZ stays excluded on the signable path,
 * whose market-maker co-signature this lane does not implement), but keeps
 * 20 % of a referral fee and refuses a referral below 50 bps. So where a flow's lane is `/build`, both are asked
 * and `/order` wins only when its price, net of Jupiter's share, is better:
 * what the person receives plus what Ryntra keeps, in the output token,
 * compared between the two (`preferOrder`). With an equal fee rate that is
 * exactly «the RFQ beats the router by more than Jupiter's fifth».
 *
 * Pure and client-safe: no clock unless given, no network, no `process.env`.
 */

import { RYNTRA_SERVICE_FEE_POLICY } from "../swap/service-fee.ts";

export const FEE_POLICY_VERSION = "2.0.0";

export const FEE_FLOWS = ["MEME", "TRENDING", "MAJOR", "STABLE", "XSTOCK", "ONDO", "PRESTOCK", "AS_NOW"] as const;
export type FeeFlow = (typeof FEE_FLOWS)[number];

/** The lane a flow's fee travels by. */
export type FeeLane = "BUILD" | "ORDER";

export type FeeFlowRule = Readonly<{
  /** Ryntra's fee, basis points of the trade. */
  bps: number;
  lane: FeeLane;
  /** Whether `/order` may win over `/build` on price, net of Jupiter's share. */
  orderMayWin: boolean;
}>;

/** What production charged before this policy: the Jupiter referral fee on `/order`. */
const AS_NOW_BPS = RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL;

/** The table. The rates change here, and only here. */
export const FEE_POLICY_V2: Readonly<Record<FeeFlow, FeeFlowRule>> = Object.freeze({
  MEME: { bps: 100, lane: "BUILD", orderMayWin: true },
  TRENDING: { bps: 50, lane: "BUILD", orderMayWin: true },
  MAJOR: { bps: 10, lane: "BUILD", orderMayWin: true },
  STABLE: { bps: 0, lane: "BUILD", orderMayWin: true },
  XSTOCK: { bps: 25, lane: "BUILD", orderMayWin: true },
  ONDO: { bps: 50, lane: "ORDER", orderMayWin: false },
  PRESTOCK: { bps: AS_NOW_BPS, lane: "ORDER", orderMayWin: false },
  AS_NOW: { bps: AS_NOW_BPS, lane: "ORDER", orderMayWin: false },
});

/** Jupiter's share of a referral fee on `/order`, in per cent. Documented. */
export const ORDER_REFERRAL_PROVIDER_PERCENT = 20;

/** A token Jupiter verifies younger than this is a new token, MEME. */
export const TRENDING_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Dollars on Solana — a pair of two of them pays no Ryntra fee. */
export const DOLLAR_MINTS: ReadonlySet<string> = new Set([
  USDC_MINT,
  USDT_MINT,
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", // USDG
]);

/** The majors by mint: SOL, BTC (cbBTC, WBTC), ETH, JUP. Liquid-staked SOL is a major by Jupiter's `lst` tag. */
export const MAJOR_MINTS: ReadonlySet<string> = new Set([
  WRAPPED_SOL_MINT,
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", // cbBTC
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", // WBTC
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
]);

/**
 * The mints a fee may be taken in on `/build`: the fee wallet's three
 * canonical accounts. The attribution rule counts nothing else, so a fee in
 * another mint would be money no public counter could see.
 */
export const FEE_WALLET_FEE_MINTS = [WRAPPED_SOL_MINT, USDC_MINT, USDT_MINT] as const;

/** What the catalogue says of one side. Null fields are unread, never false. */
export type SideFacts = Readonly<{
  mint: string;
  verified: boolean;
  tags: readonly string[];
  /** ISO time of the first pool Jupiter knows for the mint. */
  firstPoolAt: string | null;
}>;

export type SideClass = "DOLLAR" | "MAJOR" | "TRENDING" | "MEME" | "XSTOCK" | "ONDO" | "PRESTOCK" | "OTHER_STOCK" | "UNREAD";

const STOCK_TAGS = new Set(["stocks", "xstocks", "equities", "rwa", "prestocks", "pre-ipo", "ondo", "backpack", "commodities"]);

/** One side's class: by mint first (no read needed), then by the catalogue's facts. */
export function classifySide(mint: string, facts: SideFacts | null, nowMs: number): SideClass {
  if (DOLLAR_MINTS.has(mint)) return "DOLLAR";
  if (MAJOR_MINTS.has(mint)) return "MAJOR";
  if (!facts || facts.mint !== mint) return "UNREAD";
  const tags = facts.tags;
  /* The issuer's tag names a stock — never a name or a symbol. */
  if (tags.includes("ondo")) return "ONDO";
  if (tags.includes("xstocks")) return "XSTOCK";
  if (tags.includes("prestocks")) return "PRESTOCK";
  if (tags.some((tag) => STOCK_TAGS.has(tag))) return "OTHER_STOCK";
  if (tags.includes("lst") || tags.includes("major")) return facts.verified ? "MAJOR" : "MEME";
  if (!facts.verified) return "MEME";
  if (facts.firstPoolAt === null) return "UNREAD";
  const born = Date.parse(facts.firstPoolAt);
  if (!Number.isFinite(born)) return "UNREAD";
  return nowMs - born >= TRENDING_MIN_AGE_MS ? "TRENDING" : "MEME";
}

/** The pair's flow from its two sides' classes. */
export function flowOfSides(input: SideClass, output: SideClass): FeeFlow {
  const sides = [input, output];
  if (sides.includes("UNREAD") || sides.includes("OTHER_STOCK")) return "AS_NOW";
  /* A stock decides the pair, whatever pays for it. Two different issuers' stocks against each other are not a flow of the table. */
  const stocks = sides.filter((side) => side === "ONDO" || side === "XSTOCK" || side === "PRESTOCK");
  if (stocks.length === 2) return stocks[0] === stocks[1] ? stocks[0] : "AS_NOW";
  if (stocks.length === 1) return stocks[0] as FeeFlow;
  if (input === "DOLLAR" && output === "DOLLAR") return "STABLE";
  if (sides.includes("MEME")) return "MEME";
  if (sides.includes("TRENDING")) return "TRENDING";
  return "MAJOR";
}

export function classifyPair(
  args: Readonly<{ inputMint: string; outputMint: string; input: SideFacts | null; output: SideFacts | null; nowMs: number }>,
): FeeFlow {
  return flowOfSides(classifySide(args.inputMint, args.input, args.nowMs), classifySide(args.outputMint, args.output, args.nowMs));
}

/** The product whose fee wallet and figures a flow belongs to. */
export function productOfFlow(flow: FeeFlow): "swap" | "memes" | "stocks" {
  if (flow === "MEME") return "memes";
  if (flow === "XSTOCK" || flow === "ONDO" || flow === "PRESTOCK") return "stocks";
  return "swap";
}

/**
 * The side a `/build` fee is taken from. The input when it is one of the fee
 * wallet's mints — then the fee is exact before the signature, a share of the
 * amount the person typed — else the output when it is one, else none: a pair
 * of two other tokens cannot carry a fee the fee wallet would count.
 */
export function buildFeeSide(inputMint: string, outputMint: string): Readonly<{ side: "INPUT" | "OUTPUT"; mint: string }> | null {
  const canonical = (mint: string) => (FEE_WALLET_FEE_MINTS as readonly string[]).includes(mint);
  if (canonical(inputMint)) return { side: "INPUT", mint: inputMint };
  if (canonical(outputMint)) return { side: "OUTPUT", mint: outputMint };
  return null;
}

/**
 * The exact fee on the input side of a `/build` swap: Jupiter's program takes
 * `floor(amount × bps / 10 000)` of the amount (verified by simulation against
 * the fee account, 2026-10-05: 12 345 678 × 25 bps → 30 864).
 */
export function inputSideFeeRaw(amountRaw: string, bps: number): string {
  return ((BigInt(amountRaw) * BigInt(bps)) / 10_000n).toString();
}

/** The `/order` referral this flow asks for, or none: Jupiter refuses a referral below its minimum. */
export function orderReferralBps(flow: FeeFlow, minimumBps: number): number | null {
  const bps = FEE_POLICY_V2[flow].bps;
  return bps >= minimumBps ? bps : null;
}

/**
 * What one candidate is worth, in raw units of the output token: what the
 * person receives, plus what Ryntra keeps of its fee, the fee sized against
 * the trade's gross output. A referral on `/order` keeps 80 % of the fee for
 * Ryntra; `/build` keeps all of it; no fee keeps nothing.
 */
export function candidateValueRaw(outputRaw: string, feeBps: number, ryntraKeepsPercent: number): bigint {
  const out = BigInt(outputRaw);
  if (feeBps <= 0 || ryntraKeepsPercent <= 0) return out;
  /* gross = out × 10 000 / (10 000 − bps); fee = gross − out; kept = fee × keeps / 100. */
  const gross = (out * 10_000n) / BigInt(10_000 - feeBps);
  return out + ((gross - out) * BigInt(ryntraKeepsPercent)) / 100n;
}

/** Whether `/order` wins over `/build`: its price, net of Jupiter's share, is better. Ties stay on `/build`. */
export function preferOrder(
  build: Readonly<{ outputRaw: string; feeBps: number }>,
  order: Readonly<{ outputRaw: string; feeBps: number; referral: boolean }>,
): boolean {
  const buildValue = candidateValueRaw(build.outputRaw, build.feeBps, 100);
  const orderValue = candidateValueRaw(order.outputRaw, order.referral ? order.feeBps : 0, order.referral ? 100 - ORDER_REFERRAL_PROVIDER_PERCENT : 0);
  return orderValue > buildValue;
}
