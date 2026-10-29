/**
 * The guest — a person asking Ryntra without a wallet (AI-02).
 *
 * A guest asks about the market only: a price, a move, what an asset is, a
 * comparison. The same intent, tools, verifier and model as a conversation
 * answer it, through readers that hold nothing of anyone's own — a plan, a
 * holding, a note, a history read is refused at the seam, whatever asked
 * for it — and through the market tools alone: no paid evidence provider is
 * read for someone nobody knows. Nothing is stored but the meter.
 *
 * A guest is a keyed digest of the address the request came from, never
 * the address: an HMAC under a server secret with the day in it, so the
 * meter, the receipt and the provider's safety identifier all see
 * `guest_<32 hex>`, which cannot be walked back to an address without the
 * secret and does not link one day's guest to the next. An IPv6 address
 * counts by its /64 — one host's whole block is one guest.
 */

import { createHmac } from "node:crypto";

import type { AgentQuestionClass } from "../api/v1/contract.ts";
import type { AgentReaders } from "../agent/tools/readers.ts";

/** The tools a guest's question may run: the market's own reads, the keyless public sources (AI-03), the news (AI-09) and the side-by-side comparison. */
export const GUEST_TOOLS: ReadonlySet<string> = new Set(["market_read", "stock_read", "prepare_comparison", "dex_pairs_read", "token_report_read", "candles_read", "movers_read", "meteora_pools_read", "launch_health_read", "news_read", "price_move_read"]);

/** The classes a guest is answered on; the rest are someone's own and need a wallet. */
export const GUEST_CLASSES: ReadonlySet<AgentQuestionClass> = new Set(["market", "stock", "evidence", "compare", "help", "unknown", "secret"]);

/** The part of an address that names one guest: IPv4 whole, IPv6 by its /64. */
export function guestNetwork(address: string): string {
  const raw = address.trim().toLowerCase().slice(0, 64);
  /* An IPv4 address carried in IPv6 form is that IPv4 address. */
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  const text = mapped ? mapped[1] : raw;
  if (!text.includes(":")) return text;
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail.length > 0 ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** A guest's key for the day: never the address, never the same tomorrow, never computable without the secret. */
export function guestKeyFor(address: string, secret: string, nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `guest_${createHmac("sha256", `ryntra:assistant:guest:v2:${secret}`).update(`${day}:${guestNetwork(address)}`, "utf8").digest("hex").slice(0, 32)}`;
}

const refuse = async (): Promise<never> => {
  throw new Error("a guest has nothing of their own to read");
};

/** The market readers as they are; every reader of someone's own refused — the boundary said at the seam, not only in the plan. */
export function guestReaders(readers: AgentReaders): AgentReaders {
  return {
    spotMarket: (mint) => readers.spotMarket(mint),
    spotSearch: (query, limit) => readers.spotSearch(query, limit),
    stockRow: (tickerOrMint) => readers.stockRow(tickerOrMint),
    evidence: refuse,
    holdings: refuse,
    plans: refuse,
    plan: refuse,
    planResults: refuse,
    planMemory: refuse,
    planAsset: refuse,
    activity: refuse,
    watchlist: refuse,
    monitoring: refuse,
    inboxNote: refuse,
    /* AI-03: the keyless public sources — the market's, nobody's own. */
    dexPairs: (mint) => readers.dexPairs(mint),
    tokenReport: (mint) => readers.tokenReport(mint),
    candles: (mint, timeframe) => readers.candles(mint, timeframe),
    movers: (window) => readers.movers(window),
    pools: (mint) => readers.pools(mint),
    launchHealth: (mint) => readers.launchHealth(mint),
    /* AI-09: the news everyone reads — public headlines with their source and time. */
    news: (mint) => readers.news(mint),
  };
}
